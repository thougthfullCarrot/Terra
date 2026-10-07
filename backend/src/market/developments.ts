import { fetchBuffer, fetchJson, fetchText, type FetchJsonOptions } from '../lib/http.js';
import { unzip, xmlText } from '../lib/xlsx.js';
import type { City } from '../types.js';
import { fetchSanAntonioPermits } from './cityPermits.js';
import { developerLink } from './developers.js';

/**
 * Current development projects from TDLR's Texas Architectural Barriers
 * System (TABS). Every commercial or public building project in Texas costing
 * $50,000 or more must register there before construction, with its address,
 * owner, cost and dates, and the registry is public with no key. That makes
 * it the one free, statewide, up-to-date list of what is being built.
 *
 * Each build reads the biggest new buildings and additions each city
 * registered in the last year, then each project's public page for the
 * address and owner, then places the address with the Census geocoder (also
 * free, no key). The geocoder only knows addresses on its street ranges, so
 * a brand-new address often misses; those go at the center of their ZIP code
 * (Census ZCTA centers) and the map says the spot is approximate. Projects
 * already read on an earlier build keep their page and coordinates, so a
 * normal day reads only the new filings.
 */

const TABS = 'https://www.tdlr.texas.gov/TABS';
export const TABS_SEARCH_URL = `${TABS}/Search/SearchProjects`;
export const tabsProjectUrl = (number: string) => `${TABS}/Search/Project/${number}`;
/** The public link TDLR prints on each project page. */
export const tabsPermalink = (number: string) => `${TABS}/Projects/${number}`;

/** TABS location county ids, from the search form's county list. */
export const TABS_COUNTY_IDS: Record<string, string> = {
  Harris: '2101',
  Galveston: '2084',
  'Fort Bend': '2079',
  Montgomery: '2167',
  Brazoria: '2020',
  Dallas: '2057',
  Collin: '2043',
  Denton: '2061',
  Rockwall: '2199',
  Kaufman: '2129',
  Ellis: '2070',
  Tarrant: '2220',
  Parker: '2184',
  Johnson: '2126',
  Wise: '2249',
  Travis: '2227',
  Williamson: '2246',
  Hays: '2105',
  Bastrop: '2011',
  Bexar: '2015',
  Guadalupe: '2094',
  Medina: '2160',
  Kendall: '2130',
  Wilson: '2247',
  Comal: '2046',
  'El Paso': '2071',
  // Read off the filter-location-county list on the TABS search page.
  Brazos: '2021',
  Burleson: '2026',
  Robertson: '2198',
  Lubbock: '2152',
  Midland: '2162',
  Ector: '2068'
};

/**
 * The counties each market's map covers: the whole metro, each county in one
 * market only (Comal goes to New Braunfels, Tarrant and its west side to Fort
 * Worth, the rest of the Metroplex to Dallas). The one exception is Galveston
 * County, on both the Houston map (Rod asked for it there) and Galveston's.
 * Midland's map takes in Odessa (Ector County) too.
 */
export const METRO_COUNTIES: Partial<Record<City, string[]>> = {
  Houston: ['Harris', 'Galveston', 'Fort Bend', 'Montgomery', 'Brazoria'],
  Dallas: ['Dallas', 'Collin', 'Denton', 'Rockwall', 'Kaufman', 'Ellis'],
  'Fort Worth': ['Tarrant', 'Parker', 'Johnson', 'Wise'],
  Austin: ['Travis', 'Williamson', 'Hays', 'Bastrop'],
  'San Antonio': ['Bexar', 'Guadalupe', 'Medina', 'Kendall', 'Wilson'],
  'New Braunfels': ['Comal'],
  'El Paso': ['El Paso'],
  'College Station': ['Brazos', 'Burleson', 'Robertson'],
  Galveston: ['Galveston'],
  Lubbock: ['Lubbock'],
  Midland: ['Midland', 'Ector']
};

/** How far from the metro's center a geocode may land before it counts as a wrong match. */
export const METRO_RADIUS_KM: Record<City, number> = {
  Dallas: 80,
  'Fort Worth': 80,
  Houston: 90,
  Austin: 80,
  'San Antonio': 80,
  'El Paso': 50,
  'New Braunfels': 50,
  'College Station': 60,
  Galveston: 50,
  Lubbock: 50,
  Midland: 60
};

