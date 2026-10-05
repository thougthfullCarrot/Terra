-- New Braunfels joins the tracked cities. Widens the postings city check;
-- every earlier value stays. Adds its markets row like the others.
alter table postings drop constraint if exists postings_city_check;
alter table postings add constraint postings_city_check
  check (city in ('Dallas', 'Fort Worth', 'Houston', 'Austin', 'San Antonio',
                  'El Paso', 'New Braunfels'));

insert into markets (city, quarter, data)
values ('New Braunfels', 'Q3 2026', '{"trend":"Steady","dir":"flat","summary":"","stats":[],"sectors":[],"news":[],"hiring":""}'::jsonb)
on conflict (city) do nothing;
