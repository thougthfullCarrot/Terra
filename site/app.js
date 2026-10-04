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
  deadlineLabel,
  facet,
  filterJobs,
  postedLabel,
  readQuery,
  safeUrl,
  sortJobs,
  updatedLabel,
  writeQuery
} from './feed.js';
import { setMarketLoader, startMarkets } from './markets-view.js';

const $ = (id) => document.getElementById(id);
const FILTER_LABELS = { city: 'All cities', firm: 'All firms', kind: 'All types', sector: 'All sectors' };

let snapshot = null;
let state = readQuery(location.search);
let bound = false;
/** job id -> { score, note, lines, strong }, from the signed-in user's resume. */
let scores = new Map();
let profile = null;
let matcher = null;

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
  applyScores();
  fillFilters(snapshot.jobs);
  $('adzuna-credit').hidden = !snapshot.jobs.some((job) => job.via === 'Adzuna');
  if (!bound) bind();
  bound = true;
  render();
}

function hideFeed(message) {
  snapshot = null;
  setMarketLoader(null);
  $('meta').textContent = message ?? '';
  $('list').replaceChildren();
  $('count').textContent = '';
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
  $('sort').value = state.sort;
}

function fillFilters(jobs) {
  for (const key of FILTERS) {
    const select = $(key);
    select.replaceChildren(new Option(FILTER_LABELS[key], ''));
    for (const { value, count } of facet(jobs, key, key === 'city' ? snapshot.cities ?? [] : [])) {
      select.append(new Option(`${value} (${count})`, value));
    }
    // A link can name a firm that has since left the feed; drop it rather than show nothing.
    if (state[key] && ![...select.options].some((option) => option.value === state[key])) state[key] = '';
    select.value = state[key];
  }
  $('q').value = state.q;
  $('sort').value = state.sort;
}

function bind() {
  let timer;
  $('q').addEventListener('input', (event) => {
    clearTimeout(timer);
    timer = setTimeout(() => update({ q: event.target.value.trim() }), 120);
  });
  for (const key of [...FILTERS, 'sort']) {
    $(key).addEventListener('change', (event) => update({ [key]: event.target.value }));
  }
  $('clear').addEventListener('click', () => {
    update({ q: '', city: '', firm: '', kind: '', sector: '' });
    $('q').value = '';
    for (const key of FILTERS) $(key).value = '';
  });
}

function update(change) {
  state = { ...state, ...change };
  history.replaceState(null, '', `${location.pathname}${writeQuery(state)}`);
  render();
}

function render() {
  const now = new Date();
  const { jobs, generatedAt, boards } = snapshot;

  const failed = boards?.failed ? ` · ${boards.failed} of ${boards.polled} boards didn't answer` : '';
  $('meta').textContent = `${updatedLabel(generatedAt, now)} · ${jobs.length} open roles${failed}`;

  const shown = sortJobs(filterJobs(jobs, state), state.sort);
  const filtered = Boolean(state.q || FILTERS.some((key) => state[key]));
  const strong = shown.filter((job) => scores.get(job.id)?.strong).length;

  $('count').textContent = `${shown.length} ${shown.length === 1 ? 'role' : 'roles'}${filtered ? ` of ${jobs.length}` : ''}${
    strong ? ` · ${strong} best ${strong === 1 ? 'match' : 'matches'} for you` : ''
  }`;
  $('clear').hidden = !filtered;

  if (!jobs.length) {
    showState('No Texas entry-level roles are listed on the boards Terra reads right now. Check back soon.');
    return;
  }
  if (!shown.length) {
    showState('Nothing matches those filters.');
    return;
  }

  $('list').replaceChildren(...shown.map((job) => card(job, now)));
}

function card(job, now) {
  const node = $('card').content.firstElementChild.cloneNode(true);
  node.querySelector('.role').textContent = job.role;
  node.querySelector('.firm').textContent = `${job.firm} · ${job.city}`;

  const apply = node.querySelector('.apply');
  const href = safeUrl(job.applyUrl);
  if (href) {
    apply.href = href;
    apply.setAttribute('aria-label', `Apply for ${job.role} at ${job.firm}`);
  } else {
    apply.remove();
  }

  const chips = node.querySelector('.chips');
  for (const [text, cls] of [[job.kind, 'kind'], [job.sector], [job.pay]]) {
    if (!text) continue;
    const li = document.createElement('li');
    li.textContent = text;
    if (cls) li.className = cls;
    chips.append(li);
  }

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
  const why = node.querySelector('.why');
  if (match) {
    scoreNode.textContent = `${match.score}% match`;
    if (match.strong) {
      node.classList.add('best');
      const badge = node.querySelector('.match-badge');
      badge.textContent = `Best match · ${match.note}`;
      badge.hidden = false;
    }
    for (const line of match.lines) {
      const li = document.createElement('li');
      li.textContent = line;
      why.append(li);
    }
  } else {
    scoreNode.remove();
  }
  if (!why.children.length) why.remove();

  const more = node.querySelector('.more');
  if (job.desc || job.reqs?.length || match?.lines.length) {
    node.querySelector('.desc').textContent = job.desc;
    if (!job.desc) node.querySelector('.desc').remove();
    const reqs = node.querySelector('.reqs');
    for (const req of job.reqs ?? []) {
      const li = document.createElement('li');
      li.textContent = req;
      reqs.append(li);
    }
    if (!job.reqs?.length) reqs.remove();
  } else {
    more.remove();
  }

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

startMarkets();

if (isConfigured(CONFIG)) {
  $('meta').textContent = '';
  $('feed').hidden = true;
  import('./account.js')
    .then(({ startAccounts }) => startAccounts({ showFeed, hideFeed, setProfile, setMarketLoader }))
    .catch((error) => showState(`Couldn't start sign-in. ${error instanceof Error ? error.message : ''}`.trim(), true));
} else {
  setMarketLoader(loadMarketFile);
  load();
}
