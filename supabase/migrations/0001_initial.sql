-- HOA Management — initial schema
-- App auth is a shared password (see APP_PASSWORD env). The app talks to
-- Postgres exclusively via the service-role key, so RLS is enabled with no
-- policies (anon access is denied by default).

create extension if not exists "pgcrypto";

-- ---------- profiles ----------
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text,
  unit_number text,
  role text not null default 'member' check (role in ('admin','member')),
  created_at timestamptz not null default now()
);

-- ---------- topics (votes/discussions) ----------
create table if not exists public.topics (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open','closed','passed','failed')),
  created_by uuid references public.profiles(id) on delete set null,
  closes_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists topics_status_idx on public.topics(status);

-- ---------- emails (the dedicated inbox) ----------
create table if not exists public.emails (
  id uuid primary key default gen_random_uuid(),
  message_id text unique,
  from_email text not null,
  from_name  text,
  to_email   text,
  subject    text,
  body_text  text,
  body_html  text,
  topic_id   uuid references public.topics(id) on delete set null,
  matched_profile_id uuid references public.profiles(id) on delete set null,
  processed  boolean not null default false,
  raw        jsonb,
  received_at timestamptz not null default now()
);
create index if not exists emails_received_idx on public.emails(received_at desc);
create index if not exists emails_processed_idx on public.emails(processed);

-- ---------- votes ----------
-- One vote per (topic, voter). voted_by lets an admin record a proxy vote
-- on behalf of a member based on their email response.
create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete cascade,
  voter_id uuid not null references public.profiles(id) on delete cascade,
  choice   text not null check (choice in ('affirm','reject','abstain')),
  source   text not null default 'web' check (source in ('web','email','admin_proxy')),
  voted_by uuid references public.profiles(id) on delete set null,
  email_id uuid references public.emails(id) on delete set null,
  notes    text,
  created_at timestamptz not null default now(),
  unique (topic_id, voter_id)
);
create index if not exists votes_topic_idx on public.votes(topic_id);

-- ---------- RLS ----------
-- Enabled with no policies → anon/authenticated roles can do nothing.
-- The app uses the service-role key, which bypasses RLS.
alter table public.profiles enable row level security;
alter table public.topics   enable row level security;
alter table public.emails   enable row level security;
alter table public.votes    enable row level security;
