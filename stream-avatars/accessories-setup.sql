-- Stream Avatars: gear / accessories (modeled on Stream Avatars gear sets)
-- Run once: Supabase dashboard → SQL Editor → paste → Run
-- (run AFTER avatar-skins-setup.sql)

-- per-viewer equipped gear: {"hats":"tophat", "capes":"red"}
alter table avatar_skins add column if not exists gear jsonb;
