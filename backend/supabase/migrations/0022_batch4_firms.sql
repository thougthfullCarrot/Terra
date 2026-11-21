-- Batch 4 employers with a Texas entry-level opening on their own official
-- careers board (Discover ATS runs 44934839335 and 44939153932, 2026-11-21,
-- data/employer-candidates-batch4.txt). Each board was found by following the
-- firm's own careers link, and each uses a reader TERRA already has.
--
-- Left out on purpose: Swinerton (its only "Texas opening" was an Apprentice
-- Drywall Framer, a trade seat the intern rule misread), and verified boards
-- with no Texas opening today (listed in the PR #116 report), to keep request
-- volume down until they post one.
--
-- Uses only the 0001_init.sql columns. The site reads the Sheet's Firms tab;
-- the build adds this batch there once (src/sheets/firms.ts FIRM_BATCHES).
-- Idempotent: a firm already present by name or board is left as it is.
insert into firms (name, ats, ats_slug, ats_host, slug_verified, active) values
  ('Ryan Companies', 'workday', 'ryancompanies/ryancompanies', 'ryancompanies.wd5.myworkdayjobs.com', true, true),
  ('SpawGlass', 'lever', 'spawglass', null, true, true),
  ('Green Brick Partners', 'icims', 'careers-greenbrickpartners', 'careers-greenbrickpartners.icims.com', true, true),
  ('Homebound', 'ashby', 'Homebound', null, true, true),
  ('Olympus Property', 'greenhouse', 'olympusproperty', null, true, true)
on conflict do nothing;
