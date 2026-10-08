// app.js — loads the snapshot and draws the page. The rules live in feed.js.
//
// Two modes, picked by config.js. Open (no accounts configured): the feed is
// read from postings.json, as it always was. Accounts: account.js signs the
// visitor in and hands over the feed from Supabase, plus their profile, which
// this file scores every job against to highlight the best matches.
import { CONFIG } from './config.js';
import { isConfigured } from './access.js';
import {
  FILTERS,
  daysBetween,
  deadlineLabel,
  facet,
  filterJobs,
  initials,
  isNew,
  parseSaved,
  postedLabel,
  readQuery,
  safeUrl,
  sortJobs,
  toggleSaved,
  updatedLabel,
  writeQuery
} from './feed.js';
import { setMarketLoader, startMarkets } from './markets-view.js';
import { setGrowthJobs } from './growth.js';
import { STAGES, followUpLabel, importRows } from './tracker.js';
import { importTracked, setTrackerStore, stageOf, startTracker, track, trackedIds, trackedRows, trackerOn, untrack } from './tracker-view.js';
import { startNews } from './news-view.js';
import { startEvents } from './events-view.js';
import { startProperty } from './property-view.js';
import { startPitch } from './pitch.js';

const $ = (id) => document.getElementById(id);
const FILTER_LABELS = { firm: 'All firms', sector: 'All sectors' };
/** Filters drawn as one-tap chips; the rest are dropdowns. */
const CHIP_FILTERS = { city: 'city-chips', kind: 'kind-chips' };
const SELECT_FILTERS = FILTERS.filter((key) => !(key in CHIP_FILTERS));
const SAVED_KEY = 'terra-saved';
const THEME_KEY = 'terra-theme';

let snapshot = null;
let state = readQuery(location.search);
// A sort named in the link wins; otherwise a signed-in user with a resume sees best matches first.
let sortChosen = new URLSearchParams(location.search).has('sort');
/** Match % at or above which a card is drawn heavier, below which lighter. Best matches (BEST_MATCH in match.js) get the full highlight. */
const GOOD_MATCH = 75;
const WEAK_MATCH = 50;
let bound = false;
/** job id -> { score, note, lines, strong }, from the signed-in user's resume. */
let scores = new Map();
let profile = null;
let matcher = null;
/** Starred job ids: this device's list on the open site, the member's tracker when signed in. */
let saved = readSaved();
/** The jobs on screen, in order, so the detail panel can step through them. */
let shown = [];
/** Cards drawn at once; "Show more" adds the next batch, and any filter change starts over. */
const PAGE_SIZE = 30;
let limit = PAGE_SIZE;

