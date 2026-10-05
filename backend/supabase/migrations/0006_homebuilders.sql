-- Homebuilders: a Homebuilder sector, a Workable board type, and the builders
-- that hire entry-level people in Texas.
--
-- Every posting from a builder is pinned to the Homebuilder sector by the
-- firm row's `sector`, so a builder's land analyst or purchasing coordinator
-- files under Homebuilder rather than wherever its keywords point.

alter table firms add column if not exists sector text;

alter table firms drop constraint if exists firms_ats_check;
alter table firms add constraint firms_ats_check
  check (ats in ('greenhouse', 'lever', 'workday', 'icims', 'workable'));

alter table postings drop constraint if exists postings_sector_check;
alter table postings add constraint postings_sector_check
  check (sector in ('Investment', 'Brokerage', 'Development', 'Property Mgmt',
                    'Asset Mgmt', 'Appraisal', 'Capital Markets', 'Homebuilder'));

-- Each board was read off the builder's own careers page (the page links to
-- it), not guessed from the name.
--
-- Not here, and why:
--   D.R. Horton      Taleo (drhorton.taleo.net), which has no fetcher
--   Highland Homes   UKG UltiPro (recruiting.ultipro.com/HIG1007), no fetcher
--   David Weekley    own careers site; its ATS is not visible from the page
--   Ashton Woods     careers.ashtonwoods.com, no public board API found
--   Century Communities, Brightland   ATS not found from their careers pages
insert into firms (name, ats, ats_slug, ats_host, sector, slug_verified, active) values
  -- Workday. https://lennar.wd1.myworkdayjobs.com/Lennar_Jobs
  ('Lennar', 'workday', 'lennar/Lennar_Jobs', 'lennar.wd1.myworkdayjobs.com',
   'Homebuilder', false, true),
  -- https://pultegroup.wd1.myworkdayjobs.com/en-US/PGI
  ('PulteGroup', 'workday', 'pultegroup/PGI', 'pultegroup.wd1.myworkdayjobs.com',
   'Homebuilder', false, true),
  -- Linked from careers.taylormorrison.com.
  -- https://taylormorrison.wd1.myworkdayjobs.com/en-US/TaylorMorrisonCareers
  ('Taylor Morrison', 'workday', 'taylormorrison/TaylorMorrisonCareers',
   'taylormorrison.wd1.myworkdayjobs.com', 'Homebuilder', false, true),
  -- The Woodlands, TX. https://lgi.wd5.myworkdayjobs.com/LGI_Careers
  ('LGI Homes', 'workday', 'lgi/LGI_Careers', 'lgi.wd5.myworkdayjobs.com',
   'Homebuilder', false, true),

  -- iCIMS portals, each linked from the builder's careers page.
  ('Meritage Homes', 'icims', 'careers-meritagehomes', 'careers-meritagehomes.icims.com',
   'Homebuilder', false, true),
  ('Toll Brothers', 'icims', 'jobs-tollbrothers', 'jobs-tollbrothers.icims.com',
   'Homebuilder', false, true),
  ('KB Home', 'icims', 'careers-kbhome', 'careers-kbhome.icims.com',
   'Homebuilder', false, true),
  ('Tri Pointe Homes', 'icims', 'careers-tripointehomes', 'careers-tripointehomes.icims.com',
   'Homebuilder', false, true),
  ('Beazer Homes', 'icims', 'careers-beazer', 'careers-beazer.icims.com',
   'Homebuilder', false, true),

  -- Workable. Houston based; perryhomes.com/careers sends applicants to
  -- https://apply.workable.com/perryhomes
  ('Perry Homes', 'workable', 'perryhomes', null, 'Homebuilder', false, true),
  -- mihomes.com/careers redirects to https://apply.workable.com/mi-homes
  ('M/I Homes', 'workable', 'mi-homes', null, 'Homebuilder', false, true)
on conflict (name) do nothing;
