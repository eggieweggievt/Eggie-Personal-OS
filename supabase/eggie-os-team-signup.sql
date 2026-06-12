-- =============================================================================
-- Eggie OS 🌸 — MANAGER SELF-SIGNUP + APPROVALS (run ONCE, after eggie-os-team-lockdown.sql)
--
-- Flow: a manager taps "request an account" on the sign-in page → confirms their
-- email → signs in → lands in a waiting room. You approve them on the Clients
-- tab (👥 Your managers card) and the 🌸 hub opens for them. Pause or remove
-- any time. They can never see anything but the shared Sakura space.
--
-- ⚠️ ONE DASHBOARD SWITCH (required for self-signup):
--   Authentication → Sign In / Providers → turn ON "Allow new users to sign up".
--   (Leave email confirmations ON — it stops typos and squatters.)
--   Random strangers who sign up get NOTHING: every byte is behind approval.
-- =============================================================================

-- ---- 1 · the managers list (who asked, who's approved) ----
create table if not exists managers (
  email text primary key,
  approved boolean not null default false,
  requested_at timestamptz default now()
);
alter table managers enable row level security;

-- a signed-in person may register THEIR OWN email, always unapproved
drop policy if exists managers_self_insert on managers;
create policy managers_self_insert on managers for insert to authenticated
  with check (email = lower(auth.jwt()->>'email') and approved = false);

-- they may read their own row (to see their waiting status); Eggie reads all
drop policy if exists managers_self_read on managers;
create policy managers_self_read on managers for select to authenticated
  using (email = lower(auth.jwt()->>'email') or (auth.jwt()->>'email') = 'eggieweggievt@gmail.com');

-- only Eggie may approve / pause / remove
drop policy if exists managers_owner_write on managers;
create policy managers_owner_write on managers for update to authenticated
  using ((auth.jwt()->>'email') = 'eggieweggievt@gmail.com')
  with check ((auth.jwt()->>'email') = 'eggieweggievt@gmail.com');
drop policy if exists managers_owner_delete on managers;
create policy managers_owner_delete on managers for delete to authenticated
  using ((auth.jwt()->>'email') = 'eggieweggievt@gmail.com');

-- ---- 2 · the Sakura space now requires APPROVAL, not just a login ----
drop policy if exists daily_logs_team_sakura on daily_logs;
create policy daily_logs_team_sakura on daily_logs for all to authenticated
  using (user_id = 'sakura' and exists (select 1 from managers m where m.email = lower(auth.jwt()->>'email') and m.approved))
  with check (user_id = 'sakura' and exists (select 1 from managers m where m.email = lower(auth.jwt()->>'email') and m.approved));

-- Done: signups open · everything stays locked until you tap ✓ approve. 🌸
