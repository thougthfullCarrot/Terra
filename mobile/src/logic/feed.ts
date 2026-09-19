import type { Posting, Stage } from '../data/types';

/**
 * The rules behind the screens, as plain functions.
 *
 * They live outside the state hook so they can be tested without a React
 * renderer, and because they are the parts where a mistake is invisible: a
 * wrong colour is obvious on a phone, a filter that silently drops a posting is
 * not.
 */

export interface FeedFilters {
  /** 'All Texas' means no city filter. */
  city: string;
  /** 'All roles' means no kind filter. */
  type: string;
  /** Show only postings at or above the strong-match threshold. */
  matchOnly: boolean;
}

/**
 * Filter and order the feed. Sorted by match score descending, which is what
 * the handoff specifies — an unscored posting sorts to the bottom rather than
 * being hidden.
 */
export function filterFeed(
  jobs: Posting[],
  filters: FeedFilters,
  scoreOf: (id: string) => number,
  isStrong: (id: string) => boolean
): Posting[] {
  return jobs
    .filter(
      (job) =>
        (filters.city === 'All Texas' || job.city === filters.city) &&
        (filters.type === 'All roles' || job.kind === filters.type) &&
        (!filters.matchOnly || isStrong(job.id))
    )
    .sort((a, b) => scoreOf(b.id) - scoreOf(a.id));
}

/**
 * Saved roles, soonest deadline first — the screen is about what is closing,
 * not what was saved most recently. A posting with no deadline sorts last
 * rather than first, which is what `Infinity` is doing here.
 */
export function sortByDeadline(jobs: Posting[]): Posting[] {
  return [...jobs].sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity));
}

/**
 * Re-tapping the active chip clears the filter back to its default, per the
 * handoff. Tapping a different value selects it.
 */
export function toggleFilter(current: string, tapped: string, fallback: string): string {
  return current === tapped ? fallback : tapped;
}

/** Where a pipeline card's button sends it next. An Offer is the end of the line. */
export function nextStage(stage: Stage): Stage | null {
  if (stage === 'Applied') return 'Interview';
  if (stage === 'Interview') return 'Offer';
  return null;
}

/** The note shown under a card once it reaches a stage. */
export function stageNote(stage: Stage): string {
  switch (stage) {
    case 'Applied':
      return 'Applied today';
    case 'Interview':
      return 'Interview scheduled';
    case 'Offer':
      return 'Offer received';
  }
}

export type Urgency = 'closing' | 'soon' | 'later' | 'open';

/**
 * Deadline urgency, which drives the Saved card's left border and badge:
 * red at 15 days or fewer, amber at 25 or fewer, navy beyond.
 */
export function urgencyOf(days: number | null): Urgency {
  if (days === null) return 'open';
  if (days <= 15) return 'closing';
  if (days <= 25) return 'soon';
  return 'later';
}
