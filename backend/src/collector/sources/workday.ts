import type { RawJob } from '../../types.js';
import { fetchJson, type FetchJsonOptions } from '../../lib/http.js';
import { stripHtml } from '../../lib/html.js';
import { classifyKind } from '../seniority.js';
import { resolveCity } from '../texas.js';

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
/** Stop after this many pages per firm. 25 x 20 is far more than any CRE board carries. */
const MAX_PAGES = 25;

export interface WorkdayTenant {
  host: string;
  tenant: string;
  site: string;
}

interface WorkdayListing {
  title?: string;
  externalPath?: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}

interface WorkdayListResponse {
  total?: number;
  jobPostings?: WorkdayListing[];
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
  options: FetchJsonOptions & { maxPages?: number } = {}
): Promise<RawJob[]> {
  const tenant = parseTenant(host, slug);
  const maxPages = options.maxPages ?? MAX_PAGES;

  const listings: WorkdayListing[] = [];
  for (let page = 0; page < maxPages; page++) {
    const batch = await fetchPage(tenant, page * PAGE_SIZE, options);
    listings.push(...batch.jobPostings);
    if (batch.jobPostings.length < PAGE_SIZE) break;
    if (batch.total && listings.length >= batch.total) break;
  }

  const candidates = listings.filter(worthFetching);

  const jobs: RawJob[] = [];
  // Three at a time: this is one tenant's server and we are a guest on it.
  for (let i = 0; i < candidates.length; i += 3) {
    const details = await Promise.all(
      candidates.slice(i, i + 3).map((listing) => fetchDetail(firm, tenant, listing, options))
    );
    jobs.push(...details.filter((job): job is RawJob => job !== null));
  }

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
  options: FetchJsonOptions
): Promise<{ jobPostings: WorkdayListing[]; total: number | undefined }> {
  const response = await fetchJson<WorkdayListResponse>(listUrl(tenant), {
    ...options,
    method: 'POST',
    body: { appliedFacets: {}, limit: PAGE_SIZE, offset, searchText: '' }
  });

  return {
    jobPostings: Array.isArray(response?.jobPostings) ? response.jobPostings : [],
    total: typeof response?.total === 'number' ? response.total : undefined
  };
}

async function fetchDetail(
  firm: string,
  tenant: WorkdayTenant,
  listing: WorkdayListing,
  options: FetchJsonOptions
): Promise<RawJob | null> {
  const path = listing.externalPath as string;

  let detail: WorkdayDetailResponse;
  try {
    detail = await fetchJson<WorkdayDetailResponse>(detailUrl(tenant, path), options);
  } catch {
    // One posting failing is not the firm failing. Drop it and keep going —
    // the run report still counts what the board returned.
    return null;
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
    ats: 'workday'
  };
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
