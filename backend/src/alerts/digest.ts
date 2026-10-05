/**
 * Daily job alerts: which new jobs a member gets, and the email that carries them.
 *
 * Pure functions, so the rules are tested without a database or a mail
 * server; src/bin/send-alerts.ts does the reading and sending.
 */
import type { SitePosting } from '../site/snapshot.js';
import { scoreJobs, type SiteMatch } from '../site/browserMatch.js';

/** A member with alerts on, as alert_recipients() (migration 0007) returns them. */
export interface AlertRecipient {
  user_id: string;
  email: string;
  school: string | null;
  grad_year: number | null;
  home_city: string | null;
  sectors: string[] | null;
  relocation_open: boolean | null;
  resume_text: string | null;
  alert_cities: string[] | null;
  alert_kinds: string[] | null;
  alert_min_match: number | null;
}

/** A tracked_jobs row (migration 0008), as the sender reads it. */
export interface TrackedJob {
  user_id: string;
  job_id: string;
  stage: string;
  follow_up: string | null;
  reminded_on: string | null;
  job: { role?: string; firm?: string; city?: string; applyUrl?: string; deadline?: string | null };
}

export interface Reminder {
  row: TrackedJob;
  /** "Follow up today", "Follow-up 2 days overdue", "Deadline in 3 days". */
  why: string;
}

/** A saved job whose deadline is this close gets a nudge to apply. */
export const DEADLINE_DAYS = 3;

export interface AlertJob {
  job: SitePosting;
  match: SiteMatch | null;
}

/** Jobs posted longer ago than this are not news, even if this member hasn't been sent them. */
export const LOOKBACK_DAYS = 7;
/** Jobs listed in one email; the rest are counted with a link to the site. */
export const EMAIL_LIMIT = 15;

const DAY = 24 * 60 * 60 * 1000;

/**
 * The jobs to send one member today, best first: posted in the last week,
 * not sent to them before, in the cities and role types they picked, and,
 * when they asked for good matches only and have a resume, scoring at least
 * their threshold.
 */
export function pickJobs(
  recipient: AlertRecipient,
  jobs: SitePosting[],
  alreadySent: ReadonlySet<string>,
  now = new Date()
): AlertJob[] {
  const cities = recipient.alert_cities ?? [];
  const kinds = recipient.alert_kinds ?? [];
  const since = now.getTime() - LOOKBACK_DAYS * DAY;

  const fresh = jobs.filter(
    (job) =>
      !alreadySent.has(job.id) &&
      Date.parse(job.postedAt) >= since &&
      (cities.length === 0 || cities.includes(job.city)) &&
      (kinds.length === 0 || kinds.includes(job.kind))
  );

  const scores = scoreJobs(
    {
      school: recipient.school,
      gradYear: recipient.grad_year,
      homeCity: recipient.home_city,
      sectors: recipient.sectors ?? [],
      relocationOpen: Boolean(recipient.relocation_open),
      resumeText: recipient.resume_text
    },
    fresh,
    now
  );
  // Without a resume every score would be the same neutral default, so the threshold can't apply.
  const threshold = scores.size ? recipient.alert_min_match ?? 0 : 0;

  return fresh
    .map((job) => ({ job, match: scores.get(job.id) ?? null }))
    .filter(({ match }) => !threshold || (match?.score ?? 0) >= threshold)
    .sort(
      (a, b) =>
        (b.match?.score ?? 0) - (a.match?.score ?? 0) ||
        b.job.postedAt.localeCompare(a.job.postedAt) ||
        a.job.id.localeCompare(b.job.id)
    );
}

/**
 * What to remind a member about this morning, given today's date in Texas
 * (YYYY-MM-DD): follow-ups that have come due, and saved jobs whose deadline
 * is within DEADLINE_DAYS. Each is sent once per date it fell due on, so an
 * overdue follow-up doesn't nag every day; moving the date resets it.
 */
export function dueReminders(rows: TrackedJob[], today: string): Reminder[] {
  const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
  const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const notYet = (row: TrackedJob, since: string) => !row.reminded_on || row.reminded_on < since;
  const out: Reminder[] = [];

  for (const row of rows) {
    if (row.stage === 'Offer' || row.stage === 'Not selected') continue;
    if (isDate(row.follow_up) && row.follow_up <= today && notYet(row, row.follow_up)) {
      const late = days(row.follow_up, today);
      out.push({ row, why: late === 0 ? 'Follow up today' : `Follow-up ${late} ${late === 1 ? 'day' : 'days'} overdue` });
      continue;
    }
    const deadline = row.job?.deadline;
    if (row.stage === 'Saved' && isDate(deadline) && deadline >= today) {
      const left = days(today, deadline);
      const window = new Date(Date.parse(`${deadline}T00:00:00Z`) - DEADLINE_DAYS * DAY).toISOString().slice(0, 10);
      if (left <= DEADLINE_DAYS && notYet(row, window)) {
        out.push({ row, why: left === 0 ? 'Applications close today' : `Applications close in ${left} ${left === 1 ? 'day' : 'days'}` });
      }
    }
  }
  return out;
}

