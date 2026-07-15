-- Documents — HOA-wide file library for bylaws, covenants, etc.
-- Anyone can upload; uploader or admin can delete.

insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 26214400)
on conflict (id) do nothing;

create table if not exists public.documents (
  id           uuid primary key default gen_random_uuid(),
  title        text,
  description  text,
  storage_path text not null,
  filename     text not null,
  content_type text,
  size_bytes   bigint,
  uploaded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists documents_created_idx on public.documents(created_at desc);

alter table public.documents enable row level security;
