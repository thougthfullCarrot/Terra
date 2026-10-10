// markets-view.js — draws the market data section. The rules live in market.js.
//
// The page has four sections, Jobs, Tracker, Market data and News, switched by the URL hash
// so a link can open a city's market directly (#markets&city=Houston). The
// data comes from a loader app.js hands over: market.json on the open site,
// or the members-only Supabase row when accounts are on.
import {
  barPercent,
  defaultOrder,
  formatPoints,
  formatValue,
  ordinal,
  pruneSnapshot,
  ranks,
  readMarketHash,
  sortMarkets,
  writeMarketHash
} from './market.js';
import { developmentMap, disposeMap } from './devmap.js';
import { calculatorView, compareView, leasesView, reportsView } from './market-tools.js';
import { underwriteView } from './underwrite-view.js';
import { sitesView } from './sites-view.js';
import { growthView, payView, zoningView } from './insights-view.js';
import { readNewsHash } from './news.js';
import { readEventsHash } from './events.js';
import { readPropertyHash } from './property.js';
import { readCareerHash } from './career.js';

const $ = (id) => document.getElementById(id);

let loader = null;
/** null until loaded; a promise while loading. */
let snapshot = null;
let loading = null;
let state = null;
let bound = false;
/** The city the all-markets development map shows. */
let mapCity = null;

/** Set where the data comes from. null (signed out) hides any data already drawn. */
export function setMarketLoader(next) {
  loader = next;
  snapshot = null;
  loading = null;
  disposeMap();
  $('m-body').replaceChildren();
  $('m-chart').replaceChildren();
  $('m-rates').replaceChildren();
  if (next && readMarketHash(location.hash, null).open) show();
}

/**
 * The market data file, loaded once and shared with the Career tab, which
 * reads its development maps, zoning cases and salary filings. null when
 * signed out or not built yet.
 */
export async function marketSnapshot() {
  if (snapshot) return snapshot;
  if (!loader) return null;
  loading ??= loader();
  const data = await loading.catch(() => {
    loading = null;
    return null;
  });
  return data?.markets?.length ? data : null;
}

/** Show whichever section the hash names; the tracker calls this when its tab appears or goes. */
export function showSection() {
  return show();
}

export function startMarkets() {
  if (bound) return;
  bound = true;
  window.addEventListener('hashchange', show);
  window.addEventListener('terra-jobs', () => {
    if (snapshot && state?.tool === 'growth' && readMarketHash(location.hash, null).open) render();
  });
  $('m-city').addEventListener('change', (e) => update({ city: e.target.value }));
  $('m-focus').addEventListener('change', (e) => {
    const group = snapshot.groups.find((g) => g.key === e.target.value);
    const sort = group?.metrics[0] ?? 'city';
    update({ focus: e.target.value, sort, order: defaultOrder(metricFor(sort)) });
  });
  $('m-sort').addEventListener('change', (e) =>
    update({ sort: e.target.value, order: e.target.value === 'city' ? 'asc' : defaultOrder(metricFor(e.target.value)) })
  );
  $('m-order').addEventListener('change', (e) => update({ order: e.target.value }));
  show();
}

function metricFor(key) {
  return snapshot?.metrics.find((m) => m.key === key);
}

function update(change) {
  state = { ...state, ...change };
  // replaceState: changing a dropdown should not fill the back button's history.
  history.replaceState(null, '', `${location.pathname}${location.search}${writeMarketHash(state)}`);
  render();
}

