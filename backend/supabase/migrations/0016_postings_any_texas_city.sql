-- Jobs anywhere in Texas. A posting's city is now a tracked metro, another
-- Texas town ('Corpus Christi'), or 'Texas' for a statewide seat, so the
-- fixed list of eleven no longer fits. Market rows are unchanged: dashboards
-- still exist only for the tracked cities.
alter table postings drop constraint if exists postings_city_check;
alter table postings add constraint postings_city_check
  check (length(btrim(city)) between 2 and 60);
