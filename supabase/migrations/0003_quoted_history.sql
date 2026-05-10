-- HOA Management — auto-created topics with parsed quoted history
-- Adds direct author attribution on topic_messages so backfilled history rows
-- (parsed out of quoted email bodies) can show "Alice wrote:" without needing
-- a corresponding emails row to JOIN against.

alter table public.topic_messages
  add column if not exists author_email text,
  add column if not exists author_name  text,
  add column if not exists extracted    boolean not null default false;
