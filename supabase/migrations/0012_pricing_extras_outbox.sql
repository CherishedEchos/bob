-- Ninety3 live pilot. Additive only: nothing is dropped and existing rows are kept.
-- Mirrors the SQLite columns in src/server/db/index.ts.

-- Jobs to price: a pricing record is the enquiry itself, with the site address,
-- measurements and (pilot) rough estimate, and when it was added to the list.
alter table public.enquiries add column if not exists site_address text;
alter table public.enquiries add column if not exists measurements jsonb not null default '[]'::jsonb;
alter table public.enquiries add column if not exists estimate jsonb;
alter table public.enquiries add column if not exists pricing_at timestamptz;

-- Extras (variations): a short description, an optional photo, and who recorded
-- the customer's approval or decline, when, how it reached them and a note.
alter table public.variations add column if not exists note text;
alter table public.variations add column if not exists file_id uuid;
alter table public.variations add column if not exists decided_by text;
alter table public.variations add column if not exists decided_at timestamptz;
alter table public.variations add column if not exists approval_via text check (approval_via in ('phone','email','text','in_person','written','other'));
alter table public.variations add column if not exists decision_note text;

-- System emails (team invitations): every delivery attempt and what really
-- happened. Bodies are stored with the invite link removed.
create table if not exists public.outbox (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  kind text not null,
  ref_id text,
  to_address text not null,
  subject text not null,
  body text not null,
  transport text not null,
  status text not null check (status in ('sent','failed','not_configured')),
  error text,
  provider_id text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists outbox_org_ref_idx on public.outbox(org_id, ref_id, created_at);
alter table public.outbox enable row level security;
-- Owners and admins only (it names the people invited); written by the server with the service role.
create policy outbox_read on public.outbox for select to authenticated using (public.has_role(org_id, array['owner','office']));