async function load() {
  try {
    // no-cache: the file is replaced every two hours and must not be served stale.
    const response = await fetch('postings.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`postings.json returned ${response.status}`);
    showFeed(await response.json());
  } catch (error) {
    $('meta').textContent = '';
    showState(`Couldn't load postings. ${error instanceof Error ? error.message : ''}`.trim(), true);
  }
}

function showFeed(next) {
  snapshot = next;
  setGrowthJobs(snapshot.jobs);
  applyScores();
  fillFilters(snapshot.jobs);
  $('adzuna-credit').hidden = !snapshot.jobs.some((job) => job.via === 'Adzuna');
  if (!bound) bind();
  bound = true;
  render();
}

function hideFeed(message) {
  snapshot = null;
  setGrowthJobs([]);
  setTracker(null);
  setMarketLoader(null);
  $('meta').textContent = message ?? '';
  $('list').replaceChildren();
  $('count').textContent = '';
  $('stats').hidden = true;
  $('today').hidden = true;
  if ($('job-panel').open) $('job-panel').close();
}

/**
 * Called by account.js with the member's tracker store once the feed is in,
 * or null on sign-out. Jobs starred on this device before signing in move
 * into the account the first time.
 */
async function setTracker(store) {
  const on = await setTrackerStore(store);
  if (!on) {
    saved = readSaved();
    trackerChanged();
    return;
  }
  const local = readSaved();
  if (local.size && snapshot) {
    const moved = await importTracked(importRows(local, snapshot.jobs, trackedIds()));
    try {
      localStorage.removeItem(SAVED_KEY);
    } catch {
      // Nothing to clear.
    }
    if (moved) toast(`Moved ${moved} saved ${moved === 1 ? 'job' : 'jobs'} into your tracker.`);
  }
  trackerChanged();
}

/** Redraw what shows saved state after the tracker changes. */
function trackerChanged() {
  if (trackerOn()) saved = trackedIds();
  if (!snapshot) return;
  drawSavedToggle();
  for (const button of $('list').querySelectorAll('.card .save')) {
    const job = snapshot.jobs.find((j) => j.id === button.closest('.card').dataset.id);
    if (job) paintSave(button, job);
  }
  if (panelJob) paintPanelSave();
  if (state.saved) render();
  else drawToday(snapshot.jobs, new Date());
}

/** Called by account.js whenever the signed-in user's profile changes. */
async function setProfile(next) {
  profile = next;
  if (profile?.resumeText && !matcher) {
    try {
      matcher = await import('./match.js');
    } catch {
      // match.js is build output; a local copy of the site without
      // `npm run build:site` simply shows no match highlights.
      matcher = null;
    }
  }
  applyScores();
  if (snapshot) render();
}

function applyScores() {
  scores = profile && matcher && snapshot ? matcher.scoreJobs(profile, snapshot.jobs) : new Map();
  for (const job of snapshot?.jobs ?? []) job.matchScore = scores.get(job.id)?.score;

  // Safari ignores `hidden` on <option>, so the choice is added and removed instead.
  const sort = $('sort');
  const option = sort.querySelector('option[value="match"]');
  if (scores.size && !option) sort.append(new Option('Best match', 'match'));
  if (!scores.size && option) option.remove();
  // A link or an earlier choice can ask for match order before there is a resume to sort by.
  if (state.sort === 'match' && scores.size === 0 && snapshot) state.sort = 'newest';
  if (scores.size && !sortChosen && state.sort === 'newest') state.sort = 'match';
  $('sort').value = state.sort;
}

function fillFilters(jobs) {
  for (const key of SELECT_FILTERS) {
    const select = $(key);
    select.replaceChildren(new Option(FILTER_LABELS[key], ''));
    for (const { value, count } of facet(jobs, key)) select.append(new Option(`${value} (${count})`, value));
    // A link can name a firm that has since left the feed; drop it rather than show nothing.
    if (state[key] && ![...select.options].some((option) => option.value === state[key])) state[key] = '';
    select.value = state[key];
  }
  for (const key of Object.keys(CHIP_FILTERS)) {
    const values = facet(jobs, key, key === 'city' ? snapshot.cities ?? [] : []);
    if (state[key] && !values.some((v) => v.value === state[key])) state[key] = '';
  }
  $('q').value = state.q;
  $('sort').value = state.sort;
}

/** City and role type as chips, counted against the other filters so each number is what a tap would show. */
function drawChips() {
  for (const [key, id] of Object.entries(CHIP_FILTERS)) {
    const pool = filterJobs(snapshot.jobs, { ...state, [key]: '', savedIds: saved });
    const counts = new Map(facet(pool, key).map(({ value, count }) => [value, count]));
    const values = facet(snapshot.jobs, key, key === 'city' ? snapshot.cities ?? [] : []).map(({ value }) => value);
    const row = $(id);
    const chips = [chip('All', '', pool.length, !state[key])];
    for (const value of values) chips.push(chip(value, value, counts.get(value) ?? 0, state[key] === value));
    row.replaceChildren(...chips);

    function chip(label, value, count, on) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chip';
      button.setAttribute('aria-pressed', String(on));
      button.dataset.value = value;
      button.append(label, el('span', 'chip-count', String(count)));
      if (!count && !on) button.classList.add('empty');
      button.addEventListener('click', () => update({ [key]: on && value ? '' : value }));
      return button;
    }
  }
}

