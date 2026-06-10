-- =============================================================================
-- Eggie OS 🐙 — ONE-SHOT DATABASE SETUP for the standalone dashboard (index.html)
--
-- This is everything the static app needs, in a single paste. Run it once in
-- your new Supabase project's SQL Editor. (You do NOT need the numbered
-- migrations 0001–0005 — those are for the Next.js version.)
--
-- Safe to run more than once (everything is "if not exists" / "drop if exists").
-- =============================================================================

-- ---------------------------------------------------------------------------
-- daily_logs — one row per (user, day). `notes` holds JSON for habits, goals,
-- energy, channel stats, weekly review, tax set-aside, and your habit library.
-- The sentinel date 2000-01-01 holds the things that never reset (goals, etc.).
-- ---------------------------------------------------------------------------
create table if not exists daily_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,
  log_date    date not null,
  notes       text,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (user_id, log_date)
);
create index if not exists daily_logs_user_date_idx on daily_logs (user_id, log_date desc);

-- ---------------------------------------------------------------------------
-- raw_captures — your brain-dump captures.
-- ---------------------------------------------------------------------------
create table if not exists raw_captures (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,
  source      text,
  raw_text    text,
  created_at  timestamptz not null default now()
);
create index if not exists raw_captures_user_idx on raw_captures (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- content_items — the 7-stage content pipeline (with format + pillar + brief).
-- ---------------------------------------------------------------------------
create table if not exists content_items (
  id               uuid primary key default gen_random_uuid(),
  user_id          text not null,
  title            text not null,
  format           text,            -- short | long | twitter
  platform         text,            -- youtube | tiktok | instagram | twitter | twitch | fansly
  stage            text not null default 'idea',
  pillar           text,            -- growth | retention | experimental
  hook             text,
  script           text,
  hashtags         text[] default '{}',
  thumbnail_status text default 'none',
  analyzer_score   int,
  criteria         jsonb default '{}'::jsonb,
  parent_id        uuid references content_items (id) on delete cascade,
  priority         int default 50,
  scheduled_for    date,
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists content_user_stage_idx on content_items (user_id, stage, priority desc);
create index if not exists content_parent_idx on content_items (parent_id);

-- ---------------------------------------------------------------------------
-- income_entries — money in/out ledger (kind = 'in' income, 'out' expense).
-- ---------------------------------------------------------------------------
create table if not exists income_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null,
  kind       text not null default 'in',   -- 'in' | 'out'
  source     text not null,                -- income source OR expense category
  category   text,                         -- expense category when kind='out'
  amount     numeric not null,
  month      date not null,                -- first day of the month it belongs to
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists income_user_month_idx on income_entries (user_id, month desc);

-- ---------------------------------------------------------------------------
-- sponsors — pitch pipeline (draft → sent → responded → signed → passed).
-- ---------------------------------------------------------------------------
create table if not exists sponsors (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null,
  brand      text not null,
  deal_type  text,
  stage      text not null default 'draft',
  value      numeric,
  note       text,
  contact    text,            -- name · email · @handle
  links      text,            -- brief / contract / campaign page
  follow_up  date,            -- powers the 💬 follow-up nudge pills
  updated_at timestamptz not null default now()
);
create index if not exists sponsors_user_stage_idx on sponsors (user_id, stage);
-- added later than the original table — idempotent for existing databases:
alter table sponsors add column if not exists contact   text;
alter table sponsors add column if not exists links     text;
alter table sponsors add column if not exists follow_up date;

-- ---------------------------------------------------------------------------
-- savings_goals — sinking funds you allot money toward.
-- ---------------------------------------------------------------------------
create table if not exists savings_goals (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null,
  name       text not null,
  emoji      text,
  target     numeric not null default 0,
  saved      numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists savings_user_idx on savings_goals (user_id);

-- ---------------------------------------------------------------------------
-- Row Level Security + browser (anon key) access policies.
--
-- ⚠ The static page talks to Supabase with your PUBLIC anon key (visible in the
-- page source). These policies let anyone with your project URL + anon key read
-- and write these tables. That's the normal trade-off for a personal, single-
-- user static dashboard.
-- 🔐 To make it private (recommended once health data lives here): follow the
-- steps in eggie-os-auth-lockdown.sql — it replaces these open policies with
-- signed-in-only ones, and the app shows a one-time sign-in instead.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['daily_logs','raw_captures','content_items','income_entries','sponsors','savings_goals'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_browser_all on %I', t, t);
    execute format('create policy %I_browser_all on %I for all to anon, authenticated using (true) with check (true)', t, t);
  end loop;
end $$;

-- Done! Grab your Project URL + anon key from Settings → API and paste them into
-- the CONFIG block at the top of index.html. 🐙
