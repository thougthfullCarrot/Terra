/**
 * Find the links on a firm's site that lead to its job board.
 *
 * A careers page is the one place a firm reliably states which ATS it uses: the
 * "view openings" button points straight at it. Reading that is the difference
 * between knowing a firm's board and guessing at it.
 */

/** Paths worth trying directly when the homepage gives nothing away. */
export const CAREERS_PATHS = [
  '/careers',
  '/careers/',
  '/jobs',
  '/join-us',
  '/about/careers',
  '/company/careers',
  '/careers/open-positions',
  '/about-us/careers'
];

const CAREERS_WORDS = /(career|job|opening|position|join|hiring|employment|work-with|work-for)/i;

/**
 * Every href in the HTML, resolved against the page URL. Relative links are
 * the common case on a careers page, so resolving matters.
 */
export function extractLinks(html: string, pageUrl: string): string[] {
  const out = new Set<string>();

  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const raw = (match[2] ?? match[3] ?? match[4] ?? '').trim();
    if (!raw || raw.startsWith('#') || /^(mailto|tel|javascript):/i.test(raw)) continue;
    try {
      out.add(new URL(raw, pageUrl).toString());
    } catch {
      // A malformed href is not worth a failed run.
    }
  }

  return [...out];
}

/**
 * Links that look like they lead to a careers page, so the crawler can follow
 * one hop from the homepage instead of only trying guessed paths. Ordered by
 * how career-ish the URL looks, since only the first few get followed.
 */
export function careersCandidates(links: string[], origin: string): string[] {
  const sameSite = links.filter((link) => {
    try {
      // A firm hosting careers on a subdomain is normal; a link to an
      // unrelated site is not worth a request.
      const host = new URL(link).hostname.replace(/^www\./, '');
      const base = new URL(origin).hostname.replace(/^www\./, '');
      return host === base || host.endsWith(`.${base}`) || base.endsWith(`.${host}`);
    } catch {
      return false;
    }
  });

  return sameSite
    .filter((link) => CAREERS_WORDS.test(new URL(link).pathname))
    .sort((a, b) => score(b) - score(a))
    .slice(0, 4);
}

function score(url: string): number {
  const path = new URL(url).pathname.toLowerCase();
  let points = 0;
  if (/careers?\/?$/.test(path)) points += 3;
  if (/\bcareers?\b/.test(path)) points += 2;
  if (/\bjobs?\b/.test(path)) points += 1;
  // A deep path is more likely a single posting than the careers index.
  points -= path.split('/').filter(Boolean).length;
  return points;
}
