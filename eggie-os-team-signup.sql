-- ════════════════════════════════════════════════════════════════════════
--  SAKURA LIGHTWORKS — manager self-signup + approval  (Supabase → SQL Editor)
--  Project clpfyxlenotepuceczbh · Owner = eggieweggievt@gmail.com
--  Safe to re-run. Creates the table if missing, adds any missing columns,
--  and (re)sets the security so YOU see every manager who signs in.
-- ════════════════════════════════════════════════════════════════════════

-- table (create if missing) + make sure all 3 columns exist even on an older table
create table if not exists public.managers ( email text primary key );
alter table public.managers add column if not exists approved     boolean     not null default false;
alter table public.managers add column if not exists requested_at timestamptz not null default now();

alter table public.managers enable row level security;

-- reset policies cleanly
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='managers' loop
    execute format('drop policy %I on public.managers', p.policyname);
  end loop;
end $$;

-- OWNER (Eggie): see / approve / pause / delete EVERY manager row.
-- ← this is the policy that makes signups appear on your "👥 Your managers" card.
create policy managers_owner_all on public.managers
  for all to authenticated
  using      ( auth.jwt() ->> 'email' = 'eggieweggievt@gmail.com' )
  with check ( auth.jwt() ->> 'email' = 'eggieweggievt@gmail.com' );

-- a manager may register ONLY their own email…
create policy managers_insert_self on public.managers
  for insert to authenticated
  with check ( auth.jwt() ->> 'email' = email );

-- …and read ONLY their own row (to learn if they're approved)
create policy managers_read_self on public.managers
  for select to authenticated
  using ( auth.jwt() ->> 'email' = email );

-- ── after a manager signs in, this should list them (run as the owner): ──
-- select email, approved, requested_at from public.managers order by requested_at;
