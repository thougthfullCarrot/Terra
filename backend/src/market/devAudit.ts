import { fetchJson, fetchText, type FetchJsonOptions } from '../lib/http.js';
import { CITIES, type City } from '../types.js';
import { developerLink } from './developers.js';
import { CITY_MAX, MIN_VALUE, PERMIT_SOURCES, permitProjects, siteKey, type PermitSource } from './cityPermits.js';
import {
  CITY_CENTERS,
  DONE,
  LOOKBACK_DAYS,
  MAX_SMALLER,
  METRO_COUNTIES,
  METRO_RADIUS_KM,
  SEARCH_PAGE,
  TABS_COUNTY_IDS,
  TABS_SEARCH_URL,
  WORK,
  capFor,
  distanceKm,
  geocodable,
  geocodeUrl,
  parseProjectPage,
  placeOf,
  projectDetails,
  searchForm,
  statusLabel,
  tabsPermalink,
  tabsProjectUrl,
  zipOf,
  type Development,
  type ProjectDetails,
  type SmallerFiling,
  type TabsRow
} from './developments.js';

/**
 * Development collection and location audit (Rod, 2026-10-16).
 *
 * The map build (developments.ts) keeps the biggest filings per metro and
 * stops splitting TABS date windows once they fall below that cut, so a small
 * project such as PDL Club can be missed before the browser ever sees it. This
 * audit reads every eligible new building and addition in each market's
 * counties with no cost cut, joins the city permits it can read, places each
 * project only from evidence (its own permit point, its geocoded address,
 * another permit at the same site, or its ZIP center, each labelled) and
 * reports what is complete, what was excluded and why, and what has no point.
 *
 * Collection and display are separate: every eligible project is listed, and
 * how many pins the browser draws is a display choice reported apart.
 *
 * It only reads public sources and writes local files. Searches, pages,
 * geocodes and city reads go through a cache, so an interrupted run resumes
 * where it stopped instead of starting over.
 */

const TABS = 'https://www.tdlr.texas.gov/TABS';
const DAY_MS = 86_400_000;
const FINISHED_DAYS = 120;
const MAX_COST = 5e9;
const MAX_SCHOOL_COST = 4e8;
const SCHOOL = /\bISD\b|independent school|elementary|middle school|high school/i;
/** TABS's own floor: projects under $50,000 do not register. City permits are read down to the same value. */
export const AUDIT_MIN_VALUE = 50_000;

const isoDate = (value: string | null | undefined) => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null);
const day = (d: Date) => d.toISOString().slice(0, 10);
const pause = (ms: number) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

// --- Cache: a key-value store the bin backs with files, tests with a Map. ---

export interface AuditCache {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  /** When the entry was written (ISO), so a report can tell an earlier run's answer from this run's. */
  savedAt?(key: string): Promise<string | undefined>;
}

/** Cache kinds a run reads fresh even when cached: a verification run passes ['search', 'city']. */
export type RefreshKind = 'search' | 'city';

export function memoryCache(): AuditCache & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  const saved = new Map<string, string>();
  return {
    map,
    get: async <T>(key: string) => map.get(key) as T | undefined,
    set: async (key, value) => {
      map.set(key, value);
      saved.set(key, new Date().toISOString());
    },
    savedAt: async (key) => saved.get(key)
  };
}

/** Limits shared by the whole run. Each counts down; at zero the work waits for the next run. */
export interface AuditBudget {
  searches: number;
  pages: number;
  geocodes: number;
  /** Clock time (ms since epoch) after which no new network read starts. */
  deadline: number;
  pauseMs: number;
  used: { searches: number; pages: number; geocodes: number; cityReads: number; cached: number };
}

export const auditBudget = (over: Partial<Omit<AuditBudget, 'used'>> = {}): AuditBudget => ({
  searches: 2000,
  pages: 3000,
  geocodes: 4000,
  deadline: Number.POSITIVE_INFINITY,
  pauseMs: 300,
  ...over,
  used: { searches: 0, pages: 0, geocodes: 0, cityReads: 0, cached: 0 }
});

// --- Eligibility, with a reason for every row left out. ---

export type Exclusion =
  | 'not new construction or addition'
  | 'closed or inspection complete'
  | 'estimated end over 120 days past'
  | 'no cost filed'
  | 'implausible cost (typo)'
  | 'highway segment (CSJ)';

/** Why a TABS row is not a current development, or null when it is. Mirrors currentDevelopments. */
export function exclusionReason(r: TabsRow, now: Date): Exclusion | null {
  const names = `${r.ProjectName} ${r.FacilityName ?? ''}`;
  const finished = day(new Date(now.getTime() - FINISHED_DAYS * DAY_MS));
  const end = isoDate(r.EstimatedEndDate);
  if (!WORK[r.TypeOfWork]) return 'not new construction or addition';
  if (DONE.has(r.ProjectStatus)) return 'closed or inspection complete';
  if (end && end < finished) return 'estimated end over 120 days past';
  if (!(r.EstimatedCost > 0)) return 'no cost filed';
  if (r.EstimatedCost >= (SCHOOL.test(names) ? MAX_SCHOOL_COST : MAX_COST)) return 'implausible cost (typo)';
  if (/\bCSJ\b/i.test(names)) return 'highway segment (CSJ)';
  return null;
}

// --- TABS collection with no cost cut. ---

export interface WindowRead {
  /** YYYY-MM-DD..YYYY-MM-DD */
  window: string;
  reported: number | null;
  returned: number;
  /** True when every match in the window came back. */
  whole: boolean;
  /** How it was read: one search, or a busy day read from both ends. */
  how: 'search' | 'both ends' | 'budget';
  cached: boolean;
  /** When TDLR answered this window's search (ISO): this run, or the earlier run whose cached answer was used. */
  fetchedAt?: string;
}