function bind() {
  let timer;
  $('q').addEventListener('input', (event) => {
    clearTimeout(timer);
    timer = setTimeout(() => update({ q: event.target.value.trim() }), 120);
  });
  for (const key of [...SELECT_FILTERS, 'sort']) {
    $(key).addEventListener('change', (event) => update({ [key]: event.target.value }));
  }
  $('sort').addEventListener('change', () => (sortChosen = true));
  $('clear').addEventListener('click', () => {
    update({ q: '', city: '', firm: '', kind: '', sector: '', saved: false });
    $('q').value = '';
    for (const key of SELECT_FILTERS) $(key).value = '';
  });
  $('saved-toggle').addEventListener('click', () => update({ saved: !state.saved }));

  // Press / to search, as on most sites with a search box.
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if ($('jobs-view').hidden || isModal()) return;
    event.preventDefault();
    $('q').focus();
    $('q').select();
  });

  bindPanel();
}

function update(change, chosenSort = false) {
  if (chosenSort) sortChosen = true;
  state = { ...state, ...change };
  limit = PAGE_SIZE;
  history.replaceState(null, '', `${location.pathname}${writeQuery(state)}${location.hash}`);
  render();
}

function render() {
  // A filter tapped while the feed reloads (sign-in, sign-out) has nothing to draw yet.
  if (!snapshot) return;
  const now = new Date();
  const { jobs, generatedAt, boards } = snapshot;

  const failed = boards?.failed ? ` · ${boards.failed} of ${boards.polled} boards didn't answer` : '';
  $('meta').textContent = `${updatedLabel(generatedAt, now)}${failed}`;
  drawToday(jobs, now);
  drawChips();

  shown = sortJobs(filterJobs(jobs, { ...state, savedIds: saved }), state.sort);
  const filtered = Boolean(state.q || state.saved || FILTERS.some((key) => state[key]));
  const strong = shown.filter((job) => scores.get(job.id)?.strong).length;

  $('count').textContent = `${shown.length} ${shown.length === 1 ? 'role' : 'roles'}${filtered ? ` of ${jobs.length}` : ''}${
    strong ? ` · ${strong} best ${strong === 1 ? 'match' : 'matches'} for you` : ''
  }`;
  $('clear').hidden = !filtered;
  drawSavedToggle();

  if (!jobs.length) {
    showState('No Texas entry-level roles are listed on the boards Terra reads right now. Check back soon.');
  } else if (!shown.length) {
    showState(
      state.saved && !saved.size
        ? 'Nothing saved yet. Tap the bookmark on any job to keep it here.'
        : 'Nothing matches those filters.'
    );
  } else {
    $('list').replaceChildren(...shown.slice(0, limit).map((job, index) => card(job, now, index)));
    drawMore(now);
  }

  // A ?job= link opens that posting, once the feed it lives in has arrived.
  if (state.job && !$('job-panel').open) {
    const job = jobs.find((j) => j.id === state.job);
    if (job) openPanel(job);
    else setJobParam('');
  }
  fillSplit();
}

/**
 * On wide screens the posting sits beside the list, so it always shows one:
 * the open one while it's still in the list, otherwise the first.
 */
function fillSplit() {
  const panel = $('job-panel');
  if (!WIDE.matches || isModal()) return;
  if (panelJob && shown.some((j) => j.id === panelJob.id)) {
    markSelected();
  } else if (shown.length) {
    if (state.job) setJobParam('');
    openPanel(shown[0], { auto: true });
  } else if (panel.open) {
    panel.close();
  }
}

function isModal() {
  return $('job-panel').matches(':modal');
}

/** The card whose posting is showing beside the list. */
function markSelected() {
  const id = $('job-panel').open && !isModal() ? panelJob?.id : null;
  for (const node of $('list').querySelectorAll('.card')) node.classList.toggle('selected', node.dataset.id === id);
}

