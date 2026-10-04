-- Firms the collector polls.
--
-- EVERY ROW HERE HAS BEEN VERIFIED against the live ATS API. Nothing goes in
-- on the strength of a plausible-looking name.
--
-- The first version of this file held 30 firms with guessed slugs. All 30 were
-- wrong: 26 had no board at all, and two of the four that answered belonged to
-- unrelated companies — `highland` is a veterinary hospital, `integra` is
-- Integra FEC. A collector pointed at that list would have produced an empty
-- feed at best and animal-clinic jobs at worst.
--
-- So candidates now live in data/firm-candidates.txt, which is throwaway, and
-- reach this file only after `npm run probe:slugs` confirms both that a board
-- exists and that the board's own company name matches the firm. To add firms:
--
--   1. add names to data/firm-candidates.txt
--   2. run the "Probe ATS boards" workflow
--   3. paste the confirmed rows it prints here

insert into firms (name, ats, ats_slug, slug_verified) values
  -- Board name reads "Lincoln Property Company through LinkedIn"; 15 postings
  -- at the time of verification.
  ('Lincoln Property Company', 'greenhouse', 'lincoln', true),
  -- Multifamily owner-operator, Atlanta based with large Dallas, Houston and
  -- Austin portfolios. Board name matched exactly.
  ('Cortland', 'greenhouse', 'cortland', true)
on conflict (name) do nothing;

-- Read off each firm's own careers page by `npm run discover:ats`, which is a
-- stronger basis than the slug probe: the board URL was a link on the firm's
-- site rather than a guess that happened to answer.
--
-- Both are Workday, and the Workday fetcher has never been run against a live
-- tenant. These are therefore seeded inactive until `npm run verify:firms`
-- confirms the CXS API answers a server client — see
-- src/collector/sources/workday.ts for why that is in doubt.
-- Jackson-Shaw was here and was wrong. The crawler accepted jackson.com as its
-- domain on a single word match and reported Jackson National Life's Workday
-- tenant as the Dallas developer's. The roles it listed — RIA Support
-- Coordinator, Internal Wholesaler Trainee, Nashville and Lansing — are what
-- exposed it. Domain confirmation now requires every distinctive word.
insert into firms (name, ats, ats_slug, ats_host, slug_verified, active) values
  -- Residential REIT, Toronto based with Texas holdings. The tenant matches
  -- the firm, and its board is property operations rather than CRE analyst
  -- work, so relevance is left to the collector's filters rather than assumed.
  -- https://tricon.wd3.myworkdayjobs.com/tricon
  ('Tricon Residential', 'workday', 'tricon/tricon',
   'tricon.wd3.myworkdayjobs.com', true, false)
on conflict (name) do nothing;

-- iCIMS. Houston-based developer and manager; the portal's page titles read
-- 'Careers at Hines' and it listed ~200 postings, about 40 of them in Texas,
-- when the iCIMS fetcher was written. Read from outside a server, not yet by
-- the fetcher itself, so inactive until `npm run verify:firms` shows it answers.
insert into firms (name, ats, ats_slug, ats_host, slug_verified, active) values
  ('Hines', 'icims', 'careers-hines', 'careers-hines.icims.com', true, false)
on conflict (name) do nothing;

-- Boards that exist but could not be attributed from the API. Lever publishes
-- no company name, so `marcusmillichap` cannot be proven to be Marcus &
-- Millichap's without opening it. Left inactive so the collector ignores it
-- until somebody looks.
insert into firms (name, ats, ats_slug, slug_verified, active) values
  ('Marcus & Millichap', 'lever', 'marcusmillichap', false, false)
on conflict (name) do nothing;
