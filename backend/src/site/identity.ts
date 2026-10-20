/**
 * Which id each official-board opening publishes under.
 *
 * Board postings are keyed by their opening (ats + board + the board's own job
 * id, collector/id.ts openingId), which does not change with the title, the
 * city, or the order the board lists them in. Before that, every posting was
 * keyed by firm + title + city, and those ids are what saved jobs, the
 * tracker and the job history hold. Two openings can share one such id (two
 * "Leasing Analyst, Dallas" seats), so carrying it over is a decision, made
 * here once and kept:
 *
 * - An old id held by exactly one opening this build is bound to it, and that
 *   opening keeps publishing under the old id for as long as it is listed.
 * - An old id shared by several openings with no binding yet is not given to
 *   any of them (it is ambiguous which one the saved job meant). It is
 *   retired and each opening publishes under its opening id.
 * - When the bound opening closes, its old id is retired with it. It is never
 *   handed to another opening that shares the title and city.
 *
 * Bindings and retirements live in the retained-jobs file (retain.ts), so
 * they survive between builds. Postings without an opening id (aggregators,
 * boards that give no job id) publish under their id unchanged.
 */
import type { Posting } from '../types.js';

export interface IdentityState {
  /** old firm + title + city id -> opening id it is bound to. */
  aliases: Record<string, string>;
  /** Old ids that will never be bound again: YYYY-MM-DD retired. */
  retired: Record<string, string>;
}

export interface IdentityResult {
  /** opening id -> the id the site publishes. */
  published: Map<string, string>;
  next: IdentityState;
  /** Old ids newly bound this build. */
  bound: number;
  /** Old ids shared by more than one opening and therefore not carried over. */
  ambiguous: number;
  /** Old ids retired because their opening closed. */
  retiredClosed: number;
}

/** Retired ids are remembered this long, past the job history's own 120 days. */
const RETIRED_DAYS = 180;

/**
 * @param postings every posting this build publishes, fresh and retained
 * @param live opening ids still listed or retained this build (the rest have closed)
 */
export function resolveIdentity(previous: IdentityState | null, postings: Posting[], now = new Date()): IdentityResult {
  const today = now.toISOString().slice(0, 10);
  const aliases: Record<string, string> = {};
  const retired: Record<string, string> = {};
  for (const [legacy, day] of Object.entries(previous?.retired ?? {})) {
    if ((Date.parse(today) - Date.parse(day)) / 86_400_000 <= RETIRED_DAYS) retired[legacy] = day;
  }

  const live = new Set(postings.map((posting) => posting.id));
  let retiredClosed = 0;
  for (const [legacy, opening] of Object.entries(previous?.aliases ?? {})) {
    if (live.has(opening)) aliases[legacy] = opening;
    else if (!retired[legacy]) {
      retired[legacy] = today;
      retiredClosed++;
    }
  }

  const groups = new Map<string, string[]>();
  for (const posting of postings) {
    if (!posting.legacyId) continue;
    const group = groups.get(posting.legacyId) ?? [];
    if (!group.includes(posting.id)) group.push(posting.id);
    groups.set(posting.legacyId, group);
  }

  let bound = 0;
  let ambiguous = 0;
  for (const [legacy, openings] of groups) {
    if (aliases[legacy] || retired[legacy]) continue;
    if (openings.length === 1) {
      aliases[legacy] = openings[0]!;
      bound++;
    } else {
      retired[legacy] = today;
      ambiguous++;
    }
  }

  const byOpening = new Map(Object.entries(aliases).map(([legacy, opening]) => [opening, legacy]));
  const published = new Map<string, string>();
  for (const posting of postings) published.set(posting.id, byOpening.get(posting.id) ?? posting.id);

  return { published, next: { aliases, retired }, bound, ambiguous, retiredClosed };
}

/** The posting under the id the site publishes. */
export function publishAs(posting: Posting, published: Map<string, string>): Posting {
  const id = published.get(posting.id) ?? posting.id;
  return id === posting.id ? posting : { ...posting, id };
}