/** Rough city centers, to drop a geocode that landed in the wrong place. */
export const CITY_CENTERS: Record<City, [number, number]> = {
  Dallas: [32.7767, -96.797],
  'Fort Worth': [32.7555, -97.3308],
  Houston: [29.7604, -95.3698],
  Austin: [30.2672, -97.7431],
  'San Antonio': [29.4241, -98.4936],
  'El Paso': [31.7619, -106.485],
  'New Braunfels': [29.703, -98.1245],
  'College Station': [30.628, -96.3344],
  Galveston: [29.3013, -94.7977],
  Lubbock: [33.5779, -101.8552],
  Midland: [31.9973, -102.0779]
};

const STATUS: Record<number, string> = {
  3001: 'Inspection complete',
  3002: 'Inspection under way',
  3003: 'Inspection scheduled',
  3004: 'Plan review',
  3005: 'Registered',
  3006: 'Plan review pending',
  3007: 'Closed',
  3008: 'Registered',
  3009: 'Plans reviewed',
  3010: 'Plan review pending'
};
/** Finished or closed: no longer a current development. */
const DONE = new Set([3001, 3007]);

const WORK: Record<number, string> = { 9001: 'New construction', 9003: 'Addition' };

/** One row of the TABS search results. */
export interface TabsRow {
  ProjectNumber: string;
  ProjectName: string;
  ProjectCreatedOn: string;
  ProjectStatus: number;
  FacilityName: string | null;
  City: number;
  County?: number;
  TypeOfWork: number;
  EstimatedCost: number;
  EstimatedStartDate: string | null;
  EstimatedEndDate: string | null;
}

export interface Development {
  /** TABS project number. */
  id: string;
  /** The market whose map shows it. */
  city: City;
  /** The city or town the project is actually in ("Galveston"), when known. */
  place: string | null;
  name: string;
  facility: string | null;
  status: string;
  work: string;
  cost: number;
  /** YYYY-MM-DD the project registered. */
  registered: string;
  start: string | null;
  end: string | null;
  address: string | null;
  owner: string | null;
  tenant: string | null;
  designFirm: string | null;
  scope: string | null;
  squareFeet: number | null;
  /** Public money or public land (schools, cities, universities, roads). */
  isPublic: boolean;
  lat: number | null;
  lng: number | null;
  /** True when the point is the ZIP code's center, not the street address. */
  approximate: boolean;
  /** The developer's website, or a search for it when not listed (see developerLink). */
  developerUrl: string;
  developerDirect: boolean;
  /** The project's public TDLR page, or the city permit dataset. */
  url: string;
  /** Where the project came from: the state's TABS register (the default) or a city's building permits. */
  source?: 'tabs' | 'city';
  /** The permit's primary contact (often the architect or permit expediter), for city permits. */
  contact?: string | null;
}

export interface DevelopmentsResult {
  asOf: string;
  projects: Development[];
}

/**
 * How far back to read filings. Big projects take two years or more to build,
 * so a one-year window dropped buildings still going up (Rod saw them missing
 * in San Antonio); finished ones fall out by status or end date.
 */
export const LOOKBACK_DAYS = 730;
/** A project whose estimated end passed this long ago is most likely finished, just not closed out. */
const FINISHED_DAYS = 120;

/** How many TABS projects each metro's map shows: the biggest by cost. */
export const PER_CITY = 120;
/** Filings above this are typos (a $20 billion school), not projects. */
const MAX_COST = 5e9;

const isoDate = (value: string | null | undefined) => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null);
const usDate = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;

/** The form DataTables posts: one county's biggest projects first, registered since `since`. */
export function searchForm(county: string, since: Date, until: Date, length = 200): Record<string, string> {
  return {
    draw: '1',
    start: '0',
    length: String(length),
    'order[0][column]': '9',
    'order[0][dir]': 'desc',
    'columns[9][data]': 'EstimatedCost',
    LocationCounty: TABS_COUNTY_IDS[county] ?? '',
    RegistrationDateBegin: usDate(since),
    RegistrationDateEnd: usDate(until),
    DataVersionId: '900001'
  };
}

/** A school costs a few hundred million at most; more is an extra digit in the filing. */
const MAX_SCHOOL_COST = 4e8;
const SCHOOL = /\bISD\b|independent school|elementary|middle school|high school/i;

