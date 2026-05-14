-- Remove the unused unit_number field from profiles.
alter table public.profiles drop column if exists unit_number;
