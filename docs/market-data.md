# Market data file (site/market.json)

Written by `npm run export:market` (backend/src/bin/export-market.ts) in the Website workflow. With accounts on, the same JSON is stored as the Supabase `site_snapshots` row `market` and left out of the public site.

## Schema version 2

Version 2 adds fields. It removes or renames nothing, so readers of version 1 keep working.

| Field | Meaning |
|---|---|
| `schemaVersion` | `2`. Version 1 files have no such field. |
| `refresh[]` | What each source did on the build: `ok`, `partial`, `failed` (its figures are kept from earlier) or `skipped`. `detail` is a short reason with keys and tokens redacted. |
| `rejected[]` | Readings dropped by the range checks: `{city, key, value, min, max}`. |
| `metrics[].geography` | The area the figure describes: `city`, `metro` (metro area, or metro division for Dallas and Fort Worth), `msa` (the whole metro even where a division exists), `district` (TxDOT) or `fmrArea` (HUD). |
| `metrics[].category` | `economic`, `residential`, `permits` (residential building permits), `appraisal` (appraisal roll values), `taxes`, `infrastructure`, `commercial` (direct commercial property performance; none of the ranked metrics are this yet). |
| `metrics[].valid` | The `{min, max}` range a reading must fall in to be published. |
| `markets[].periods` | Unchanged: the source's reporting period (e.g. "Aug 2026"). |
| `markets[].fetchedAt` | When each value was read from its source. For a retained value this is the original read time. |
| `markets[].status` | `fresh` (read on this build), `retained` (kept from an earlier build because the source failed or its reading was rejected), `expired` (kept too long and dropped; `fetchedAt` says when it was last read) or `missing`. |
| `markets[].shared` | For metrics where this market repeats another market's observation, the city it repeats. Examples: New Braunfels shows the San Antonio metro, Galveston the Houston metro, and Fort Worth uses Realtor.com's DFW figure. Rankings count these once. |

When `fillFromPrevious` reads a version 1 file, it dates that file's values to its `generatedAt`. No migration step is needed: the first version 2 build fills in the new fields. Supabase stores the file as JSON, so the table needs no change.

## Freshness rules

`SOURCE_RULES` in backend/src/market/snapshot.ts sets each source's maximum age. A source's last good figure can be kept for that long after its last successful read: 120 days for monthly sources, about 800 for yearly ones, 30 for TxDOT's live project list. After that the figure is dropped and marked `expired`. The age is measured from the read, not the reporting period, so a yearly survey is never dropped just because it describes last year.

## Validation

Each metric has its own plausible range (`VALID` in snapshot.ts). A reading outside it is logged, listed in `rejected`, and not published. The last good figure stays, marked `retained`. A genuine zero is kept wherever the range allows it (permit counts, for example). Blank or malformed Census permit columns now read as unknown, not zero.

## Caching

site.yml still caches a day's file only when the core sources answered: BLS, the ACS, Zillow, Apartment List and Census permits. Keyless BLS allows 25 requests a day, so the export does not rerun every two hours. A failure in any other source is recorded in `refresh`, its figures are kept with their original dates, the step summary lists it, and the next day's build reads it again.

## Not published

LIHTC counts (HUD) are left out of the metrics. HUD's download blocks automated clients, so they were always blank. Add them back in `DRAFTS` once a source answers.