/** New buildings and additions still under way, without highway segments or typo costs. */
export function currentDevelopments(rows: TabsRow[], now = new Date()): TabsRow[] {
  const finished = new Date(now.getTime() - FINISHED_DAYS * 86_400_000).toISOString().slice(0, 10);
  return rows.filter((r) => {
    const names = `${r.ProjectName} ${r.FacilityName ?? ''}`;
    const end = isoDate(r.EstimatedEndDate);
    return (
      WORK[r.TypeOfWork] &&
      !DONE.has(r.ProjectStatus) &&
      !(end && end < finished) &&
      r.EstimatedCost > 0 &&
      r.EstimatedCost < (SCHOOL.test(names) ? MAX_SCHOOL_COST : MAX_COST) &&
      // TxDOT files each highway segment by its control-section-job number.
      !/\bCSJ\b/i.test(names)
    );
  });
}

/** A TABS project page as label → value lines, by section (PROJECT, OWNER, TENANT, DESIGN FIRM). */
export function parseProjectPage(html: string): Map<string, string[]> {
  const text = xmlText(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/g, ' ')
  );
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const sections = new Set(['PROJECT', 'PERSON FILING FORM', 'RAS', 'OWNER', 'TENANT', 'DESIGN FIRM']);
  const out = new Map<string, string[]>();
  let section = '';
  let label: string | null = null;
  for (const line of lines) {
    if (sections.has(line)) {
      section = line;
      label = null;
      continue;
    }
    if (!section) continue;
    if (/^Registered accessibility specialists/i.test(line)) break;
    if (/^[A-Z][^:]{1,60}:$/.test(line) || /^[A-Z][^:]{1,60}\?$/.test(line)) {
      label = `${section}.${line.replace(/[:?]$/, '')}`;
      out.set(label, []);
      continue;
    }
    if (label) out.get(label)!.push(line);
    else out.set(`${section}.`, [...(out.get(`${section}.`) ?? []), line]);
  }
  return out;
}

export interface ProjectDetails {
  address: string | null;
  owner: string | null;
  tenant: string | null;
  designFirm: string | null;
  scope: string | null;
  squareFeet: number | null;
  isPublic: boolean;
}

export function projectDetails(page: Map<string, string[]>): ProjectDetails {
  const one = (key: string) => {
    const value = page.get(key)?.join(' ').trim();
    return value && !/^not assigned$/i.test(value) ? value : null;
  };
  const address = page.get('PROJECT.Location Address');
  const feet = /([\d,]+)/.exec(page.get('PROJECT.Square Footage')?.[0] ?? '')?.[1];
  const scope = one('PROJECT.Scope of Work');
  const funds = one('PROJECT.Type of Funds') ?? '';
  return {
    address: address?.length ? address.join(', ') : null,
    owner: one('OWNER.Owner Name'),
    tenant: one('TENANT.Tenant Name') ?? one('TENANT.Tenant'),
    designFirm: one('DESIGN FIRM.Design Firm Name'),
    scope: scope && scope.length > 300 ? `${scope.slice(0, 297).trimEnd()}…` : scope,
    squareFeet: feet ? Number(feet.replace(/,/g, '')) || null : null,
    isPublic: /public funds|public land/i.test(funds) && !/\bnot\b/i.test(funds)
  };
}

/** An address the geocoder can read: street and city lines, no "From: … To:" road segments. */
export function geocodable(address: string | null): string | null {
  if (!address || /\bfrom:|\bto:/i.test(address)) return null;
  if (!/^\d/.test(address)) return null; // a street number is what makes a point
  return address;
}

/** The five-digit ZIP at the end of an address, unless it covers many places. */
export function zipOf(address: string | null): string | null {
  if (!address || /\bvarious\b|multiple locations/i.test(address)) return null;
  return /\b(\d{5})(?:-\d{4})?\s*$/.exec(address)?.[1] ?? null;
}

export const zctaUrl = (year: number) =>
  `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${year}_Gazetteer/${year}_Gaz_zcta_national.zip`;

/** Texas ZIP code centers from the Census gazetteer (tab separated: GEOID … INTPTLAT, INTPTLONG). */
export function parseZcta(text: string): Map<string, [number, number]> {
  const lines = text.split(/\r?\n/);
  const header = (lines[0] ?? '').split('\t').map((h) => h.trim().toUpperCase());
  const [id, lat, lng] = ['GEOID', 'INTPTLAT', 'INTPTLONG'].map((name) => header.indexOf(name)) as [number, number, number];
  const out = new Map<string, [number, number]>();
  if (id < 0 || lat < 0 || lng < 0) return out;
  for (const line of lines.slice(1)) {
    const cells = line.split('\t');
    const zip = cells[id]?.trim() ?? '';
    // Texas runs 75000-79999 and 885xx (El Paso).
    if (!/^(7[5-9]|885)/.test(zip)) continue;
    const y = Number(cells[lat]);
    const x = Number(cells[lng]);
    if (Number.isFinite(y) && Number.isFinite(x)) out.set(zip, [y, x]);
  }
  return out;
}

