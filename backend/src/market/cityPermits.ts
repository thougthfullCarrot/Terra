import { fetchJson, type FetchJsonOptions } from '../lib/http.js';
import { developerLink } from './developers.js';
import type { Development } from './developments.js';

/**
 * City of San Antonio building permits, to fill in the development map.
 *
 * The state's TABS register (developments.ts) only lists projects that file
 * for an accessibility review, and the map keeps the biggest of those. The
 * city's own Development Services permits, published daily on its open data
 * portal (free, no key), catch the rest of what is going up inside city
 * limits: apartments, warehouses, shops, restaurants and offices. Each
 * building of a project gets its own permit, so permits at one address are one
 * project.
 */

const CKAN = 'https://data.sanantonio.gov/api/3/action';
/** "PERMITS ISSUED" in the Building Permits dataset: everything issued since January of last year. */
export const COSA_PERMITS_RESOURCE = 'c21106f9-3ef5-4f3a-8604-f992b4db7512';
export const COSA_DATASET_URL = 'https://data.sanantonio.gov/dataset/building-permits';

/** Permit types that mean a building going up, and what to call the work. */
const TYPES: Record<string, string> = {
  'Comm New Building Permit': 'New construction',
  'Comm Shell Permit': 'New construction',
  'Comm Addition Permit': 'Addition'
};

/** Smaller projects are mostly sheds, canopies and kiosks. */
export const MIN_VALUE = 1_000_000;
/** How many city-permit projects the San Antonio map adds. */
export const COSA_MAX = 80;
/** Building permits stay open while the work goes on; older than this is most likely finished. */
const MONTHS = 18;

/** One row of the permits file; the datastore keeps every column as text. */
export interface PermitRow {
  'PERMIT TYPE': string | null;
  'PERMIT #': string | null;
  'PROJECT NAME': string | null;
  'WORK TYPE': string | null;
  ADDRESS: string | null;
  X_COORD: string | number | null;
  Y_COORD: string | number | null;
  'DATE SUBMITTED': string | null;
  'DATE ISSUED': string | null;
  'DECLARED VALUATION': string | number | null;
  'AREA (SF)': string | number | null;
  'PRIMARY CONTACT': string | null;
}

/** Names that mean public money: schools, the city and county, utilities, transit, universities. */
const PUBLIC = /^(?:SCH|CDD)\b|ISD\b|independent school|elementary|middle school|high school|\bcity of\b|bexar county|police|\bSAPD\b|fire station|library|\bSAWS\b|\bCPS\b|\bVIA\b|universit|\bUTSA\b|college/i;

