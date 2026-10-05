import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import type { City } from '../types.js';
import { monthName } from './csv.js';

/**
 * Redfin Data Center: the city market tracker, a free public gzipped TSV of
 * every US city's monthly sales figures (rolling three months). Redfin asks
 * for attribution, which the page's sources line gives. The file runs to
 * hundreds of megabytes, so it is streamed and only Texas lines are parsed.
 */

export const REDFIN_URL =
  'https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/city_market_tracker.tsv000.gz';

export interface RedfinReading {
  medianSalePrice: number | null;
  /** Percent change from a year earlier. */
  medianSalePriceYoy: number | null;
  inventory: number | null;
  medianDom: number | null;
  /** Average sale price as a percent of list price. */
  saleToList: number | null;
  periodEnd: string;
  period: string;
  seasonallyAdjusted: boolean;
}

const unquote = (field: string | undefined) => (field ?? '').trim().replace(/^"|"$/g, '');
const num = (field: string | undefined) => {
  const text = unquote(field);
  if (!text || text === 'NA') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};
const scaled = (value: number | null) => (value == null ? null : Math.round(value * 10_000) / 100);

/** Each wanted Texas city's latest "All Residential" row, from the tracker's lines (header first). */
export async function parseRedfinLines(lines: AsyncIterable<string> | Iterable<string>, cities: readonly City[]): Promise<Map<City, RedfinReading>> {
  let header: string[] | null = null;
  const out = new Map<City, RedfinReading>();
  for await (const line of lines) {
    if (!header) {
      header = line.split('\t').map((h) => unquote(h).toUpperCase());
      continue;
    }
    if (!line.includes('TX')) continue;
    const row = line.split('\t');
    const col = (name: string) => row[header!.indexOf(name)];
    if (unquote(col('STATE_CODE')) !== 'TX' || unquote(col('PROPERTY_TYPE')) !== 'All Residential') continue;
    const name = unquote(col('CITY')) || unquote(col('REGION')).replace(/, TX$/, '');
    const city = cities.find((c) => c === name);
    if (!city) continue;
    const periodEnd = unquote(col('PERIOD_END'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) continue;
    const seasonallyAdjusted = /^(t|true)$/i.test(unquote(col('IS_SEASONALLY_ADJUSTED')));
    const have = out.get(city);
    // Newest period wins; for the same period, the unadjusted figures (what sold).
    if (have && (have.periodEnd > periodEnd || (have.periodEnd === periodEnd && !(have.seasonallyAdjusted && !seasonallyAdjusted)))) continue;
    const [year, month] = periodEnd.split('-').map(Number) as [number, number];
    out.set(city, {
      medianSalePrice: num(col('MEDIAN_SALE_PRICE')),
      medianSalePriceYoy: scaled(num(col('MEDIAN_SALE_PRICE_YOY'))),
      inventory: num(col('INVENTORY')),
      medianDom: num(col('MEDIAN_DOM')),
      saleToList: scaled(num(col('AVG_SALE_TO_LIST'))),
      periodEnd,
      period: monthName(year, month),
      seasonallyAdjusted
    });
  }
  return out;
}

export async function fetchRedfin(cities: readonly City[], options: { timeoutMs?: number } = {}): Promise<Map<City, RedfinReading>> {
  const response = await fetch(REDFIN_URL, {
    headers: { 'user-agent': 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)' },
    signal: AbortSignal.timeout(options.timeoutMs ?? 900_000)
  });
  if (!response.ok || !response.body) throw new Error(`Redfin: HTTP ${response.status}`);
  const stream = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream).pipe(createGunzip());
  return parseRedfinLines(createInterface({ input: stream, crlfDelay: Infinity }), cities);
}
