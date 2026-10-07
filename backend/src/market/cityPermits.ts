import { fetchJson, type FetchJsonOptions } from '../lib/http.js';
import type { City } from '../types.js';
import { developerLink } from './developers.js';
import type { Development } from './developments.js';

/**
 * City building permits, to fill in the development maps.
 *
 * The state's TABS register (developments.ts) only lists projects that file
 * for an accessibility review, and each map keeps the biggest of those. The
 * cities that publish their building permits as free open data with no key
 * catch much of the rest of what is going up inside their limits:
 * apartments, warehouses, shops, restaurants and offices.
 *
 * Covered: San Antonio, Austin, Fort Worth and Arlington (on the Fort Worth
 * map). Checked and not available as of October 2026: Houston (no permit
 * data), Dallas (stops at fiscal 2024), El Paso, Lubbock, Midland, Galveston,
 * New Braunfels (no public portal); College Station publishes permits without
 * a value, so the biggest cannot be picked.
 *
 * Each source reads new-building, shell and addition permits issued in the
 * last MONTHS months, worth MIN_VALUE or more, and not finished or void.
 * Every building of a project gets its own permit, so permits of one project
 * (one address, or one master permit) are grouped into one pin.
 */

/** Smaller projects are mostly sheds, canopies and kiosks. */
export const MIN_VALUE = 1_000_000;
/** How many city-permit projects each source adds to its map. */
export const CITY_MAX = 150;
/** Building permits stay open while the work goes on; older than this is most likely finished. */
const MONTHS = 18;
/** Some portals' firewalls answer 502 to the collector's usual user agent. */
const BROWSERISH = { 'user-agent': 'Mozilla/5.0 (compatible; TerraBot/0.1)' };

/** One permit from any city, in one shape. */
export interface CityPermit {
  market: City;
  /** The city that issued it, for the map ("San Antonio"). */
  place: string;
  permit: string;
  /** Permits sharing this key are one project. */
  group: string;
  name: string | null;
  /** Raw names and descriptions, to tell public projects. */
  text: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  /** YYYY-MM-DD. */
  issued: string;
  value: number;
  squareFeet: number;
  work: 'New construction' | 'Addition';
  owner: string | null;
  contact: string | null;
  scope: string | null;
  url: string;
}

/** Names that mean public money: schools, cities and counties, utilities, transit, universities. */
const PUBLIC = /^(?:SCH|CDD)\b|ISD\b|independent school|elementary|middle school|high school|\bcity of\b|\bcounty\b|police|\bSAPD\b|fire station|library|\bSAWS\b|\bCPS\b|\bVIA\b|universit|\bUTSA\b|\bUT\b|college|\bAISD\b|\bFWISD\b|state of texas/i;

