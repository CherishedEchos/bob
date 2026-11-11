-- =============================================================================
-- Bob — multi-tenant schema for Supabase (Postgres) with row-level security.
--
-- Mirrors the local SQLite schema in src/server/db/index.ts. Every business
-- row carries org_id; RLS restricts every read and write to members of that
-- organisation, by role. The app server talks to Supabase with the signed-in
-- user's JWT (never the service role) so these policies apply to all app
-- traffic. The service role is used only by background jobs (inbox sync,
-- token refresh) and touches integration_tokens, which no client can read.
--
-- Roles: owner (everything) · office (admin + money) · staff (site team:
-- jobs/customers read, tasks, costs, notes via function; no financial records).
--
-- Tested locally against PostgreSQL 16 with a stub auth schema
-- (supabase/tests/rls_test.sql). Not yet applied to a live Supabase project.
-- =============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Organisations & membership
-- ----------------------------------------------------------------------------
create table public.organisations (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  config      jsonb not null,               -- OrgConfig (branding, services, finance, assistant…)
  created_at  timestamptz not null default now()
);

create table public.memberships (
  org_id      uuid not null references public.organisations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('owner','office','staff')),
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on public.memberships(user_id);

-- Helper functions (SECURITY DEFINER so policies don't recurse through RLS).
create or replace function public.is_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m where m.org_id = target_org and m.user_id = auth.uid());
$$;

create or replace function public.has_role(target_org uuid, roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m where m.org_id = target_org and m.user_id = auth.uid() and m.role = any(roles));
$$;

revoke all on function public.is_member(uuid) from public;
revoke all on function public.has_role(uuid, text[]) from public;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.has_role(uuid, text[]) to authenticated;

-- ----------------------------------------------------------------------------
-- Business records
-- ----------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  name text not null, email text, phone text, instagram_handle text, address text, town text,
  notes jsonb not null default '[]', created_at timestamptz not null default now()
);

create table public.enquiries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null, email text, phone text, instagram_handle text,
  source text not null check (source in ('email','website','instagram','phone','manual')),
  provider text, external_thread_id text,
  title text not null, description text not null default '', location text not null,
  received_at timestamptz not null default now(),
  status text not null check (status in ('new','awaiting_reply','replied','quote_required','quoted','won','lost')),
  priority text not null check (priority in ('high','medium','low')),
  assigned_user_id uuid references auth.users(id) on delete set null,
  follow_up_date date, last_contact_at timestamptz, job_id uuid,
  notes jsonb not null default '[]', messages jsonb not null default '[]',
  draft_reply text, suggested_reply text not null default ''
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  title text not null, description text not null default '', location text not null, kind text not null,
  quoted_value numeric(12,2) not null check (quoted_value >= 0),
  deposit_required numeric(12,2) not null default 0 check (deposit_required >= 0),
  status text not null check (status in ('quoted','awaiting_deposit','scheduled','in_progress','snagging','completed','lost')),
  start_date date, deposit_due_date date, next_action text,
  notes jsonb not null default '[]', enquiry_id uuid references public.enquiries(id) on delete set null,
  last_chased_at timestamptz, created_at timestamptz not null default now(),
  check (deposit_required <= quoted_value)
);
alter table public.enquiries add constraint enquiries_job_fk foreign key (job_id) references public.jobs(id) on delete set null;

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  enquiry_id uuid references public.enquiries(id) on delete set null,
  description text not null, amount numeric(12,2) not null check (amount > 0),
  status text not null check (status in ('draft','sent','accepted','declined')),
  sent_at timestamptz, responded_at timestamptz, follow_up_date date, created_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  job_id uuid references public.jobs(id) on delete restrict,
  draft_ref text not null,            -- Bob's internal reference, NOT an invoice number
  number text,                        -- only ever set from the accounting provider
  status text not null check (status in ('draft','sent','paid','void')),
  lines jsonb not null,
  amounts_are text not null check (amounts_are in ('inclusive','exclusive','no_vat')),
  vat_rate numeric(5,2) not null, subtotal numeric(12,2) not null, vat numeric(12,2) not null, total numeric(12,2) not null,
  issue_date date, due_date date, amount_paid numeric(12,2) not null default 0,
  provider text, external_id text, sent_at timestamptz, paid_at timestamptz, last_synced_at timestamptz,
  created_at timestamptz not null default now(), created_by text not null,
  unique (org_id, draft_ref),
  unique (org_id, provider, external_id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete restrict,
  invoice_id uuid references public.invoices(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  type text not null check (type in ('deposit','stage','final')),
  method text not null check (method in ('bank_transfer','card','cash','cheque')),
  received_at date not null, reference text, recorded_by text not null, recorded_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  category text not null check (category in ('materials','labour','plant_hire','subcontractor','waste','other')),
  description text not null, incurred_on date not null, recorded_by text not null, created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  title text not null, due_date date not null, done boolean not null default false,
  customer_id uuid references public.customers(id) on delete set null,
  related_type text check (related_type in ('enquiry','job','invoice','customer')), related_id uuid,
  assigned_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), created_by text not null, completed_at timestamptz
);

