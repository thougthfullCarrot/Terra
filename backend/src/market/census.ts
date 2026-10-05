import { fetchText, type FetchJsonOptions } from '../lib/http.js';
import type { Metro } from './metros.js';

/**
 * Census Bureau American Community Survey, 1-year estimates: population,
 * income, rent, home value and rental vacancy for each metro. Public data,
 * free to republish. The API answers "Missing Key" without CENSUS_API_KEY,
 * which is free and instant at https://api.census.gov/data/key_signup.html.
 */

export const ACS_VARIABLES = {
  population: 'B01003_001E',
  medianIncome: 'B19013_001E',
  medianRent: 'B25064_001E',
  medianHomeValue: 'B25077_001E',
  occupied: 'B25003_001E',
  renterOccupied: 'B25003_003E',
  forRent: 'B25004_002E',
  rentedNotOccupied: 'B25004_003E',
  // Gross rent as a share of household income (renter households).
  burdenTotal: 'B25070_001E',
  burden30to35: 'B25070_007E',
  burden35to40: 'B25070_008E',
  burden40to50: 'B25070_009E',
  burden50plus: 'B25070_010E',
  burdenNotComputed: 'B25070_011E'
} as const;
export type AcsField = keyof typeof ACS_VARIABLES;
export type AcsRow = Record<AcsField, number | null>;

const MSA = 'metropolitan statistical area/micropolitan statistical area';
const DIVISION = 'metropolitan division';

/**
 * The API wants its geography clauses nearly raw: an encoded "/", ":" or ","
 * is not recognized and answers with an HTML error page, so only spaces are
 * escaped.
 */
const geo = (text: string) => text.replace(/ /g, '%20');

/** The request URLs for one survey year: one for whole metros, one per parent metro for divisions. */
export function acsUrls(year: number, metros: Metro[], apiKey?: string): string[] {
  const get = `NAME,${Object.values(ACS_VARIABLES).join(',')}`;
  const base = `https://api.census.gov/data/${year}/acs/acs1?get=${get}`;
  const key = apiKey ? `&key=${encodeURIComponent(apiKey)}` : '';
  const urls: string[] = [];

  const whole = metros.filter((m) => !m.census.division).map((m) => m.census.msa);
  if (whole.length) urls.push(`${base}&for=${geo(`${MSA}:${whole.join(',')}`)}${key}`);

  const parents = [...new Set(metros.filter((m) => m.census.division).map((m) => m.census.msa))];
  for (const parent of parents) {
    const divisions = metros.filter((m) => m.census.division && m.census.msa === parent).map((m) => m.census.division);
    urls.push(
      `${base}&for=${geo(`${DIVISION}:${divisions.join(',')}`)}&in=${geo(`${MSA}:${parent}`)}${key}`
    );
  }
  return urls;
}

/**
 * Rows keyed by geography code (division code for a division). The API answers
 * with a header row then data rows, all strings; negative values are its codes
 * for "not available".
 */
export function parseAcs(table: string[][]): Map<string, AcsRow> {
  const [header, ...rows] = table;
  const out = new Map<string, AcsRow>();
  if (!header) return out;
  const geoColumn = header.includes(DIVISION) ? header.indexOf(DIVISION) : header.indexOf(MSA);
  for (const row of rows) {
    const geo = row[geoColumn];
    if (!geo) continue;
    const values = {} as AcsRow;
    for (const [field, variable] of Object.entries(ACS_VARIABLES) as [AcsField, string][]) {
      const raw = row[header.indexOf(variable)];
      const value = raw == null || raw === '' ? NaN : Number(raw);
      values[field] = Number.isFinite(value) && value >= 0 ? value : null;
    }
    out.set(geo, values);
  }
  return out;
}

export function censusKey(metro: Metro): string {
  return metro.census.division ?? metro.census.msa;
}

