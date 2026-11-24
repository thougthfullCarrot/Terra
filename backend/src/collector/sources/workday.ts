import type { RawJob } from '../../types.js';
import { HttpError, fetchJson, type FetchJsonOptions } from '../../lib/http.js';
import { stripHtml } from '../../lib/html.js';
import { classifyKind } from '../seniority.js';
import { resolveCity } from '../texas.js';
import { IncompleteBoardError } from './incomplete.js';

/**
 * Workday (CXS) fetcher.
 *
 * Unlike Greenhouse and Lever there is no shared board host: every tenant
 * serves its own, so a firm row needs both `ats_host` and `ats_slug`:
 *
 *   ats_host = 'cbre.wd1.myworkdayjobs.com'
 *   ats_slug = '<tenant>/<site>'            e.g. 'cbre/CBRE_Careers'
 *
 * The endpoints are Workday's public career-site JSON API. They are not a
 * documented product surface and do change; if a tenant starts returning
 * something unexpected, open its careers page with devtools on the network tab
 * and look for the /wday/cxs/ request — that is the contract this file follows.
 *
 * UNVERIFIED AGAINST A LIVE TENANT. Everything here is tested against fixtures
 * only, and there is reason for caution: probing tenant roots from a server
 * (see src/bin/probe-slugs.ts) returned 406 Not Acceptable uniformly — for
 * hostnames that exist and hostnames invented on the spot, with and without a
 * well-formed Accept header. That is an edge block on non-browser clients, not
 * a missing tenant.
 *
 * Whether it also applies to the /wday/cxs/ JSON endpoints is unknown. Those
 * are a different request shape — a POST with a JSON body and content type,
 * which is what the career site's own page makes — so they may well be served.
 * Establish that against one real tenant before building more on this file.
 */

const PAGE_SIZE = 20;

/** The list fields that identify a posting's content; postedOn is left out (it ages daily). */
export function listFingerprint(listing: Pick<WorkdayListing, 'title' | 'locationsText' | 'bulletFields'>): string {
  return [listing.title?.trim() ?? '', listing.locationsText?.trim() ?? '', ...(listing.bulletFields ?? []).map((f) => f.trim())].join('\u0001');
}

/**
 * Posting details read on an earlier build, keyed by tenant + posting path.
 * Workday gives no ETag or modified time on the CXS API, and its list carries
 * only a relative "Posted N days ago", so the validator is the posting path
 * (which ends in the requisition id) plus an age cap: a detail is reused for
 * DETAIL_MAX_AGE_HOURS, then read again. A posting no longer on the list is
 * never read, cached or not, so closures work exactly as before.
 */
export interface DetailCacheEntry {
  job: Omit<RawJob, 'postedAt'> & { postedAt?: string };
  /** ISO time the detail was read from Workday. */
  at: string;
  /**
   * What the list said about the posting when the detail was read (title,
   * location text, bullet fields). The list is read in full every build, so a
   * retitled or relocated posting at the same path no longer matches and its
   * detail is read again. Entries from before this field never match.
   */
  list?: string;
}
export type DetailCache = Map<string, DetailCacheEntry>;

export const DETAIL_MAX_AGE_HOURS = Number(process.env.WORKDAY_DETAIL_MAX_AGE_HOURS ?? 72);

let sharedCache: DetailCache | null = null;
/** Set once per process by export-site --detail-cache; null turns reuse off. */
export function useDetailCache(cache: DetailCache | null): void {
  sharedCache = cache;
}

export function detailKey(tenant: WorkdayTenant, externalPath: string): string {
  return `${tenant.host}/${tenant.tenant}/${tenant.site}${externalPath}`;
}
/**
 * Workday's `total` field stops at 2,000: Cushman & Wakefield reports exactly
 * 2,000 yet keeps serving postings past offset 2,000, and its country facet
 * counts add up to 2,169 (facet pilot, 2026-11-24). A total under this value is
 * the board's real size; a total at it only says "at least 2,000".
 */