const num = (value: string | number | null | undefined) => {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Texas South Central state plane (NAD83, US feet; EPSG:2278) to latitude and
 * longitude. Older rows carry their point in these feet, newer ones in degrees.
 */
export function statePlaneToLatLng(x: number, y: number): [number, number] {
  const a = 6378137;
  const f = 1 / 298.257222101;
  const e = Math.sqrt(2 * f - f * f);
  const rad = Math.PI / 180;
  const ft = 1200 / 3937;
  const [phi1, phi2, phi0, lam0] = [30 + 17 / 60, 28 + 23 / 60, 27 + 50 / 60, -99].map((d) => d * rad) as [number, number, number, number];
  const m = (phi: number) => Math.cos(phi) / Math.sqrt(1 - (e * Math.sin(phi)) ** 2);
  const t = (phi: number) => Math.tan(Math.PI / 4 - phi / 2) / ((1 - e * Math.sin(phi)) / (1 + e * Math.sin(phi))) ** (e / 2);
  const n = (Math.log(m(phi1)) - Math.log(m(phi2))) / (Math.log(t(phi1)) - Math.log(t(phi2)));
  const F = m(phi1) / (n * t(phi1) ** n);
  const rho0 = a * F * t(phi0) ** n;
  const dx = x * ft - 600000;
  const dy = rho0 - (y * ft - 4000000);
  const rho = Math.sign(n) * Math.sqrt(dx * dx + dy * dy);
  const tt = (rho / (a * F)) ** (1 / n);
  let phi = Math.PI / 2 - 2 * Math.atan(tt);
  for (let i = 0; i < 8; i++) {
    phi = Math.PI / 2 - 2 * Math.atan(tt * ((1 - e * Math.sin(phi)) / (1 + e * Math.sin(phi))) ** (e / 2));
  }
  const lam = Math.atan2(dx, dy) / n + lam0;
  return [phi / rad, lam / rad];
}

/** A row's point in degrees, whichever way it was written; null when missing or outside Bexar County. */
export function permitPoint(row: Pick<PermitRow, 'X_COORD' | 'Y_COORD'>): [number, number] | null {
  const x = num(row.X_COORD);
  const y = num(row.Y_COORD);
  if (!x || !y) return null;
  const at: [number, number] = Math.abs(x) <= 180 && Math.abs(y) <= 90 ? [y, x] : statePlaneToLatLng(x, y);
  const [lat, lng] = at;
  return lat > 28.9 && lat < 29.9 && lng > -99.1 && lng < -98.0 ? [Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6] : null;
}

/** The city's program codes in front of a name: special projects, affordable housing, schools, community development. */
const CODE = /^(SPC|AFF|SCH|CDD(?:-SP)?)\b\s*-?\s*/i;

/**
 * "SPC Hyatt - Event Barn Building Bldg No: 17" → "Hyatt - Event Barn Building",
 * "AFF - 23219 N US HWY 281 B1 - STONES CROSSING" → "23219 N US HWY 281 - STONES CROSSING";
 * the city's placeholder names → null.
 */
export function projectName(raw: string | null): string | null {
  const name = (raw ?? '')
    .replace(/\s*;?\s*Unit No:.*$/i, '')
    .replace(/^Building No:.*$/i, '')
    .replace(/\s*[-–,]?\s*\b(?:Bldg|Bld|Building)\.?\s*(?:No\.?)?\s*[:#]?\s*\d.*$/i, '')
    .replace(CODE, '')
    .replace(/(?:^|\s)(?:B#\s*\d+\w*|B-?\d+\w*|Pkg#\s*\d+|#\w+)(?=[\s-]|$)/gi, ' ')
    .replace(/-?\s*Pkg#\s*\d+\s*-?/gi, ' - ')
    .replace(/\s*-\s*(?:Building|Main)\s*$/i, '')
    .replace(/\s+-(\s+-)+/g, ' -')
    .replace(/^[\s-]+|[\s-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return name && !/^n\/?a$/i.test(name) ? name : null;
}

/** "8751 STATE HWY 151, City of San Antonio, TX 78245" → "8751 State Hwy 151, San Antonio, TX 78245". */
export function tidyAddress(raw: string | null): string | null {
  if (!raw?.trim()) return null;
  const [street = '', ...rest] = raw.split(',');
  const words = street
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\b(Ih|Us|Fm|Se|Sw|Ne|Nw|Loop)\b/g, (w) => (w === 'Loop' ? w : w.toUpperCase()));
  const tail = rest.join(',').replace(/city of /i, '').replace(/\s+/g, ' ').trim();
  return tail ? `${words}, ${tail.replace(/^san antonio/i, 'San Antonio')}` : words;
}

/** The key that makes permits at one site one project: street number and street name. */
export const siteKey = (address: string | null) =>
  (address ?? '')
    .split(',')[0]!
    .toUpperCase()
    .replace(/\s+BLDG.*$/, '')
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const isoDay = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null);

/** The first day of permits still worth showing: MONTHS back. */
export function permitCutoff(now: Date): string {
  const since = new Date(now);
  since.setUTCMonth(since.getUTCMonth() - MONTHS);
  return since.toISOString().slice(0, 10);
}

/** Group a building-permit list into projects at their sites, biggest first. */
export function permitProjects(rows: PermitRow[], now: Date, max = COSA_MAX): Development[] {
  const cutoff = permitCutoff(now);
  const sites = new Map<string, PermitRow[]>();
  for (const row of rows) {
    if (!TYPES[row['PERMIT TYPE'] ?? '']) continue;
    const issued = isoDay(row['DATE ISSUED']);
    if (!issued || issued < cutoff) continue;
    const key = siteKey(row.ADDRESS);
    if (!/^\d/.test(key)) continue;
    sites.set(key, [...(sites.get(key) ?? []), row]);
  }
  const projects: Development[] = [];
  for (const permits of sites.values()) {
    // Each building's permit repeats the whole project's value, so the
    // biggest one is the project, not their sum.
    const lead = permits.reduce((best, p) => (num(p['DECLARED VALUATION']) > num(best['DECLARED VALUATION']) ? p : best));
    const cost = Math.round(num(lead['DECLARED VALUATION']));
    if (cost < MIN_VALUE || cost > 2e9) continue;
    const address = tidyAddress(lead.ADDRESS);
    const at = permits.map(permitPoint).find(Boolean) ?? null;
    const issued = permits.map((p) => isoDay(p['DATE ISSUED'])!).sort();
    const squareFeet = Math.round(new Set(permits.map((p) => p['PERMIT #'])).size > 1 ? permits.reduce((s, p) => s + num(p['AREA (SF)']), 0) : num(lead['AREA (SF)']));
    const buildings = new Set(permits.map((p) => p['PERMIT #'])).size;
    const name = permits.map((p) => projectName(p['PROJECT NAME'])).find(Boolean) ?? address?.split(',')[0] ?? 'Building permit';
    const rawNames = permits.map((p) => p['PROJECT NAME'] ?? '').join(' | ');
    const contact = lead['PRIMARY CONTACT']?.trim() || null;
    const link = developerLink(null, name, 'San Antonio');
    projects.push({
      id: `COSA-${lead['PERMIT #'] ?? siteKey(lead.ADDRESS)}`,
      city: 'San Antonio',
      place: 'San Antonio',
      name,
      facility: buildings > 1 ? `${buildings} building permits` : null,
      status: 'City permit issued',
      work: TYPES[lead['PERMIT TYPE'] ?? ''] ?? 'New construction',
      cost,
      registered: issued[0]!,
      start: issued[0]!,
      end: null,
      address,
      owner: null,
      tenant: null,
      designFirm: null,
      contact,
      scope: null,
      squareFeet: squareFeet > 0 ? squareFeet : null,
      isPublic: PUBLIC.test(rawNames) || PUBLIC.test(name),
      lat: at?.[0] ?? null,
      lng: at?.[1] ?? null,
      approximate: false,
      developerUrl: link.url,
      developerDirect: link.direct,
      url: COSA_DATASET_URL,
      source: 'city'
    });
  }
  // One project filed under a few addresses on the same tract (13210 Palo Alto
  // Rd and 13210 State Hwy 16) repeats its value: keep the first, preferring one with a point.
  projects.sort((a, b) => b.cost - a.cost || Number(b.lat != null) - Number(a.lat != null));
  const seen = new Set<string>();
  return projects
    .filter((p) => {
      const key = `${p.cost}|${/^\d+/.exec(p.address ?? '')?.[0] ?? p.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max);
}

interface DatastoreResponse {
  success?: boolean;
  result?: { total?: number; records?: PermitRow[] };
}

/** Every new-building and addition permit issued since `since` (YYYY-MM-DD), a page at a time. */
export async function fetchCityPermits(since: string, options: FetchJsonOptions = {}): Promise<PermitRow[]> {
  const rows: PermitRow[] = [];
  // The portal's read-only SQL takes plain comparisons (no functions).
  const types = Object.keys(TYPES)
    .map((t) => `'${t}'`)
    .join(',');
  for (let offset = 0; offset < 20_000; offset += 1000) {
    const sql = `SELECT * FROM "${COSA_PERMITS_RESOURCE}" WHERE "PERMIT TYPE" IN (${types}) AND "DATE ISSUED" >= '${since}' ORDER BY "_id" LIMIT 1000 OFFSET ${offset}`;
    const data = await fetchJson<DatastoreResponse>(`${CKAN}/datastore_search_sql?sql=${encodeURIComponent(sql)}`, {
      timeoutMs: 120_000,
      ...options,
      // The portal's firewall answers 502 to the collector's usual user agent.
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; TerraBot/0.1)', ...options.headers }
    });
    if (data.success === false) throw new Error('the permit search was refused');
    const page = data.result?.records ?? [];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

/**
 * San Antonio's city-permit projects that the TABS list does not already
 * have, matched by street address.
 */
export async function fetchSanAntonioPermits(now: Date, tabs: Development[], options: FetchJsonOptions = {}): Promise<Development[]> {
  const known = new Set(tabs.filter((p) => p.city === 'San Antonio').map((p) => siteKey(p.address)));
  const projects = permitProjects(await fetchCityPermits(permitCutoff(now), options), now, COSA_MAX + known.size);
  return projects.filter((p) => !known.has(siteKey(p.address))).slice(0, COSA_MAX);
}
