import { fetchJson, type FetchJsonOptions } from '../lib/http.js';
import type { City } from '../types.js';
import { METRO_COUNTIES } from './developments.js';

/**
 * Open public construction bids per market, for the list under the
 * development map.
 *
 * The one free source that works for an automated reader: TxDOT's "Project
 * Information" dataset on the state's open data portal (data.texas.gov,
 * Socrata, no key, refreshed hourly). It lists every highway and building
 * contract TxDOT and the local agencies it lets for are taking bids on, with
 * the county and the time bids close.
 *
 * Checked and skipped as of October 2026: the Comptroller's Electronic State
 * Business Daily (txsmartbuy.gov/esbd) draws its list with JavaScript and its
 * robots.txt disallows every path; Dallas's open data "Bid Data" stopped in
 * 2024; Austin, Fort Worth and San Antonio publish no solicitation feed on
 * their portals.
 */

export const TXDOT_PROJECTS_URL = 'https://data.texas.gov/resource/drau-zphx.json';
/** The dataset's page, where a bidder finds the project by its CSJ. */
export const TXDOT_PROJECTS_PAGE = 'https://data.texas.gov/d/drau-zphx';
/** Bids shown per market: the soonest to close. */
export const BIDS_PER_CITY = 12;

export interface Bid {
  city: City;
  title: string;
  agency: string;
  /** When bids close, local Texas time as published (YYYY-MM-DDTHH:MM). */
  due: string;
  county: string;
  /** TxDOT's control-section-job number, the id bidders search by. */
  csj: string | null;
  url: string;
}

export interface BidsResult {
  asOf: string;
  source: string;
  bids: Bid[];
}

/** One row of the TxDOT dataset, the columns read here. */
export interface TxdotProjectRow {
  project_name?: string;
  project_description?: string;
  county?: string;
  district_division?: string;
  local_agency_name?: string;
  let_type_description?: string;
  bid_received_until_date_and?: string;
  control_section_job_csj?: string;
  project_sub_type_description?: string;
}

const countyKey = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');

/** County → market, from the development map's counties ("De Witt" matches "DeWitt"). */
export function countyMarkets(cities: readonly City[]): Map<string, City> {
  const out = new Map<string, City>();
  for (const city of cities) for (const county of METRO_COUNTIES[city] ?? []) if (!out.has(countyKey(county))) out.set(countyKey(county), city);
  return out;
}

/** "2026-11-03T13:00:00.000" → "2026-11-03T13:00". */
const localTime = (value: string | undefined) => (value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) ? value.slice(0, 16) : null);

export function txdotBid(row: TxdotProjectRow, markets: Map<string, City>, now: Date): Bid | null {
  const city = markets.get(countyKey(row.county ?? ''));
  const due = localTime(row.bid_received_until_date_and);
  // Supply orders ("Hot Mix - DeWitt Co. (Materials Only)") are not construction.
  if (!city || !due || /material/i.test(row.project_sub_type_description ?? '')) return null;
  if (due < now.toISOString().slice(0, 16)) return null;
  const title = (row.project_name || row.project_description || '').replace(/\s+/g, ' ').trim();
  if (!title) return null;
  const local = row.local_agency_name?.trim();
  const district = row.district_division?.trim();
  return {
    city,
    title,
    agency: local && !/^n\/?a$/i.test(local) ? local : district ? `TxDOT ${district} District` : 'TxDOT',
    due,
    county: row.county!.trim(),
    csj: row.control_section_job_csj?.trim() || null,
    url: TXDOT_PROJECTS_PAGE
  };
}

/** Each market's soonest-closing bids, at most `perCity`. */
export function pickBids(bids: Bid[], perCity = BIDS_PER_CITY): Bid[] {
  const seen = new Set<string>();
  const counts = new Map<City, number>();
  return [...bids]
    .sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title))
    .filter((bid) => {
      const key = `${bid.city}|${bid.csj ?? bid.title}`;
      if (seen.has(key) || (counts.get(bid.city) ?? 0) >= perCity) return false;
      seen.add(key);
      counts.set(bid.city, (counts.get(bid.city) ?? 0) + 1);
      return true;
    });
}

const FIELDS = [
  'project_name',
  'project_description',
  'county',
  'district_division',
  'local_agency_name',
  'let_type_description',
  'bid_received_until_date_and',
  'control_section_job_csj',
  'project_sub_type_description'
];

export async function fetchBids(cities: readonly City[], options: FetchJsonOptions & { now?: Date } = {}): Promise<BidsResult> {
  const { now = new Date(), ...http } = options;
  // The timestamps are Texas local time with no zone; a day's slack keeps
  // today's bids, and txdotBid drops the ones already closed.
  const since = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 19);
  const url = `${TXDOT_PROJECTS_URL}?$select=${FIELDS.join(',')}&$where=${encodeURIComponent(`bid_received_until_date_and >= '${since}'`)}&$order=bid_received_until_date_and&$limit=5000`;
  const rows = await fetchJson<TxdotProjectRow[]>(url, { timeoutMs: 60_000, ...http });
  const markets = countyMarkets(cities);
  const bids = rows.map((row) => txdotBid(row, markets, now)).filter((b): b is Bid => b !== null);
  return { asOf: now.toISOString(), source: TXDOT_PROJECTS_PAGE, bids: pickBids(bids) };
}
