import { fetchJson, type FetchJsonOptions } from '../lib/http.js';
import type { Metro } from './metros.js';

/**
 * Bureau of Labor Statistics: metro employment by industry (Current
 * Employment Statistics, state and area) and the unemployment rate (Local Area
 * Unemployment Statistics). Public data, free to republish.
 *
 * Without a key the API is v1: 25 series per request and 25 requests a day per
 * address. With BLS_API_KEY (free registration) it is v2: 50 series and 500 a
 * day. site.yml caches the result for a day either way, since these figures
 * change once a month.
 */

const V1 = 'https://api.bls.gov/publicAPI/v1/timeseries/data/';
const V2 = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';

/**
 * CES supersectors read for each metro. Values are thousands of jobs, not
 * seasonally adjusted, so growth is always compared month to same month.
 */
export const INDUSTRIES = {
  total: '00000000',
  /** Some metros only publish construction folded into mining and logging. */
  construction: '20000000',
  miningConstruction: '15000000',
  manufacturing: '30000000',
  tradeTransportUtilities: '40000000',
  retail: '42000000',
  information: '50000000',
  financial: '55000000',
  professional: '60000000'
} as const;
export type Industry = keyof typeof INDUSTRIES;

export interface Point {
  year: number;
  /** 1-12. */
  month: number;
  value: number;
}

export function cesSeries(metro: Metro, industry: Industry): string {
  // SMU + state + area + industry + data type (01 = all employees, thousands).
  return `SMU48${metro.area}${INDUSTRIES[industry]}01`;
}

export function unemploymentSeries(metro: Metro): string {
  // LAU + area code + measure (03 = unemployment rate).
  return `LAU${metro.laus}03`;
}

interface BlsResponse {
  status?: string;
  message?: string[];
  Results?: { series?: { seriesID: string; data?: { year: string; period: string; value: string }[] }[] };
}

/** Monthly points per series, oldest first. Annual averages (M13) and blank values are dropped. */
export function parseBls(body: BlsResponse): Map<string, Point[]> {
  const out = new Map<string, Point[]>();
  for (const series of body.Results?.series ?? []) {
    const points: Point[] = [];
    for (const row of series.data ?? []) {
      const month = /^M(0[1-9]|1[0-2])$/.exec(row.period)?.[1];
      const value = Number(row.value);
      if (!month || !row.value?.trim() || !Number.isFinite(value)) continue;
      points.push({ year: Number(row.year), month: Number(month), value });
    }
    points.sort((a, b) => a.year - b.year || a.month - b.month);
    if (points.length) out.set(series.seriesID, points);
  }
  return out;
}

export interface BlsOptions extends FetchJsonOptions {
  apiKey?: string;
  now?: Date;
}

/**
 * Fetch every series, in as few requests as the API allows. A request the API
 * refuses (quota, unknown series) throws, so the caller can fall back to the
 * last good copy instead of publishing blanks.
 */
export async function fetchBls(seriesIds: string[], options: BlsOptions = {}): Promise<Map<string, Point[]>> {
  const { apiKey, now = new Date(), ...http } = options;
  const size = apiKey ? 50 : 25;
  const year = now.getUTCFullYear();
  const out = new Map<string, Point[]>();

  for (let i = 0; i < seriesIds.length; i += size) {
    const chunk = seriesIds.slice(i, i + size);
    const body: Record<string, unknown> = {
      seriesid: chunk,
      // Three calendar years always holds the latest month and the same month a year before it.
      startyear: String(year - 2),
      endyear: String(year)
    };
    if (apiKey) body.registrationkey = apiKey;
    const response = await fetchJson<BlsResponse>(apiKey ? V2 : V1, { ...http, method: 'POST', body });
    // A series a metro does not publish only adds a message; a refused
    // request (daily quota) comes back with no data at all.
    const parsed = parseBls(response);
    if (response.status !== 'REQUEST_SUCCEEDED' && parsed.size === 0) {
      throw new Error(`BLS refused the request: ${(response.message ?? []).join(' ') || response.status}`);
    }
    for (const [id, points] of parsed) out.set(id, points);
  }
  return out;
}

/** Add (or with a -1 weight, subtract) series month by month, over the months all of them report. */
export function combine(parts: { points: Point[] | undefined; weight: number }[]): Point[] | undefined {
  if (!parts.length || parts.some((part) => !part.points?.length)) return undefined;
  const key = (p: Point) => p.year * 100 + p.month;
  const maps = parts.map((part) => new Map(part.points!.map((p) => [key(p), p.value])));
  const result: Point[] = [];
  for (const p of parts[0]!.points!) {
    const k = key(p);
    if (!maps.every((map) => map.has(k))) continue;
    const value = parts.reduce((sum, part, index) => sum + part.weight * maps[index]!.get(k)!, 0);
    result.push({ year: p.year, month: p.month, value });
  }
  return result.length ? result : undefined;
}

export function latest(points: Point[] | undefined): Point | undefined {
  return points?.[points.length - 1];
}

/** Percent change from the same month a year earlier, or null when that month is missing. */
export function yearOverYear(points: Point[] | undefined): number | null {
  const last = latest(points);
  if (!last) return null;
  const before = points!.find((p) => p.year === last.year - 1 && p.month === last.month);
  if (!before || before.value === 0) return null;
  return ((last.value - before.value) / before.value) * 100;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthLabel(point: Point | undefined): string | null {
  return point ? `${MONTHS[point.month - 1]} ${point.year}` : null;
}
