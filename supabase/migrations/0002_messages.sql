-- HOA Management — conversations & threading
-- Adds a unified topic_messages table that mixes inbound emails and web-posted
-- replies into a single conversation per topic, plus the email-threading
-- columns we need to wire RFC 5322 In-Reply-To / References.

-- ---------- emails: threading + outbound flag ----------
alter table public.emails
  add column if not exists in_reply_to text,
  add column if not exists references_ids text[],
  add column if not exists is_outbound boolean not null default false;

create index if not exists emails_in_reply_to_idx on public.emails(in_reply_to);

-- ---------- topic_messages ----------
create table if not exists public.topic_messages (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete cascade,
  -- author_profile_id may be null when an inbound email's sender hasn't been
  -- matched to a member yet; in that case the email row carries from_name/email.
  author_profile_id uuid references public.profiles(id) on delete set null,
  body_text text not null,
  body_html text,
  source text not null check (source in ('email','web')),
  email_id uuid references public.emails(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists topic_messages_topic_idx
  on public.topic_messages(topic_id, created_at);

-- One conversation row per inbound/outbound email. Web messages have no
-- email_id and aren't subject to this constraint.
create unique index if not exists topic_messages_email_uniq
  on public.topic_messages(email_id) where email_id is not null;

alter table public.topic_messages enable row level security;

-- ---------- backfill: existing topic-linked emails become messages ----------
insert into public.topic_messages (topic_id, author_profile_id, body_text, body_html, source, email_id, created_at)
select e.topic_id, e.matched_profile_id, coalesce(e.body_text, ''), e.body_html, 'email', e.id, e.received_at
from public.emails e
where e.topic_id is not null
on conflict do nothing;