-- Append-only audit log.
create table public.activity (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  at timestamptz not null default now(), actor text not null,
  via text not null check (via in ('dashboard','bob','system','integration')),
  action text not null, summary text not null, entity_type text, entity_id uuid
);

-- ----------------------------------------------------------------------------
-- Bob: conversations, approvals, integrations
-- ----------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  state jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant')), payload jsonb not null, created_at timestamptz not null default now()
);

create table public.bob_actions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  origin text not null check (origin in ('bob','dashboard')),
  tool text not null, category text not null check (category in ('read','internal','external')),
  args jsonb not null, view jsonb not null,
  status text not null check (status in ('pending','executing','executed','failed','cancelled','expired','undone')),
  idempotency_key text not null, payload_hash text not null,
  result jsonb, error text, undo jsonb,
  created_at timestamptz not null default now(), decided_at timestamptz, executed_at timestamptz, expires_at timestamptz not null,
  unique (org_id, idempotency_key)
);
create index bob_actions_hash_idx on public.bob_actions(org_id, payload_hash, created_at);

-- Connection status is readable by members; tokens live in a separate table.
create table public.connections (
  org_id uuid not null references public.organisations(id) on delete cascade,
  provider text not null, kind text not null check (kind in ('email','accounting')),
  status text not null, account_label text, last_sync_at timestamptz, error text,
  primary key (org_id, provider)
);

-- Encrypted OAuth tokens (AES-256-GCM, encrypted by the app). No client policies: service role only.
create table public.integration_tokens (
  org_id uuid not null references public.organisations(id) on delete cascade,
  provider text not null,
  token_enc text not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, provider)
);

create table public.imported_messages (
  org_id uuid not null references public.organisations(id) on delete cascade,
  provider text not null, external_id text not null, enquiry_id uuid, imported_at timestamptz not null default now(),
  primary key (org_id, provider, external_id)
);

-- Indexes for org-scoped access and reporting.
create index customers_org_idx on public.customers(org_id);
create index enquiries_org_received_idx on public.enquiries(org_id, received_at desc);
create index jobs_org_idx on public.jobs(org_id);
create index quotes_org_sent_idx on public.quotes(org_id, sent_at);
create index invoices_org_idx on public.invoices(org_id, status);
create index payments_org_idx on public.payments(org_id, job_id);
create index expenses_org_idx on public.expenses(org_id, job_id);
create index tasks_org_due_idx on public.tasks(org_id, due_date);
create index activity_org_at_idx on public.activity(org_id, at desc);
create index conversations_user_idx on public.conversations(org_id, user_id, updated_at desc);

-- ----------------------------------------------------------------------------
-- Row-level security
-- ----------------------------------------------------------------------------
alter table public.organisations         enable row level security;
alter table public.memberships           enable row level security;
alter table public.customers             enable row level security;
alter table public.enquiries             enable row level security;
alter table public.jobs                  enable row level security;
alter table public.quotes                enable row level security;
alter table public.invoices              enable row level security;
alter table public.payments              enable row level security;
alter table public.expenses              enable row level security;
alter table public.tasks                 enable row level security;
alter table public.activity              enable row level security;
alter table public.conversations         enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.bob_actions           enable row level security;
alter table public.connections           enable row level security;
alter table public.integration_tokens    enable row level security;
alter table public.imported_messages     enable row level security;

-- Organisations: members read; owners update config.
create policy org_read on public.organisations for select to authenticated using (public.is_member(id));
create policy org_update on public.organisations for update to authenticated using (public.has_role(id, array['owner'])) with check (public.has_role(id, array['owner']));

-- Memberships: see your own org's members; only owners manage them.
create policy member_read on public.memberships for select to authenticated using (public.is_member(org_id));
create policy member_write on public.memberships for all to authenticated using (public.has_role(org_id, array['owner'])) with check (public.has_role(org_id, array['owner']));

