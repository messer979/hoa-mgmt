-- HOA Management — email attachments
-- Inbound emails with attachments get the bytes stored in a private Supabase
-- Storage bucket and the metadata indexed in public.attachments. The app
-- generates short-lived signed URLs on demand for download.

-- Private storage bucket (25 MB cap per file).
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

create index if not exists attachments_topic_idx   on public.attachments(topic_id);
create index if not exists attachments_email_idx   on public.attachments(email_id);
create index if not exists attachments_received_idx on public.attachments(received_at desc);

alter table public.attachments enable row level security;
