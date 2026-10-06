import { fetchJson, type FetchJsonOptions } from '../lib/http.js';
import { METRO_COUNTIES } from '../market/developments.js';
import { CITIES, type City } from '../types.js';

/**
 * The distress tracker, from two free public lists:
 *
 *   Tax sales. Linebarger Goggan Blair & Sampson collects delinquent property
 *   taxes for most big Texas counties and posts every property headed to a
 *   sheriff's or constable's tax sale on its public site, with the auction
 *   date, the appraised value and the minimum bid (taxsales.lgbs.com). Its
 *   map reads a JSON list that needs no key. Travis, Comal, Lubbock and Collin
 *   use other firms or run their own sales, so they are not on it.
 *
 *   Harris County's biggest delinquent accounts. Harris County publishes the
 *   largest delinquent accounts its tax collection firm is suing on as a
 *   public map layer, with the taxes owed and the years behind. Only
 *   commercial, industrial and land accounts are kept; homes are left out.
 *
 * Foreclosure notices (trustee sales) are posted at each courthouse and filed
 * with the county clerk as scanned documents; no Terra county publishes them
 * as a list a program can read, so they are not counted.
 */

export interface TaxSale {
  id: string;
  city: City;
  county: string;
  address: string;
  place: string | null;
  zip: string | null;
  /** YYYY-MM-DD of the auction; null while it waits for a date. */
  saleDate: string | null;
  /** "Scheduled for auction", "Available for future sale", "Struck off" (the county bid it in and now sells it). */
  status: string;
  value: number | null;
  minimumBid: number | null;
  /** The court case number, which the county sale list is ordered by. */
  cause: string | null;
  notes: string | null;
  lat: number | null;
  lng: number | null;
  /** The auction listing or the county's sale list. */
  url: string | null;
}

export interface DelinquentAccount {
  account: string;
  /** The owner when it is a company or trust; null for a person. */
  owner: string | null;
  address: string;
  /** State property class: C (vacant land), F1 (commercial), F2 (industrial)... */
  code: string;
  value: number | null;
  taxDue: number | null;
  yearsDue: number | null;
  /** YYYY-MM-DD, when the case has reached these steps. */
  judgment: string | null;
  saleDate: string | null;
}

export interface DistressFile {
  generatedAt: string;
  sales: TaxSale[];
  delinquent: { county: string; asOf: string | null; accounts: DelinquentAccount[] } | null;
  /** Counties per market the tax sale list covers, for the source note. */
  counties: Partial<Record<City, string[]>>;
}

export const LGBS_API = 'https://taxsales.lgbs.com/api/property_sales/';
export const lgbsUrl = (county: string, offset = 0, limit = 200) =>
  `${LGBS_API}?${new URLSearchParams({ county: `${county.toUpperCase()} COUNTY`, limit: String(limit), offset: String(offset) })}`;

export interface LgbsRow {
  uid: number;
  county: string;
  cause_nbr?: string | null;
  sale_date_only?: string | null;
  sale_type?: string | null;
  status?: string | null;
  prop_address_one?: string | null;
  prop_city?: string | null;
  prop_zipcode?: string | null;
  value?: string | null;
  minimum_bid?: string | null;
  sale_notes?: string | null;
  property_loc?: string | null;
  county_sale_list?: string | null;
  geometry?: { coordinates?: [number, number] } | null;
}

const money = (v: string | null | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());

export function statusLabel(row: LgbsRow): string {
  const status = (row.status ?? '').toLowerCase();
  if (status.includes('cancel')) return 'Cancelled';
  if (status.includes('scheduled')) return status.includes('online') ? 'Online auction' : 'Courthouse auction';
  if ((row.sale_type ?? '').toUpperCase() === 'STRUCK OFF') return 'Struck off (county-owned)';
  return 'Waiting for a sale date';
}

