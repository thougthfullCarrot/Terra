import { fetchBuffer, fetchJson, fetchText, type FetchJsonOptions } from '../lib/http.js';
import { unzip, xmlText } from '../lib/xlsx.js';
import type { City } from '../types.js';
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

/** TABS location city ids, from the search form's city list. */
export const TABS_CITY_IDS: Record<City, string> = {
  Dallas: '415',
  'Fort Worth': '606',
  Houston: '785',
  Austin: '77',
  'San Antonio': '1537',
  'El Paso': '522'
};

/** Rough city centers, to drop a geocode that landed in the wrong place. */
export const CITY_CENTERS: Record<City, [number, number]> = {
  Dallas: [32.7767, -96.797],
  'Fort Worth': [32.7555, -97.3308],
  Houston: [29.7604, -95.3698],
  Austin: [30.2672, -97.7431],
  'San Antonio': [29.4241, -98.4936],
  'El Paso': [31.7619, -106.485]
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
  TypeOfWork: number;
  EstimatedCost: number;
  EstimatedStartDate: string | null;
  EstimatedEndDate: string | null;
}

export interface Development {
  /** TABS project number. */
  id: string;
  city: City;
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
  /** The project's public TDLR page. */
  url: string;
}

export interface DevelopmentsResult {
  asOf: string;
  projects: Development[];
}

/** How many projects each city's map shows: the biggest by cost. */
export const PER_CITY = 40;
/** Filings above this are typos (a $20 billion school), not projects. */
const MAX_COST = 5e9;

const isoDate = (value: string | null | undefined) => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null);
const usDate = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;

/** The form DataTables posts: the biggest projects first, registered since `since`. */
export function searchForm(city: City, since: Date, until: Date, length = 200): Record<string, string> {
  return {
    draw: '1',
    start: '0',
    length: String(length),
    'order[0][column]': '9',
    'order[0][dir]': 'desc',
    'columns[9][data]': 'EstimatedCost',
    LocationCity: TABS_CITY_IDS[city],
    RegistrationDateBegin: usDate(since),
    RegistrationDateEnd: usDate(until),
    DataVersionId: '900001'
  };
}

/** A school costs a few hundred million at most; more is an extra digit in the filing. */
const MAX_SCHOOL_COST = 4e8;
const SCHOOL = /\bISD\b|independent school|elementary|middle school|high school/i;

/** New buildings and additions still under way, without highway segments or typo costs. */
export function currentDevelopments(rows: TabsRow[]): TabsRow[] {
  return rows.filter((r) => {
    const names = `${r.ProjectName} ${r.FacilityName ?? ''}`;
    return (
      WORK[r.TypeOfWork] &&
      !DONE.has(r.ProjectStatus) &&
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
  // A match across the state is a wrong match; a big city spans about 60 km.
  return distanceKm(at, CITY_CENTERS[city]) <= 70 ? at : null;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface FetchDevelopmentsOptions extends FetchJsonOptions {
  now?: Date;
  previous?: Development[];
  /** Wait between project page reads, to stay a light visitor. */
  pauseMs?: number;
  log?: (line: string) => void;
}

/** Search one city, newest year, biggest first. */
export async function searchCity(city: City, now: Date, options: FetchJsonOptions = {}): Promise<TabsRow[]> {
  const since = new Date(now.getTime() - 365 * 86_400_000);
  const data = await fetchJson<{ data?: TabsRow[] }>(TABS_SEARCH_URL, {
    timeoutMs: 120_000,
    ...options,
    form: searchForm(city, since, now),
    headers: { 'x-requested-with': 'XMLHttpRequest', referer: `${TABS}/Search/` }
  });
  return data.data ?? [];
}

export async function fetchDevelopments(cities: readonly City[], options: FetchDevelopmentsOptions = {}): Promise<DevelopmentsResult> {
  const { now = new Date(), previous = [], pauseMs = 300, log = () => {}, ...http } = options;
  const known = new Map(previous.map((p) => [p.id, p]));
  const projects: Development[] = [];
  let pages = 0;

  for (const city of cities) {
    const rows = currentDevelopments(await searchCity(city, now, http)).slice(0, PER_CITY);
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
    log(`${city}: ${rows.length} projects`);
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
