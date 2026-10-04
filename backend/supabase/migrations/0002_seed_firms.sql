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

-- Enterprise CRE and Texas-heavy owners on Workday. Each tenant and site is
-- read off a posting URL on the firm's own myworkdayjobs.com board, so the
-- tenant belongs to the firm by construction.
--
-- All seven verified live on 2026-10-04, reading each board in full. Texas
-- entry-level postings at that time: Greystar 19, JLL 16, Cushman & Wakefield
-- 15, Transwestern 8, Colliers 4, Invitation Homes 4, Prologis 2. JLL and C&W
-- list 2,000, which is Workday's paging ceiling, so their real boards are
-- larger and those counts are a floor.
--
-- Not here, and why:
--   CBRE      careers.cbre.com shows no Workday tenant; no board found
--   Newmark   no public board URL found
--   Camden    Oracle Recruiting Cloud, which has no fetcher
insert into firms (name, ats, ats_slug, ats_host, slug_verified, active) values
  -- https://jll.wd1.myworkdayjobs.com/en-US/jllcareers
  ('JLL', 'workday', 'jll/jllcareers', 'jll.wd1.myworkdayjobs.com', true, true),
  -- https://cw.wd1.myworkdayjobs.com/en-US/External
  ('Cushman & Wakefield', 'workday', 'cw/External', 'cw.wd1.myworkdayjobs.com', true, true),
  -- https://colliers.wd3.myworkdayjobs.com/Colliers-External-Career-Site
  ('Colliers', 'workday', 'colliers/Colliers-External-Career-Site',
   'colliers.wd3.myworkdayjobs.com', true, true),
  -- Houston based. https://transwestern.wd1.myworkdayjobs.com/TWCareers
  ('Transwestern', 'workday', 'transwestern/TWCareers',
   'transwestern.wd1.myworkdayjobs.com', true, true),
  -- https://prologis.wd5.myworkdayjobs.com/en-US/Prologis_External_Careers
  ('Prologis', 'workday', 'prologis/Prologis_External_Careers',
   'prologis.wd5.myworkdayjobs.com', true, true),
  -- Dallas HQ. Moved from wd1 to wd503; the wd1 host answers 422.
  -- https://invitationhomes.wd503.myworkdayjobs.com/en-US/INVH
  ('Invitation Homes', 'workday', 'invitationhomes/INVH',
   'invitationhomes.wd503.myworkdayjobs.com', true, true),
  -- https://greystar.wd1.myworkdayjobs.com/External
  ('Greystar', 'workday', 'greystar/External', 'greystar.wd1.myworkdayjobs.com', true, true)
on conflict (name) do nothing;

-- iCIMS. Houston-based developer and manager; the portal's page titles read
-- 'Careers at Hines'. Verified by `npm run verify:firms` on 2026-10-04: the
-- portal listed 190 postings to the fetcher, 9 looked entry-level in Texas,
-- all 9 job pages parsed, and 8 passed the normalizer.
insert into firms (name, ats, ats_slug, ats_host, slug_verified, active) values
  ('Hines', 'icims', 'careers-hines', 'careers-hines.icims.com', true, true)
on conflict (name) do nothing;

-- Boards that exist but could not be attributed from the API. Lever publishes
-- no company name, so `marcusmillichap` cannot be proven to be Marcus &
-- Millichap's without opening it. Left inactive so the collector ignores it
-- until somebody looks.
insert into firms (name, ats, ats_slug, slug_verified, active) values
  ('Marcus & Millichap', 'lever', 'marcusmillichap', false, false)
on conflict (name) do nothing;
