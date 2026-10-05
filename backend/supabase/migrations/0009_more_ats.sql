-- Ashby and SmartRecruiters boards: the collector reads both now, so a firm
-- row may name either.

alter table firms drop constraint if exists firms_ats_check;
alter table firms add constraint firms_ats_check
  check (ats in ('greenhouse', 'lever', 'workday', 'icims', 'workable', 'ashby', 'smartrecruiters'));