/** The "Show more" button under the list, while some of the matching jobs are not drawn yet. */
function drawMore(now) {
  const rest = shown.length - limit;
  if (rest <= 0) return;
  const button = el('button', 'more', `Show ${Math.min(PAGE_SIZE, rest)} more`);
  button.type = 'button';
  button.append(el('span', 'more-count', ` of ${rest} left`));
  button.addEventListener('click', () => {
    const from = limit;
    limit += PAGE_SIZE;
    button.remove();
    const added = shown.slice(from, limit).map((job, index) => card(job, now, index));
    $('list').append(...added);
    drawMore(now);
    // Keyboard users carry on from the first new card.
    added[0]?.querySelector('.open')?.focus({ preventScroll: true });
  });
  $('list').append(button);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SHORT_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Days from today to a YYYY-MM-DD deadline, or null without a readable one. */
function daysLeft(deadline, now) {
  if (!deadline) return null;
  const date = new Date(`${deadline}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : daysBetween(now, date);
}

/**
 * The "today" strip over the search: open roles, roles posted in the last
 * day, strong resume matches, roles closing within a week and tracker
 * follow-ups due. A tile shows only when the data behind it exists; each one
 * is a shortcut to the jobs it counts.
 */
function drawToday(jobs, now) {
  const box = $('today');
  const tiles = [];
  const firms = new Set(jobs.map((j) => j.firm)).size;
  const cities = new Set(jobs.map((j) => j.city)).size;
  tiles.push(
    tile(jobs.length, jobs.length === 1 ? 'open role' : 'open roles', `${firms} ${firms === 1 ? 'firm' : 'firms'} · ${cities} ${cities === 1 ? 'city' : 'cities'}`, () =>
      update({ q: '', city: '', firm: '', kind: '', sector: '', saved: false })
    )
  );
  const dated = jobs.filter((j) => j.postedAt && Number.isFinite(new Date(j.postedAt).getTime()));
  if (dated.length) {
    const fresh = dated.filter((j) => now.getTime() - new Date(j.postedAt).getTime() <= DAY_MS).length;
    const recent = jobs.filter((j) => isNew(j.postedAt, now)).length;
    tiles.push(tile(fresh, 'new since yesterday', `${recent} in the last 2 days`, () => update({ sort: 'newest' }, true)));
  }
  if (scores.size) {
    const strong = jobs.filter((j) => (scores.get(j.id)?.score ?? 0) >= GOOD_MATCH).length;
    tiles.push(tile(strong, strong === 1 ? 'strong match' : 'strong matches', `${GOOD_MATCH}% fit or better`, () => update({ sort: 'match' }, true)));
  }
  const closing = jobs
    .map((job) => ({ job, days: daysLeft(job.deadline, now) }))
    .filter(({ days }) => days != null && days >= 0 && days <= 7)
    .sort((a, b) => a.days - b.days);
  if (jobs.some((j) => j.deadline)) {
    const first = closing[0];
    const note = first ? `${first.job.firm} · ${SHORT_DATE.format(new Date(`${first.job.deadline}T00:00:00Z`))}` : 'Nothing due this week';
    tiles.push(tile(closing.length, 'closing in 7 days', note, () => update({ sort: 'deadline' }, true), closing.length > 0));
  }
  if (trackerOn()) {
    const due = trackedRows().filter((row) => followUpLabel(row.follow_up, now)?.due).length;
    tiles.push(tile(due, due === 1 ? 'follow-up due' : 'follow-ups due', 'Open tracker', () => (location.hash = 'tracker'), due > 0));
  }
  box.replaceChildren(...tiles);
  box.hidden = false;

  function tile(value, label, note, go, hot = false) {
    const button = el('button', 'card today-stat');
    button.type = 'button';
    button.append(el('b', `num${hot ? ' hot' : ''}`, String(value)), el('small', '', label), el('em', '', note));
    button.addEventListener('click', go);
    return button;
  }
}

function drawSavedToggle() {
  const toggle = $('saved-toggle');
  toggle.setAttribute('aria-pressed', String(state.saved));
  $('saved-count').textContent = String(saved.size);
}

function card(job, now, index) {
  const node = $('card').content.firstElementChild.cloneNode(true);
  node.dataset.id = job.id;
  node.style.setProperty('--i', String(Math.min(index, 12)));
  node.querySelector('.monogram').textContent = initials(job.firm);
  const open = node.querySelector('.open');
  open.textContent = job.role;
  open.addEventListener('click', () => openPanel(job));
  // The whole card opens the panel; links and buttons inside keep their own job.
  node.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a, button')) return;
    if (getSelection()?.toString()) return; // selecting text is not a click
    openPanel(job);
  });
  node.querySelector('.firm').textContent = `${job.firm} · ${job.city}`;

  const apply = node.querySelector('.apply');
  const href = safeUrl(job.applyUrl);
  if (href) {
    apply.href = href;
    apply.setAttribute('aria-label', `Apply for ${job.role} at ${job.firm}`);
  } else {
    apply.remove();
  }

  const save = node.querySelector('.save');
  paintSave(save, job);
  save.addEventListener('click', () => {
    flipSaved(job);
    paintSave(save, job);
  });

  fillChips(node.querySelector('.chips'), job);

  node.querySelector('.new-tag').hidden = !isNew(job.postedAt, now);
  node.querySelector('.posted').textContent = postedLabel(job.postedAt, now);
  if (job.via !== 'Adzuna') node.querySelector('.via').remove();
  const deadline = deadlineLabel(job.deadline, now);
  const deadlineNode = node.querySelector('.deadline');
  if (deadline) {
    deadlineNode.textContent = deadline.text;
    deadlineNode.classList.toggle('urgent', deadline.urgent);
  } else {
    deadlineNode.remove();
  }

  const match = scores.get(job.id);
  const scoreNode = node.querySelector('.score');
  if (match) {
    scoreNode.textContent = `${match.score}% match`;
    if (!match.strong) node.classList.add(match.score >= GOOD_MATCH ? 'good' : match.score < WEAK_MATCH ? 'weak' : 'fair');
    if (match.strong) {
      node.classList.add('best');
      const badge = node.querySelector('.match-badge');
      badge.textContent = `Best match · ${match.note}`;
      badge.hidden = false;
    }
  } else {
    scoreNode.remove();
  }

  return node;
}

function fillChips(list, job) {
  list.replaceChildren();
  for (const [text, cls] of [[job.kind, 'kind'], [job.sector], [job.pay, 'pay']]) {
    if (!text) continue;
    list.append(el('li', cls ?? '', text));
  }
}

function paintSave(button, job) {
  const on = saved.has(job.id);
  button.setAttribute('aria-pressed', String(on));
  button.setAttribute('aria-label', `${on ? 'Remove' : 'Save'} ${job.role} at ${job.firm}${on ? ' from saved' : ''}`);
  button.title = on ? 'Saved' : 'Save for later';
}

function flipSaved(job) {
  if (trackerOn()) {
    const stage = stageOf(job.id);
    if (!stage) {
      track(job, { stage: 'Saved' }).then((ok) => ok && toast('Saved. Find it under Tracker.'));
    } else if (stage === 'Saved') {
      untrack(job.id).then((ok) => ok && toast('Removed from your tracker.'));
    } else {
      toast(`It's in your tracker as ${stage}. Change or remove it there.`);
    }
    return;
  }
  saved = toggleSaved(saved, job.id);
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify([...saved]));
  } catch {
    // Private windows can refuse storage; the star still works for this visit.
  }
  toast(saved.has(job.id) ? 'Saved. Find it under Saved.' : 'Removed from saved.');
  drawSavedToggle();
  // In the Saved view an unstarred job leaves the list.
  if (state.saved) render();
}