export const WORKDAY_TOTAL_CAP = 2000;

/**
 * Runaway guard, not a completeness rule: a list ends on a short page. 250
 * pages is 5,000 postings, well past the largest board seen (about 2,200).
 * Reaching it marks the board as read in part.
 */
const MAX_PAGES = 250;

/** How a board's list read ended; only 'end' and 'total' mean read in full. */
export type ListEnd = 'end' | 'total' | 'failed' | 'repeated' | 'page-cap' | 'short';

/**
 * How many postings the board listed, and how many survived the cheap filters.
 *
 * Without this a run of zero is ambiguous in a way that matters: a tenant with
 * nothing posted and a tenant whose every posting was filtered out look
 * identical, and only the first means the fetcher is working.
 */
export interface WorkdayStats {
  /**
   * What the board says it holds. On an enterprise tenant this is far more
   * than a capped run lists, and a count over 40 of 3,000 postings is not a
   * count of the board.
   */
  total?: number;
  listed: number;
  considered: number;
  fetched: number;
  /** Details taken from the cache instead of read again. */
  reused?: number;
  /** Postings a later page repeated from an earlier one (dropped). */
  duplicates?: number;
  /** How the list read ended. */
  listEnd?: ListEnd;
  /** 'facet' when only the Texas + US-remote location facets were listed. */
  listMode?: 'nationwide' | 'facet';
  /** List requests made (pages, all facet lists included). */
  listRequests?: number;
  /**
   * A few titles the board listed, kept for diagnosis. 0 of 63 postings
   * surviving the filters is either correct or a silently over-aggressive
   * filter, and the titles are the only way to tell which.
   */
  sample?: string[];
}

export interface WorkdayTenant {
  host: string;
  tenant: string;
  site: string;
}

export interface WorkdayListing {
  title?: string;
  externalPath?: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}

interface WorkdayListResponse {
  total?: number;
  jobPostings?: WorkdayListing[];
  facets?: unknown[];
}

interface WorkdayDetailResponse {
  jobPostingInfo?: {
    title?: string;
    jobDescription?: string;
    location?: string;
    additionalLocations?: string[];
    externalUrl?: string;
    startDate?: string;
    postedOn?: string;
    timeType?: string;
    jobRequisitionId?: string;
  };
}

/**
 * Split 'cbre.wd1.myworkdayjobs.com' + 'cbre/CBRE_Careers' into its parts.
 * Throws rather than guessing: a half-configured tenant should fail loudly on
 * the firm row, not silently return nothing.
 */