/** One listing in Terra's shape, or null when cancelled or without an address. */
export function readSale(row: LgbsRow, city: City, county: string): TaxSale | null {
  const status = statusLabel(row);
  const address = (row.prop_address_one ?? '').replace(/\s+/g, ' ').trim();
  if (status === 'Cancelled' || !address || (/^0\s/.test(address) && !row.geometry)) return null;
  const [lng, lat] = row.geometry?.coordinates ?? [];
  const notes = (row.sale_notes ?? '').replace(/\*+/g, '').replace(/\s+/g, ' ').trim();
  const link = [row.property_loc, row.county_sale_list].find((u) => u && /^https?:\/\//.test(u)) ?? null;
  return {
    id: String(row.uid),
    city,
    county,
    address: titleCase(address),
    place: row.prop_city ? titleCase(row.prop_city.trim()) : null,
    zip: /^\d{5}/.exec(row.prop_zipcode ?? '')?.[0] ?? null,
    saleDate: /^\d{4}-\d{2}-\d{2}$/.test(row.sale_date_only ?? '') ? row.sale_date_only! : null,
    status,
    value: money(row.value),
    minimumBid: money(row.minimum_bid),
    cause: row.cause_nbr?.trim() || null,
    notes: notes ? notes.slice(0, 200) : null,
    lat: typeof lat === 'number' ? Math.round(lat * 1e5) / 1e5 : null,
    lng: typeof lng === 'number' ? Math.round(lng * 1e5) / 1e5 : null,
    url: link
  };
}

/** Listings without an auction date kept per market, the highest-valued first. */
export const UNSCHEDULED_PER_CITY = 60;

/**
 * Every listing with an auction date, plus each market's most valuable ones
 * still waiting for a date or struck off. The full lists run to thousands of
 * small lots, which would make the page slow to load.
 */
export function trimSales(sales: TaxSale[], perCity = UNSCHEDULED_PER_CITY): TaxSale[] {
  const scheduled = sales.filter((s) => s.saleDate);
  const rest = new Map<City, TaxSale[]>();
  for (const s of sales) if (!s.saleDate) (rest.get(s.city) ?? rest.set(s.city, []).get(s.city)!).push(s);
  const top = [...rest.values()].flatMap((list) => list.sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, perCity));
  return [...scheduled, ...top];
}

export interface DistressOptions extends FetchJsonOptions {
  log?: (line: string) => void;
  /** Most listings read per county. */
  maxPerCounty?: number;
}

/** Every market county's listings, paged. A county the firm doesn't collect for answers with none. */
export async function fetchTaxSales(cities: readonly City[] = CITIES, options: DistressOptions = {}): Promise<{ sales: TaxSale[]; counties: DistressFile['counties'] }> {
  const { log = () => {}, maxPerCounty = 1000, ...http } = options;
  const sales: TaxSale[] = [];
  const counties: DistressFile['counties'] = {};
  for (const city of cities) {
    for (const county of METRO_COUNTIES[city] ?? []) {
      let read = 0;
      let kept = 0;
      try {
        for (let offset = 0; offset < maxPerCounty; offset += 200) {
          const body = await fetchJson<{ count?: number; results?: LgbsRow[]; next?: string | null }>(lgbsUrl(county, offset), { timeoutMs: 60_000, ...http });
          for (const row of body.results ?? []) {
            read++;
            const sale = readSale(row, city, county);
            // Galveston County is in two metros' lists; keep its listings under the first.
            if (sale && !sales.some((s) => s.id === sale.id)) {
              sales.push(sale);
              kept++;
            }
          }
          if (!body.next) break;
        }
      } catch (error) {
        log(`${county} County: ${error instanceof Error ? error.message : error}`);
      }
      if (read) (counties[city] ??= []).push(county);
      if (read) log(`${county} County (${city}): ${kept} of ${read} listings kept.`);
    }
  }
  return { sales: trimSales(sales), counties };
}

// ---------------------------------------------------------------- Harris delinquent

export const HARRIS_DELINQUENT =
  'https://services5.arcgis.com/GtNPpPrhcOMhYgh4/arcgis/rest/services/Tax_Delinquent_Parcels/FeatureServer/0';

/** Commercial (F), vacant land (C, D) and industrial or utility (F2, J, L) classes: not homes. */
export const NON_RESIDENTIAL = /^(C|D|F|J|L)/i;

