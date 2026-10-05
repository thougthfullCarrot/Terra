import { fetchText, type FetchJsonOptions } from '../lib/http.js';
import { csvLines, csvNumber, monthName, parseCsvLine } from './csv.js';
import type { Metro } from './metros.js';

/**
 * Realtor.com Economic Research: monthly inventory core metrics by metro
 * (CBSA), a free CSV with every month since 2016. Metro-wide, so Dallas and
 * Fort Worth share the Dallas-Fort Worth-Arlington figures.
 */

export const REALTOR_URL = 'https://econdata.s3-us-west-2.amazonaws.com/Reports/Core/RDC_Inventory_Core_Metrics_Metro.csv';

export interface RealtorReading {
  medianListingPrice: number | null;
  activeListings: number | null;
  medianDom: number | null;
  /** Percent of listings with a price cut. */
  priceReducedShare: number | null;
  period: string;
}

/** The latest month for each CBSA code asked for. */
export function parseRealtorMetro(text: string, cbsas: readonly string[]): Map<string, RealtorReading> {
  const [head, ...rows] = csvLines(text).map(parseCsvLine);
  const out = new Map<string, RealtorReading & { month: string }>();
  if (!head) return new Map();
  const at = (name: string) => head.indexOf(name);
  for (const row of rows) {
    const cbsa = (row[at('cbsa_code')] ?? '').trim();
    const month = (row[at('month_date_yyyymm')] ?? '').trim();
    if (!cbsas.includes(cbsa) || !/^\d{6}$/.test(month)) continue;
    if ((out.get(cbsa)?.month ?? '') >= month) continue;
    const share = csvNumber(row[at('price_reduced_share')]);
    out.set(cbsa, {
      month,
      medianListingPrice: csvNumber(row[at('median_listing_price')]),
      activeListings: csvNumber(row[at('active_listing_count')]),
      medianDom: csvNumber(row[at('median_days_on_market')]),
      // Published as a fraction (0.21); older files used a percent.
      priceReducedShare: share == null ? null : share <= 1 ? Math.round(share * 10_000) / 100 : share,
      period: monthName(Number(month.slice(0, 4)), Number(month.slice(4)))
    });
  }
  return new Map([...out].map(([cbsa, { month: _month, ...reading }]) => [cbsa, reading]));
}

export async function fetchRealtor(metros: readonly Metro[], options: FetchJsonOptions = {}): Promise<Map<string, RealtorReading>> {
  const text = await fetchText(REALTOR_URL, { timeoutMs: 120_000, ...options, accept: 'text/csv' });
  return parseRealtorMetro(text, [...new Set(metros.map((m) => m.census.msa))]);
}
