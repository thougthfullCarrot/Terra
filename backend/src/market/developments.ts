import { fetchBuffer, fetchJson, fetchText, type FetchJsonOptions } from '../lib/http.js';
import { unzip, xmlText } from '../lib/xlsx.js';
import type { City } from '../types.js';
import { fetchCityPermitProjects } from './cityPermits.js';
import { developerLink } from './developers.js';
import { RULES, checkPoint, inferMethod, km, locationInfo, pickGeocode, type CensusMatch, type LocationInfo, type ZipArea } from './devLocation.js';

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

export const STATUS: Record<number, string> = {
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
/** A TABS status code as words; a code not in STATUS says so rather than passing for a known stage. */
export const statusLabel = (code: number) => STATUS[code] ?? 'Unknown status';

/** Finished or closed: no longer a current development. */
export const DONE = new Set([3001, 3007]);

export const WORK: Record<number, string> = { 9001: 'New construction', 9003: 'Addition' };

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
  /** The raw TABS status code behind `status`, kept for diagnosing an "Unknown status". Absent on city permits. */
  statusCode?: number;
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
  /** True when the point is the ZIP code's center, not the street address: "Location not verified", drawn as an area, never as a site pin. */
  approximate: boolean;
  /** Where the point came from, how far to trust it, and when it was checked (devLocation.ts). */
  location?: LocationInfo;
  /** The developer's website, or a search for it when not listed (see developerLink). */
  developerUrl: string;
  developerDirect: boolean;
  /** The project's public TDLR page, or the city permit dataset. */
  url: string;
  /** Where the project came from: the state's TABS register (the default) or a city's building permits. */
  source?: 'tabs' | 'city';
  /** The permit's primary contact (often the architect or permit expediter), for city permits. */
  contact?: string | null;
  /** The general contractor named on the city permit, where the city publishes it. */
  contractor?: string | null;
  /**
   * Other names and numbers the same site is filed under (city permit numbers,
   * a related permit's project name like "Merc Retail Development"), so a
   * search finds it either way.
   */
  aliases?: string[];
  /** When the pin came from another city permit at the same address: the site, not the building's own point. */
  locatedFrom?: string;
  /** Every address the city lists for this permit, the shown one first (Fort Worth). */
  addresses?: string[];
  /** Every lot, block and legal description on the permit. */
  parcels?: string[];
  /** The permit numbers behind a project of several building permits at one site (Fort Worth). */
  permits?: string[];
  /** The city's own row ids behind the project (Fort Worth CAPIDs). */
  sourceIds?: string[];
  /** True while the project's TABS page has not been read: listed by name, number and cost, with no address or pin yet. */
  awaiting?: boolean;
  /**
   * One of the metro's biggest (the TABS cap, or a city source's first CITY_MAX):
   * the set market.json carries for the other views. Every project, headline or
   * not, is in the market's own developments file.
   */
  headline?: boolean;
}

export interface DevelopmentsResult {
  asOf: string;
  projects: Development[];
  /** How each county's TABS read went; a map built from an incomplete read says so. */
  coverage?: TabsCoverage[];
  /** Projects inside a map's cap whose page waits for a later build (MAX_NEW_PAGES ran out). */
  waiting?: number;
  /** Per metro: what the map shows against what TABS holds, for the coverage note. */
  metros?: MetroCoverage[];
  /** Current filings below each metro's cap that this build saw, listed without pins (no page read). Empty since every filing is in projects. */
  smaller?: SmallerFiling[];
  /** Per market, the file holding every one of its projects (relative to market.json), when the build split them out. */
  files?: Partial<Record<City, string>>;
}

export interface MetroCoverage {
  city: City;
  /** Current TABS filings the build read for the metro. */
  filings: number;
  /** The most the map pins for the metro (capFor). */
  cap: number;
  /** The smallest kept filing's cost when the cap cut anything, else null. */
  cutoff: number | null;
  /** False when a county read came back short, so even the counts above are low. */
  complete: boolean;
  /** TABS's own count of every filing in the metro's counties over the lookback (all statuses), when each county gave one. */
  reported?: number | null;
  /** Date windows left unsplit because they held only filings below the cutoff: their smaller filings were never fetched. */
  skippedWindows?: number;
  /** Every project the market lists (TABS filings and city permits), and how each is located. */
  listed?: number;
  /** Placed at its own address or permit point. */
  exact?: number;
  /** Placed at another permit's point at the same address. */
  site?: number;
  /** At its ZIP code's center. */
  approximate?: number;
  /** Page not read yet: listed with no address. */
  awaiting?: number;
  /** Page read, but no reliable point. */
  unlocated?: number;
}

/** A filing too small for the map's pins: what the search row says, nothing more. */
export interface SmallerFiling {
  id: string;
  city: City;
  place: string | null;
  name: string;
  status: string;
  work: string;
  cost: number;
  registered: string;
  end: string | null;
  url: string;
  /** Filled once its project page has been read with spare page budget (smallerPins); absent until then. */
  address?: string | null;
  owner?: string | null;
  isPublic?: boolean;
  lat?: number | null;
  lng?: number | null;
  approximate?: boolean;
  /** True once the page was read, so a later build reuses it instead of reading it again. */
  paged?: boolean;
}

/**
 * Smaller filings get a pin only from page reads the map's own projects left
 * unused (MAX_NEW_PAGES minus what they needed), and only once no project
 * inside a cap is still waiting for its page, so they can never slow the main
 * map. The phase also stops after this long, to keep the build well inside
 * its 30 minutes.
 */
export const SMALLER_PAGE_MS = 8 * 60_000;

/**
 * Smaller filings listed per metro. Below the cutoff TABS windows are not
 * split further, so this list is what the search happened to return, not every
 * small filing; the coverage note says so.
 */
export const MAX_SMALLER = 600;

/** The below-cap rows as list entries, biggest first. */
export function smallerFilings(city: City, rows: TabsRow[], places: Map<number, string> = new Map(), max = MAX_SMALLER): SmallerFiling[] {
  return rows.slice(capFor(city), capFor(city) + max).map((r) => ({
    id: r.ProjectNumber,
    city,
    place: places.get(r.City) ?? null,
    name: r.ProjectName.trim(),
    status: statusLabel(r.ProjectStatus),
    work: WORK[r.TypeOfWork] ?? 'New construction',
    cost: Math.round(r.EstimatedCost),
    registered: isoDate(r.ProjectCreatedOn) ?? '',
    end: isoDate(r.EstimatedEndDate),
    url: tabsPermalink(r.ProjectNumber)
  }));
}

