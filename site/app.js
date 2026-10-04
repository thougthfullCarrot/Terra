// app.js — loads the snapshot and draws the page. The rules live in feed.js.
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

const $ = (id) => document.getElementById(id);
const FILTER_LABELS = { city: 'All cities', firm: 'All firms', kind: 'All types', sector: 'All sectors' };

let snapshot = null;
let state = readQuery(location.search);

async function load() {
  try {
    // no-cache: the file is replaced every two hours and must not be served stale.
    const response = await fetch('postings.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`postings.json returned ${response.status}`);
    snapshot = await response.json();
  } catch (error) {
    $('meta').textContent = '';
    showState(`Couldn't load postings. ${error instanceof Error ? error.message : ''}`.trim(), true);
    return;
  }

  fillFilters(snapshot.jobs);
  bind();
  render();
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

  $('count').textContent = `${shown.length} ${shown.length === 1 ? 'role' : 'roles'}${filtered ? ` of ${jobs.length}` : ''}`;
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
  const deadline = deadlineLabel(job.deadline, now);
  const deadlineNode = node.querySelector('.deadline');
  if (deadline) {
    deadlineNode.textContent = deadline.text;
    deadlineNode.classList.toggle('urgent', deadline.urgent);
  } else {
    deadlineNode.remove();
  }

  const more = node.querySelector('.more');
  if (job.desc || job.reqs?.length) {
    node.querySelector('.desc').textContent = job.desc;
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

load();
