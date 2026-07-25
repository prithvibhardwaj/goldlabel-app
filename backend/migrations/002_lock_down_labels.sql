-- Lock down the legacy `Labels` table.
--
-- Background: `Labels` used to store each user's personal, un-anonymized scan
-- history in a single shared table readable by anyone holding the publishable
-- key. The app no longer reads or writes it (personal history is now on-device,
-- encrypted). This migration removes all client access.
--
-- IMPORTANT: the data already written to `Labels` must be treated as previously
-- exposed. After confirming nothing else depends on it, prefer dropping it.

-- Option A (recommended): enable RLS with NO policies -> anon/authenticated get
-- zero access (deny-all), while the table and its rows are preserved for you to
-- export or delete via the service-role key.
alter table if exists public."Labels" enable row level security;

drop policy if exists "Labels are viewable by everyone" on public."Labels";
drop policy if exists "Enable read access for all users" on public."Labels";
drop policy if exists "Enable insert for all users" on public."Labels";
-- (Drop any other permissive policies that may exist; with RLS on and none left,
--  the table is deny-all for the shipped key.)

-- Option B (once you've exported anything you need): remove it entirely.
--   drop table if exists public."Labels";
