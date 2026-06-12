-- =============================================================================
-- Eggie OS 🌸🔐 — TEAM LOCKDOWN v2 (Sakura manager logins) — run ONCE, on purpose
--
-- What this changes vs. eggie-os-auth-lockdown.sql:
--   • Before: ANY signed-in account could read/write ALL rows (fine when Eggie
--     was the only account). Adding manager accounts would have exposed
--     health/care/money/memory. NOT okay.
--   • After:  Eggie's account keeps everything. Other signed-in accounts
--     (managers) can ONLY touch the shared 🌸 Sakura space:
--     daily_logs rows where user_id = 'sakura'. Nothing else, no exceptions.
--   • Edge Functions use the service role and bypass RLS — briefing, reminders,
--     Discord bot, Fable's pet door all keep working unchanged.
--
-- HOW TO ADD A MANAGER (signups stay disabled — you create accounts by hand):
--   Dashboard → Authentication → Users → "Add user"
--   → their email + a password you send them · ✅ Auto Confirm User.
--   They sign in on the OS like you do — and land in 🌸 Sakura mode only.
--   To remove one later: same screen → delete the user. Instant.
--
-- ORDER: 1. push index.html build 2026-06-12.34+  2. run this file
--        3. open the OS as Eggie → Settings (or the Clients tab banner)
--           → tap "🌸 move Sakura to the team space" ONCE  4. add managers.
-- =============================================================================

-- ---- 1 · all six tables: Eggie-only by default ----
do $$
declare t text;
begin
  foreach t in array array['daily_logs','raw_captures','content_items','income_entries','sponsors','savings_goals'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_browser_all on %I', t, t);
    execute format('drop policy if exists %I_owner_all on %I', t, t);
    execute format($f$create policy %I_owner_all on %I for all to authenticated
      using ((auth.jwt()->>'email') = 'eggieweggievt@gmail.com')
      with check ((auth.jwt()->>'email') = 'eggieweggievt@gmail.com')$f$, t, t);
  end loop;
end $$;

-- ---- 2 · the shared 🌸 Sakura space: any signed-in manager may read/write it ----
drop policy if exists daily_logs_team_sakura on daily_logs;
create policy daily_logs_team_sakura on daily_logs for all to authenticated
  using (user_id = 'sakura')
  with check (user_id = 'sakura');

-- ---- 3 · storage bucket stays as-is (public read, signed-in write) ----
-- Managers can upload client avatars; nothing else in the bucket is sensitive.

-- Done. Managers now see exactly one thing: the Sakura client hub. 🌸
