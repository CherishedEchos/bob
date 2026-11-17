-- RLS tests for 0002 (team, schedule, materials, bills, workers).
-- Run: psql -f supabase/tests/auth_stub.sql -f supabase/migrations/0001_bob_multitenant.sql -f supabase/migrations/0002_team_schedule.sql -f supabase/tests/rls_team_test.sql
\set ON_ERROR_STOP on

-- Fixture (superuser): one org, an owner (a), a worker (w) and another org's owner (b).
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'), ('00000000-0000-0000-0000-0000000000ff');
insert into organisations (id, slug, config) values ('10000000-0000-0000-0000-000000000001', 'ninety3', '{}'), ('20000000-0000-0000-0000-000000000002', 'ridgeway', '{}');
insert into memberships (org_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000ff', 'worker'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', 'owner');
insert into customers (id, org_id, name) values ('11111111-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Sophie Lambert');
insert into jobs (id, org_id, customer_id, title, location, kind, quoted_value, status, site_address, shared_notes) values
  ('11110000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Kitchen refit', 'Copthorne', 'kitchen', 18600, 'in_progress', '12 Mill Lane', 'Gate code 4471'),
  ('11110000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Secret job', 'Crawley', 'general', 99999, 'scheduled', null, null);
insert into people (id, org_id, name, kind, user_id) values
  ('33330000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Sam Okoro', 'subcontractor', '00000000-0000-0000-0000-0000000000ff'),
  ('33330000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Liam Carter', 'employee', null);
insert into bookings (org_id, job_id, date, start_time, end_time, person_ids, created_by) values
  ('10000000-0000-0000-0000-000000000001', '11110000-0000-0000-0000-000000000001', current_date + 1, '08:00', '16:00', array['33330000-0000-0000-0000-000000000001']::uuid[], 'test'),
  ('10000000-0000-0000-0000-000000000001', '11110000-0000-0000-0000-000000000002', current_date + 1, '08:00', '16:00', array['33330000-0000-0000-0000-000000000002']::uuid[], 'test');
insert into bills (org_id, supplier, description, amount, due_date) values ('10000000-0000-0000-0000-000000000001', 'Timber Co', 'Worktops', 1840, current_date + 3);

set role authenticated;

-- 1) The worker can't read jobs, customers, people, bookings or bills directly.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ff';
do $$ begin
  if (select count(*) from jobs) <> 0 then raise exception 'FAIL: worker reads jobs directly'; end if;
  if (select count(*) from customers) <> 0 then raise exception 'FAIL: worker reads customers'; end if;
  if (select count(*) from people) <> 0 then raise exception 'FAIL: worker reads the team'; end if;
  if (select count(*) from bookings) <> 0 then raise exception 'FAIL: worker reads the schedule'; end if;
  if (select count(*) from bills) <> 0 then raise exception 'FAIL: worker reads bills'; end if;
  raise notice 'PASS 1: worker has no direct table access';
end $$;

-- 2) my_work returns only their booking, with site details and no money.
do $$ declare w jsonb; begin
  w := public.my_work('10000000-0000-0000-0000-000000000001');
  if jsonb_array_length(w->'bookings') <> 1 then raise exception 'FAIL: worker sees % bookings', jsonb_array_length(w->'bookings'); end if;
  if w->'bookings'->0->'job'->>'title' <> 'Kitchen refit' then raise exception 'FAIL: wrong job'; end if;
  if w->'bookings'->0->'job'->>'instructions' <> 'Gate code 4471' then raise exception 'FAIL: instructions missing'; end if;
  if w::text like '%18600%' or w::text like '%99999%' or w::text like '%Secret job%' then raise exception 'FAIL: money or other jobs leaked'; end if;
  raise notice 'PASS 2: my_work is scoped to their own booking';
end $$;

-- 3) Another org's owner gets nothing from Ninety3's my_work or tables.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ declare w jsonb; begin
  w := public.my_work('10000000-0000-0000-0000-000000000001');
  if w->'person' is not null and w->>'person' <> 'null' then raise exception 'FAIL: cross-org person'; end if;
  if jsonb_array_length(w->'bookings') <> 0 then raise exception 'FAIL: cross-org bookings'; end if;
  if (select count(*) from bookings) <> 0 then raise exception 'FAIL: cross-org schedule read'; end if;
  raise notice 'PASS 3: other org sees nothing';
end $$;

-- 4) The owner reads and plans; a worker can't write bookings.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  if (select count(*) from bookings) <> 2 then raise exception 'FAIL: owner should see 2 bookings'; end if;
  if (select count(*) from bills) <> 1 then raise exception 'FAIL: owner should see bills'; end if;
  insert into bookings (org_id, job_id, date, person_ids, created_by) values ('10000000-0000-0000-0000-000000000001', '11110000-0000-0000-0000-000000000001', current_date + 2, '{}', 'owner');
  raise notice 'PASS 4: owner can plan';
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ff';
do $$ begin
  begin
    insert into bookings (org_id, job_id, date, person_ids, created_by) values ('10000000-0000-0000-0000-000000000001', '11110000-0000-0000-0000-000000000002', current_date, '{}', 'worker');
    raise exception 'FAIL: worker created a booking';
  exception when insufficient_privilege then raise notice 'PASS 5: worker cannot write the schedule';
  end;
end $$;
