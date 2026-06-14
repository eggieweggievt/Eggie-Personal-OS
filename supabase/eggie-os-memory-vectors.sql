-- =====================================================================
-- Eugene semantic memory (pgvector)  ·  2026-06-14
-- Run ONCE in the Supabase SQL editor (project clpfyxlenotepuceczbh).
-- Safe to re-run: everything is IF NOT EXISTS / OR REPLACE.
--
-- Stores embeddings of Egg Jean's durable memory (facts, conversation
-- episode digests, reflected insights) so the agent can retrieve the
-- ones that MATCH a message by meaning, not just recency. Embeddings
-- come from Supabase's built-in gte-small model (384 dimensions) — no
-- external embedding vendor, no extra API key.
-- =====================================================================

create extension if not exists vector;

create table if not exists eugene_memories (
  id          bigint generated always as identity primary key,
  user_id     text not null,
  kind        text not null default 'fact',     -- 'fact' | 'episode' | 'insight' | 'journal'
  ref_id      text,                              -- source id (fact id / episode date / insight key) for upsert-dedupe
  text        text not null,
  embedding   vector(384),                       -- gte-small dimension
  created_at  timestamptz not null default now()
);

create index if not exists eugene_memories_user_idx on eugene_memories (user_id, kind);
-- one row per (user, kind, ref_id) so re-embedding an updated fact replaces it instead of duplicating
create unique index if not exists eugene_memories_ref_uidx
  on eugene_memories (user_id, kind, ref_id) where ref_id is not null;
-- cosine similarity index (HNSW = good recall, no training step)
create index if not exists eugene_memories_vec_idx
  on eugene_memories using hnsw (embedding vector_cosine_ops);

-- Lock it down: only the service role (used by the edge function) may touch it.
-- With RLS enabled and NO policies, anon/authenticated clients get nothing;
-- the service role bypasses RLS. The browser never reads this table directly.
alter table eugene_memories enable row level security;

-- Similarity search used by the agent. Returns the closest memories for a user.
create or replace function match_eugene_memories(
  query_embedding vector(384),
  match_user      text,
  match_count     int default 12
)
returns table (id bigint, kind text, text text, similarity float)
language sql stable
as $$
  select m.id, m.kind, m.text, 1 - (m.embedding <=> query_embedding) as similarity
  from eugene_memories m
  where m.user_id = match_user
    and m.embedding is not null
  order by m.embedding <=> query_embedding
  limit greatest(1, least(match_count, 50));
$$;
