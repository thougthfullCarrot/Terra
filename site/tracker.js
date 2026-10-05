// tracker.js — rules for the application tracker, kept free of the DOM so the
// backend's tests can run them. tracker-view.js draws it; account.js stores
// it in Supabase (tracked_jobs, migration 0008).

/** In the order a search moves through them. Must match the check in migration 0008. */
export const STAGES = ['Saved', 'Applied', 'Interviewing', 'Offer', 'Not selected'];
/** Stages that mean the member acted on the job, not just bookmarked it. */
export const ACTIVE_STAGES = ['Applied', 'Interviewing', 'Offer'];
export const NOTE_LIMIT = 2000;

const DAY = 24 * 60 * 60 * 1000;

/** The posting fields kept with a tracked job, so it still reads properly after it leaves the feed. */
export function jobSummary(job) {
  return {
    role: String(job.role ?? ''),
    firm: String(job.firm ?? ''),
    city: String(job.city ?? ''),
    kind: String(job.kind ?? ''),
    applyUrl: String(job.applyUrl ?? ''),
    deadline: job.deadline ?? null
  };
}

/** A tracked_jobs row from what the page holds. Unknown stages fall back to Saved; a bad date is dropped. */
export function trackedRow(jobId, { stage, note, followUp, job }) {
  const clean = String(note ?? '').trim().slice(0, NOTE_LIMIT);
  return {
    job_id: String(jobId),
    stage: STAGES.includes(stage) ? stage : 'Saved',
    note: clean || null,
    follow_up: isDate(followUp) ? followUp : null,
    job: job ? jobSummary(job) : {}
  };
}

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** Tracked jobs grouped by stage, each group newest change first. Every stage is present, empty or not. */
export function groupByStage(rows) {
  const groups = new Map(STAGES.map((stage) => [stage, []]));
  for (const row of rows) (groups.get(row.stage) ?? groups.get('Saved')).push(row);
  for (const list of groups.values()) list.sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
  return groups;
}

/** Today's date in Texas (America/Chicago) as YYYY-MM-DD, which is what a follow-up date means to the member. */
export function texasToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now);
}

/** "Follow up today", "Follow up in 3 days", "Follow-up 2 days overdue", or null without a date. */
export function followUpLabel(date, now = new Date()) {
  if (!isDate(date)) return null;
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${texasToday(now)}T00:00:00Z`)) / DAY);
  if (days === 0) return { text: 'Follow up today', due: true };
  if (days < 0) return { text: `Follow-up ${-days} ${days === -1 ? 'day' : 'days'} overdue`, due: true };
  if (days === 1) return { text: 'Follow up tomorrow', due: false };
  return { text: `Follow up in ${days} days`, due: false };
}

/** One line for the top of the tracker: "4 applied · 1 interviewing · 2 follow-ups due". */
export function trackerSummary(rows, now = new Date()) {
  if (!rows.length) return '';
  const count = (stage) => rows.filter((row) => row.stage === stage).length;
  const due = rows.filter((row) => followUpLabel(row.follow_up, now)?.due).length;
  const parts = [];
  for (const stage of STAGES) {
    const n = count(stage);
    if (n) parts.push(`${n} ${stage.toLowerCase()}`);
  }
  if (due) parts.push(`${due} ${due === 1 ? 'follow-up' : 'follow-ups'} due`);
  return parts.join(' · ');
}

/**
 * Jobs starred on this device before signing in (the open site's saved list),
 * as rows to add to the account. Only ids still in the feed come across, since
 * an id alone can't show what the job was, and nothing already tracked is touched.
 */
export function importRows(localIds, jobs, tracked) {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const rows = [];
  for (const id of localIds) {
    const job = byId.get(id);
    if (job && !tracked.has(id)) rows.push(trackedRow(id, { stage: 'Saved', job }));
  }
  return rows;
}