function readSaved() {
  try {
    return parseSaved(localStorage.getItem(SAVED_KEY));
  } catch {
    return new Set();
  }
}

/* ---------------------------------------------------------------------------
   The detail panel: one posting in full, with previous/next through the list.
   --------------------------------------------------------------------------- */

let panelJob = null;
// Wide enough for the list and the posting side by side.
const WIDE = matchMedia('(min-width: 1024px)');

function bindPanel() {
  const panel = $('job-panel');
  $('jp-close').addEventListener('click', () => panel.close());
  $('jp-prev').addEventListener('click', () => step(-1));
  $('jp-next').addEventListener('click', () => step(1));
  $('jp-save').addEventListener('click', () => {
    if (!panelJob) return;
    flipSaved(panelJob);
    paintPanelSave();
    const save = $('list').querySelector(`[data-id="${CSS.escape(panelJob.id)}"] .save`);
    if (save) paintSave(save, panelJob);
  });
  for (const value of ['', ...STAGES]) $('jp-stage').append(new Option(value || 'Not tracking', value));
  $('jp-stage').addEventListener('change', (event) => {
    if (!panelJob) return;
    const stage = event.target.value;
    if (stage) track(panelJob, { stage });
    else untrack(panelJob.id);
  });
  $('jp-share').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast('Link copied.');
    } catch {
      toast("Couldn't copy. The address bar has the link.");
    }
  });
  // A click on the backdrop (outside the sheet) closes it.
  panel.addEventListener('click', (event) => {
    if (event.target === panel) panel.close();
  });
  panel.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    if (event.key === 'ArrowLeft') step(-1);
    if (event.key === 'ArrowRight') step(1);
  });
  panel.addEventListener('close', () => {
    // Already reopened (switching between the side panel and the sheet).
    if (panel.open) return;
    const id = panelJob?.id;
    panelJob = null;
    document.body.classList.remove('sheet-open');
    if (state.job) setJobParam('');
    // Back to the card it came from, for keyboard users.
    if (id) $('list').querySelector(`[data-id="${CSS.escape(id)}"] .open`)?.focus({ preventScroll: true });
    markSelected();
  });
  // Crossing the breakpoint swaps the side panel for the sheet, or back.
  WIDE.addEventListener('change', () => {
    if (panel.open) panel.close();
    render();
  });
}