export interface CountyRead {
  county: string;
  city: City;
  reported: number | null;
  rows: TabsRow[];
  windows: WindowRead[];
  complete: boolean;
  /** Matches TABS reported that were never returned (busy days, budget). */
  missing: number;
  error?: string;
  /** Which window first returned each row, for traces. */
  foundIn: Map<string, string>;
}

const usDate = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;

interface SearchPage {
  data?: TabsRow[];
  recordsFiltered?: number;
}

/** One TABS search, cached by county, window and sort direction. */
async function search(
  county: string,
  since: Date,
  until: Date,
  dir: 'desc' | 'asc',
  ctx: { http: FetchJsonOptions; cache: AuditCache; budget: AuditBudget; clock: () => number; fresh: boolean }
): Promise<{ page: SearchPage; cached: boolean; fetchedAt?: string } | null> {
  const key = `search/${county}/${day(since)}_${day(until)}_${dir}`;
  const hit = ctx.fresh ? undefined : await ctx.cache.get<SearchPage>(key);
  if (hit) {
    ctx.budget.used.cached++;
    return { page: hit, cached: true, fetchedAt: await ctx.cache.savedAt?.(key) };
  }
  if (ctx.budget.searches <= 0 || ctx.clock() > ctx.budget.deadline) return null;
  ctx.budget.searches--;
  if (ctx.budget.used.searches++) await pause(ctx.budget.pauseMs);
  const form = searchForm(county, since, until, SEARCH_PAGE);
  form['order[0][dir]'] = dir;
  const page = await fetchJson<SearchPage>(TABS_SEARCH_URL, {
    timeoutMs: 120_000,
    ...ctx.http,
    form,
    headers: { 'x-requested-with': 'XMLHttpRequest', referer: `${TABS}/Search/` }
  });
  if (!Array.isArray(page.data)) throw new Error('TABS answered without a result list');
  const keep: SearchPage = { data: page.data, ...(typeof page.recordsFiltered === 'number' ? { recordsFiltered: page.recordsFiltered } : {}) };
  await ctx.cache.set(key, keep);
  return { page: keep, cached: false, fetchedAt: new Date(ctx.clock()).toISOString() };
}

/**
 * Every filing a county registered over the lookback. TABS returns at most 100
 * rows a search and ignores the page offset, so windows are split until each
 * comes back whole. A single day with more than 100 filings is read twice,
 * biggest first and smallest first: up to 200 that way, and anything past that
 * is counted as missing rather than guessed.
 */
export async function auditCounty(
  county: string,
  city: City,
  now: Date,
  ctx: { http?: FetchJsonOptions; cache: AuditCache; budget: AuditBudget; clock?: () => number; fresh?: boolean }
): Promise<CountyRead> {
  const c = { http: ctx.http ?? {}, cache: ctx.cache, budget: ctx.budget, clock: ctx.clock ?? Date.now, fresh: ctx.fresh ?? false };
  const rows = new Map<string, TabsRow>();
  const foundIn = new Map<string, string>();
  const windows: WindowRead[] = [];
  let reported: number | null = null;
  const add = (data: TabsRow[], window: string) => {
    for (const r of data) {
      rows.set(r.ProjectNumber, r);
      if (!foundIn.has(r.ProjectNumber)) foundIn.set(r.ProjectNumber, window);
    }
  };

  const read = async (since: Date, until: Date, top: boolean): Promise<void> => {
    const window = `${day(since)}..${day(until)}`;
    const got = await search(county, since, until, 'desc', c);
    if (!got) {
      windows.push({ window, reported: null, returned: 0, whole: false, how: 'budget', cached: false });
      return;
    }
    const data = got.page.data ?? [];
    const total = got.page.recordsFiltered ?? null;
    if (top) reported = total;
    add(data, window);
    const whole = total != null ? data.length >= total : data.length < SEARCH_PAGE;
    const days = Math.round((until.getTime() - since.getTime()) / DAY_MS);
    if (whole) {
      windows.push({ window, reported: total, returned: data.length, whole: true, how: 'search', cached: got.cached, fetchedAt: got.fetchedAt });
      return;
    }
    if (days <= 1) {
      // A busy day: the smallest-first read reaches the other end.
      const low = await search(county, since, until, 'asc', c);
      const ids = new Set(data.map((r) => r.ProjectNumber));
      if (low) {
        add(low.page.data ?? [], window);
        for (const r of low.page.data ?? []) ids.add(r.ProjectNumber);
      }
      windows.push({ window, reported: total, returned: ids.size, whole: total != null && ids.size >= total, how: low ? 'both ends' : 'budget', cached: got.cached && !!low?.cached, fetchedAt: low?.fetchedAt && got.fetchedAt && low.fetchedAt > got.fetchedAt ? low.fetchedAt : got.fetchedAt });
      return;
    }
    windows.push({ window, reported: total, returned: data.length, whole: false, how: 'search', cached: got.cached, fetchedAt: got.fetchedAt });
    const pieces = Math.min(days, Math.max(2, Math.ceil((total ?? SEARCH_PAGE * 2) / 80)));
    for (let i = 0; i < pieces; i++) {
      const from = new Date(since.getTime() + Math.round((i * days) / pieces) * DAY_MS);
      const to = i === pieces - 1 ? until : new Date(since.getTime() + Math.round(((i + 1) * days) / pieces) * DAY_MS);
      await read(from, to, false);
    }
  };

  try {
    await read(new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS), now, true);
  } catch (error) {
    return { county, city, reported, rows: [...rows.values()], windows, complete: false, missing: Math.max(0, (reported ?? 0) - rows.size), error: error instanceof Error ? error.message : String(error), foundIn };
  }
  // Split windows' own entries are superseded by their pieces; only leaves count.
  const leaves = windows.filter((w) => w.whole || w.how !== 'search' || !windows.some((o) => o !== w && inside(o.window, w.window)));
  const missing = reported != null ? Math.max(0, reported - rows.size) : leaves.filter((w) => !w.whole).length ? 1 : 0;
  return { county, city, reported, rows: [...rows.values()], windows: leaves, complete: missing === 0 && leaves.every((w) => w.whole), missing, foundIn };
}