export interface AlertEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * The morning email for one member: tracker reminders first, then new jobs.
 * At least one of `picked` (pickJobs' output) and `reminders` must be non-empty.
 */
export function renderEmail(picked: AlertJob[], siteUrl: string, reminders: Reminder[] = []): AlertEmail {
  const shown = picked.slice(0, EMAIL_LIMIT);
  const more = picked.length - shown.length;
  const first = shown[0]?.job;
  const nudge = reminders[0]?.row.job;
  const subject = first
    ? picked.length === 1
      ? `New on Terra: ${first.role} at ${first.firm}`
      : `${picked.length} new Texas CRE jobs for you, including ${first.role} at ${first.firm}`
    : reminders.length === 1
      ? `Reminder: ${nudge?.role ?? 'a job'} at ${nudge?.firm ?? 'a firm'}`
      : `${reminders.length} reminders from your Terra tracker`;
  const site = siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`;
  const trackerLink = `${site}#tracker`;
  const reminderLine = ({ row, why }: Reminder) => `${why}: ${row.job.role ?? 'Saved job'} — ${row.job.firm ?? ''} (${row.stage})`;
  const jobLink = (job: SitePosting) => `${site}?job=${encodeURIComponent(job.id)}`;
  // Apply links come from the boards; anything that isn't a web link opens the job on Terra instead.
  const applyLink = (job: SitePosting) => (/^https?:\/\//i.test(job.applyUrl) ? job.applyUrl : jobLink(job));
  const line = ({ job, match }: AlertJob) =>
    [job.city, job.kind, job.pay, match ? `${match.score}% match` : null].filter(Boolean).join(' · ');

  const text = [
    ...(reminders.length ? ['From your tracker:', ...reminders.map(reminderLine), `Open your tracker: ${trackerLink}`, ''] : []),
    ...(picked.length
      ? [picked.length === 1 ? 'A new job fits what you asked for:' : `${picked.length} new jobs fit what you asked for:`, '']
      : []),
    ...shown.flatMap((item) => [
      `${item.job.role} — ${item.job.firm}`,
      line(item),
      `Apply: ${applyLink(item.job)}`,
      ''
    ]),
    ...(more > 0 ? [`And ${more} more on Terra: ${site}`, ''] : []),
    `You get this email because job alerts are on in your Terra profile. Change or turn them off there: ${site}`
  ].join('\n');

  const card = (item: AlertJob) => `
    <tr><td style="padding:14px 0;border-bottom:1px solid #e4e0d8">
      ${item.match && item.match.strong ? '<div style="font:700 11px/1.4 Arial,sans-serif;letter-spacing:.06em;color:#1f6f50">BEST MATCH</div>' : ''}
      <a href="${escapeHtml(jobLink(item.job))}" style="font:600 16px/1.35 Arial,sans-serif;color:#15171a;text-decoration:none">${escapeHtml(item.job.role)}</a>
      <div style="font:14px/1.4 Arial,sans-serif;color:#4a4f55">${escapeHtml(item.job.firm)}</div>
      <div style="font:13px/1.4 Arial,sans-serif;color:#6b7076;margin-top:2px">${escapeHtml(line(item))}</div>
      <a href="${escapeHtml(applyLink(item.job))}" style="display:inline-block;margin-top:8px;font:600 13px/1 Arial,sans-serif;color:#ffffff;background:#1f6f50;padding:8px 12px;border-radius:6px;text-decoration:none">Apply</a>
    </td></tr>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#f4f2ee">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;padding:20px 24px">
      <tr><td style="font:700 12px/1 Arial,sans-serif;letter-spacing:.08em;color:#6b7076;padding-bottom:6px">TERRA · JOB ALERT</td></tr>
      ${
        reminders.length
          ? `<tr><td style="font:600 18px/1.3 Arial,sans-serif;color:#15171a;padding:4px 0">From your tracker</td></tr>
      ${reminders
        .map(
          ({ row, why }) => `<tr><td style="padding:8px 0;border-bottom:1px solid #e4e0d8;font:14px/1.45 Arial,sans-serif;color:#15171a">
        <div style="font:700 12px/1.4 Arial,sans-serif;color:#b8442e">${escapeHtml(why)}</div>
        <div><strong>${escapeHtml(row.job.role ?? 'Saved job')}</strong> · ${escapeHtml(row.job.firm ?? '')} <span style="color:#6b7076">(${escapeHtml(row.stage)})</span></div>
      </td></tr>`
        )
        .join('')}
      <tr><td style="padding:10px 0 18px;font:14px/1.4 Arial,sans-serif"><a href="${escapeHtml(trackerLink)}" style="color:#1f6f50">Open your tracker</a></td></tr>`
          : ''
      }
      ${
        picked.length
          ? `<tr><td style="font:600 20px/1.3 Arial,sans-serif;color:#15171a;padding-bottom:4px">${
              picked.length === 1 ? 'A new job fits what you asked for' : `${picked.length} new jobs fit what you asked for`
            }</td></tr>`
          : ''
      }
      ${shown.map(card).join('')}
      ${
        more > 0
          ? `<tr><td style="padding:14px 0;font:14px/1.4 Arial,sans-serif"><a href="${escapeHtml(site)}" style="color:#1f6f50">See ${more} more on Terra</a></td></tr>`
          : ''
      }
      <tr><td style="padding-top:16px;font:12px/1.5 Arial,sans-serif;color:#6b7076">You get this email because job alerts are on in your Terra profile. <a href="${escapeHtml(site)}" style="color:#6b7076">Change or turn them off</a> under Profile.</td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  return { subject, text, html };
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