/** auto: shown beside the list without being asked for, so the link stays as it is. */
function openPanel(job, { auto = false } = {}) {
  const panel = $('job-panel');
  // Beside the list on wide screens; a sheet on phones, or when the list isn't showing (the tracker).
  const modal = !WIDE.matches || $('jobs-view').hidden;
  if (panel.open && isModal() !== modal) panel.close();
  panelJob = job;
  const now = new Date();
  $('jp-monogram').textContent = initials(job.firm);
  $('jp-role').textContent = job.role;
  $('jp-firm').textContent = `${job.firm} · ${job.city}`;
  fillChips($('jp-chips'), job);

  const dates = [postedLabel(job.postedAt, now)];
  const deadline = deadlineLabel(job.deadline, now);
  const datesNode = $('jp-dates');
  datesNode.replaceChildren();
  if (isNew(job.postedAt, now)) datesNode.append(el('span', 'new-tag', 'New'));
  datesNode.append(el('span', '', dates[0]));
  if (deadline) datesNode.append(el('span', `deadline${deadline.urgent ? ' urgent' : ''}`, deadline.text));

  drawFacts(job, now);
  const match = scores.get(job.id);
  $('jp-badge').hidden = !match;
  if (match) $('jp-badge').textContent = match.strong ? `Best match · ${match.note}` : `${match.score}% match`;
  $('jp-why').replaceChildren(...(match?.lines ?? []).map((line) => el('li', '', line)));
  drawFit(job, match);
  $('jp-why-wrap').hidden = !match;
  drawSimilar(job);

  $('jp-desc').textContent = job.desc || 'The firm did not include a description. The apply link has the full posting.';
  $('jp-reqs').replaceChildren(...(job.reqs ?? []).map((req) => el('li', '', req)));
  $('jp-reqs-wrap').hidden = !job.reqs?.length;
  $('jp-via').hidden = job.via !== 'Adzuna';

  const href = safeUrl(job.applyUrl);
  const apply = $('jp-apply');
  apply.hidden = !href;
  if (href) apply.href = href;
  paintPanelSave();

  const index = shown.findIndex((j) => j.id === job.id);
  $('jp-position').textContent = index >= 0 ? `${index + 1} of ${shown.length}` : '';
  $('jp-prev').disabled = index <= 0;
  $('jp-next').disabled = index < 0 || index >= shown.length - 1;

  panel.querySelector('.sheet-body').scrollTop = 0;
  if (!panel.open) {
    if (modal) {
      panel.showModal();
      document.body.classList.add('sheet-open');
    } else {
      // show() moves focus into the panel; beside the list it should stay where the visitor is.
      const active = document.activeElement;
      const y = scrollY;
      panel.show();
      if (active instanceof HTMLElement) active.focus({ preventScroll: true });
      else panel.blur();
      scrollTo({ top: y });
    }
  }
  if (modal) $('jp-close').focus({ preventScroll: true });
  markSelected();
  if (!auto && state.job !== job.id) setJobParam(job.id);
}

