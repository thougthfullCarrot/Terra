-- Lending, Title & Escrow, Property Tax, and Finance & Accounting join the
-- sectors: the rest of the work a commercial deal takes. Widens the check;
-- every earlier value stays.
alter table postings drop constraint if exists postings_sector_check;
alter table postings add constraint postings_sector_check
  check (sector in ('Investment', 'Brokerage', 'Development', 'Property Mgmt',
                    'Asset Mgmt', 'Appraisal', 'Capital Markets', 'Homebuilder',
                    'Affordable Housing', 'Lending', 'Title & Escrow',
                    'Property Tax', 'Finance & Accounting'));
