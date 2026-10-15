import { fetchBuffer, fetchJson, fetchText, type FetchJsonOptions } from '../lib/http.js';
import { unzip, xmlText } from '../lib/xlsx.js';
import type { City } from '../types.js';
import { fetchCityPermitProjects } from './cityPermits.js';
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
}

export interface DevelopmentsResult {
  asOf: string;
  projects: Development[];
  /** How each county's TABS read went; a map built from an incomplete read says so. */
  coverage?: TabsCoverage[];
  /** Per metro: what the map shows against what TABS holds, for the coverage note. */
  metros?: MetroCoverage[];
  /** Current filings below each metro's cap that this build saw, listed without pins (no page read). */
  smaller?: SmallerFiling[];
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
}

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
  /** TABS ids to report on in the log: rank, cap, page read and final pin. */
  trace?: string[];
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
      short.push(`${usDate(since)} (${data.length} of ${total ?? `${SEARCH_PAGE}+`})`);
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
  options: FetchJsonOptions & { budget?: SearchBudget; cap?: number } = {}
): Promise<{ rows: TabsRow[]; coverage: TabsCoverage[] }> {
  const { cap = capFor(city), ...rest } = options;
  const seen = new Map<string, TabsRow>();
  const coverage: TabsCoverage[] = [];
  // The cap-th biggest current filing seen so far: a lower bound on the true
  // cutoff, so a window skipped below it can only hold projects the map drops anyway.
  const floor = (soFar: TabsRow[]) => {
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

export async function fetchDevelopments(cities: readonly City[], options: FetchDevelopmentsOptions = {}): Promise<DevelopmentsResult> {
  const { now = new Date(), previous = [], pauseMs = 300, log = () => {}, trace = [], ...http } = options;
  const known = new Map(previous.map((p) => [p.id, p]));
  const projects: Development[] = [];
  const waited = new Set<string>();
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
  const smaller: SmallerFiling[] = [];
  for (const city of cities) {
    if (!METRO_COUNTIES[city]) {
      log(`${city}: no TABS counties yet; skipped.`);
      continue;
    }
    const all = await searchMetroAll(city, now, { ...http, budget });
    const cap = capFor(city);
    const rows = all.rows.slice(0, cap);
    const whole = all.coverage.every((c) => c.complete);
    coverage.push(...all.coverage);
    log(`${city} counties: ${tabsCoverageLine(all.coverage)}`);
    const last = rows[rows.length - 1];
    const counts = all.coverage.map((c) => c.reported);
    metros.push({
      city,
      filings: all.rows.length,
      cap,
      cutoff: all.rows.length > cap && last ? Math.round(last.EstimatedCost) : null,
      complete: whole,
      reported: counts.every((n) => n != null) ? counts.reduce<number>((a, n) => a + n!, 0) : null,
      skippedWindows: all.coverage.reduce((a, c) => a + (c.skipped ?? 0), 0)
    });
    smaller.push(...smallerFilings(city, all.rows, places));
    log(
      `${city} metro: ${all.rows.length} current filings, the biggest ${rows.length} kept (cap ${cap}${all.rows.length > cap && last ? `; smallest kept $${Math.round(last.EstimatedCost).toLocaleString('en-US')}` : ''})${whole ? '' : '; READ INCOMPLETE'}`
    );
    for (const id of trace) {
      const at = all.rows.findIndex((r) => r.ProjectNumber === id);
      if (at >= 0) log(`trace ${id}: search row ${JSON.stringify(all.rows[at])}`);
      if (at >= 0) log(`trace ${id}: ${city} rank ${at + 1} of ${all.rows.length} current filings ($${Math.round(all.rows[at]!.EstimatedCost).toLocaleString('en-US')}); ${at < cap ? `within the cap of ${cap}` : `below the cap of ${cap}`}`);
    }
    searched.push([city, rows, whole]);
  }
  log(`${budget.used} TABS searches this build`);
  const allowance = shareBudget(
    new Map(searched.map(([city, rows]) => [city, rows.filter((r) => !known.has(r.ProjectNumber)).length])),
    MAX_NEW_PAGES
  );

  const finished = new Date(now.getTime() - FINISHED_DAYS * DAY_MS).toISOString().slice(0, 10);
  for (const [city, rows, whole] of searched) {
    let left = allowance.get(city) ?? 0;
    let waiting = 0;
    for (const row of rows) {
      const old = known.get(row.ProjectNumber);
      let details: ProjectDetails;
      let lat = old?.lat ?? null;
      let lng = old?.lng ?? null;
      let approximate = old?.approximate ?? false;
      let locatedFrom = old?.locatedFrom;
      if (old) {
        details = old;
        // A pin that missed or sits at the ZIP center gets another try: the
        // geocoder learns new streets, and a ZIP center should not stick forever.
        const address = (lat == null || approximate) && !locatedFrom ? geocodable(details.address) : null;
        if (address && retries > 0) {
          retries--;
          const at = await geocode(address, city, http).catch(() => null);
          if (at) {
            [lat, lng] = at;
            approximate = false;
          } else if (approximate) {
            // Placed again at its ZIP center below, with this build's spread.
            lat = lng = null;
            approximate = false;
          }
        }
      } else {
        if (left <= 0) {
          waiting++;
          waited.add(row.ProjectNumber);
          continue;
        }
        left--;
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
        status: statusLabel(row.ProjectStatus),
        statusCode: row.ProjectStatus,
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
        ...(locatedFrom ? { locatedFrom } : {}),
        developerUrl: link.url,
        developerDirect: link.direct,
        url: tabsPermalink(row.ProjectNumber)
      });
    }
    // A short read must not quietly shrink the map: earlier projects this read
    // could not see stay, until their end date passes, while the cap has room.
    let kept = 0;
    if (!whole) {
      const have = new Set(projects.map((p) => p.id));
      const room = capFor(city) - rows.length + waiting;
      const earlier = previous
        .filter((p) => p.city === city && (p.source ?? 'tabs') === 'tabs' && !have.has(p.id) && !(p.end && p.end < finished))
        .sort((x, y) => y.cost - x.cost)
        .slice(0, Math.max(0, room));
      projects.push(...earlier.map((p) => ({ ...p })));
      kept = earlier.length;
    }
    log(
      `${city} metro: ${rows.length - waiting} projects${waiting ? `; ${waiting} more wait for a later build` : ''}${kept ? `; ${kept} kept from the last build because the read was incomplete` : ''}`
    );
  }

  // Cities that publish their building permits catch what TABS misses.
  projects.push(
    ...(await fetchCityPermitProjects(cities, now, projects, {
      ...http,
      log,
      inMetro: (city, at) => distanceKm(at, CITY_CENTERS[city]) <= METRO_RADIUS_KM[city]
    }))
  );

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
  for (const id of trace) {
    const p = projects.find((x) => x.id === id);
    const ranked = searched.some(([, rows]) => rows.some((r) => r.ProjectNumber === id));
    if (p) {
      const street = (p.address ?? '').split(',')[0]!.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
      const twins = projects.filter((x) => x !== p && x.city === p.city && x.source === 'city' && street && (x.address ?? '').split(',')[0]!.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim() === street);
      log(`trace ${id}: city entries at the same street address: ${twins.length ? twins.map((x) => `${x.id} "${x.name}"`).join(', ') : 'none (city fallback replaced)'}`);
      log(`trace ${id}: listed in ${p.city}; ${known.has(id) ? 'page from an earlier build' : 'page read this build'}; pin ${p.lat ?? '-'},${p.lng ?? '-'} ${p.approximate ? '(ZIP center)' : p.locatedFrom ? `(${p.locatedFrom})` : p.lat != null ? '(geocoded address)' : '(none)'}; aliases ${JSON.stringify(p.aliases ?? [])}`);
    } else {
      log(`trace ${id}: not listed (${waited.has(id) ? 'within the cap, page waits for a later build' : ranked ? 'dropped' : 'not among the current filings read'})`);
    }
  }
  for (const id of trace) {
    const s = smaller.find((x) => x.id === id);
    if (s) log(`trace ${id}: in the ${s.city} smaller-filings list ($${s.cost.toLocaleString('en-US')}), no pin`);
  }
  return { asOf: now.toISOString(), projects, coverage, metros, smaller };
}
