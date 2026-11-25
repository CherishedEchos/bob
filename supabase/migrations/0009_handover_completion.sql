-- Finished handovers (published PDF), and the customer having been sent it (recorded by the person; Bob doesn't send).
alter table public.handover_reports add column if not exists completed_at timestamptz;
alter table public.handover_reports add column if not exists completed_by text;
alter table public.handover_reports add column if not exists completed_revision integer;
alter table public.handover_reports add column if not exists sent_at timestamptz;
alter table public.handover_reports add column if not exists sent_by text;
alter table public.handover_reports add column if not exists sent_version integer;
-- Which report revision (and selection) each exported PDF was made from.
alter table public.report_versions add column if not exists revision integer;
alter table public.report_versions add column if not exists selection jsonb;
