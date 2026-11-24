-- Where the person left the handover workspace (1 Job details … 5 Review & finish), so they resume there.
alter table public.handover_reports add column if not exists step integer;
