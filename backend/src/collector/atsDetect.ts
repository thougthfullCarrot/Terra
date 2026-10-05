/**
 * Identify an ATS from a URL found on a firm's careers page.
 *
 * This is the inversion that the slug probe was missing. Probing asks "does
 * firm X have a board at guessed slug Y" and gets it right about 1% of the
 * time, because the slug is not derivable from anything. A careers page, by
 * contrast, links to its own board — so the slug arrives as a fact rather than
 * a guess, already attached to the right firm.
 */

export type SupportedAts = 'greenhouse' | 'lever' | 'workday' | 'icims' | 'workable';

/** Platforms worth counting even though no fetcher exists for them yet. */
export type OtherAts =
  | 'bamboohr'
  | 'jazzhr'
  | 'smartrecruiters'
  | 'ashby'
  | 'paylocity'
  | 'adp'
  | 'taleo'
  | 'successfactors'
  | 'paycom'
  | 'ukg'
  | 'jobvite'
  | 'recruitee'
  | 'teamtailor';

export interface AtsMatch {
  ats: SupportedAts | OtherAts;
  supported: boolean;
  /** Board identifier, where the URL carries one. */
  slug: string | null;
  /** Tenant host, for Workday. */
  host: string | null;
  /** The URL this was read off, kept as the evidence for the finding. */
  url: string;
}

/**
 * Patterns are matched against the whole URL. Ordered most specific first:
 * Greenhouse's embed form has to be tried before its board form, or the
 * query-string slug is missed.
 */
export function detectAts(rawUrl: string): AtsMatch | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  // Greenhouse: an embedded board carries the slug in `for`.
  if (host.endsWith('greenhouse.io')) {
    const embedded = url.searchParams.get('for');
    if (embedded) return hit('greenhouse', true, embedded, null, rawUrl);
    const slug = firstSegment(path);
    if (slug && slug !== 'embed') return hit('greenhouse', true, slug, null, rawUrl);
    return hit('greenhouse', true, null, null, rawUrl);
  }

  if (host.endsWith('lever.co')) {
    return hit('lever', true, firstSegment(path), null, rawUrl);
  }

  // Workday: <tenant>.wd<n>.myworkdayjobs.com/<locale>/<site>
  if (host.endsWith('myworkdayjobs.com') || host.endsWith('myworkdaysite.com')) {
    const tenant = host.split('.')[0] ?? null;
    const site = workdaySite(path);
    return {
      ats: 'workday',
      supported: true,
      slug: tenant && site ? `${tenant}/${site}` : tenant,
      host,
      url: rawUrl
    };
  }

  if (host.endsWith('icims.com')) {
    return hit('icims', true, host.split('.')[0] ?? null, host, rawUrl);
  }

  // Workable: apply.workable.com/<slug>, or the older <slug>.workable.com.
  if (host === 'apply.workable.com') {
    const slug = firstSegment(path);
    return hit('workable', true, slug && slug !== 'j' && slug !== 'api' ? slug : null, null, rawUrl);
  }
  if (host.endsWith('.workable.com')) {
    return hit('workable', true, host.split('.')[0] ?? null, null, rawUrl);
  }

  for (const [pattern, ats] of OTHERS) {
    if (pattern.test(host)) return hit(ats, false, null, host, rawUrl);
  }

  return null;
}

const OTHERS: [RegExp, OtherAts][] = [
  [/(^|\.)bamboohr\.com$/, 'bamboohr'],
  [/(^|\.)applytojob\.com$/, 'jazzhr'],
  [/(^|\.)smartrecruiters\.com$/, 'smartrecruiters'],
  [/(^|\.)ashbyhq\.com$/, 'ashby'],
  [/(^|\.)paylocity\.com$/, 'paylocity'],
  [/(^|\.)(myjobs|workforcenow|recruiting)\.adp\.com$/, 'adp'],
  [/(^|\.)taleo\.net$/, 'taleo'],
  [/(^|\.)successfactors\.(com|eu)$/, 'successfactors'],
  [/(^|\.)paycomonline\.net$/, 'paycom'],
  [/(^|\.)ultipro\.com$/, 'ukg'],
  [/(^|\.)jobvite\.com$/, 'jobvite'],
  [/(^|\.)recruitee\.com$/, 'recruitee'],
  [/(^|\.)teamtailor\.com$/, 'teamtailor']
];

function hit(
  ats: SupportedAts | OtherAts,
  supported: boolean,
  slug: string | null,
  host: string | null,
  url: string
): AtsMatch {
  return { ats, supported, slug, host, url };
}

function firstSegment(path: string): string | null {
  const parts = path.split('/').filter(Boolean);
  return parts[0] ?? null;
}

/**
 * Workday paths look like /en-US/CBRE_Careers/job/... — the site name is the
 * segment after the locale, or the first segment when no locale is present.
 */
function workdaySite(path: string): string | null {
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return null;
  const locale = /^[a-z]{2}(-[A-Za-z]{2})?$/.test(parts[0] as string);
  const site = locale ? parts[1] : parts[0];
  return site && site !== 'job' ? site : null;
}