/** Pay, type, sector and closing date as tiles; the closing tile turns red inside a week. */
function drawFacts(job, now) {
  const days = daysLeft(job.deadline, now);
  const closes = days == null ? 'Not listed' : days < 0 ? `Closed ${SHORT_DATE.format(new Date(`${job.deadline}T00:00:00Z`))}` : SHORT_DATE.format(new Date(`${job.deadline}T00:00:00Z`));
  const facts = [
    ['Pay', job.pay || 'Not listed'],
    ['Type', job.kind || 'Not listed'],
    ['Sector', job.sector || 'Not listed'],
    ['Closes', closes, days != null && days <= 7]
  ];
  $('jp-facts').replaceChildren(
    ...facts.map(([label, value, warn]) => {
      const box = el('div', `fact${warn ? ' warn' : ''}`);
      box.append(el('dt', '', label), el('dd', '', value));
      return box;
    })
  );
}

/**
 * The match ring and, when match.js can name them, the skills the posting
 * asks for split into what the resume has and what it lacks.
 */
function drawFit(job, match) {
  const fit = $('jp-fit');
  const list = $('jp-skills');
  list.replaceChildren();
  fit.hidden = !match;
  if (!match) return;
  const ring = el('span', 'ring');
  ring.style.setProperty('--p', String(match.score));
  ring.append(el('span', '', `${match.score}%`));
  const verdict = match.strong ? 'Best match.' : match.score >= GOOD_MATCH ? 'Strong fit.' : match.score >= WEAK_MATCH ? 'Partial fit.' : 'Weak fit.';
  const text = el('p');
  text.append(el('b', '', verdict), ` ${match.note}`);
  fit.replaceChildren(ring, text);

  const required = job.match?.required ?? [];
  if (!required.length || !profile?.resumeText || typeof matcher?.resumeSkillKeys !== 'function') return;
  const have = new Set(matcher.resumeSkillKeys(profile.resumeText));
  const label = (key) => matcher.skillLabel(key);
  for (const key of required.filter((k) => have.has(k))) {
    const li = el('li', 'check yes');
    li.append(el('i', '', '✓'), el('span', '', `${label(key)} is on your resume.`));
    list.append(li);
  }
  for (const key of required.filter((k) => !have.has(k))) {
    const li = el('li', 'check no');
    const span = el('span');
    span.append(el('b', '', label(key)), " is asked for but isn't on your resume.");
    li.append(el('i', '', '!'), span);
    list.append(li);
  }
}

/** Up to four other open roles in the same sector or city, closest first. */
function drawSimilar(job) {
  const pool = (snapshot?.jobs ?? [])
    .filter((j) => j.id !== job.id && (j.sector === job.sector || j.city === job.city))
    .map((j) => ({ j, rank: (j.sector === job.sector ? 2 : 0) + (j.city === job.city ? 1 : 0) + (j.kind === job.kind ? 0.5 : 0) }))
    .sort((a, b) => b.rank - a.rank || (scores.get(b.j.id)?.score ?? 0) - (scores.get(a.j.id)?.score ?? 0) || String(b.j.postedAt).localeCompare(String(a.j.postedAt)))
    .slice(0, 4)
    .map(({ j }) => j);
  $('jp-similar-wrap').hidden = !pool.length;
  $('jp-similar').replaceChildren(
    ...pool.map((other) => {
      const button = el('button', 'similar-item');
      button.type = 'button';
      const text = el('span', 'similar-text');
      text.append(el('b', '', other.role), el('small', '', `${other.firm} · ${other.city}`));
      button.append(el('span', 'monogram', initials(other.firm)), text);
      button.addEventListener('click', () => openPanel(other));
      return button;
    })
  );
}