export function parseTenant(host: string | null | undefined, slug: string): WorkdayTenant {
  if (!host) throw new Error(`Workday firm is missing ats_host (slug: ${slug})`);

  const [tenant, site] = slug.split('/');
  if (!tenant || !site) {
    throw new Error(`Workday ats_slug must be '<tenant>/<site>', got '${slug}'`);
  }

  return { host: host.replace(/^https?:\/\//, '').replace(/\/+$/, ''), tenant, site };
}

export function listUrl({ host, tenant, site }: WorkdayTenant): string {
  return `https://${host}/wday/cxs/${tenant}/${site}/jobs`;
}

export function detailUrl({ host, tenant, site }: WorkdayTenant, externalPath: string): string {
  return `https://${host}/wday/cxs/${tenant}/${site}${externalPath}`;
}

/** Public, human-facing posting URL — what `apply_url` should point at. */
export function applyUrl({ host, site }: WorkdayTenant, externalPath: string): string {
  return `https://${host}/en-US/${site}${externalPath}`;
}

/**
 * Fetch one Workday tenant.
 *
 * The list endpoint gives title, location text, and a path — no description.
 * Fetching the detail for every listing would mean hundreds of requests per
 * firm per run, so the cheap filters run first against what the list does
 * carry, and only survivors cost a second request. On a large enterprise board
 * that is the difference between ~600 requests and ~15.
 */
export async function fetchWorkday(
  firm: string,
  host: string | null | undefined,
  slug: string,
  options: FetchJsonOptions & { maxPages?: number; stats?: WorkdayStats; cache?: DetailCache | null; now?: Date; facets?: boolean } = {}
): Promise<RawJob[]> {
  const cache = options.cache === undefined ? sharedCache : options.cache;
  const now = options.now ?? new Date();
  let reused = 0;
  const tenant = parseTenant(host, slug);
  const maxPages = options.maxPages ?? MAX_PAGES;

  let listings: WorkdayListing[];
  let total: number | undefined;
  /** Why the list was not read to its end, if it was not. */
  let gap: string | undefined;
  let listEnd: ListEnd;
  let duplicates = 0;
  let listRequests = 0;
  let listMode: 'nationwide' | 'facet' = 'nationwide';

  const first = await fetchPage(tenant, 0, options, {});
  listRequests++;
  const filters = options.facets ? texasFacetFilters(first.facets) : [];
  if (filters.length) {
    // Validated board: list only the Texas and US-remote facet values. Each
    // filter is its own list (Workday ANDs facet parameters), merged by path.
    listMode = 'facet';
    const seen = new Set<string>();
    listings = [];
    const ends: string[] = [];
    for (const filter of filters) {
      const read = await listAll(tenant, options, maxPages, filter.applied);
      listRequests += read.requests;
      duplicates += read.duplicates;
      for (const l of read.listings) {
        if (seen.has(l.externalPath!)) continue;
        seen.add(l.externalPath!);
        listings.push(l);
      }
      if (read.gap) ends.push(`${filter.label}: ${read.gap}`);
      if (read.end !== 'end' && read.end !== 'total') listEnd = read.end;
    }
    listEnd ??= 'end';
    if (ends.length) gap = ends.join('; ');
    total = first.total;
  } else {
    const read = await listAll(tenant, options, maxPages, {}, first);
    listRequests += read.requests;
    ({ listings, total, duplicates } = read);
    listEnd = read.end;
    gap = read.gap;
  }

  const candidates = listings.filter(worthFetching);

  if (options.stats) {
    options.stats.total = total;
    options.stats.listed = listings.length;
    options.stats.considered = candidates.length;
    options.stats.duplicates = duplicates;
    options.stats.listEnd = listEnd;
    options.stats.listMode = listMode;
    options.stats.listRequests = listRequests;
    options.stats.sample = listings
      .slice(0, 6)
      .map((listing) => `${listing.title ?? '?'} — ${listing.locationsText ?? '?'}`);
  }

  const jobs: RawJob[] = [];
  let detailFailures = 0;
  const toRead: WorkdayListing[] = [];
  for (const listing of candidates) {
    const key = detailKey(tenant, listing.externalPath as string);
    const hit = cache?.get(key);
    const fresh = hit && now.getTime() - new Date(hit.at).getTime() < DETAIL_MAX_AGE_HOURS * 3_600_000;
    if (hit && fresh && hit.list === listFingerprint(listing)) {
      reused++;
      // Keep the real read time: the listing is verified this build, the text is not.
      jobs.push({ ...hit.job, firm, postedAt: hit.job.postedAt ? new Date(hit.job.postedAt) : undefined, detailReadAt: hit.at } as RawJob);
    } else {
      toRead.push(listing);
    }
  }
  // Three at a time: this is one tenant's server and we are a guest on it.
  for (let i = 0; i < toRead.length; i += 3) {
    const batch = toRead.slice(i, i + 3);
    const details = await Promise.all(batch.map((listing) => fetchDetail(firm, tenant, listing, options)));
    details.forEach((detail, n) => {
      const key = detailKey(tenant, batch[n]!.externalPath as string);
      if (detail && detail !== 'failed') cache?.set(key, { job: { ...detail, postedAt: detail.postedAt?.toISOString() }, at: now.toISOString(), list: listFingerprint(batch[n]!) });
      // Closed between list and detail: never reuse it.
      if (detail === null) cache?.delete(key);
    });
    for (const detail of details) {
      if (detail === 'failed') detailFailures++;
      else if (detail) jobs.push(detail);
    }
  }

  if (options.stats) {
    options.stats.fetched = jobs.length;
    options.stats.reused = reused;
  }

  if (detailFailures) gap = [gap, `${detailFailures} of ${candidates.length} posting details failed`].filter(Boolean).join('; ');
  if (gap) throw new IncompleteBoardError(`Workday ${tenant.tenant}/${tenant.site}: ${gap}`, jobs);
  return jobs;
}

/**
 * Is this listing worth a detail request?
 *
 * Two signals, both from the list payload. The title filter is the same one the
 * normalizer will apply later, so nothing is lost by applying it early. The
 * location filter only fires when `locationsText` names a real place —
 * Workday collapses multi-site postings to '5 Locations', and those have to be
 * opened to be judged.
 */
export function worthFetching(listing: WorkdayListing): boolean {
  const title = listing.title?.trim();
  if (!title || !listing.externalPath) return false;

  if (!classifyKind(title)) return false;

  const locations = listing.locationsText?.trim();
  if (locations && !/\d+\s+locations/i.test(locations) && !resolveCity(locations)) {
    return false;
  }

  return true;
}

async function fetchPage(
  tenant: WorkdayTenant,
  offset: number,
  options: FetchJsonOptions,
  appliedFacets: Record<string, string[]> = {}
): Promise<ListPage> {
  const response = await fetchJson<WorkdayListResponse>(listUrl(tenant), {
    ...options,
    method: 'POST',
    // Some tenants (Huntington) answer 500 unless the request looks like it
    // came from their own careers page.
    headers: {
      'accept-language': 'en-US',
      origin: `https://${tenant.host}`,
      referer: `https://${tenant.host}/${tenant.site}`,
      ...options.headers
    },
    body: { appliedFacets, limit: PAGE_SIZE, offset, searchText: '' }
  });

  // A list page without a jobPostings array is a failed read, not an empty
  // board (an empty board closes every job it listed).
  if (!response || typeof response !== 'object' || !Array.isArray(response.jobPostings)) {
    throw new Error(`Workday ${tenant.tenant}/${tenant.site} sent a malformed list page at offset ${offset}`);
  }
  return {
    jobPostings: response.jobPostings,
    total: typeof response?.total === 'number' ? response.total : undefined,
    facets: Array.isArray(response.facets) ? response.facets : undefined
  };
}

interface ListPage {
  jobPostings: WorkdayListing[];
  total: number | undefined;
  facets?: unknown[];
}

export interface ListRead {
  listings: WorkdayListing[];
  total?: number;
  requests: number;
  duplicates: number;
  end: ListEnd;
  gap?: string;
}

/**
 * Read one list (nationwide, or one facet filter) to its end.
 *
 * Complete when a page comes back short (fewer than 20), or when a total under
 * Workday's 2,000 ceiling has been reached. A total at the ceiling is never
 * trusted as the end. Safeguards, each of which marks the read as partial:
 * a failed page after the first, a page that only repeats postings already
 * listed (Workday wrapping or ignoring the offset), the page cap, and a
 * finished read that lists noticeably fewer postings than a real total.
 */
export async function listAll(
  tenant: WorkdayTenant,
  options: FetchJsonOptions,
  maxPages: number,
  appliedFacets: Record<string, string[]>,
  first?: ListPage
): Promise<ListRead> {
  const listings: WorkdayListing[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  let requests = 0;
  let duplicates = 0;
  for (let page = 0; page < maxPages; page++) {
    let batch: ListPage;
    if (page === 0 && first) batch = first;
    else {
      try {
        requests++;
        batch = await fetchPage(tenant, page * PAGE_SIZE, options, appliedFacets);
      } catch (error) {
        // Some tenants answer the first pages and then fail deep in the list
        // (Huntington's 500s past a few hundred postings); keep what was read,
        // and say the board was not read in full.
        if (page === 0) throw error;
        return { listings, total, requests, duplicates, end: 'failed', gap: `page ${page + 1} failed (${error instanceof Error ? error.message : String(error)})` };
      }
    }
    // Workday reports the total on the first page only; later pages carry 0.
    if (page === 0) total = batch.total;
    const fresh = batch.jobPostings.filter((l) => !l.externalPath || !seen.has(l.externalPath));
    duplicates += batch.jobPostings.length - fresh.length;
    if (batch.jobPostings.length > 0 && fresh.length === 0) {
      return { listings, total, requests, duplicates, end: 'repeated', gap: `page ${page + 1} only repeated postings already listed` };
    }
    for (const l of fresh) {
      if (l.externalPath) seen.add(l.externalPath);
      listings.push(l);
    }
    if (batch.jobPostings.length < PAGE_SIZE) return finish('end');
    if (total && total < WORKDAY_TOTAL_CAP && listings.length >= total) return finish('total');
  }
  return { listings, total, requests, duplicates, end: 'page-cap', gap: `stopped at the ${maxPages}-page cap with ${listings.length} listed` };

  function finish(end: 'end' | 'total'): ListRead {
    // A real total the read fell well short of: postings went missing mid-read.
    if (total && total < WORKDAY_TOTAL_CAP && listings.length < Math.floor(total * 0.98) - 1) {
      return { listings, total, requests, duplicates, end: 'short', gap: `board reports ${total}, listed ${listings.length}` };
    }
    return { listings, total, requests, duplicates, end };
  }
}

export interface FacetFilter {
  label: string;
  applied: Record<string, string[]>;
  count: number;
}

interface FacetValue {
  parameter: string;
  descriptor: string;
  id: string;
  count: number;
}

/** Facet values come flat ({descriptor,id,count}) or nested under groups; collect them all. */
export function facetValues(facets: unknown[] | undefined, parent = ''): FacetValue[] {
  const out: FacetValue[] = [];
  for (const raw of facets ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as { facetParameter?: string; descriptor?: string; id?: string; count?: number; values?: unknown[] };
    const parameter = f.facetParameter ?? parent;
    if (Array.isArray(f.values)) out.push(...facetValues(f.values, parameter));
    else if (f.id && f.descriptor) out.push({ parameter, descriptor: f.descriptor, id: f.id, count: f.count ?? 0 });
  }
  return out;
}

const US_REMOTE = /^(remote|virtual|work from home)\b.*\b(us|usa|u\.s\.|united states|nationwide)\b|^(remote|virtual)$|\b(us|usa|united states)\b.*\b(remote|virtual)\b/i;

/**
 * The filters a Texas-only list needs, from page 0's facets.
 *
 * Texas: the state/region value for Texas when the board has one, else every
 * location value that resolves to a Texas city (Greystar has no state facet).
 * US remote: location values like "Remote, United States" or "Virtual" are a
 * separate list, since a remote posting carries no Texas value. Multi-location
 * postings carry a value for each of their locations, so the Texas value finds
 * them (C&W: 22 multi-location postings in its Texas list).
 */
export function texasFacetFilters(facets: unknown[] | undefined): FacetFilter[] {
  const values = facetValues(facets).filter((v) => /location|state|region|city|site/i.test(v.parameter) && !/country/i.test(v.parameter));
  const state = values.filter((v) => /state|region/i.test(v.parameter) && /^(texas|tx)$|\btexas\b|^us\s*-\s*tx$/i.test(v.descriptor.trim()));
  const cities = values.filter((v) => !/state|region/i.test(v.parameter) && !/remote|virtual/i.test(v.descriptor) && isTexasPlace(v.descriptor));
  const texas = state.length ? state : cities;
  if (!texas.length) return [];
  const group = (vs: FacetValue[]) => {
    const applied: Record<string, string[]> = {};
    for (const v of vs) (applied[v.parameter] ??= []).push(v.id);
    return applied;
  };
  const out: FacetFilter[] = [{ label: 'Texas', applied: group(texas), count: texas.reduce((n, v) => n + v.count, 0) }];
  const remote = values.filter((v) => US_REMOTE.test(v.descriptor.trim()));
  if (remote.length) out.push({ label: 'US remote', applied: group(remote), count: remote.reduce((n, v) => n + v.count, 0) });
  return out;
}

/** A facet value naming a Texas place: "Dallas, TX", "Texas - Houston", or a known Texas city alone. */
export function isTexasPlace(text: string): boolean {
  if (/\btexas\b|,\s*tx\b|\btx\s*-|\bus\s*-\s*tx\b/i.test(text)) return true;
  if (/,\s*(?!tx\b)[A-Z]{2}\b|\b(thailand|india|china|mexico|canada|uk|united kingdom|philippines|bangkok)\b/i.test(text)) return false;
  return Boolean(resolveCity(text));
}

async function fetchDetail(
  firm: string,
  tenant: WorkdayTenant,
  listing: WorkdayListing,
  options: FetchJsonOptions
): Promise<RawJob | null | 'failed'> {
  const path = listing.externalPath as string;

  let detail: WorkdayDetailResponse;
  try {
    detail = await fetchJson<WorkdayDetailResponse>(detailUrl(tenant, path), options);
  } catch (error) {
    // 404/410: the posting came down between the list and the detail read,
    // which is a closed job. Anything else is a failed read: one posting
    // failing is not the firm failing, but the board was then not read in
    // full, and the caller says so rather than calling the job closed.
    if (error instanceof HttpError && (error.status === 404 || error.status === 410)) return null;
    return 'failed';
  }

  const info = detail?.jobPostingInfo;
  if (!info) return null;

  const title = (info.title ?? listing.title ?? '').trim();
  if (!title) return null;

  return {
    title,
    firm,
    location: locations(info, listing),
    description: stripHtml(info.jobDescription ?? ''),
    applyUrl: info.externalUrl?.trim() || applyUrl(tenant, path),
    postedAt: parsePostedOn(info.postedOn ?? listing.postedOn),
    // Workday has no seniority field on the public API; `timeType` at least
    // separates an intern-shaped posting from a career hire on some tenants.
    level: info.timeType?.trim(),
    ats: 'workday',
    sourceId: info.jobRequisitionId?.trim() || requisitionFromPath(path)
  };
}

/** '/job/Dallas-TX/Analyst_R12345' and '/job/Dallas/Analyst_R12345-1' end in the requisition id. */
export function requisitionFromPath(path: string): string | undefined {
  return /_([A-Za-z0-9-]+)$/.exec(path)?.[1] ?? undefined;
}

function locations(
  info: NonNullable<WorkdayDetailResponse['jobPostingInfo']>,
  listing: WorkdayListing
): string {
  const all = [info.location, ...(info.additionalLocations ?? [])]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

  return all.length ? all.join('; ') : (listing.locationsText?.trim() ?? '');
}

/**
 * Workday reports age as prose: 'Posted Today', 'Posted Yesterday',
 * 'Posted 3 Days Ago', 'Posted 30+ Days Ago'. Returns undefined when it cannot
 * be read, which lets the normalizer fall back to the run time rather than
 * inventing a date.
 */
export function parsePostedOn(value: string | undefined, now = new Date()): Date | undefined {
  if (!value) return undefined;
  const text = value.toLowerCase();

  if (/\btoday\b/.test(text)) return now;
  if (/\byesterday\b/.test(text)) return daysAgo(now, 1);

  const days = /posted\s+(\d+)\+?\s*days?\s+ago/.exec(text);
  if (days) return daysAgo(now, Number(days[1]));

  const months = /posted\s+(\d+)\+?\s*months?\s+ago/.exec(text);
  if (months) return daysAgo(now, Number(months[1]) * 30);

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}
