import { HttpError, fetchText, type FetchJsonOptions } from '../lib/http.js';
import { csvLines, csvNumber, parseCsvLine } from './csv.js';
import type { Metro } from './metros.js';

/**
 * Census Bureau Population Estimates: residents on July 1 each year and where
 * the change came from (births minus deaths, people moving in from other
 * states and counties, and people moving in from abroad). Released each
 * spring as free CSV files, no key, for every metro, metro division and
 * county. It runs a year ahead of the ACS, so it is the freshest population
 * count there is.
 */

const BASE = 'https://www2.census.gov/programs-surveys/popest/datasets';
export const pepMetroUrl = (vintage: number) => `${BASE}/2020-${vintage}/metro/totals/cbsa-est${vintage}-alldata.csv`;
export const pepCountyUrl = (vintage: number) => `${BASE}/2020-${vintage}/counties/totals/co-est${vintage}-alldata.csv`;

/** One area's change over the twelve months to July 1 of the vintage year. */
export interface PopulationChange {
  population: number;
  /** Residents gained (or lost) over the year. */
  change: number | null;
  /** Births minus deaths. */
  natural: number | null;
  /** Net movers from elsewhere in the U.S. */
  domestic: number | null;
  /** Net movers from abroad. */
  international: number | null;
  /** domestic + international. */
  migration: number | null;
}

function changeFrom(header: string[], row: string[], year: number): PopulationChange | null {
  const get = (name: string) => {
    const index = header.indexOf(`${name}${year}`);
    return index >= 0 ? csvNumber(row[index]) : null;
  };
  const population = get('POPESTIMATE');
  if (population == null) return null;
  return {
    population,
    change: get('NPOPCHG'),
    natural: get('NATURALCHG'),
    domestic: get('DOMESTICMIG'),
    international: get('INTERNATIONALMIG'),
    migration: get('NETMIG')
  };
}

/**
 * Rows for each metro: a whole metro is the CBSA row with no division or
 * county; a division is its own row under its parent CBSA.
 */
export function parsePepMetros(text: string, metros: Metro[], year: number): Map<string, PopulationChange> {
  const lines = csvLines(text);
  const header = parseCsvLine(lines[0] ?? '');
  const [cbsa, mdiv, county] = ['CBSA', 'MDIV', 'STCOU'].map((name) => header.indexOf(name)) as [number, number, number];
  const out = new Map<string, PopulationChange>();
  for (const line of lines.slice(1)) {
    const row = parseCsvLine(line);
    if (row[county]) continue;
    const metro = metros.find((m) =>
      m.census.division ? row[cbsa] === m.census.msa && row[mdiv] === m.census.division : row[cbsa] === m.census.msa && !row[mdiv]
    );
    if (!metro) continue;
    const change = changeFrom(header, row, year);
    if (change) out.set(metro.area, change);
  }
  return out;
}

export interface CountyGrowth extends PopulationChange {
  county: string;
  /** Three-digit county FIPS code. */
  code: string;
  /** Percent change over the year. */
  growth: number | null;
}

/** Texas counties (summary level 050, state 48) for one year. */
export function parsePepCounties(text: string, year: number): CountyGrowth[] {
  const lines = csvLines(text);
  const header = parseCsvLine(lines[0] ?? '');
  const [sumlev, state, code, name] = ['SUMLEV', 'STATE', 'COUNTY', 'CTYNAME'].map((n) => header.indexOf(n)) as [number, number, number, number];
  const out: CountyGrowth[] = [];
  for (const line of lines.slice(1)) {
    const row = parseCsvLine(line);
    if (row[sumlev] !== '050' || row[state] !== '48') continue;
    const change = changeFrom(header, row, year);
    if (!change) continue;
    const before = change.change == null ? null : change.population - change.change;
    out.push({ county: row[name] ?? '', code: row[code] ?? '', ...change, growth: before ? (change.change! / before) * 100 : null });
  }
  return out;
}

export interface PepResult {
  /** The year of the July 1 estimate. */
  year: number;
  metros: Map<string, PopulationChange>;
  counties: CountyGrowth[];
}

/**
 * The newest vintage published. Each vintage comes out between March and
 * June of the year after its July 1 date, so the search starts at last year
 * and walks back.
 */
export async function fetchPep(metros: Metro[], options: FetchJsonOptions & { now?: Date } = {}): Promise<PepResult> {
  const { now = new Date(), ...http } = options;
  const read = (url: string) => fetchText(url, { timeoutMs: 120_000, ...http, accept: 'text/csv' });
  for (let year = now.getUTCFullYear() - 1; year >= now.getUTCFullYear() - 3; year--) {
    let metroText: string;
    try {
      metroText = await read(pepMetroUrl(year));
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) continue;
      throw error;
    }
    const found = parsePepMetros(metroText, metros, year);
    if (!found.size) continue;
    // The county file is a nice-to-have; a failure keeps the metro figures.
    const counties = await read(pepCountyUrl(year))
      .then((text) => parsePepCounties(text, year))
      .catch(() => []);
    return { year, metros: found, counties };
  }
  throw new Error('No Population Estimates release in the last three years');
}

/** Movers as a percent of residents: how strong the pull is, comparable across metro sizes. */
export function shareOf(count: number | null | undefined, population: number | null | undefined): number | null {
  if (count == null || !population) return null;
  return (count / population) * 100;
}

/** The counties that added the most people, for the "where Texas is growing" list. */
export function topGrowingCounties(counties: CountyGrowth[], limit = 10): CountyGrowth[] {
  return [...counties]
    .filter((c) => c.change != null)
    .sort((a, b) => b.change! - a.change!)
    .slice(0, limit);
}
