# Appraisal district collection and address lookup

`backend/src/appraisal/` reads each county appraisal district for TERRA's
markets into one record shape, builds a small address index, and answers
address lookups conservatively. It is a pipeline only: it does not change the
website, write to Supabase, or deploy anything.

Two cautions travel with every record (`types.ts`):

- **Owner of record** is the name on the roll. It is often an LLC, trustee or
  nominee and is not necessarily the beneficial owner.
- **Values are the district's appraisal for property tax**, not a sale price
  or market value. `valueBasis` says whether the district published its
  appraised value or its market value.

## What the Property tab does today

`site/property.js` (`OWNER_SOURCES`) queries five public ArcGIS layers
straight from the browser, then falls back to the state's StratMap parcel map
(Nominatim geocode, then identify) for any other county:

| District | Layer the site queries | What the pilot found |
| --- | --- | --- |
| Harris | City of Houston Cadastral map | City of Houston only, not the county |
| Dallas | public copy `Dallas_Co_Parcels` | still the 2025 roll; no improvement value |
| Tarrant | Fort Worth `Parcels_Public_Vview` | 2024 roll; no shapes; no land/improvement split |
| Bexar | SARA `BCAD_Parcels_PROD` | BCAD data from December 2025 (open records request) |
| Travis | `TCAD_Parcels_Dec_2025` | coordinates, but no land/improvement split |

Comal, El Paso, Brazos, Galveston, Lubbock and Midland are reached only through
the statewide map, which can't be searched by text and has no
land/improvement values. The site also doesn't separate exact matches from
near ones across districts, or show more than one candidate for a choice.

## Coverage matrix

The districts are each market city's own county (`districts.ts`). The wider
metro counties in `metros.ts` are left to the statewide fallback.

From the full run on 2026-10-18 (all 31 verify cases passed):

| District (market) | Official site / search | Source TERRA reads | Records | Tax year | Values | Coords | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Bexar (San Antonio) | bcad.org / bexar.trueautomation.com | SARA ArcGIS copy of BCAD roll (Dec 2025 open-records data); BCAD has no public export | 705,142 accounts (705,976 rows; repeated per-owner rows collapsed) | 2025 | land, impr, market | yes | Supported. BCAD pages now show 2026 values, so values are a year behind. Bexar County's own layer (maps.bexar.org) is the 2019 roll, not used |
| Harris (Houston) | hcad.org | HCAD Real_acct_owner.zip (real_acct + owners) | 1,628,377 | 2026 | land, bldg, appraised | no | Supported |
| Dallas (Dallas) | dallascad.org | DCAD 2026 certified data product (ACCOUNT_INFO + ACCOUNT_APPRL_YEAR) | 705,536 | 2026 | land, impr, market | no | Supported (BPP excluded). Site's ArcGIS copy is still 2025 |
| Tarrant (Fort Worth) | tad.org | TAD PropertyData (Delimited) | 1,011,964 | 2026 | land, impr, appraised | no | Supported (real property only). Site's Fort Worth view is 2024 |
| Travis (Austin) | traviscad.org / travis.prodigycad.com | TCAD 2026 certified PACS export | 453,705 | 2026 | land, impr, appraised | no | Supported; year built/building area not read yet |
| El Paso (El Paso) | epcad.org | EPCAD Property Search dumps (Azure blob, linked from Open Government) | 408,265 | 2027 file | none | no | Partial: addresses and some owners only. The dumps' roll table has no values yet, owner join matches 76k of 408k, and the certified export (export.epcad.org) answers 403 to TERRA's collector. Files are labelled "development use only" |
| Brazos (College Station) | brazoscad.org | Brazos CAD 2025 certified export (PACS) | 83,748 | 2025 | land, impr, appraised | no | Supported; 2026 export not posted yet (only its layout) |
| Galveston (Galveston) | galvestoncad.org | Galveston CAD 2026 certified roll export (PACS) | 185,023 | 2026 | land, impr, appraised | no | Supported |
| Comal (New Braunfels) | comalad.org / esearch.comalad.org | none | 0 | | | | Unsupported: no public export or API; search has a CAPTCHA; only open layer is a 2021 TNRIS copy. Public Information Act request possible |
| Lubbock (Lubbock) | lubbockcad.org | none | 0 | | | | Unsupported: site answers automated requests with 403; robots.txt sets content-signal terms |
| Midland (Midland) | midcad.org / southwestdatasolution.com | none | 0 | | | | Unsupported: no public export or API; vendor search only. Public Information Act request possible |

## How it works

1. **Collect** (`collect.ts`, `bulk.ts`). ArcGIS districts are read in
   object-id chunks of 1,000 (POST, with a pause per district and 4 retries
   with backoff). Bulk districts download the official zip once, keyed by its
   link and Last-Modified date, and stream it. Everything lands in
   `.appraisal-cache/<district>/`:
   `state.json` (progress, source date, errors), `chunks/*.ndjson`,
   `records.ndjson` when complete, and `hashes.json` per account.
