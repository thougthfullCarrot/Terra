import type { Match, Posting, Profile, RawJob } from '../types.js';
import type { FirmRow, Store } from '../db/store.js';
import { normalize, type RejectReason } from './normalize.js';
import { fetchGreenhouse } from './sources/greenhouse.js';
import { fetchLever } from './sources/lever.js';
import { scoreMatch } from '../matching/score.js';
import { STRONG_MATCH } from '../types.js';

/** How long a posting can go unseen on its board before it stops being active. */
export const STALE_DAYS = 14;

export type Fetcher = (firm: FirmRow) => Promise<RawJob[]>;

export interface Notifier {
  /** Called once per profile with the new postings worth waking them for. */
  notify(profile: Profile, postings: Posting[]): Promise<void>;
}

export interface RunOptions {
  store: Store;
  /** Override per-ATS fetching; defaults to the real Greenhouse/Lever clients. */
  fetcher?: Fetcher;
  notifier?: Notifier;
  now?: Date;
  staleDays?: number;
  /** Cap on concurrent board fetches. Boards are small; be a polite client. */
  concurrency?: number;
}

export interface RunReport {
  firms: number;
  firmsFailed: number;
  fetched: number;
  kept: number;
  rejected: Record<RejectReason, number>;
  sectorGuessed: number;
  inserted: number;
  updated: number;
  deactivated: number;
  matchesWritten: number;
  strongMatches: number;
  notified: number;
  errors: { firm: string; message: string }[];
  ranAt: Date;
}

/**
 * One collector pass, exactly the pipeline in the spec:
 *
 *   fetch -> Texas -> intern/entry -> classify sector -> normalize -> dedupe
 *         -> upsert -> expire stale -> score new rows -> push
 *
 * Every stage's drop count lands in the report. A collector that quietly
 * returns nothing is the failure mode that matters here, so a run that keeps
 * zero postings should be loud in the logs rather than look like a clean run.
 */
export async function runCollector(options: RunOptions): Promise<RunReport> {
  const {
    store,
    fetcher = defaultFetcher,
    notifier,
    now = new Date(),
    staleDays = STALE_DAYS,
    concurrency = 4
  } = options;

  const report: RunReport = {
    firms: 0,
    firmsFailed: 0,
    fetched: 0,
    kept: 0,
    rejected: { 'missing-fields': 0, 'not-texas': 0, 'not-entry-level': 0 },
    sectorGuessed: 0,
    inserted: 0,
    updated: 0,
    deactivated: 0,
    matchesWritten: 0,
    strongMatches: 0,
    notified: 0,
    errors: [],
    ranAt: now
  };

  const firms = await store.listFirms();
  report.firms = firms.length;

  // Dedupe across firms as well as within one: two boards can carry the same
  // seat, and the id is what decides identity.
  const keep = new Map<string, Posting>();

  await inBatches(firms, concurrency, async (firm) => {
    let raw: RawJob[];
    try {
      raw = await fetcher(firm);
      await store.markFirmPolled(firm.id, { ok: true });
    } catch (error) {
      report.firmsFailed++;
      const message = error instanceof Error ? error.message : String(error);
      report.errors.push({ firm: firm.name, message });
      await store.markFirmPolled(firm.id, { ok: false, error: message });
      return;
    }

    report.fetched += raw.length;

    for (const job of raw) {
      const result = normalize(job, now);
      if (!result.ok) {
        report.rejected[result.reason]++;
        continue;
      }
      if (result.sectorGuessed) report.sectorGuessed++;
      if (!keep.has(result.posting.id)) keep.set(result.posting.id, result.posting);
    }
  });

  const postings = [...keep.values()];
  report.kept = postings.length;

  const { inserted, updated } = await store.upsertPostings(postings, now);
  report.inserted = inserted.length;
  report.updated = updated.length;

  report.deactivated = await store.deactivateStale(
    new Date(now.getTime() - staleDays * 86_400_000)
  );

  // Only new rows get scored: existing rows already have a match per profile,
  // and rescoring the whole table every two hours is wasted work.
  const fresh = postings.filter((posting) => inserted.includes(posting.id));
  if (fresh.length) {
    const profiles = await store.listProfiles();
    const matches: Match[] = [];
    const perProfile = new Map<string, Posting[]>();

    for (const profile of profiles) {
      for (const posting of fresh) {
        const scored = scoreMatch(profile, posting, now);
        matches.push({
          profileId: profile.id,
          postingId: posting.id,
          score: scored.score,
          note: scored.note,
          lines: scored.lines
        });
        if (scored.strong) {
          report.strongMatches++;
          const bucket = perProfile.get(profile.id) ?? [];
          bucket.push(posting);
          perProfile.set(profile.id, bucket);
        }
      }
    }

    if (matches.length) {
      await store.upsertMatches(matches);
      report.matchesWritten = matches.length;
    }

    if (notifier) {
      for (const profile of profiles) {
        const worth = filterForAlerts(profile, perProfile.get(profile.id) ?? []);
        if (!worth.length) continue;
        await notifier.notify(profile, worth);
        report.notified++;
      }
    }
  }

  return report;
}

/**
 * Respect the profile's alert preferences before waking anyone. Only strong
 * matches (score >= STRONG_MATCH) get this far; `internsOnly` narrows further.
 */
function filterForAlerts(profile: Profile, postings: Posting[]): Posting[] {
  const alerts = profile.alerts;
  if (alerts && !alerts.digest) return [];
  if (alerts?.internsOnly) return postings.filter((p) => p.kind === 'Internship');
  return postings;
}

async function defaultFetcher(firm: FirmRow): Promise<RawJob[]> {
  switch (firm.ats) {
    case 'greenhouse':
      return fetchGreenhouse(firm.name, firm.atsSlug);
    case 'lever':
      return fetchLever(firm.name, firm.atsSlug);
    // Workday and iCIMS need a per-tenant endpoint and an auth handshake;
    // the spec puts them after the first two are carrying real coverage.
    case 'workday':
    case 'icims':
      throw new Error(`${firm.ats} fetcher not implemented yet (firm: ${firm.name})`);
  }
}

async function inBatches<T>(
  items: T[],
  size: number,
  work: (item: T) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(work));
  }
}

export { STRONG_MATCH };
