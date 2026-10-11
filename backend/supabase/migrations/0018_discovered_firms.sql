-- The five firms from the first employer discovery batch, approved by Rod on
-- 2026-10-11 (Discover ATS run 38171789220 read each board live).
--
-- Replaces 0017_discovered_firms.sql, which failed in production (Database
-- migrations run 38177905204) and wrote nothing: the live firms table never
-- got the sector or cre_only columns (0006 and 0014 did not apply there), and
-- 0017 is the TERRA Pro watchlists migration's number. This file uses only
-- the columns 0001_init.sql created. The site reads firms from the Sheet's
-- Firms tab, which already has these five with their sectors.
--
-- Idempotent: a firm already present by name, or by board, is left as it is.
insert into firms (name, ats, ats_slug, ats_host, slug_verified, active) values
  ('Fairfield Residential', 'workday', 'ffres/fairfieldcareers', 'ffres.wd1.myworkdayjobs.com', true, true),
  ('Chesmar Homes', 'icims', 'careers-mdch', 'careers-mdch.icims.com', true, true),
  ('Kimco Realty', 'workday', 'kimcorealty/KimcoCareers', 'kimcorealty.wd503.myworkdayjobs.com', true, true),
  ('The NRP Group', 'workday', 'nrpgroup/NRP', 'nrpgroup.wd1.myworkdayjobs.com', true, true),
  ('JPI', 'workday', 'jpi/JPIcareers', 'jpi.wd1.myworkdayjobs.com', true, true)
on conflict do nothing;
