import { fetchJson, type FetchJsonOptions } from '../lib/http.js';
import type { City } from '../types.js';
import { METRO_COUNTIES, STATUS, TABS_COUNTY_IDS, TABS_SEARCH_URL, WORK, searchForm, tabsPermalink, type TabsRow } from './developments.js';

/**
 * Every recent TABS registration in each market's counties, for watchlist
 * alerts.
 *
 * The development map (developments.ts) shows each metro's biggest current
 * projects and stops at a few hundred, so a small new filing in Harris County
 * never reaches it. Alerts need the opposite: every filing, however small. So
 * this reads only the last RECENT_DAYS of registrations per county, page by
 * page, with no cap and no project-page reads.
 *
 * What TABS is: the public record of projects registered with TDLR under the
 * Texas Architectural Barriers Act. Projects that qualify (public buildings,
 * and privately funded commercial buildings and places of public
 * accommodation above the cost threshold) must register. Houses, many
 * industrial buildings and work below the threshold do not, so this is not a
 * list of all construction in Texas.
 *
 * Whether a county's read is complete is checked, not assumed: the search
 * reports how many rows match (recordsFiltered), and a county counts as
 * complete only when every one of them was read. When TABS does not report a
 * total, or the read stops early, the county is marked unverified or
 * incomplete and the gap is reported.
 */

/** Days of registrations each build reads. Overlaps between daily builds, so a missed build loses nothing. */
export const RECENT_DAYS = 10;
/** Rows per page. */
export const RECENT_PAGE = 500;
/** Pages per county before giving up and reporting the county as incomplete. */
export const RECENT_MAX_PAGES = 10;

export interface Registration {
  /** TABS project number. */
  id: string;
  /** The markets whose counties include it (Galveston County is in Houston's and Galveston's). */
  cities: City[];
  county: string;
  name: string;
  status: string;
  work: string;
  cost: number;
  /** YYYY-MM-DD. */
  registered: string;
  url: string;
}

/**
 * How one county's read went. complete is true when the rows read match the
 * total TABS reported, false when fewer were read, and null when TABS gave no
 * total to check against.
 */
export interface CountyCoverage {
  county: string;
  cities: City[];
  reported: number | null;
  read: number;
  complete: boolean | null;
  /** Set when the county could not be read at all. */
  error?: string;
}

export interface RegistrationsResult {
  asOf: string;
  days: number;
  registrations: Registration[];
  coverage: CountyCoverage[];
}

interface SearchPage {
  data?: TabsRow[];
  recordsFiltered?: number;
  recordsTotal?: number;
}

const isoDate = (value: string | null | undefined) => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : '');

/** The search form for one page of a county's registrations from `since` to `until`. */
export function recentForm(county: string, now: Date, start: number, days = RECENT_DAYS, until = now): Record<string, string> {
  const since = new Date(now.getTime() - days * 86_400_000);
  return { ...searchForm(county, since, until, RECENT_PAGE), start: String(start) };
}

type WindowRead = { rows: Map<string, TabsRow>; reported: number | null; endReached: boolean };

/** Read every page of one date window, stopping when the pages run out or repeat. */
async function readWindow(form: (start: number) => Record<string, string>, options: FetchJsonOptions): Promise<WindowRead> {
  const rows = new Map<string, TabsRow>();
  let reported: number | null = null;
  let read = 0;
  let endReached = false;
  for (let page = 0; page < RECENT_MAX_PAGES; page++) {
    const result = await fetchJson<SearchPage>(TABS_SEARCH_URL, {
      timeoutMs: 120_000,
      ...options,
      form: form(read),
      headers: { 'x-requested-with': 'XMLHttpRequest', referer: 'https://www.tdlr.texas.gov/TABS/Search/' }
    });
    const data = result.data ?? [];
    if (typeof result.recordsFiltered === 'number') reported = result.recordsFiltered;
    read += data.length;
    const before = rows.size;
    for (const row of data) rows.set(row.ProjectNumber, row);
    // A page of rows already seen means the search ignored the page offset; stop and let the count show the gap.
    if (data.length && rows.size === before) break;
    // TABS may serve fewer rows than asked, so the next page starts after the
    // rows actually read, and only an empty page, a matched total, or a short
    // page with no total ends the read.
    if (!data.length || (reported != null ? read >= reported : data.length < RECENT_PAGE)) {
      endReached = true;
      break;
    }
  }
  return { rows, reported, endReached };
}