/** The newest gazetteer published: each year's comes out that summer. */
export async function fetchZipCenters(now: Date, options: FetchJsonOptions = {}): Promise<Map<string, [number, number]>> {
  for (let year = now.getUTCFullYear(); year >= now.getUTCFullYear() - 3; year--) {
    try {
      const files = unzip(await fetchBuffer(zctaUrl(year), { timeoutMs: 120_000, ...options }));
      const text = [...files.values()][0]?.toString('utf8') ?? '';
      const centers = parseZcta(text);
      if (centers.size) return centers;
    } catch {
      // Not published yet, or a bad download: try the year before.
    }
  }
  return new Map();
}

/**
 * Spread projects that share one ZIP center around it, about 150 m apart,
 * so each keeps a pin of its own.
 */
export function spread(at: [number, number], index: number): [number, number] {
  if (!index) return at;
  const angle = index * 2.399963; // golden angle
  const step = 0.0014 * Math.sqrt(index);
  return [at[0] + step * Math.sin(angle), at[1] + (step * Math.cos(angle)) / Math.cos((at[0] * Math.PI) / 180)];
}

export const geocodeUrl = (address: string) =>
  `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;

interface GeocodeResponse {
  result?: { addressMatches?: { coordinates?: { x: number; y: number } }[] };
}

/** Kilometres between two points, near enough for a sanity check. */
export function distanceKm([lat1, lng1]: [number, number], [lat2, lng2]: [number, number]): number {
  const rad = Math.PI / 180;
  const x = (lng2 - lng1) * rad * Math.cos(((lat1 + lat2) / 2) * rad);
  const y = (lat2 - lat1) * rad;
  return Math.sqrt(x * x + y * y) * 6371;
}

export async function geocode(address: string, city: City, options: FetchJsonOptions = {}): Promise<[number, number] | null> {
  const data = await fetchJson<GeocodeResponse>(geocodeUrl(address), { timeoutMs: 30_000, ...options });
  const point = data.result?.addressMatches?.[0]?.coordinates;
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const at: [number, number] = [point.y, point.x];
  // A match across the state is a wrong match; a metro spans about 80 km from its center.
  return distanceKm(at, CITY_CENTERS[city]) <= METRO_RADIUS_KM[city] ? at : null;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface FetchDevelopmentsOptions extends FetchJsonOptions {
  now?: Date;
  previous?: Development[];
  /** Wait between project page reads, to stay a light visitor. */
  pauseMs?: number;
  log?: (line: string) => void;
}

/** Search one county, last two years, biggest first. */
export async function searchCounty(county: string, now: Date, options: FetchJsonOptions = {}): Promise<TabsRow[]> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
  const data = await fetchJson<{ data?: TabsRow[] }>(TABS_SEARCH_URL, {
    timeoutMs: 120_000,
    ...options,
    form: searchForm(county, since, now),
    headers: { 'x-requested-with': 'XMLHttpRequest', referer: `${TABS}/Search/` }
  });
  return data.data ?? [];
}

/** A metro's biggest current projects across its counties, each project once. */
export async function searchMetro(city: City, now: Date, options: FetchJsonOptions = {}): Promise<TabsRow[]> {
  const seen = new Map<string, TabsRow>();
  for (const county of METRO_COUNTIES[city] ?? []) {
    for (const row of currentDevelopments(await searchCounty(county, now, options), now)) {
      if (!seen.has(row.ProjectNumber)) seen.set(row.ProjectNumber, row);
    }
  }
  return [...seen.values()].sort((a, b) => b.EstimatedCost - a.EstimatedCost).slice(0, PER_CITY);
}

/** TABS city id → name, from the search form's city list. */
export function parseCityOptions(html: string): Map<number, string> {
  const select = /<select[^>]*name="filter-location-city"[^>]*>([\s\S]*?)<\/select>/i.exec(html)?.[1] ?? '';
  const out = new Map<number, string>();
  for (const [, id, name] of select.matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]*)/gi)) {
    const text = xmlText(name ?? '').trim();
    if (text) out.set(Number(id), text);
  }
  return out;
}

/** The town from an address's "…, Galveston, TX 77550" tail. */
export function placeOf(address: string | null): string | null {
  const match = /,\s*([A-Za-z][A-Za-z .'-]*?)\s*,?\s*(?:TX|Texas)\b\.?\s*(?:\d{5}(?:-\d{4})?)?\s*$/i.exec(address ?? '');
  return match?.[1]?.trim() || null;
}

export async function fetchDevelopments(cities: readonly City[], options: FetchDevelopmentsOptions = {}): Promise<DevelopmentsResult> {
  const { now = new Date(), previous = [], pauseMs = 300, log = () => {}, ...http } = options;
  const known = new Map(previous.map((p) => [p.id, p]));
  const projects: Development[] = [];
  let pages = 0;

  // City names for each row's city id; the address tail is the fallback.
  const places = await fetchText(`${TABS}/Search`, { timeoutMs: 60_000, ...http })
    .then(parseCityOptions)
    .catch(() => new Map<number, string>());

  for (const city of cities) {
    if (!METRO_COUNTIES[city]) {
      log(`${city}: no TABS counties yet; skipped.`);
      continue;
    }
    const rows = await searchMetro(city, now, http);
    for (const row of rows) {
      const old = known.get(row.ProjectNumber);
      let details: ProjectDetails;
      let lat = old?.lat ?? null;
      let lng = old?.lng ?? null;
      let approximate = old?.approximate ?? false;
      if (old) {
        details = old;
      } else {
        if (pages++) await pause(pauseMs);
        details = projectDetails(parseProjectPage(await fetchText(tabsProjectUrl(row.ProjectNumber), { timeoutMs: 60_000, ...http })));
        const address = geocodable(details.address);
        if (address) {
          const at = await geocode(address, city, http).catch(() => null);
          if (at) [lat, lng] = at;
        }
      }
      const link = developerLink(details.owner, row.ProjectName, city);
      projects.push({
        id: row.ProjectNumber,
        city,
        place: places.get(row.City) ?? placeOf(details.address),
        name: row.ProjectName.trim(),
        facility: row.FacilityName && row.FacilityName.trim() !== row.ProjectName.trim() ? row.FacilityName.trim() : null,
        status: STATUS[row.ProjectStatus] ?? 'Registered',
        work: WORK[row.TypeOfWork] ?? 'New construction',
        cost: Math.round(row.EstimatedCost),
        registered: isoDate(row.ProjectCreatedOn) ?? '',
        start: isoDate(row.EstimatedStartDate),
        end: isoDate(row.EstimatedEndDate),
        address: details.address,
        owner: details.owner,
        tenant: details.tenant,
        designFirm: details.designFirm,
        scope: details.scope,
        squareFeet: details.squareFeet,
        isPublic: details.isPublic,
        lat,
        lng,
        approximate,
        developerUrl: link.url,
        developerDirect: link.direct,
        url: tabsPermalink(row.ProjectNumber)
      });
    }
    log(`${city} metro: ${rows.length} projects`);
  }

  // San Antonio publishes its building permits, which catch what TABS misses.
  if (cities.includes('San Antonio')) {
    try {
      const permits = await fetchSanAntonioPermits(now, projects, http);
      projects.push(...permits);
      log(`San Antonio city permits: ${permits.length} more projects`);
    } catch (error) {
      log(`San Antonio city permits: not read (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  // Whatever the geocoder could not place goes at its ZIP code's center.
  const missing = projects.filter((p) => p.lat == null && zipOf(p.address));
  if (missing.length) {
    const centers = await fetchZipCenters(now, http);
    const perZip = new Map<string, number>();
    for (const p of projects) {
      const zip = zipOf(p.address);
      if (zip && p.approximate) perZip.set(zip, (perZip.get(zip) ?? 0) + 1);
    }
    for (const p of missing) {
      const zip = zipOf(p.address)!;
      const center = centers.get(zip);
      if (!center) continue;
      const index = perZip.get(zip) ?? 0;
      perZip.set(zip, index + 1);
      [p.lat, p.lng] = spread(center, index);
      p.approximate = true;
    }
  }
  const exact = projects.filter((p) => p.lat != null && !p.approximate).length;
  const near = projects.filter((p) => p.approximate).length;
  log(`read ${pages} new project pages; ${exact} placed at their address, ${near} at their ZIP code's center, ${projects.length - exact - near} not on the map`);
  return { asOf: now.toISOString(), projects };
}