/**
 * How far back to read filings. Big projects take two years or more to build,
 * so a one-year window dropped buildings still going up (Rod saw them missing
 * in San Antonio); finished ones fall out by status or end date.
 */
export const LOOKBACK_DAYS = 730;
/** A project whose estimated end passed this long ago is most likely finished, just not closed out. */
const FINISHED_DAYS = 120;

/**
 * How many TABS projects each metro's map shows: the biggest by cost. Harris
 * County alone files about 4,000 a year, so the big metros get the most.
 */
export const METRO_CAP: Partial<Record<City, number>> = {
  Houston: 400,
  Dallas: 400,
  'Fort Worth': 300,
  Austin: 300,
  'San Antonio': 300
};
export const DEFAULT_CAP = 150;
export const capFor = (city: City) => METRO_CAP[city] ?? DEFAULT_CAP;
/**
 * New project pages read per build. A page and a geocode take about a second,
 * so 400 is about seven minutes and a first build fills the maps over a few days; later builds read only new
 * filings.
 */
export const MAX_NEW_PAGES = 400;
/** Earlier projects whose pin missed or sits at a ZIP center get one more geocode try, up to this many a build. */
export const GEOCODE_RETRIES = 60;
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
  // Two different ZIPs in one address ("…, New Braunfels, TX 78130, New Braunfels, TX 78204"): neither can be trusted for an area.
  if (new Set(address.match(/\b\d{5}\b(?=(?:-\d{4})?\s*(?:,|$))/g) ?? []).size > 1) return null;
  return /\b(\d{5})(?:-\d{4})?\s*$/.exec(address)?.[1] ?? null;
}

export const zctaUrl = (year: number) =>
  `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${year}_Gazetteer/${year}_Gaz_zcta_national.zip`;

/** Texas ZIP code areas from the Census gazetteer (tab separated: GEOID, ALAND … INTPTLAT, INTPTLONG). */
export function parseZctaAreas(text: string): Map<string, ZipArea> {
  const lines = text.split(/\r?\n/);
  const header = (lines[0] ?? '').split('\t').map((h) => h.trim().toUpperCase());
  const [id, lat, lng, land] = ['GEOID', 'INTPTLAT', 'INTPTLONG', 'ALAND'].map((name) => header.indexOf(name)) as [number, number, number, number];
  const out = new Map<string, ZipArea>();
  if (id < 0 || lat < 0 || lng < 0) return out;
  for (const line of lines.slice(1)) {
    const cells = line.split('\t');
    const zip = cells[id]?.trim() ?? '';
    // Texas runs 75000-79999 and 885xx (El Paso).
    if (!/^(7[5-9]|885)/.test(zip)) continue;
    const y = Number(cells[lat]);
    const x = Number(cells[lng]);
    const m2 = land >= 0 ? Number(cells[land]) : NaN;
    // The radius of a circle with the ZIP's land area: a rough size, for drawing the area and flagging far points.
    const radiusKm = Number.isFinite(m2) && m2 > 0 ? Math.sqrt(m2 / Math.PI) / 1000 : 2;
    if (Number.isFinite(y) && Number.isFinite(x)) out.set(zip, { at: [y, x], radiusKm });
  }
  return out;
}

/** Texas ZIP code centers from the Census gazetteer. */
export function parseZcta(text: string): Map<string, [number, number]> {
  return new Map([...parseZctaAreas(text)].map(([zip, a]) => [zip, a.at]));
}

/** The newest gazetteer published: each year's comes out that summer. */
export async function fetchZipAreas(now: Date, options: FetchJsonOptions = {}): Promise<Map<string, ZipArea>> {
  for (let year = now.getUTCFullYear(); year >= now.getUTCFullYear() - 3; year--) {
    try {
      const files = unzip(await fetchBuffer(zctaUrl(year), { timeoutMs: 120_000, ...options }));
      const text = [...files.values()][0]?.toString('utf8') ?? '';
      const areas = parseZctaAreas(text);
      if (areas.size) return areas;
    } catch {
      // Not published yet, or a bad download: try the year before.
    }
  }
  return new Map();
}

export async function fetchZipCenters(now: Date, options: FetchJsonOptions = {}): Promise<Map<string, [number, number]>> {
  return new Map([...(await fetchZipAreas(now, options))].map(([zip, a]) => [zip, a.at]));
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
  result?: { addressMatches?: CensusMatch[] };
}

/** Kilometres between two points, near enough for a sanity check. */
export function distanceKm([lat1, lng1]: [number, number], [lat2, lng2]: [number, number]): number {
  const rad = Math.PI / 180;
  const x = (lng2 - lng1) * rad * Math.cos(((lat1 + lat2) / 2) * rad);
  const y = (lat2 - lat1) * rad;
  return Math.sqrt(x * x + y * y) * 6371;
}

/**
 * The filed address's point from the Census geocoder, or null. A match must be
 * the filed address (same number, direction and ZIP or town: pickGeocode) and
 * inside the market; anything else is a wrong match, and no point beats a wrong one.
 */
export async function geocode(address: string, city: City, options: FetchJsonOptions = {}): Promise<[number, number] | null> {
  return (await geocodeChecked(address, city, options)).at;
}

/** geocode, with the matched address or the reason a match was refused (for the audit). */
export async function geocodeChecked(address: string, city: City, options: FetchJsonOptions = {}): Promise<{ at: [number, number] | null; matched?: string; rejected?: string; flag?: string }> {
  const data = await fetchJson<GeocodeResponse>(geocodeUrl(address), { timeoutMs: 30_000, ...options });
  // A response without a match list is a broken answer, not "no match": callers keep what they have.
  if (!Array.isArray(data?.result?.addressMatches)) throw new Error('malformed geocoder response');
  const pick = pickGeocode(address, data.result?.addressMatches);
  if (!pick.at) return pick;
  // A match across the state is a wrong match; a metro spans about 80 km from its center.
  if (distanceKm(pick.at, CITY_CENTERS[city]) > METRO_RADIUS_KM[city]) return { at: null, matched: pick.matched, rejected: 'match outside the market' };
  return pick;
}

