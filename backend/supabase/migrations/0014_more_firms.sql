-- Title companies, lenders, a property tax firm and more owners, for the
-- whole of what a commercial deal takes. Every board was read off the firm's
-- own careers page or a posting on it, then checked live with the Verify
-- firm slugs workflow (2026-10-08). FNF, Berkadia, Howard Hughes and MAA
-- failed it and a retry with other addresses, so they are left out.
--
-- cre_only: the firm hires far beyond real estate (a bank's tellers, a title
-- insurer's IT desk, a tax firm's sales tax practice), so only jobs whose
-- title names real estate work are kept.
alter table firms add column if not exists cre_only boolean not null default false;

insert into firms (name, ats, ats_slug, ats_host, sector, cre_only, slug_verified, active) values
  -- Title and escrow.
  -- https://stewart.wd1.myworkdayjobs.com/External
  ('Stewart Title', 'workday', 'stewart/External', 'stewart.wd1.myworkdayjobs.com', 'Title & Escrow', true, true, true),
  -- https://firstam.wd1.myworkdayjobs.com/firstamericancareers
  ('First American Title', 'workday', 'firstam/firstamericancareers', 'firstam.wd1.myworkdayjobs.com', 'Title & Escrow', true, true, true),
  -- https://oldrepublic.wd1.myworkdayjobs.com/oldrepublictitle
  ('Old Republic Title', 'workday', 'oldrepublic/oldrepublictitle', 'oldrepublic.wd1.myworkdayjobs.com', 'Title & Escrow', true, true, true),

  -- Banks: every department posts here, so only real estate titles count and the keyword guess names the sector.
  -- https://frostbank.wd5.myworkdayjobs.com/external
  ('Frost Bank', 'workday', 'frostbank/external', 'frostbank.wd5.myworkdayjobs.com', null, true, true, true),
  -- https://texascapitalbank.wd12.myworkdayjobs.com/Careers
  ('Texas Capital Bank', 'workday', 'texascapitalbank/Careers', 'texascapitalbank.wd12.myworkdayjobs.com', null, true, true, true),
  -- https://originbank.wd1.myworkdayjobs.com/Careers
  ('Origin Bank', 'workday', 'originbank/Careers', 'originbank.wd1.myworkdayjobs.com', null, true, true, true),
  -- Independent Financial, now SouthState. https://southstatebank.wd5.myworkdayjobs.com/External
  ('SouthState Bank', 'workday', 'southstatebank/External', 'southstatebank.wd5.myworkdayjobs.com', null, true, true, true),
  -- Comerica, now Fifth Third. https://fifththird.wd5.myworkdayjobs.com/53careers
  ('Fifth Third Bank', 'workday', 'fifththird/53careers', 'fifththird.wd5.myworkdayjobs.com', null, true, true, true),
  -- Cadence Bank, now Huntington. https://huntington.wd12.myworkdayjobs.com/HNBcareers
  ('Huntington Bank', 'workday', 'huntington/HNBcareers', 'huntington.wd12.myworkdayjobs.com', null, true, true, true),

  -- Commercial real estate lenders and servicers.
  -- https://walkerdunlop.wd1.myworkdayjobs.com/WD
  ('Walker & Dunlop', 'workday', 'walkerdunlop/WD', 'walkerdunlop.wd1.myworkdayjobs.com', null, false, true, true),
  -- https://greyco.wd108.myworkdayjobs.com/GTI
  ('Greystone', 'workday', 'greyco/GTI', 'greyco.wd108.myworkdayjobs.com', null, false, true, true),
  -- https://orix.wd5.myworkdayjobs.com/en-US/lument
  ('Lument', 'workday', 'orix/lument', 'orix.wd5.myworkdayjobs.com', null, false, true, true),
  -- https://job-boards.greenhouse.io/northmarq
  ('Northmarq', 'greenhouse', 'northmarq', null, null, false, true, true),

  -- Property tax. Ryan also runs sales and income tax practices.
  -- https://ryan.wd1.myworkdayjobs.com/RyanCareers
  ('Ryan', 'workday', 'ryan/RyanCareers', 'ryan.wd1.myworkdayjobs.com', null, true, true, true),

  -- Owners and developers.
  -- https://careers.smartrecruiters.com/StreamRealty
  ('Stream Realty Partners', 'smartrecruiters', 'StreamRealty', null, null, false, true, true)
on conflict (name) do nothing;
