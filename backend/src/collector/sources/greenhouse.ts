import type { RawJob } from '../../types.js';
import { fetchJson, type FetchJsonOptions } from '../../lib/http.js';
import { stripHtml } from '../../lib/html.js';
import { IncompleteBoardError } from './incomplete.js';

const BASE = 'https://boards-api.greenhouse.io/v1/boards';

interface GreenhouseJob {
  id: number;
  title?: string;
  updated_at?: string;
  first_published?: string;
  location?: { name?: string };
  offices?: { name?: string; location?: string }[];
  content?: string;
  absolute_url?: string;
  metadata?: { name?: string; value?: unknown }[];
}

interface GreenhouseResponse {
  jobs?: GreenhouseJob[];
  /** How many jobs the board holds. The list endpoint is not paged, so `jobs` should hold all of them. */
  meta?: { total?: number };
}

export function greenhouseUrl(slug: string): string {
  return `${BASE}/${encodeURIComponent(slug)}/jobs?content=true`;
}

/** Fetch one Greenhouse board and map it to RawJob. */
export async function fetchGreenhouse(
  firm: string,
  slug: string,
  options: FetchJsonOptions = {}
): Promise<RawJob[]> {
  const payload = await fetchJson<GreenhouseResponse>(greenhouseUrl(slug), options);
  const jobs = parseGreenhouse(firm, payload);
  const listed = Array.isArray(payload?.jobs) ? payload.jobs.length : 0;
  const total = payload?.meta?.total;
  if (typeof total === 'number' && listed < total) {
    throw new IncompleteBoardError(`Greenhouse board ${slug} reports ${total} jobs but listed ${listed}`, jobs);
  }
  return jobs;
}

export function parseGreenhouse(firm: string, payload: GreenhouseResponse): RawJob[] {
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];

  return jobs.flatMap((job) => {
    const title = job.title?.trim();
    const applyUrl = job.absolute_url?.trim();
    if (!title || !applyUrl) return [];

    return [
      {
        title,
        firm,
        location: location(job),
        // `content` is HTML, and Greenhouse escapes it into the JSON string.
        description: stripHtml(job.content ?? ''),
        applyUrl,
        postedAt: date(job.first_published ?? job.updated_at),
        level: metadata(job, /level|seniority|experience/i),
        ats: 'greenhouse',
        sourceId: String(job.id)
      } satisfies RawJob
    ];
  });
}

/**
 * The posting's location line, then each office it is tied to. A board's
 * location line can be 'Multiple Locations', 'Remote' or another state's city
 * while one of its offices is in Texas, so the offices are always read too;
 * the Texas resolver takes the first Texas place in the list.
 */
export function location(job: Pick<GreenhouseJob, 'location' | 'offices'>): string {
  const places = [
    job.location?.name,
    ...(job.offices ?? []).map((office) => office.location?.trim() || office.name)
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value) && value !== 'No offices');
  const seen = new Set<string>();
  return places.filter((place) => !seen.has(place.toLowerCase()) && seen.add(place.toLowerCase())).join('; ');
}

/** Boards expose an optional custom field list; pull the seniority one if present. */
function metadata(job: GreenhouseJob, match: RegExp): string | undefined {
  const field = (job.metadata ?? []).find((entry) => entry.name && match.test(entry.name));
  const value = field?.value;
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

function date(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
