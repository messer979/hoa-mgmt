-- HOA Management — preserve original parsed date on extracted messages
-- so the conversation can show "Sent May 7" while still being ordered by
-- a synthetic created_at that respects parser order.

alter table public.topic_messages
  add column if not exists original_date timestamptz;
