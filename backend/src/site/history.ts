/**
 * How long each job has been listed, and how often it has been taken down and
 * put back up, across builds.
 *
 * The site is rebuilt every two hours from what the boards list right now, so
 * on its own a build can't tell a fresh posting from one that has sat open
 * since spring, or a "new" posting from the same seat reposted with a new id.
 * site.yml keeps this file in the Actions cache between builds (never in the
 * published site: with accounts on, the job list is members-only).
 *
 * A seat is a firm, a city and the role's title with its punctuation and
 * requisition numbers taken out, so "Analyst - Acquisitions (R1234)" and
 * "Analyst, Acquisitions" are the same seat.
 */
import type { Posting } from '../types.js';

export interface SeatHistory {
  /** YYYY-MM-DD the seat was first listed: the board's own date when that is older than our first sighting. */
  firstSeen: string;
  /** YYYY-MM-DD of the last build that saw it. */
  lastSeen: string;
  /** The latest posting ids seen for this seat. */
  ids: string[];
  /** Times the seat came back under a new id, or after days without it. */
  reposts: number;
}

export interface JobHistory {
  updatedAt: string;
  seats: Record<string, SeatHistory>;
}

export interface Seen {
  /** YYYY-MM-DD the seat was first listed. */
  openSince: string;
  /** Times the seat was reposted under a new id or came back after coming down. */
  reposts: number;
}

/** Seats not seen for this long are forgotten, so a role a firm fills every spring starts fresh. */
export const FORGET_DAYS = 120;
/** A seat missing for this long and then back counts as reposted, not as a board hiccup. */
const GAP_DAYS = 3;
const DAY = 86_400_000;

export function seatKey(posting: Pick<Posting, 'firm' | 'city' | 'role'>): string {
  const role = posting.role
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(req|requisition|job)?\s*#?\s*[a-z]*\d[\w-]*\b/g, ' ')
    .replace(/[^a-z]+/g, ' ')
    .trim();
  return [posting.firm.toLowerCase().trim(), posting.city, role].join('|');
}

const day = (date: Date) => date.toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/** Fold one build's postings into the history; returns the new history and each posting's Seen. */
export function updateHistory(
  previous: JobHistory | null,
  postings: Posting[],
  now = new Date()
): { history: JobHistory; seen: Map<string, Seen> } {
  const today = day(now);
  const seats: Record<string, SeatHistory> = {};
  for (const [key, seat] of Object.entries(previous?.seats ?? {})) {
    if (daysBetween(seat.lastSeen, today) <= FORGET_DAYS) seats[key] = { ...seat, ids: [...seat.ids] };
  }

  const seen = new Map<string, Seen>();
  const touched = new Set<string>();
  for (const posting of postings) {
    const key = seatKey(posting);
    const posted = day(posting.postedAt);
    const seat = seats[key];
    if (!seat) {
      seats[key] = { firstSeen: posted < today ? posted : today, lastSeen: today, ids: [posting.id], reposts: 0 };
    } else {
      const newId = !seat.ids.includes(posting.id);
      // The same seat twice in one build is listed in two places, not reposted.
      if (!touched.has(key) && (newId || daysBetween(seat.lastSeen, today) >= GAP_DAYS)) seat.reposts += 1;
      if (posted < seat.firstSeen) seat.firstSeen = posted;
      seat.lastSeen = today;
      if (newId) seat.ids = [...seat.ids, posting.id].slice(-20);
    }
    touched.add(key);
  }
  for (const posting of postings) {
    const seat = seats[seatKey(posting)]!;
    seen.set(posting.id, { openSince: seat.firstSeen, reposts: seat.reposts });
  }
  return { history: { updatedAt: now.toISOString(), seats }, seen };
}
