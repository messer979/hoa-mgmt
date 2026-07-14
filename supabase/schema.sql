-- HOA Management — full current schema, idempotent
--
-- Run this once to bring a fresh Supabase project to the current state, or
-- re-run it any time as a sanity check. Every statement is safe to repeat:
--   - CREATE TABLE / CREATE INDEX / CREATE EXTENSION use IF NOT EXISTS
--   - ALTER TABLE ... ADD COLUMN uses IF NOT EXISTS
--   - CHECK constraints are DROPped before re-added so values can evolve
--   - storage.buckets insert uses ON CONFLICT DO NOTHING
--   - RLS enable is idempotent
--   - Backfills use ON CONFLICT DO NOTHING / WHERE-not-exists patterns
--
-- This is equivalent to applying migrations 0001..0008 in order.

create extension if not exists "pgcrypto";

-- ============================================================
-- profiles — board roster (auth identity)
-- ============================================================
create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  full_name   text,
  role        text not null default 'member' check (role in ('admin','member')),
  created_at  timestamptz not null default now()
);

-- Drop the legacy unit_number column for installs that ran 0001..0008.
alter table public.profiles drop column if exists unit_number;

alter table public.profiles enable row level security;

-- ============================================================
-- topics — discussions / votes
-- ============================================================
create table if not exists public.topics (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  status      text not null default 'open'
              check (status in ('open','closed','passed','failed')),
  created_by  uuid references public.profiles(id) on delete set null,
  closes_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists topics_status_idx on public.topics(status);

alter table public.topics enable row level security;

-- ============================================================
-- emails — inbound + outbound archive
-- ============================================================
create table if not exists public.emails (
  id                  uuid primary key default gen_random_uuid(),
  message_id          text unique,
  from_email          text not null,
  from_name           text,
  to_email            text,
  subject             text,
  body_text           text,
  body_html           text,
  topic_id            uuid references public.topics(id) on delete set null,
  matched_profile_id  uuid references public.profiles(id) on delete set null,
  processed           boolean not null default false,
  raw                 jsonb,
  received_at         timestamptz not null default now()
);
create index if not exists emails_received_idx  on public.emails(received_at desc);
create index if not exists emails_processed_idx on public.emails(processed);

-- threading + outbound flag (migration 0002)
alter table public.emails
  add column if not exists in_reply_to    text,
  add column if not exists references_ids text[],
  add column if not exists is_outbound    boolean not null default false;
create index if not exists emails_in_reply_to_idx on public.emails(in_reply_to);

-- AI analysis columns (migration 0007 + 0008)
alter table public.emails
  add column if not exists ai_summary            text,
  add column if not exists ai_suggested_vote     text,
  add column if not exists ai_suggested_topic_id uuid references public.topics(id) on delete set null,
  add column if not exists ai_confidence         numeric,
  add column if not exists ai_reasoning          text,
  add column if not exists ai_model              text,
  add column if not exists ai_processed_at       timestamptz,
  add column if not exists ai_input              jsonb;

alter table public.emails drop constraint if exists emails_ai_suggested_vote_check;
alter table public.emails add  constraint emails_ai_suggested_vote_check
  check (ai_suggested_vote is null
         or ai_suggested_vote in ('affirm','reject','abstain','none'));

alter table public.emails enable row level security;

-- ============================================================
-- votes — one per (topic, voter), supports proxy + AI sources
-- ============================================================
create table if not exists public.votes (
  id         uuid primary key default gen_random_uuid(),
  topic_id   uuid not null references public.topics(id) on delete cascade,
  voter_id   uuid not null references public.profiles(id) on delete cascade,
  choice     text not null check (choice in ('affirm','reject','abstain')),
  source     text not null default 'web',
  voted_by   uuid references public.profiles(id) on delete set null,
  email_id   uuid references public.emails(id) on delete set null,
  notes      text,
  created_at timestamptz not null default now(),
  unique (topic_id, voter_id)
);
create index if not exists votes_topic_idx on public.votes(topic_id);

-- source allowlist (migration 0007 widened it)
alter table public.votes drop constraint if exists votes_source_check;
alter table public.votes add  constraint votes_source_check
  check (source in ('web','email','admin_proxy','ai'));

alter table public.votes enable row level security;

-- ============================================================
-- topic_messages — unified conversation feed per topic
-- ============================================================
create table if not exists public.topic_messages (
  id                uuid primary key default gen_random_uuid(),
  topic_id          uuid not null references public.topics(id) on delete cascade,
  author_profile_id uuid references public.profiles(id) on delete set null,
  body_text         text not null,
  body_html         text,
  source            text not null check (source in ('email','web')),
  email_id          uuid references public.emails(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists topic_messages_topic_idx
  on public.topic_messages(topic_id, created_at);
create unique index if not exists topic_messages_email_uniq
  on public.topic_messages(email_id) where email_id is not null;

-- author attribution for parsed-from-quoted rows (migration 0003)
alter table public.topic_messages
  add column if not exists author_email text,
  add column if not exists author_name  text,
  add column if not exists extracted    boolean not null default false;

-- parsed original date for extracted rows (migration 0006)
alter table public.topic_messages
  add column if not exists original_date timestamptz;

alter table public.topic_messages enable row level security;

-- Backfill: any pre-existing email already linked to a topic becomes a
-- conversation row. ON CONFLICT against the unique (email_id) index makes
-- this safe to re-run.
insert into public.topic_messages
  (topic_id, author_profile_id, body_text, body_html, source, email_id, created_at)
select
  e.topic_id,
  e.matched_profile_id,
  coalesce(e.body_text, ''),
  e.body_html,
  'email',
  e.id,
  e.received_at
from public.emails e
where e.topic_id is not null
on conflict do nothing;

-- ============================================================
-- auth_tokens — single-use magic-link sign-in (migration 0004)
-- ============================================================
create table if not exists public.auth_tokens (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists auth_tokens_token_hash_idx on public.auth_tokens(token_hash);
create index if not exists auth_tokens_profile_idx    on public.auth_tokens(profile_id);

alter table public.auth_tokens enable row level security;

-- ============================================================
-- attachments — file metadata + private Storage bucket (migration 0005)
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('email-attachments', 'email-attachments', false, 26214400)
on conflict (id) do nothing;

create table if not exists public.attachments (
  id           uuid primary key default gen_random_uuid(),
  email_id     uuid references public.emails(id) on delete set null,
  topic_id     uuid references public.topics(id) on delete set null,
  storage_path text not null,
  filename     text not null,
  content_type text,
  size_bytes   bigint,
  received_at  timestamptz not null default now()
);
create index if not exists attachments_topic_idx    on public.attachments(topic_id);
create index if not exists attachments_email_idx    on public.attachments(email_id);
create index if not exists attachments_received_idx on public.attachments(received_at desc);

alter table public.attachments enable row level security;

-- ============================================================
-- events — calendar log (migration 0010)
-- ============================================================
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  location    text,
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists events_starts_at_idx on public.events(starts_at);

alter table public.events enable row level security;
