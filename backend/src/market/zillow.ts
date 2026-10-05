import { fetchText, type FetchJsonOptions } from '../lib/http.js';
import type { City } from '../types.js';
import { csvLines, latestMonthly, parseCsvLine, type MonthlyReading } from './csv.js';

/**
 * Zillow Research: the Zillow Home Value Index (typical home value) and the
 * Zillow Observed Rent Index (typical asking rent), monthly, for each city.
 * Free public CSVs; Zillow asks for attribution, which the page's sources
 * line gives. City files rather than metro ones, so Dallas and Fort Worth get
 * their own figures.
 */

const BASE = 'https://files.zillowstatic.com/research/public_csvs';
export const ZILLOW_FILES = {
  homeValue: `${BASE}/zhvi/City_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv`,
  rent: `${BASE}/zori/City_zori_uc_sfrcondomfr_sm_month.csv`
} as const;

/** Columns are month-end dates: 2026-08-31. */
function dateColumn(column: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(column);
  return match ? { year: Number(match[1]), month: Number(match[2]) } : null;
}

/**
 * Each wanted Texas city's latest reading. The home value file is large
 * (every US city), so only lines that mention Texas are parsed.
 */
export function parseZillowCities(text: string, cities: readonly City[]): Map<City, MonthlyReading> {
  const lines = csvLines(text);
  const header = parseCsvLine(lines[0] ?? '');
  const name = header.indexOf('RegionName');
  const type = header.indexOf('RegionType');
  const state = header.indexOf('State') >= 0 ? header.indexOf('State') : header.indexOf('StateName');
  const out = new Map<City, MonthlyReading>();
  for (const line of lines.slice(1)) {
    if (!line.includes(',TX,')) continue;
    const row = parseCsvLine(line);
    const city = cities.find((c) => c === row[name]);
    if (!city || row[state] !== 'TX' || (type >= 0 && row[type] !== 'city') || out.has(city)) continue;
    const reading = latestMonthly(header, row, dateColumn);
    if (reading) out.set(city, reading);
  }
  return out;
}

export interface ZillowResult {
  homeValue: Map<City, MonthlyReading>;
  rent: Map<City, MonthlyReading>;
}

export async function fetchZillow(cities: readonly City[], options: FetchJsonOptions = {}): Promise<ZillowResult> {
  const read = (url: string) => fetchText(url, { timeoutMs: 120_000, ...options, accept: 'text/csv' });
  const [homeValue, rent] = await Promise.all([read(ZILLOW_FILES.homeValue), read(ZILLOW_FILES.rent)]);
  return { homeValue: parseZillowCities(homeValue, cities), rent: parseZillowCities(rent, cities) };
}
