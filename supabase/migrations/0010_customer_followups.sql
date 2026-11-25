-- Thank-you emails and review requests after a handover (one row per email; no "review received" — it can't be verified).
create table if not exists public.customer_followups (
  id text primary key,
  org_id uuid not null references public.organisations(id) on delete cascade,
  job_id text not null,
  report_id text not null,
  version integer,
  to_address text not null default '',
  subject text not null,
  body text not null,
  review_requested boolean not null default false,
  review_url text,
  status text not null check (status in ('draft','sent','failed')),
  sent_via text,
  approved_by text,
  approved_at timestamptz,
  sent_at timestamptz,
  error text,
  reminder_status text not null default 'none' check (reminder_status in ('none','scheduled','sent','cancelled')),
  reminder_due_at date,
  reminder_sent_at timestamptz,
  reminder_task_id text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customer_followups_job_idx on public.customer_followups (org_id, job_id);
alter table public.customer_followups enable row level security;
create policy customer_followups_managers on public.customer_followups
  using (public.has_role(org_id, array['owner','office']))
  with check (public.has_role(org_id, array['owner','office']));
