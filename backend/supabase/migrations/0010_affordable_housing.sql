-- Affordable Housing sector: LIHTC, HUD, housing authority and workforce
-- housing roles. Widens the check; every earlier value stays.
alter table postings drop constraint if exists postings_sector_check;
alter table postings add constraint postings_sector_check
  check (sector in ('Investment', 'Brokerage', 'Development', 'Property Mgmt',
                    'Asset Mgmt', 'Appraisal', 'Capital Markets', 'Homebuilder',
                    'Affordable Housing'));