const inside = (inner: string, outer: string) => {
  const [a, b] = inner.split('..');
  const [c, d] = outer.split('..');
  return inner !== outer && a! >= c! && b! <= d!;
};

// --- Records: one per development, every source it came from. ---

export type LocationClass = 'exact-permit' | 'exact-geocode' | 'site' | 'approximate' | 'none';

export interface SourceRef {
  kind: 'tabs' | 'city';
  id: string;
  url: string;
  /** City permit numbers behind a city project. */
  permits?: string[];
}

export interface AuditRecord {
  key: string;
  market: City;
  name: string;
  place: string | null;
  cost: number;
  work: string;
  status: string;
  registered: string;
  address: string | null;
  sources: SourceRef[];
  lat: number | null;
  lng: number | null;
  location: LocationClass;
  /** Where the point came from, in words ("City permit 2025-123 at this address", "ZIP 78249 center"). */
  locatedBy: string | null;
  /** Why it has no point, when it has none. */
  noPointReason?: string;
  /** Today's production rules: where this project shows up now. */
  current: 'map' | 'smaller list' | 'not shown';
  /** TABS rank by cost among the market's eligible filings. */
  rank?: number;
  pageRead: 'cache' | 'previous build' | 'fetched' | 'not read' | 'failed' | 'n/a';
  /** When the cached page was read (ISO), for pageRead 'cache'. */
  pageFetchedAt?: string;
  /** The permit whose point placed a 'site' record, and whether that permit is one of the record's merged sources. */
  pointPermit?: { permit: string; merged: boolean };
  start?: string | null;
  end?: string | null;
  owner?: string | null;
  tenant?: string | null;
  designFirm?: string | null;
  scope?: string | null;
  squareFeet?: number | null;
  isPublic?: boolean;
  facility?: string | null;
  contractor?: string | null;
}

export interface Duplicate {
  kind: 'same TABS id in two counties' | 'city permit matched a TABS filing (merged)' | 'possible duplicate (kept separate)';
  ids: string[];
  note: string;
}

export interface MarketAudit {
  market: City;
  counties: string[];
  reads: CountyRead[];
  complete: boolean;
  reported: number | null;
  read: number;
  exclusions: Record<string, number>;
  eligible: number;
  cityReads: { source: string; permits: number; projects: number; error?: string; cached?: boolean; fetchedAt?: string }[];
  records: AuditRecord[];
  duplicates: Duplicate[];
  pages: { needed: number; done: number; waiting: number };
  geocodes: { tried: number; matched: number; outsideMetro: number; waiting: number };
  rejectedPoints: string[];
}

/** A permit or geocoded point must fall inside the market's metro, or it is a wrong match. */
export const inMetro = (city: City, at: [number, number]) => distanceKm(at, CITY_CENTERS[city]) <= METRO_RADIUS_KM[city];

/** Details a previous build already read, by TABS id (main map and paged smaller filings). */
export function previousPages(projects: Development[] = [], smaller: SmallerFiling[] = []): Map<string, Partial<ProjectDetails> & { address: string | null }> {
  const out = new Map<string, Partial<ProjectDetails> & { address: string | null }>();
  for (const p of projects)
    if ((p.source ?? 'tabs') === 'tabs')
      out.set(p.id, { address: p.address, owner: p.owner, tenant: p.tenant, designFirm: p.designFirm, scope: p.scope, squareFeet: p.squareFeet, isPublic: p.isPublic });
  for (const s of smaller) if (s.paged) out.set(s.id, { address: s.address ?? null, owner: s.owner ?? null, isPublic: s.isPublic ?? false });
  return out;
}

export interface AuditOptions {
  now: Date;
  cache: AuditCache;
  budget?: AuditBudget;
  http?: FetchJsonOptions;
  clock?: () => number;
  log?: (line: string) => void;
  /** TABS ids whose pages are read first and whose stages are traced. */
  trace?: string[];
  previous?: { projects?: Development[]; smaller?: SmallerFiling[] };
  sources?: PermitSource[];
  /** Read these kinds fresh even when cached (verification). */
  refresh?: RefreshKind[];
  /** ZIP → center; loaded once by the caller (Census gazetteer). */
  zipCenters?: Map<string, [number, number]>;
}

type Geo = { at: [number, number] | null; outside?: boolean };

async function geocodeCached(address: string, city: City, o: Required<Pick<AuditOptions, 'cache' | 'http' | 'clock'>> & { budget: AuditBudget }, stats: MarketAudit['geocodes']): Promise<Geo | null> {
  const key = `geo/${address.toUpperCase()}`;
  const hit = await o.cache.get<{ at: [number, number] | null }>(key);
  let at: [number, number] | null;
  if (hit) at = hit.at;
  else {
    if (o.budget.geocodes <= 0 || o.clock() > o.budget.deadline) {
      stats.waiting++;
      return null;
    }
    o.budget.geocodes--;
    if (o.budget.used.geocodes++) await pause(Math.min(o.budget.pauseMs, 200));
    try {
      const data = await fetchJson<{ result?: { addressMatches?: { coordinates?: { x: number; y: number } }[] } }>(geocodeUrl(address), { timeoutMs: 30_000, ...o.http });
      const p = data.result?.addressMatches?.[0]?.coordinates;
      at = p && Number.isFinite(p.x) && Number.isFinite(p.y) ? [p.y, p.x] : null;
    } catch {
      stats.waiting++;
      return null; // an outage is not a miss: not cached, tried again next run
    }
    await o.cache.set(key, { at });
  }
  stats.tried++;
  if (!at) return { at: null };
  if (!inMetro(city, at)) {
    stats.outsideMetro++;
    return { at: null, outside: true };
  }
  stats.matched++;
  return { at };
}

