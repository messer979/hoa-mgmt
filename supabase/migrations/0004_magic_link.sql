-- HOA Management — magic-link email auth
-- Tokens are single-use, expire after 30 minutes by default, and stored
-- hashed (sha256) so a DB read can't yield a usable token.

create table if not exists public.auth_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists auth_tokens_token_hash_idx on public.auth_tokens(token_hash);
create index if not exists auth_tokens_profile_idx    on public.auth_tokens(profile_id);

alter table public.auth_tokens enable row level security;
