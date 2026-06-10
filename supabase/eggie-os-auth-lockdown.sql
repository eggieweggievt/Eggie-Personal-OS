-- =============================================================================
-- Eggie OS 🐙🔐 — AUTH LOCKDOWN + IMAGE STORAGE (run ONCE, on purpose)
--
-- ⚠️ ORDER MATTERS — do these BEFORE running this file, or you'll see the
--    sign-in screen without a working account:
--   1. Push the new index.html (build 2026-06-10.4+) — it ships the sign-in gate.
--   2. Supabase Dashboard → Authentication → Users → "Add user" →
--      email: eggieweggievt@gmail.com · pick a password · ✅ Auto Confirm User.
--   3. Authentication → Sign In / Providers → turn OFF "Allow new users to sign up"
--      (you are the only account — nobody else can ever make one).
--   4. THEN run this whole file in SQL Editor.
--   5. Reload the OS on each device and sign in once. Done forever per device.
--
-- What it does:
--   • Replaces the wide-open "anyone with the public key" table policies with
--     authenticated-only ones → your health/care/money data is now private.
--   • Creates the "eggie-os" storage bucket (public-READ for displaying images,
--     signed-in-only WRITE) used by the mood board + client avatars + 🚿 slim.
--   • Leaves avatar_skins (Stream Avatars) and the Edge Functions alone — they
--     use the service role / their own flow and keep working unchanged.
--
-- Undo (if you ever want the old open mode back): re-run the policy block at the
-- bottom of eggie-os-setup.sql.
-- =============================================================================

-- ---- 1 · lock the six OS tables to signed-in users only ----
do $$
declare t text;
begin
  foreach t in array array['daily_logs','raw_captures','content_items','income_entries','sponsors','savings_goals'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_browser_all on %I', t, t);   -- the old open policy
    execute format('drop policy if exists %I_owner_all on %I', t, t);     -- makes re-running safe
    execute format('create policy %I_owner_all on %I for all to authenticated using (true) with check (true)', t, t);
  end loop;
end $$;

-- ---- 2 · image bucket: public read (so <img> tags just work), signed-in write ----
insert into storage.buckets (id, name, public) values ('eggie-os','eggie-os', true)
on conflict (id) do nothing;

drop policy if exists "eggie-os public read"   on storage.objects;
drop policy if exists "eggie-os auth insert"   on storage.objects;
drop policy if exists "eggie-os auth update"   on storage.objects;
drop policy if exists "eggie-os auth delete"   on storage.objects;
create policy "eggie-os public read" on storage.objects for select using (bucket_id = 'eggie-os');
create policy "eggie-os auth insert" on storage.objects for insert to authenticated with check (bucket_id = 'eggie-os');
create policy "eggie-os auth update" on storage.objects for update to authenticated using (bucket_id = 'eggie-os');
create policy "eggie-os auth delete" on storage.objects for delete to authenticated using (bucket_id = 'eggie-os');

-- Done! Reload the OS → sign in → Settings → 💾 Data → tap "🚿 slim my data"
-- to move your existing mood-board photos + client avatars into the bucket. 🐙