/** Audit one market: collect, merge, locate, and classify every development. */
export async function auditMarket(market: City, opts: AuditOptions): Promise<MarketAudit> {
  const { now, cache, http = {}, clock = Date.now, log = () => {}, trace = [], sources = PERMIT_SOURCES, zipCenters = new Map(), refresh = [] } = opts;
  const budget = opts.budget ?? auditBudget();
  const counties = METRO_COUNTIES[market] ?? [];
  const reads: CountyRead[] = [];
  const seen = new Map<string, { row: TabsRow; county: string }>();
  const duplicates: Duplicate[] = [];
  for (const county of counties) {
    if (!TABS_COUNTY_IDS[county]) {
      reads.push({ county, city: market, reported: null, rows: [], windows: [], complete: false, missing: 0, error: 'no TABS county id configured', foundIn: new Map() });
      continue;
    }
    const r = await auditCounty(county, market, now, { http, cache, budget, clock, fresh: refresh.includes('search') });
    reads.push(r);
    for (const row of r.rows) {
      const had = seen.get(row.ProjectNumber);
      if (had) duplicates.push({ kind: 'same TABS id in two counties', ids: [row.ProjectNumber], note: `${had.county} and ${county}; counted once` });
      else seen.set(row.ProjectNumber, { row, county });
    }
    log(`${market} / ${county}: ${r.rows.length} of ${r.reported ?? '?'} filings read in ${r.windows.length} windows${r.complete ? '' : ` INCOMPLETE (${r.missing} missing${r.error ? `; ${r.error}` : ''})`}`);
  }

  const exclusions: Record<string, number> = {};
  const eligible: TabsRow[] = [];
  for (const { row } of seen.values()) {
    const why = exclusionReason(row, now);
    if (why) exclusions[why] = (exclusions[why] ?? 0) + 1;
    else eligible.push(row);
  }
  eligible.sort((a, b) => b.EstimatedCost - a.EstimatedCost);
  const cap = capFor(market);

  // Project pages for addresses: earlier builds, the cache, then new reads (traced ids first).
  const prior = previousPages(opts.previous?.projects, opts.previous?.smaller);
  type Got = Partial<ProjectDetails> & { address: string | null; from: AuditRecord['pageRead']; at?: string };
  const details = new Map<string, Got>();
  const order = [...eligible].sort((a, b) => Number(trace.includes(b.ProjectNumber)) - Number(trace.includes(a.ProjectNumber)) || b.EstimatedCost - a.EstimatedCost);
  const pages = { needed: eligible.length, done: 0, waiting: 0 };
  for (const row of order) {
    const id = row.ProjectNumber;
    const cached = await cache.get<ProjectDetails>(`page/${id}`);
    if (cached) {
      details.set(id, { ...cached, from: 'cache', at: await cache.savedAt?.(`page/${id}`) });
    } else if (prior.has(id)) {
      details.set(id, { ...prior.get(id)!, from: 'previous build' });
    } else if (budget.pages > 0 && clock() <= budget.deadline) {
      budget.pages--;
      if (budget.used.pages++) await pause(budget.pauseMs);
      try {
        const d = projectDetails(parseProjectPage(await fetchText(tabsProjectUrl(id), { timeoutMs: 60_000, ...http })));
        await cache.set(`page/${id}`, d);
        details.set(id, { ...d, from: 'fetched', at: new Date(clock()).toISOString() });
      } catch {
        details.set(id, { address: null, from: 'failed' });
        pages.waiting++;
        continue;
      }
    } else {
      details.set(id, { address: null, from: 'not read' });
      pages.waiting++;
      continue;
    }
    pages.done++;
  }

  const records: AuditRecord[] = eligible.map((row, i) => {
    const d = details.get(row.ProjectNumber)!;
    return {
      key: row.ProjectNumber,
      market,
      name: row.ProjectName.trim(),
      place: null,
      cost: Math.round(row.EstimatedCost),
      work: WORK[row.TypeOfWork] ?? 'New construction',
      status: statusLabel(row.ProjectStatus),
      registered: isoDate(row.ProjectCreatedOn) ?? '',
      address: d.address,
      sources: [{ kind: 'tabs', id: row.ProjectNumber, url: tabsPermalink(row.ProjectNumber) }],
      lat: null,
      lng: null,
      location: 'none',
      locatedBy: null,
      current: i < cap ? 'map' : i < cap + MAX_SMALLER ? 'smaller list' : 'not shown',
      rank: i + 1,
      pageRead: d.from,
      ...(d.at && d.from === 'cache' ? { pageFetchedAt: d.at } : {}),
      start: isoDate(row.EstimatedStartDate),
      end: isoDate(row.EstimatedEndDate),
      owner: d.owner ?? null,
      tenant: d.tenant ?? null,
      designFirm: d.designFirm ?? null,
      scope: d.scope ?? null,
      squareFeet: d.squareFeet ?? null,
      isPublic: d.isPublic ?? false,
      facility: row.FacilityName && row.FacilityName.trim() !== row.ProjectName.trim() ? row.FacilityName.trim() : null
    };
  });

  // City permits, read down to TABS's own $50,000 floor, matched to filings by street address.
  const cityReads: MarketAudit['cityReads'] = [];
  const bySite = new Map<string, AuditRecord>();
  for (const r of records) {
    const k = siteKey(r.address);
    if (/^\d/.test(k) && !bySite.has(k)) bySite.set(k, r);
  }
  const cityPoints = new Map<AuditRecord, { at: [number, number]; permit: string }>();
  for (const source of sources.filter((s) => s.market === market)) {
    const key = `city/${source.name}/${day(now)}`;
    try {
      let projects = refresh.includes('city') ? undefined : await cache.get<Development[]>(key);
      let permits = -1;
      const cachedRead = Boolean(projects);
      if (!projects) {
        if (clock() > budget.deadline) throw new Error('run time used up; read on the next run');
        budget.used.cityReads++;
        const raw = await source.fetch(now, { ...http, minValue: AUDIT_MIN_VALUE });
        permits = raw.length;
        projects = permitProjects(raw, now, Number.POSITIVE_INFINITY, AUDIT_MIN_VALUE);
        await cache.set(key, projects);
      }
      cityReads.push({ source: source.name, permits, projects: projects.length, cached: cachedRead, fetchedAt: cachedRead ? await cache.savedAt?.(key) : new Date(clock()).toISOString() });
      // Today's build adds a source's biggest CITY_MAX unmatched projects of MIN_VALUE or more.
      let shown = 0;
      for (const p of projects) {
        const ref: SourceRef = { kind: 'city', id: p.id, url: p.url, permits: p.aliases?.filter((a) => !/\s/.test(a)) ?? [] };
        const match = (p.addresses ?? [p.address]).map((a) => bySite.get(siteKey(a))).find(Boolean);
        const own = p.lat != null && p.lng != null ? ([p.lat, p.lng] as [number, number]) : null;
        if (match) {
          match.sources.push(ref);
          duplicates.push({ kind: 'city permit matched a TABS filing (merged)', ids: [match.key, p.id], note: `same street address ${siteKey(match.address)}` });
          if (own && !cityPoints.has(match)) cityPoints.set(match, { at: own, permit: ref.permits?.[0] ?? p.id });
          continue;
        }
        const rec: AuditRecord = {
          key: p.id,
          market,
          name: p.name,
          place: p.place,
          cost: p.cost,
          work: p.work,
          status: p.status,
          registered: p.registered,
          address: p.address,
          sources: [ref],
          lat: null,
          lng: null,
          location: 'none',
          locatedBy: null,
          current: p.cost >= MIN_VALUE && shown++ < CITY_MAX ? 'map' : 'not shown',
          pageRead: 'n/a',
          owner: p.owner,
          isPublic: p.isPublic,
          squareFeet: p.squareFeet,
          scope: p.scope,
          contractor: p.contractor ?? null,
          start: p.start,
          end: p.end
        };
        if (own) {
          if (inMetro(market, own)) [rec.lat, rec.lng, rec.location, rec.locatedBy] = [own[0], own[1], 'exact-permit', `City permit ${ref.permits?.[0] ?? p.id}'s own point`];
        }
        records.push(rec);
        const k = siteKey(p.address);
        if (/^\d/.test(k) && !bySite.has(k)) bySite.set(k, rec);
      }
    } catch (error) {
      cityReads.push({ source: source.name, permits: 0, projects: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }

  // Locate: own address first, then a permit at the same site, then the ZIP center. Never a guess.
  const geocodes: MarketAudit['geocodes'] = { tried: 0, matched: 0, outsideMetro: 0, waiting: 0 };
  const rejectedPoints: string[] = [];
  const geo = { cache, http, clock, budget };
  for (const r of records) {
    if (r.location !== 'none') continue;
    const address = geocodable(r.address);
    let outside = false;
    if (address) {
      const g = await geocodeCached(address, market, geo, geocodes);
      if (g?.at) {
        [r.lat, r.lng, r.location, r.locatedBy] = [g.at[0], g.at[1], 'exact-geocode', 'Census geocoder match for the filed address'];
        continue;
      }
      if (g?.outside) {
        outside = true;
        rejectedPoints.push(`${r.key}: geocoder match outside the ${market} metro, not used`);
      }
      if (!g) r.noPointReason = 'geocode waits for a later run';
    }
    const site = cityPoints.get(r);
    if (site) {
      if (inMetro(market, site.at)) {
        [r.lat, r.lng, r.location, r.locatedBy] = [site.at[0], site.at[1], 'site', `Borrowed from merged city permit ${site.permit} at the same address`];
        r.pointPermit = { permit: site.permit, merged: true };
        continue;
      }
      rejectedPoints.push(`${r.key}: city permit ${site.permit} point outside the metro, not used`);
    }
    r.noPointReason ??= !r.address ? (r.pageRead === 'not read' || r.pageRead === 'failed' ? 'project page not read yet' : 'no address filed') : !address ? 'address has no street number (road segment or various)' : outside ? 'geocode landed outside the metro' : 'geocoder found no match';
  }

  // Site points from other permits at the same street address (San Antonio).
  for (const source of sources.filter((s) => s.market === market && s.locate)) {
    const need = records.filter((r) => r.location === 'none' && /^\d/.test(siteKey(r.address)));
    if (!need.length) continue;
    try {
      const key = `sites/${source.name}/${day(now)}/${need.length}`;
      let points = await cache.get<[string, { lat: number; lng: number; permit: string; names: string[] }][]>(key);
      if (!points) {
        if (clock() > budget.deadline) throw new Error('run time used up');
        budget.used.cityReads++;
        points = [...(await source.locate!(new Map(need.map((r) => [siteKey(r.address), r.address ?? ''])), now, http))];
        await cache.set(key, points);
      }
      const at = new Map(points);
      for (const r of need) {
        const p = at.get(siteKey(r.address));
        if (!p) continue;
        if (!inMetro(market, [p.lat, p.lng])) {
          rejectedPoints.push(`${r.key}: site point from permit ${p.permit} outside the metro, not used`);
          continue;
        }
        [r.lat, r.lng, r.location, r.locatedBy] = [p.lat, p.lng, 'site', `Borrowed from supporting city permit ${p.permit} at the same address (not merged)`];
        r.pointPermit = { permit: p.permit, merged: false };
        delete r.noPointReason;
      }
    } catch (error) {
      log(`${market} ${source.name} site points not read: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const r of records) {
    if (r.location !== 'none') continue;
    const zip = zipOf(r.address);
    const center = zip ? zipCenters.get(zip) : undefined;
    if (zip && center && inMetro(market, center)) {
      // The true ZIP center: any spreading of pins that share it is the browser's job.
      [r.lat, r.lng, r.location, r.locatedBy] = [center[0], center[1], 'approximate', `ZIP ${zip} center (approximate)`];
      delete r.noPointReason;
    }
  }

  // Possible duplicates the audit does not merge: different filings at one street address with the same cost.
  const groups = new Map<string, AuditRecord[]>();
  for (const r of records) {
    const k = siteKey(r.address);
    if (!/^\d/.test(k)) continue;
    const g = `${k}|${r.cost}`;
    groups.set(g, [...(groups.get(g) ?? []), r]);
  }
  for (const [k, g] of groups) if (g.length > 1) duplicates.push({ kind: 'possible duplicate (kept separate)', ids: g.map((r) => r.key), note: `same address and cost (${k.replace('|', ', $')})` });

  const reportedAll = reads.every((r) => r.reported != null) ? reads.reduce((a, r) => a + r.reported!, 0) : null;
  return {
    market,
    counties,
    reads,
    complete: reads.length > 0 && reads.every((r) => r.complete),
    reported: reportedAll,
    read: seen.size,
    exclusions,
    eligible: eligible.length,
    cityReads,
    records,
    duplicates,
    pages,
    geocodes,
    rejectedPoints
  };
}

// --- Traces and reports. ---

/** Every stage one TABS id went through, from the official filing to the final list and map. */
export function traceLines(id: string, audits: MarketAudit[], now: Date): string[] {
  const out: string[] = [`### ${id}`, '', `Official filing: ${tabsPermalink(id)}`, ''];
  for (const a of audits) {
    const read = a.reads.find((r) => r.rows.some((x) => x.ProjectNumber === id));
    if (!read) continue;
    const row = read.rows.find((x) => x.ProjectNumber === id)!;
    const why = exclusionReason(row, now);
    const rec = a.records.find((r) => r.sources.some((s) => s.kind === 'tabs' && s.id === id));
    out.push(
      `1. **Collected**: ${a.market} market, ${read.county} County, search window ${read.foundIn.get(id)} ("${row.ProjectName.trim()}", $${Math.round(row.EstimatedCost).toLocaleString('en-US')}, ${WORK[row.TypeOfWork] ?? `work code ${row.TypeOfWork}`}, ${statusLabel(row.ProjectStatus)}, registered ${isoDate(row.ProjectCreatedOn)}). County read ${read.rows.length} of ${read.reported ?? '?'}${read.complete ? ', complete' : ', INCOMPLETE'}.`
    );
    if (!rec) {
      out.push(`2. **Eligibility**: excluded (${why ?? 'unknown reason'}). Not listed, not mapped.`, '');
      continue;
    }
    out.push(`2. **Eligibility**: current new construction or addition; rank ${rec.rank} of ${a.eligible} by cost in ${a.market}.`);
    out.push(`3. **Today's production rules**: ${rec.current === 'map' ? `inside the ${capFor(a.market)}-project cap, on the main map` : rec.current === 'smaller list' ? `below the ${capFor(a.market)}-project cap: smaller-filings list only, pinned only when spare page reads reach it` : 'outside both the cap and the smaller list: not shown'}.`);
    out.push(`4. **Project page**: ${rec.pageRead === 'cache' ? `read by an earlier audit run${rec.pageFetchedAt ? ` at ${rec.pageFetchedAt}` : ''}` : rec.pageRead === 'previous build' ? "taken from the site's last build (market.json)" : rec.pageRead === 'fetched' ? 'read from TDLR in this run' : rec.pageRead}${rec.address ? `; address "${rec.address}"` : '; no address yet'}.`);
    const city = rec.sources.filter((s) => s.kind === 'city');
    out.push(`5. **Merged city permits**: ${city.length ? city.map((s) => `${s.id} (${s.permits?.join(', ') || 'no number'}) ${s.url}`).join('; ') + ' merged into this record as qualifying new-building, shell or addition permits' : 'no qualifying building permit merged (no new-building, shell or addition permit of $50,000+ at this street address)'}.`);
    const support = rec.pointPermit && !rec.pointPermit.merged ? ` A supporting permit (${rec.pointPermit.permit}) at the same street address supplied the site coordinates only; it is not a project permit and was not merged.` : rec.pointPermit?.merged ? ` The point is the merged permit ${rec.pointPermit.permit}'s.` : '';
    out.push(`6. **Location**: ${rec.location}${rec.locatedBy ? ` (${rec.locatedBy})` : ''}${rec.lat != null ? ` at ${rec.lat.toFixed(6)}, ${rec.lng!.toFixed(6)}` : ''}${rec.noPointReason ? `; no point: ${rec.noPointReason}` : ''}.${support}`);
    out.push(`7. **Proposed list and map**: listed and searchable by name, id${city.length ? ', city permit numbers' : ''}${rec.address ? ' and address' : ''}; ${rec.lat != null ? `map-eligible (${rec.location === 'approximate' ? 'dashed approximate pin' : 'pin'}); whether it is drawn at a given zoom is the browser's display limit, not collection` : 'not on the map until a reliable point exists'}.`, '');
  }
  if (out.length === 4) out.push('Not returned by any market county read in this run.', '');
  return out;
}

const n = (v: number) => v.toLocaleString('en-US');

const span = (times: (string | undefined)[]) => {
  const t = times.filter((x): x is string => Boolean(x)).sort();
  if (!t.length) return 'time not recorded';
  const f = (x: string) => x.slice(0, 16).replace('T', ' ') + ' UTC';
  return t[0]!.slice(0, 16) === t.at(-1)!.slice(0, 16) ? f(t[0]!) : `${f(t[0]!)} to ${f(t.at(-1)!)}`;
};

/** Per county: fresh searches against cached ones, and when TDLR answered; then how each record got its page. */
export function provenance(a: MarketAudit): string[] {
  const lines = [
    '| County | Windows | Searched fresh this run | From an earlier run\'s cache | TDLR answered | Reported | Read | Complete |',
    '|---|---:|---:|---:|---|---:|---:|---|',
    ...a.reads.map((r) => {
      const fresh = r.windows.filter((w) => !w.cached && w.how !== 'budget').length;
      const cached = r.windows.filter((w) => w.cached).length;
      return `| ${r.county} | ${r.windows.length} | ${fresh} | ${cached} | ${span(r.windows.map((w) => w.fetchedAt))} | ${r.reported == null ? '?' : n(r.reported)} | ${n(r.rows.length)} | ${r.complete ? 'yes' : 'NO'} |`;
    }),
    '',
    ...(a.cityReads.length
      ? ['City records: ' + a.cityReads.map((c) => `${c.source} ${c.error ? `not read (${c.error})` : `${c.cached ? 'from an earlier run\'s cache' : 'read fresh this run'}, collected ${span([c.fetchedAt])}`}`).join('; ') + '.', '']
      : []),
    'How the records were assembled (project pages give the address; city records come whole from the city):',
    '',
    '| Page source | Records |',
    '|---|---:|'
  ];
  const tabs = a.records.filter((r) => r.pageRead !== 'n/a');
  const by = (k: AuditRecord['pageRead']) => tabs.filter((r) => r.pageRead === k);
  const cached = by('cache');
  lines.push(
    `| Read from TDLR in this run | ${n(by('fetched').length)} |`,
    `| Read by an earlier audit run (cache; ${span(cached.map((r) => r.pageFetchedAt))}) | ${n(cached.length)} |`,
    `| Taken from the site's last build (market.json) | ${n(by('previous build').length)} |`,
    `| Awaiting enrichment (page not read yet; listed by name, id and cost only) | ${n(by('not read').length + by('failed').length)} |`,
    `| City permit records (no TDLR page needed) | ${n(a.records.length - tabs.length)} |`,
    `| **Total records** | **${n(a.records.length)}** |`,
    ''
  );
  return lines;
}

export function marketReport(a: MarketAudit, ctx: { asOf: string; now: Date; traces?: string[] }): string {
  const loc = (c: LocationClass) => a.records.filter((r) => r.location === c).length;
  const tabs = a.records.filter((r) => r.sources.some((s) => s.kind === 'tabs'));
  const lines = [
    `# ${a.market}: development collection and location audit`,
    '',
    `Dry run ${ctx.asOf}. Counties: ${a.counties.join(', ') || 'none configured'}. Lookback ${LOOKBACK_DAYS} days. No cost cut (TABS registers from $50,000; city permits read from $${n(AUDIT_MIN_VALUE)}).`,
    '',
    '## Collection completeness',
    '',
    `**${a.complete ? 'Complete' : 'INCOMPLETE'}**: ${n(a.read)} TABS filings read of ${a.reported == null ? 'an unknown number' : n(a.reported)} reported.`,
    '',
    '| County | Reported | Read | Windows | Busy days read from both ends | Missing | Status |',
    '|---|---:|---:|---:|---:|---:|---|',
    ...a.reads.map((r) => `| ${r.county} | ${r.reported == null ? '?' : n(r.reported)} | ${n(r.rows.length)} | ${r.windows.length} | ${r.windows.filter((w) => w.how === 'both ends').length} | ${n(r.missing)} | ${r.error ? `not read: ${r.error}` : r.complete ? 'complete' : 'incomplete'} |`),
    ''
  ];
  const short = a.reads.flatMap((r) => r.windows.filter((w) => !w.whole).map((w) => `${r.county} ${w.window}: ${w.returned} of ${w.reported ?? '?'} (${w.how === 'budget' ? 'search budget or run time used up; resumes next run' : w.how === 'both ends' ? 'more than 200 filings in one day' : 'short'})`));
  if (short.length) lines.push('Incomplete windows:', '', ...short.slice(0, 30).map((s) => `- ${s}`), ...(short.length > 30 ? [`- and ${short.length - 30} more`] : []), '');
  lines.push(
    `City permits: ${a.cityReads.length ? a.cityReads.map((c) => `${c.source} ${c.error ? `not read (${c.error})` : `${c.permits < 0 ? 'cached' : `${n(c.permits)} permits`}, ${n(c.projects)} projects`}`).join('; ') : 'no city permit source for this market'}.`,
    '',
    `Project pages: ${n(a.pages.done)} of ${n(a.pages.needed)} eligible filings have their page${a.pages.waiting ? `; ${n(a.pages.waiting)} wait for a later run (resumes from cache)` : ''}. Geocodes: ${n(a.geocodes.tried)} addresses checked, ${n(a.geocodes.matched)} matched, ${n(a.geocodes.outsideMetro)} rejected outside the metro${a.geocodes.waiting ? `, ${n(a.geocodes.waiting)} waiting` : ''}.`,
    '',
    '## Where each answer came from',
    '',
    ...provenance(a),
    '## Exclusions by reason',
    '',
    '| Reason | Filings |',
    '|---|---:|',
    ...Object.entries(a.exclusions).sort((x, y) => y[1] - x[1]).map(([k, v]) => `| ${k} | ${n(v)} |`),
    `| **Eligible** | **${n(a.eligible)}** |`,
    '',
    '## Duplicates',
    ''
  );
  const kinds = ['same TABS id in two counties', 'city permit matched a TABS filing (merged)', 'possible duplicate (kept separate)'] as const;
  lines.push('| Kind | Count |', '|---|---:|', ...kinds.map((k) => `| ${k} | ${a.duplicates.filter((d) => d.kind === k).length} |`), '');
  const possible = a.duplicates.filter((d) => d.kind === 'possible duplicate (kept separate)');
  if (possible.length) lines.push('Possible duplicates (not merged; different filings may be separate buildings):', '', ...possible.slice(0, 20).map((d) => `- ${d.ids.join(', ')}: ${d.note}`), ...(possible.length > 20 ? [`- and ${possible.length - 20} more`] : []), '');
  lines.push(
    '## Locations',
    '',
    `${n(a.records.length)} developments (${n(tabs.length)} with a TABS filing, ${n(a.records.length - tabs.length)} city permits only).`,
    '',
    '| Location | Projects |',
    '|---|---:|',
    `| Exact: the permit's own point | ${n(loc('exact-permit'))} |`,
    `| Exact: geocoded filed address | ${n(loc('exact-geocode'))} |`,
    `| Site: borrowed from another permit at the same address (labelled) | ${n(loc('site'))} |`,
    `| Approximate: ZIP center | ${n(loc('approximate'))} |`,
    `| No coordinates (listed and searchable, not on the map) | ${n(loc('none'))} |`,
    ''
  );
  if (a.rejectedPoints.length) lines.push(`Points rejected as outside the metro: ${a.rejectedPoints.length}.`, '');
  const none = a.records.filter((r) => r.location === 'none');
  const reasons = new Map<string, number>();
  for (const r of none) reasons.set(r.noPointReason ?? 'unknown', (reasons.get(r.noPointReason ?? 'unknown') ?? 0) + 1);
  if (none.length) {
    lines.push('### Projects without coordinates', '', '| Reason | Projects |', '|---|---:|', ...[...reasons].sort((x, y) => y[1] - x[1]).map(([k, v]) => `| ${k} | ${n(v)} |`), '');
    lines.push('Biggest 25:', '', '| Id | Name | Cost | Address | Why |', '|---|---|---:|---|---|', ...none.slice().sort((x, y) => y.cost - x.cost).slice(0, 25).map((r) => `| ${r.key} | ${r.name.replace(/\|/g, '/')} | $${n(r.cost)} | ${(r.address ?? '').replace(/\|/g, '/')} | ${r.noPointReason ?? ''} |`), '');
  }
  const cur = (c: AuditRecord['current']) => tabs.filter((r) => r.current === c).length;
  lines.push(
    '## Collection vs. display',
    '',
    `Today's build pins at most ${capFor(a.market)} TABS projects here and lists up to ${MAX_SMALLER} more without guaranteed pins. Of the ${n(tabs.length)} eligible TABS filings: ${n(cur('map'))} fall inside the cap, ${n(cur('smaller list'))} in the smaller list, ${n(cur('not shown'))} are not shown at all.`,
    '',
    `Proposed: all ${n(a.records.length)} listed and searchable; ${n(a.records.length - none.length)} map-eligible. How many pins the browser draws at once is a display setting, applied after collection.`,
    ''
  );
  for (const id of ctx.traces ?? []) {
    if (a.records.some((r) => r.sources.some((s) => s.id === id)) || a.reads.some((r) => r.rows.some((x) => x.ProjectNumber === id))) lines.push('## Trace', '', ...traceLines(id, [a], ctx.now));
  }
  return lines.join('\n');
}

export function summaryReport(audits: MarketAudit[], ctx: { asOf: string; budget: AuditBudget; minutes: number; markets: readonly City[] }): string {
  const rows = ctx.markets.map((m) => {
    const a = audits.find((x) => x.market === m);
    if (!a) return `| ${m} | no TABS counties configured | | | | | | |`;
    const c = (k: LocationClass) => a.records.filter((r) => r.location === k).length;
    return `| ${m} | ${a.complete ? 'complete' : 'INCOMPLETE'} (${n(a.read)} of ${a.reported == null ? '?' : n(a.reported)}) | ${n(a.eligible)} | ${n(a.records.length)} | ${n(c('exact-permit') + c('exact-geocode'))} | ${n(c('site'))} | ${n(c('approximate'))} | ${n(c('none'))} |`;
  });
  return [
    '# Development collection and location audit: summary',
    '',
    `Dry run ${ctx.asOf}: public reads only, local files only, no production data changed.`,
    '',
    '| Market | TABS collection | Eligible filings | Developments (with city permits) | Exact | Site | Approximate | No coordinates |',
    '|---|---|---:|---:|---:|---:|---:|---:|',
    ...rows,
    '',
    `Run: ${ctx.minutes.toFixed(1)} minutes; ${n(ctx.budget.used.searches)} TABS searches, ${n(ctx.budget.used.pages)} project pages, ${n(ctx.budget.used.geocodes)} geocodes, ${n(ctx.budget.used.cityReads)} city reads, ${n(ctx.budget.used.cached)} answers from cache. Service cost: $0 (TDLR, Census and city open data are free with no key).`,
    ''
  ].join('\n');
}

/** The audit's records in the website's development shape, for a preview build of the map. */
export function toDevelopments(a: MarketAudit): Development[] {
  return a.records.map((r) => {
    const tabs = r.sources.find((x) => x.kind === 'tabs');
    const permits = r.sources.filter((x) => x.kind === 'city').flatMap((x) => x.permits ?? []);
    const link = developerLink(r.owner ?? null, r.name, r.market);
    return {
      id: r.key,
      city: r.market,
      place: r.place ?? placeOf(r.address),
      name: r.name,
      facility: r.facility ?? null,
      status: r.status,
      work: r.work,
      cost: r.cost,
      registered: r.registered,
      start: r.start ?? null,
      end: r.end ?? null,
      address: r.address,
      owner: r.owner ?? null,
      tenant: r.tenant ?? null,
      designFirm: r.designFirm ?? null,
      scope: r.scope ?? null,
      squareFeet: r.squareFeet ?? null,
      isPublic: r.isPublic ?? false,
      lat: r.lat,
      lng: r.lng,
      approximate: r.location === 'approximate',
      ...(r.location === 'site' && r.pointPermit ? { locatedFrom: `City permit ${r.pointPermit.permit} at this address` } : {}),
      developerUrl: link.url,
      developerDirect: link.direct,
      url: (tabs ?? r.sources[0]!).url,
      source: tabs ? 'tabs' : 'city',
      ...(r.contractor ? { contractor: r.contractor } : {}),
      ...(permits.length ? { aliases: [...new Set(permits)] } : {})
    } satisfies Development;
  });
}

export const AUDIT_MARKETS: readonly City[] = CITIES;
