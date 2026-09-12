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

-- Boards that exist but could not be attributed from the API. Lever publishes
-- no company name, so `marcusmillichap` cannot be proven to be Marcus &
-- Millichap's without opening it. Left inactive so the collector ignores it
-- until somebody looks.
insert into firms (name, ats, ats_slug, slug_verified, active) values
  ('Marcus & Millichap', 'lever', 'marcusmillichap', false, false)
on conflict (name) do nothing;
