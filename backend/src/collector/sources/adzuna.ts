import type { RawJob } from '../../types.js';
import { fetchJson, type FetchJsonOptions } from '../../lib/http.js';
import { stripHtml } from '../../lib/html.js';
import type { Aggregator } from '../run.js';

/**
 * Adzuna is a job aggregator: it reads many job sites, LinkedIn-syndicated
 * listings among them, and exposes the result through a keyed search API.
 *
 * Unlike the ATS sources this is not one firm's board. It answers a search, so
 * it returns postings from firms Terra has never heard of, and from firms that
 * have nothing to do with real estate. `isRealEstate()` is the gate for the
 * second problem; the collector's dedupe against board postings handles overlap
 * with firms Terra already reads directly.
 *
 * Credentials come from ADZUNA_APP_ID / ADZUNA_APP_KEY. Without them the source
 * is simply off, so the site build works the same as before for anyone who has
 * not set up a key.
 */

const BASE = 'https://api.adzuna.com/v1/api/jobs/us/search';

/** Adzuna's maximum page size. */
export const PAGE_SIZE = 50;

/**
 * Searches run on each pass. Each is one or more paged requests.
 *
 * Kept deliberately few: the site rebuilds every two hours, which is twelve
 * passes a day, and Adzuna's free tier allows only a few hundred calls a day
 * and a few thousand a month. `maxRequests` caps the whole pass.
 */
export const DEFAULT_QUERIES: AdzunaQuery[] = [
  { what_phrase: 'commercial real estate' },
  { what: 'real estate', what_or: 'intern internship analyst associate trainee coordinator' },
  { what_or: 'acquisitions underwriting appraiser leasing asset', what_and: 'real estate' },
  { what_or: 'LIHTC affordable housing tax credit' , what_and: 'housing' }
];

export interface AdzunaQuery {
  what?: string;
  what_and?: string;
  what_or?: string;
  what_phrase?: string;
}

export interface AdzunaCredentials {
  appId: string;
  appKey: string;
}

export interface AdzunaOptions extends FetchJsonOptions {
  queries?: AdzunaQuery[];
  /** Hard cap on API calls per pass, across every query and page. */
  maxRequests?: number;
  /** Pages per query; the first short page ends a query early. */
  maxPages?: number;
  /** Ignore listings older than this. */
  maxDaysOld?: number;
}

interface AdzunaJob {
  id?: string | number;
  title?: string;
  description?: string;
  created?: string;
  redirect_url?: string;
  company?: { display_name?: string };
  location?: { display_name?: string; area?: string[] };
}

interface AdzunaResponse {
  results?: AdzunaJob[];
  count?: number;
}

/** Read credentials from the environment, or null when the source is not set up. */
export function adzunaCredentials(env: NodeJS.ProcessEnv = process.env): AdzunaCredentials | null {
  const appId = env.ADZUNA_APP_ID?.trim();
  const appKey = env.ADZUNA_APP_KEY?.trim();
  return appId && appKey ? { appId, appKey } : null;
}

export function adzunaUrl(
  credentials: AdzunaCredentials,
  query: AdzunaQuery,
  page: number,
  maxDaysOld: number
): string {
  const params = new URLSearchParams({
    app_id: credentials.appId,
    app_key: credentials.appKey,
    results_per_page: String(PAGE_SIZE),
    where: 'Texas',
    max_days_old: String(maxDaysOld),
    sort_by: 'date',
    'content-type': 'application/json'
  });
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  return `${BASE}/${page}?${params}`;
}

/** Run every query, page by page, within the request budget. */
export async function fetchAdzuna(
  credentials: AdzunaCredentials,
  options: AdzunaOptions = {}
): Promise<RawJob[]> {
  const { queries = DEFAULT_QUERIES, maxRequests = 8, maxPages = 2, maxDaysOld = 30, ...http } = options;

  const seen = new Set<string>();
  const jobs: RawJob[] = [];
  let requests = 0;

  for (const query of queries) {
    for (let page = 1; page <= maxPages; page++) {
      if (requests >= maxRequests) return jobs;
      requests++;

      const payload = await fetchJson<AdzunaResponse>(
        adzunaUrl(credentials, query, page, maxDaysOld),
        http
      );

      for (const job of parseAdzuna(payload)) {
        // Queries overlap; the apply link identifies the listing.
        if (seen.has(job.applyUrl)) continue;
        seen.add(job.applyUrl);
        jobs.push(job);
      }

      if ((payload?.results?.length ?? 0) < PAGE_SIZE) break;
    }
  }

  return jobs;
}

export function parseAdzuna(payload: AdzunaResponse): RawJob[] {
  const results = Array.isArray(payload?.results) ? payload.results : [];

  return results.flatMap((job) => {
    // Adzuna wraps search hits in <strong> inside titles and snippets.
    const title = stripHtml(job.title ?? '').trim();
    const firm = stripHtml(job.company?.display_name ?? '').trim();
    const applyUrl = job.redirect_url?.trim();
    if (!title || !firm || !applyUrl) return [];

    const description = stripHtml(job.description ?? '');
    if (!isRealEstate(title, description)) return [];

    return [
      {
        title,
        firm,
        location: location(job),
        description,
        applyUrl,
        postedAt: date(job.created),
        ats: 'aggregator'
      } satisfies RawJob
    ];
  });
}

/**
 * A search for 'real estate' also finds mortgage call centres, insurance
 * agents, and 'real estate' as a word in a hospital's benefits blurb. The ATS
 * sources never needed this, because every board belongs to a CRE firm.
 *
 * Only strong signals count here. 'Leasing' and 'acquisitions' alone also mean
 * car leases and talent acquisition.
 */
const REAL_ESTATE =
  /\b(real estate|cre|reits?|multifamily|commercial property|property management|property manager|apprais(?:er|al)|home ?build(?:er|ers|ing)|affordable housing|lihtc|housing tax credit|housing authority|public housing)\b/i;

/** Residential sales jobs share the vocabulary but are not what Terra covers. */
const RESIDENTIAL =
  /\b(realtor|real estate (?:sales )?agent|real estate salesperson|home ?buyers?|loan officer|mortgage)\b/i;

export function isRealEstate(title: string, description: string): boolean {
  if (RESIDENTIAL.test(title)) return false;
  return REAL_ESTATE.test(`${title}\n${description}`);
}

/**
 * Adzuna's display name drops the state ('Dallas, Dallas County'), which the
 * Texas filter needs. `area` carries it: ['US', 'Texas', 'Dallas County', 'Dallas'].
 */
function location(job: AdzunaJob): string {
  const area = (job.location?.area ?? []).filter((part) => typeof part === 'string' && part.trim());
  if (area.length >= 2) return [...area.slice(1)].reverse().join(', ');
  return job.location?.display_name?.trim() ?? '';
}

function date(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** The Adzuna aggregator for runCollector, or none when no key is configured. */
export function adzunaAggregators(env: NodeJS.ProcessEnv = process.env): Aggregator[] {
  const credentials = adzunaCredentials(env);
  if (!credentials) return [];
  return [{ name: 'adzuna', fetch: () => fetchAdzuna(credentials) }];
}
