-- ============================================================================
-- Bob — team, invites, schedule, materials and bills (production schema).
-- Additive: no table is dropped and no existing row is changed.
-- Mirrors the local SQLite schema in src/server/db (TABLES + invites).
--
-- Least privilege for invited workers and subcontractors (role 'worker'):
--   * they are NOT treated as members by the existing policies (is_member()
--     now means owner/office/staff), so they can't read customers, jobs,
--     enquiries, money, the team or the schedule directly;
--   * they read their own booked work only through public.my_work(), which
--     returns the fields they need (time, site, instructions, their tasks and
--     materials) and nothing financial.
-- ============================================================================

-- 1) Roles: allow 'worker'.
alter table public.memberships drop constraint if exists memberships_role_check;
alter table public.memberships add constraint memberships_role_check check (role in ('owner','office','staff','worker'));

-- 2) Existing member checks exclude workers (every existing policy uses these).
create or replace function public.is_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m where m.org_id = target_org and m.user_id = auth.uid() and m.role in ('owner','office','staff'));
$$;

-- 3) New columns on existing tables.
alter table public.jobs add column if not exists site_address text;
alter table public.jobs add column if not exists what3words text;
alter table public.jobs add column if not exists shared_notes text;
alter table public.tasks add column if not exists assigned_person_id uuid;

-- 4) New tables.
create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('employee','subcontractor')),
  company text, trade text, phone text, email text,
  user_id uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists people_org_idx on public.people(org_id);
create unique index if not exists people_org_user_idx on public.people(org_id, user_id) where user_id is not null;

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  date date not null,
  end_date date,
  start_time time,
  end_time time,
  person_ids uuid[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text not null,
  check (end_date is null or end_date >= date),
  check ((start_time is null) = (end_time is null)),
  check (start_time is null or end_time > start_time)
);
create index if not exists bookings_org_date_idx on public.bookings(org_id, date);
create index if not exists bookings_people_idx on public.bookings using gin (person_ids);

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  item text not null, quantity text not null, supplier text, needed_by date,
  status text not null default 'to_order' check (status in ('to_order','ordered','on_site')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists materials_org_idx on public.materials(org_id, status);

create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  supplier text not null, description text not null,
  amount numeric(12,2) not null check (amount > 0),
  due_date date not null,
  status text not null default 'due' check (status in ('due','paid')),
  job_id uuid references public.jobs(id) on delete set null,
  reference text, paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists bills_org_idx on public.bills(org_id, status, due_date);

-- Invites: only a SHA-256 of the token is stored. Single use, expiring, revocable.
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  person_id uuid references public.people(id) on delete cascade,
  email text not null,
  role text not null check (role in ('worker','owner')),
  token_hash text not null unique,
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_user_id uuid references auth.users(id) on delete set null,
  revoked_at timestamptz
);
create index if not exists invites_org_person_idx on public.invites(org_id, person_id);

-- 5) Row-level security.
alter table public.people    enable row level security;
alter table public.bookings  enable row level security;
alter table public.materials enable row level security;
alter table public.bills     enable row level security;
alter table public.invites   enable row level security;

create policy people_read   on public.people    for select to authenticated using (public.is_member(org_id));
create policy people_write  on public.people    for all    to authenticated using (public.has_role(org_id, array['owner','office'])) with check (public.has_role(org_id, array['owner','office']));
create policy bookings_read on public.bookings  for select to authenticated using (public.is_member(org_id));
create policy bookings_write on public.bookings for all    to authenticated using (public.has_role(org_id, array['owner','office'])) with check (public.has_role(org_id, array['owner','office']) and exists (select 1 from public.jobs j where j.id = job_id and j.org_id = bookings.org_id));
create policy materials_read on public.materials for select to authenticated using (public.is_member(org_id));
create policy materials_write on public.materials for all  to authenticated using (public.is_member(org_id)) with check (public.is_member(org_id) and exists (select 1 from public.jobs j where j.id = job_id and j.org_id = materials.org_id));
create policy bills_all     on public.bills     for all    to authenticated using (public.has_role(org_id, array['owner','office'])) with check (public.has_role(org_id, array['owner','office']));
-- Invites are managed server-side only (token handling): owners/office may list them, never insert tokens from the client.
create policy invites_read  on public.invites   for select to authenticated using (public.has_role(org_id, array['owner','office']));

-- 6) My work: a worker's own bookings and the site details they need. Nothing financial.
create or replace function public.my_work(target_org uuid, from_date date default current_date)
returns jsonb language sql stable security definer set search_path = public as $$
  with me as (
    select p.id, p.name from public.people p
    join public.memberships m on m.org_id = p.org_id and m.user_id = auth.uid()
    where p.org_id = target_org and p.user_id = auth.uid() and p.archived_at is null
  ),
  mine as (
    select b.* from public.bookings b, me
    where b.org_id = target_org and me.id = any(b.person_ids) and coalesce(b.end_date, b.date) >= from_date
  )
  select jsonb_build_object(
    'person', (select jsonb_build_object('id', id, 'name', name) from me),
    'bookings', coalesce((select jsonb_agg(jsonb_build_object(
        'id', mine.id, 'date', mine.date, 'endDate', mine.end_date, 'startTime', mine.start_time, 'endTime', mine.end_time, 'notes', mine.notes,
        'job', jsonb_build_object('id', j.id, 'title', j.title, 'siteAddress', coalesce(j.site_address, j.location), 'what3words', j.what3words, 'instructions', j.shared_notes)
      ) order by mine.date, mine.start_time) from mine join public.jobs j on j.id = mine.job_id), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'dueDate', t.due_date)) from public.tasks t, me where t.org_id = target_org and t.assigned_person_id = me.id and not t.done), '[]'::jsonb),
    'materials', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'jobId', x.job_id, 'item', x.item, 'quantity', x.quantity, 'status', x.status)) from public.materials x where x.org_id = target_org and x.job_id in (select job_id from mine)), '[]'::jsonb)
  );
$$;
revoke all on function public.my_work(uuid, date) from public;
grant execute on function public.my_work(uuid, date) to authenticated;

-- 7) Table privileges (RLS above still decides which rows). Invites are written by the server only.
grant select, insert, update, delete on public.people, public.bookings, public.materials, public.bills to authenticated;
grant select on public.invites to authenticated;