/** Today's date for a location's verified stamp. */
export const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** The Census geocoder as a location source. */
export const CENSUS_SOURCE = 'Census Geocoder (Public_AR_Current) match of the filed address';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A geocoder refusal that means the filed address disagrees with what the geocoder found (not just "unknown street"). */
export const isConflict = (rejected: string | undefined) => !!rejected && rejected !== 'no match';

/** What revalidating one cached point did. */
export type Revalidation = 'kept' | 'moved' | 'restored' | 'removed: address conflict' | 'removed: no longer matches' | 'skipped: not geocodable' | 'error';

/** Geocoded points checked under older rules, revalidated per build (the rest wait for the next build). */
export const REVALIDATE_PER_BUILD = 150;
/** Revalidation stops starting new geocodes after this long, so the Website job keeps inside its 30 minutes. */
export const REVALIDATE_MS = 3 * 60_000;

type Checkable = { lat: number | null; lng: number | null; approximate?: boolean; locatedFrom?: string; source?: string; location?: LocationInfo };

/** A point an earlier revalidation or page read removed for failing the checks of its day. */
const removedByChecks = (p: Checkable) => p.lat == null && p.location?.method === 'none' && !!p.location.flags?.some((f) => f === 'address conflict' || f === 'no match');

/**
 * Due for revalidation: a cached geocoded point that has not passed today's
 * checks, or a point older checks removed (so a rule fix can bring it back).
 * Permit and same-site points are independent evidence and are left alone.
 */
export const needsRevalidation = (p: Checkable) =>
  (p.location?.rules ?? 1) < RULES && ((p.lat != null && p.lng != null && inferMethod(p) === 'geocoded-address') || removedByChecks(p));

/**
 * Geocode a cached point's filed address again under today's rules. A match
 * within 250 m keeps the point; a validated match elsewhere moves it (the old
 * point is kept in location.previous); a refusal removes it: "location
 * unavailable" for an address conflict (no ZIP area either, since the filed
 * ZIP may be the wrong part), or no longer matched. A point removed under
 * older rules is restored when today's rules accept the match. A timeout,
 * blocked request or malformed answer changes nothing but a retry note: the
 * point stays and is checked again after the rest of the queue.
 * Changes the project in place.
 */
export async function revalidatePoint(p: Development, now: Date, http: FetchJsonOptions = {}): Promise<Revalidation> {
  const address = geocodable(p.address);
  const wasRemoved = p.lat == null;
  const old: [number, number] | null = !wasRemoved ? [p.lat!, p.lng!] : (p.location?.previous ?? null);
  if (!address) {
    p.lat = p.lng = null;
    p.location = locationInfo('none', wasRemoved ? (p.location?.source ?? 'Location unavailable') : 'cached point removed: the filed address has no street number to check', dayOf(now), { ...(old ? { previous: old } : {}), rules: RULES, flags: p.location?.flags });
    return 'skipped: not geocodable';
  }
  let got: Awaited<ReturnType<typeof geocodeChecked>>;
  try {
    got = await geocodeChecked(address, p.city, http);
  } catch (e) {
    const before = p.location?.retry;
    const base = p.location ?? locationInfo(inferMethod(p), CENSUS_SOURCE, 'not recorded', { rules: 1 });
    p.location = { ...base, retry: { attempts: (before?.attempts ?? 0) + 1, last: dayOf(now), reason: e instanceof Error ? e.message.slice(0, 120) : 'request failed' } };
    return 'error';
  }
  if (got.at) {
    const d = old ? km(got.at, old) : Number.POSITIVE_INFINITY;
    const flags = got.flag ? [got.flag] : [];
    if (d <= 0.25) {
      [p.lat, p.lng] = old!;
      p.location = locationInfo('geocoded-address', `${CENSUS_SOURCE} (${wasRemoved ? 'restored: today\'s checks accept the match' : 'revalidated'})`, dayOf(now), flags.length ? { flags } : {});
      return wasRemoved ? 'restored' : 'kept';
    }
    // A match that is itself flagged (outside the filed ZIP, say) is weaker
    // evidence than a cached point it can't rule out: keep that point, flagged.
    if (old && !wasRemoved && got.flag) {
      p.location = locationInfo('geocoded-address', `${CENSUS_SOURCE} (revalidated; kept: today's match${got.matched ? ` ${got.matched}` : ''} is ${d.toFixed(1)} km away but outside the filed ZIP)`, dayOf(now), { flags: [got.flag, 'second match elsewhere'] });
      return 'kept';
    }
    [p.lat, p.lng] = got.at;
    p.location = locationInfo('geocoded-address', `${CENSUS_SOURCE} (revalidated; ${old ? `moved ${d.toFixed(1)} km from the cached match` : 'placed: today\'s checks accept the match'}${got.matched ? `; match: ${got.matched}` : ''})`, dayOf(now), { ...(old ? { previous: old } : {}), flags });
    return wasRemoved ? 'restored' : 'moved';
  }
  p.lat = p.lng = null;
  const conflict = isConflict(got.rejected);
  p.location = locationInfo('none', conflict ? `Location unavailable: ${got.rejected}` : 'Location unavailable: the geocoder no longer matches the filed address', dayOf(now), {
    ...(old ? { previous: old } : {}),
    rules: RULES,
    flags: [conflict ? 'address conflict' : 'no match']
  });
  return conflict ? 'removed: address conflict' : 'removed: no longer matches';
}

/**
 * Revalidate up to `budget` due points, biggest projects first; points whose
 * last try failed wait behind the rest (fewest failed tries first), so one
 * stuck record never holds up the queue. Each outcome but 'error' stamps the
 * point with RULES, so the next build moves on to the next batch.
 */