export async function fetchAcsYear(
  year: number,
  metros: Metro[],
  options: FetchJsonOptions & { apiKey?: string } = {}
): Promise<Map<string, AcsRow>> {
  const { apiKey, ...http } = options;
  const out = new Map<string, AcsRow>();
  for (const url of acsUrls(year, metros, apiKey)) {
    const text = await fetchText(url, { ...http, accept: 'application/json' });
    // A year that is not out yet answers 204 with no body, or 404.
    if (!text.trim()) throw new Error(`ACS ${year} returned no data`);
    // Errors come back as a 200 with an HTML or plain-text explanation.
    if (!text.trimStart().startsWith('[')) {
      const reason = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
      throw new Error(`ACS ${year}: ${reason}`);
    }
    for (const [geo, row] of parseAcs(JSON.parse(text) as string[][])) out.set(geo, row);
  }
  return out;
}

export interface AcsResult {
  year: number;
  current: Map<string, AcsRow>;
  /** The year before, for growth; empty if it could not be read. */
  previous: Map<string, AcsRow>;
}

/**
 * The newest 1-year release that answers, and the year before it. Each
 * September brings the previous year's release, so the search starts there
 * and walks back. 2020 is skipped: the Census did not publish standard 1-year
 * estimates for it.
 */
export async function fetchAcs(
  metros: Metro[],
  options: FetchJsonOptions & { apiKey?: string; now?: Date } = {}
): Promise<AcsResult> {
  const { now = new Date(), ...rest } = options;
  const errors: string[] = [];
  for (let year = now.getUTCFullYear() - 1; year >= now.getUTCFullYear() - 4; year--) {
    if (year === 2020) continue;
    let current: Map<string, AcsRow>;
    try {
      current = await fetchAcsYear(year, metros, rest);
    } catch (error) {
      errors.push(`${year}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const before = year - 1 === 2020 ? 2019 : year - 1;
    const previous = await fetchAcsYear(before, metros, rest).catch(() => new Map<string, AcsRow>());
    return { year, current, previous };
  }
  throw new Error(`No ACS 1-year release answered (${errors.join('; ')})`);
}

export function rentalVacancy(row: AcsRow | undefined): number | null {
  if (!row) return null;
  const { forRent, renterOccupied, rentedNotOccupied } = row;
  if (forRent == null || renterOccupied == null || rentedNotOccupied == null) return null;
  const stock = forRent + renterOccupied + rentedNotOccupied;
  return stock > 0 ? (forRent / stock) * 100 : null;
}

export function renterShare(row: AcsRow | undefined): number | null {
  if (!row?.occupied || row.renterOccupied == null) return null;
  return (row.renterOccupied / row.occupied) * 100;
}

/** Renters whose income is known: B25070's total minus "not computed". */
function burdenBase(row: AcsRow): number | null {
  if (row.burdenTotal == null) return null;
  const base = row.burdenTotal - (row.burdenNotComputed ?? 0);
  return base > 0 ? base : null;
}

/** Percent of renters paying 30% or more of income on rent and utilities (HUD's "cost burdened"). */
export function rentBurdened(row: AcsRow | undefined): number | null {
  if (!row) return null;
  const base = burdenBase(row);
  const parts = [row.burden30to35, row.burden35to40, row.burden40to50, row.burden50plus];
  if (base == null || parts.some((v) => v == null)) return null;
  return (parts.reduce<number>((a, b) => a + (b ?? 0), 0) / base) * 100;
}

/** Percent of renters paying 50% or more ("severely cost burdened"). */
export function rentSeverelyBurdened(row: AcsRow | undefined): number | null {
  if (!row) return null;
  const base = burdenBase(row);
  if (base == null || row.burden50plus == null) return null;
  return (row.burden50plus / base) * 100;
}

export function growth(now: number | null | undefined, before: number | null | undefined): number | null {
  if (now == null || before == null || before === 0) return null;
  return ((now - before) / before) * 100;
}
