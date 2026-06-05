-- Stream Avatars: custom sprite upload ("bring your own sheet")
-- Run once: Supabase dashboard → SQL Editor → paste → Run
-- (separate from avatar-skins-setup.sql — run both)

-- 1. remembers which sprite each channel uses
create table if not exists avatar_config (
  channel text primary key,
  sheet_url text not null,
  frames jsonb not null,          -- {sheetW, sheetH, walk:[{x,y,w,h}...], sit:{x,y,w,h}}
  updated_at timestamptz default now()
);

alter table avatar_config enable row level security;

create policy "anon read sprite config"
  on avatar_config for select to anon using (true);
create policy "anon add sprite config"
  on avatar_config for insert to anon with check (true);
create policy "anon change sprite config"
  on avatar_config for update to anon using (true) with check (true);
create policy "anon remove sprite config"
  on avatar_config for delete to anon using (true);

-- 2. public bucket that stores the uploaded sheets
insert into storage.buckets (id, name, public)
values ('avatar-sheets', 'avatar-sheets', true)
on conflict (id) do nothing;

create policy "anon read avatar sheets"
  on storage.objects for select to anon using (bucket_id = 'avatar-sheets');
create policy "anon upload avatar sheets"
  on storage.objects for insert to anon with check (bucket_id = 'avatar-sheets');
create policy "anon replace avatar sheets"
  on storage.objects for update to anon
  using (bucket_id = 'avatar-sheets') with check (bucket_id = 'avatar-sheets');
