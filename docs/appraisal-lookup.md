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

See `/mnt/project-files/appraisal-lookup/coverage.md` for the per-run numbers;
the summary:

COVERAGE_TABLE

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

ESTIMATES

## Next step (not in this PR)

Wiring the lookup into the Property tab: publish the index groups for the
districts whose terms allow it next to the site (or in Supabase storage) and
replace `OWNER_SOURCES` queries with `lookup()`, showing the ambiguous list as
a picker. That changes `site/property.js` and `site/property-view.js`, so it
waits for Rod's go-ahead on publication terms (EPCAD in particular).
