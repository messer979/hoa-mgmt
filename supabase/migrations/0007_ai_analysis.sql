-- HOA Management — AI analysis of inbound emails
-- After an email is persisted, an OpenRouter call (Claude Haiku 4.5 by
-- default) summarizes it, picks the topic, and detects vote intent. Results
-- are stored on the emails row. When confidence is high we auto-apply the
-- vote (source = 'ai'); otherwise the suggestion appears on /inbox/[id]
-- with an Apply button.

alter table public.emails
  add column if not exists ai_summary             text,
  add column if not exists ai_suggested_vote      text,
  add column if not exists ai_suggested_topic_id  uuid references public.topics(id) on delete set null,
  add column if not exists ai_confidence          numeric,
  add column if not exists ai_reasoning           text,
  add column if not exists ai_model               text,
  add column if not exists ai_processed_at        timestamptz;

alter table public.emails drop constraint if exists emails_ai_suggested_vote_check;
alter table public.emails add  constraint emails_ai_suggested_vote_check
  check (ai_suggested_vote is null or ai_suggested_vote in ('affirm','reject','abstain','none'));

-- Allow 'ai' as a vote source so AI-cast votes are distinguishable from
-- web/email/admin_proxy in audit views.
alter table public.votes drop constraint if exists votes_source_check;
alter table public.votes add  constraint votes_source_check
  check (source in ('web','email','admin_proxy','ai'));
