-- RLS tests for 0005 (job files, handovers, leave).
-- Run after rls_team_test.sql in the same database (it reuses that fixture):
--   psql -f supabase/tests/auth_stub.sql -f supabase/migrations/0001…0005 -f supabase/tests/rls_team_test.sql -f supabase/tests/rls_files_test.sql
\set ON_ERROR_STOP on
reset role;

insert into job_files (id, org_id, job_id, category, filename, mime_type, bytes, group_id, visibility, uploaded_by) values
  ('44440000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '11110000-0000-0000-0000-000000000001', 'drawing', 'plan.pdf', 'application/pdf', 100, '44440000-0000-0000-0000-000000000001', 'team', 'Owner'),
  ('44440000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '11110000-0000-0000-0000-000000000001', 'other', 'costing.pdf', 'application/pdf', 100, '44440000-0000-0000-0000-000000000002', 'office', 'Owner'),
  ('44440000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '11110000-0000-0000-0000-000000000002', 'drawing', 'secret.pdf', 'application/pdf', 100, '44440000-0000-0000-0000-000000000003', 'team', 'Owner');
insert into absences (org_id, person_id, kind, start_date, end_date, status, reason, requested_by) values
  ('10000000-0000-0000-0000-000000000001', '33330000-0000-0000-0000-000000000002', 'holiday', current_date + 10, current_date + 12, 'approved', 'Private reason', 'Liam');
insert into handovers (org_id, job_id, title, job_title, items, created_by) values
  ('10000000-0000-0000-0000-000000000001', '11110000-0000-0000-0000-000000000001', 'Kitchen handover', 'Kitchen refit', '[]', 'Owner');

set role authenticated;

-- 1) A worker: no direct file/handover/leave reads; my_files gives only shared files on their booked job.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ff';
do $$ begin
  if (select count(*) from job_files) <> 0 then raise exception 'FAIL: worker reads job_files directly'; end if;
  if (select count(*) from handovers) <> 0 then raise exception 'FAIL: worker reads handovers'; end if;
  if (select count(*) from absences) <> 0 then raise exception 'FAIL: worker reads other people''s leave'; end if;
  if (select count(*) from public.my_files('10000000-0000-0000-0000-000000000001')) <> 1 then raise exception 'FAIL: my_files should return exactly the shared plan'; end if;
  if (select filename from public.my_files('10000000-0000-0000-0000-000000000001')) <> 'plan.pdf' then raise exception 'FAIL: wrong file'; end if;
  raise notice 'PASS 1: worker sees only shared files on their own job';
end $$;

-- 2) Another org's owner: nothing.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  if (select count(*) from job_files) <> 0 or (select count(*) from handovers) <> 0 or (select count(*) from absences) <> 0 then raise exception 'FAIL: cross-org read'; end if;
  if (select count(*) from public.my_files('10000000-0000-0000-0000-000000000001')) <> 0 then raise exception 'FAIL: cross-org my_files'; end if;
  begin
    insert into job_files (org_id, job_id, category, filename, mime_type, bytes, group_id, uploaded_by) values ('10000000-0000-0000-0000-000000000001', '11110000-0000-0000-0000-000000000001', 'other', 'x.pdf', 'application/pdf', 1, gen_random_uuid(), 'x');
    raise exception 'FAIL: cross-org file insert';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 2: other org sees and adds nothing';
end $$;

-- 3) The owner sees every file, the handover and the private reason.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  if (select count(*) from job_files) <> 3 then raise exception 'FAIL: owner should see 3 files'; end if;
  if (select count(*) from handovers) <> 1 then raise exception 'FAIL: owner should see the handover'; end if;
  if (select reason from absences limit 1) <> 'Private reason' then raise exception 'FAIL: owner should see the reason'; end if;
  raise notice 'PASS 3: owner sees files, handovers and leave';
end $$;