export async function revalidatePoints(projects: Development[], now: Date, o: { budget?: number; http?: FetchJsonOptions; pauseMs?: number; log?: (l: string) => void; timeMs?: number; clock?: () => number } = {}): Promise<Map<string, Revalidation>> {
  const { budget = REVALIDATE_PER_BUILD, http = {}, pauseMs = 300, log = () => {}, timeMs = REVALIDATE_MS, clock = Date.now } = o;
  const out = new Map<string, Revalidation>();
  const tries = (p: Development) => p.location?.retry?.attempts ?? 0;
  const due = projects.filter(needsRevalidation).sort((a, b) => tries(a) - tries(b) || b.cost - a.cost);
  const started = clock();
  for (const p of due.slice(0, budget)) {
    if (clock() - started > timeMs) break;
    if (out.size) await pause(pauseMs);
    out.set(`${p.city}|${p.id}`, await revalidatePoint(p, now, http));
  }
  const tally = new Map<Revalidation, number>();
  for (const v of out.values()) tally.set(v, (tally.get(v) ?? 0) + 1);
  log(`revalidated ${out.size} of ${due.length} due points: ${[...tally].map(([k, n]) => `${n} ${k}`).join(', ') || 'none due'}; ${due.length - out.size + (tally.get('error') ?? 0)} left for later builds`);
  return out;
}

export interface FetchDevelopmentsOptions extends FetchJsonOptions {
  now?: Date;
  previous?: Development[];
  /** Wait between project page reads, to stay a light visitor. */
  pauseMs?: number;
  log?: (line: string) => void;
  /** TABS ids to report on in the log: rank, page read and final pin. */
  trace?: string[];
  /** The last build's smaller filings, whose page details and pins carry over (builds before every filing was listed). */
  previousSmaller?: SmallerFiling[];
  /** The clock, for the page-reading time limit (tests pass a fake). */
  clock?: () => number;
  /**
   * Page details read so far, saved while the build runs, so a build killed
   * mid-way loses none of its page reads: load() at the start, save() every
   * few pages.
   */
  checkpoint?: PageCheckpoint;
  /** No new page read starts after this long from the start of the build's TABS work. */
  pageTimeMs?: number;
}

/** One project's page details and point, as a checkpoint keeps them. */
export type PageDetails = ProjectDetails & { lat: number | null; lng: number | null; approximate: boolean; location?: LocationInfo };

export interface PageCheckpoint {
  load(): Promise<Map<string, PageDetails>>;
  save(pages: Map<string, PageDetails>): Promise<void>;
}

/**
 * TABS serves at most 100 rows a search, ignores the page offset (a second
 * page repeats the first), and reports the true match count in
 * recordsFiltered. Bexar County's two years came back as 100 of 3,006, the
 * biggest 100, so every smaller project (The Merc at 5734/5730 UTSA Blvd) was
 * missing. So a county is read in registration-date windows small enough to
 * come back whole: a window reporting more rows than it returned is split
 * into smaller ones until each is complete, never paged.
 */
export const SEARCH_PAGE = 100;
/** Searches per build across every county, so a strange day can't turn into thousands of requests. */
export const MAX_SEARCH_REQUESTS = 800;
/** Aim each split window at this many rows, so most windows come back whole the first time. */
const SPLIT_TARGET = 80;
const DAY_MS = 86_400_000;

/** The searches left this build, shared by every county, and the pause between them. */
export interface SearchBudget {
  left: number;
  used: number;
  pauseMs: number;
}
export const searchBudget = (pauseMs = 300, left = MAX_SEARCH_REQUESTS): SearchBudget => ({ left, used: 0, pauseMs });

/** How one county's read went: complete only when every window came back whole. */
export interface TabsCoverage {
  county: string;
  city: City;
  /** TABS's own count of matches for the whole period, when it gave one. */
  reported: number | null;
  read: number;
  searches: number;
  complete: boolean;
  /** Windows that stayed short (a single day above 100 rows, or the budget ran out). */
  short?: string[];
  /** Windows not split further because every row they still held cost less than the map's smallest kept project. */
  skipped?: number;
  error?: string;
}

interface SearchPage {
  data?: TabsRow[];
  recordsFiltered?: number;
}

/** Search one county, last two years, splitting date windows until each is complete. */
export async function searchCounty(
  county: string,
  now: Date,
  options: FetchJsonOptions & {
    budget?: SearchBudget;
    /**
     * The smallest cost the map can still keep. Rows come biggest first, so
     * every row a short window held back costs no more than its last row; when
     * that is below the floor, none of them could make the map and the window
     * is not split.
     */
    floor?: (soFar: TabsRow[]) => number;
  } = {}
): Promise<{ rows: TabsRow[]; reported: number | null; searches: number; complete: boolean; short: string[]; skipped: number }> {
  const { budget = searchBudget(0), floor = () => 0, ...http } = options;
  const rows = new Map<string, TabsRow>();
  const short: string[] = [];
  let searches = 0;
  let skipped = 0;
  let reported: number | null = null;

  const read = async (since: Date, until: Date, top: boolean): Promise<boolean> => {
    if (budget.left <= 0) {
      short.push(`${usDate(since)}–${usDate(until)} (search budget used up)`);
      return false;
    }
    budget.left--;
    if (budget.used++ && budget.pauseMs) await pause(budget.pauseMs);
    searches++;
    const page = await fetchJson<SearchPage>(TABS_SEARCH_URL, {
      timeoutMs: 120_000,
      ...http,
      form: searchForm(county, since, until, SEARCH_PAGE),
      headers: { 'x-requested-with': 'XMLHttpRequest', referer: `${TABS}/Search/` }
    });
    if (!Array.isArray(page.data)) throw new Error('TABS answered without a result list');
    const data = page.data;
    const total = typeof page.recordsFiltered === 'number' ? page.recordsFiltered : null;
    if (top) reported = total;
    for (const row of data) rows.set(row.ProjectNumber, row);
    // Whole when every match came back; with no count, a page short of the limit is whole.
    if (total != null ? data.length >= total : data.length < SEARCH_PAGE) return true;
    const smallest = Math.min(...data.map((r) => r.EstimatedCost));
    if (data.length && smallest < floor([...rows.values()])) {
      skipped++;
      return true;
    }
    const days = Math.round((until.getTime() - since.getTime()) / DAY_MS);
    if (days <= 1) {
      // A day can't be split further; reading it smallest first reaches the other end (up to 200 rows).
      let got = data.length;
      if (budget.left > 0 && total != null) {
        budget.left--;
        if (budget.pauseMs) await pause(budget.pauseMs);
        budget.used++;
        searches++;
        const form = searchForm(county, since, until, SEARCH_PAGE);
        form['order[0][dir]'] = 'asc';
        const low = await fetchJson<SearchPage>(TABS_SEARCH_URL, { timeoutMs: 120_000, ...http, form, headers: { 'x-requested-with': 'XMLHttpRequest', referer: `${TABS}/Search/` } });
        const ids = new Set(data.map((r) => r.ProjectNumber));
        for (const row of low.data ?? []) {
          rows.set(row.ProjectNumber, row);
          ids.add(row.ProjectNumber);
        }
        got = ids.size;
        if (got >= total) return true;
      }
      short.push(`${usDate(since)} (${got} of ${total ?? `${SEARCH_PAGE}+`})`);
      return false;
    }
    // Split by the reported count, so a busy window takes one round, not a halving per level.
    // Once the map's cutoff is known, halve instead: only the part of a window
    // above the cutoff needs reading, and halves let the rest drop out early.
    const pieces = floor([...rows.values()]) > 0 ? 2 : Math.min(days, Math.max(2, Math.ceil((total ?? SEARCH_PAGE * 2) / SPLIT_TARGET)));
    let whole = true;
    for (let i = 0; i < pieces; i++) {
      // Each window ends on the day the next begins, in case TABS reads the end
      // date as midnight; rows in both are kept once.
      const from = new Date(since.getTime() + Math.round((i * days) / pieces) * DAY_MS);
      const to = i === pieces - 1 ? until : new Date(since.getTime() + Math.round(((i + 1) * days) / pieces) * DAY_MS);
      whole = (await read(from, to, false)) && whole;
    }
    return whole;
  };

  const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS);
  let complete = await read(since, now, true);
  // A count above what was read means a gap somewhere, whatever the windows said.
  if (!skipped && reported != null && rows.size < reported) complete = false;
  return { rows: [...rows.values()], reported, searches, complete, short, skipped };
}