-- Records everyone in the org can read; office/owner write.
create policy customers_read on public.customers for select to authenticated using (public.is_member(org_id));
create policy customers_write on public.customers for all to authenticated using (public.has_role(org_id, array['owner','office'])) with check (public.has_role(org_id, array['owner','office']));

create policy enquiries_read on public.enquiries for select to authenticated using (public.is_member(org_id));
create policy enquiries_write on public.enquiries for all to authenticated using (public.has_role(org_id, array['owner','office'])) with check (public.has_role(org_id, array['owner','office']));

create policy jobs_read on public.jobs for select to authenticated using (public.is_member(org_id));
create policy jobs_write on public.jobs for all to authenticated using (public.has_role(org_id, array['owner','office'])) with check (public.has_role(org_id, array['owner','office']));

-- Financial records: owner/office only (staff can't even read them).
create policy quotes_all on public.quotes for all to authenticated using (public.has_role(org_id, array['owner','office'])) with check (public.has_role(org_id, array['owner','office']));
create policy invoices_all on public.invoices for all to authenticated using (public.has_role(org_id, array['owner','office'])) with check (public.has_role(org_id, array['owner','office']));
create policy payments_all on public.payments for all to authenticated using (public.has_role(org_id, array['owner','office'])) with check (public.has_role(org_id, array['owner','office']));

-- Costs: any member may record; owner/office read and manage.
create policy expenses_insert on public.expenses for insert to authenticated with check (public.is_member(org_id) and exists (select 1 from public.jobs j where j.id = job_id and j.org_id = expenses.org_id));
create policy expenses_read on public.expenses for select to authenticated using (public.has_role(org_id, array['owner','office']));
create policy expenses_manage on public.expenses for delete to authenticated using (public.has_role(org_id, array['owner','office']));

-- Tasks: any member.
create policy tasks_all on public.tasks for all to authenticated using (public.is_member(org_id)) with check (public.is_member(org_id));

-- Audit log: members append; owner/office read; nobody updates or deletes.
create policy activity_insert on public.activity for insert to authenticated with check (public.is_member(org_id));
create policy activity_read on public.activity for select to authenticated using (public.has_role(org_id, array['owner','office']));

-- Conversations and Bob actions: private to the user, within their org.
create policy conv_own on public.conversations for all to authenticated using (user_id = auth.uid() and public.is_member(org_id)) with check (user_id = auth.uid() and public.is_member(org_id));
create policy convmsg_own on public.conversation_messages for all to authenticated
  using (public.is_member(org_id) and exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()))
  with check (public.is_member(org_id) and exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid() and c.org_id = conversation_messages.org_id));
create policy actions_read on public.bob_actions for select to authenticated using (public.is_member(org_id));
create policy actions_insert on public.bob_actions for insert to authenticated with check (user_id = auth.uid() and public.is_member(org_id));
create policy actions_update on public.bob_actions for update to authenticated using (public.is_member(org_id)) with check (public.is_member(org_id));

-- Integrations: status readable by members, managed by owners. Tokens: no policies (deny all to clients).
create policy conn_read on public.connections for select to authenticated using (public.is_member(org_id));
create policy conn_manage on public.connections for all to authenticated using (public.has_role(org_id, array['owner'])) with check (public.has_role(org_id, array['owner']));
create policy imported_rw on public.imported_messages for all to authenticated using (public.has_role(org_id, array['owner','office'])) with check (public.has_role(org_id, array['owner','office']));

-- Site staff can add notes to jobs without general write access.
create or replace function public.add_job_note(p_job uuid, p_text text, p_author text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if length(trim(p_text)) = 0 or length(p_text) > 2000 then raise exception 'invalid note'; end if;
  update public.jobs j
     set notes = jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'text', p_text, 'createdAt', now(), 'author', p_author)) || j.notes
   where j.id = p_job and public.is_member(j.org_id);
  if not found then raise exception 'job not found'; end if;
end $$;
revoke all on function public.add_job_note(uuid, text, text) from public;
grant execute on function public.add_job_note(uuid, text, text) to authenticated;

-- Atomic approval claim (pending → executing), used by the action engine.
create or replace function public.claim_bob_action(p_id uuid)
returns boolean language sql security invoker as $$
  update public.bob_actions set status = 'executing', decided_at = now()
   where id = p_id and status = 'pending' and expires_at > now()
  returning true;
$$;

-- Grants (Supabase grants table privileges to authenticated by default; RLS does the filtering).
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on public.integration_tokens from authenticated;
revoke update, delete on public.activity from authenticated;
