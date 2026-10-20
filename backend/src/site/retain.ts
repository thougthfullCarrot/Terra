/**
 * Jobs from a board that could not be read this build.
 *
 * The site is rebuilt from what the boards list right now, so before this a
 * board that failed for one build (Workday 502s, a timeout) took every one of
 * its jobs off the site until the next good build, and a board read only in
 * part dropped the jobs it did not reach. Neither is the job closing.
 *
 * This keeps, between builds (in the Actions cache, beside history.ts), each
 * board posting with the time it was last verified on its board:
 *
 * - Board read in full: what it lists is the truth. Jobs it no longer lists
 *   are closed and dropped, and counted as closed.
 * - Board failed, or read in part: jobs it listed before and did not list
 *   this time are kept for up to RETAIN_DAYS, marked retained, with their
 *   last verified date, so the site never shows them as freshly checked.
 *   Past that they are dropped as unverifiable.
 *
 * Aggregator postings (Adzuna, USAJOBS) are not retained: a search is not a
 * board, and its absence says nothing about one firm.
 */
import type { Posting } from '../types.js';
import type { BoardStatus } from '../collector/run.js';

/** How long a board's jobs outlive the board being unreadable. */
export const RETAIN_DAYS = 7;
const DAY = 86_400_000;

interface StoredPosting extends Omit<Posting, 'postedAt' | 'firstSeen' | 'lastSeen'> {
  postedAt: string;
}

export interface RetainedEntry {
  firm: string;
  /** ISO time the board last listed it. */
  verifiedAt: string;
  posting: StoredPosting;
}

export interface RetainFile {
  updatedAt: string;
  postings: Record<string, RetainedEntry>;
}

export interface Verification {
  /** ISO time the posting was last seen on its source. */
  verifiedAt: string;
  /** Kept from an earlier build because its board could not be read in full this time. */
  retained: boolean;
}

export interface RetainResult {
  /** This build's postings plus the retained ones. */
  postings: Posting[];
  verification: Map<string, Verification>;
  /** Retained postings, by firm. */
  retainedByFirm: Record<string, number>;
  /** Listed last build on a board read in full this build, and gone: closed. */
  closed: number;
  /** Retained past RETAIN_DAYS and dropped. */
  expired: number;
  next: RetainFile;
}

export function retainUnverified(
  previous: RetainFile | null,
  boards: BoardStatus[],
  postings: Posting[],
  now = new Date()
): RetainResult {
  const nowIso = now.toISOString();
  const byId = new Map(postings.map((posting) => [posting.id, posting]));
  const boardOf = new Map<string, BoardStatus>();
  for (const board of boards) for (const id of board.ids) boardOf.set(id, board);
  const statusOf = new Map(boards.map((board) => [board.firm.toLowerCase(), board]));

  const next: RetainFile = { updatedAt: nowIso, postings: {} };
  const verification = new Map<string, Verification>();
  for (const posting of postings) {
    verification.set(posting.id, { verifiedAt: nowIso, retained: false });
    const board = boardOf.get(posting.id);
    if (board) next.postings[posting.id] = { firm: board.firm, verifiedAt: nowIso, posting: store(posting) };
  }

  const out = [...postings];
  const retainedByFirm: Record<string, number> = {};
  let closed = 0;
  let expired = 0;
  for (const [id, entry] of Object.entries(previous?.postings ?? {})) {
    if (byId.has(id)) continue;
    const board = statusOf.get(entry.firm.toLowerCase());
    // A firm taken off the list takes its jobs with it.
    if (!board) continue;
    if (board.status === 'ok') {
      closed++;
      continue;
    }
    if (now.getTime() - Date.parse(entry.verifiedAt) > RETAIN_DAYS * DAY) {
      expired++;
      continue;
    }
    const posting = revive(entry.posting);
    out.push(posting);
    next.postings[id] = entry;
    verification.set(id, { verifiedAt: entry.verifiedAt, retained: true });
    retainedByFirm[entry.firm] = (retainedByFirm[entry.firm] ?? 0) + 1;
  }

  return { postings: out, verification, retainedByFirm, closed, expired, next };
}

function store(posting: Posting): StoredPosting {
  const { firstSeen: _first, lastSeen: _last, active: _active, ...rest } = posting;
  return { ...rest, postedAt: posting.postedAt.toISOString() };
}

function revive(stored: StoredPosting): Posting {
  return { ...stored, postedAt: new Date(stored.postedAt) };
}
