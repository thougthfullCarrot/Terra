import { HttpError, fetchText, type FetchJsonOptions } from '../lib/http.js';
import type { City } from '../types.js';
import { monthName } from './csv.js';

/**
 * Building permits each city issued for new homes, from the Census Bureau's
 * Building Permits Survey place files: what each city's permit office reports
 * every month, in one format for all six cities. Public data, no key.
 *
 * The city open-data portals were the first idea, but only Austin's and San
 * Antonio's are current (Dallas's stopped in 2020, Fort Worth's moved,
 * Houston and El Paso publish no permit list), and each counts differently,
 * so they could not be ranked against each other.
 *
 * Read from the year-to-date file (soYYMMy.txt), compared with the same
 * months a year earlier, which smooths out one-off large projects.
 */

const BASE = 'https://www2.census.gov/econ/bps/Place/South%20Region';

export function permitFileUrl(year: number, month: number): string {
  return `${BASE}/so${String(year % 100).padStart(2, '0')}${String(month).padStart(2, '0')}y.txt`;
}

export interface PermitCounts {
  /** New housing units authorized, all building sizes. */
  units: number;
  /** Units in buildings of five or more: apartments. */
  multifamilyUnits: number;
}

/**
 * Texas rows (state code 48) for the wanted cities. Columns: date, state, …,
 * place name at 16, then buildings, units and value for 1-unit, 2-unit,
 * 3-4 unit and 5+ unit buildings.
 */
export function parsePermitFile(text: string, cities: readonly City[]): Map<City, PermitCounts> {
  const out = new Map<City, PermitCounts>();
  for (const line of text.split('\n')) {
    const row = line.split(',').map((field) => field.trim());
    if (row[1] !== '48' || !/^\d{6}$/.test(row[0] ?? '')) continue;
    const city = cities.find((c) => c === row[16]);
    if (!city || out.has(city)) continue;
    const n = (index: number) => Number(row[index]) || 0;
    out.set(city, { units: n(18) + n(21) + n(24) + n(27), multifamilyUnits: n(27) });
  }
  return out;
}

export interface PermitResult {
  current: Map<City, PermitCounts>;
  previous: Map<City, PermitCounts>;
  /** e.g. "Jan–Aug 2026". */
  period: string;
}

/**
 * The newest year-to-date file, found by walking back from last month (the
 * Census publishes each month's about four weeks after it ends), and the same
 * file a year earlier.
 */
export async function fetchPermits(
  cities: readonly City[],
  options: FetchJsonOptions & { now?: Date } = {}
): Promise<PermitResult> {
  const { now = new Date(), ...http } = options;
  const read = (year: number, month: number) => fetchText(permitFileUrl(year, month), { timeoutMs: 60_000, ...http, accept: 'text/plain' });
  for (let back = 1; back <= 6; back++) {
    const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const year = at.getUTCFullYear();
    const month = at.getUTCMonth() + 1;
    let text: string;
    try {
      text = await read(year, month);
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) continue;
      throw error;
    }
    const current = parsePermitFile(text, cities);
    if (!current.size) continue;
    const previous = parsePermitFile(await read(year - 1, month).catch(() => ''), cities);
    const period = month === 1 ? monthName(year, 1) : `${monthName(year, 1).slice(0, 3)}–${monthName(year, month)}`;
    return { current, previous, period };
  }
  throw new Error('No Building Permits Survey file in the last six months');
}
