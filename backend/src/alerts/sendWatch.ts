import { addDays, daysBetween, type HistoryDay } from './history.js';
import { unsubscribeUrl } from './unsubscribe.js';
import { renderWatchEmail, watchEvents, type WatchItem } from './watch.js';

/**
 * Sends watchlist digests (migration 0017), with the bookkeeping that keeps
 * an email from going out twice or being lost.
 *
 * For each member whose digest is due:
 *  1. Work out the changes since their last digest (watch.ts).
 *  2. Drop changes the send log already marks sent, or gave up on.
 *  3. Claim the rest in the log as pending, one attempt more, BEFORE sending.
 *     If the claim can't be written, nothing is sent to that member.
 *  4. Send. If the mail server refuses, the rows stay pending and the next
 *     run retries, up to MAX_ATTEMPTS, then they are marked failed.
 *  5. Mark them sent and record the digest day.
 *
 * A pending row from an earlier run means that run stopped after claiming:
 * the email may or may not have gone out. It is NOT assumed delivered. The
 * digest day only moves forward after a confirmed send, so the next run sees
 * the same changes and retries them (counting the attempt). That can repeat
 * an email in the rare case a run died right after the mail server took it;
 * the attempt limit bounds it. Losing a change silently is the worse failure.
 */

export const MAX_ATTEMPTS = 3;

export interface WatchRecipient {
  user_id: string;
  email: string;
  digest_frequency: 'daily' | 'weekly';
  last_day: string | null;
  items: WatchItem[] | null;
}

export interface SendRow {
  event_id: string;
  state: 'pending' | 'sent' | 'failed';
  attempts: number;
}

/** The database side, injected so tests can run without Supabase. Every method throws on failure. */
export interface WatchStore {
  /** History rows from `from` to `to` inclusive, oldest first. */
  history(from: string, to: string): Promise<HistoryDay[]>;
  sends(userId: string, eventIds: string[]): Promise<SendRow[]>;
  /** Upsert rows as pending with the given attempt counts. */
  claim(userId: string, rows: { event_id: string; attempts: number }[]): Promise<void>;
  markSent(userId: string, eventIds: string[]): Promise<void>;
  markFailed(userId: string, eventIds: string[], error: string, giveUp: boolean): Promise<void>;
  setDigestDay(userId: string, day: string): Promise<void>;
}

export interface Mailer {
  send(message: { to: string; subject: string; text: string; html: string; headers: Record<string, string> }): Promise<void>;
}

export interface WatchRunOptions {
  recipients: WatchRecipient[];
  store: WatchStore;
  /** Null for a dry run: work everything out, send and record nothing. */
  mailer: Mailer | null;
  today: string;
  siteUrl: string;
  linkSecret: string;
  /** Emails this run may still send (the daily cap shared with job alerts). */
  budget: number;
  log?: (line: string) => void;
}

export interface WatchRunSummary {
  due: number;
  sent: number;
  events: number;
  nothingNew: number;
  baseline: number;
  deferred: number;
  failed: number;
  gaveUp: number;
  unconfirmed: number;
}

/** Whether a member's digest goes out today. */
export function isDue(r: Pick<WatchRecipient, 'digest_frequency' | 'last_day'>, today: string): boolean {
  if (!r.last_day) return true;
  const gap = daysBetween(r.last_day, today);
  return r.digest_frequency === 'daily' ? gap >= 1 : gap >= 7;
}

/** The day changes are measured from: the last digest, or one period back for a first digest. */
export function baselineDay(r: Pick<WatchRecipient, 'digest_frequency' | 'last_day'>, today: string): string {
  return r.last_day ?? addDays(today, r.digest_frequency === 'daily' ? -1 : -7);
}

/**
 * The rows to compare: the newest row on or before the baseline day (or the
 * oldest row kept, when history starts later), then every row after it.
 */
export function comparisonDays(rows: HistoryDay[], baseline: string, today: string): HistoryDay[] {
  const upTo = rows.filter((r) => r.day <= today);
  if (!upTo.length) return [];
  let start = -1;
  for (let i = 0; i < upTo.length; i++) if (upTo[i]!.day <= baseline) start = i;
  if (start === -1) start = 0;
  const days = upTo.slice(start);
  // Comparing a day with itself finds nothing; it needs two different days.
  return days.length >= 2 ? days : [];
}

