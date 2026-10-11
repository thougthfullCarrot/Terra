import type { RawJob, Sector } from '../../types.js';
import type { Aggregator } from '../run.js';
import { fetchJson, type FetchJsonOptions } from '../../lib/http.js';
import { stripHtml } from '../../lib/html.js';

/**
 * Federal real estate jobs in Texas from the USAJOBS Search API.
 *
 *   GET https://data.usajobs.gov/api/search?LocationName=Texas&JobCategoryCode=1170;1171;1173
 *
 * Free. Access is a personal API key requested at
 * https://developer.usajobs.gov/apirequest/ (no cost, no card). The API wants
 * three headers: Host, User-Agent set to the email the key was issued to, and
 * Authorization-Key. Both values come from the environment (USAJOBS_API_KEY,
 * USAJOBS_EMAIL); without them the source is off and nothing else changes.
 *
 * Series searched: 1170 Realty, 1171 Appraising, 1173 Housing Management,
 * plus two keyword searches for real estate and real property work filed under
 * other series. Three requests a pass.
 *
 * Entry level is read from the grade, not the title: a posting whose lowest
 * grade is GS-7 or below, or that is open to students or recent graduates
 * (Pathways), is a first seat. GS-9 and up asks for a year at GS-7 or a
 * master's, so it is left out.
 */

const BASE = 'https://data.usajobs.gov/api/search';
const PAGE_SIZE = 250;
/** Highest starting GS grade Terra treats as entry level. */
export const MAX_ENTRY_GRADE = 7;

export interface UsajobsCredentials {
  apiKey: string;
  email: string;
}

export interface UsajobsQuery {
  JobCategoryCode?: string;
  Keyword?: string;
  /** Series searches are pinned to a sector; keyword hits must prove they are real estate work. */
  pinned: boolean;
}

export const DEFAULT_QUERIES: UsajobsQuery[] = [
  { JobCategoryCode: '1170;1171;1173', pinned: true },
  { Keyword: '"real estate"', pinned: false },
  { Keyword: '"real property"', pinned: false }
];

const SERIES_SECTOR: Record<string, Sector> = {
  '1170': 'Asset Mgmt',
  '1171': 'Appraisal',
  '1173': 'Property Mgmt'
};

export interface UsajobsResponse {
  SearchResult?: {
    SearchResultCountAll?: number;
    SearchResultItems?: { MatchedObjectDescriptor?: UsajobsJob }[];
  };
}

export interface UsajobsJob {
  PositionID?: string;
  PositionTitle?: string;
  PositionURI?: string;
  ApplyURI?: string[];
  PositionLocation?: { LocationName?: string; CountrySubDivisionCode?: string }[];
  OrganizationName?: string;
  DepartmentName?: string;
  JobCategory?: { Name?: string; Code?: string }[];
  JobGrade?: { Code?: string }[];
  PositionRemuneration?: { MinimumRange?: string; MaximumRange?: string; RateIntervalCode?: string; Description?: string }[];
  PublicationStartDate?: string;
  ApplicationCloseDate?: string;
  QualificationSummary?: string;
  UserArea?: {
    Details?: {
      JobSummary?: string;
      MajorDuties?: string[] | string;
      LowGrade?: string;
      HighGrade?: string;
      HiringPath?: string[];
    };
  };
}

export function usajobsCredentials(env: NodeJS.ProcessEnv = process.env): UsajobsCredentials | null {
  const apiKey = env.USAJOBS_API_KEY?.trim();
  const email = env.USAJOBS_EMAIL?.trim();
  return apiKey && email ? { apiKey, email } : null;
}

export function usajobsUrl(query: UsajobsQuery, page = 1): string {
  const params = new URLSearchParams({ LocationName: 'Texas', ResultsPerPage: String(PAGE_SIZE), Page: String(page) });
  if (query.JobCategoryCode) params.set('JobCategoryCode', query.JobCategoryCode);
  if (query.Keyword) params.set('Keyword', query.Keyword);
  return `${BASE}?${params}`;
}

export interface UsajobsOptions extends FetchJsonOptions {
  queries?: UsajobsQuery[];
  /** Requests per pass. */
  maxRequests?: number;
}

