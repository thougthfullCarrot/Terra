import type { RawJob } from '../../types.js';
import { fetchJson, type FetchJsonOptions } from '../../lib/http.js';
import { stripHtml } from '../../lib/html.js';
import { isTexas } from '../texas.js';

/**
 * SmartRecruiters fetcher.
 *
 * SmartRecruiters' public Posting API needs no key:
 *
 *   https://api.smartrecruiters.com/v1/companies/<id>/postings          (list, 100 a page)
 *   https://api.smartrecruiters.com/v1/companies/<id>/postings/<post>   (one, with the job ad)
 *
 * The list has no description, so only Texas postings get the second call:
 * a national company can list thousands of jobs and Terra keeps a handful.
 * The company id is the path segment of jobs.smartrecruiters.com/<id>.
 */

const BASE = 'https://api.smartrecruiters.com/v1/companies';
const PAGE = 100;

interface SrLocation {
  city?: string;
  region?: string;
  country?: string;
  remote?: boolean;
  fullLocation?: string;
}

export interface SrPosting {
  id?: string;
  name?: string;
  releasedDate?: string;
  location?: SrLocation;
  experienceLevel?: { label?: string };
  typeOfEmployment?: { label?: string };
}

export interface SrList {
  totalFound?: number;
  content?: SrPosting[];
}

export interface SrDetail extends SrPosting {
  postingUrl?: string;
  applyUrl?: string;
  jobAd?: { sections?: Record<string, { title?: string; text?: string } | undefined> };
}

export const smartRecruitersListUrl = (id: string, offset = 0) =>
  `${BASE}/${encodeURIComponent(id)}/postings?limit=${PAGE}&offset=${offset}`;
export const smartRecruitersPostingUrl = (id: string, posting: string) =>
  `${BASE}/${encodeURIComponent(id)}/postings/${encodeURIComponent(posting)}`;

export function srLocation(location: SrLocation | undefined): string {
  if (!location) return '';
  if (location.fullLocation?.trim()) return location.fullLocation.trim();
  return [location.city, location.region, location.country?.toUpperCase()].filter(Boolean).join(', ');
}

/** Texas by state, or by a Texas city name when the region is blank. */
function inTexas(location: SrLocation | undefined): boolean {
  if (/^(tx|texas)$/i.test(location?.region?.trim() ?? '')) return true;
  return isTexas(srLocation(location));
}

export async function fetchSmartRecruiters(
  firm: string,
  id: string,
  options: FetchJsonOptions & { maxPages?: number } = {}
): Promise<RawJob[]> {
  const { maxPages = 20, ...http } = options;
  const postings: SrPosting[] = [];
  for (let page = 0; page < maxPages; page++) {
    const list = await fetchJson<SrList>(smartRecruitersListUrl(id, page * PAGE), http);
    const content = list.content ?? [];
    postings.push(...content);
    if (content.length < PAGE || postings.length >= (list.totalFound ?? 0)) break;
  }
  const texas = postings.filter((p) => p.id && inTexas(p.location));
  const details: SrDetail[] = [];
  for (const posting of texas) {
    details.push(await fetchJson<SrDetail>(smartRecruitersPostingUrl(id, posting.id!), http).catch(() => posting));
  }
  return parseSmartRecruiters(firm, id, details);
}

export function parseSmartRecruiters(firm: string, id: string, postings: SrDetail[]): RawJob[] {
  return postings.flatMap((posting) => {
    const title = posting.name?.trim();
    if (!title || !posting.id) return [];
    const sections = posting.jobAd?.sections ?? {};
    const description = ['jobDescription', 'qualifications', 'additionalInformation']
      .map((key) => {
        const section = sections[key];
        const body = stripHtml(section?.text ?? '');
        return body ? (section?.title ? `${section.title}\n${body}` : body) : '';
      })
      .filter(Boolean)
      .join('\n\n');
    const posted = posting.releasedDate ? new Date(posting.releasedDate) : undefined;
    return [
      {
        title,
        firm,
        location: srLocation(posting.location),
        description,
        applyUrl: posting.postingUrl?.trim() || `https://jobs.smartrecruiters.com/${encodeURIComponent(id)}/${encodeURIComponent(posting.id)}`,
        postedAt: posted && !Number.isNaN(posted.getTime()) ? posted : undefined,
        level: posting.experienceLevel?.label?.trim() || posting.typeOfEmployment?.label?.trim(),
        ats: 'smartrecruiters'
      } satisfies RawJob
    ];
  });
}
