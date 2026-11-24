-- Per-workspace Claude API usage and cost (Ask Bob and AI drafting), for the
-- usage dashboard and monthly spending limits. Written by the server only.
create table if not exists public.ai_usage (
  id text primary key,
  org_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid,
  conversation_id text,
  feature text not null,
  model text not null,
  input_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  cache_write_1h_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  duration_ms integer not null default 0,
  ok boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_org_idx on public.ai_usage(org_id, created_at);

alter table public.ai_usage enable row level security;
-- Owners and admins can read their workspace's usage; nobody writes through the client.
create policy ai_usage_read on public.ai_usage for select to authenticated using (public.has_role(org_id, array['owner','office']));
