-- RLS isolation tests. Run after auth_stub.sql + the migration (see docs/SETUP.md).
-- Any failed assertion raises an error.
\set ON_ERROR_STOP on

-- Fixture (as superuser, bypassing RLS)
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'), ('00000000-0000-0000-0000-00000000000c');
insert into organisations (id, slug, config) values
  ('10000000-0000-0000-0000-000000000001', 'ninety3', '{}'), ('20000000-0000-0000-0000-000000000002', 'ridgeway', '{}');
insert into memberships (org_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', 'owner'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'staff');
insert into customers (id, org_id, name) values
  ('11111111-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Sophie Lambert'),
  ('22222222-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Sophie Hart');
insert into jobs (id, org_id, customer_id, title, location, kind, quoted_value, status) values
  ('11110000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Kitchen refit', 'Copthorne', 'kitchen', 18600, 'in_progress');
insert into invoices (org_id, customer_id, job_id, draft_ref, status, lines, amounts_are, vat_rate, subtotal, vat, total, created_by) values
  ('10000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '11110000-0000-0000-0000-000000000001', 'BOB-0001', 'sent', '[]', 'no_vat', 0, 100, 0, 100, 'test');
insert into integration_tokens values ('10000000-0000-0000-0000-000000000001', 'xero', 'v1.secret', now());

set role authenticated;

-- 1) Ninety3 owner sees only Ninety3 data
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  if (select count(*) from customers) <> 1 then raise exception 'FAIL: owner A sees % customers', (select count(*) from customers); end if;
  if exists (select 1 from customers where name = 'Sophie Hart') then raise exception 'FAIL: cross-org read'; end if;
  if (select count(*) from invoices) <> 1 then raise exception 'FAIL: owner should see invoice'; end if;
  raise notice 'PASS 1: owner sees only own org';
end $$;

-- 2) Writing into another org is refused
do $$ begin
  begin
    insert into customers (org_id, name) values ('20000000-0000-0000-0000-000000000002', 'Injected');
    raise exception 'FAIL: cross-org insert allowed';
  exception when insufficient_privilege then raise notice 'PASS 2: cross-org insert blocked';
  end;
end $$;

-- 3) Updating another org's row affects nothing
do $$ declare n int; begin
  update customers set name = 'hacked' where id = '22222222-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: cross-org update'; end if;
  raise notice 'PASS 3: cross-org update affected 0 rows';
end $$;

-- 4) Moving a row to another org is refused
do $$ begin
  begin
    update customers set org_id = '20000000-0000-0000-0000-000000000002' where id = '11111111-0000-0000-0000-000000000001';
    raise exception 'FAIL: org move allowed';
  exception when insufficient_privilege then raise notice 'PASS 4: moving rows across orgs blocked';
  end;
end $$;

-- 5) Tokens are never readable by clients
do $$ begin
  begin
    perform 1 from integration_tokens;
    raise exception 'FAIL: tokens readable';
  exception when insufficient_privilege then raise notice 'PASS 5: integration tokens not readable';
  end;
end $$;

-- 6) Audit log is append-only
do $$ begin
  insert into activity (org_id, actor, via, action, summary) values ('10000000-0000-0000-0000-000000000001', 'Owner', 'dashboard', 'test', 'test');
  begin
    delete from activity;
    raise exception 'FAIL: activity deletable';
  exception when insufficient_privilege then raise notice 'PASS 6: audit log append-only';
  end;
end $$;

-- 7) Ridgeway owner sees only Ridgeway
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  if (select count(*) from customers) <> 1 or not exists (select 1 from customers where name = 'Sophie Hart') then raise exception 'FAIL: owner B view'; end if;
  if (select count(*) from invoices) <> 0 then raise exception 'FAIL: owner B sees other org invoices'; end if;
  raise notice 'PASS 7: second org isolated';
end $$;

-- 8) Staff: reads jobs, no invoices, adds a note via function, records a cost, can't change prices
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
do $$ begin
  if (select count(*) from jobs) <> 1 then raise exception 'FAIL: staff cannot see jobs'; end if;
  if (select count(*) from invoices) <> 0 then raise exception 'FAIL: staff can see invoices'; end if;
  perform add_job_note('11110000-0000-0000-0000-000000000001', 'Units fitted', 'Site team');
  insert into expenses (org_id, job_id, amount, category, description, incurred_on, recorded_by)
    values ('10000000-0000-0000-0000-000000000001', '11110000-0000-0000-0000-000000000001', 45, 'materials', 'Screws', current_date, 'Site team');
  update jobs set quoted_value = 1 where true;
  if exists (select 1 from jobs where quoted_value = 1) then raise exception 'FAIL: staff edited job price'; end if;
  raise notice 'PASS 8: staff permissions enforced';
end $$;

-- 9) No session, no data
set request.jwt.claim.sub = '';
do $$ begin
  if (select count(*) from customers) <> 0 or (select count(*) from jobs) <> 0 then raise exception 'FAIL: anonymous read'; end if;
  raise notice 'PASS 9: no session, no data';
end $$;
reset role;