const num = (value: string | number | null | undefined) => {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const isoDay = (value: string | number | null | undefined): string | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? new Date(value).toISOString().slice(0, 10) : null;
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
};
const clip = (text: string | null | undefined, max = 300) => {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 3).trimEnd()}…` : t;
};
/** A point inside Texas, or null. */
const texas = (lat: number, lng: number): [number, number] | null =>
  lat > 25.8 && lat < 36.6 && lng > -106.7 && lng < -93.5 ? [Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6] : null;

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

/** "8751 STATE HWY 151" → "8751 State Hwy 151". */
export function tidyStreet(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\b(Ih|Us|Fm|Se|Sw|Ne|Nw|Sh|Rm)\b/g, (w) => w.toUpperCase());
}

/** "8751 STATE HWY 151, City of San Antonio, TX 78245" → "8751 State Hwy 151, San Antonio, TX 78245". */
export function tidyAddress(raw: string | null): string | null {
  if (!raw?.trim()) return null;
  const [street = '', ...rest] = raw.split(',');
  const tail = rest.join(',').replace(/city of /i, '').replace(/\s+/g, ' ').trim();
  const town = tail.replace(/^([^,]*?)(?=,|\s+(?:TX|TEXAS)\b|$)/i, (t) => tidyStreet(t));
  return tail ? `${tidyStreet(street)}, ${town}` : tidyStreet(street);
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


/** The first day of permits still worth showing: MONTHS back. */
export function permitCutoff(now: Date): string {
  const since = new Date(now);
  since.setUTCMonth(since.getUTCMonth() - MONTHS);
  return since.toISOString().slice(0, 10);
}

/** Group one source's permits into projects, biggest first. */
export function permitProjects(permits: CityPermit[], now: Date, max = CITY_MAX): Development[] {
  const cutoff = permitCutoff(now);
  const groups = new Map<string, CityPermit[]>();
  for (const p of permits) {
    if (p.issued < cutoff || !p.group) continue;
    groups.set(p.group, [...(groups.get(p.group) ?? []), p]);
  }
  const projects: Development[] = [];
  for (const group of groups.values()) {
    // Each building's permit often repeats the whole project's value, so the
    // biggest one is the project, not their sum.
    const lead = group.reduce((best, p) => (p.value > best.value ? p : best));
    const cost = Math.round(lead.value);
    if (cost < MIN_VALUE || cost > 3e9) continue;
    const at = group.find((p) => p.lat != null && p.lng != null);
    const issued = group.map((p) => p.issued).sort();
    const buildings = new Set(group.map((p) => p.permit)).size;
    const squareFeet = Math.round(group.reduce((sum, p) => sum + p.squareFeet, 0));
    const name = group.map((p) => p.name).find(Boolean) ?? lead.address?.split(',')[0] ?? 'Building permit';
    const owner = group.map((p) => p.owner).find(Boolean) ?? null;
    const link = developerLink(owner, name, lead.market);
    projects.push({
      id: `CITY-${lead.place.replace(/\W+/g, '')}-${lead.permit}`,
      city: lead.market,
      place: lead.place,
      name,
      facility: buildings > 1 ? `${buildings} building permits` : null,
      status: 'City permit issued',
      work: lead.work,
      cost,
      registered: issued[0]!,
      start: issued[0]!,
      end: null,
      address: lead.address,
      owner,
      tenant: null,
      designFirm: null,
      contact: group.map((p) => p.contact).find(Boolean) ?? null,
      scope: lead.scope,
      squareFeet: squareFeet > 0 ? squareFeet : null,
      isPublic: group.some((p) => PUBLIC.test(p.text)) || PUBLIC.test(name) || PUBLIC.test(owner ?? ''),
      lat: at?.lat ?? null,
      lng: at?.lng ?? null,
      approximate: false,
      developerUrl: link.url,
      developerDirect: link.direct,
      url: lead.url,
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

// --- San Antonio: Development Services on the city's CKAN portal, daily. ---

const COSA_CKAN = 'https://data.sanantonio.gov/api/3/action';
/** "PERMITS ISSUED" in the Building Permits dataset: everything issued since January of last year. */
export const COSA_PERMITS_RESOURCE = 'c21106f9-3ef5-4f3a-8604-f992b4db7512';
export const COSA_DATASET_URL = 'https://data.sanantonio.gov/dataset/building-permits';
const COSA_TYPES: Record<string, CityPermit['work']> = {
  'Comm New Building Permit': 'New construction',
  'Comm Shell Permit': 'New construction',
  'Comm Addition Permit': 'Addition'
};

/** One row of the San Antonio permits file; the datastore keeps every column as text. */
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

export function sanAntonioPermit(row: PermitRow): CityPermit | null {
  const work = COSA_TYPES[row['PERMIT TYPE'] ?? ''];
  const issued = isoDay(row['DATE ISSUED']);
  if (!work || !issued) return null;
  const at = permitPoint(row);
  return {
    market: 'San Antonio',
    place: 'San Antonio',
    permit: row['PERMIT #'] ?? siteKey(row.ADDRESS),
    group: /^\d/.test(siteKey(row.ADDRESS)) ? siteKey(row.ADDRESS) : '',
    name: projectName(row['PROJECT NAME']),
    text: row['PROJECT NAME'] ?? '',
    address: tidyAddress(row.ADDRESS),
    lat: at?.[0] ?? null,
    lng: at?.[1] ?? null,
    issued,
    value: num(row['DECLARED VALUATION']),
    squareFeet: num(row['AREA (SF)']),
    work,
    owner: null,
    contact: row['PRIMARY CONTACT']?.trim() || null,
    scope: null,
    url: COSA_DATASET_URL
  };
}

interface CkanResponse {
  success?: boolean;
  result?: { records?: PermitRow[] };
}

export async function fetchSanAntonio(now: Date, options: FetchJsonOptions = {}): Promise<CityPermit[]> {
  const rows: PermitRow[] = [];
  // The portal's read-only SQL takes plain comparisons (no functions); its
  // datastore_search filters answer 502.
  const types = Object.keys(COSA_TYPES)
    .map((t) => `'${t}'`)
    .join(',');
  for (let offset = 0; offset < 20_000; offset += 1000) {
    const sql = `SELECT * FROM "${COSA_PERMITS_RESOURCE}" WHERE "PERMIT TYPE" IN (${types}) AND "DATE ISSUED" >= '${permitCutoff(now)}' ORDER BY "_id" LIMIT 1000 OFFSET ${offset}`;
    const data = await fetchJson<CkanResponse>(`${COSA_CKAN}/datastore_search_sql?sql=${encodeURIComponent(sql)}`, {
      timeoutMs: 120_000,
      ...options,
      headers: { ...BROWSERISH, ...options.headers }
    });
    if (data.success === false) throw new Error('the permit search was refused');
    const page = data.result?.records ?? [];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows.map(sanAntonioPermit).filter((p): p is CityPermit => p !== null);
}

// --- Austin: Issued Construction Permits on the city's Socrata portal, daily. ---

export const AUSTIN_PERMITS_URL = 'https://data.austintexas.gov/resource/3syk-w9eu.json';
const AUSTIN_DONE = /^(final|expired|void|withdrawn|cancel)/i;

/** One Austin permit, the columns read here. */
export interface AustinRow {
  permit_number?: string;
  permit_class?: string;
  work_class?: string;
  permit_location?: string;
  description?: string;
  issue_date?: string;
  status_current?: string;
  total_job_valuation?: string;
  total_new_add_sqft?: string;
  latitude?: string;
  longitude?: string;
  masterpermitnum?: string;
  contractor_company_name?: string;
  original_city?: string;
  original_zip?: string;
  link?: { url?: string };
}

export function austinPermit(row: AustinRow): CityPermit | null {
  const issued = isoDay(row.issue_date);
  if (!issued || AUSTIN_DONE.test(row.status_current ?? '')) return null;
  const street = (row.permit_location ?? '').replace(/\s+(?:BLDG|UNIT|STE)\b.*$/i, '').trim();
  const town = tidyStreet(row.original_city || 'Austin');
  const at = texas(num(row.latitude), num(row.longitude));
  return {
    market: 'Austin',
    place: town,
    permit: row.permit_number ?? street,
    group: row.masterpermitnum || siteKey(street),
    // Descriptions name parts ("Fire Area 2", "Upper Clubhouse Level B1"), not projects.
    name: null,
    text: `${row.description ?? ''} ${row.permit_class ?? ''}`,
    address: street ? `${tidyStreet(street)}, ${town}, TX${row.original_zip ? ` ${row.original_zip}` : ''}` : null,
    lat: at?.[0] ?? null,
    lng: at?.[1] ?? null,
    issued,
    value: num(row.total_job_valuation),
    squareFeet: num(row.total_new_add_sqft),
    work: /addition/i.test(row.work_class ?? '') ? 'Addition' : 'New construction',
    owner: null,
    contact: row.contractor_company_name?.replace(/\*+[^*]*\*+/g, '').trim() || null,
    scope: clip(row.description?.replace(/^ePlan:\s*/i, '')),
    url: row.link?.url ?? 'https://data.austintexas.gov/d/3syk-w9eu'
  };
}

export async function fetchAustin(now: Date, options: FetchJsonOptions = {}): Promise<CityPermit[]> {
  const where = `permittype='BP' AND permit_class_mapped='Commercial' AND work_class in('New','Shell','Addition') AND issue_date>='${permitCutoff(now)}' AND total_job_valuation>=${MIN_VALUE}`;
  const rows: AustinRow[] = [];
  for (let offset = 0; offset < 20_000; offset += 1000) {
    const url = `${AUSTIN_PERMITS_URL}?$where=${encodeURIComponent(where)}&$order=${encodeURIComponent('permit_number')}&$limit=1000&$offset=${offset}`;
    const page = await fetchJson<AustinRow[]>(url, { timeoutMs: 120_000, ...options, headers: { ...BROWSERISH, ...options.headers } });
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows.map(austinPermit).filter((p): p is CityPermit => p !== null);
}

// --- ArcGIS feature layers: Fort Worth and Arlington. ---

interface ArcgisResponse<A> {
  features?: { attributes: A; geometry?: { x?: number; y?: number } }[];
  exceededTransferLimit?: boolean;
  error?: { message?: string };
}

/** Every feature matching `where`, a page at a time, points in degrees. */
async function arcgisAll<A>(layer: string, where: string, fields: string, options: FetchJsonOptions): Promise<ArcgisResponse<A>['features'] & {}> {
  const out: NonNullable<ArcgisResponse<A>['features']> = [];
  for (let offset = 0; offset < 20_000; offset += 1000) {
    const url = `${layer}/query?where=${encodeURIComponent(where)}&outFields=${encodeURIComponent(fields)}&returnGeometry=true&outSR=4326&resultOffset=${offset}&resultRecordCount=1000&f=json`;
    const data = await fetchJson<ArcgisResponse<A>>(url, { timeoutMs: 120_000, ...options, headers: { ...BROWSERISH, ...options.headers } });
    if (data.error) throw new Error(data.error.message ?? 'the layer refused the query');
    const page = data.features ?? [];
    out.push(...page);
    if (!data.exceededTransferLimit && page.length < 1000) break;
  }
  return out;
}

const arcgisDate = (d: string) => `DATE '${d}'`;
const ARCGIS_DONE = /^(finaled|void|expired|withdrawn|cancel|closed)/i;

export const FORT_WORTH_LAYER = 'https://mapit.fortworthtexas.gov/ags/rest/services/CIVIC/Permits/MapServer/0';
export const FORT_WORTH_DATA_URL = 'https://data.fortworthtexas.gov/';

/** One Fort Worth development permit, the columns read here. */
export interface FortWorthRow {
  Permit_No?: string | null;
  Permit_SubType?: string | null;
  B1_SPECIAL_TEXT?: string | null;
  B1_WORK_DESC?: string | null;
  Address?: string | null;
  Addr_No?: number | null;
  Direction?: string | null;
  Street_Name?: string | null;
  Street_Suffix?: string | null;
  Zip_Code?: string | number | null;
  Owner_Full_Name?: string | null;
  File_Date?: number | null;
  Status_Date?: number | null;
  Current_Status?: string | null;
  Latitude?: number | null;
  Longitude?: number | null;
  JobValue?: number | string | null;
  Use_Type?: string | null;
  Specific_Use?: string | null;
  SqFt?: string | null;
}

/** "X TEAM /// Edged Energy Outpost Building 2" → "Edged Energy Outpost Building 2". */
export function fortWorthName(raw: string | null | undefined): string | null {
  const name = (raw ?? '').replace(/^.*\/\/\/\s*/, '').replace(/\s+/g, ' ').trim();
  return name && !/^n\/?a$/i.test(name) ? name : null;
}

export function fortWorthPermit(row: FortWorthRow, geometry?: { x?: number; y?: number }): CityPermit | null {
  const issued = isoDay(row.Status_Date ?? row.File_Date ?? null);
  if (!issued || ARCGIS_DONE.test(row.Current_Status ?? '')) return null;
  const street = (row.Address?.split(',')[0] ?? [row.Addr_No, row.Direction, row.Street_Name, row.Street_Suffix].filter(Boolean).join(' ')).trim();
  const at = texas(num(row.Latitude ?? geometry?.y), num(row.Longitude ?? geometry?.x));
  const special = row.B1_SPECIAL_TEXT?.trim();
  return {
    market: 'Fort Worth',
    place: 'Fort Worth',
    permit: row.Permit_No ?? street,
    // Placeholder addresses ("26060032 For Review Only Way") are not sites.
    group: /for review only/i.test(street) ? '' : siteKey(street),
    name: fortWorthName(special),
    text: `${special ?? ''} ${row.B1_WORK_DESC ?? ''} ${row.Owner_Full_Name ?? ''} ${row.Use_Type ?? ''}`,
    address: street ? `${tidyStreet(street)}, Fort Worth, TX${row.Zip_Code ? ` ${row.Zip_Code}` : ''}` : null,
    lat: at?.[0] ?? null,
    lng: at?.[1] ?? null,
    issued,
    value: num(row.JobValue),
    squareFeet: num(row.SqFt),
    work: /addition/i.test(row.Permit_SubType ?? '') ? 'Addition' : 'New construction',
    owner: row.Owner_Full_Name?.trim() || null,
    contact: null,
    scope: clip(row.B1_WORK_DESC === 'B1_WORK_DESC' ? null : row.B1_WORK_DESC),
    url: FORT_WORTH_DATA_URL
  };
}

export async function fetchFortWorth(now: Date, options: FetchJsonOptions = {}): Promise<CityPermit[]> {
  const where = `Permit_Type = 'Commercial Building Permit' AND Permit_SubType IN ('New','Addition') AND File_Date >= ${arcgisDate(permitCutoff(now))} AND JobValue >= ${MIN_VALUE}`;
  const features = await arcgisAll<FortWorthRow>(FORT_WORTH_LAYER, where, '*', options);
  return features.map((f) => fortWorthPermit(f.attributes, f.geometry)).filter((p): p is CityPermit => p !== null);
}

export const ARLINGTON_LAYER = 'https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Property/MapServer/1';
export const ARLINGTON_DATA_URL = 'https://opendata.arlingtontx.gov/';

/** One Arlington issued permit, the columns read here. */
export interface ArlingtonRow {
  FOLDERYEAR?: string | null;
  FOLDERSEQUENCE?: string | null;
  STATUSDESC?: string | null;
  ISSUEDATE?: number | null;
  SUBDESC?: string | null;
  WORKDESC?: string | null;
  FOLDERNAME?: string | null;
  ConstructionValuationDeclared?: number | null;
  NameofBusiness?: string | null;
  MainUse?: string | null;
}

export function arlingtonPermit(row: ArlingtonRow, geometry?: { x?: number; y?: number }): CityPermit | null {
  const issued = isoDay(row.ISSUEDATE ?? null);
  if (!issued || ARCGIS_DONE.test(row.STATUSDESC ?? '')) return null;
  const street = (row.FOLDERNAME ?? '').replace(/\s+(?:BLDG|UNIT|STE)\b.*$/i, '').trim();
  const at = texas(num(geometry?.y), num(geometry?.x));
  const use = row.MainUse?.trim();
  return {
    market: 'Fort Worth',
    place: 'Arlington',
    permit: `${row.FOLDERYEAR ?? ''}-${row.FOLDERSEQUENCE ?? street}`,
    group: siteKey(street),
    name: row.NameofBusiness?.trim() || (use ? `${use.replace(/\s*\(.*\)$/, '')} at ${tidyStreet(street)}` : null),
    text: `${row.NameofBusiness ?? ''} ${row.SUBDESC ?? ''} ${use ?? ''}`,
    address: street ? `${tidyStreet(street)}, Arlington, TX` : null,
    lat: at?.[0] ?? null,
    lng: at?.[1] ?? null,
    issued,
    value: num(row.ConstructionValuationDeclared),
    squareFeet: 0,
    work: /addition/i.test(row.WORKDESC ?? '') ? 'Addition' : 'New construction',
    owner: null,
    contact: null,
    scope: [row.SUBDESC, use].filter(Boolean).join(' · ') || null,
    url: ARLINGTON_DATA_URL
  };
}

export async function fetchArlington(now: Date, options: FetchJsonOptions = {}): Promise<CityPermit[]> {
  const where = `FOLDERTYPE = 'CP' AND WORKDESC IN ('New Construction','Addition') AND ISSUEDATE >= ${arcgisDate(permitCutoff(now))} AND ConstructionValuationDeclared >= ${MIN_VALUE}`;
  const fields = 'FOLDERYEAR,FOLDERSEQUENCE,STATUSDESC,ISSUEDATE,SUBDESC,WORKDESC,FOLDERNAME,ConstructionValuationDeclared,NameofBusiness,MainUse';
  const features = await arcgisAll<ArlingtonRow>(ARLINGTON_LAYER, where, fields, options);
  return features.map((f) => arlingtonPermit(f.attributes, f.geometry)).filter((p): p is CityPermit => p !== null);
}

// --- All sources. ---

export interface PermitSource {
  name: string;
  market: City;
  fetch: (now: Date, options: FetchJsonOptions) => Promise<CityPermit[]>;
}

export const PERMIT_SOURCES: PermitSource[] = [
  { name: 'San Antonio', market: 'San Antonio', fetch: fetchSanAntonio },
  { name: 'Austin', market: 'Austin', fetch: fetchAustin },
  { name: 'Fort Worth', market: 'Fort Worth', fetch: fetchFortWorth },
  { name: 'Arlington', market: 'Fort Worth', fetch: fetchArlington }
];

/**
 * Each covered market's city-permit projects that the TABS list does not
 * already have (matched by street address). A source that fails is logged
 * and skipped; the map keeps its TABS projects.
 */
export async function fetchCityPermitProjects(
  cities: readonly City[],
  now: Date,
  tabs: Development[],
  options: FetchJsonOptions & { log?: (line: string) => void; sources?: PermitSource[] } = {}
): Promise<Development[]> {
  const { log = () => {}, sources = PERMIT_SOURCES, ...http } = options;
  const out: Development[] = [];
  for (const source of sources) {
    if (!cities.includes(source.market)) continue;
    try {
      const known = new Set([...tabs, ...out].filter((p) => p.city === source.market).map((p) => siteKey(p.address)));
      const projects = permitProjects(await source.fetch(now, http), now, CITY_MAX + known.size)
        .filter((p) => !known.has(siteKey(p.address)))
        .slice(0, CITY_MAX);
      out.push(...projects);
      log(`${source.name} city permits: ${projects.length} more projects`);
    } catch (error) {
      log(`${source.name} city permits: not read (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return out;
}
