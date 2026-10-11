-- First employer discovery batch (data/employer-candidates-batch1.txt), the
-- five firms approved by Rod on 2026-10-11. Each board was found from the
-- firm's own careers page by the Discover ATS workflow (run 38171789220) and
-- read live; each had Texas jobs that pass the 0-2 year rule that day.
-- Avison Young and Willow Bridge matched the wrong boards and are left out.
insert into firms (name, ats, ats_slug, ats_host, sector, cre_only, slug_verified, active) values
  -- https://ffres.wd1.myworkdayjobs.com/fairfieldcareers
  ('Fairfield Residential', 'workday', 'ffres/fairfieldcareers', 'ffres.wd1.myworkdayjobs.com', null, false, true, true),
  -- https://careers-mdch.icims.com/jobs/intro
  ('Chesmar Homes', 'icims', 'careers-mdch', 'careers-mdch.icims.com', 'Homebuilder', false, true, true),
  -- https://kimcorealty.wd503.myworkdayjobs.com/KimcoCareers
  ('Kimco Realty', 'workday', 'kimcorealty/KimcoCareers', 'kimcorealty.wd503.myworkdayjobs.com', null, false, true, true),
  -- https://nrpgroup.wd1.myworkdayjobs.com/NRP
  ('The NRP Group', 'workday', 'nrpgroup/NRP', 'nrpgroup.wd1.myworkdayjobs.com', null, false, true, true),
  -- https://jpi.wd1.myworkdayjobs.com/JPIcareers
  ('JPI', 'workday', 'jpi/JPIcareers', 'jpi.wd1.myworkdayjobs.com', 'Development', false, true, true)
on conflict (name) do nothing;