/**
 * One project's search row by its TABS project number (the official id), or
 * null when TABS answers that no such project is listed. Throws when TABS
 * can't be read, so a caller never mistakes an outage for a missing project.
 */
export async function searchProject(number: string, options: FetchJsonOptions = {}): Promise<TabsRow | null> {
  const data = await fetchJson<{ data?: TabsRow[] }>(TABS_SEARCH_URL, {
    timeoutMs: 60_000,
    ...options,
    form: { draw: '1', start: '0', length: '5', ProjectNumber: number, DataVersionId: '900001' },
    headers: { 'x-requested-with': 'XMLHttpRequest', referer: `${TABS}/Search/` }
  });
  if (!Array.isArray(data.data)) throw new Error('TABS answered without a result list');
  return data.data.find((r) => r.ProjectNumber === number) ?? null;
}

/** A metro's current projects across its counties, each project once, biggest first, uncapped. */
export async function searchMetroAll(
  city: City,
  now: Date,
  options: FetchJsonOptions & { budget?: SearchBudget; cap?: number; uncapped?: boolean } = {}
): Promise<{ rows: TabsRow[]; coverage: TabsCoverage[] }> {
  const { cap = capFor(city), uncapped = false, ...rest } = options;
  const seen = new Map<string, TabsRow>();
  const coverage: TabsCoverage[] = [];
  // The cap-th biggest current filing seen so far: a lower bound on the true
  // cutoff, so a window skipped below it can only hold projects the map drops anyway.
  const floor = (soFar: TabsRow[]) => {
    // Collecting every filing: no window is skipped for being small.
    if (uncapped) return 0;
    const all = new Map(seen);
    for (const row of currentDevelopments(soFar, now)) all.set(row.ProjectNumber, row);
    if (all.size < cap) return 0;
    return [...all.values()].map((r) => r.EstimatedCost).sort((a, b) => b - a)[cap - 1]!;
  };
  for (const county of METRO_COUNTIES[city] ?? []) {
    try {
      const read = await searchCounty(county, now, { ...rest, floor });
      coverage.push({
        county,
        city,
        reported: read.reported,
        read: read.rows.length,
        searches: read.searches,
        complete: read.complete,
        ...(read.short.length ? { short: read.short } : {}),
        ...(read.skipped ? { skipped: read.skipped } : {})
      });
      for (const row of currentDevelopments(read.rows, now)) if (!seen.has(row.ProjectNumber)) seen.set(row.ProjectNumber, row);
    } catch (error) {
      coverage.push({ county, city, reported: null, read: 0, searches: 0, complete: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { rows: [...seen.values()].sort((a, b) => b.EstimatedCost - a.EstimatedCost), coverage };
}

/** A metro's biggest current projects across its counties, each project once. */
export async function searchMetro(city: City, now: Date, options: FetchJsonOptions & { budget?: SearchBudget } = {}): Promise<TabsRow[]> {
  return (await searchMetroAll(city, now, options)).rows.slice(0, capFor(city));
}

/** One line per county for the build log: "Bexar 3,006 of 3,006 in 41 searches". */
export function tabsCoverageLine(coverage: TabsCoverage[]): string {
  const n = (v: number) => v.toLocaleString('en-US');
  return coverage
    .map((c) =>
      c.error
        ? `${c.county} not read (${c.error})`
        : `${c.county} ${n(c.read)} of ${c.reported == null ? '?' : n(c.reported)} in ${c.searches} search${c.searches === 1 ? '' : 'es'}${c.skipped ? ` (${c.skipped} window${c.skipped === 1 ? '' : 's'} below the map's cutoff left unsplit)` : ''}${c.complete ? '' : ` INCOMPLETE${c.short?.length ? `: ${c.short.slice(0, 5).join(', ')}${c.short.length > 5 ? ` and ${c.short.length - 5} more` : ''}` : ''}`}`
    )
    .join('; ');
}

/**
 * Split `budget` page reads across metros by need: each gets an equal share,
 * and what a metro does not need goes to the others.
 */
export function shareBudget(need: Map<City, number>, budget: number): Map<City, number> {
  const out = new Map<City, number>();
  let left = budget;
  const order = [...need].sort((a, b) => a[1] - b[1]);
  order.forEach(([city, wants], i) => {
    const share = Math.floor(left / (order.length - i));
    const take = Math.min(wants, share);
    out.set(city, take);
    left -= take;
  });
  return out;
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

/**
 * Give smaller filings their page details and a pin: earlier builds' first,
 * then new page reads with whatever page budget is left (`spare`), biggest
 * first, taking turns across metros. Changes the list in place.
 */
export async function pinSmaller(
  smaller: SmallerFiling[],
  previous: SmallerFiling[],
  spare: number,
  options: { http?: FetchJsonOptions; pauseMs?: number; clock?: () => number; log?: (line: string) => void; paused?: boolean } = {}
): Promise<{ read: number; reused: number }> {
  const { http = {}, pauseMs = 300, clock = Date.now, log = () => {}, paused = false } = options;
  const before = new Map(previous.filter((s) => s.paged).map((s) => [s.id, s]));
  let reused = 0;
  for (const s of smaller) {
    const old = before.get(s.id);
    if (!old) continue;
    Object.assign(s, { address: old.address ?? null, owner: old.owner ?? null, isPublic: old.isPublic ?? false, lat: old.lat ?? null, lng: old.lng ?? null, approximate: old.approximate ?? false, paged: true });
    reused++;
  }
  // Biggest first within each metro, one metro after another in turn.
  const queues = new Map<City, SmallerFiling[]>();
  for (const s of smaller) if (!s.paged) (queues.get(s.city) ?? queues.set(s.city, []).get(s.city)!).push(s);
  for (const q of queues.values()) q.sort((a, b) => b.cost - a.cost);
  const order: SmallerFiling[] = [];
  for (let i = 0; [...queues.values()].some((q) => q.length > i); i++) for (const q of queues.values()) if (q[i]) order.push(q[i]!);
  const started = clock();
  let read = 0;
  let stopped = '';
  for (const s of order) {
    if (read >= spare) break;
    if (clock() - started > SMALLER_PAGE_MS) {
      stopped = ' (time limit reached)';
      break;
    }
    if (read || paused) await pause(pauseMs);
    let details: ProjectDetails;
    try {
      details = projectDetails(parseProjectPage(await fetchText(tabsProjectUrl(s.id), { timeoutMs: 60_000, ...http })));
    } catch {
      continue;
    }
    read++;
    const address = geocodable(details.address);
    const at = address ? await geocode(address, s.city, http).catch(() => null) : null;
    Object.assign(s, { address: details.address, owner: details.owner, isPublic: details.isPublic, lat: at?.[0] ?? null, lng: at?.[1] ?? null, approximate: false, paged: true });
  }
  // The ones the geocoder could not place show their ZIP's area, marked not verified, like the main map's.
  const missing = smaller.filter((s) => s.paged && s.lat == null && zipOf(s.address ?? null));
  if (missing.length) {
    const areas = await fetchZipAreas(new Date(), http).catch(() => new Map<string, ZipArea>());
    for (const s of missing) {
      const area = areas.get(zipOf(s.address ?? null)!);
      if (!area || distanceKm(area.at, CITY_CENTERS[s.city]) > METRO_RADIUS_KM[s.city]) continue;
      [s.lat, s.lng] = area.at;
      s.approximate = true;
    }
  }
  const pinned = smaller.filter((s) => s.lat != null).length;
  log(`smaller filings: ${smaller.length} listed, ${pinned} with a pin; ${read} pages read this build from ${Math.max(0, spare)} spare, ${reused} from earlier builds${stopped}`);
  return { read, reused };
}

/**
 * Every new page read stops after this long into the build's TABS work, so the
 * whole Website job stays inside its 30 minutes; what is left waits, listed,
 * for the next build.
 */
export const PAGE_TIME_MS = 11 * 60_000;
/** Save the checkpoint after this many new page reads. */
const CHECKPOINT_EVERY = 25;

/**
 * Every current new building and addition in each market's counties, with no
 * cost cut. The biggest (the metro's cap) are read first, as before, and stay
 * the headline set market.json carries; every other filing is listed too, and
 * gets its page, address and pin from the page reads left over, biggest first,
 * taking turns across metros. A filing whose page hasn't been read yet is
 * listed by name, number and cost (awaiting). Pages read on any earlier build,
 * or saved to the checkpoint by a build that was cut short, are never read again.
 */
export async function fetchDevelopments(cities: readonly City[], options: FetchDevelopmentsOptions = {}): Promise<DevelopmentsResult> {
  const { now = new Date(), previous = [], previousSmaller = [], clock = Date.now, pauseMs = 300, log = () => {}, trace = [], checkpoint, pageTimeMs = PAGE_TIME_MS, ...http } = options;
  const started = clock();
  const known = new Map<string, PageDetails>();
  for (const s of previousSmaller)
    if (s.paged) known.set(s.id, { address: s.address ?? null, owner: s.owner ?? null, tenant: null, designFirm: null, scope: null, squareFeet: null, isPublic: s.isPublic ?? false, lat: s.lat ?? null, lng: s.lng ?? null, approximate: s.approximate ?? false });
  const before = new Map(previous.filter((p) => (p.source ?? 'tabs') === 'tabs' && !p.awaiting).map((p) => [p.id, p]));
  for (const p of before.values()) known.set(p.id, p);
  const saved = checkpoint ? await checkpoint.load().catch(() => new Map<string, PageDetails>()) : new Map<string, PageDetails>();
  for (const [id, d] of saved) if (!known.has(id)) known.set(id, d);
  if (saved.size) log(`checkpoint: ${saved.size} page details from a build that was cut short`);
  const fresh = new Map<string, PageDetails>(saved);
  const coverage: TabsCoverage[] = [];
  const budget = searchBudget(pauseMs);
  let pages = 0;
  let retries = GEOCODE_RETRIES;

  // City names for each row's city id; the address tail is the fallback.
  const places = await fetchText(`${TABS}/Search`, { timeoutMs: 60_000, ...http })
    .then(parseCityOptions)
    .catch(() => new Map<number, string>());

  // Search every metro first, so the page budget can be shared fairly.
  const searched: [City, TabsRow[], boolean][] = [];
  const metros: MetroCoverage[] = [];
  for (const city of cities) {
    if (!METRO_COUNTIES[city]) {
      log(`${city}: no TABS counties yet; skipped.`);
      continue;
    }
    const all = await searchMetroAll(city, now, { ...http, budget, uncapped: true });
    const whole = all.coverage.every((c) => c.complete);
    coverage.push(...all.coverage);
    log(`${city} counties: ${tabsCoverageLine(all.coverage)}`);
    const counts = all.coverage.map((c) => c.reported);
    metros.push({
      city,
      filings: all.rows.length,
      cap: capFor(city),
      cutoff: null,
      complete: whole,
      reported: counts.every((n) => n != null) ? counts.reduce<number>((a, n) => a + n!, 0) : null,
      skippedWindows: 0
    });
    log(`${city} metro: ${all.rows.length} current filings collected${whole ? '' : '; READ INCOMPLETE'}`);
    for (const id of trace) {
      const at = all.rows.findIndex((r) => r.ProjectNumber === id);
      if (at >= 0) log(`trace ${id}: ${city} rank ${at + 1} of ${all.rows.length} current filings ($${Math.round(all.rows[at]!.EstimatedCost).toLocaleString('en-US')}); ${at < capFor(city) ? 'headline' : 'below the headline cap, listed in full'}`);
    }
    searched.push([city, all.rows, whole]);
  }
  log(`${budget.used} TABS searches this build`);

  const timeLeft = () => clock() - started < pageTimeMs;
  const failed = new Set<string>();
  const readPage = async (row: TabsRow, city: City): Promise<boolean> => {
    if (pages++) await pause(pauseMs);
    try {
      const details = projectDetails(parseProjectPage(await fetchText(tabsProjectUrl(row.ProjectNumber), { timeoutMs: 60_000, ...http })));
      const address = geocodable(details.address);
      const g = address ? await geocodeChecked(address, city, http).catch(() => null) : null;
      const at = g?.at ?? null;
      const location = at
        ? locationInfo('geocoded-address', CENSUS_SOURCE, dayOf(now), g?.flag ? { flags: [g.flag] } : {})
        : isConflict(g?.rejected)
          ? locationInfo('none', `Location unavailable: ${g!.rejected}`, dayOf(now), { flags: ['address conflict'] })
          : undefined;
      const got: PageDetails = { ...details, lat: at?.[0] ?? null, lng: at?.[1] ?? null, approximate: false, ...(location ? { location } : {}) };
      known.set(row.ProjectNumber, got);
      fresh.set(row.ProjectNumber, got);
      if (checkpoint && fresh.size % CHECKPOINT_EVERY === 0) await checkpoint.save(fresh).catch(() => {});
      return true;
    } catch {
      failed.add(row.ProjectNumber);
      return false;
    }
  };

  // Headline pages first: each metro's biggest, the budget shared by need.
  const allowance = shareBudget(
    new Map(searched.map(([city, rows]) => [city, rows.slice(0, capFor(city)).filter((r) => !known.has(r.ProjectNumber)).length])),
    MAX_NEW_PAGES
  );
  let stopped = '';
  for (const [city, rows] of searched) {
    let left = allowance.get(city) ?? 0;
    for (const row of rows.slice(0, capFor(city))) {
      if (known.has(row.ProjectNumber) || left <= 0) continue;
      if (!timeLeft()) {
        stopped = ' (time limit reached)';
        break;
      }
      left--;
      await readPage(row, city);
    }
  }
  // Then every other filing with the reads left: traced ids, then biggest first, metros in turn.
  const queues = searched.map(([city, rows]) => rows.slice(capFor(city)).filter((r) => !known.has(r.ProjectNumber)).map((r) => [city, r] as const));
  for (const q of queues) q.sort((a, b) => Number(trace.includes(b[1].ProjectNumber)) - Number(trace.includes(a[1].ProjectNumber)));
  const order: (readonly [City, TabsRow])[] = [];
  for (let i = 0; queues.some((q) => q.length > i); i++) for (const q of queues) if (q[i]) order.push(q[i]!);
  for (const [city, row] of order) {
    if (pages >= MAX_NEW_PAGES) break;
    if (!timeLeft()) {
      stopped = ' (time limit reached)';
      break;
    }
    await readPage(row, city);
  }
  if (checkpoint && fresh.size) await checkpoint.save(fresh).catch(() => {});

  const finished = new Date(now.getTime() - FINISHED_DAYS * DAY_MS).toISOString().slice(0, 10);
  const projects: Development[] = [];
  for (const [city, rows, whole] of searched) {
    const cap = capFor(city);
    for (const [i, row] of rows.entries()) {
      const old = before.get(row.ProjectNumber);
      const d = known.get(row.ProjectNumber);
      let lat = d?.lat ?? null;
      let lng = d?.lng ?? null;
      let approximate = d?.approximate ?? false;
      let location: LocationInfo | undefined = d?.location;
      // A borrowed point is never carried over: the city permits are matched
      // again below under the same-site rules, so a point lent by an earlier,
      // looser match (street number and name only) does not stick.
      if (old?.locatedFrom || location?.method === 'same-site-permit') {
        lat = lng = null;
        location = undefined;
      }
      // A ZIP area is drawn from this build's ZIP data, never carried over.
      if (approximate) {
        lat = lng = null;
        approximate = false;
        location = undefined;
      }
      // A point saved before provenance was kept is the filed address's geocode.
      if (lat != null && lng != null && !location) location = locationInfo(inferMethod({ lat, lng }), CENSUS_SOURCE, 'not recorded', { rules: 1 });
      // A project with no point gets another try: the geocoder learns new streets.
      // A point removed by today's checks is not tried again here; revalidation retries it when the checks change.
      if (d && !fresh.has(row.ProjectNumber) && lat == null && retries > 0 && !(location?.method === 'none' && (location.rules ?? 1) >= RULES)) {
        const address = geocodable(d.address);
        if (address) {
          retries--;
          const at = await geocode(address, city, http).catch(() => null);
          if (at) {
            [lat, lng] = at;
            location = locationInfo('geocoded-address', CENSUS_SOURCE, dayOf(now));
          }
        }
      }
      const link = developerLink(d?.owner ?? null, row.ProjectName, city);
      projects.push({
        id: row.ProjectNumber,
        city,
        place: places.get(row.City) ?? placeOf(d?.address ?? null),
        name: row.ProjectName.trim(),
        facility: row.FacilityName && row.FacilityName.trim() !== row.ProjectName.trim() ? row.FacilityName.trim() : null,
        status: statusLabel(row.ProjectStatus),
        statusCode: row.ProjectStatus,
        work: WORK[row.TypeOfWork] ?? 'New construction',
        cost: Math.round(row.EstimatedCost),
        registered: isoDate(row.ProjectCreatedOn) ?? '',
        start: isoDate(row.EstimatedStartDate),
        end: isoDate(row.EstimatedEndDate),
        address: d?.address ?? null,
        owner: d?.owner ?? null,
        tenant: d?.tenant ?? null,
        designFirm: d?.designFirm ?? null,
        scope: d?.scope ?? null,
        squareFeet: d?.squareFeet ?? null,
        isPublic: d?.isPublic ?? false,
        lat,
        lng,
        approximate,
        ...(location ? { location } : {}),
        ...(old?.aliases?.length ? { aliases: [...old.aliases] } : {}),
        developerUrl: link.url,
        developerDirect: link.direct,
        url: tabsPermalink(row.ProjectNumber),
        ...(d ? {} : { awaiting: true }),
        ...(i < cap ? { headline: true } : {})
      });
    }
    // A short read must not quietly shrink the map: earlier projects this read
    // could not see stay, until their end date passes.
    if (!whole) {
      const have = new Set(projects.map((p) => p.id));
      const earlier = previous.filter((p) => p.city === city && (p.source ?? 'tabs') === 'tabs' && !have.has(p.id) && !(p.end && p.end < finished));
      projects.push(...earlier.map((p) => ({ ...p })));
      if (earlier.length) log(`${city} metro: ${earlier.length} kept from the last build because the read was incomplete`);
    }
  }
  const awaitingCount = projects.filter((p) => p.awaiting).length;
  log(`read ${pages} new project pages${stopped}; ${awaitingCount} filings still wait for their page${failed.size ? ` (${failed.size} pages failed this build)` : ''}`);

  // Cached geocodes from before today's checks are geocoded again and must
  // pass them (a share each build); a point that fails is removed, not kept.
  await revalidatePoints(projects, now, { http, pauseMs: Math.min(pauseMs, 300), log });

  // Cities that publish their building permits catch what TABS misses: every
  // permit of $50,000 or more (TABS's own floor), the biggest CITY_MAX headline.
  projects.push(
    ...(await fetchCityPermitProjects(cities, now, projects, {
      ...http,
      log,
      minValue: 50_000,
      max: Number.POSITIVE_INFINITY,
      inMetro: (city, at) => distanceKm(at, CITY_CENTERS[city]) <= METRO_RADIUS_KM[city]
    }))
  );

  // Whatever has no trustworthy point is "Location not verified": with a ZIP,
  // its ZIP's area is drawn (at the area's center, never spread out to look
  // like separate sites); without one it stays off the map. Every point is
  // then checked against its market and ZIP, and anything odd is flagged for
  // the audit (flags never move a point).
  const areas = await fetchZipAreas(now, http).catch(() => new Map<string, ZipArea>());
  for (const p of projects) {
    if (p.lat != null && p.lng != null) {
      const check = checkPoint([p.lat, p.lng], { center: CITY_CENTERS[p.city], radiusKm: METRO_RADIUS_KM[p.city], zip: zipOf(p.address), zips: areas });
      if (!check.ok) {
        log(`${p.id}: point ${p.lat},${p.lng} dropped (${check.flags.join('; ')})`);
        p.lat = p.lng = null;
        delete p.location;
        delete p.locatedFrom;
      } else if (check.flags.length && p.location) p.location.flags = check.flags;
      if (p.lat != null) continue;
    }
    // An address that conflicts with the geocoder's match stays "location
    // unavailable": its filed ZIP may be the wrong part, so no area either.
    if (p.location?.method === 'none') continue;
    const zip = zipOf(p.address);
    const area = zip ? areas.get(zip) : undefined;
    if (!zip || !area || distanceKm(area.at, CITY_CENTERS[p.city]) > METRO_RADIUS_KM[p.city]) continue;
    [p.lat, p.lng] = area.at;
    p.approximate = true;
    p.location = locationInfo('zip-area', `Census ZIP code tabulation area ${zip} (gazetteer)`, dayOf(now), { zip, areaKm: Math.round(area.radiusKm * 10) / 10 });
  }
  for (const m of metros) Object.assign(m, locationCounts(projects.filter((p) => p.city === m.city)));
  const exact = projects.filter((p) => p.lat != null && !p.approximate).length;
  const near = projects.filter((p) => p.approximate).length;
  log(`${projects.length} projects listed; ${exact} placed at their address or site, ${near} at their ZIP code's center, ${awaitingCount} awaiting their page, ${projects.length - exact - near - awaitingCount} read but not placed`);
  for (const id of trace) {
    const p = projects.find((x) => x.id === id);
    if (!p) {
      log(`trace ${id}: not listed (not among the current filings read)`);
      continue;
    }
    log(`trace ${id}: listed in ${p.city}${p.headline ? ' (headline)' : ''}; ${p.awaiting ? 'page not read yet' : before.has(id) ? 'page from an earlier build' : saved.has(id) ? 'page from the checkpoint' : 'page read this build'}; pin ${p.lat ?? '-'},${p.lng ?? '-'} ${p.approximate ? '(ZIP area, not verified)' : p.locatedFrom ? `(${p.locatedFrom})` : p.lat != null ? '(geocoded address)' : '(none)'}; aliases ${JSON.stringify(p.aliases ?? [])}`);
  }
  // Builds keep going while pages wait; a page that failed this build is tried next time but doesn't hold the cache open.
  const waiting = projects.filter((p) => p.awaiting && !failed.has(p.id)).length;
  return { asOf: now.toISOString(), projects, coverage, metros, smaller: [], waiting };
}

/** How a market's projects are located, for the coverage note. */
export function locationCounts(projects: Development[]): Required<Pick<MetroCoverage, 'listed' | 'exact' | 'site' | 'approximate' | 'awaiting' | 'unlocated'>> {
  const placed = projects.filter((p) => p.lat != null && p.lng != null);
  const awaiting = projects.filter((p) => p.awaiting).length;
  return {
    listed: projects.length,
    exact: placed.filter((p) => !p.approximate && !p.locatedFrom).length,
    site: placed.filter((p) => !p.approximate && p.locatedFrom).length,
    approximate: placed.filter((p) => p.approximate).length,
    awaiting,
    unlocated: projects.filter((p) => (p.lat == null || p.lng == null) && !p.awaiting).length
  };
}
