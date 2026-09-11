-- Starting firm list for the collector — 30 firms with a Texas CRE presence
-- that publish to Greenhouse or Lever.
--
-- IMPORTANT: the ats_slug values below are starting guesses, not verified board
-- identifiers. A wrong slug returns 404 and the collector records it in
-- firms.last_error while leaving slug_verified false. Before the first
-- production run, confirm each one by opening
--   https://boards-api.greenhouse.io/v1/boards/<slug>/jobs
--   https://api.lever.co/v0/postings/<slug>?mode=json
-- and correct or deactivate the rows that miss. Coverage beats sophistication:
-- a verified list of 30 firms is worth more than a clever collector.

insert into firms (name, ats, ats_slug) values
  -- National brokerages with large Texas offices
  ('CBRE',                         'greenhouse', 'cbre'),
  ('JLL',                          'greenhouse', 'jll'),
  ('Cushman & Wakefield',          'greenhouse', 'cushmanwakefield'),
  ('Colliers',                     'greenhouse', 'colliers'),
  ('Newmark',                      'greenhouse', 'newmark'),
  ('Marcus & Millichap',           'greenhouse', 'marcusmillichap'),
  ('Avison Young',                 'greenhouse', 'avisonyoung'),
  ('Transwestern',                 'greenhouse', 'transwestern'),
  ('Stream Realty Partners',       'greenhouse', 'streamrealty'),
  ('Partners Real Estate',         'greenhouse', 'partnersrealestate'),

  -- Owners, developers, and REITs headquartered in or heavily invested in Texas
  ('Hillwood',                     'greenhouse', 'hillwood'),
  ('Crow Holdings',                'greenhouse', 'crowholdings'),
  ('Trammell Crow Company',        'greenhouse', 'trammellcrowcompany'),
  ('Lincoln Property Company',     'greenhouse', 'lincolnpropertycompany'),
  ('Howard Hughes Holdings',       'greenhouse', 'howardhughes'),
  ('Camden Property Trust',        'greenhouse', 'camdenpropertytrust'),
  ('Whitestone REIT',              'greenhouse', 'whitestonereit'),
  ('Weitzman',                     'greenhouse', 'weitzman'),
  ('Granite Properties',           'greenhouse', 'graniteproperties'),
  ('Endeavor Real Estate Group',   'greenhouse', 'endeavor-re'),

  -- Investment, capital markets, and asset management
  ('Invesco Real Estate',          'greenhouse', 'invesco'),
  ('Lone Star Funds',              'greenhouse', 'lonestarfunds'),
  ('Highland Capital Real Estate', 'lever',      'highlandcapital'),
  ('Velocis',                      'lever',      'velocis'),
  ('Virtus Real Estate Capital',   'lever',      'virtusre'),

  -- Property and facilities management
  ('Greystar',                     'greenhouse', 'greystar'),
  ('RPM Living',                   'greenhouse', 'rpmliving'),
  ('Madera Residential',           'lever',      'maderaresidential'),

  -- Valuation and advisory
  ('Integra Realty Resources',     'greenhouse', 'irr'),
  ('Kroll Real Estate Advisory',   'greenhouse', 'kroll')
on conflict (name) do nothing;
