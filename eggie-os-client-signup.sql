-- ════════════════════════════════════════════════════════════════════════
--  SAKURA LIGHTWORKS — CLIENT (talent) self-signup + approval, VIEW-ONLY
--  Run in Supabase → SQL Editor (project clpfyxlenotepuceczbh).
--  Owner = eggieweggievt@gmail.com. Safe to re-run.
--
--  A "client account" is a talent you represent who signs in to see ONLY
--  their own page, read-only. This sets up:
--    • client_accounts table (email · which talent · approved)
--    • RLS so YOU see every client signup, and a client can read only their
--      own row (to learn if they're approved). Clients NEVER read your data
--      directly — their page is served by the JWT-checked clientView function.
--    • talent_roster(): a tiny function the public sign-up page calls to fill
--      the "which talent are you?" dropdown (returns ONLY id + display name).
--
--  Run AFTER eggie-os-team-lockdown.sql (so the clients live on the shared row).
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.client_accounts ( email text primary key );
alter table public.client_accounts add column if not exists client_id    text;
alter table public.client_accounts add column if not exists talent_name  text;
alter table public.client_accounts add column if not exists approved     boolean     not null default false;
alter table public.client_accounts add column if not exists requested_at timestamptz not null default now();

alter table public.client_accounts enable row level security;

do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='client_accounts' loop
    execute format('drop policy %I on public.client_accounts', p.policyname);
  end loop;
end $$;

-- OWNER (Eggie): see / approve / pause / delete EVERY client signup
create policy client_accounts_owner on public.client_accounts
  for all to authenticated
  using      ( auth.jwt() ->> 'email' = 'eggieweggievt@gmail.com' )
  with check ( auth.jwt() ->> 'email' = 'eggieweggievt@gmail.com' );

-- a client may register ONLY their own email…
create policy client_accounts_insert_self on public.client_accounts
  for insert to authenticated
  with check ( auth.jwt() ->> 'email' = email );

-- …and read ONLY their own row (to learn if they're approved)
create policy client_accounts_read_self on public.client_accounts
  for select to authenticated
  using ( auth.jwt() ->> 'email' = email );


-- ── talent_roster(): id + name only, for the sign-up dropdown (no client data) ──
create or replace function public.talent_roster()
returns table (id text, name text)
language sql
security definer
set search_path = public
as $$
  select c->>'id' as id, c->>'name' as name
  from public.daily_logs,
       lateral jsonb_array_elements( (notes::jsonb) -> 'clients' ) as c
  where user_id = 'sakura' and log_date = '2000-01-01'
    and (notes::jsonb) ? 'clients'
  order by 2;
$$;
grant execute on function public.talent_roster() to anon, authenticated;
