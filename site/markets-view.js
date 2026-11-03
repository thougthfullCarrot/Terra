// markets-view.js — draws the market data section. The rules live in market.js.
//
// The page's sections (Jobs, Tracker, the Development Map, Market data, News and Events) are switched by the URL hash
// so a link can open a city's market directly (#markets&city=Houston). The
// data comes from a loader app.js hands over: market.json on the open site,
// or the members-only Supabase row when accounts are on.
import { homeOpen } from './home-view.js';
import {
  figureSource,
  CATEGORY_LABELS,
  defaultOrder,
  formatDate,
  formatPoints,
  pointsText,
  stripLayout,
  formatValue,
  GEOGRAPHY_LABELS,
  HEADLINE_METRICS,
  cityRows,
  coverage,
  metricSource,
  ordinal,
  pruneSnapshot,
  rankedCount,
  ranks,
  readMarketHash,
  retainedCount,
  sharedWith,
  sortMarkets,
  valueNotes,
  valueStatus,
  writeMarketHash
} from './market.js';
import { developmentMap, disposeMap } from './devmap.js';
import { followButton } from './watch-view.js';
import { marketItem } from './watch.js';
import { leasesView, reportsView } from './market-tools.js';
import { growthView, zoningView } from './insights-view.js';
import { readNewsHash } from './news.js';
import { readEventsHash } from './events.js';
import { stateBox } from './labels.js';
import { countText, placeOf, project, texasMap } from './live.js';
import { field } from './contour.js';

const $ = (id) => document.getElementById(id);

let loader = null;
/** null until loaded; a promise while loading. */
let snapshot = null;
let loading = null;
let state = null;
let bound = false;
/** The city the all-markets development map shows. */
let mapCity = null;
/** Each market's full development list (developments/<market>.json): city -> 'loading' | 'done' | 'failed'. */
const devFiles = new Map();

/** A market's development file from the open site. */
async function fetchDevFile(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}
/** Where each market's development file comes from: the site, or the members-only row. */
let devLoader = fetchDevFile;

/**
 * Set where the data comes from. null (signed out) hides any data already drawn.
 * devFileLoader(path) reads one market's development list; the site's own file by default.
 */
export function setMarketLoader(next, devFileLoader = null) {
  loader = next;
  devLoader = devFileLoader ?? fetchDevFile;
  snapshot = null;
  loading = null;
  devFiles.clear();
  disposeMap();
  $('m-body').replaceChildren();
  $('m-chart').replaceChildren();
  $('m-rates').replaceChildren();
  if (next && readMarketHash(location.hash, null).open) show();
}