/** The open posting goes in the link without redrawing the list behind it. */
function setJobParam(id) {
  state = { ...state, job: id };
  history.replaceState(null, '', `${location.pathname}${writeQuery(state)}${location.hash}`);
}

function step(direction) {
  if (!panelJob) return;
  const index = shown.findIndex((j) => j.id === panelJob.id);
  const next = shown[index + direction];
  if (index >= 0 && next) {
    if (index + direction >= limit) {
      limit = Math.ceil((index + direction + 1) / PAGE_SIZE) * PAGE_SIZE;
      render();
    }
    openPanel(next);
  }
}

function paintPanelSave() {
  const on = Boolean(panelJob && saved.has(panelJob.id));
  const button = $('jp-save');
  button.setAttribute('aria-pressed', String(on));
  button.textContent = on ? 'Saved' : 'Save';
  // Members get the full stage picker in place of the plain bookmark.
  const tracking = trackerOn();
  button.hidden = tracking;
  $('jp-stage-wrap').hidden = !tracking;
  if (tracking && panelJob) $('jp-stage').value = stageOf(panelJob.id) ?? '';
}

let toastTimer;
function toast(text) {
  const node = $('toast');
  // An open modal sits in the top layer, above anything outside it.
  const host = isModal() ? $('job-panel') : document.body;
  if (node.parentElement !== host) host.append(node);
  node.textContent = text;
  node.hidden = false;
  node.classList.remove('leaving');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.classList.add('leaving');
    toastTimer = setTimeout(() => (node.hidden = true), 200);
  }, 2200);
}

/* ---------------------------------------------------------------------------
   Light and dark. The page follows the device until the visitor picks one.
   --------------------------------------------------------------------------- */

function startTheme() {
  const root = document.documentElement;
  const media = matchMedia('(prefers-color-scheme: dark)');
  const current = () => root.dataset.theme ?? (media.matches ? 'dark' : 'light');
  const paint = () => {
    const dark = current() === 'dark';
    $('theme-toggle').setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} mode`);
    $('theme-toggle').dataset.mode = dark ? 'dark' : 'light';
  };
  $('theme-toggle').addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Not remembered, but still switched for this visit.
    }
    paint();
    window.dispatchEvent(new Event('themechange'));
  });
  media.addEventListener('change', paint);
  paint();
}

function el(tag, cls = '', text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function showState(message, isError = false) {
  const box = document.createElement('div');
  box.className = isError ? 'state error' : 'state';
  box.textContent = message;
  $('list').replaceChildren(box);
}

/** Market data is gated like the jobs: account.js hands over a loader once the visitor may read it. */
async function loadMarketFile() {
  const response = await fetch('market.json', { cache: 'no-cache' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`market.json returned ${response.status}`);
  return response.json();
}

startTheme();
startMarkets();
startTracker({
  toast,
  changed: trackerChanged,
  openJob(id) {
    const job = snapshot?.jobs.find((j) => j.id === id);
    if (job) openPanel(job);
    return Boolean(job);
  }
});
startNews();
startEvents();
startProperty();
startPitch();

if (isConfigured(CONFIG)) {
  $('meta').textContent = '';
  $('feed').hidden = true;
  import('./account.js')
    .then(({ startAccounts }) => startAccounts({ showFeed, hideFeed, setProfile, setMarketLoader, setTracker }))
    .catch((error) => showState(`Couldn't start sign-in. ${error instanceof Error ? error.message : ''}`.trim(), true));
} else {
  setMarketLoader(loadMarketFile);
  load();
}
