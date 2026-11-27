-- Jobs: an optional expected finish date (start date already exists).
alter table public.jobs add column if not exists end_date date;

-- Customers: domestic or commercial (left null until someone classifies them —
-- existing customers are never guessed), the main contact at a company and
-- any other contacts.
alter table public.customers add column if not exists kind text check (kind in ('domestic', 'commercial'));
alter table public.customers add column if not exists contact_name text;
alter table public.customers add column if not exists contacts jsonb not null default '[]'::jsonb;