export async function fetchUsajobs(credentials: UsajobsCredentials, options: UsajobsOptions = {}): Promise<RawJob[]> {
  const { queries = DEFAULT_QUERIES, maxRequests = 3, ...http } = options;
  const seen = new Set<string>();
  const jobs: RawJob[] = [];
  let requests = 0;

  for (const query of queries) {
    if (requests >= maxRequests) break;
    requests++;
    const payload = await fetchJson<UsajobsResponse>(usajobsUrl(query), {
      ...http,
      headers: {
        host: 'data.usajobs.gov',
        'user-agent': credentials.email,
        'authorization-key': credentials.apiKey,
        ...http.headers
      }
    });
    for (const job of parseUsajobs(payload, query.pinned)) {
      if (seen.has(job.applyUrl)) continue;
      seen.add(job.applyUrl);
      jobs.push(job);
    }
  }
  return jobs;
}

export function parseUsajobs(payload: UsajobsResponse, pinned = true): RawJob[] {
  const items = payload?.SearchResult?.SearchResultItems ?? [];
  return items.flatMap(({ MatchedObjectDescriptor: job }) => {
    if (!job) return [];
    const title = (job.PositionTitle ?? '').trim();
    const applyUrl = (job.PositionURI ?? job.ApplyURI?.[0] ?? '').trim();
    const firm = (job.OrganizationName || job.DepartmentName || '').trim();
    if (!title || !applyUrl || !firm) return [];

    const texas = (job.PositionLocation ?? [])
      .filter((place) => /texas/i.test(place.CountrySubDivisionCode ?? '') || /,\s*texas\b/i.test(place.LocationName ?? ''))
      .map((place) => place.LocationName ?? '')
      .filter(Boolean);
    if (!texas.length) return [];

    const series = (job.JobCategory ?? []).map((category) => category.Code ?? '');
    const sector = series.map((code) => SERIES_SECTOR[code]).find(Boolean);
    const details = job.UserArea?.Details ?? {};

    return [
      {
        title,
        firm,
        location: texas.join('; '),
        description: description(job),
        applyUrl,
        postedAt: date(job.PublicationStartDate),
        level: level(job),
        ats: 'usajobs',
        ...(sector && pinned ? { sector } : {}),
        // A keyword hit outside the real estate series has to show real estate work.
        ...(pinned && sector ? {} : { creOnly: true })
      } satisfies RawJob
    ];

    function description(posting: UsajobsJob): string {
      const duties = Array.isArray(details.MajorDuties) ? details.MajorDuties.join('\n') : details.MajorDuties ?? '';
      const pay = posting.PositionRemuneration?.[0];
      const grades = details.LowGrade ? `Grade: GS-${details.LowGrade}${details.HighGrade && details.HighGrade !== details.LowGrade ? ` to GS-${details.HighGrade}` : ''}` : '';
      return [
        grades,
        pay?.MinimumRange ? `Pay: $${money(pay.MinimumRange)} - $${money(pay.MaximumRange ?? pay.MinimumRange)} ${pay.Description ?? ''}`.trim() : '',
        posting.ApplicationCloseDate ? `Apply by ${posting.ApplicationCloseDate.slice(0, 10)}.` : '',
        stripHtml(details.JobSummary ?? ''),
        stripHtml(duties),
        'Qualifications',
        stripHtml(posting.QualificationSummary ?? '')
      ]
        .filter(Boolean)
        .join('\n');
    }
  });
}

/**
 * The board-style level classifyKind trusts over the title: Pathways student
 * seats are internships, a starting grade of GS-7 or below is entry level,
 * anything higher is not.
 */
export function level(job: UsajobsJob): string {
  const details = job.UserArea?.Details ?? {};
  const paths = (details.HiringPath ?? []).map((path) => path.toLowerCase());
  if (paths.includes('student') || /\bintern(ship)?\b/i.test(job.PositionTitle ?? '')) return 'Internship';
  const low = Number.parseInt(details.LowGrade ?? '', 10);
  const payPlan = job.JobGrade?.[0]?.Code ?? '';
  if (/^G[SL]$/i.test(payPlan) && Number.isFinite(low)) return low <= MAX_ENTRY_GRADE ? 'Entry level' : 'Mid-Senior';
  if (paths.includes('graduates')) return 'Entry level';
  // Wage grades and other pay plans: let the title and the text decide.
  return '';
}

function money(value: string): string {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : value;
}

function date(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** The USAJOBS aggregator for runCollector, or none when no key is configured. */
export function usajobsAggregators(env: NodeJS.ProcessEnv = process.env): Aggregator[] {
  const credentials = usajobsCredentials(env);
  if (!credentials) return [];
  return [{ name: 'usajobs', fetch: () => fetchUsajobs(credentials) }];
}