const COMPANY = /\b(LLC|L L C|LP|L P|LLP|LTD|INC|CORP|CORPORATION|COMPANY|CO|TRUST|PARTNERS|PARTNERSHIP|HOLDINGS|PROPERTIES|INVESTMENTS|FUND|ASSOCIATES|VENTURES|GROUP|CAPITAL|REALTY|ENTERPRISES|CHURCH|MINISTRIES|BANK)\b/i;
export const isCompany = (owner: string) => COMPANY.test(owner);

type Attrs = Record<string, string | number | null | undefined>;

const epoch = (v: unknown) => (typeof v === 'number' && v > 0 ? new Date(v).toISOString().slice(0, 10) : null);
const amount = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null);

/** The taxes-owed field carries its as-of date in its name ("HCTO_Tax_P_I_02_12_2026"). */
export function taxDueField(fields: string[]): { field: string; asOf: string } | null {
  for (const name of fields) {
    const m = /^HCTO_Tax_P_I_(\d{2})_(\d{2})_(\d{4})$/.exec(name);
    if (m) return { field: name, asOf: `${m[3]}-${m[1]}-${m[2]}` };
  }
  return null;
}

/** One account in Terra's shape, or null for a home or a record missing what the list shows. */
export function readDelinquent(a: Attrs, taxField: string | null): DelinquentAccount | null {
  const code = String(a.state_class ?? '').trim();
  if (!NON_RESIDENTIAL.test(code)) return null;
  const owner = String(a.Owner ?? a.owner_name_1 ?? '').replace(/\s+/g, ' ').trim();
  const address = String(a.Address ?? '').replace(/\s+/g, ' ').trim() ||
    [a.site_str_num, a.site_str_name, a.site_str_sfx, a.site_city].map((p) => String(p ?? '').trim()).filter(Boolean).join(' ');
  if (!address) return null;
  const years = Number(a.Years_Count ?? a.Years_Due);
  return {
    account: String(a.HCAD_NUM ?? a.acct_num ?? '').trim(),
    // A person's name is left off: the list is about properties, not people.
    owner: isCompany(owner) ? owner : null,
    address: titleCase(address),
    code,
    value: amount(a.HCAD_Value) ?? amount(a.total_appraised_val),
    taxDue: taxField ? amount(a[taxField]) : null,
    yearsDue: Number.isFinite(years) && years > 0 ? years : null,
    judgment: epoch(a.Judgement_Date),
    saleDate: epoch(a.Sale_Date)
  };
}

/** The list, biggest balance first. Only the public columns are asked for. */
export async function fetchHarrisDelinquent(options: DistressOptions = {}): Promise<DistressFile['delinquent']> {
  const { log = () => {}, ...http } = options;
  const meta = await fetchJson<{ fields?: { name: string }[] }>(`${HARRIS_DELINQUENT}?f=json`, { timeoutMs: 60_000, ...http });
  const names = (meta.fields ?? []).map((f) => f.name);
  const tax = taxDueField(names);
  const wanted = ['HCAD_NUM', 'acct_num', 'Owner', 'owner_name_1', 'Address', 'site_str_num', 'site_str_name', 'site_str_sfx', 'site_city', 'state_class', 'HCAD_Value', 'total_appraised_val', 'Years_Count', 'Years_Due', 'Judgement_Date', 'Sale_Date', ...(tax ? [tax.field] : [])].filter((f) => names.includes(f));
  const params = new URLSearchParams({ f: 'json', where: '1=1', outFields: wanted.join(','), returnGeometry: 'false', resultRecordCount: '500' });
  const body = await fetchJson<{ features?: { attributes: Attrs }[] }>(`${HARRIS_DELINQUENT}/query?${params}`, { timeoutMs: 60_000, ...http });
  const accounts = (body.features ?? [])
    .map((f) => readDelinquent(f.attributes, tax?.field ?? null))
    .filter((a): a is DelinquentAccount => Boolean(a))
    .sort((a, b) => (b.taxDue ?? 0) - (a.taxDue ?? 0));
  log(`Harris delinquent: ${accounts.length} commercial or land accounts of ${body.features?.length ?? 0}.`);
  return { county: 'Harris', asOf: tax?.asOf ?? null, accounts };
}