/**
 * Read one county's recent registrations, and say whether the read is complete.
 * The PR build showed TABS serving at most 100 rows a search and ignoring the
 * page offset (Harris: 100 of 124), so a county the whole window can't cover is
 * read again one day at a time, and the rows are checked against the total.
 */
export async function readCounty(
  county: string,
  now: Date,
  options: FetchJsonOptions = {}
): Promise<{ rows: TabsRow[]; reported: number | null; complete: boolean | null }> {
  const whole = await readWindow((start) => recentForm(county, now, start), options);
  const { rows, reported } = whole;
  if (reported != null && rows.size < reported) {
    const seen: string[] = [];
    for (let back = RECENT_DAYS; back >= 0; back--) {
      // Each window runs to the next day, in case TABS treats the end date as
      // midnight. Windows overlap; rows are kept once.
      const day = new Date(now.getTime() - back * 86_400_000);
      const next = new Date(day.getTime() + 86_400_000);
      const one = await readWindow((start) => recentForm(county, day, start, 0, next), options);
      for (const [id, row] of one.rows) rows.set(id, row);
      seen.push(`${one.rows.size}/${one.reported ?? '?'}`);
    }
    console.error(`TDLR TABS new registrations: ${county} read day by day (rows/total per window): ${seen.join(' ')}`);
  }
  const complete = reported != null ? rows.size >= reported : whole.endReached ? null : false;
  return { rows: [...rows.values()], reported, complete };
}

/** Each county once, with every market it belongs to. */
export function countiesFor(cities: readonly City[]): Map<string, City[]> {
  const out = new Map<string, City[]>();
  for (const city of cities) {
    for (const county of METRO_COUNTIES[city] ?? []) {
      if (!TABS_COUNTY_IDS[county]) continue;
      out.set(county, [...(out.get(county) ?? []), city]);
    }
  }
  return out;
}

export function toRegistration(row: TabsRow, county: string, cities: City[]): Registration {
  return {
    id: row.ProjectNumber,
    cities,
    county,
    name: row.ProjectName.trim(),
    status: STATUS[row.ProjectStatus] ?? 'Registered',
    work: WORK[row.TypeOfWork] ?? 'Other work',
    cost: Math.round(row.EstimatedCost || 0),
    registered: isoDate(row.ProjectCreatedOn),
    url: tabsPermalink(row.ProjectNumber)
  };
}

/** One line for the build log and the step summary. */
export function coverageLine(coverage: CountyCoverage[]): string {
  const complete = coverage.filter((c) => c.complete === true).length;
  const unverified = coverage.filter((c) => c.complete === null && !c.error).map((c) => c.county);
  const incomplete = coverage.filter((c) => c.complete === false && !c.error).map((c) => `${c.county} (${c.read} of ${c.reported ?? '?'})`);
  const failed = coverage.filter((c) => c.error).map((c) => c.county);
  const parts = [`${complete} of ${coverage.length} counties complete`];
  if (incomplete.length) parts.push(`incomplete: ${incomplete.join(', ')}`);
  if (unverified.length) parts.push(`no total reported, so unverified: ${unverified.join(', ')}`);
  if (failed.length) parts.push(`not read: ${failed.join(', ')}`);
  return parts.join('; ');
}

export async function fetchRegistrations(
  cities: readonly City[],
  options: FetchJsonOptions & { now?: Date; pauseMs?: number } = {}
): Promise<RegistrationsResult> {
  const { now = new Date(), pauseMs = 300, ...http } = options;
  const registrations = new Map<string, Registration>();
  const coverage: CountyCoverage[] = [];
  let first = true;
  for (const [county, inCities] of countiesFor(cities)) {
    if (!first && pauseMs) await new Promise((resolve) => setTimeout(resolve, pauseMs));
    first = false;
    try {
      const { rows, reported, complete } = await readCounty(county, now, http);
      for (const row of rows) if (!registrations.has(row.ProjectNumber)) registrations.set(row.ProjectNumber, toRegistration(row, county, inCities));
      coverage.push({ county, cities: inCities, reported, read: rows.length, complete });
    } catch (error) {
      coverage.push({ county, cities: inCities, reported: null, read: 0, complete: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    asOf: now.toISOString(),
    days: RECENT_DAYS,
    registrations: [...registrations.values()].sort((a, b) => b.registered.localeCompare(a.registered) || a.id.localeCompare(b.id)),
    coverage
  };
}
