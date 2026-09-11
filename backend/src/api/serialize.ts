import type {
  FeedPayload,
  Match,
  Posting,
  UiMarkets,
  UiMatchIndex,
  UiPosting
} from '../types.js';

const DAY_MS = 86_400_000;

const DISPLAY_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC'
});

/**
 * Convert a `postings` row into the shape the cards render.
 *
 * The DB stores absolute timestamps; the UI shows 'Posted 2 days ago' and
 * 'closes in 22d'. That arithmetic happens here, once, on the server, so every
 * client agrees on the day count and the client never has to reason about
 * time zones. All day math is in UTC-midnight terms, so a posting does not
 * change age partway through someone's afternoon.
 */
export function toUiPosting(posting: Posting, now = new Date()): UiPosting {
  const deadline = posting.deadline ? new Date(`${posting.deadline}T00:00:00Z`) : null;

  return {
    id: posting.id,
    role: posting.role,
    firm: posting.firm,
    city: posting.city,
    sector: posting.sector,
    kind: posting.kind,
    pay: posting.pay,
    posted: Math.max(0, daysBetween(posting.postedAt, now)),
    deadline: deadline ? DISPLAY_DATE.format(deadline) : null,
    days: deadline ? daysBetween(now, deadline) : null,
    desc: posting.description,
    reqs: posting.reqs,
    source: provenance(posting, now)
  };
}

/**
 * `source` is stored as a stem ('Posted on the firm careers page'); the
 * freshness half is appended at read time from `last_seen`, which is the only
 * way it stays true.
 */
function provenance(posting: Posting, now: Date): string {
  const stem = posting.source?.replace(/[.\s]+$/, '') ?? '';
  const seen = posting.lastSeen;
  if (!stem) return '';
  if (!seen) return `${stem}.`;

  const days = Math.max(0, daysBetween(seen, now));
  const when = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
  return `${stem}, verified ${when}.`;
}

/** Whole calendar days from `from` to `to`, in UTC. Negative when `to` is earlier. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((midnight(to) - midnight(from)) / DAY_MS);
}

function midnight(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function toMatchIndex(matches: Match[]): UiMatchIndex {
  const index: UiMatchIndex = {};
  for (const match of matches) {
    index[match.postingId] = {
      score: match.score,
      note: match.note ?? '',
      lines: match.lines ?? []
    };
  }
  return index;
}

export interface FeedInput {
  postings: Posting[];
  matches: Match[];
  markets: UiMarkets;
  now?: Date;
}

/**
 * Assemble the object `fetchFeed()` resolves with.
 *
 * Sorted by match score descending — the feed spec's ordering — with newest
 * first inside a tie so an unscored posting is not stranded at the bottom
 * forever.
 */
export function buildFeed({ postings, matches, markets, now = new Date() }: FeedInput): FeedPayload {
  const match = toMatchIndex(matches);

  const jobs = postings
    .map((posting) => toUiPosting(posting, now))
    .sort((a, b) => {
      const byScore = (match[b.id]?.score ?? 0) - (match[a.id]?.score ?? 0);
      return byScore !== 0 ? byScore : a.posted - b.posted;
    });

  return { jobs, match, markets, syncedAt: now };
}
