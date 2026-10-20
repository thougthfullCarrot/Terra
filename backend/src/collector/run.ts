import type { Match, Posting, Profile, RawJob } from '../types.js';
import type { FirmRow, Store } from '../db/store.js';
import { emptyRejected, forFirm, normalize, type RejectReason, type ReviewReason } from './normalize.js';
import { fetchAshby } from './sources/ashby.js';
import { fetchGreenhouse } from './sources/greenhouse.js';
import { fetchSmartRecruiters } from './sources/smartrecruiters.js';
import { fetchLever } from './sources/lever.js';
import { fetchWorkday } from './sources/workday.js';
import { fetchIcims } from './sources/icims.js';
import { fetchWorkable } from './sources/workable.js';
import { IncompleteBoardError } from './sources/incomplete.js';
import { postingId } from './id.js';
import { significant } from './nameMatch.js';
import { scoreMatch } from '../matching/score.js';
import { STRONG_MATCH } from '../types.js';

/** Rejected postings kept per reason for the run log. */
const SAMPLES_PER_REASON = 25;

/** How long a posting can go unseen on its board before it stops being active. */
export const STALE_DAYS = 14;

export type Fetcher = (firm: FirmRow) => Promise<RawJob[]>;

/**
 * A source that answers a search rather than one firm's board (Adzuna). Its
 * postings fill gaps; a seat a firm board already listed is dropped in favour
 * of the board's copy, which links straight to the firm.
 */
export interface Aggregator {
  name: string;
  fetch: () => Promise<RawJob[]>;
}

export interface AggregatorReport {
  name: string;
  fetched: number;
  kept: number;
  /** Already listed on a firm board this pass. */
  duplicates: number;
  rejected: number;
  /** Rejections by reason; 'unclassified' is a search hit with no sector word at all. */
  rejectedBy?: Partial<Record<RejectReason | 'unclassified', number>>;
  /** Held for review instead of published. */
  review?: number;
  error?: string;
}

/** What one source contributed, so a thin feed can be traced to the collector behind it. */
export interface SourceCounts {
  fetched: number;
  kept: number;
  review: number;
  rejected: Record<RejectReason, number>;
}

/**
 * How one firm's board answered this pass. 'incomplete' means the board was
 * read only in part (a later page or some details failed): its jobs that were
 * read publish, and the ones not read are unknown rather than closed.
 */
export interface BoardStatus {
  firm: string;
  ats: string;
  status: 'ok' | 'incomplete' | 'failed';
  fetched: number;
  kept: number;
  review: number;
  rejected: Record<RejectReason, number>;
  /** Ids of the postings this board published this pass. */
  ids: string[];
  error?: string;
}

/** A posting held back for a person to check, with the reason it was held. */
export interface ReviewItem {
  posting: Posting;
  reason: ReviewReason;
  /** greenhouse, workday, adzuna, usajobs... */
  source: string;
}

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
  /** Search sources run after the boards, so board postings win on overlap. */
  aggregators?: Aggregator[];
}

