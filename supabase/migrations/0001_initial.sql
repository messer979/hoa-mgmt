-- HOA Management — initial schema
-- Run via Supabase SQL editor or `supabase db push`.

create extension if not exists "pgcrypto";

-- ---------- profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
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

-- ---------- helper: auto-create profile on signup ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- helper: is_admin() ----------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
$$;

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.topics   enable row level security;
alter table public.emails   enable row level security;
alter table public.votes    enable row level security;

-- profiles: any signed-in user can read; only self or admin can update; only admin can change role.
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select using (auth.role() = 'authenticated');

drop policy if exists "profiles update self" on public.profiles;
create policy "profiles update self" on public.profiles for update
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- topics: all signed-in users read; only admins create/update.
drop policy if exists "topics read" on public.topics;
create policy "topics read" on public.topics for select using (auth.role() = 'authenticated');

drop policy if exists "topics admin write" on public.topics;
create policy "topics admin write" on public.topics for all
  using (public.is_admin()) with check (public.is_admin());

-- votes: signed-in users read all (transparency); members vote for themselves; admins can proxy-vote.
drop policy if exists "votes read" on public.votes;
create policy "votes read" on public.votes for select using (auth.role() = 'authenticated');

drop policy if exists "votes self insert" on public.votes;
create policy "votes self insert" on public.votes for insert
  with check (
    voter_id = auth.uid() and source = 'web'
    or public.is_admin()
  );

drop policy if exists "votes self update" on public.votes;
create policy "votes self update" on public.votes for update
  using (voter_id = auth.uid() or public.is_admin())
  with check (voter_id = auth.uid() or public.is_admin());

drop policy if exists "votes admin delete" on public.votes;
create policy "votes admin delete" on public.votes for delete using (public.is_admin());

-- emails: only admins can see/manage the inbox.
drop policy if exists "emails admin all" on public.emails;
create policy "emails admin all" on public.emails for all
  using (public.is_admin()) with check (public.is_admin());
