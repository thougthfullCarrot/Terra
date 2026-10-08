// tracker-view.js — the Tracker section: every job a member saved or applied
// to, grouped by stage, with a note and a follow-up date. The rules live in
// tracker.js. account.js hands over a store backed by Supabase (tracked_jobs);
// without one (the open site, or before migration 0008) the section stays
// hidden and the bookmark falls back to this device's saved list.
import { STAGES, followUpLabel, groupByStage, texasToday, trackedRow, trackerSummary } from './tracker.js';
import { deadlineLabel, initials, safeUrl } from './feed.js';
import { showSection } from './markets-view.js';

const $ = (id) => document.getElementById(id);

let store = null;
/** job id -> tracked_jobs row */
let rows = new Map();
let hooks = { toast: () => {}, openJob: () => false, changed: () => {} };
let bound = false;

/** app.js passes its toast, a way to open a job's details, and what to redraw when the tracker changes. */
export function startTracker(next) {
  hooks = { ...hooks, ...next };
  if (bound) return;
  bound = true;
  window.addEventListener('hashchange', draw);
}

/**
 * Turn the tracker on with a store ({ list, save, remove }), or off with null.
 * Resolves true once the member's tracked jobs are loaded.
 */
export async function setTrackerStore(next) {
  store = null;
  rows = new Map();
  $('tab-tracker').hidden = true;
  if (!next) {
    showSection();
    return false;
  }
  try {
    const list = await next.list();
    store = next;
    rows = new Map(list.map((row) => [row.job_id, row]));
  } catch (error) {
    // Most likely migration 0008 hasn't run yet; the device-only saved list still works.
    console.warn('Tracker unavailable:', error);
    return false;
  }
  $('tab-tracker').hidden = false;
  // A #tracker link opened before sign-in can land on the tracker now.
  await showSection();
  draw();
  return true;
}

export function trackerOn() {
  return Boolean(store);
}

export function trackedIds() {
  return new Set(rows.keys());
}

/** Every tracked_jobs row, for the jobs page's follow-ups count. */
export function trackedRows() {
  return [...rows.values()];
}

export function stageOf(id) {
  return rows.get(id)?.stage ?? null;
}

/**
 * Add or change a tracked job. `change` holds any of stage, note, followUp.
 * A note is saved without redrawing, so typing in the next box isn't interrupted.
 */
export async function track(job, change, { redraw = true } = {}) {
  const current = rows.get(job.id);
  const row = trackedRow(job.id, {
    stage: change.stage ?? current?.stage ?? 'Saved',
    note: 'note' in change ? change.note : current?.note,
    followUp: 'followUp' in change ? change.followUp : current?.follow_up,
    // A posting still in the feed refreshes the summary; one that has left keeps what was saved.
    job: job.role ? job : null
  });
  if (!job.role && current) row.job = current.job;
  const previous = current;
  rows.set(job.id, { ...current, ...row, updated_at: new Date().toISOString() });
  hooks.changed();
  if (redraw) draw();
  try {
    const saved = await store.save(row);
    if (saved) rows.set(job.id, saved);
    return true;
  } catch (error) {
    if (previous) rows.set(job.id, previous);
    else rows.delete(job.id);
    hooks.changed();
    draw();
    hooks.toast(`Couldn't save that. ${error instanceof Error ? error.message : ''}`.trim());
    return false;
  }
}

export async function untrack(id) {
  const previous = rows.get(id);
  if (!previous) return true;
  rows.delete(id);
  hooks.changed();
  draw();
  try {
    await store.remove(id);
    return true;
  } catch (error) {
    rows.set(id, previous);
    hooks.changed();
    draw();
    hooks.toast(`Couldn't remove that. ${error instanceof Error ? error.message : ''}`.trim());
    return false;
  }
}

