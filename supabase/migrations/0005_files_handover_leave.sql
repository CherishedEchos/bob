-- ============================================================================
-- Bob — job files & photos (with drawing revisions), customer handovers,
-- leave & availability, and the "Site visit" enquiry stage. Additive only:
-- no existing rows are changed or removed.
--
-- File bytes: the local SQLite build keeps them in `file_blobs`. On Supabase,
-- store them in a PRIVATE Storage bucket named `job-files`, at
-- <org_id>/<file_id>/original and <org_id>/<file_id>/thumb, and serve them
-- only through the app's /api/files route (which checks the same rules as the
-- policies below). Never make the bucket public.
-- ============================================================================

-- Enquiry stages: add "site_visit" between replied and quote_required.
alter table public.enquiries drop constraint if exists enquiries_status_check;
alter table public.enquiries add constraint enquiries_status_check
  check (status in ('new','awaiting_reply','replied','site_visit','quote_required','quoted','won','lost'));

create table if not exists public.job_files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  enquiry_id uuid references public.enquiries(id) on delete set null,
  category text not null check (category in ('drawing','progress','completion','other')),
  title text, filename text not null, mime_type text not null, bytes bigint not null check (bytes > 0),
  description text, revision text,
  group_id uuid not null,
  visibility text not null default 'team' check (visibility in ('team','office')),
  previewable boolean not null default false,
  has_thumb boolean not null default false,
  width int, height int,
  uploaded_by text not null, uploaded_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz, deleted_by text,
  checksum text,
  client_ref text,
  storage_path text,
  check (job_id is not null or enquiry_id is not null)
);
create index if not exists job_files_org_job_idx on public.job_files(org_id, job_id);
create unique index if not exists job_files_client_ref_idx on public.job_files(org_id, client_ref) where client_ref is not null;

create table if not exists public.handovers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  title text not null, job_title text not null, site_address text, completion_date date, message text,
  items jsonb not null,            -- frozen list: file id, path in the ZIP, title, category, description, revision, size
  created_at timestamptz not null default now(),
  created_by text not null,
  downloads int not null default 0
);
create index if not exists handovers_org_job_idx on public.handovers(org_id, job_id);

create table if not exists public.absences (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  kind text not null check (kind in ('holiday','unavailable','sick','other')),
  start_date date not null, end_date date not null check (end_date >= start_date),
  part text check (part in ('am','pm')),
  status text not null check (status in ('pending','approved','declined','cancelled')),
  reason text,                     -- private: requester and owners/admins only (see absences_public)
  requested_by text not null, requested_by_user_id uuid references auth.users(id) on delete set null,
  decided_by text, decided_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (part is null or start_date = end_date)
);
create index if not exists absences_org_person_idx on public.absences(org_id, person_id, start_date);

alter table public.job_files enable row level security;
alter table public.handovers enable row level security;
alter table public.absences enable row level security;

-- Files: members (owner/office/staff) read all; owner/office/staff add; owners/admins or the uploader edit/delete.
create policy job_files_read on public.job_files for select to authenticated using (public.is_member(org_id));
create policy job_files_insert on public.job_files for insert to authenticated with check (
  public.is_member(org_id)
  and (job_id is null or exists (select 1 from public.jobs j where j.id = job_id and j.org_id = job_files.org_id))
  and (enquiry_id is null or exists (select 1 from public.enquiries e where e.id = enquiry_id and e.org_id = job_files.org_id))
);
create policy job_files_update on public.job_files for update to authenticated
  using (public.has_role(org_id, array['owner','office']) or uploaded_by_user_id = auth.uid())
  with check (public.has_role(org_id, array['owner','office']) or uploaded_by_user_id = auth.uid());

-- Handovers: owners and admins only.
create policy handovers_all on public.handovers for all to authenticated
  using (public.has_role(org_id, array['owner','office'])) with check (public.has_role(org_id, array['owner','office']));

-- Leave: owners/admins manage everything; the site team sees dates without reasons via absences_public.
create policy absences_manage on public.absences for all to authenticated
  using (public.has_role(org_id, array['owner','office'])) with check (public.has_role(org_id, array['owner','office']));
create policy absences_own on public.absences for select to authenticated
  using (exists (select 1 from public.people p where p.id = person_id and p.org_id = absences.org_id and p.user_id = auth.uid()));
create or replace view public.absences_public with (security_invoker = false) as
  select id, org_id, person_id, kind, start_date, end_date, part, status, requested_by, decided_by, decided_at, created_at
  from public.absences a where public.is_member(a.org_id) and a.status in ('pending','approved');
grant select on public.absences_public to authenticated;

grant select, insert, update on public.job_files to authenticated;
grant select, insert, update on public.handovers to authenticated;
grant select, insert, update on public.absences to authenticated;

-- Invited workers (My work) reach files and their own leave only through these
-- functions: team-visible files on jobs they're booked on (within a week of the
-- booking ending), and their own absences.
create or replace function public.my_files(target_org uuid)
returns setof public.job_files language sql stable security definer set search_path = public as $$
  select f.* from public.job_files f
  where f.org_id = target_org and f.deleted_at is null and f.visibility = 'team'
    and exists (
      select 1 from public.bookings b join public.people p on p.org_id = b.org_id and p.user_id = auth.uid() and p.archived_at is null
      where b.org_id = target_org and b.job_id = f.job_id and p.id = any(b.person_ids)
        and coalesce(b.end_date, b.date) >= current_date - 7
    )
    and exists (select 1 from public.memberships m where m.org_id = target_org and m.user_id = auth.uid());
$$;
grant execute on function public.my_files(uuid) to authenticated;
