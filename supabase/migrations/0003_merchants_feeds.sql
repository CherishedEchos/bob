-- ============================================================================
-- Bob — merchants, richer materials, bill payments, site access notes and
-- calendar feeds. Additive only.
-- ============================================================================

alter table public.jobs add column if not exists access_note text;

alter table public.materials add column if not exists unit text;
alter table public.materials add column if not exists merchant_id uuid;
alter table public.materials add column if not exists order_ref text;
alter table public.materials add column if not exists expected_delivery date;
alter table public.materials add column if not exists notes text;

alter table public.bills add column if not exists merchant_id uuid;
alter table public.bills add column if not exists paid_on date;
alter table public.bills add column if not exists payment_method text;

create table if not exists public.merchants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  name text not null, branch text, phone text, email text, website text, notes text,
  account_ref text, password_manager_url text, access_managed_by text,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists merchants_org_idx on public.merchants(org_id);
alter table public.materials add constraint materials_merchant_fk foreign key (merchant_id) references public.merchants(id) on delete set null;
alter table public.bills add constraint bills_merchant_fk foreign key (merchant_id) references public.merchants(id) on delete set null;

-- Calendar subscription links: only a hash of the token is stored; checked against membership on every fetch (server-side).
create table if not exists public.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('company','person')),
  person_id uuid references public.people(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_fetched_at timestamptz
);

alter table public.merchants enable row level security;
alter table public.calendar_feeds enable row level security;

-- Site team may read merchant names/contacts through this view; restricted
-- columns (account ref, password manager link, access owner) are owner/office only.
create policy merchants_manage on public.merchants for all to authenticated using (public.has_role(org_id, array['owner','office'])) with check (public.has_role(org_id, array['owner','office']));
create or replace view public.merchants_public with (security_invoker = false) as
  select id, org_id, name, branch, phone, email, website, notes, archived_at, created_at from public.merchants m
  where public.is_member(m.org_id);
grant select on public.merchants_public to authenticated;

create policy feeds_own on public.calendar_feeds for select to authenticated using (user_id = auth.uid());
grant select, insert, update, delete on public.merchants to authenticated;
grant select on public.calendar_feeds to authenticated;

-- My work now includes the site access note (and still nothing financial).
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
        'job', jsonb_build_object('id', j.id, 'title', j.title, 'siteAddress', coalesce(j.site_address, j.location), 'what3words', j.what3words, 'instructions', j.shared_notes, 'accessNote', j.access_note)
      ) order by mine.date, mine.start_time) from mine join public.jobs j on j.id = mine.job_id), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'dueDate', t.due_date)) from public.tasks t, me where t.org_id = target_org and t.assigned_person_id = me.id and not t.done), '[]'::jsonb),
    'materials', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'jobId', x.job_id, 'item', x.item, 'quantity', x.quantity, 'unit', x.unit, 'status', x.status)) from public.materials x where x.org_id = target_org and x.job_id in (select job_id from mine)), '[]'::jsonb)
  );
$$;
