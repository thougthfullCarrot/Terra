import type { RawJob } from '../../types.js';
import { fetchJson, type FetchJsonOptions } from '../../lib/http.js';
import { stripHtml } from '../../lib/html.js';

const BASE = 'https://api.lever.co/v0/postings';

interface LeverList {
  text?: string;
  content?: string;
}

interface LeverPosting {
  id?: string;
  text?: string;
  createdAt?: number;
  categories?: {
    location?: string;
    allLocations?: string[];
    commitment?: string;
    team?: string;
    department?: string;
  };
  descriptionPlain?: string;
  description?: string;
  lists?: LeverList[];
  additionalPlain?: string;
  hostedUrl?: string;
  applyUrl?: string;
}

export function leverUrl(slug: string): string {
  return `${BASE}/${encodeURIComponent(slug)}?mode=json`;
}

export async function fetchLever(
  firm: string,
  slug: string,
  options: FetchJsonOptions = {}
): Promise<RawJob[]> {
  const payload = await fetchJson<LeverPosting[]>(leverUrl(slug), options);
  return parseLever(firm, payload);
}

export function parseLever(firm: string, payload: LeverPosting[]): RawJob[] {
  const postings = Array.isArray(payload) ? payload : [];

  return postings.flatMap((posting) => {
    const title = posting.text?.trim();
    const applyUrl = (posting.hostedUrl ?? posting.applyUrl)?.trim();
    if (!title || !applyUrl) return [];

    return [
      {
        title,
        firm,
        location: locations(posting),
        description: description(posting),
        applyUrl,
        postedAt: posting.createdAt ? new Date(posting.createdAt) : undefined,
        // Lever's 'commitment' is the closest thing it has to a level field:
        // 'Intern', 'Full-time', 'Contract'.
        level: posting.categories?.commitment?.trim(),
        ats: 'lever'
      } satisfies RawJob
    ];
  });
}

function locations(posting: LeverPosting): string {
  const all = posting.categories?.allLocations?.filter(Boolean) ?? [];
  if (all.length) return all.join('; ');
  return posting.categories?.location?.trim() ?? '';
}

/**
 * Lever splits a posting into an intro plus named lists ('Requirements',
 * 'What you'll do'). Reassembled with the list names as headings so the
 * requirement extractor can find the section it wants.
 */
function description(posting: LeverPosting): string {
  const parts: string[] = [];

  const intro = posting.descriptionPlain?.trim() || stripHtml(posting.description ?? '');
  if (intro) parts.push(intro);

  for (const list of posting.lists ?? []) {
    const heading = list.text?.trim();
    const body = stripHtml(list.content ?? '');
    if (!body) continue;
    parts.push(heading ? `${heading}\n${body}` : body);
  }

  const extra = posting.additionalPlain?.trim();
  if (extra) parts.push(extra);

  return parts.join('\n\n').trim();
}
