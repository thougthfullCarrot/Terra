-- College Station, Galveston, Lubbock and Midland join the tracked cities.
-- Widens the postings city check; every earlier value stays. Adds their
-- markets rows like the others.
alter table postings drop constraint if exists postings_city_check;
alter table postings add constraint postings_city_check
  check (city in ('Dallas', 'Fort Worth', 'Houston', 'Austin', 'San Antonio',
                  'El Paso', 'New Braunfels', 'College Station', 'Galveston',
                  'Lubbock', 'Midland'));

insert into markets (city, quarter, data)
values
  ('College Station', 'Q3 2026', '{"trend":"Steady","dir":"flat","summary":"","stats":[],"sectors":[],"news":[],"hiring":""}'::jsonb),
  ('Galveston', 'Q3 2026', '{"trend":"Steady","dir":"flat","summary":"","stats":[],"sectors":[],"news":[],"hiring":""}'::jsonb),
  ('Lubbock', 'Q3 2026', '{"trend":"Steady","dir":"flat","summary":"","stats":[],"sectors":[],"news":[],"hiring":""}'::jsonb),
  ('Midland', 'Q3 2026', '{"trend":"Steady","dir":"flat","summary":"","stats":[],"sectors":[],"news":[],"hiring":""}'::jsonb)
on conflict (city) do nothing;
