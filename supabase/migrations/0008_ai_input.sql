-- HOA Management — store the JSON payload that was sent to the AI so the
-- inbox detail page can show admins exactly what the model saw, for trust
-- + debugging.

alter table public.emails
  add column if not exists ai_input jsonb;
