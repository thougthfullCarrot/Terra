import type { RawJob } from '../../types.js';
import { fetchJson, type FetchJsonOptions } from '../../lib/http.js';
import { stripHtml } from '../../lib/html.js';

/**
 * Workable fetcher.
 *
 * Workable serves every account's board through the public widget endpoint
 * its own embed script reads, with no key:
 *
 *   https://apply.workable.com/api/v1/widget/accounts/<slug>?details=true
 *
 * One GET returns the whole board, descriptions included. The slug is the path
 * segment of the account's board, apply.workable.com/<slug> (Perry Homes is
 * 'perryhomes', M/I Homes is 'mi-homes').
 */

const BASE = 'https://apply.workable.com/api/v1/widget/accounts';

interface WorkableLocation {
  city?: string;
  region?: string;
  country?: string;
  hidden?: boolean;
}

export interface WorkableJob {
  title?: string;
  shortcode?: string;
  employment_type?: string;
  url?: string;
  shortlink?: string;
  application_url?: string;
  published_on?: string;
  created_at?: string;
  city?: string;
  state?: string;
  country?: string;
  telecommuting?: boolean;
  experience?: string;
  locations?: WorkableLocation[];
  description?: string;
}

export interface WorkableResponse {
  name?: string;
  jobs?: WorkableJob[];
}

export function workableUrl(slug: string): string {
  return `${BASE}/${encodeURIComponent(slug)}?details=true`;
}

export async function fetchWorkable(
  firm: string,
  slug: string,
  options: FetchJsonOptions = {}
): Promise<RawJob[]> {
  const payload = await fetchJson<WorkableResponse>(workableUrl(slug), options);
  return parseWorkable(firm, payload);
}

export function parseWorkable(firm: string, payload: WorkableResponse): RawJob[] {
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];

  return jobs.flatMap((job) => {
    const title = job.title?.trim();
    const applyUrl = (job.url ?? job.shortlink ?? job.application_url)?.trim();
    if (!title || !applyUrl) return [];

    return [
      {
        title,
        firm,
        location: location(job),
        description: stripHtml(job.description ?? ''),
        applyUrl,
        postedAt: date(job.published_on ?? job.created_at),
        level: level(job.experience),
        ats: 'workable'
      } satisfies RawJob
    ];
  });
}

/**
 * Workable's experience field uses LinkedIn's ladder. 'Associate' there sits
 * above entry level and is set on roles like 'Area Sales Manager', so it is
 * left to the title; the rest are passed through for classifyKind to read.
 */
function level(experience: string | undefined): string | undefined {
  const value = experience?.trim();
  if (!value || /^(associate|not applicable)$/i.test(value)) return undefined;
  return value;
}

function location(job: WorkableJob): string {
  const places = (job.locations ?? [])
    .filter((place) => !place.hidden)
    .map((place) => [place.city, place.region].filter(Boolean).join(', '))
    .filter(Boolean);
  if (places.length) return places.join('; ');
  return [job.city, job.state].filter(Boolean).join(', ');
}

function date(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