export async function runWatchDigests(options: WatchRunOptions): Promise<WatchRunSummary> {
  const { recipients, store, mailer, today, siteUrl, linkSecret, log = () => {} } = options;
  let budget = options.budget;
  const summary: WatchRunSummary = { due: 0, sent: 0, events: 0, nothingNew: 0, baseline: 0, deferred: 0, failed: 0, gaveUp: 0, unconfirmed: 0 };
  const historyCache = new Map<string, HistoryDay[]>();
  const historyFrom = async (from: string) => {
    if (!historyCache.has(from)) historyCache.set(from, await store.history(addDays(from, -7), today));
    return historyCache.get(from)!;
  };

  for (const r of recipients) {
    if (!r.items?.length || !isDue(r, today)) continue;
    summary.due++;
    const baseline = baselineDay(r, today);
    const days = comparisonDays(await historyFrom(baseline), baseline, today);
    if (!days.length) {
      // No earlier day to compare with yet: start counting from today.
      summary.baseline++;
      if (mailer) await store.setDigestDay(r.user_id, today).catch((e) => log(`Couldn't record a digest day: ${message(e)}`));
      continue;
    }
    const result = watchEvents(r.items, days);
    const ids = result.events.map((e) => e.id);
    const log_ = ids.length ? await store.sends(r.user_id, ids) : [];
    const known = new Map(log_.map((row) => [row.event_id, row]));
    const giveUp: string[] = [];
    const fresh = result.events.filter((e) => {
      const row = known.get(e.id);
      if (!row) return true;
      if (row.state !== 'pending') return false;
      if (row.attempts >= MAX_ATTEMPTS) {
        giveUp.push(e.id);
        return false;
      }
      return true;
    });
    if (giveUp.length && mailer) {
      summary.gaveUp += giveUp.length;
      await store.markFailed(r.user_id, giveUp, 'retry limit reached', true).catch((e) => log(`Couldn't mark failed rows: ${message(e)}`));
    }
    if (!fresh.length) {
      summary.nothingNew++;
      if (mailer) await store.setDigestDay(r.user_id, today).catch((e) => log(`Couldn't record a digest day: ${message(e)}`));
      continue;
    }
    if (budget <= 0) {
      summary.deferred++;
      continue;
    }

    const link = unsubscribeUrl(siteUrl, linkSecret, r.user_id, 'watch');
    const email = renderWatchEmail({ events: fresh, notes: result.notes }, { siteUrl, unsubscribeLink: link, frequency: r.digest_frequency });
    budget--;
    if (!mailer) {
      summary.sent++;
      summary.events += fresh.length;
      continue;
    }

    const claims = fresh.map((e) => ({ event_id: e.id, attempts: (known.get(e.id)?.attempts ?? 0) + 1 }));
    try {
      await store.claim(r.user_id, claims);
    } catch (e) {
      summary.failed++;
      log(`Skipped one digest: couldn't write the send log (${message(e)}).`);
      continue;
    }
    try {
      await mailer.send({
        to: r.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: { 'List-Unsubscribe': `<${link}>` }
      });
    } catch (e) {
      summary.failed++;
      const last = claims.every((c) => c.attempts >= MAX_ATTEMPTS);
      if (last) summary.gaveUp += claims.length;
      log(`One digest failed to send: ${message(e)}`);
      await store.markFailed(r.user_id, claims.map((c) => c.event_id), message(e).slice(0, 300), last).catch(() => {});
      continue;
    }
    summary.sent++;
    summary.events += fresh.length;
    try {
      await store.markSent(r.user_id, claims.map((c) => c.event_id));
    } catch (e) {
      // The mail server took it; the rows stay pending and the digest day still moves on, so the same changes are not rebuilt.
      summary.unconfirmed++;
      log(`Sent, but couldn't mark it sent: ${message(e)}`);
    }
    await store.setDigestDay(r.user_id, today).catch((e) => log(`Sent, but couldn't record the digest day: ${message(e)}`));
  }
  return summary;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
