import { CITIES, type City, type Kind, type Posting, type Sector } from '../types.js';
import type { RunReport } from '../collector/run.js';
import { matchInputs, type MatchInputs } from '../matching/score.js';
import type { Seen } from './history.js';

/**
 * One posting as the public website renders it.
 *
 * Unlike UiPosting this carries absolute dates, not day counts. The website is
 * a static snapshot that can sit unrefreshed for hours, so "posted 2 days ago"
 * has to be worked out when someone looks at it, not when the file was written.
 * It also carries `applyUrl`, which the app gets from the detail sheet but the
 * site needs on every card.
 */
export interface SitePosting {
  id: string;
  role: string;
  firm: string;
  city: City;
  sector: Sector;
  kind: Kind;
  pay: string | null;
  /** ISO timestamp. */
  postedAt: string;
  /** ISO date (YYYY-MM-DD) or null. */
  deadline: string | null;
  desc: string;
  reqs: string[];
  applyUrl: string;
  /**
   * What the resume matcher reads from the posting's text, worked out here
   * from the full description because `desc` is truncated. The site scores
   * jobs in the browser (match.js) against the signed-in user's profile.
   */
  match: MatchInputs;
  /** The aggregator a posting came through, when it did not come from a firm board. */
  via: 'Adzuna' | null;
  /** YYYY-MM-DD the seat was first listed, across builds (history.ts). */
  openSince?: string;
  /** Times the seat was reposted or came back after coming down. */
  reposts?: number;
}

export interface SiteSnapshot {
  /** ISO timestamp of the collector pass this was built from. */
  generatedAt: string;
  /** Boards polled, and how many of them failed, so a thin feed can be told apart from a broken one. */
  boards: { polled: number; failed: number };
  /** Every city Terra covers, so the filter offers one even on a day it has no postings. */
  cities: City[];
  jobs: SitePosting[];
}

/** Long enough to read as a summary on a card; the full text is one click away on the firm's board. */
export const DESC_LIMIT = 600;

export function buildSnapshot(postings: Posting[], report: RunReport, seen?: Map<string, Seen>): SiteSnapshot {
  const jobs = postings
    .map((posting) => ({ ...toSitePosting(posting), ...seen?.get(posting.id) }))
    // Newest first; id breaks ties so the file is stable between identical runs.
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt) || a.id.localeCompare(b.id));

  return {
    generatedAt: report.ranAt.toISOString(),
    boards: { polled: report.firms, failed: report.firmsFailed },
    cities: [...CITIES],
    jobs
  };
}

export function toSitePosting(posting: Posting): SitePosting {
  return {
    id: posting.id,
    role: posting.role,
    firm: posting.firm,
    city: posting.city,
    sector: posting.sector,
    kind: posting.kind,
    pay: posting.pay,
    postedAt: posting.postedAt.toISOString(),
    deadline: posting.deadline,
    desc: truncate(posting.description, DESC_LIMIT),
    reqs: posting.reqs,
    applyUrl: posting.applyUrl,
    match: matchInputs(posting),
    via: viaAggregator(posting.applyUrl)
  };
}

/**
 * Adzuna's terms require crediting it wherever its listings appear, and its
 * apply links are its own redirects, so the link is what identifies them.
 */
export function viaAggregator(applyUrl: string): SitePosting['via'] {
  try {
    const host = new URL(applyUrl).hostname;
    return host === 'adzuna.com' || host.endsWith('.adzuna.com') ? 'Adzuna' : null;
  } catch {
    return null;
  }
}

function truncate(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
