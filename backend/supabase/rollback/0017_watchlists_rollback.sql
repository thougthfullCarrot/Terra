-- Removes everything migration 0017 (watchlists) added, and nothing else.
--
-- NOT RUN AUTOMATICALLY. migrate.yml only applies supabase/migrations/, and
-- the database tests run this file only against their throwaway Postgres.
-- Run it by hand in the Supabase SQL editor, only with Rod's approval, and
-- only AFTER setting the WATCHLISTS_ENABLED variable to false (otherwise the
-- next alerts run logs that 0017 is missing and sends job alerts without
-- unsubscribe links, which is harmless but noisy).
--
-- What it deletes for good: every member's watchlist, digest send log and
-- settings, the stored market history, the tester list and the unsubscribe
-- key. Unsubscribe links already sent stop working; the profile page still
-- turns emails off.
--
-- What it leaves alone: accounts (auth.users), profiles and their other
-- columns, subscriptions and billing, job alerts (alert_sends, email_alerts),
-- the tracker, and the site snapshots.
--
-- Safe to run more than once, and 0017 can be applied again afterwards.

begin;

drop table if exists public.watchlist_items;
drop table if exists public.watch_sends;
drop table if exists public.watch_digests;
drop table if exists public.market_history;

drop function if exists public.watchlist_limit();
drop function if exists public.watch_recipients();
drop function if exists public.alert_link_secret();
drop function if exists public.unsubscribe_alerts(uuid, text, text);
drop function if exists public.watch_beta_access();
drop function if exists private.watch_open_to(uuid);

drop table if exists private.alert_link_secret;
drop table if exists private.watch_testers;
drop table if exists private.watch_settings;
-- 0017 is the only migration that uses the private schema. Without CASCADE
-- this fails rather than drop anything added there later.
drop schema if exists private;

alter table public.profiles drop column if exists watch_emails;
alter table public.profiles drop column if exists digest_frequency;

commit;