/** Add several rows at once (jobs saved on this device before signing in). */
export async function importTracked(list) {
  if (!store || !list.length) return 0;
  try {
    const saved = await store.saveMany(list);
    for (const row of saved) rows.set(row.job_id, row);
    hooks.changed();
    draw();
    return saved.length;
  } catch (error) {
    console.warn("Couldn't bring device-saved jobs into the tracker:", error);
    return 0;
  }
}

/** What an empty column says, so the board reads as a path. */
const EMPTY_HINTS = {
  Saved: 'Bookmark a job and it lands here.',
  Applied: 'Move a job here once you apply.',
  Interviewing: 'Move a job here when a firm asks to talk.',
  Offer: 'Move a job here when an offer comes in.',
  'Not selected': "Jobs that didn't work out go here. Keep the notes for next time."
};

const DAY = 24 * 60 * 60 * 1000;
const SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Whole days from today (Texas) to a YYYY-MM-DD date. */
function daysTo(date, now) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${texasToday(now)}T00:00:00Z`)) / DAY);
}

function draw() {
  const view = $('tracker-view');
  if (view.hidden || !store) return;
  const now = new Date();
  const list = [...rows.values()];
  $('t-summary').textContent = trackerSummary(list, now) || 'Your applications, in one place.';

  if (!list.length) {
    const empty = el('div', 'state', 'Nothing tracked yet. Bookmark a job, or set its stage from the job details, and it shows up here.');
    $('t-body').replaceChildren(empty);
    return;
  }

  const board = el('div', 'board');
  for (const [stage, items] of groupByStage(list)) {
    const column = el('section', 'board-col');
    column.setAttribute('aria-label', `${stage}, ${items.length}`);
    const head = el('h3', 'board-col-head', stage);
    head.append(el('span', 'chip-count', String(items.length)));
    column.append(head);
    if (items.length) column.append(...items.map((row) => item(row, now)));
    else column.append(el('p', 'board-empty', EMPTY_HINTS[stage] ?? ''));
    board.append(column);
  }
  $('t-body').replaceChildren(...[week(list, now), board].filter(Boolean));
}

/**
 * Follow-ups and closing dates in the next seven days (and any overdue
 * follow-up), soonest first. Nothing when the week is clear.
 */
function week(list, now) {
  const due = [];
  for (const row of list) {
    const job = row.job ?? {};
    const follow = daysTo(row.follow_up, now);
    if (follow != null && follow <= 7) due.push({ days: follow, kind: 'follow', row, job });
    const closes = daysTo(job.deadline, now);
    if (closes != null && closes >= 0 && closes <= 7 && ['Saved', 'Applied'].includes(row.stage)) due.push({ days: closes, kind: 'closes', row, job });
  }
  if (!due.length) return null;
  due.sort((a, b) => a.days - b.days);
  const box = el('section', 'card week');
  box.setAttribute('aria-labelledby', 't-week-title');
  const head = el('div', 'week-head');
  const title = el('h3', 'group-title', 'This week');
  title.id = 't-week-title';
  head.append(title, el('span', 'week-note', 'Follow-ups and closing dates in the next 7 days'));
  const items = el('ul', 'week-list');
  for (const { days, kind, row, job } of due) {
    const li = el('li');
    const when = days < 0 ? `${-days}d overdue` : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : SHORT.format(new Date(`${kind === 'follow' ? row.follow_up : job.deadline}T00:00:00Z`));
    li.append(el('span', `due ${days <= 1 ? 'soon' : 'later'}`, when));
    const text = el('span');
    if (kind === 'follow') text.append('Follow up with ', el('b', '', job.firm || 'the firm'), ` on ${job.role || 'this role'}`);
    else text.append(el('b', '', job.firm || 'A job'), ` ${job.role || ''} closes`.replace(/\s+/g, ' '));
    li.append(text);
    items.append(li);
  }
  box.append(head, items);
  return box;
}

/** One card on the board: the job, its dates and note, with the edit controls folded away. */
function item(row, now) {
  const job = { id: row.job_id, ...row.job };
  const node = el('article', 'card track-item track-card');
  node.dataset.id = row.job_id;

  const head = el('div', 'track-head');
  const title = el('h4', 'role');
  const open = el('button', 'open', job.role || 'Untitled role');
  open.type = 'button';
  open.addEventListener('click', () => {
    if (!hooks.openJob(row.job_id)) hooks.toast("That posting has left the boards. Your notes stay here.");
  });
  title.append(open);
  const who = el('div', 'track-who');
  who.append(title, el('p', 'firm', [job.firm, job.city].filter(Boolean).join(' · ')));
  head.append(el('span', 'monogram', initials(job.firm || '?')), who);
  node.append(head);

  const dates = el('div', 'track-dates');
  const follow = followUpLabel(row.follow_up, now);
  if (follow) {
    const days = daysTo(row.follow_up, now);
    dates.append(el('span', `due ${follow.due || days <= 1 ? 'soon' : 'later'}`, follow.text));
  }
  const deadline = ['Saved', 'Applied'].includes(row.stage) ? deadlineLabel(job.deadline, now) : null;
  if (deadline) dates.append(el('span', `due ${deadline.urgent ? 'soon' : 'later'}`, deadline.text));
  if (dates.childElementCount) node.append(dates);
  if (row.note) node.append(el('p', 'track-note-text', row.note));

  const edit = el('details', 'track-edit');
  edit.append(el('summary', '', 'Edit'));

  const controls = el('div', 'track-controls');
  const stageLabel = el('label');
  const stage = document.createElement('select');
  stage.setAttribute('aria-label', `Stage for ${job.role}`);
  for (const value of STAGES) stage.append(new Option(value, value));
  stage.value = row.stage;
  stage.addEventListener('change', () => track(job, { stage: stage.value }));
  stageLabel.append(el('span', 'eyebrow', 'STAGE'), stage);

  const dateLabel = el('label');
  const date = document.createElement('input');
  date.type = 'date';
  date.value = row.follow_up ?? '';
  date.setAttribute('aria-label', `Follow-up date for ${job.role}`);
  date.addEventListener('change', () => track(job, { followUp: date.value || null }));
  dateLabel.append(el('span', 'eyebrow', 'FOLLOW UP'), date);
  controls.append(stageLabel, dateLabel);

  const noteLabel = el('label', 'track-note');
  const note = document.createElement('textarea');
  note.rows = 3;
  note.maxLength = 2000;
  note.placeholder = 'Recruiter name, interview date, what you sent…';
  note.value = row.note ?? '';
  // Saved without a redraw so typing isn't interrupted; the card's note preview catches up on the next one.
  note.addEventListener('change', () => track(job, { note: note.value }, { redraw: false }));
  noteLabel.append(el('span', 'eyebrow', 'NOTES'), note);

  const foot = el('div', 'track-foot');
  const href = safeUrl(job.applyUrl ?? '');
  if (href) {
    const apply = el('a', 'link', 'Open posting');
    apply.href = href;
    apply.target = '_blank';
    apply.rel = 'noopener noreferrer';
    foot.append(apply);
  }
  const remove = el('button', 'link', 'Remove');
  remove.type = 'button';
  remove.addEventListener('click', () => {
    if (row.note && !confirm(`Remove ${job.role} and its notes from your tracker?`)) return;
    untrack(row.job_id);
  });
  foot.append(remove);

  edit.append(controls, noteLabel, foot);
  // Keep a card's editor open across redraws (a stage change moves the card).
  edit.open = openEditors.has(row.job_id);
  edit.addEventListener('toggle', () => (edit.open ? openEditors.add(row.job_id) : openEditors.delete(row.job_id)));
  node.append(edit);
  return node;
}

const openEditors = new Set();

function el(tag, cls = '', text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

export { draw as drawTracker };