export interface RunReport {
  firms: number;
  firmsFailed: number;
  fetched: number;
  kept: number;
  rejected: Record<RejectReason, number>;
  /** Held for review, not published (no stated years, no entry-level signal). */
  reviewed: number;
  review: ReviewItem[];
  /** Per ATS or aggregator. */
  bySource: Record<string, SourceCounts>;
  /** Per firm board, in firm-list order. */
  boards: BoardStatus[];
  /** Boards read only in part this pass (counted in neither firmsFailed nor as clean). */
  firmsIncomplete: number;
  /** Two openings with the same title and city told apart by the board's own job id. */
  distinctOpenings: number;
  /** Published postings by kind. */
  kinds: { Internship: number; 'Entry-level': number };
  /** Firms whose board answered with at least one published posting. */
  firmsWithOpenings: number;
  /** A few rejected postings per reason, so the filters can be spot-checked in the run log. */
  rejectedSamples: Partial<Record<RejectReason, { role: string; firm: string; location: string }[]>>;
  sectorGuessed: number;
  inserted: number;
  updated: number;
  deactivated: number;
  matchesWritten: number;
  strongMatches: number;
  notified: number;
  errors: { firm: string; message: string }[];
  aggregators: AggregatorReport[];
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
    fetcher = fetchBoard,
    notifier,
    now = new Date(),
    staleDays = STALE_DAYS,
    concurrency = 4,
    aggregators = []
  } = options;

  const report: RunReport = {
    firms: 0,
    firmsFailed: 0,
    fetched: 0,
    kept: 0,
    rejected: emptyRejected(),
    reviewed: 0,
    review: [],
    bySource: {},
    boards: [],
    firmsIncomplete: 0,
    distinctOpenings: 0,
    kinds: { Internship: 0, 'Entry-level': 0 },
    firmsWithOpenings: 0,
    rejectedSamples: {},
    sectorGuessed: 0,
    inserted: 0,
    updated: 0,
    deactivated: 0,
    matchesWritten: 0,
    strongMatches: 0,
    notified: 0,
    errors: [],
    aggregators: [],
    ranAt: now
  };

  const firms = await store.listFirms();
  report.firms = firms.length;

  // Dedupe across firms as well as within one: two boards can carry the same
  // seat, and the id is what decides identity.
  const keep = new Map<string, Posting>();
  const held = new Map<string, ReviewItem>();
  const firmsWithOpenings = new Set<FirmRow['id']>();

  // Which board and opening each kept id came from, so a second opening with
  // the same title and city on the same board is kept as its own posting.
  const owners = new Map<string, { firm: FirmRow['id']; sourceId?: string }>();
  const statuses = new Map<FirmRow['id'], BoardStatus>();

  await inBatches(firms, concurrency, async (firm) => {
    const status: BoardStatus = { firm: firm.name, ats: firm.ats, status: 'ok', fetched: 0, kept: 0, review: 0, rejected: emptyRejected(), ids: [] };
    statuses.set(firm.id, status);
    let raw: RawJob[];
    try {
      raw = await fetcher(firm);
      raw = forFirm(firm, raw);
      await store.markFirmPolled(firm.id, { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.errors.push({ firm: firm.name, message });
      status.error = message;
      if (!(error instanceof IncompleteBoardError)) {
        report.firmsFailed++;
        status.status = 'failed';
        await store.markFirmPolled(firm.id, { ok: false, error: message });
        return;
      }
      report.firmsIncomplete++;
      status.status = 'incomplete';
      raw = forFirm(firm, error.jobs);
      await store.markFirmPolled(firm.id, { ok: true, error: message });
    }

    report.fetched += raw.length;
    status.fetched = raw.length;
    const counts = sourceCounts(report, firm.ats);
    counts.fetched += raw.length;

    for (const job of raw) {
      const result = normalize(job, now);
      if (!result.ok) {
        if (result.reason === 'needs-review') {
          counts.review++;
          status.review++;
          if (!held.has(result.posting.id)) held.set(result.posting.id, { posting: result.posting, reason: result.review, source: firm.ats });
          continue;
        }
        report.rejected[result.reason]++;
        counts.rejected[result.reason]++;
        status.rejected[result.reason]++;
        const samples = (report.rejectedSamples[result.reason] ??= []);
        if (samples.length < SAMPLES_PER_REASON) samples.push({ role: job.title, firm: job.firm, location: job.location });
        continue;
      }
      if (result.sectorGuessed) report.sectorGuessed++;
      counts.kept++;
      status.kept++;
      firmsWithOpenings.add(firm.id);
      let posting = result.posting;
      const owner = owners.get(posting.id);
      // Same board, same title and city, different job ids: two openings
      // (two Leasing Analyst seats in Dallas), not one listed twice. The first
      // keeps the plain id, so existing ids do not change.
      if (owner && owner.firm === firm.id && posting.sourceId && owner.sourceId && owner.sourceId !== posting.sourceId) {
        posting = { ...posting, id: postingId(posting.firm, `${posting.role} #${posting.sourceId}`, posting.city) };
        report.distinctOpenings++;
      }
      if (!keep.has(posting.id)) {
        keep.set(posting.id, posting);
        owners.set(posting.id, { firm: firm.id, sourceId: posting.sourceId });
      }
      if (!status.ids.includes(posting.id)) status.ids.push(posting.id);
    }
  });
  report.boards = firms.map((firm) => statuses.get(firm.id)!).filter(Boolean);
  report.firmsWithOpenings = firmsWithOpenings.size;

  for (const aggregator of aggregators) {
    const result = await collectAggregator(aggregator, keep, held, now);
    report.aggregators.push(result);
    const counts = sourceCounts(report, aggregator.name);
    counts.fetched += result.fetched;
    counts.kept += result.kept;
    counts.review += result.review ?? 0;
    for (const [reason, n] of Object.entries(result.rejectedBy ?? {})) {
      // A search hit with no sector word is off-topic as far as the totals go.
      const key = (reason === 'unclassified' ? 'off-topic' : reason) as RejectReason;
      counts.rejected[key] += n;
    }
  }

  const postings = [...keep.values()];
  report.kept = postings.length;
  for (const posting of postings) report.kinds[posting.kind]++;
  // A seat both published and held (two boards, two descriptions) is published.
  report.review = [...held.values()].filter((item) => !keep.has(item.posting.id));
  report.reviewed = report.review.length;

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

/**
 * Pull one aggregator into `keep`. A failure is recorded and swallowed: the
 * boards are the primary source, and an Adzuna outage must not blank the feed.
 */
async function collectAggregator(
  aggregator: Aggregator,
  keep: Map<string, Posting>,
  held: Map<string, ReviewItem>,
  now: Date
): Promise<AggregatorReport> {
  const result: AggregatorReport = { name: aggregator.name, fetched: 0, kept: 0, duplicates: 0, rejected: 0, rejectedBy: {}, review: 0 };
  const reject = (reason: RejectReason | 'unclassified') => {
    result.rejected++;
    result.rejectedBy![reason] = (result.rejectedBy![reason] ?? 0) + 1;
  };

  let raw: RawJob[];
  try {
    raw = await aggregator.fetch();
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }

  result.fetched = raw.length;
  const boardPostings = [...keep.values()];

  for (const job of raw) {
    const normalized = normalize(job, now);
    if (!normalized.ok && normalized.reason !== 'needs-review') {
      reject(normalized.reason);
      continue;
    }
    // A search source has no firm list to vouch for it, so a posting with no
    // sector keyword at all is more likely off-topic than unclassified.
    if (normalized.sectorGuessed) {
      reject('unclassified');
      continue;
    }
    const posting = normalized.posting;
    if (!normalized.ok) {
      if (!keep.has(posting.id) && !boardPostings.some((board) => sameSeat(board, posting))) {
        result.review!++;
        if (!held.has(posting.id)) held.set(posting.id, { posting, reason: normalized.review, source: aggregator.name });
      } else {
        result.duplicates++;
      }
      continue;
    }
    if (keep.has(posting.id) || boardPostings.some((board) => sameSeat(board, posting))) {
      result.duplicates++;
      continue;
    }
    keep.set(posting.id, posting);
    result.kept++;
  }

  return result;
}

/**
 * Aggregators rename firms ('CBRE' vs 'CBRE Group, Inc.'), so the posting id,
 * which hashes the firm name, misses them. Same city and same title, plus one
 * firm name's distinctive words all appearing in the other's, is the same seat.
 * That is looser than namesMatch() on purpose: the matching title and city
 * already carry most of the evidence.
 */
function sameSeat(board: Posting, other: Posting): boolean {
  if (board.city !== other.city) return false;
  if (canonicalRole(board.role) !== canonicalRole(other.role)) return false;
  const a = significant(board.firm);
  const b = significant(other.firm);
  if (!a.size || !b.size) return false;
  return [...a].every((word) => b.has(word)) || [...b].every((word) => a.has(word));
}

function canonicalRole(role: string): string {
  return role.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function sourceCounts(report: RunReport, source: string): SourceCounts {
  return (report.bySource[source] ??= { fetched: 0, kept: 0, review: 0, rejected: emptyRejected() });
}

/** Read one firm's board with the reader for its ATS. */
export async function fetchBoard(firm: FirmRow): Promise<RawJob[]> {
  switch (firm.ats) {
    case 'greenhouse':
      return fetchGreenhouse(firm.name, firm.atsSlug);
    case 'lever':
      return fetchLever(firm.name, firm.atsSlug);
    case 'workday':
      return fetchWorkday(firm.name, firm.atsHost, firm.atsSlug);
    case 'icims':
      return fetchIcims(firm.name, firm.atsHost, firm.atsSlug);
    case 'workable':
      return fetchWorkable(firm.name, firm.atsSlug);
    case 'ashby':
      return fetchAshby(firm.name, firm.atsSlug);
    case 'smartrecruiters':
      return fetchSmartRecruiters(firm.name, firm.atsSlug);
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
