-- Quarterly market data, maintained by hand from free brokerage research plus
-- FRED/Census. Replace the payloads each quarter and bump the `quarter` column;
-- the Market screen reads whatever is here.
--
-- The rows below carry the Q3 2026 figures from the design prototype. Swap them
-- for sourced numbers before shipping — these are the designer's placeholders.

insert into markets (city, quarter, data) values
('Texas', 'Q3 2026', '{
  "trend": "Mixed", "dir": "flat",
  "summary": "Statewide roll-up of the six tracked metros.",
  "stats": [], "sectors": [], "news": [],
  "hiring": "Every tracked metro has at least one live entry-level or internship posting this week."
}'::jsonb)
on conflict (city) do nothing;

insert into markets (city, quarter, data)
select city, 'Q3 2026', '{"trend":"Steady","dir":"flat","summary":"","stats":[],"sectors":[],"news":[],"hiring":""}'::jsonb
from unnest(array['Austin','Dallas','Houston','San Antonio','Fort Worth','El Paso']) as city
on conflict (city) do nothing;