/** Which section the hash opens. The tracker only exists for signed-in members, so without its tab it falls back to jobs. */
function section() {
  if (readMarketHash(location.hash, null).open) return 'markets';
  if (readNewsHash(location.hash, null).open) return 'news';
  if (readEventsHash(location.hash, null).open) return 'events';
  if (readPropertyHash(location.hash).open) return 'property';
  if (readCareerHash(location.hash).open) return 'career';
  if (new URLSearchParams(location.hash.replace(/^#/, '')).has('tracker') && !$('tab-tracker').hidden) return 'tracker';
  return 'jobs';
}

async function show() {
  const active = section();
  const open = active === 'markets';
  // style.css keeps the job counts in the masthead to the Jobs tab.
  document.body.dataset.section = active;
  // news-view.js, events-view.js and property-view.js show their own sections; the others step aside for it.
  for (const name of ['jobs', 'markets', 'tracker']) $(`${name}-view`).hidden = name !== active;
  for (const name of ['jobs', 'markets', 'tracker', 'news', 'events', 'property', 'career']) {
    if (name === active) $(`tab-${name}`).setAttribute('aria-current', 'page');
    else $(`tab-${name}`).removeAttribute('aria-current');
  }
  if (!open) return;

  if (!snapshot) {
    if (!loader) return;
    message('Loading market data…');
    loading ??= loader();
    const current = loading;
    try {
      const data = await current;
      if (current !== loading) return; // the loader changed while this was in flight
      if (!data?.markets?.length || !pruneSnapshot(data).groups.length) {
        loading = null;
        message('Market data is being built. Check back in a few minutes.');
        return;
      }
      snapshot = pruneSnapshot(data);
    } catch (error) {
      loading = null;
      message(`Couldn't load market data. ${error instanceof Error ? error.message : ''}`.trim(), true);
      return;
    }
  }
  state = readMarketHash(location.hash, snapshot);
  fillControls();
  render();
}

function fillControls() {
  const city = $('m-city');
  city.replaceChildren(new Option('All markets', ''), ...snapshot.markets.map((m) => new Option(m.city, m.city)));
  city.value = state.city;
  $('m-focus').replaceChildren(...snapshot.groups.map((g) => new Option(g.label, g.key)));
  $('m-focus').value = state.focus;
}

function render() {
  const group = snapshot.groups.find((g) => g.key === state.focus) ?? snapshot.groups[0];
  const sort = $('m-sort');
  sort.replaceChildren(
    ...group.metrics.map((key) => new Option(metricFor(key)?.label ?? key, key)),
    new Option('City name', 'city')
  );
  sort.value = state.sort;
  $('m-order').value = state.order;
  $('m-city').value = state.city;
  $('m-focus').value = state.focus;
  // Sorting means nothing with one market on screen, or in the tools.
  const tool = state.tool;
  $('m-sort-label').hidden = Boolean(state.city) || Boolean(tool);
  $('m-order-label').hidden = Boolean(state.city) || Boolean(tool);
  // The comparison picks its own cities; the calculator brings its own inputs; the topic means nothing to the broker views.
  $('m-city-label').hidden = tool === 'compare';
  $('m-focus-label').hidden = ['leases', 'reports', 'sites', ...INSIGHTS].includes(tool);
  $('m-filters').hidden = tool === 'calc' || tool === 'uw';
  for (const name of ['', 'compare', 'calc', 'uw', 'leases', 'sites', 'reports', ...INSIGHTS]) {
    const link = $(`m-tool-${name || 'data'}`);
    link.href = writeMarketHash({ ...state, tool: name, compare: name === 'compare' ? state.compare : [] });
    if (tool === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  disposeMap();
  if (tool) {
    $('m-blurb').textContent = TOOL_BLURBS[tool];
    $('m-rates').replaceChildren();
    $('m-chart').replaceChildren();
    $('m-body').replaceChildren(toolView(tool));
    // The broker and parcel tools carry their own source notes.
    $('m-sources').replaceChildren(...(['leases', 'reports', 'sites', ...INSIGHTS].includes(tool) ? [] : [sources()]));
    return;
  }

  $('m-blurb').textContent = group.blurb ?? '';
  $('m-rates').replaceChildren(rates());
  $('m-chart').replaceChildren(...(state.city ? [] : group.key === 'development' ? [devMap(), chart(group)] : [chart(group)]));
  $('m-body').replaceChildren(state.city ? cityView(state.city, group) : table(group));
  if (!state.city && group.key === 'migration') $('m-body').append(counties());
  $('m-sources').replaceChildren(sources());
}

/** Tools that carry their own source notes and need no topic (insights-view.js). */
const INSIGHTS = ['pay', 'zoning', 'growth'];

const TOOL_BLURBS = {
  compare: 'Rents, permits, job growth and taxes for the cities you pick, side by side.',
  calc: "Run the numbers on a property with today's rates and a Texas city's property tax.",
  uw: 'A 10-year hold with IRR, equity multiple and a sensitivity grid, downloadable to Excel with live formulas.',
  leases: 'Office, industrial and retail vacancy and asking rents from brokerages\' free quarterly reports.',
  sites: 'Land and buildings from county appraisal rolls, with zoning from the city: filter by use, size and appraised value per square foot.',
  reports: 'The latest free quarterly market reports from the big brokerages, by city.',
  pay: 'What commercial real estate firms actually offer, by job title and city, from Labor Department wage filings.',
  zoning: 'Rezoning requests and special use permits on city agendas: the earliest public sign of a new project.',
  growth: "Firms posting jobs lined up against the projects they are building, and the developers who will likely hire next."
};

function toolView(tool) {
  if (tool === 'calc') return calculatorView(snapshot);
  if (tool === 'uw') return underwriteView(snapshot);
  if (tool === 'compare') return compareView(snapshot, state, update);
  if (tool === 'leases') return leasesView(snapshot, state.city);
  if (tool === 'reports') return reportsView(snapshot, state.city);
  if (tool === 'pay') return payView(snapshot, state.city);
  if (tool === 'zoning') return zoningView(snapshot, state.city);
  if (tool === 'growth') return growthView(snapshot, state.city);
  return sitesView(snapshot, state.city);
}

function table(group, me = '') {
  const metrics = group.metrics.map(metricFor).filter(Boolean);
  const markets = sortMarkets(snapshot.markets, state.sort, state.order);
  const sorted = metricFor(state.sort);
  const placeFor = sorted ? ranks(snapshot.markets, sorted) : null;

  const wrap = el('div', 'table-wrap');
  const tableNode = el('table', 'market-table');
  const caption = el('caption', 'visually-hidden', `${group.label} figures by market`);
  const head = el('tr');
  head.append(headerCell('city', 'Market', 'city-col'));
  for (const metric of metrics) head.append(headerCell(metric.key, metric.label, 'num', metric));

  const body = el('tbody');
  for (const market of markets) {
    const row = el('tr', market.city === me ? 'me' : '');
    if (market.city === me) row.setAttribute('aria-current', 'true');
    const name = el('th', 'city-col');
    name.scope = 'row';
    if (placeFor?.has(market.city)) name.append(el('span', 'rank', String(placeFor.get(market.city))));
    const link = el('a', 'city-link', market.city);
    link.href = writeMarketHash({ ...state, city: market.city });
    name.append(link, el('span', 'metro', market.metro ?? ''));
    row.append(name);

    for (const metric of metrics) {
      const value = market.values[metric.key];
      const cell = el('td', `num${metric.key === state.sort ? ' sorted' : ''}`);
      const text = el('span', `value ${tone(value, metric)}`, formatValue(value, metric.unit));
      if (market.periods?.[metric.key]) text.title = market.periods[metric.key];
      cell.append(text);
      if (metric.key === state.sort && value != null) {
        const bar = el('span', 'bar');
        const fill = el('i');
        fill.style.width = `${barPercent(value, snapshot.markets.map((m) => m.values[metric.key]), metric.unit)}%`;
        bar.append(fill);
        cell.append(bar);
      }
      row.append(cell);
    }
    body.append(row);
  }

  const thead = el('thead');
  thead.append(head);
  tableNode.append(caption, thead, body);
  wrap.append(tableNode);

  const frag = document.createDocumentFragment();
  frag.append(wrap, asOf(metrics));
  return frag;
}

/**
 * One metric across every market as horizontal bars, the metric picked from
 * the pills above it. A growth figure can be negative, so its bars grow either
 * way from a zero line; everything else starts at zero on the left. Hovering a
 * bar names its rank and period; clicking opens that market.
 */
function chart(group, me = '') {
  const metrics = group.metrics.map(metricFor).filter(Boolean);
  const metric = metricFor(state.sort) ?? metrics[0];
  const box = el('section', 'card chart-card');
  if (!metric) return box;

  const pills = el('div', 'metric-pills');
  pills.setAttribute('role', 'group');
  pills.setAttribute('aria-label', 'Metric to chart');
  for (const m of metrics) {
    const pill = el('button', 'chip', m.label);
    pill.type = 'button';
    pill.setAttribute('aria-pressed', String(m.key === metric.key));
    if (m.note) pill.title = m.note;
    pill.addEventListener('click', () => update({ sort: m.key, order: defaultOrder(m) }));
    pills.append(pill);
  }

  const head = el('div', 'chart-head');
  head.append(el('h3', 'group-title', metric.label), el('p', 'group-blurb', metric.note ?? ''));

  const markets = sortMarkets(snapshot.markets, metric.key, state.sort === metric.key ? state.order : defaultOrder(metric));
  const values = markets.map((m) => m.values[metric.key]).filter((v) => v != null && Number.isFinite(v));
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const zero = ((0 - min) / span) * 100;
  const place = ranks(snapshot.markets, metric);
  const counted = values.length;

  const rows = el('ol', 'bars');
  rows.setAttribute('aria-label', `${metric.label} by market`);
  for (const market of markets) {
    const value = market.values[metric.key];
    const row = el('li', `bar-row${market.city === me ? ' me' : ''}`);
    const link = el('a', 'bar-link');
    link.href = writeMarketHash({ ...state, city: market.city });
    const label = el('span', 'bar-label', market.city);
    const track = el('span', 'bar-track');
    if (min < 0) {
      const axis = el('span', 'bar-zero');
      axis.style.left = `${zero}%`;
      track.append(axis);
    }
    if (value != null && Number.isFinite(value)) {
      const fill = el('span', `bar-fill${value < 0 ? ' neg' : ''}`);
      const from = value < 0 ? ((value - min) / span) * 100 : zero;
      const width = (Math.abs(value) / span) * 100;
      fill.style.left = `${from}%`;
      fill.style.width = `${Math.max(width, 0.5)}%`;
      track.append(fill);
    }
    const text = el('span', `bar-value value ${tone(value, metric)}`, formatValue(value, metric.unit));
    link.append(label, track, text);

    const rank = place.get(market.city);
    const tip = [
      `${market.city}: ${formatValue(value, metric.unit)}`,
      rank ? `${ordinal(rank)} of ${counted}` : 'No figure',
      market.periods?.[metric.key] ?? ''
    ].filter(Boolean);
    link.setAttribute('aria-label', `${tip.join(', ')}. Open ${market.city}.`);
    link.addEventListener('pointerenter', (event) => showTip(tip, event));
    link.addEventListener('pointermove', moveTip);
    link.addEventListener('pointerleave', hideTip);
    link.addEventListener('focus', () => showTip(tip, null, link));
    link.addEventListener('blur', hideTip);
    row.append(link);
    rows.append(row);
  }

  box.append(pills, head, rows);
  return box;
}

let tipNode = null;

function showTip(lines, event, anchor) {
  tipNode ??= document.body.appendChild(el('div', 'chart-tip'));
  tipNode.replaceChildren(el('strong', '', lines[0]), ...lines.slice(1).map((line) => el('span', '', line)));
  tipNode.hidden = false;
  if (event) moveTip(event);
  else if (anchor) {
    const box = anchor.getBoundingClientRect();
    placeTip(box.left + box.width / 2, box.top);
  }
}

function moveTip(event) {
  placeTip(event.clientX, event.clientY);
}

function placeTip(x, y) {
  if (!tipNode) return;
  const width = tipNode.offsetWidth;
  const left = Math.min(Math.max(8, x - width / 2), window.innerWidth - width - 8);
  tipNode.style.transform = `translate(${left}px, ${Math.max(8, y - tipNode.offsetHeight - 14)}px)`;
}

function hideTip() {
  if (tipNode) tipNode.hidden = true;
}

function headerCell(key, label, cls, metric) {
  const th = el('th', cls);
  th.scope = 'col';
  const active = state.sort === key;
  if (active) th.setAttribute('aria-sort', state.order === 'asc' ? 'ascending' : 'descending');
  const button = el('button', 'sort-button', label);
  button.type = 'button';
  if (metric?.note) button.title = metric.note;
  if (active) button.append(el('span', 'arrow', state.order === 'asc' ? ' ↑' : ' ↓'));
  button.addEventListener('click', () => {
    if (active) update({ order: state.order === 'asc' ? 'desc' : 'asc' });
    else update({ sort: key, order: key === 'city' ? 'asc' : defaultOrder(metric) });
  });
  th.append(button);
  return th;
}

function cityView(city, focus) {
  const market = snapshot.markets.find((m) => m.city === city);
  const frag = document.createDocumentFragment();

  const head = el('div', 'card market-head');
  const back = el('a', 'link', '← All markets');
  back.href = writeMarketHash({ ...state, city: '' });
  head.append(back, el('h2', 'role', market.city), el('p', 'firm', market.metro ?? ''));
  // Only this city's figures here; the all-markets chart and table live on the All markets page.
  frag.append(head, kpis(market, focus));
  const points = talkingPoints(market, focus);
  if (points) frag.append(points);
  frag.append(devMap(city));

  // The chosen property type first, then the rest.
  const groups = [focus, ...snapshot.groups.filter((g) => g.key !== focus.key)];
  const grid = el('div', 'market-groups');
  for (const group of groups) {
    const card = el('section', `card market-group${group.key === focus.key ? ' focus' : ''}`);
    card.append(el('h3', 'group-title', group.label));
    if (group.blurb) card.append(el('p', 'group-blurb', group.blurb));
    const list = el('dl', 'metric-list');
    for (const key of group.metrics) {
      const metric = metricFor(key);
      if (!metric) continue;
      const value = market.values[key];
      const place = ranks(snapshot.markets, metric).get(city);
      const term = el('dt', '', metric.label);
      if (metric.note) term.title = metric.note;
      const detail = el('dd');
      detail.append(el('span', `value ${tone(value, metric)}`, formatValue(value, metric.unit)));
      if (value != null) detail.append(strip(key, value));
      const bits = [];
      if (place) bits.push(`${ordinal(place)} of ${snapshot.markets.filter((m) => m.values[key] != null).length}`);
      if (market.periods?.[key]) bits.push(market.periods[key]);
      if (bits.length) detail.append(el('span', 'metric-meta', bits.join(' · ')));
      list.append(term, detail);
    }
    card.append(list);
    grid.append(card);
  }
  frag.append(grid);
  return frag;
}

/** How many markets have a figure for a metric. */
function counted(key) {
  return snapshot.markets.filter((m) => m.values[key] != null && Number.isFinite(m.values[key])).length;
}

/** The topic's first four figures for one city, each with its rank among the markets. */
function kpis(market, group) {
  const box = el('section', 'kpis');
  box.setAttribute('aria-label', `${market.city} headline figures`);
  for (const key of group.metrics.slice(0, 4)) {
    const metric = metricFor(key);
    if (!metric) continue;
    const value = market.values[key];
    const tile = el('div', 'card kpi');
    if (metric.note) tile.title = metric.note;
    const place = ranks(snapshot.markets, metric).get(market.city);
    const bits = [];
    if (place && metric.better) bits.push(`#${place} of ${counted(key)} markets`);
    else if (place) bits.push(`${ordinal(place)} highest of ${counted(key)}`);
    if (market.periods?.[key]) bits.push(market.periods[key]);
    tile.append(el('small', '', metric.label), el('b', `num value ${tone(value, metric)}`, formatValue(value, metric.unit)), el('span', 'kpi-rank', bits.join(' · ') || 'No figure yet'));
    box.append(tile);
  }
  return box;
}

/**
 * Up to three sentences built only from the figures on this page: where the
 * city ranks best and worst in the topic, and the 10-year Treasury's move.
 * Nothing when there is too little to say.
 */
function talkingPoints(market, group) {
  const ranked = [];
  for (const key of group.metrics) {
    const metric = metricFor(key);
    const value = market.values[key];
    if (!metric?.better || value == null) continue;
    const place = ranks(snapshot.markets, metric).get(market.city);
    const of = counted(key);
    if (place && of >= 3) ranked.push({ metric, value, place, of });
  }
  const lines = [];
  const best = [...ranked].sort((a, b) => a.place / a.of - b.place / b.of)[0];
  if (best && best.place <= Math.ceil(best.of / 3)) {
    lines.push(`${market.city} ranks ${ordinal(best.place)} of ${best.of} Texas markets on ${best.metric.label.toLowerCase()}, at ${formatValue(best.value, best.metric.unit)}.`);
  }
  const worst = [...ranked].sort((a, b) => b.place / b.of - a.place / a.of)[0];
  if (worst && worst !== best && worst.place > Math.floor((worst.of * 2) / 3)) {
    lines.push(`${market.city} trails on ${worst.metric.label.toLowerCase()}: ${formatValue(worst.value, worst.metric.unit)}, ${ordinal(worst.place)} of ${worst.of}.`);
  }
  const treasury = (snapshot.rates ?? []).find((r) => /10-year treasury/i.test(r.label));
  if (treasury && treasury.change != null && Math.abs(treasury.change) >= 0.05) {
    lines.push(
      `The 10-year Treasury is ${formatValue(treasury.value, 'taxRate')}, ${treasury.change > 0 ? 'up' : 'down'} ${formatPoints(Math.abs(treasury.change)).replace(/^\+/, '')} from a year ago (${treasury.period}), which moves what buyers can pay.`
    );
  }
  if (lines.length < 2) return null;
  const box = el('section', 'card talk-card');
  box.append(el('h3', 'group-title', `Talking points for a ${market.city} interview`));
  const list = el('ol', 'talk');
  lines.forEach((line, index) => {
    const li = el('li');
    li.append(el('span', 'talk-n', String(index + 1)), el('span', '', line));
    list.append(li);
  });
  box.append(list, el('p', 'talk-note', 'Written from the numbers on this page. Check them before you quote them.'));
  return box;
}

/** Every market as a tick on one line, this one as a dot: where it sits at a glance. */
function strip(key, value) {
  const all = snapshot.markets.map((m) => m.values[key]).filter((v) => v != null && Number.isFinite(v));
  const min = Math.min(...all);
  const span = Math.max(...all) - min || 1;
  const line = el('span', 'strip');
  line.setAttribute('aria-hidden', 'true');
  for (const v of all) {
    const tick = el('i');
    tick.style.left = `${((v - min) / span) * 100}%`;
    line.append(tick);
  }
  const dot = el('b');
  dot.style.left = `${((value - min) / span) * 100}%`;
  line.append(dot);
  return line;
}

/** Green for a change for the better, red for the worse, on growth figures only. A rise is worse where lower is better (tax rates). */
function tone(value, metric) {
  if (metric.unit !== 'change' || value == null) return '';
  const rounded = Math.round(value * 10) / 10;
  if (!rounded) return '';
  const good = metric.better === 'low' ? rounded < 0 : rounded > 0;
  return good ? 'up' : 'down';
}

/**
 * National interest rates and bank lending conditions, the same for every
 * city, as a row of tiles above the city figures. Each links to its FRED page.
 */
function rates() {
  const list = snapshot.rates ?? [];
  if (!list.length) return '';
  const box = el('section', 'card ticker');
  box.setAttribute('aria-label', 'Interest rates and lending, change from a year earlier');
  for (const rate of list) {
    const tile = el('a', 'tick');
    tile.href = rate.url;
    tile.target = '_blank';
    tile.rel = 'noopener noreferrer';
    tile.title = `${rate.note} (${rate.period})`;
    const survey = /tightening/i.test(rate.label);
    const dir = rate.change == null || Math.abs(rate.change) < 0.005 ? '' : rate.change > 0 ? ' rising' : ' falling';
    tile.append(
      el('small', '', rate.label),
      el(
        'b',
        '',
        rate.format === 'index' ? (Math.round(rate.value * 10) / 10).toFixed(1) : survey ? formatValue(rate.value, 'rate') : formatValue(rate.value, 'taxRate')
      ),
      el('span', `tick-change${dir}`, rate.change == null ? rate.period : `${formatPoints(rate.change)} yoy`)
    );
    box.append(tile);
  }
  return box;
}

/**
 * The development map, with a switcher for every city that has projects: on
 * a city's own page and on the all-markets development view. Nothing until a build has
 * read the state's project register.
 */
function devMap(city) {
  const data = snapshot.developments;
  if (!data?.projects?.length) return '';
  const cities = snapshot.markets.map((m) => m.city).filter((c) => data.projects.some((p) => p.city === c));
  // On a city's page the switcher moves to that city's page, so changing
  // areas never means backing out to All markets first.
  if (city) return cities.includes(city) ? developmentMap({ data, cities, city, bids: snapshot.bids, onCity: (next) => update({ city: next }) }) : '';
  if (!cities.includes(mapCity)) mapCity = cities[0];
  return developmentMap({
    data,
    cities,
    city: mapCity,
    bids: snapshot.bids,
    onCity: (next) => {
      mapCity = next;
      render();
    }
  });
}

/** The Texas counties that added the most people, on the migration view. */
function counties() {
  const data = snapshot.counties;
  if (!data?.rows?.length) return '';
  const box = el('section', 'card counties-card');
  box.append(
    el('h3', 'group-title', `Texas counties adding the most people, July ${data.year - 1} to July ${data.year}`),
    el('p', 'group-blurb', 'Developers follow these: fast-growing suburban counties are where new homes, retail and schools go next.')
  );
  const wrap = el('div', 'table-wrap');
  const tableNode = el('table', 'market-table');
  const head = el('tr');
  for (const [label, cls] of [['County', 'city-col'], ['People added', 'num'], ['Growth', 'num'], ['Net migration', 'num'], ['Population', 'num']]) {
    const th = el('th', cls, label);
    th.scope = 'col';
    head.append(th);
  }
  const thead = el('thead');
  thead.append(head);
  const body = el('tbody');
  data.rows.forEach((row, index) => {
    const tr = el('tr');
    const name = el('th', 'city-col');
    name.scope = 'row';
    name.append(el('span', 'rank', String(index + 1)), el('span', 'city-link', row.county), el('span', 'metro', row.market ? `${row.market} market` : ''));
    tr.append(
      name,
      el('td', 'num', formatValue(row.change, 'count')),
      el('td', 'num', formatValue(row.growth, 'change')),
      el('td', 'num', formatValue(row.migration, 'count')),
      el('td', 'num', formatValue(row.population, 'count'))
    );
    body.append(tr);
  });
  tableNode.append(thead, body);
  wrap.append(tableNode);
  box.append(wrap);
  return box;
}

function asOf(metrics) {
  const periods = new Map();
  for (const metric of metrics) {
    const seen = snapshot.markets.map((m) => m.periods?.[metric.key]).filter(Boolean);
    if (!seen.length) continue;
    // The period most markets report; a stale fallback shows on hover in the cell.
    const common = mode(seen);
    const list = periods.get(metric.source) ?? new Set();
    list.add(common);
    periods.set(metric.source, list);
  }
  const parts = [...periods].map(([source, set]) => `${source}: ${[...set].join(', ')}`);
  return el('p', 'market-asof', parts.length ? `As of ${parts.join(' · ')}` : '');
}

function mode(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

function sources() {
  const box = el('div');
  const list = el('p', '', 'Sources: ');
  snapshot.sources.forEach((source, index) => {
    const a = el('a', '', source.name);
    a.href = source.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = source.detail;
    list.append(index ? ' · ' : '', a);
  });
  box.append(
    list,
    el(
      'p',
      '',
      'Office, industrial and retail vacancy and asking rents are under Lease rates, read from the free quarterly reports brokerages publish. Tax rates are for a typical property inside each city; a parcel in another school district or a utility district pays a different total.'
    )
  );
  return box;
}

function message(text, isError = false) {
  $('m-rates').replaceChildren();
  $('m-chart').replaceChildren();
  $('m-body').replaceChildren(el('div', isError ? 'state error' : 'state', text));
  $('m-blurb').textContent = '';
}

function el(tag, cls = '', text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}
