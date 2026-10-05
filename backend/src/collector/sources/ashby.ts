import type { RawJob } from '../../types.js';
import { fetchJson, type FetchJsonOptions } from '../../lib/http.js';
import { stripHtml } from '../../lib/html.js';

/**
 * Ashby fetcher.
 *
 * Ashby publishes every company's board through its public posting API, the
 * one its own hosted page reads, with no key:
 *
 *   https://api.ashbyhq.com/posting-api/job-board/<slug>
 *
 * One GET returns the whole board with descriptions. The slug is the path
 * segment of the hosted board, jobs.ashbyhq.com/<slug>.
 */

const BASE = 'https://api.ashbyhq.com/posting-api/job-board';

interface AshbyAddress {
  postalAddress?: { addressLocality?: string; addressRegion?: string; addressCountry?: string };
}

export interface AshbyJob {
  title?: string;
  location?: string;
  secondaryLocations?: { location?: string; address?: AshbyAddress }[];
  address?: AshbyAddress;
  employmentType?: string;
  isListed?: boolean;
  publishedAt?: string;
  jobUrl?: string;
  applyUrl?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
}

export interface AshbyResponse {
  jobs?: AshbyJob[];
}

export function ashbyUrl(slug: string): string {
  return `${BASE}/${encodeURIComponent(slug)}`;
}

export async function fetchAshby(firm: string, slug: string, options: FetchJsonOptions = {}): Promise<RawJob[]> {
  return parseAshby(firm, await fetchJson<AshbyResponse>(ashbyUrl(slug), options));
}

export function parseAshby(firm: string, payload: AshbyResponse): RawJob[] {
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  return jobs.flatMap((job) => {
    const title = job.title?.trim();
    const applyUrl = (job.jobUrl ?? job.applyUrl)?.trim();
    if (!title || !applyUrl || job.isListed === false) return [];
    const posted = job.publishedAt ? new Date(job.publishedAt) : undefined;
    return [
      {
        title,
        firm,
        location: locations(job),
        description: job.descriptionPlain?.trim() || stripHtml(job.descriptionHtml ?? ''),
        applyUrl,
        postedAt: posted && !Number.isNaN(posted.getTime()) ? posted : undefined,
        // 'Intern', 'FullTime', 'Contract': the nearest thing Ashby has to a level.
        level: job.employmentType?.trim(),
        ats: 'ashby'
      } satisfies RawJob
    ];
  });
}

/** The listed location plus any secondary ones; a bare "Remote" gains its state when the address has one. */
function locations(job: AshbyJob): string {
  const place = (name: string | undefined, address: AshbyAddress | undefined) => {
    const postal = address?.postalAddress;
    const detail = [postal?.addressLocality, postal?.addressRegion].filter(Boolean).join(', ');
    const label = name?.trim() ?? '';
    if (!detail || label.toLowerCase().includes((postal?.addressLocality ?? '').toLowerCase())) return label || detail;
    return label ? `${label} (${detail})` : detail;
  };
  return [place(job.location, job.address), ...(job.secondaryLocations ?? []).map((s) => place(s.location, s.address))]
    .filter(Boolean)
    .join('; ');
}
