-- Title companies, lenders, a property tax firm and more owners, for the
-- whole of what a commercial deal takes. Every board was read off the firm's
-- own careers page or a posting on it (2026-10-08).
--
-- cre_only: the firm hires far beyond real estate (a bank's tellers, a title
-- insurer's IT desk, a tax firm's sales tax practice), so only jobs whose
-- title names real estate work are kept.
alter table firms add column if not exists cre_only boolean not null default false;

insert into firms (name, ats, ats_slug, ats_host, sector, cre_only, slug_verified, active) values
  -- Title and escrow.
  -- https://stewart.wd1.myworkdayjobs.com/External
  ('Stewart Title', 'workday', 'stewart/External', 'stewart.wd1.myworkdayjobs.com', 'Title & Escrow', true, false, true),
  -- https://firstam.wd1.myworkdayjobs.com/firstamericancareers
  ('First American Title', 'workday', 'firstam/firstamericancareers', 'firstam.wd1.myworkdayjobs.com', 'Title & Escrow', true, false, true),
  -- https://oldrepublic.wd1.myworkdayjobs.com/oldrepublictitle
  ('Old Republic Title', 'workday', 'oldrepublic/oldrepublictitle', 'oldrepublic.wd1.myworkdayjobs.com', 'Title & Escrow', true, false, true),
  -- Chicago Title and Fidelity National Title. https://careers-fnf.icims.com/jobs/search
  ('Fidelity National Financial', 'icims', 'careers-fnf', 'careers-fnf.icims.com', 'Title & Escrow', true, false, true),

  -- Banks: every department posts here, so only real estate titles count and the keyword guess names the sector.
  -- https://frostbank.wd5.myworkdayjobs.com/external
  ('Frost Bank', 'workday', 'frostbank/external', 'frostbank.wd5.myworkdayjobs.com', null, true, false, true),
  -- https://texascapitalbank.wd12.myworkdayjobs.com/Careers
  ('Texas Capital Bank', 'workday', 'texascapitalbank/Careers', 'texascapitalbank.wd12.myworkdayjobs.com', null, true, false, true),
  -- https://originbank.wd1.myworkdayjobs.com/Careers
  ('Origin Bank', 'workday', 'originbank/Careers', 'originbank.wd1.myworkdayjobs.com', null, true, false, true),
  -- Independent Financial, now SouthState. https://southstatebank.wd5.myworkdayjobs.com/External
  ('SouthState (Independent Financial)', 'workday', 'southstatebank/External', 'southstatebank.wd5.myworkdayjobs.com', null, true, false, true),
  -- Comerica, now Fifth Third. https://fifththird.wd5.myworkdayjobs.com/53careers
  ('Fifth Third (Comerica)', 'workday', 'fifththird/53careers', 'fifththird.wd5.myworkdayjobs.com', null, true, false, true),
  -- Cadence Bank, now Huntington. https://huntington.wd12.myworkdayjobs.com/HNBcareers
  ('Huntington (Cadence Bank)', 'workday', 'huntington/HNBcareers', 'huntington.wd12.myworkdayjobs.com', null, true, false, true),

  -- Commercial real estate lenders and servicers.
  -- https://walkerdunlop.wd1.myworkdayjobs.com/WD
  ('Walker & Dunlop', 'workday', 'walkerdunlop/WD', 'walkerdunlop.wd1.myworkdayjobs.com', null, false, false, true),
  -- https://greyco.wd108.myworkdayjobs.com/GTI
  ('Greystone', 'workday', 'greyco/GTI', 'greyco.wd108.myworkdayjobs.com', null, false, false, true),
  -- https://orix.wd5.myworkdayjobs.com/en-US/lument
  ('Lument', 'workday', 'orix/lument', 'orix.wd5.myworkdayjobs.com', null, false, false, true),
  -- https://job-boards.greenhouse.io/berkadia
  ('Berkadia', 'greenhouse', 'berkadia', null, null, false, false, true),
  -- https://job-boards.greenhouse.io/northmarq
  ('Northmarq', 'greenhouse', 'northmarq', null, null, false, false, true),

  -- Property tax. Ryan also runs sales and income tax practices.
  -- https://ryan.wd1.myworkdayjobs.com/RyanCareers
  ('Ryan', 'workday', 'ryan/RyanCareers', 'ryan.wd1.myworkdayjobs.com', null, true, false, true),

  -- Owners and developers.
  -- https://osv-howardhughes.wd5.myworkdayjobs.com/HowardHughes
  ('Howard Hughes', 'workday', 'osv-howardhughes/HowardHughes', 'osv-howardhughes.wd5.myworkdayjobs.com', null, false, false, true),
  -- https://maa.wd1.myworkdayjobs.com/MAA
  ('MAA', 'workday', 'maa/MAA', 'maa.wd1.myworkdayjobs.com', null, false, false, true),
  -- https://careers.smartrecruiters.com/StreamRealty
  ('Stream Realty Partners', 'smartrecruiters', 'StreamRealty', null, null, false, false, true)
on conflict (name) do nothing;
