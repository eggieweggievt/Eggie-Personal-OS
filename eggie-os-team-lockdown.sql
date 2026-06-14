-- ════════════════════════════════════════════════════════════════════════
--  SAKURA LIGHTWORKS — TEAM DATA LOCKDOWN  (run in Supabase → SQL Editor)
--  Project clpfyxlenotepuceczbh · Owner = eggieweggievt@gmail.com
--
--  THE FIX for "a manager can see all my stuff."
--  Your app assumes the database refuses a manager's read of your personal
--  row — but the row-level security was still open, so it didn't. This locks
--  every table so that:
--    • YOU (the owner) can read/write everything, as always.
--    • A manager (ANY other signed-in account) can reach ONLY the shared
--      Sakura team row (user_id 'sakura') = clients + inbox. Nothing else
--      of yours — health, money, schedule, notes — is reachable by them.
--
--  ⚠️ RUN ORDER:
--    1. FIRST tap "🌸 move it" on the Clients page (migrates clients+inbox to
--       the shared row). If you skip this, managers will see NO clients.
--    2. THEN run this file.
--    3. Also run eggie-os-team-signup.sql (the managers table) if you haven't.
--  Safe to re-run. The Edge Functions use the service-role key and bypass RLS,
--  so briefings / Egg Jean / reminders keep working.
-- ════════════════════════════════════════════════════════════════════════

-- 1) wipe every existing policy on the data tables (so no old "open" rule survives)
--    and make sure RLS is enforced on each.
do $$
declare t text; p record;
begin
  for t in select unnest(array[
      'daily_logs','content_items','income_entries','sponsors','savings_goals','raw_captures'
  ]) loop
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- 2) OWNER (Eggie) — full access to all her data tables
create policy owner_all on public.daily_logs    for all to authenticated using (auth.jwt()->>'email'='eggieweggievt@gmail.com') with check (auth.jwt()->>'email'='eggieweggievt@gmail.com');
create policy owner_all on public.content_items  for all to authenticated using (auth.jwt()->>'email'='eggieweggievt@gmail.com') with check (auth.jwt()->>'email'='eggieweggievt@gmail.com');
create policy owner_all on public.income_entries for all to authenticated using (auth.jwt()->>'email'='eggieweggievt@gmail.com') with check (auth.jwt()->>'email'='eggieweggievt@gmail.com');
create policy owner_all on public.sponsors       for all to authenticated using (auth.jwt()->>'email'='eggieweggievt@gmail.com') with check (auth.jwt()->>'email'='eggieweggievt@gmail.com');
create policy owner_all on public.savings_goals  for all to authenticated using (auth.jwt()->>'email'='eggieweggievt@gmail.com') with check (auth.jwt()->>'email'='eggieweggievt@gmail.com');
create policy owner_all on public.raw_captures   for all to authenticated using (auth.jwt()->>'email'='eggieweggievt@gmail.com') with check (auth.jwt()->>'email'='eggieweggievt@gmail.com');

-- 3) MANAGERS (any other signed-in account) — ONLY the shared Sakura team row
create policy team_row on public.daily_logs for all to authenticated
  using ( user_id = 'sakura' ) with check ( user_id = 'sakura' );
-- (no team policy on the other tables → managers can't touch them at all)


-- ── verify (optional): signed in as a manager, this should return ONLY the
--    'sakura' row; signed in as you, it returns everything.
-- select user_id, log_date from public.daily_logs;
