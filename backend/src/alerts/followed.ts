import type { FetchJsonOptions } from '../lib/http.js';
import { DONE, STATUS, parseProjectPage, projectDetails, searchProject, tabsPermalink, tabsProjectUrl, type TabsRow } from '../market/developments.js';
import { fetchText } from '../lib/http.js';

/**
 * Followed TABS projects, checked on their own every day so a watch keeps
 * working after the project leaves the development map (finish date long
 * past, under the metro's cost cut, older than the map's window).
 *
 * Each followed project number costs one TABS search a day (status, cost,
 * dates) and one project page a week (owner, design firm, size, scope). When
 * TABS can't be read, the last good values are kept and the record says the
 * check failed; nothing missing is ever reported as a change.
 */

/** Days between project page reads. */
export const DETAILS_EVERY_DAYS = 7;
/** Most followed projects one build checks (25 items per member caps it in practice). */
export const MAX_FOLLOWED = 200;

export type FollowedState = 'ok' | 'not_found' | 'error';

export interface FollowedDetails {
  owner: string | null;
  designFirm: string | null;
  squareFeet: number | null;
  scope: string | null;
  /** When the page was last read successfully (ISO time). */
  checked: string;
}

export interface FollowedProject {
  /** The outcome of the latest check. Values below are from the last successful one. */
  state: FollowedState;
  /** Last time TABS answered for this project (ISO time), null if it never has. */
  checked: string | null;
  /** When the latest check failed, and why (only with state 'error'). */
  failedAt?: string;
  error?: string;
  n: string | null;
  /** TABS status code and its label. */
  code: number | null;
  st: string | null;
  cost: number | null;
  start: string | null;
  end: string | null;
  url: string;
  details: FollowedDetails | null;
  /** Set when the last page read failed; details keep their earlier values. */
  detailsError?: string;
}

export interface FollowedFetchers {
  search(number: string): Promise<TabsRow | null>;
  page(number: string): Promise<string>;
}

export function tabsFetchers(http: FetchJsonOptions = {}): FollowedFetchers {
  return {
    search: (number) => searchProject(number, http),
    page: (number) => fetchText(tabsProjectUrl(number), { timeoutMs: 60_000, ...http })
  };
}

/** Only TABS numbers are followed this way; city permit ids come from the map. */
export const isTabsNumber = (ref: string) => /^TABS\d{6,}$/.test(ref);

/** Whether a status code means the project is finished or closed in TABS. */
export const isFinished = (code: number | null) => code != null && DONE.has(code);

const isoDate = (value: string | null | undefined) => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null);

export interface RefreshSummary {
  checked: number;
  reused: number;
  ok: number;
  notFound: number;
  errors: number;
  pages: number;
  pageErrors: number;
  requests: number;
  ms: number;
}

/**
 * Check every followed project. `previous` is the newest stored record per
 * project (from an earlier day or an earlier run today); `reuseToday` skips
 * projects already checked successfully on this Texas day.
 */
export async function refreshFollowed(
  numbers: string[],
  previous: Record<string, FollowedProject>,
  {
    fetchers,
    now = new Date(),
    today,
    pauseMs = 300,
    pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
  }: { fetchers: FollowedFetchers; now?: Date; today?: string; pauseMs?: number; pause?: (ms: number) => Promise<void> }
): Promise<{ followed: Record<string, FollowedProject>; summary: RefreshSummary }> {
  const started = Date.now();
  const at = now.toISOString();
  const summary: RefreshSummary = { checked: 0, reused: 0, ok: 0, notFound: 0, errors: 0, pages: 0, pageErrors: 0, requests: 0, ms: 0 };
  const followed: Record<string, FollowedProject> = {};
  const wanted = [...new Set(numbers.filter(isTabsNumber))].sort().slice(0, MAX_FOLLOWED);
  const wait = async () => {
    if (summary.requests++) await pause(pauseMs);
  };

  for (const number of wanted) {
    const before = previous[number];
    if (today && before?.state === 'ok' && before.checked && sameTexasDay(before.checked, today)) {
      followed[number] = before;
      summary.reused++;
      continue;
    }
    summary.checked++;
    const base: FollowedProject = before
      ? { ...before }
      : { state: 'error', checked: null, n: null, code: null, st: null, cost: null, start: null, end: null, url: tabsPermalink(number), details: null };
    delete base.failedAt;
    delete base.error;

    let row: TabsRow | null;
    try {
      await wait();
      row = await fetchers.search(number);
    } catch (e) {
      summary.errors++;
      followed[number] = { ...base, state: 'error', failedAt: at, error: message(e) };
      continue;
    }
    if (!row) {
      summary.notFound++;
      followed[number] = { ...base, state: 'not_found', checked: at };
      continue;
    }
    summary.ok++;
    const record: FollowedProject = {
      ...base,
      state: 'ok',
      checked: at,
      n: row.ProjectName?.trim() || base.n,
      code: row.ProjectStatus ?? null,
      st: STATUS[row.ProjectStatus] ?? `Status ${row.ProjectStatus}`,
      cost: Number.isFinite(row.EstimatedCost) && row.EstimatedCost > 0 ? Math.round(row.EstimatedCost) : null,
      start: isoDate(row.EstimatedStartDate),
      end: isoDate(row.EstimatedEndDate)
    };
    delete record.detailsError;

    const age = record.details ? (now.getTime() - Date.parse(record.details.checked)) / 86_400_000 : Infinity;
    if (age >= DETAILS_EVERY_DAYS - 0.25) {
      try {
        await wait();
        summary.pages++;
        const d = projectDetails(parseProjectPage(await fetchers.page(number)));
        if (!d.owner && !d.designFirm && !d.scope && d.squareFeet == null) throw new Error('the project page had none of the expected fields');
        record.details = { owner: d.owner, designFirm: d.designFirm, squareFeet: d.squareFeet, scope: d.scope, checked: at };
      } catch (e) {
        summary.pageErrors++;
        record.detailsError = message(e);
      }
    }
    followed[number] = record;
  }
  summary.ms = Date.now() - started;
  return { followed, summary };
}

function sameTexasDay(iso: string, day: string): boolean {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(iso)) === day;
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}