/**
 * The market data file, loaded once. null when signed out or not built yet.
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

/** A metric's label for the watchlist, or the key before the market data has loaded. */
export function metricName(key) {
  return snapshot?.metrics?.find((m) => m.key === key)?.label ?? key;
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
  if (homeOpen() && !$('tab-home').hidden) return 'home';
  if (readMarketHash(location.hash, null).open) return 'markets';
  if (readNewsHash(location.hash, null).open) return 'news';
  if (readEventsHash(location.hash, null).open) return 'events';
  if (new URLSearchParams(location.hash.replace(/^#/, '')).has('tracker') && !$('tab-tracker').hidden) return 'tracker';
  return 'jobs';
}

async function show() {
  const active = section();
  const open = active === 'markets';
  // style.css keeps the job counts in the masthead to the Jobs tab.
  document.body.dataset.section = active;
  // news-view.js and events-view.js show their own sections; the others step aside for it.
  for (const name of ['jobs', 'markets', 'tracker']) $(`${name}-view`).hidden = name !== active;
  $('home-view').hidden = active !== 'home';
  // The Development Map has its own tab, though it lives in the market data section.
  const tab = open && readMarketHash(location.hash, null).tool === 'map' ? 'map' : active;
  for (const name of ['home', 'jobs', 'map', 'markets', 'tracker', 'news', 'events']) {
    if (name === tab) $(`tab-${name}`).setAttribute('aria-current', 'page');
    else $(`tab-${name}`).removeAttribute('aria-current');
  }
  if (!open) {
    delete document.body.dataset.workspace;
    return;
  }

  if (!snapshot) {
    if (!loader) return;
    message('Loading market data…', 'loading');
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
      // Two show() calls can await the same load (the tracker calls it when its
      // tab appears); the first one's snapshot stands, or a development file
      // already on its way would be dropped as stale.
      snapshot ??= pruneSnapshot(data);
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
  // The overview's table sorts from its own column headers.
  $('m-sort-label').hidden = true;
  $('m-order-label').hidden = true;
  // The topic means nothing to the broker views.
  $('m-focus-label').hidden = ['leases', 'reports', ...INSIGHTS].includes(tool);
  // The development map is its own full-height workspace under the header.
  if (tool === 'map') document.body.dataset.workspace = 'map';
  else delete document.body.dataset.workspace;
  for (const name of ['', 'map', 'leases', 'reports', ...INSIGHTS]) {
    const link = $(`m-tool-${name || 'data'}`);
    link.href = writeMarketHash({ ...state, tool: name, compare: [] });
    if (tool === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  $('m-filters').hidden = false;
  disposeMap();
  dropField();
  if (tool === 'map') {
    $('m-blurb').textContent = '';
    $('m-rates').replaceChildren();
    $('m-chart').replaceChildren();
    $('m-sources').replaceChildren();
    $('m-body').replaceChildren(devMap(state.city || null, true) || mapMissing());
    return;
  }
  if (tool) {
    $('m-blurb').textContent = TOOL_BLURBS[tool];
    $('m-rates').replaceChildren();
    $('m-chart').replaceChildren();
    $('m-body').replaceChildren(toolView(tool));
    // The broker tools carry their own source notes.
    $('m-sources').replaceChildren(...(['leases', 'reports', ...INSIGHTS].includes(tool) ? [] : [sources()]));
    return;
  }

  // A city's page has its own picker and topic tabs.
  $('m-filters').hidden = Boolean(state.city);
  $('m-blurb').textContent = state.city ? '' : (group.blurb ?? '');
  $('m-rates').replaceChildren(rates());
  // All markets: the comparison table beside the picked city's panel, the map's entry and the chart under it.
  $('m-chart').replaceChildren();
  $('m-body').replaceChildren(...(state.city ? [cityView(state.city, group)] : [overview(group), ...(group.key === 'development' ? [devTeaser()] : [])]));
  if (!state.city && group.key === 'migration') $('m-body').append(counties());
  $('m-sources').replaceChildren(sources());
}

/** Tools that carry their own source notes and need no topic (insights-view.js). */
const INSIGHTS = ['zoning', 'growth'];

const TOOL_BLURBS = {
  leases: 'Office, industrial and retail vacancy and asking rents from brokerages\' free quarterly reports.',
  reports: 'The latest free quarterly market reports from the big brokerages, by city.',
  zoning: 'Rezoning requests and special use permits on city agendas: the earliest public sign of a new project.',
  growth: "Firms posting jobs lined up against the projects they are building, and the developers who will likely hire next."
};

function toolView(tool) {
  if (tool === 'leases') return leasesView(snapshot, state.city);
  if (tool === 'reports') return reportsView(snapshot, state.city);
  if (tool === 'zoning') return zoningView(snapshot, state.city);
  return growthView(snapshot, state.city);
}

/** The city the all-markets panel shows; a table row's click picks it. */
let sideCity = null;

/** The contour field behind the relief map, and its teardown. */
let reliefField = null;

function dropField() {
  if (reliefField) reliefField();
  reliefField = null;
}

/**
 * All markets as terrain: every city a peak on the Texas outline, sized by the
 * figure picked above it, over the same contour field as the landing page. The
 * ranked list beside it carries the numbers for that one figure; every figure
 * for every market stays in the table underneath.
 */
function overview(group) {
  const metric = reliefMetric(group);
  const markets = sortMarkets(snapshot.markets, state.sort, state.order);
  if (!markets.some((m) => m.city === sideCity)) sideCity = markets[0]?.city ?? null;

  const box = el('div', 'market-relief');
  box.append(reliefSheet(group, metric), reliefSide(group, metric, markets));

  const frag = document.createDocumentFragment();
  frag.append(box, reliefTable(group));
  return frag;
}

/** The figure the peaks are sized by: the chosen sort, or the topic's first. */
function reliefMetric(group) {
  const sorted = metricFor(state.sort);
  return sorted ?? group.metrics.map(metricFor).find(Boolean) ?? null;
}

/** The figure's spread across the markets that have one, for sizing the peaks. */
function reliefRange(metric) {
  const values = metric ? snapshot.markets.map((m) => m.values[metric.key]).filter((v) => v != null) : [];
  if (!values.length) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  // A figure that can go negative is measured from its own floor, so a fall
  // reads as a small peak rather than an inverted one.
  return { low, high, span: high - low };
}

const PEAK_MIN = 4;
const PEAK_MAX = 19;

function peakRadius(value, range) {
  if (value == null || !range) return 3;
  if (!range.span) return (PEAK_MIN + PEAK_MAX) / 2;
  return PEAK_MIN + ((value - range.low) / range.span) * (PEAK_MAX - PEAK_MIN);
}

/** The map itself, with the figure picker above it and a size key below. */
function reliefSheet(group, metric) {
  const sheet = el('section', 'card relief-sheet');
  sheet.setAttribute('aria-label', 'Texas markets as terrain');

  const head = el('div', 'relief-head');
  const caption = el('h2', 'relief-caption', metric?.label ?? 'Markets');
  const period = snapshot.markets.find((m) => m.city === sideCity)?.periods?.[metric?.key];
  if (period) caption.append(el('span', 'relief-period', period));
  head.append(caption, metricPills(group, metric));
  sheet.append(head);

  const body = el('div', 'relief-body');
  const map = reliefMap(metric);
  if (map) {
    body.append(map);
    // The same contour field as the landing page, behind the state outline.
    // The view is rebuilt on every pick, so the last one has to be released.
    dropField();
    reliefField = field(body, [0.62, 0.42]);
  } else {
    body.append(stateBox('empty', 'No market on this topic has a figure to map yet.'));
  }
  const key = reliefKey(metric);
  if (key) body.append(key);
  sheet.append(body);
  return sheet;
}

/** The figure pills, the same control the chart uses. */
function metricPills(group, metric) {
  const pills = el('div', 'metric-pills');
  pills.setAttribute('role', 'group');
  pills.setAttribute('aria-label', 'Figure to map');
  for (const key of group.metrics) {
    const each = metricFor(key);
    if (!each) continue;
    const pill = el('button', 'chip', each.label);
    pill.type = 'button';
    pill.setAttribute('aria-pressed', String(each.key === metric?.key));
    pill.title = metricTitle(each);
    pill.addEventListener('click', () => update({ sort: each.key, order: defaultOrder(each) }));
    pills.append(pill);
  }
  return pills;
}

/** A label's size in map units: 13px type at ~0.6em a character, plus room
    for the 4px stroke that keeps it legible over the contours. */
const LABEL_H = 13;
const LABEL_CH = 7.8;
const LABEL_PAD = 3;

const overlaps = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/**
 * Where each label goes, or whether it shows at all. Labels are placed biggest
 * peak first (the picked market before anything), each trying its usual side
 * and then the other, and kept on the first side where it covers no dot and no
 * label already placed. Dallas and Fort Worth, Houston and Galveston, San
 * Antonio and New Braunfels, and the Austin cluster are close enough that some
 * labels find no clear side and are left off rather than drawn over a dot; the
 * picked market always keeps its own. Every dot still names itself on hover
 * and to a screen reader.
 */
function placeLabels(places, picked) {
  const dots = places.map((p) => {
    const [x, y] = project(p.place.at);
    // The dot blocks a label; its faint halo does not, since every label carries
    // a stroke that reads over it. Counting the halo left Houston and Austin
    // unlabelled on crowded figures.
    return { p, x, y, box: [x - p.r - 2, y - p.r - 2, x + p.r + 2, y + p.r + 2] };
  });
  const order = [...dots].sort((a, b) => {
    if (a.p.market.city === picked) return -1;
    if (b.p.market.city === picked) return 1;
    return b.p.r - a.p.r;
  });
  const placed = [];
  const sides = new Map();
  for (const d of order) {
    const w = d.p.market.city.length * LABEL_CH;
    const gap = d.p.r + 5;
    const top = d.y - LABEL_H + 4 - LABEL_PAD;
    const bottom = d.y + 4 + LABEL_PAD;
    const boxFor = (side) =>
      side > 0 ? [d.x + gap - LABEL_PAD, top, d.x + gap + w + LABEL_PAD, bottom] : [d.x - gap - w - LABEL_PAD, top, d.x - gap + LABEL_PAD, bottom];
    const onDots = (box) => dots.filter((o) => o !== d && overlaps(box, o.box)).length;
    const onLabels = (box) => placed.filter((b) => overlaps(box, b)).length;
    const usual = d.p.place.at[0] < -97.5 ? -1 : 1;
    const tries = [usual, -usual].map((side) => {
      const box = boxFor(side);
      return { side, box, dots: onDots(box), labels: onLabels(box) };
    });
    const clear = tries.find((t) => t.dots === 0 && t.labels === 0);
    // Forcing big peaks to be named was tried and was worse: on the tax topics
    // New Braunfels becomes a top peak and its label lands across three dots.
    // Only the picked market, which has to be named, may take the least-bad side.
    const fallback = d.p.market.city === picked ? [...tries].sort((a, b) => a.labels - b.labels || a.dots - b.dots)[0] : null;
    const pick = clear ?? fallback;
    if (!pick) continue;
    sides.set(d.p.market.city, pick.side);
    placed.push(pick.box);
  }
  return sides;
}

/** Every market as a peak, sized by the figure; picking one moves the panel. */
function reliefMap(metric) {
  const places = snapshot.markets.map((m) => ({ market: m, place: placeOf(m.city) })).filter((x) => x.place);
  if (places.length < 2) return null;
  const range = reliefRange(metric);
  // A city repeating another's metro figure (Galveston showing Houston's) would
  // otherwise draw a second peak the size of the first and count that metro
  // twice, so it keeps a small marker on the map and the figure stays with the
  // city it belongs to.
  const copies = (market) => Boolean(metric && market.values[metric.key] != null && sharedWith(market, metric.key));
  const sized = places.map((entry) => ({
    ...entry,
    copy: copies(entry.market),
    r: copies(entry.market) ? 3 : peakRadius(metric ? entry.market.values[metric.key] : null, range)
  }));
  const sides = placeLabels(sized, sideCity);
  const box = el('div', 'relief-map');
  box.append(
    texasMap(
      sized.map(({ market, place, r, copy }) => ({
        name: market.city,
        at: place.at,
        r,
        label: sides.has(market.city) ? market.city : '',
        side: sides.get(market.city) ?? 1,
        tone: copy ? 'shared' : metric && market.values[metric.key] == null ? 'blank' : '',
        onPick: (name) => {
          sideCity = name;
          render();
        }
      })),
      {
        label: `Texas markets sized by ${metric?.label ?? 'the chosen figure'}: pick one to show it beside the map`,
        picked: sideCity,
        from: mapFrom,
        animate: !mapDrawn
      }
    )
  );
  mapDrawn = true;
  mapFrom = sideCity;
  return box;
}

/** What a peak's size means, as four dots across the figure's own range. */
function reliefKey(metric) {
  const range = reliefRange(metric);
  if (!metric || !range || !range.span) return null;
  const key = el('div', 'relief-key');
  key.append(el('b', '', metric.label));
  const dots = el('div', 'relief-key-dots');
  for (const step of [0, 1 / 3, 2 / 3, 1]) {
    const value = range.low + range.span * step;
    const size = Math.round(peakRadius(value, range) * 2);
    const item = el('span', '');
    const dot = el('i', '');
    dot.style.width = `${size}px`;
    dot.style.height = `${size}px`;
    item.append(dot, el('small', '', formatValue(value, metric.unit)));
    dots.append(item);
  }
  key.append(dots);
  return key;
}

/** The ranked list and the picked market's panel, beside the map. */
function reliefSide(group, metric, markets) {
  const side = el('div', 'relief-side');

  const ranked = el('section', 'card relief-ranked');
  ranked.append(el('h2', 'relief-ranked-head', metric ? `Ranked by ${metric.label.toLowerCase()}` : 'Markets'));
  const range = reliefRange(metric);
  const list = el('ol', 'rank-list');
  // On a tie, a city repeating another's metro figure follows the city it
  // repeats, so Galveston comes after Houston rather than above it. Equal
  // values are adjacent in the sorted list, which keeps this a total order.
  const at = new Map(markets.map((m, i) => [m, i]));
  const copy = (m) => (metric && sharedWith(m, metric.key) ? 1 : 0);
  const order = [...markets].sort((a, b) => {
    const tie = metric && a.values[metric.key] != null && a.values[metric.key] === b.values[metric.key];
    return (tie ? copy(a) - copy(b) : 0) || at.get(a) - at.get(b);
  });
  for (const [place, market] of order.entries()) {
    const value = metric ? market.values[metric.key] : null;
    const row = el('li', `rank-row${market.city === sideCity ? ' on' : ''}`);
    const pick = el('button', 'rank-pick');
    pick.type = 'button';
    pick.setAttribute('aria-pressed', String(market.city === sideCity));
    pick.addEventListener('click', () => {
      sideCity = market.city;
      render();
    });
    // New Braunfels repeats the San Antonio metro's figures, Galveston Houston's:
    // correct, but two identical rows read as a bug unless the second says so.
    const same = value != null && metric ? sharedWith(market, metric.key) : null;
    if (same) {
      row.classList.add('shared');
      pick.title = `${market.city} shows the ${same} metro's figure`;
    }
    const name = el('span', 'rank-city', market.city);
    if (same) name.append(el('small', 'rank-same', `same as ${same}`));
    pick.append(el('span', 'rank-n num', String(place + 1)), name);
    const bar = el('span', 'rank-bar');
    if (value != null && range?.span) {
      const fill = el('i', '');
      fill.style.width = `${Math.max(2, ((value - range.low) / range.span) * 100)}%`;
      bar.append(fill);
    }
    pick.append(bar, el('span', `rank-value num ${tone(value, metric ?? {})}`, formatValue(value, metric?.unit)));
    row.append(pick);
    list.append(row);
  }
  ranked.append(list);
  side.append(ranked);

  const market = snapshot.markets.find((m) => m.city === sideCity);
  if (market) {
    const panel = el('aside', 'card market-side relief-detail');
    panel.setAttribute('aria-live', 'polite');
    panel.setAttribute('aria-label', `${market.city} at a glance`);
    const head = el('div', 'market-side-head');
    head.append(el('h2', 'market-side-city', market.city), el('p', 'market-side-metro', market.metro ?? ''));
    const follow = watchControls(market.city);
    if (follow) head.append(follow);
    panel.append(head);
    panel.append(countKpis(kpis(market, group), market.city));
    const missing = group.metrics.slice(0, 4).filter((key) => market.values[key] == null).length;
    if (missing) panel.append(el('p', 'market-side-note', `${missing === 1 ? 'One figure has' : `${missing} figures have`} no published value for ${market.city} yet.`));
    const links = el('div', 'market-side-links');
    const open = el('a', 'primary', `Open ${market.city}'s page`);
    open.href = writeMarketHash({ ...state, city: market.city });
    links.append(open);
    if (snapshot.developments?.projects?.some((p) => p.city === market.city)) {
      const map = el('a', 'secondary', 'Development map');
      map.href = writeMarketHash({ ...state, tool: 'map', city: market.city });
      links.append(map);
    }
    panel.append(links);
    side.append(panel);
  }
  return side;
}

/**
 * Every figure for every market, under the map. The relief map shows one
 * figure at a time, so the full comparison has to stay reachable.
 */
function reliefTable(group) {
  const fold = el('details', 'chart-fold relief-fold');
  fold.open = tableOpen;
  fold.addEventListener('toggle', () => (tableOpen = fold.open));
  fold.append(
    el('summary', 'chart-fold-summary', 'Show every figure as a table'),
    table(group, sideCity, (city) => {
      sideCity = city;
      render();
    })
  );
  return fold;
}
let tableOpen = false;

/** Which market the ring sat on last, so a pick glides it across the map. */
let mapFrom = null;
let mapDrawn = false;

/** Headline figures count from the last city's values to this one's. */
let lastKpis = null;
function countKpis(box, city) {
  const now = new Map([...box.querySelectorAll('.kpi')].map((tile) => [tile.querySelector('small')?.textContent, tile.querySelector('.value')]));
  if (lastKpis && lastKpis.city !== city)
    for (const [key, node] of now) {
      const was = lastKpis.values.get(key);
      if (node && was) countText(node, was, node.textContent);
    }
  lastKpis = { city, values: new Map([...now].map(([key, node]) => [key, node?.textContent])) };
  return box;
}

function table(group, me = '', onPick = null) {
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
    // The overview picks a city for its side panel; the city's name still opens its own page.
    if (onPick) {
      row.classList.add('pickable');
      row.addEventListener('click', (event) => {
        if (!event.target.closest('a, button')) onPick(market.city);
      });
    }
    const name = el('th', 'city-col');
    name.scope = 'row';
    if (placeFor?.has(market.city)) name.append(el('span', 'rank', String(placeFor.get(market.city))));
    const link = el('a', 'city-link', market.city);
    link.href = writeMarketHash({ ...state, city: market.city });
    name.append(link, el('span', 'metro', market.metro ?? ''));
    if (onPick) {
      const pick = el('button', 'link market-pick', market.city === me ? 'Shown' : 'Show');
      pick.type = 'button';
      pick.setAttribute('aria-label', `Show ${market.city} in the side panel`);
      pick.setAttribute('aria-pressed', String(market.city === me));
      pick.addEventListener('click', () => onPick(market.city));
      name.append(pick);
    }
    row.append(name);

    for (const metric of metrics) {
      const value = market.values[metric.key];
      const cell = el('td', `num${metric.key === state.sort ? ' sorted' : ''}`);
      const text = el('span', `value ${tone(value, metric)}`, formatValue(value, metric.unit));
      const notes = valueNotes(market, metric);
      if (notes.length) text.title = notes.join('\n');
      cell.append(text);
      if (valueStatus(market, metric.key) === 'retained') cell.append(staleMark());
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

function headerCell(key, label, cls, metric) {
  const th = el('th', cls);
  th.scope = 'col';
  const active = state.sort === key;
  if (active) th.setAttribute('aria-sort', state.order === 'asc' ? 'ascending' : 'descending');
  const button = el('button', 'sort-button', label);
  button.type = 'button';
  if (metric) button.title = metricTitle(metric);
  if (active) button.append(el('span', 'arrow', state.order === 'asc' ? ' ↑' : ' ↓'));
  button.addEventListener('click', () => {
    if (active) update({ order: state.order === 'asc' ? 'desc' : 'asc' });
    else update({ sort: key, order: key === 'city' ? 'asc' : defaultOrder(metric) });
  });
  th.append(button);
  if (metric) th.append(el('span', 'figure-source', columnSource(metric)));
  return th;
}

/** A column's source and the period most markets report, under its heading; a city on another period shows it on hover in its cell. */
function columnSource(metric) {
  const seen = snapshot.markets.map((m) => m.periods?.[metric.key]).filter(Boolean);
  return [metric.source, seen.length ? mode(seen) : ''].filter(Boolean).join(' · ');
}

/**
 * One city's page: a header with the city picker and how much of the data it
 * has, the four headline figures, then one topic at a time as a plain table
 * of metric, value and period. Sources, areas and methods fold under each row;
 * figures with nothing published are summed up in one note instead of rows of dashes.
 */
function cityView(city, focus) {
  const market = snapshot.markets.find((m) => m.city === city);
  const frag = document.createDocumentFragment();
  frag.append(cityHead(market), headline(market));

  const box = el('section', 'card city-topics');
  box.setAttribute('aria-label', `${market.city} figures by topic`);
  const tabs = el('div', 'city-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Topic');
  const buttons = snapshot.groups.map((group) => {
    const tab = el('button', 'city-tab', group.label);
    tab.type = 'button';
    tab.id = `city-tab-${group.key}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', 'city-panel');
    const on = group.key === focus.key;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    tab.addEventListener('click', () => pickTopic(group.key));
    return tab;
  });
  // Arrow keys move between topics, as in any tab list; Home and End jump to the ends.
  tabs.addEventListener('keydown', (event) => {
    const at = buttons.indexOf(document.activeElement);
    if (at < 0) return;
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: buttons.length - 1 }[event.key];
    if (next == null) return;
    event.preventDefault();
    pickTopic(snapshot.groups[(next + buttons.length) % buttons.length].key);
  });
  tabs.append(...buttons);

  const panel = el('div', 'city-panel');
  panel.id = 'city-panel';
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', `city-tab-${focus.key}`);
  panel.append(el('h3', 'group-title', focus.label));
  if (focus.blurb) panel.append(el('p', 'group-blurb', focus.blurb));
  const { rows, missing } = cityRows(snapshot, market, focus);
  const shown = focus.metrics.filter((key) => HEADLINE_METRICS.includes(key)).length;
  if (rows.length) panel.append(detailTable(market, focus, rows));
  else panel.append(el('p', 'city-empty', shown ? 'This topic\'s figures are the headline figures above.' : `No figures in this topic have been published for ${market.city} yet.`));
  if (rows.length && shown) panel.append(el('p', 'city-note', `${shown === 1 ? 'One figure' : `${shown} figures`} in this topic ${shown === 1 ? 'is' : 'are'} shown in the headline figures above.`));
  if (missing.length) panel.append(missingNote(market, missing));
  box.append(tabs, panel);
  frag.append(box);

  const points = talkingPoints(market, focus);
  if (points) frag.append(points);
  frag.append(devTeaser(city));
  return frag;
}

/** Open another topic and keep focus on its tab, so arrow keys keep working after the redraw. */
function pickTopic(key) {
  const group = snapshot.groups.find((g) => g.key === key);
  update({ focus: key, sort: group?.metrics[0] ?? 'city', order: defaultOrder(metricFor(group?.metrics[0])) });
  document.getElementById(`city-tab-${key}`)?.focus();
}

/** The city's name, a picker for another city, its metro, and how much of the data it has. */
function cityHead(market) {
  const head = el('div', 'card market-head city-head');
  const back = el('a', 'link', '← All markets');
  back.href = writeMarketHash({ ...state, city: '' });
  const top = el('div', 'city-head-top');
  const name = el('div', 'city-head-name');
  name.append(el('h2', 'role', market.city), el('p', 'firm', market.metro ? `Metro: ${market.metro}` : ''));
  const picker = el('label', 'city-picker');
  const select = el('select');
  select.append(...snapshot.markets.map((m) => new Option(m.city, m.city)));
  select.value = market.city;
  select.addEventListener('change', () => update({ city: select.value }));
  picker.append(el('span', 'eyebrow', 'City'), select);
  top.append(name, picker);
  head.append(back, top);
  const { have, total } = coverage(snapshot, market);
  const line = [`${have} of ${total} figures published for ${market.city}`];
  const built = formatDate(snapshot.generatedAt);
  if (built) line.push(`updated ${built}`);
  head.append(el('p', 'city-coverage', `${line.join(' · ')}. Figures cover different areas (city limits, county or metro) and periods; each row says which.`));
  const fresh = freshnessLine();
  if (fresh && fresh !== `Updated ${built}`) {
    const more = el('details', 'city-fold');
    more.append(el('summary', '', 'Data freshness'), el('p', '', fresh));
    head.append(more);
  }
  const follow = watchControls(market.city);
  if (follow) head.append(follow);
  return head;
}

/** Job growth, unemployment, population growth and net migration, each with its own period and area. */
function headline(market) {
  const box = el('section', 'kpis city-kpis');
  box.setAttribute('aria-label', `${market.city} headline figures`);
  for (const key of HEADLINE_METRICS) {
    const metric = metricFor(key);
    if (!metric) continue;
    const value = market.values[key];
    const tile = el('div', 'card kpi');
    tile.append(el('small', '', metric.label), el('b', `num value ${tone(value, metric)}`, formatValue(value, metric.unit)));
    if (value != null) {
      // Real periods often name their area already ("Sep 2026, San Antonio metro"); don't say it twice.
      const period = market.periods?.[key];
      const bits = [period, period?.includes(',') ? '' : areaText(market, metric)].filter(Boolean);
      tile.append(el('span', 'kpi-rank', bits.join(' · ')));
      if (valueStatus(market, key) === 'retained') tile.append(el('span', 'kpi-rank', 'Not refreshed on the latest update'));
    } else tile.append(el('span', 'kpi-rank', 'Not published yet'));
    tile.append(el('span', 'figure-source', key === 'pepGrowth' ? 'Census population estimates' : metric.source));
    box.append(tile);
  }
  return box;
}

/**
 * A metric's name in the detail table. The survey's population figures carry
 * "(ACS)" so they never read as the same measure as the Census estimates.
 */
function cityLabel(metric) {
  if (metric.key === 'taxRateChange') return 'Tax rate change (percent change in the rate, not points)';
  return metric.source === 'Census ACS' && /^Population/.test(metric.label) ? `${metric.label} (ACS)` : metric.label;
}

/** The area a figure covers, naming the city it repeats when it is another city's metro figure. */
function areaText(market, metric) {
  const where = GEOGRAPHY_LABELS[metric.geography] ?? '';
  const same = sharedWith(market, metric.key);
  return same ? `${same}'s ${where || 'area'}` : where;
}

/** The topic's figures: metric, value and period, with source, area and method folded under each name. */
function detailTable(market, group, rows) {
  const tableNode = el('table', 'city-table');
  tableNode.append(el('caption', 'visually-hidden', `${market.city}: ${group.label}`));
  const head = el('tr');
  for (const [label, cls] of [['Metric', 'city-metric'], ['Value', 'num'], ['Period', 'city-period']]) {
    const th = el('th', cls, label);
    th.scope = 'col';
    head.append(th);
  }
  const thead = el('thead');
  thead.append(head);
  const body = el('tbody');
  for (const { metric, value, period, status } of rows) {
    const tr = el('tr');
    const name = el('th', 'city-metric');
    name.scope = 'row';
    name.append(el('span', 'city-metric-name', cityLabel(metric)), sourceFold(market, metric));
    const cell = el('td', 'num', '');
    cell.dataset.label = 'Value';
    cell.append(el('span', `value ${tone(value, metric)}`, formatValue(value, metric.unit)));
    if (status === 'retained') cell.append(staleMark());
    const when = el('td', 'city-period', period ?? 'Not stated');
    when.dataset.label = 'Period';
    tr.append(name, cell, when);
    body.append(tr);
  }
  tableNode.append(thead, body);
  return tableNode;
}

/** A row's "Source and method" fold: what the figure is, the area it covers, and a link to its publisher. */
function sourceFold(market, metric) {
  const fold = el('details', 'city-fold');
  const summary = el('summary', '', 'Source and method');
  summary.setAttribute('aria-label', `Source and method for ${metric.label}`);
  fold.append(summary);
  const list = el('dl', 'city-fold-list');
  const add = (term, node) => {
    const dd = el('dd');
    dd.append(node);
    list.append(el('dt', '', term), dd);
  };
  const source = metricSource(snapshot, metric);
  if (source) {
    const a = el('a', '', source.name);
    a.href = source.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    add('Source', a);
  } else add('Source', document.createTextNode(metric.source));
  add('Area', document.createTextNode(areaText(market, metric) || 'Not stated'));
  if (metric.note) add('Method', document.createTextNode(metric.note));
  const extra = valueNotes(market, metric).filter((line) => /^(Not refreshed|Same figure)/.test(line));
  if (extra.length) add('Note', document.createTextNode(extra.join(' ')));
  fold.append(list);
  return fold;
}

/** One line for the figures a topic has nothing published for, with the list folded under it. */
function missingNote(market, missing) {
  const fold = el('details', 'city-fold city-missing');
  const n = missing.length;
  fold.append(el('summary', '', `${n === 1 ? 'One figure is' : `${n} figures are`} not available for ${market.city}`));
  const list = el('ul', 'city-missing-list');
  for (const { metric, status } of missing) {
    const why = status === 'expired' ? 'removed: the source stopped answering' : 'not published for this area';
    list.append(el('li', '', `${metric.label} (${metric.source}): ${why}`));
  }
  fold.append(list);
  return fold;
}

/**
 * Follow this market's figures (watchlists, migration 0017): every figure, or
 * one figure with an optional line it must cross. Null while watchlists are off.
 */
function watchControls(city) {
  const all = followButton(marketItem(city), 'Follow this market');
  if (!all) return null;
  const box = el('div', 'watch-controls');
  box.append(all);
  const details = el('details', 'watch-metric');
  details.append(el('summary', '', 'Follow one figure'));
  const pick = el('select');
  pick.setAttribute('aria-label', 'Figure');
  for (const metric of snapshot.metrics) pick.append(new Option(metric.label, metric.key));
  const dir = el('select');
  dir.setAttribute('aria-label', 'When');
  for (const [value, text] of [['', 'any change'], ['above', 'rises above'], ['below', 'falls below']]) dir.append(new Option(text, value));
  const line = el('input');
  line.type = 'number';
  line.step = 'any';
  line.placeholder = 'value';
  line.setAttribute('aria-label', 'Value');
  const slot = el('span', 'watch-metric-button');
  const redraw = () => {
    const value = line.value === '' ? NaN : Number(line.value);
    const threshold = dir.value && Number.isFinite(value) ? { [dir.value]: value } : {};
    slot.replaceChildren(followButton(marketItem(city, pick.value, threshold), 'Follow') ?? '');
  };
  for (const input of [pick, dir, line]) input.addEventListener('change', redraw);
  redraw();
  details.append(pick, dir, line, slot);
  box.append(details);
  return box;
}

/** How many markets are ranked on a metric (a shared metro counts once). */
function counted(key) {
  return rankedCount(snapshot.markets, key);
}

/** A metric's hover text: what it is, what kind of figure, and the area it covers. */
function metricTitle(metric) {
  return [metric.note, categoryText(metric)].filter(Boolean).join('\n');
}

function categoryText(metric) {
  const kind = CATEGORY_LABELS[metric.category];
  const where = GEOGRAPHY_LABELS[metric.geography];
  if (!kind && !where) return '';
  return `${kind ?? ''}${kind && where ? ' figure, ' : ''}${where ? `by ${where}` : ''}`;
}

/** The mark beside a figure kept from an earlier update because its source did not refresh. */
function staleMark() {
  const mark = el('span', 'stale-mark', '•');
  mark.title = 'Not refreshed on the latest update: an earlier figure is shown';
  mark.setAttribute('aria-label', 'not refreshed on the latest update');
  return mark;
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
    const place = ranks(snapshot.markets, metric).get(market.city);
    const bits = [];
    if (place && metric.better) bits.push(`#${place} of ${counted(key)} markets`);
    else if (place) bits.push(`${ordinal(place)} highest of ${counted(key)}`);
    if (market.periods?.[key]) bits.push(market.periods[key]);
    if (valueStatus(market, key) === 'retained') bits.push('not refreshed');
    const same = sharedWith(market, key);
    if (same && value != null) bits.push(`same as ${same}`);
    tile.title = [metricTitle(metric), ...valueNotes(market, metric)].join('\n');
    tile.append(el('small', '', metric.label), el('b', `num value ${tone(value, metric)}`, formatValue(value, metric.unit)), el('span', 'kpi-rank', bits.join(' · ') || 'No figure yet'));
    if (value != null) tile.append(el('span', 'figure-source', figureSource(market, metric)));
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
      `The 10-year Treasury is ${formatValue(treasury.value, 'taxRate')}, ${treasury.change > 0 ? 'up' : 'down'} ${pointsText(treasury.change)} from a year ago (${treasury.period}), which moves what buyers can pay.`
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
  // Even rows: the last tile stretches to close its row at each width (style.css).
  for (const [name, max] of [['wide', 5], ['mid', 3], ['narrow', 2]]) {
    const { cols, span } = stripLayout(list.length, max);
    box.style.setProperty(`--cols-${name}`, String(cols));
    box.style.setProperty(`--span-${name}`, String(span));
  }
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
      el('span', `tick-change${dir}`, rate.change == null ? rate.period : rate.format === 'index' ? `${formatPoints(rate.change).replace(' pts', ' index pts')} yoy` : `${formatPoints(rate.change)} yoy`)
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
function devMap(city, workspace = false) {
  const data = snapshot.developments;
  if (!data?.projects?.length) return '';
  const cities = snapshot.markets.map((m) => m.city).filter((c) => data.projects.some((p) => p.city === c));
  // In the workspace the city is in the URL, so the switcher moves the hash
  // and a link or the back button opens the same metro.
  if (workspace) {
    const pick = cities.includes(city) ? city : cities.includes(mapCity) ? mapCity : cities[0];
    mapCity = pick;
    loadDevFile(data, pick);
    return developmentMap({ data, cities, city: pick, bids: snapshot.bids, onCity: (next) => update({ city: next }), back: writeMarketHash({ ...state, tool: '', city: '' }) });
  }
  // On a city's page the switcher moves to that city's page, so changing
  // areas never means backing out to All markets first.
  if (city) loadDevFile(data, city);
  if (city) return cities.includes(city) ? developmentMap({ data, cities, city, bids: snapshot.bids, onCity: (next) => update({ city: next }) }) : '';
  if (!cities.includes(mapCity)) mapCity = cities[0];
  loadDevFile(data, mapCity);
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

/** The workspace with no development data in this build. */
function mapMissing() {
  const box = el('div', 'card state');
  box.append(el('p', '', 'No development projects in this build yet.'));
  const back = el('a', 'link', '← Market data');
  back.href = writeMarketHash({ ...state, tool: '', city: '' });
  box.append(back);
  return box;
}

/**
 * The development map's entry on the market pages: what the map holds for
 * this city (or every market) and a link into the full-height workspace.
 */
function devTeaser(city) {
  const data = snapshot.developments;
  if (!data?.projects?.length) return '';
  const cities = snapshot.markets.map((m) => m.city).filter((c) => data.projects.some((p) => p.city === c));
  if (city && !cities.includes(city)) return '';
  const rows = city ? data.projects.filter((p) => p.city === city) : data.projects;
  const listed = city ? (data.metros?.find((m) => m.city === city)?.listed ?? rows.length) : null;
  const card = el('section', 'card devx-teaser');
  card.setAttribute('aria-labelledby', 'dev-teaser-title');
  const text = el('div', 'devx-teaser-text');
  const title = el('h2', 'devx-teaser-title', city ? `What's being built in ${city}` : "What's being built across Texas");
  title.id = 'dev-teaser-title';
  const count = listed ?? rows.length;
  text.append(
    title,
    el('p', 'devx-teaser-note', city ? `${count.toLocaleString('en-US')} filed projects from state TABS filings${rows.some((p) => p.source === 'city') ? ' and city permits' : ''}, with a list, filters and a filings chart.` : `Filed projects in ${cities.length} metros from state TABS filings, with a list, filters and a filings chart.`)
  );
  const open = el('a', 'primary devx-teaser-open', city ? `Open the ${city} map` : 'Open the development map');
  open.href = writeMarketHash({ ...state, tool: 'map', city: city ?? mapCity ?? '' });
  card.append(text, open);
  return card;
}

/**
 * market.json carries each market's biggest projects; the full list for the
 * market being looked at is its own file, downloaded once on open. The map
 * draws from the biggest ones meanwhile, and keeps them if the file fails.
 */
function loadDevFile(data, city) {
  const path = data.files?.[city];
  if (!path || devFiles.has(city)) return;
  devFiles.set(city, 'loading');
  const shown = snapshot;
  devLoader(path)
    .then((file) => {
      if (snapshot !== shown || !Array.isArray(file?.projects)) {
        // Let a later render ask again rather than wait on this one forever.
        if (devFiles.get(city) === 'loading') devFiles.delete(city);
        return;
      }
      data.projects = [...data.projects.filter((p) => p.city !== city), ...file.projects];
      devFiles.set(city, 'done');
      render();
    })
    .catch(() => devFiles.set(city, 'failed'));
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
  const box = el('div');
  box.append(el('p', 'market-asof', parts.length ? `As of ${parts.join(' · ')}` : ''));
  box.append(el('p', 'market-asof', freshnessLine()));
  return box;
}

/** When the file was built, how many figures are older than that build, and which sources did not answer. */
function freshnessLine() {
  const bits = [];
  const built = formatDate(snapshot.generatedAt);
  if (built) bits.push(`Updated ${built}`);
  const kept = retainedCount(snapshot);
  if (kept) bits.push(`${kept} figure${kept === 1 ? '' : 's'} marked • ${kept === 1 ? 'was' : 'were'} not refreshed (source did not answer, or its reading failed a range check) and ${kept === 1 ? 'is' : 'are'} shown from an earlier update`);
  const down = (snapshot.refresh ?? []).filter((o) => o.status === 'failed').map((o) => o.source);
  if (down.length) bits.push(`Did not answer: ${down.join(', ')}`);
  const behind = (snapshot.behind ?? []).map((lag) => `${lag.source} (newest ${lag.latest})`);
  if (behind.length) bits.push(`Behind its usual schedule: ${behind.join(', ')}`);
  return bits.join(' · ');
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
  $('m-body').replaceChildren(stateBox(text, isError, { retry: isError === true }));
  $('m-blurb').textContent = '';
}

function el(tag, cls = '', text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}
