-- ============================================================================
-- Bob — job updates, variations and customer handover reports. Additive only.
-- Local SQLite is at schema version 5 (upgrades itself on start-up).
-- Report PDFs are stored like any job file (private bucket job-files) with
-- job_files.report_id set; they are owners/admins only.
-- ============================================================================

alter table public.job_files add column if not exists update_id uuid;
alter table public.job_files add column if not exists report_id uuid;

create table if not exists public.job_updates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  note text,
  stage text check (stage in ('before','in_progress','finished')),
  author_name text not null,
  author_user_id uuid references auth.users(id) on delete set null,
  client_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists job_updates_org_job_idx on public.job_updates(org_id, job_id, created_at);
create unique index if not exists job_updates_client_ref_idx on public.job_updates(org_id, client_ref) where client_ref is not null;
alter table public.job_files add constraint job_files_update_fk foreign key (update_id) references public.job_updates(id) on delete set null;

create table if not exists public.variations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  amounts_are text not null check (amounts_are in ('inclusive','exclusive','no_vat')),
  status text not null check (status in ('proposed','approved','declined')),
  invoice_id uuid references public.invoices(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  created_by text not null
);
create index if not exists variations_org_job_idx on public.variations(org_id, job_id);

create table if not exists public.handover_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  selection jsonb not null,
  content jsonb not null,
  revision int not null default 1,       -- optimistic concurrency: a save with an older revision is refused
  ai_status text not null default 'none' check (ai_status in ('none','drafted','fallback')),
  ai_note text,
  created_by text not null, created_at timestamptz not null default now(),
  updated_by text not null, updated_at timestamptz not null default now()
);
create index if not exists handover_reports_org_job_idx on public.handover_reports(org_id, job_id);

create table if not exists public.report_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  report_id uuid not null references public.handover_reports(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  version int not null,
  file_id uuid not null references public.job_files(id),
  filename text not null,
  pages int not null,
  content jsonb not null,                -- the exact content issued in this version
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (org_id, report_id, version)
);
alter table public.job_files add constraint job_files_report_fk foreign key (report_id) references public.handover_reports(id) on delete restrict;

alter table public.job_updates enable row level security;
alter table public.variations enable row level security;
alter table public.handover_reports enable row level security;
alter table public.report_versions enable row level security;

-- Updates: members read; owner/office/staff add; owners/admins or the author edit. Crew post via the app's API.
create policy job_updates_read on public.job_updates for select to authenticated using (public.is_member(org_id));
create policy job_updates_insert on public.job_updates for insert to authenticated with check (public.is_member(org_id) and exists (select 1 from public.jobs j where j.id = job_id and j.org_id = job_updates.org_id));
create policy job_updates_update on public.job_updates for update to authenticated
  using (public.has_role(org_id, array['owner','office']) or author_user_id = auth.uid())
  with check (public.has_role(org_id, array['owner','office']) or author_user_id = auth.uid());

-- Variations, reports and versions: owners and admins only (they can show money).
create policy variations_all on public.variations for all to authenticated using (public.has_role(org_id, array['owner','office'])) with check (public.has_role(org_id, array['owner','office']));
create policy handover_reports_all on public.handover_reports for all to authenticated using (public.has_role(org_id, array['owner','office'])) with check (public.has_role(org_id, array['owner','office']));
create policy report_versions_read on public.report_versions for select to authenticated using (public.has_role(org_id, array['owner','office']));
create policy report_versions_insert on public.report_versions for insert to authenticated with check (public.has_role(org_id, array['owner','office']));

-- Report PDFs in job_files: hide them from everyone but owners/admins.
drop policy if exists job_files_read on public.job_files;
create policy job_files_read on public.job_files for select to authenticated using (public.is_member(org_id) and (report_id is null or public.has_role(org_id, array['owner','office'])));

grant select, insert, update on public.job_updates to authenticated;
grant select, insert, update, delete on public.variations to authenticated;
grant select, insert, update on public.handover_reports to authenticated;
grant select, insert on public.report_versions to authenticated;
