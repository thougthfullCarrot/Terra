/**
 * Send today's job alert emails.
 *
 *   npm run send:alerts              # send
 *   npm run send:alerts -- --dry-run # work out who would get what, send nothing
 *
 * Reads the feed the Website workflow stored in Supabase (site_snapshots
 * 'current'), asks alert_recipients() (migration 0007) for the members with
 * alerts on, and emails each one the new jobs that fit them, plus reminders
 * from their tracker (migration 0008: follow-ups due, saved jobs about to
 * close), through the same Gmail sender the sign-in codes use. Every job sent
 * is logged in alert_sends and every reminder in tracked_jobs.reminded_on, so
 * nobody gets the same thing twice.
 *
 * Needs SUPABASE_URL and SERVICE_ROLE_KEY, plus SMTP_USER and SMTP_PASSWORD
 * unless it's a dry run. Optional: SMTP_HOST (smtp.gmail.com), SMTP_PORT
 * (587), SMTP_SENDER_NAME (Terra), SITE_URL, MAX_EMAILS.
 *
 * The workflow log is public, so it prints counts only, never an address.
 */
import { appendFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import {
  LOOKBACK_DAYS,
  dueReminders,
  pickJobs,
  renderEmail,
  type AlertRecipient,
  type TrackedJob
} from '../alerts/digest.js';
import type { SiteSnapshot } from '../site/snapshot.js';

const DAY = 24 * 60 * 60 * 1000;
const dryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true';
const siteUrl = process.env.SITE_URL || 'https://thougthfullcarrot.github.io/Terra/';
/**
 * A Gmail account sends about 500 emails a day, and the sign-in codes share
 * that allowance, so alerts stop well short of it. Whoever is left over gets
 * their jobs the next day: nothing is logged as sent until it is.
 */
const maxEmails = Number(process.env.MAX_EMAILS || 300);

const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const serviceKey = process.env.SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('Set SUPABASE_URL and SERVICE_ROLE_KEY.');
const smtpUser = process.env.SMTP_USER;
const smtpPassword = process.env.SMTP_PASSWORD;
if (!dryRun && (!smtpUser || !smtpPassword)) throw new Error('Set SMTP_USER and SMTP_PASSWORD, or pass --dry-run.');

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const snapshotRow = await db.from('site_snapshots').select('data').eq('id', 'current').maybeSingle();
if (snapshotRow.error) throw new Error(`Couldn't read the feed: ${snapshotRow.error.message}`);
const snapshot = snapshotRow.data?.data as SiteSnapshot | undefined;
if (!snapshot?.jobs?.length) throw new Error('The feed in Supabase is empty; the Website workflow has not stored one yet.');

const recipientsResult = await db.rpc('alert_recipients');
if (recipientsResult.error) throw new Error(`Couldn't list alert recipients: ${recipientsResult.error.message}`);
const recipients = (recipientsResult.data ?? []) as AlertRecipient[];

// Only the last LOOKBACK_DAYS matter: anything older can't be picked again anyway.
const sentByUser = new Map<string, Set<string>>();
if (recipients.length) {
  const since = new Date(Date.now() - (LOOKBACK_DAYS + 1) * DAY).toISOString();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('alert_sends')
      .select('user_id, job_id')
      .gte('sent_at', since)
      .range(from, from + 999);
    if (error) throw new Error(`Couldn't read the alert log: ${error.message}`);
    for (const row of data ?? []) {
      let set = sentByUser.get(row.user_id);
      if (!set) sentByUser.set(row.user_id, (set = new Set()));
      set.add(row.job_id);
    }
    if (!data || data.length < 1000) break;
  }
}

// Tracker rows for reminders. Before migration 0008 the table doesn't exist; alerts still go out.
const trackedByUser = new Map<string, TrackedJob[]>();
if (recipients.length) {
  const wanted = new Set(recipients.map((r) => r.user_id));
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('tracked_jobs')
      .select('user_id, job_id, stage, follow_up, reminded_on, job')
      .in('stage', ['Saved', 'Applied', 'Interviewing'])
      .range(from, from + 999);
    if (error) {
      console.log(`No tracker reminders: ${error.message}`);
      break;
    }
    for (const row of (data ?? []) as TrackedJob[]) {
      if (!wanted.has(row.user_id)) continue;
      const list = trackedByUser.get(row.user_id) ?? [];
      list.push(row);
      trackedByUser.set(row.user_id, list);
    }
    if (!data || data.length < 1000) break;
  }
}
/** Follow-up dates are Texas calendar days. */
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());

const transport = dryRun
  ? null
  : nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: { user: smtpUser!, pass: smtpPassword! }
    });
const from = { name: process.env.SMTP_SENDER_NAME || 'Terra', address: smtpUser ?? 'alerts@example.com' };

let sent = 0;
let nothingNew = 0;
let failed = 0;
let deferred = 0;
let jobsSent = 0;
let remindersSent = 0;

for (const recipient of recipients) {
  const picked = pickJobs(recipient, snapshot.jobs, sentByUser.get(recipient.user_id) ?? new Set());
  const reminders = dueReminders(trackedByUser.get(recipient.user_id) ?? [], today);
  if (!picked.length && !reminders.length) {
    nothingNew++;
    continue;
  }
  if (sent >= maxEmails) {
    deferred++;
    continue;
  }

  const email = renderEmail(picked, siteUrl, reminders);
  if (transport) {
    try {
      await transport.sendMail({ from, to: recipient.email, subject: email.subject, text: email.text, html: email.html });
    } catch (error) {
      failed++;
      console.error(`One alert failed to send: ${error instanceof Error ? error.message : error}`);
      continue;
    }
    if (picked.length) {
      const log = await db
        .from('alert_sends')
        .upsert(picked.map(({ job }) => ({ user_id: recipient.user_id, job_id: job.id })), { onConflict: 'user_id,job_id' });
      if (log.error) console.error(`Sent, but couldn't log it: ${log.error.message}`);
    }
    if (reminders.length) {
      const marked = await db
        .from('tracked_jobs')
        .update({ reminded_on: today })
        .eq('user_id', recipient.user_id)
        .in('job_id', reminders.map(({ row }) => row.job_id));
      if (marked.error) console.error(`Sent, but couldn't mark the reminders: ${marked.error.message}`);
    }
  }
  sent++;
  jobsSent += picked.length;
  remindersSent += reminders.length;
}

const summary = [
  `## Job alerts${dryRun ? ' (dry run, nothing sent)' : ''}`,
  '',
  `- Feed: ${snapshot.jobs.length} jobs, built ${snapshot.generatedAt}`,
  `- Members with alerts on: ${recipients.length}`,
  `- Emails ${dryRun ? 'that would go out' : 'sent'}: ${sent} (${jobsSent} jobs, ${remindersSent} tracker reminders)`,
  `- Nothing new for: ${nothingNew}`,
  ...(deferred ? [`- Held for tomorrow (daily cap of ${maxEmails}): ${deferred}`] : []),
  ...(failed ? [`- Failed: ${failed}`] : [])
].join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
transport?.close();
// Every send failing means the sender is broken (a revoked app password), not one bad address.
if (failed && sent === 0) process.exit(1);