2. **Resume.** A stopped ArcGIS run continues from the chunks already read; a
   bulk run reuses the saved download. Five failures in a row stop a district
   so a refusing server isn't hammered; the next run resumes.
3. **Incremental.** A district whose layer edit date or file version hasn't
   changed since the last finished run is skipped. Otherwise the run reports
   accounts added, changed and removed against the previous hashes.
4. **Per-district errors** go to `.appraisal-cache/report.json`; one district
   failing never stops the others.
5. **Index** (`lookup.ts`). Records are grouped by district and the first three
   characters of the street name (`MAI` = Main, Maize, ...), one JSON file per
   group. A lookup reads one group per district it might be in, never a whole
   county.
6. **Match** (`address.ts`). Both sides are reduced to number, direction,
   street name, suffix, unit, city and ZIP (USPS suffixes, NORTH to N, ordinals,
   `IH`/`FM`/`US` highway names, Saint/St). A part both carry must agree; a
   part only one carries makes the match only *probable*. Results are:
   - `match`: one property; every parcel at that exact address is returned
     (condos, a building on several lots).
   - `ambiguous`: several properties, partial matches, or the same address in
     two districts. All candidates are returned for the person to pick;
     nothing is chosen silently.
   - `none`: with the reason.

## Running it

```
cd backend
npm run appraisal -- probe                          # official pages, downloads, robots.txt
npm run appraisal -- collect --districts bexar      # rerun to resume
npm run appraisal -- collect --max-chunks 20        # pilot-size read of ArcGIS districts
npm run appraisal -- collect --max-lines 50000      # pilot-size read of bulk districts
npm run appraisal -- index
npm run appraisal -- lookup "100 N Main Ave, San Antonio" --districts bexar
npm run appraisal -- verify --districts bexar       # exact / multi-parcel / ambiguous / none cases
```

Flags: `--cache <dir>` (default `.appraisal-cache/` at the repo root, git
ignored), `--out <dir>` for the index, `--restart`, `--force`.

In GitHub Actions, `.github/workflows/appraisal-lookup.yml` runs a quick
check on pushes to this branch and a full read on **Run workflow**
(inputs: districts, max chunks). The cache is saved with `actions/cache`
even when a run is cancelled, so the next run resumes. Results go to the run
summary and a 14-day artifact; nothing is published.

## Updating

Rolls are certified in late July; supplements follow monthly. Run the
workflow manually after certification (or add a schedule, e.g. weekly, like
`appraisal.yml`); unchanged districts are skipped in seconds. To add a
district: add it to `districts.ts` with its field map; for a PACS 8.0 export
(True Automation / Harris Govern districts) set `fields: PACS_FIELDS` and add
a `fromPage(<downloads page>)` source in `bulk.ts`.

## Runtime, storage and cost (full run 2026-10-18, GitHub Actions ubuntu-latest)

| | Value |
| --- | --- |
| Full collection, all districts in parallel | 12 min (Bexar's 706 ArcGIS requests are the long pole; bulk districts 2 to 2.5 min each) |
| Index build + verify | 1.7 min |
| Re-run with nothing changed | under 1 min of collection (unchanged districts skipped; Bexar re-checks its layer date) |
| Records | 5.18 million accounts across 8 districts (an earlier 5.58M figure was an addition error) |
| Actions cache (gzipped records + state) | about 390 MB (repo limit is 10 GB, shared with the site build); older appraisal caches are deleted each run |
| Downloads per full refresh | about 1.5 GB (not cached; fetched only when a file changes) |
| Index, uncompressed / gzipped | 2.0 GB / 230 MB (Harris 73 MB gz, Bexar 42 MB gz) |
| Index group sizes | 17,070 groups; largest 6.9 MB raw (Harris), typical well under 1 MB; a lookup reads one group per district |
| Service cost | $0: no paid service; every source is a free public download or layer; runs use GitHub Actions minutes (about 15 per full run) |

Publication is off (`publish.ts`): only complete, allowlisted districts could ever be published, and none are while `PUBLICATION.enabled` is false. GitHub Pages excludes commercial SaaS sites, so the proposed host for the index is Cloudflare Pages' free plan (20,000 files; the six proposed counties are 11,171 group files, 185 MB gzipped). Measurements and the reasoning are in Rod's review notes.

## Next step (not in this PR)

Wiring the lookup into the Property tab: publish the index groups for the
districts whose terms allow it next to the site (or in Supabase storage) and
replace `OWNER_SOURCES` queries with `lookup()`, showing the ambiguous list as
a picker. That changes `site/property.js` and `site/property-view.js`, so it
waits for Rod's go-ahead on publication terms (EPCAD in particular).
