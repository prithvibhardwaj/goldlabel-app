-- GoldLabel — anonymized training/feedback dataset
-- Insert-only from the app; readable only via the service-role key (server-side).
--
-- Design: no login. Personal scan history stays on-device. Only anonymized,
-- PII-scrubbed contributions land here, written by the backend after scrubbing.
-- The publishable/anon key can INSERT and nothing else. Reads/updates/deletes
-- by anon are denied by RLS, so no client can pull other users' data.

create table if not exists public.scan_contributions (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  language     text,
  scrubbed_ocr text,        -- OCR text with personal info removed by the backend
  suggested    jsonb,       -- what the model originally suggested (6 category keys)
  correction   jsonb,       -- what the user finalized after review
  app_version  text         -- optional client build tag, for dataset slicing
);

-- Turn on row-level security. With RLS enabled and no permissive SELECT/UPDATE/
-- DELETE policy, those operations are denied for the anon role by default.
alter table public.scan_contributions enable row level security;

-- Allow INSERT only, for the anon role (the shipped publishable key) AND for the
-- authenticated role (in case you add anonymous auth later). No USING clause is
-- needed for INSERT; WITH CHECK gates what may be written.
drop policy if exists "contrib_insert_only_anon" on public.scan_contributions;
create policy "contrib_insert_only_anon"
  on public.scan_contributions
  for insert
  to anon, authenticated
  with check (true);

-- NOTE: deliberately NO select/update/delete policies -> denied for anon.
-- Extraction is done out-of-band with the service-role key, which bypasses RLS:
--   select * from public.scan_contributions order by created_at desc;
