-- ════════════════════════════════════════════════════════════════════
-- Ninety3 Assistant — initial schema (NOT applied in the demo build)
-- Postgres / Supabase. Multi-tenant by organisation, RLS everywhere,
-- append-only audit log. Money stored as integer pence.
-- ════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ─── Tenancy & users ────────────────────────────────────────────────
create table organisations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create type member_role as enum ('owner', 'admin');

create table memberships (
  organisation_id uuid not null references organisations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            member_role not null,
  display_name    text not null,
  created_at      timestamptz not null default now(),
  primary key (organisation_id, user_id)
);

-- Helper used by every policy: is the current user a member of this org?
create or replace function is_member(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.organisation_id = org and m.user_id = auth.uid());
$$;

create or replace function has_role(org uuid, wanted member_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.organisation_id = org and m.user_id = auth.uid() and m.role = wanted);
$$;

-- ─── Business data ──────────────────────────────────────────────────
create type enquiry_source as enum ('email', 'instagram', 'phone');
create type enquiry_status as enum ('new', 'awaiting_reply', 'replied', 'site_visit', 'quoted', 'won', 'closed');
create type priority as enum ('high', 'medium', 'low');
create type job_status as enum ('quoted', 'awaiting_deposit', 'scheduled', 'in_progress', 'snagging', 'completed');
create type payment_type as enum ('deposit', 'stage', 'final');
create type payment_method as enum ('bank_transfer', 'card', 'cash', 'cheque');

create table customers (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 120),
  email            text,
  phone            text,
  instagram_handle text,
  created_at       timestamptz not null default now(),
  -- UK GDPR: support erasure requests without breaking financial records
  anonymised_at    timestamptz
);

create table enquiries (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  customer_id      uuid not null references customers(id),
  source           enquiry_source not null,
  external_id      text,                 -- provider message id for de-duplication
  title            text not null,
  description      text not null default '',
  location         text not null,
  status           enquiry_status not null default 'new',
  priority         priority not null default 'medium',
  suggested_reply  text,
  draft_reply      text,
  follow_up_date   date,
  last_contact_at  timestamptz,
  received_at      timestamptz not null default now(),
  job_id           uuid,
  unique (organisation_id, source, external_id)
);

create table jobs (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references organisations(id) on delete cascade,
  customer_id       uuid not null references customers(id),
  enquiry_id        uuid references enquiries(id),
  title             text not null,
  description       text not null default '',
  location          text not null,
  kind              text not null default 'general',
  quoted_pence      bigint not null check (quoted_pence >= 0),
  deposit_pence     bigint not null default 0 check (deposit_pence >= 0 and deposit_pence <= quoted_pence),
  status            job_status not null default 'quoted',
  start_date        date,
  deposit_due_date  date,
  next_action       text,
  last_chased_at    timestamptz,
  created_at        timestamptz not null default now()
);
alter table enquiries add constraint enquiries_job_fk foreign key (job_id) references jobs(id);

create table payments (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  job_id           uuid not null references jobs(id),
  amount_pence     bigint not null check (amount_pence > 0),
  type             payment_type not null,
  method           payment_method not null,
  received_on      date not null,
  reference        text,
  recorded_by      uuid not null references auth.users(id),
  recorded_at      timestamptz not null default now()
);

create table notes (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  enquiry_id       uuid references enquiries(id) on delete cascade,
  job_id           uuid references jobs(id) on delete cascade,
  body             text not null check (char_length(body) between 1 and 2000),
  author_id        uuid not null references auth.users(id),
  created_at       timestamptz not null default now(),
  check ((enquiry_id is null) <> (job_id is null))
);

create table reminders (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  title            text not null,
  due_date         date not null,
  enquiry_id       uuid references enquiries(id) on delete set null,
  job_id           uuid references jobs(id) on delete set null,
  done             boolean not null default false,
  created_by       uuid not null references auth.users(id),
  created_at       timestamptz not null default now()
);

-- Append-only audit trail: insert via server actions; no update/delete policy.
create table audit_log (
  id               bigint generated always as identity primary key,
  organisation_id  uuid not null references organisations(id) on delete cascade,
  actor_id         uuid references auth.users(id),
  action           text not null,
  entity_type      text,
  entity_id        uuid,
  summary          text not null,
  metadata         jsonb not null default '{}',
  created_at       timestamptz not null default now()
);

create index on enquiries (organisation_id, status);
create index on jobs (organisation_id, status);
create index on payments (organisation_id, job_id);
create index on reminders (organisation_id, done, due_date);
create index on audit_log (organisation_id, created_at desc);

-- ─── Row Level Security ─────────────────────────────────────────────
alter table organisations enable row level security;
alter table memberships   enable row level security;
alter table customers     enable row level security;
alter table enquiries     enable row level security;
alter table jobs          enable row level security;
alter table payments      enable row level security;
alter table notes         enable row level security;
alter table reminders     enable row level security;
alter table audit_log     enable row level security;

create policy "members read org"        on organisations for select using (is_member(id));
create policy "members read memberships" on memberships  for select using (is_member(organisation_id));

-- Members can read/write day-to-day records in their organisation
create policy "members rw customers" on customers for all using (is_member(organisation_id)) with check (is_member(organisation_id));
create policy "members rw enquiries" on enquiries for all using (is_member(organisation_id)) with check (is_member(organisation_id));
create policy "members rw jobs"      on jobs      for all using (is_member(organisation_id)) with check (is_member(organisation_id));
create policy "members rw notes"     on notes     for all using (is_member(organisation_id)) with check (is_member(organisation_id));
create policy "members rw reminders" on reminders for all using (is_member(organisation_id)) with check (is_member(organisation_id));

-- Payments: anyone in the org can record/read; only the owner can correct or delete
create policy "members read payments"   on payments for select using (is_member(organisation_id));
create policy "members insert payments" on payments for insert with check (is_member(organisation_id) and recorded_by = auth.uid());
create policy "owner update payments"   on payments for update using (has_role(organisation_id, 'owner'));
create policy "owner delete payments"   on payments for delete using (has_role(organisation_id, 'owner'));

-- Audit log: readable by members, insert-only, never updated or deleted by users
create policy "members read audit"   on audit_log for select using (is_member(organisation_id));
create policy "members insert audit" on audit_log for insert with check (is_member(organisation_id) and actor_id = auth.uid());
