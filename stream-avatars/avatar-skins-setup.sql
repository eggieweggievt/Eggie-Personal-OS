-- Stream Avatars: skin persistence table (Tier 1)
-- Run this once: Supabase dashboard → SQL Editor → paste → Run

create table if not exists avatar_skins (
  twitch_user_id text primary key,
  skin text not null,
  updated_at timestamptz default now()
);

alter table avatar_skins enable row level security;

-- the overlay + picker use the public (publishable) key:
create policy "anon can read skins"
  on avatar_skins for select to anon using (true);

create policy "anon can add skins"
  on avatar_skins for insert to anon with check (true);

create policy "anon can change skins"
  on avatar_skins for update to anon using (true) with check (true);

-- NOTE: these open policies let !skin in chat work with zero setup.
-- Once the avatar-skin edge function is deployed and you want it
-- locked down, drop the insert/update policies — the function uses
-- the service role and keeps working:
--   drop policy "anon can add skins" on avatar_skins;
--   drop policy "anon can change skins" on avatar_skins;
