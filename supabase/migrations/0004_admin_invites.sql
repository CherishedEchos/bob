-- ============================================================================
-- Bob — invites can grant the 'office' (Admin) role.
-- Additive: widens one CHECK constraint; no row is changed.
-- Owner invites come only from server-side provisioning; owners invite admins
-- from Team. Invites stay server-written (no client insert policy).
-- ============================================================================
alter table public.invites drop constraint if exists invites_role_check;
alter table public.invites add constraint invites_role_check check (role in ('worker','office','owner'));
