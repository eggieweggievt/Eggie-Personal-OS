-- ============================================================
--  Chat Buddies — LOCK DOWN viewer saves 🔒
--  Run this ONLY after the picker page works (Twitch Client ID set
--  + avatar-skin edge function deployed). See README "Lock it down".
--
--  After this, the ONLY way to save a viewer's gear is the picker page,
--  which verifies their Twitch sign-in — so nobody can edit anyone
--  else's avatar. Chat gear commands still work live on screen (and are
--  remembered on the streamer's PC for the session), they just stop
--  writing to the shared database.
--
--  Where: supabase.com → your project → SQL Editor → paste → Run
-- ============================================================

-- viewers can still be READ by the overlay…
-- …but no more anonymous WRITES (the edge function uses the service
--   role, which bypasses these policies, so the picker keeps working).
drop policy if exists "anon can add skins"    on avatar_skins;
drop policy if exists "anon can change skins" on avatar_skins;

-- (leave "anon can read skins" in place — the overlay needs to read.)

-- To UNDO and go back to open mode, re-run these:
--   create policy "anon can add skins"    on avatar_skins for insert to anon with check (true);
--   create policy "anon can change skins" on avatar_skins for update to anon using (true) with check (true);
