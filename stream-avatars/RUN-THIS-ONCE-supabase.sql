-- ============================================================
--  Chat Buddies — ALL database setup in one go 🐙
--  Where: supabase.com dashboard → your project → SQL Editor
--         → paste this whole file → click RUN
--  Safe to run more than once.
-- ============================================================

-- 1. viewer skins + gear (what each chatter picked)
create table if not exists avatar_skins (
  twitch_user_id text primary key,
  skin text,
  updated_at timestamptz default now()
);
alter table avatar_skins add column if not exists hat text;
alter table avatar_skins add column if not exists gear jsonb;

alter table avatar_skins enable row level security;

drop policy if exists "anon can read skins" on avatar_skins;
create policy "anon can read skins"
  on avatar_skins for select to anon using (true);
drop policy if exists "anon can add skins" on avatar_skins;
create policy "anon can add skins"
  on avatar_skins for insert to anon with check (true);
drop policy if exists "anon can change skins" on avatar_skins;
create policy "anon can change skins"
  on avatar_skins for update to anon using (true) with check (true);

-- 2. per-channel config (custom sprites, role sprites, gear sets, role gear)
create table if not exists avatar_config (
  channel text primary key,
  sheet_url text not null,
  frames jsonb not null,
  updated_at timestamptz default now()
);
alter table avatar_config enable row level security;

drop policy if exists "anon read sprite config" on avatar_config;
create policy "anon read sprite config"
  on avatar_config for select to anon using (true);
drop policy if exists "anon add sprite config" on avatar_config;
create policy "anon add sprite config"
  on avatar_config for insert to anon with check (true);
drop policy if exists "anon change sprite config" on avatar_config;
create policy "anon change sprite config"
  on avatar_config for update to anon using (true) with check (true);
drop policy if exists "anon remove sprite config" on avatar_config;
create policy "anon remove sprite config"
  on avatar_config for delete to anon using (true);

-- 3. storage bucket for uploaded sprite sheets + gear images
insert into storage.buckets (id, name, public)
values ('avatar-sheets', 'avatar-sheets', true)
on conflict (id) do nothing;

drop policy if exists "anon read avatar sheets" on storage.objects;
create policy "anon read avatar sheets"
  on storage.objects for select to anon using (bucket_id = 'avatar-sheets');
drop policy if exists "anon upload avatar sheets" on storage.objects;
create policy "anon upload avatar sheets"
  on storage.objects for insert to anon with check (bucket_id = 'avatar-sheets');
drop policy if exists "anon replace avatar sheets" on storage.objects;
create policy "anon replace avatar sheets"
  on storage.objects for update to anon
  using (bucket_id = 'avatar-sheets') with check (bucket_id = 'avatar-sheets');

-- done! 🎉  the setup page's saves will work now.
