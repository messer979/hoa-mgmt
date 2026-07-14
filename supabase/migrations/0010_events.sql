-- Calendar events — HOA-wide log of upcoming and past events.
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
