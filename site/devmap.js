// devmap.js — the development map on the market data section: each city's
// metro area's biggest current projects (the whole region by county, so
// Houston includes Galveston, Sugar Land and The Woodlands) from the state's TABS register, plus the
// building permits of the cities that publish them (San Antonio, Austin, Fort Worth, Arlington), as pins
// on an OpenStreetMap map, with a list beside it. Each project links to its developer's website and its
// state filing or city permit.
//
// Leaflet (site/vendor, copied from npm by build:site) loads the first time a
// map is shown, so the rest of the site never waits for it.
import { followButton } from './watch-view.js';
import { areaItem, projectItem } from './watch.js';
import {
  activeFilterCount,
  categoryList,
  cityProjects,
  COST_BANDS,
  EMPTY_DEV_FILTERS,
  FILED_WINDOWS,
  filingsByMonth,
  filterChoices,
  filterProjects,
  projectCategory,
  projectDates,
  PUBLIC_INVOLVEMENT,
  sortProjects
} from './market.js';
import { firmJobsHref, growthJobs, hiringOn } from './growth.js';
import { stateBox } from './labels.js';
import { publishedReports, reportPopup, reportsSection } from './devreports-view.js';
import { matchSmaller } from './devreports.js';
import { categoryBadge, categoryClass, glyphSvg } from './devicons.js';

export const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

/** Where to center a metro with no pins. */
export const CENTERS = {
  Dallas: [32.7767, -96.797],
  'Fort Worth': [32.7555, -97.3308],
  Houston: [29.7604, -95.3698],
  Austin: [30.2672, -97.7431],
  'San Antonio': [29.4241, -98.4936],
  'El Paso': [31.7619, -106.485],
  'New Braunfels': [29.703, -98.1245],
  'College Station': [30.628, -96.3344],
  Galveston: [29.3013, -94.7977],
  Lubbock: [33.5779, -101.8552],
  Midland: [31.9973, -102.0779]
};

/** Markets whose cities' own building permits fill in the map (backend/src/market/cityPermits.ts). */
const PERMIT_CITIES = {
  'San Antonio': 'City of San Antonio',
  Austin: 'City of Austin',
  'Fort Worth': 'Fort Worth and Arlington'
};

let leaflet = null;
let liveMap = null;
/** The map's filters, kept while the section redraws or the city changes (the town resets with the city). */
let filters = { ...EMPTY_DEV_FILTERS };
let filtersCity = null;

export function loadLeaflet() {
  leaflet ??= new Promise((resolve, reject) => {
    if (window.L) return resolve(window.L);
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'vendor/leaflet.css';
    document.head.append(css);
    const script = document.createElement('script');
    script.src = 'vendor/leaflet.js';
    script.onload = () => resolve(window.L);
    script.onerror = () => {
      leaflet = null;
      script.remove();
      reject(new Error("Couldn't load the map."));
    };
    document.head.append(script);
  });
  return leaflet;
}

/** Remove the map on screen, before the section redraws or signs out. */
export function disposeMap() {
  // Stop a pan or zoom still running. Leaflet 1.9 ends a zoom animation with
  // an untracked 250 ms timer that reads the map's panes; once remove() has
  // deleted them that timer throws, unless the map no longer counts as zooming.
  if (liveMap) {
    liveMap.stop();
    liveMap._animatingZoom = false;
    liveMap.remove();
  }
  liveMap = null;
}

/** Rows put in the list before the first paint after a filter change. */
const FIRST_ROWS = 300;
/** Below this map width the project panel covers the lower part of the map instead of its right side. */
const NARROW_MAP = 820;
const SORTS = [
  { key: 'biggest', label: 'Biggest' },
  { key: 'newest', label: 'Newest' },
  { key: 'finishing', label: 'Finishing' }
];
let sort = 'biggest';
/** "Firms hiring now": only projects with a firm named on the filing that has open roles in the feed. */
let hiringOnly = false;

/**
 * The development map: a project list with a cost summary, category legend
 * and sorting on the left; the map with floating filters, a filings-by-month
 * chart and a project panel on the right. With several cities it shows a city
 * switcher and calls onCity when one is picked; on a city's own page, cities
 * is just that one.
 */
export function developmentMap({ data, cities, city, bids, onCity, back = null }) {
  const box = el('section', 'card dev-card devx mapfirst');
  box.setAttribute('aria-labelledby', 'dev-title');

  // ---- Title row: where we are, the city chips, Follow new filings.
  const head = el('div', 'devx-head');
  const titles = el('div', 'devx-titles');
  const crumbs = el('p', 'devx-crumbs');
  const home = back ? el('a', 'link', 'Market data') : el('span', '', 'Markets');
  if (back) home.href = back;
  crumbs.append(home, el('span', 'devx-sep', '/'), el('span', '', 'Development map'));
  const title = el('h2', 'devx-title', `What's being built in ${city}`);
  title.id = 'dev-title';
  titles.append(crumbs, title);
  const actions = el('div', 'devx-head-actions');
  if (cities.length > 1) {
    const pick = el('div', 'dev-cities devx-cities');
    pick.setAttribute('role', 'group');
    pick.setAttribute('aria-label', 'City');
    for (const name of cities) {
      const chip = el('button', 'chip', name);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(name === city));
      chip.addEventListener('click', () => onCity(name));
      pick.append(chip);
    }
    // Narrow screens: the same choice as one menu, so no city is hidden off the edge of a chip row.
    const menu = el('label', 'devx-city-menu');
    const select = el('select');
    select.setAttribute('aria-label', 'City');
    for (const name of cities) select.append(new Option(name, name));
    select.value = city;
    select.addEventListener('change', () => onCity(select.value));
    menu.append(el('span', 'devx-pill-label', 'City'), select);
    actions.append(pick, menu);
    if (cities.length > 6) actions.classList.add('many');
  }
  // Watchlists (migration 0017): new filings in this metro by email. Null while they're off.
  const followArea = followButton(areaItem(city), 'Follow new filings');
  if (followArea) actions.append(followArea);
  // Narrow screens: the list sits under the full-height map, so a visible control opens it.
  const toList = el('button', 'secondary sm devx-to-list', 'Search & project list');
  toList.type = 'button';
  toList.setAttribute('aria-controls', 'devx-side');
  actions.append(toList);
  head.append(titles, actions);
  box.append(head);

  if (filtersCity !== city) {
    filters = { ...filters, place: '' };
    filtersCity = city;
  }
  const all = cityProjects(data?.projects, city);
  const asOf = data?.asOf ?? new Date().toISOString();
  const cats = categoryList();
  const catOf = new Map(cats.map((c) => [c.key, c]));
  const hiringCache = new Map();
  const hiringFor = (project) => {
    let firms = hiringCache.get(project);
    if (!firms) hiringCache.set(project, (firms = hiringOn(project, growthJobs())));
    return firms;
  };

  // Map-first: the map is the whole body; the project dock, filters, chart and panel float over it.
  const body = el('div', 'devx-body');
  const side = el('div', 'devx-side devx-glass');
  side.id = 'devx-side';
  side.setAttribute('aria-label', 'Projects');
  side.setAttribute('role', 'region');
  const mapWrap = el('div', 'devx-mapwrap');
  mapWrap.append(side);
  body.append(mapWrap);
  box.append(body);

  // ---- The dock's head: the place, the total and how many firms on it are hiring.
  const dockHead = el('div', 'devx-dock-head');
  const dockTitles = el('div', 'devx-dock-titles');
  const place = el('p', 'devx-place');
  const placeCity = actions.querySelector('.devx-city-menu select');
  if (placeCity) {
    actions.querySelector('.devx-city-menu').remove();
    const wrapSel = el('span', 'devx-place-pick devx-city-menu');
    wrapSel.append(placeCity);
    place.append('Being built in ', wrapSel);
  } else place.append('Being built in ', el('b', '', city));
  const placeWindow = el('span', 'devx-place-window');
  place.append(placeWindow);
  const big = el('p', 'devx-big');
  const bigSub = el('p', 'devx-big-sub');
  dockTitles.append(place, big, bigSub);
  const fold = el('button', 'devx-fold');
  fold.type = 'button';
  fold.setAttribute('aria-controls', 'devx-side');
  fold.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>';
  const sheetUp = () => side.classList.contains('up');
  const syncFold = () => {
    const phone = mapWrap.classList.contains('narrow');
    const open = phone ? sheetUp() : !side.classList.contains('folded');
    fold.setAttribute('aria-expanded', String(open));
    fold.setAttribute('aria-label', phone ? (open ? 'Lower the project list' : 'Raise the project list') : open ? 'Fold the project list' : 'Unfold the project list');
  };
  fold.addEventListener('click', () => {
    if (mapWrap.classList.contains('narrow')) side.classList.toggle('up');
    else side.classList.toggle('folded');
    syncFold();
    setTimeout(() => map?.refit?.(), 280);
  });
  dockHead.append(dockTitles, fold);

  // ---- Left: search, summary, legend, sort, list.
  const search = el('label', 'search dev-search devx-search');
  const input = el('input');
  input.type = 'search';
  input.placeholder = 'Search name, address, owner or filing';
  input.setAttribute('aria-label', 'Search projects by name, address, owner, project or permit number');
  input.autocomplete = 'off';
  input.enterKeyHint = 'search';
  search.insertAdjacentHTML('beforeend', '<svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>');
  search.append(input);
  toList.addEventListener('click', () => {
    side.classList.add('up');
    side.classList.remove('folded');
    syncFold();
    input.focus({ preventScroll: true });
  });
  let typing = 0;
  input.addEventListener('input', () => {
    // The query is kept at once, so a menu changed within the debounce never drops it.
    filters = { ...filters, query: input.value };
    clearTimeout(typing);
    typing = setTimeout(apply, 120);
  });

  const summary = el('div', 'devx-summary');
  const total = el('p', 'devx-total');
  const pinned = el('p', 'devx-pinned');
  summary.append(total, pinned);
  const bar = el('div', 'devx-bar');
  bar.setAttribute('aria-hidden', 'true');
  const legend = el('ul', 'devx-legend');
  legend.setAttribute('aria-label', 'Categories: click one to hide or show it');
  const legendItems = new Map();
  for (const cat of cats) {
    const li = el('li');
    const button = el('button', 'devx-legend-item');
    button.type = 'button';
    button.dataset.category = cat.key;
    const n = el('span', 'devx-legend-count');
    button.append(categoryBadge(cat, { label: false }), el('span', 'devx-legend-label', cat.label), n);
    button.addEventListener('click', () => {
      const off = new Set(filters.off ?? []);
      off.has(cat.key) ? off.delete(cat.key) : off.add(cat.key);
      filters = { ...filters, off: [...off] };
      apply();
    });
    li.append(button);
    legend.append(li);
    legendItems.set(cat.key, { li, button, n });
  }

  const listHead = el('div', 'devx-list-head');
  const count = el('p', 'dev-count');
  count.setAttribute('aria-live', 'polite');
  const sorter = el('div', 'devx-seg');
  sorter.setAttribute('role', 'group');
  sorter.setAttribute('aria-label', 'Sort projects');
  const sortButtons = SORTS.map(({ key, label }) => {
    const b = el('button', 'devx-seg-item', label);
    b.type = 'button';
    b.dataset.sort = key;
    b.addEventListener('click', () => {
      sort = key;
      apply();
    });
    sorter.append(b);
    return b;
  });
  listHead.append(count, sorter);
  const smallerHint = el('button', 'link dev-smaller-hint');
  smallerHint.type = 'button';
  smallerHint.hidden = true;
  smallerHint.addEventListener('click', () => {
    const details = box.querySelector('.dev-smaller');
    if (details) {
      details.open = true;
      details.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  });

  const list = el('ol', 'dev-list devx-list');
  list.setAttribute('aria-label', `${city} metro development projects`);
  const empty = el('li', 'dev-empty');
  empty.hidden = true;
  const emptyClear = el('button', 'link dev-empty-clear', 'Clear filters');
  emptyClear.type = 'button';
  emptyClear.addEventListener('click', () => clearAll());
  const hint = el('span', 'dev-meta', 'Try a wider cost range or filing window, or ');
  hint.append(emptyClear, '.');
  empty.append(el('strong', '', 'No projects match these filters.'), hint);
  // How to read the pins beyond their category: groups and approximate spots.
  const key = el('p', 'devx-key');
  key.innerHTML =
    '<span class="devx-key-item"><span class="devx-key-pill" aria-hidden="true">$12M</span>Biggest projects show their filed cost; small dots are the rest, zoom in or click to see them</span>' +
    '<span class="devx-key-item"><span class="devx-key-approx" aria-hidden="true"></span>Dashed ring: location not verified, only the ZIP code area is known (not a site pin)</span>';
  side.append(dockHead, search, legend, listHead, smallerHint, list);
  summary.hidden = true;
  bar.hidden = true;

  // ---- Right: the map with floating filters, the chart and the project panel.
  const mapNode = el('div', 'dev-map');
  mapNode.setAttribute('role', 'region');
  mapNode.setAttribute('aria-label', `Map of ${city} metro development projects`);
  mapNode.append(el('div', 'state dev-loading', 'Loading the map…'));
  const pills = filterPills(all, () => apply(), () => clearAll());
  const chart = el('section', 'devx-chart');
  chart.setAttribute('aria-label', 'Filings by month');
  const panel = el('section', 'devx-panel');
  panel.setAttribute('aria-label', 'Project details');
  panel.tabIndex = -1;
  panel.hidden = true;
  pills.node.classList.add('devx-glass');
  chart.classList.add('devx-glass');
  panel.classList.add('devx-glass');
  mapWrap.prepend(mapNode);
  mapWrap.append(pills.node, chart, panel);

  // ---- Below: coverage, smaller filings and reports, public bids.
  const note = el('p', 'dev-note');
  const reports = reportsSection({ city, data, permits: PERMIT_CITIES[city] ?? null });
  box.append(note, summary, bar, key, reports.node);
  const bidList = bidsSection(bids, city);
  if (bidList) box.append(bidList);

  const placed = all.filter((p) => p.lat != null && p.lng != null);
  const updated = data?.asOf ? new Date(data.asOf).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const near = placed.filter((p) => p.approximate).length;
  const site = placed.filter((p) => !p.approximate && p.locatedFrom).length;
  const waiting = all.filter((p) => p.awaiting).length;
  const parts = [`${placed.length.toLocaleString('en-US')} of ${all.length.toLocaleString('en-US')} projects have a map location`];
  if (site) parts.push(`${site.toLocaleString('en-US')} use the site's point from a city permit at the same address`);
  if (near) parts.push(`${near.toLocaleString('en-US')} are marked "Location not verified" and drawn as a dashed ring for their ZIP code area, because no permit point or confirmed address match exists yet`);
  if (waiting) parts.push(`${waiting.toLocaleString('en-US')} are listed by name, number and cost while their details wait to be read from the state`);
  const sources = all.some((p) => p.source === 'city') ? `state TABS filings and ${PERMIT_CITIES[city] ?? 'city'} building permits` : 'state TABS filings';
  note.textContent = all.length
    ? `${parts.join('; ')}. From ${sources}${updated ? `, updated ${updated}` : ''}. Costs are the owner's estimate. The filing date is the TABS registration date, or the permit's issue date for city permits. Categories come from the words in each filing's name; filings whose names don't say are Other / unclassified. Single-family homes are not included${PERMIT_CITIES[city] ? '' : ", and this metro's cities do not publish their permits, so smaller projects may be missing"}.`
    : 'No projects to show yet.';

  const items = drawList(all, catOf, hiringFor, (project) => select(project, { fly: true, reveal: true }), (project, on) => map?.hover(on ? project : null));
  let map = null;
  /** The projects on screen in list order, for the panel's previous and next. */
  let order = [];
  let selected = null;
  let listTurn = 0;
  /** Time-lapse: while set, only filings up to this month (YYYY-MM) show, and the chart plays forward. */
  let until = '';
  let lapseTimer = 0;
  let lapseMonths = [];
  const lapseChip = el('p', 'devx-lapse-chip devx-glass');
  lapseChip.setAttribute('aria-live', 'polite');
  const filedMonth = (p) => String(p.registered ?? '').slice(0, 7);
  const lapse = (rows) => (until ? rows.filter((p) => filedMonth(p) && filedMonth(p) <= until) : rows);

  function clearAll() {
    filters = { ...EMPTY_DEV_FILTERS };
    hiringOnly = false;
    pills.sync();
    apply();
  }

  function apply() {
    input.value = filters.query;
    const hiring = (rows) => (hiringOnly ? rows.filter((p) => hiringFor(p).length) : rows);
    const shown = lapse(hiring(filterProjects(all, filters, asOf)));
    // Legend counts ignore the legend itself, so a hidden category still says how many it holds.
    const forLegend = lapse(hiring(filterProjects(all, { ...filters, off: [] }, asOf)));
    // The chart ignores its own month, so every bar stays clickable.
    const forChart = hiring(filterProjects(all, { ...filters, since: '' }, asOf));
    order = sortProjects(shown, sort);
    const ids = new Set(shown);

    // Only matching rows stay in the list: detaching costs far less than hiding thousands.
    const rows = order.map((p) => items.get(p));
    const turn = ++listTurn;
    list.textContent = '';
    list.append(...rows.slice(0, FIRST_ROWS), empty);
    if (rows.length > FIRST_ROWS)
      requestAnimationFrame(() =>
        setTimeout(() => {
          if (turn !== listTurn) return;
          const rest = document.createDocumentFragment();
          rest.append(...rows.slice(FIRST_ROWS));
          list.insertBefore(rest, empty);
        }, 0)
      );
    empty.hidden = shown.length > 0 || !all.length;

    const pins = shown.filter((p) => p.lat != null && p.lng != null).length;
    const cost = shown.reduce((sum, p) => sum + (p.cost > 0 ? p.cost : 0), 0);
    total.replaceChildren(el('b', '', money(cost) || '$0'), ` across ${shown.length.toLocaleString('en-US')} ${shown.length === 1 ? 'project' : 'projects'}`);
    pinned.textContent = `${pins.toLocaleString('en-US')} on the map`;
    big.textContent = money(cost) || '$0';
    placeWindow.textContent = filters.since ? ` · since ${monthLabel(filters.since)}` : '';
    countHiring(shown);
    const active = activeFilterCount(filters) + (hiringOnly ? 1 : 0);
    count.replaceChildren(
      el('strong', '', shown.length.toLocaleString('en-US')),
      ` ${active ? `of ${all.length.toLocaleString('en-US')} ` : ''}${shown.length === 1 ? 'project' : 'projects'}`,
      el('span', 'dev-count-pins visually-hidden', ` · ${pins.toLocaleString('en-US')} ${pins === 1 ? 'pin' : 'pins'} on the map`)
    );
    for (const b of sortButtons) b.setAttribute('aria-pressed', String(b.dataset.sort === sort));

    // Cost by category across what's shown, and the legend's counts.
    const byCost = new Map();
    const byCount = new Map();
    for (const p of shown) byCost.set(projectCategory(p), (byCost.get(projectCategory(p)) ?? 0) + (p.cost > 0 ? p.cost : 0));
    for (const p of forLegend) byCount.set(projectCategory(p), (byCount.get(projectCategory(p)) ?? 0) + 1);
    const present = new Set(all.map((p) => projectCategory(p)));
    bar.replaceChildren(
      ...cats
        .filter((c) => byCost.get(c.key))
        .map((c) => {
          const seg = el('i');
          seg.style.background = c.color;
          seg.style.flexGrow = String(byCost.get(c.key));
          return seg;
        })
    );
    const off = new Set(filters.off ?? []);
    for (const [key, { li, button, n }] of legendItems) {
      li.hidden = !present.has(key);
      n.textContent = (byCount.get(key) ?? 0).toLocaleString('en-US');
      button.setAttribute('aria-pressed', String(!off.has(key)));
      button.title = off.has(key) ? 'Hidden: click to show' : 'Click to hide';
    }

    const stack = new Map();
    const rank = new Map(cats.map((c, i) => [c.key, i]));
    for (const p of forChart) {
      const month = String(p.registered ?? '').slice(0, 7);
      if (!month) continue;
      const row = stack.get(month) ?? new Map();
      const key = projectCategory(p);
      row.set(key, (row.get(key) ?? 0) + 1);
      stack.set(month, row);
    }
    for (const [month, row] of stack) stack.set(month, [...row].sort((a, b) => rank.get(a[0]) - rank.get(b[0])).map(([key, n]) => [catOf.get(key)?.color ?? 'var(--muted)', n]));
    const months = filingsByMonth(forChart, asOf);
    lapseMonths = months.map((m) => m.month);
    drawChart(
      chart,
      months,
      filters.since,
      (month) => {
        // A bar picked during the time-lapse takes over from it.
        if (until) stopLapse({ clear: true, redraw: false });
        filters = { ...filters, since: filters.since === month ? '' : month };
        apply();
      },
      stack,
      { until, playing: Boolean(lapseTimer), onPlay: playLapse }
    );

    // A search also looks through the smaller filings.
    const more = filters.query ? reports.searchSmaller(filters.query) : 0;
    const onlyQuery = activeFilterCount({ ...filters, query: '' }) === 0 && !hiringOnly;
    map?.showSmall(onlyQuery && filters.query ? new Set(matchSmaller(data?.smaller, city, filters.query).map((f) => f.id)) : null);
    smallerHint.hidden = !more;
    smallerHint.textContent = more ? `${more.toLocaleString('en-US')} more in Smaller filings below the map` : '';
    pills.badge(active, hiringOnly);
    mapNode.dataset.matches = String(shown.length);
    // During the time-lapse the view holds still while filings fill it in.
    map?.show(ids, { keepView: Boolean(until) });
    if (selected && !ids.has(selected)) close();
    else if (selected) step(0);
  }

  /**
   * Play: the map starts empty and fills month by month, the biggest new
   * filings ringing where they land. Pause holds the month; Play again
   * resumes; the end shows everything again.
   */
  function playLapse() {
    if (lapseTimer) return stopLapse();
    if (!lapseMonths.length) return;
    if (selected) close();
    filters = { ...filters, since: '' };
    let i = until && until !== lapseMonths.at(-1) ? lapseMonths.indexOf(until) + 1 : 0;
    if (!lapseChip.isConnected) mapWrap.append(lapseChip);
    lapseChip.classList.add('on');
    const tick = () => {
      // Another city's map replaced this one.
      if (!box.isConnected) return clearInterval(lapseTimer);
      if (i >= lapseMonths.length) return stopLapse({ clear: true, done: true });
      until = lapseMonths[i++];
      apply();
      const landed = order.filter((p) => filedMonth(p) === until);
      lapseChip.replaceChildren(el('b', '', monthLabel(until, true)), ` · ${order.length.toLocaleString('en-US')} filed so far`);
      map?.blip([...landed].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0)).slice(0, 6));
    };
    lapseTimer = setInterval(tick, 280);
    tick();
  }

  function stopLapse({ clear = false, done = false, redraw = true } = {}) {
    clearInterval(lapseTimer);
    lapseTimer = 0;
    if (clear) until = '';
    if (redraw) apply();
    if (done) lapseChip.replaceChildren(el('b', '', 'All months'), ` · ${order.length.toLocaleString('en-US')} filed`);
    if (clear) setTimeout(() => !lapseTimer && lapseChip.classList.remove('on'), done ? 1400 : 0);
  }

  /** "N projects filed · K with firms hiring", the hiring count after the paint (each project's check is cached). */
  let hiringTurn = 0;
  function countHiring(shown) {
    const n = `${shown.length.toLocaleString('en-US')}`;
    const label = shown.length === 1 ? ' project filed' : ' projects filed';
    bigSub.replaceChildren(el('b', '', n), label);
    if (!growthJobs().length) return;
    const turn = ++hiringTurn;
    setTimeout(() => {
      if (turn !== hiringTurn) return;
      const k = hiringOnly ? shown.length : shown.filter((p) => hiringFor(p).length).length;
      bigSub.replaceChildren(el('b', '', n), label, ' · ', el('b', '', k.toLocaleString('en-US')), ' with firms hiring');
    }, 60);
  }

  pills.onHiring = () => {
    hiringOnly = !hiringOnly;
    apply();
  };

  /** Opens a project in the panel: from a row, a pin, or the panel's own previous and next. */
  function select(project, { fly = false, focus = false, reveal = false } = {}) {
    selected = project;
    for (const [p, item] of items) {
      const on = p === project;
      if (item.classList.contains('active') !== on) item.classList.toggle('active', on);
    }
    const row = items.get(project);
    row?.querySelector('.dev-pick')?.setAttribute('aria-current', 'true');
    for (const node of list.querySelectorAll('.dev-pick[aria-current]')) if (node.closest('.dev-item') !== row) node.removeAttribute('aria-current');
    if (row?.isConnected) {
      const top = row.offsetTop - list.offsetTop;
      if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTo({ top: top - 8, behavior: reduceMotion() ? 'auto' : 'smooth' });
    }
    panel.replaceChildren(...projectPanel(project, { catOf, hiring: hiringFor(project), step, close }));
    panel.hidden = false;
    mapWrap.classList.add('panel-open');
    map?.select(project, fly);
    // Stacked layout: the list sits under the map, so a row's pick brings the map and its panel back into view.
    if (reveal && mapWrap.classList.contains('narrow') && mapWrap.getBoundingClientRect().top < 0) mapWrap.scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' });
    if (focus) panel.focus({ preventScroll: true });
  }

  /** Moves the panel through the list (0 redraws the same project). */
  function step(by) {
    const i = order.indexOf(selected);
    const next = order[i + by];
    if (i < 0 || !next) return;
    select(next, { fly: by !== 0 });
    const nav = panel.querySelector(by < 0 ? '.devx-prev' : '.devx-next');
    if (by && nav && !nav.disabled) nav.focus({ preventScroll: true });
  }

  function close() {
    const was = selected;
    selected = null;
    panel.hidden = true;
    mapWrap.classList.remove('panel-open');
    for (const item of list.querySelectorAll('.dev-item.active')) item.classList.remove('active');
    for (const node of list.querySelectorAll('.dev-pick[aria-current]')) node.removeAttribute('aria-current');
    map?.select(null);
    if (was && panel.contains(document.activeElement)) items.get(was)?.querySelector('.dev-pick')?.focus({ preventScroll: true });
  }

  // Escape anywhere in the card (the panel, a row, the map) closes an open panel.
  box.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && selected && !event.target.closest?.('.devx-more')) {
      event.preventDefault();
      const was = selected;
      close();
      items.get(was)?.querySelector('.dev-pick')?.focus({ preventScroll: true });
    }
  });
  panel.prevStep = () => step(-1);

  // Phones: the timeline moves into the bottom sheet, above the list, instead of covering the map.
  const placeChart = () => {
    const narrow = mapWrap.classList.contains('narrow');
    if (narrow && chart.parentNode !== side) side.insertBefore(chart, listHead);
    else if (!narrow && chart.parentNode !== mapWrap) mapWrap.insertBefore(chart, panel);
    syncFold();
  };
  new MutationObserver(placeChart).observe(mapWrap, { attributes: true, attributeFilter: ['class'] });
  apply();
  syncFold();
  // After the card is on the page: Leaflet measures its container.
  queueMicrotask(() =>
    drawMap(mapNode, mapWrap, all, city, catOf, reports, smallerOf(data, city), (project) => select(project, { fly: true, focus: false }))
      .then((drawn) => {
        if (!drawn) return;
        map = drawn;
        reports.setOpenSmall((id) => drawn.openSmall(id));
        apply();
      })
      .catch((error) => {
        mapNode.replaceChildren(stateBox(error instanceof Error ? error.message : "Couldn't load the map.", 'error'));
      })
  );
  return box;
}

/**
 * Phone workspace: the map fills the screen from its own top down to the
 * bottom tabs, whatever the title row above it holds (a note, a wrapped button).
 */
function fitWorkspace(wrap, narrow) {
  if (document.body.dataset.workspace !== 'map' || !narrow) {
    wrap.style.removeProperty('height');
    return;
  }
  const tabs = document.querySelector('nav.tabs');
  const fixed = tabs && getComputedStyle(tabs).position === 'fixed';
  const bottom = fixed ? tabs.getBoundingClientRect().top : innerHeight;
  const top = wrap.getBoundingClientRect().top + scrollY;
  const height = Math.max(320, Math.floor(bottom - top - 8));
  if (wrap.style.height !== `${height}px`) wrap.style.height = `${height}px`;
}

function reduceMotion() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/**
 * The floating filter pills over the map: cost, type of work, public
 * involvement (funding), More (town, filing status, filed window), the
 * "Firms hiring now" toggle and Clear all. Each menu keeps its old label as
 * its accessible name.
 */
function filterPills(all, onChange, onClear) {
  const choices = filterChoices(all);
  const node = el('div', 'devx-filters');
  node.setAttribute('role', 'group');
  node.setAttribute('aria-label', 'Filter projects');
  const selects = {};
  const tally = (rows) => rows.map((r) => ({ value: r.value, label: `${r.value} (${r.count})` }));
  const menu = (host, key, short, label, options, any = 'All') => {
    if (!options.length) return;
    const wrap = el('label', 'devx-pill');
    const select = el('select');
    select.setAttribute('aria-label', label);
    select.dataset.filter = key;
    select.append(new Option(any, ''));
    for (const o of options) select.append(new Option(o.label, o.value));
    select.addEventListener('change', () => {
      filters = { ...filters, [key]: select.value };
      onChange();
    });
    wrap.append(el('span', 'devx-pill-label', short), select);
    host.append(wrap);
    selects[key] = select;
  };
  menu(node, 'cost', 'Cost', 'Estimated cost', COST_BANDS.map((b) => ({ value: b.key, label: b.label })), 'Any');
  menu(node, 'work', 'Work', 'Type of work', tally(choices.works));
  menu(node, 'publicInvolvement', 'Funding', 'Public involvement', PUBLIC_INVOLVEMENT.map((o) => ({ value: o.key, label: o.label })));

  const more = el('details', 'devx-more');
  const moreSummary = el('summary', 'devx-pill devx-more-summary');
  const moreBadge = el('span', 'devx-more-badge');
  moreSummary.append(el('span', '', 'More'), moreBadge);
  const moreBody = el('div', 'devx-more-body');
  more.append(moreSummary, moreBody);
  if (choices.places.length > 1) menu(moreBody, 'place', 'Town', 'City or town', tally(choices.places));
  if (choices.statuses.length > 1) menu(moreBody, 'status', 'Status', 'Filing status', tally(choices.statuses));
  menu(moreBody, 'filed', 'Filed', 'Filed', FILED_WINDOWS.map((w) => ({ value: w.key, label: w.label })), 'Any time');
  node.append(more);
  more.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && more.open) {
      more.open = false;
      moreSummary.focus();
    }
  });

  const hiring = el('button', 'devx-pill devx-toggle');
  hiring.type = 'button';
  hiring.append(el('i', 'devx-toggle-dot'), 'Firms hiring now');
  hiring.title = 'Projects where a firm named on the filing (owner, tenant, architect or contractor) has open roles on Terra';
  const clear = el('button', 'devx-pill devx-clear dev-clear', 'Clear all');
  clear.type = 'button';
  clear.addEventListener('click', onClear);
  node.append(hiring, clear);

  const api = {
    node,
    onHiring: null,
    sync() {
      for (const [key, select] of Object.entries(selects)) {
        // A saved choice this metro doesn't carry (another metro's status) shows as All and is dropped.
        select.value = filters[key];
        if (select.value !== filters[key]) {
          select.value = '';
          filters = { ...filters, [key]: '' };
        }
        select.closest('.devx-pill')?.classList.toggle('on', Boolean(filters[key]));
      }
    },
    badge(active, hiringOn) {
      clear.hidden = !active;
      hiring.setAttribute('aria-pressed', String(hiringOn));
      const extra = ['place', 'status', 'filed'].filter((k) => filters[k]).length;
      moreBadge.textContent = extra ? String(extra) : '';
      moreSummary.classList.toggle('on', extra > 0);
      api.sync();
    }
  };
  hiring.addEventListener('click', () => api.onHiring?.());
  api.sync();
  return api;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (key, long = false) => {
  const [y, m] = key.split('-');
  return long ? `${MONTHS[+m - 1]} ${y}` : `${MONTHS[+m - 1]} '${y.slice(2)}`;
};

/**
 * Filings by month: one bar per month; clicking a bar shows filings from that month on, clicking it again clears.
 * With lapse, a Play button runs the months forward; bars past the playing month dim.
 */
function drawChart(node, months, since, onPick, stack = null, lapse = null) {
  const max = Math.max(1, ...months.map((m) => m.count));
  const head = el('div', 'devx-chart-head');
  const titleRow = el('div', 'devx-chart-titles');
  titleRow.append(el('h3', 'devx-chart-title', 'Filings by month'));
  // The chart is redrawn every month of the playback; a keyboard user keeps their place on the button.
  const hadFocus = document.activeElement?.classList?.contains('devx-play') && node.contains(document.activeElement);
  let play = null;
  if (lapse && months.length > 1) {
    play = el('button', `devx-play${lapse.playing ? ' on' : ''}`);
    play.type = 'button';
    play.setAttribute('aria-pressed', String(lapse.playing));
    play.setAttribute('aria-label', lapse.playing ? 'Pause the time-lapse' : 'Play the filings month by month on the map');
    play.innerHTML = lapse.playing ? '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1h2v8H2zM6 1h2v8H6z" /></svg>' : '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1v8l7-4z" /></svg>';
    play.append(lapse.playing ? 'Pause' : lapse.until ? 'Resume' : 'Play');
    play.addEventListener('click', lapse.onPlay);
    titleRow.append(play);
  }
  const playing = lapse?.until ? `Showing filings up to ${monthLabel(lapse.until, true)}` : '';
  head.append(titleRow, el('span', 'devx-chart-note', playing || (since ? `From ${monthLabel(since, true)} on · click it again to clear` : `Last ${months.length} months · click a bar to start there`)));
  const bars = el('div', 'devx-bars');
  for (const { month, count } of months) {
    const b = el('button', 'devx-bar-col');
    b.type = 'button';
    b.dataset.month = month;
    b.setAttribute('aria-pressed', String(since === month));
    b.setAttribute('aria-label', `${monthLabel(month, true)}: ${count} ${count === 1 ? 'filing' : 'filings'}. Show filings from this month on`);
    b.title = `${monthLabel(month, true)}: ${count.toLocaleString('en-US')}`;
    const fill = el('i');
    fill.style.height = `${Math.max(count ? 6 : 2, Math.round((count / max) * 100))}%`;
    if (since && month < since) b.classList.add('before');
    if (lapse?.until && month > lapse.until) b.classList.add('after');
    if (lapse?.until === month) b.classList.add('now');
    // Stacked by category, in the legend's order, when the caller gives the split.
    const split = stack?.get(month);
    if (split && count) {
      fill.classList.add('stacked');
      for (const [color, n] of split) {
        const seg = el('span');
        seg.style.background = color;
        seg.style.flexGrow = String(n);
        fill.append(seg);
      }
    }
    b.append(fill);
    b.addEventListener('click', () => onPick(month));
    bars.append(b);
  }
  const axis = el('div', 'devx-axis');
  const ticks = [0, Math.round(months.length / 3), Math.round((2 * months.length) / 3), months.length - 1];
  for (const i of ticks) axis.append(el('span', '', months[i] ? monthLabel(months[i].month) : ''));
  node.replaceChildren(head, bars, axis);
  if (hadFocus) play?.focus({ preventScroll: true });
}

/** Below this zoom projects are price pills (biggest first, never overlapping) and small specks; from it on, every project has its own icon. */
const SPREAD_ZOOM = 16;
/** Cluster grid cell, in screen pixels. */
const CELL = 64;
/** Pin icon size (the hit area; the visible disc is a little smaller, in style.css). */
const PIN = 40;
/** A price pill's size for the overlap test: icon disc, cost text, padding. */
const PILL_H = 30;
const pillWidth = (text) => 34 + text.length * 7.4 + 12;

/** A keydown handler that runs act on Enter or Space, as a button would. */
function pressed(act) {
  return (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    act();
  };
}

/** A pin's accessible name and tooltip: name, category, cost, and an approximate spot said in words. */
function pinLabel(project, cat) {
  return [project.name, cat?.label, money(project.cost), project.approximate ? 'location not verified, ZIP code area only' : ''].filter(Boolean).join(', ');
}

/**
 * Draws the map once; show() then sets which projects are on it as the
 * filters change, and the pins redraw from that on every pan and zoom:
 * zoomed out, the biggest projects are price pills and the rest small dots; zoomed in, each has
 * its category icon, and projects at the very same point fan out around it.
 * Only pins near the view are put on the page. Null when the card left the
 * page while Leaflet loaded.
 */
async function drawMap(node, wrap, projects, city, catOf, reports = null, small = [], onPick = () => {}) {
  const L = await loadLeaflet();
  if (!node.isConnected) return null;
  disposeMap();
  node.replaceChildren();
  const map = L.map(node, { scrollWheelZoom: true, zoomControl: false });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>');
  liveMap = map;
  // A map always has a view before its first fit; fitBounds on a 0-size container leaves it blank.
  map.setView(CENTERS[city] ?? [31, -99], 9);
  L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  const leaders = L.layerGroup().addTo(map);

  const styles = getComputedStyle(document.documentElement);
  const accent = styles.getPropertyValue('--accent').trim() || '#c0582c';

  // Each located project's point, its exact-spot key, and its pin (made once, moved as needed).
  const located = projects.filter((p) => p.lat != null && p.lng != null);
  const where = new Map();
  const spotOf = new Map();
  const pins = new Map();
  for (const project of located) {
    where.set(project, L.latLng(project.lat, project.lng));
    spotOf.set(project, `${project.lat},${project.lng}`);
  }
  const pills = new Map();
  const pillW = new Map();
  const pinFor = (project, pill = false) => {
    const cache = pill ? pills : pins;
    let marker = cache.get(project);
    if (marker) return marker;
    const key = projectCategory(project);
    const cat = catOf.get(key);
    const disc = `<span class="devx-pin ${categoryClass(key)}${project.approximate ? ' approx' : ''}" style="--cat:${cat?.color ?? '#9b958d'}">${glyphSvg(key)}</span>`;
    const cost = money(project.cost);
    const icon = pill
      ? L.divIcon({
          className: 'devx-pin-icon devx-pill-icon',
          html: `<span class="devx-pill${project.approximate ? ' approx' : ''}" style="--cat:${cat?.color ?? '#9b958d'}">${disc}<b>${cost}</b></span>`,
          iconSize: [pillWidth(cost), PILL_H],
          iconAnchor: [PILL_H / 2, PILL_H + 5]
        })
      : L.divIcon({ className: 'devx-pin-icon', html: disc, iconSize: [PIN, PIN] });
    const label = pinLabel(project, cat);
    marker = L.marker(where.get(project), { icon, keyboard: true, riseOnHover: true });
    marker.bindTooltip(label, { direction: 'top', offset: pill ? [pillWidth(cost) / 2 - PILL_H / 2, -PILL_H - 4] : [0, -16] });
    marker.on('click', () => onPick(project));
    marker.on('mouseover', () => api.hover(project));
    marker.on('mouseout', () => api.hover(null));
    marker.on('add', () => {
      const icon = marker.getElement();
      icon.setAttribute('aria-label', label);
      icon.dataset.category = key;
      icon.dataset.id = project.id;
      icon.onkeydown = pressed(() => onPick(project));
      decorate(project);
    });
    cache.set(project, marker);
    return marker;
  };
  /**
   * Small dots for projects with no room for their pill yet, painted in one pass on one
   * canvas (thousands of map layers would make filtering slow). A click near one zooms in toward it.
   */
  const speckCanvas = L.DomUtil.create('canvas', 'devx-specks');
  map.getPanes().overlayPane.appendChild(speckCanvas);
  let speckPts = [];
  let hoverSpeck = null;
  const paintSpecks = (list) => {
    if (list) speckPts = list;
    const size = map.getSize();
    const ratio = window.devicePixelRatio || 1;
    const origin = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(speckCanvas, origin);
    speckCanvas.width = size.x * ratio;
    speckCanvas.height = size.y * ratio;
    speckCanvas.style.width = `${size.x}px`;
    speckCanvas.style.height = `${size.y}px`;
    const g = speckCanvas.getContext('2d');
    g.scale(ratio, ratio);
    for (const s of speckPts) {
      const c = map.latLngToContainerPoint(where.get(s.p));
      s.x = c.x;
      s.y = c.y;
      const r = s.p === hoverSpeck ? 6 : 3.5;
      g.beginPath();
      g.arc(c.x, c.y, r, 0, Math.PI * 2);
      if (s.p.approximate) {
        g.setLineDash([2, 2]);
        g.strokeStyle = s.color;
        g.lineWidth = 1.5;
        g.stroke();
        g.setLineDash([]);
      } else {
        g.globalAlpha = 0.85;
        g.fillStyle = s.color;
        g.fill();
        g.globalAlpha = 0.5;
        g.strokeStyle = '#000000';
        g.lineWidth = 1;
        g.stroke();
        g.globalAlpha = 1;
      }
    }
  };
  const speckAt = (point) => {
    let best = null;
    let bestD = 64;
    for (const s of speckPts) {
      const d = (s.x - point.x) ** 2 + (s.y - point.y) ** 2;
      if (d < bestD) [best, bestD] = [s.p, d];
    }
    return best;
  };
  map.on('click', (event) => {
    if (reports?.picking()) return;
    const p = speckAt(event.containerPoint);
    // A not-verified project is only ever a ring, so a click opens it rather than zooming toward a spot that isn't its site.
    if (p?.approximate) onPick(p);
    else if (p) map.setView(where.get(p), Math.min(map.getZoom() + 2, SPREAD_ZOOM), { animate: !reduceMotion() });
  });
  map.on('mousemove', (event) => {
    const p = speckAt(event.containerPoint);
    node.style.cursor = p ? 'pointer' : '';
    if (p !== hoverSpeck) api.hover(p);
  });
  map.on('zoomstart', () => (speckCanvas.style.visibility = 'hidden'));
  map.on('zoomend', () => (speckCanvas.style.visibility = ''));

  // Smaller filings (below the cap) with a pin from a spare page read: small,
  // hollow and under the main pins. Shown while no filter but the search is on.
  const smallLayer = L.featureGroup().addTo(map);
  const smallMarkers = new Map();
  for (const filing of small) {
    const marker = L.circleMarker([filing.lat, filing.lng], {
      radius: 3.5,
      color: accent,
      weight: 1.5,
      fillColor: '#ffffff',
      fillOpacity: 0.9,
      dashArray: filing.approximate ? '2 2' : null,
      className: 'dev-small-pin'
    });
    marker.bindPopup(() => smallPopup(filing), { maxWidth: 300 });
    marker.bindTooltip(`${filing.name} (smaller filing)`, { direction: 'top', offset: [0, -4] });
    smallMarkers.set(filing.id, marker);
    smallLayer.addLayer(marker);
  }
  smallLayer.bringToBack();
  // Verified community reports: a ringed pin of their own, always shown.
  for (const report of publishedReports(city)) {
    L.circleMarker([report.lat, report.lng], { radius: 6, color: accent, weight: 2.5, fillColor: '#ffffff', fillOpacity: 0.95 })
      .bindPopup(() => reportPopup(report), { maxWidth: 300 })
      .bindTooltip(`${report.name || 'Community report'} (verified report)`, { direction: 'top', offset: [0, -6] })
      .addTo(map);
  }
  let dropped = null;
  map.on('click', (event) => {
    if (!reports?.picking()) return;
    reports.pick(event.latlng);
    dropped?.remove();
    dropped = L.circleMarker(event.latlng, { radius: 8, color: accent, weight: 3, fillOpacity: 0.2, dashArray: '4 3' }).bindTooltip('Your report pin').addTo(map);
  });

  const pulse = L.marker([0, 0], { icon: L.divIcon({ className: 'devx-pulse-icon', html: '<span class="devx-pulse"></span>', iconSize: [0, 0] }), interactive: false, keyboard: false });
  let hovered = null;
  let chosen = null;
  let area = null;
  /** The cluster each project sat in at the last draw, for the list's hover. */
  let clusterOf = new Map();
  const decorate = (project) => {
    for (const icon of [pins.get(project)?.getElement(), pills.get(project)?.getElement()]) if (icon) {
      icon.classList.toggle('lit', project === hovered);
      icon.classList.toggle('chosen', project === chosen);
      if (project === chosen) icon.setAttribute('aria-current', 'true');
      else icon.removeAttribute('aria-current');
    }
    const speck = speckPts.some((s) => s.p === project) ? project : null;
    if (speck !== hoverSpeck && (speck || hoverSpeck)) {
      hoverSpeck = project === hovered ? speck : null;
      paintSpecks();
    }
  };

  const wide = () => node.clientWidth >= NARROW_MAP;
  /** Fit padding scaled to the map: room for the filters on top, the chart below and the panel on the right. */
  const padding = () => {
    const w = node.clientWidth;
    const h = node.clientHeight;
    const open = wrap.classList.contains('panel-open');
    const narrow = !wide();
    // The floating dock covers the left side (or the bottom of a phone), the timeline the bottom.
    const dock = wrap.querySelector('.devx-side');
    const dockW = !narrow && dock && !dock.classList.contains('folded') ? dock.offsetWidth + 16 : 0;
    const peek = narrow ? Math.min(h * 0.4, 220) : 0;
    return {
      paddingTopLeft: [Math.min(dockW + 40, w * 0.5), Math.min(narrow ? 64 : 72, h * 0.15)],
      paddingBottomRight: [open && !narrow ? Math.min(420, w * 0.35) : Math.min(40, w * 0.08), open && narrow ? h * 0.62 : narrow ? peek : Math.min(150, h * 0.3)],
      maxZoom: 14
    };
  };

  /** Projects on the map now (located and matching the filters). */
  let shown = [];
  /** Where each shown pin is drawn at this zoom (fanned out from a shared spot), for the pulse and flyTo. */
  let drawnAt = new Map();

  /** Redraws the pins for this zoom and view. */
  const draw = () => {
    if (map !== liveMap || !node.clientWidth) return;
    const started = performance.now();
    const zoom = map.getZoom();
    const view = map.getPixelBounds().pad(0.5);
    const want = new Set();
    const nextSpecks = [];
    const nextCluster = new Map();
    const nextAt = new Map();
    const lines = [];
    const px = (p) => map.project(where.get(p), zoom);
    const place = (project, at) => {
      nextAt.set(project, at);
      if (!view.contains(map.project(at, zoom))) return;
      const marker = pinFor(project);
      if (!marker.getLatLng().equals(at)) marker.setLatLng(at);
      want.add(marker);
    };
    // Projects at one exact point, fanned out around it with a line back to the true spot:
    // a ring for a few, a spiral for many, so no two icons overlap.
    const fan = (members) => {
      const center = members[0];
      if (members.length === 1) return place(center, where.get(center));
      const c = px(center);
      const n = members.length;
      let angle = 0;
      let leg = 34;
      for (let i = 0; i < n; i++) {
        let offset;
        if (n <= 8) {
          const r = Math.max(34, (n * (PIN - 2)) / (2 * Math.PI));
          const a = (i / n) * 2 * Math.PI - Math.PI / 2;
          offset = L.point(Math.cos(a) * r, Math.sin(a) * r);
        } else {
          // Archimedean spiral: one icon's width along the arc per step, one icon further out per turn.
          const step = (PIN - 4) / leg;
          angle += step;
          offset = L.point(Math.cos(angle) * leg, Math.sin(angle) * leg);
          leg += ((PIN - 2) * step) / (2 * Math.PI);
        }
        const at = map.unproject(c.add(offset), zoom);
        lines.push([where.get(center), at]);
        place(members[i], at);
      }
    };
    const spots = new Map();
    // Projects whose location is not verified never get a site pin or a pill:
    // they are dashed rings at their ZIP area's center, whatever the zoom.
    for (const p of shown) if (p.approximate) {
      nextAt.set(p, where.get(p));
      nextSpecks.push({ p, color: catOf.get(projectCategory(p))?.color ?? '#9b958d' });
    }
    const sited = shown.filter((p) => !p.approximate);
    // Rings count as drawn: the project is on the map, as an area.
    const rings = shown.length - sited.length;
    for (const p of sited) {
      const k = spotOf.get(p);
      spots.set(k, [...(spots.get(k) ?? []), p]);
    }
    let count = rings;
    if (zoom >= SPREAD_ZOOM) {
      for (const members of spots.values()) {
        fan(members);
        count += members.length;
      }
    } else {
      // Price pills, biggest first: a project gets a pill when its pill overlaps none already
      // placed, otherwise a small speck until zooming in makes room. The selected project always has its pill.
      const boxes = [];
      const free = (box) => boxes.every((b) => box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]);
      const order = [...sited].sort((a, b) => (b === chosen) - (a === chosen) || (b.cost ?? 0) - (a.cost ?? 0));
      for (const p of order) {
        count++;
        const at = where.get(p);
        nextAt.set(p, at);
        const pt = px(p);
        if (!view.contains(pt)) continue;
        let w = pillW.get(p);
        if (w == null) pillW.set(p, (w = pillWidth(money(p.cost))));
        const box = [pt.x - PILL_H / 2 - 2, pt.y - PILL_H - 7, pt.x - PILL_H / 2 + w + 2, pt.y + 1];
        if (p === chosen || free(box)) {
          boxes.push(box);
          const marker = pinFor(p, true);
          if (!marker.getLatLng().equals(at)) marker.setLatLng(at);
          want.add(marker);
        } else {
          nextSpecks.push({ p, color: catOf.get(projectCategory(p))?.color ?? '#9b958d' });
        }
      }
    }
    // Swap in the new set: kept pins stay on the page, so focus and hover survive a pan.
    for (const marker of [...layer.getLayers()]) if (!want.has(marker)) layer.removeLayer(marker);
    for (const marker of want) if (!layer.hasLayer(marker)) layer.addLayer(marker);
    paintSpecks(nextSpecks);
    leaders.clearLayers();
    for (const line of lines) if (view.contains(map.project(line[1], zoom))) L.polyline(line, { className: 'devx-leader', interactive: false, weight: 1.5 }).addTo(leaders);
    clusterOf = nextCluster;
    drawnAt = nextAt;
    for (const m of [pins.get(chosen), pills.get(chosen)]) m?.setZIndexOffset(1000);
    if (chosen && nextAt.has(chosen)) pulse.setLatLng(nextAt.get(chosen));
    node.dataset.drawn = String(count);
    node.dataset.clusters = '0';
    node.dataset.specks = String(nextSpecks.length);
    node.dataset.drawMs = String(Math.round(performance.now() - started));
  };
  let drawing = 0;
  const redraw = () => {
    cancelAnimationFrame(drawing);
    drawing = requestAnimationFrame(draw);
  };
  map.on('zoomend moveend', redraw);

  let lastIds = null;
  let fitted = false;
  const fit = () => {
    if (!node.clientWidth || !node.clientHeight || !lastIds) return;
    if (shown.length) map.fitBounds(L.latLngBounds(shown.map((p) => where.get(p))), { ...padding(), animate: false });
    else map.setView(CENTERS[city] ?? [31, -99], 9, { animate: false });
    fitted = true;
    draw();
  };
  // The container gets its size after layout, and changes with the window or a tab switch.
  const observer = new ResizeObserver(() => {
    if (map !== liveMap) return observer.disconnect();
    wrap.classList.toggle('narrow', !wide());
    fitWorkspace(wrap, !wide());
    map.invalidateSize({ pan: false });
    if (!fitted) fit();
  });
  observer.observe(node);
  map.on('unload', () => observer.disconnect());

  let last = null;
  const api = {
    /** Smaller pins to show: a set of filing ids, or null for none. */
    showSmall(ids) {
      if (map !== liveMap) return;
      for (const [id, marker] of smallMarkers) {
        const on = Boolean(ids?.has(id));
        if (on !== smallLayer.hasLayer(marker)) on ? smallLayer.addLayer(marker) : smallLayer.removeLayer(marker);
      }
      node.dataset.smallPins = String(ids ? [...smallMarkers.keys()].filter((id) => ids.has(id)).length : 0);
    },
    /** Opens a smaller filing's pin, from the Smaller filings list. */
    openSmall(id) {
      const marker = smallMarkers.get(id);
      if (!marker || map !== liveMap) return false;
      if (!smallLayer.hasLayer(marker)) smallLayer.addLayer(marker);
      map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 15), { duration: reduceMotion() ? 0 : 0.6 });
      map.once('moveend', () => marker.openPopup());
      return true;
    },
    show(ids, { keepView = false } = {}) {
      // A debounced search or filter from a card that has since been replaced
      // (the city changed) must not move the removed map.
      if (map !== liveMap) return;
      const key = projects.map((p) => (ids.has(p) ? 1 : 0)).join('');
      if (key === last) return;
      last = key;
      lastIds = ids;
      shown = located.filter((p) => ids.has(p));
      node.dataset.pins = String(shown.length);
      if (keepView && fitted) draw();
      else fit();
    },
    /** A ring that spreads once where each project sits, in its category color (the time-lapse's new filings). */
    blip(list) {
      if (map !== liveMap || reduceMotion()) return;
      list.forEach((project, k) => {
        const at = where.get(project);
        if (!at || project.approximate) return;
        const color = catOf.get(projectCategory(project))?.color ?? 'var(--accent)';
        setTimeout(() => {
          const ring = L.marker(at, { icon: L.divIcon({ className: 'devx-blip-icon', html: `<span class="devx-blip" style="--c:${color}"></span>`, iconSize: [0, 0] }), interactive: false, keyboard: false }).addTo(map);
          setTimeout(() => ring.remove(), 950);
        }, k * 60);
      });
    },
    hover(project) {
      if (map !== liveMap) return;
      const was = hovered;
      hovered = project;
      if (was) decorate(was);
      if (project) decorate(project);
    },
    /** Marks the chosen project's pin and, with fly, brings it into view beside the panel. */
    select(project, fly = false) {
      if (map !== liveMap) return;
      const was = chosen;
      chosen = project;
      if (was) {
        for (const m of [pins.get(was), pills.get(was)]) m?.setZIndexOffset(0);
        decorate(was);
      }
      area?.remove();
      area = null;
      if (project?.approximate && where.has(project)) {
        // The ZIP code area the project is somewhere in: a dashed circle, never a pin.
        area = L.circle(where.get(project), { radius: (project.location?.areaKm ?? 2) * 1000, color: accent, weight: 1.5, dashArray: '6 6', fillOpacity: 0.06, interactive: false, className: 'devx-area' })
          .bindTooltip(`Approximate area: ZIP ${project.location?.zip ?? ''} (location not verified)`.replace('ZIP  ', 'ZIP '), { permanent: false })
          .addTo(map);
      }
      if (!project || !where.has(project) || !shown.includes(project)) {
        pulse.remove();
        draw();
        return;
      }
      draw();
      decorate(project);
      pulse.setLatLng(drawnAt.get(project) ?? where.get(project)).addTo(map);
      if (!fly) return;
      const zoom = Math.max(map.getZoom(), 13);
      const w = node.clientWidth;
      const h = node.clientHeight;
      // Center the map off the pin so the panel doesn't cover it.
      const shift = wide() ? L.point(Math.min(420, w * 0.45) / 2, 0) : L.point(0, h * 0.28);
      const target = map.unproject(map.project(where.get(project), zoom).add(shift), zoom);
      if (reduceMotion()) map.setView(target, zoom, { animate: false });
      else map.flyTo(target, zoom, { duration: 0.6 });
    }
  };
  return api;
}

/** Map location as the data supports it: an address match, a borrowed site point, a ZIP-center pin, or none yet. */
function locationNote(project) {
  if (project.awaiting) return 'Details pending from the state: listed by name, number and cost until its TABS page is read.';
  if ((project.lat == null || project.lng == null) && project.location?.method === 'none')
    return `Location unavailable: ${project.location.source.replace(/^Location unavailable: /, '')}. Not shown on the map, not even as a ZIP area, because the filed address itself may be wrong.`;
  if (project.lat == null || project.lng == null) return 'Not on the map: no reliable location for this filing yet.';
  const checked = project.location?.verified && project.location.verified !== 'not recorded' ? ` Checked ${project.location.verified}.` : '';
  if (project.approximate) return `Location not verified: only the ZIP code is known, so the dashed ring is the ZIP code center and area${project.location?.zip ? ` (${project.location.zip})` : ''}, not the site.${checked}`;
  if (project.locatedFrom) return `Site point: the pin is the site's location from a city permit at the same address (${project.locatedFrom}), not the building's own point. Address or parcel level, not building level.${checked}`;
  return project.source === 'city'
    ? `Pin at the city permit's own point (address or parcel level, not the building).${checked}`
    : `Pin at the filing's address, matched by the Census geocoder along the street (address level, not the building).${checked}`;
}

/** The list, every project once, as rows; apply() puts them in order. Returns project → item. */
function drawList(projects, catOf, hiringFor, onPick, onHover) {
  const items = new Map();
  for (const project of projects) {
    const item = el('li', 'dev-item');
    item.dataset.category = projectCategory(project);
    item.dataset.id = project.id;
    const button = el('button', 'dev-pick');
    button.type = 'button';
    const cat = catOf.get(projectCategory(project));
    const dot = categoryBadge(cat ?? { key: 'other', label: 'Other / unclassified' });
    if (project.approximate) dot.classList.add('approx');
    const text = el('span', 'devx-row-text');
    const meta = [project.place, project.facility && project.facility !== project.name ? project.facility : '', project.work].filter(Boolean).join(' · ');
    text.append(el('span', 'dev-name', project.name), el('span', 'dev-meta', meta));
    const tags = el('span', 'devx-tags');
    if (project.status) tags.append(el('span', 'devx-tag', project.status));
    if (project.awaiting) tags.append(el('span', 'devx-tag dev-off', 'Details pending from the state'));
    else if (project.lat == null || project.lng == null) tags.append(el('span', 'devx-tag dev-off', 'Not on the map'));
    else if (project.approximate) tags.append(el('span', 'devx-tag dev-unverified', 'Location not verified'));
    else if (project.locatedFrom) tags.append(el('span', 'devx-tag', 'Site point'));
    const hiring = hiringFor(project);
    if (hiring.length) {
      const tag = el('span', 'devx-tag hiring', 'Firm on filing hiring');
      tag.title = `${hiring.map((h) => h.firm).join(', ')}: named on this filing, with open roles on Terra`;
      tags.append(tag);
    }
    text.append(tags);
    button.append(dot, text, el('span', 'devx-cost', money(project.cost)));
    button.addEventListener('click', () => onPick(project));
    button.addEventListener('mouseenter', () => onHover(project, true));
    button.addEventListener('mouseleave', () => onHover(project, false));
    button.addEventListener('focus', () => onHover(project, true));
    button.addEventListener('blur', () => onHover(project, false));
    item.append(button);
    items.set(project, item);
  }
  return items;
}

/** A metro's smaller filings that have a pin. */
function smallerOf(data, city) {
  return (data?.smaller ?? []).filter((f) => f.city === city && f.lat != null && f.lng != null);
}

function smallPopup(filing) {
  const box = el('div', 'dev-pop');
  box.append(el('strong', 'dev-pop-title', filing.name));
  if (filing.address) box.append(el('span', 'dev-pop-line muted', filing.address));
  if (filing.approximate) box.append(el('span', 'dev-pop-line muted', 'Location not verified: the dashed ring is the ZIP code center, not the site.'));
  box.append(el('span', 'dev-pop-line', [money(filing.cost), filing.work].filter(Boolean).join(' · ')));
  box.append(el('span', 'dev-pop-line muted', [filing.status, filing.owner ? `Owner: ${filing.owner}` : ''].filter(Boolean).join(' · ')));
  box.append(el('span', 'dev-pop-line muted', 'Smaller filing, below the map cutoff'));
  box.append(link(filing.url, 'State filing (TDLR)'));
  return box;
}

/** Opens or closes a project's details under its list item (used by lists outside the map). */
export function toggleDetail(item, button, project, render = (p) => projectPanel(p, { catOf: new Map(categoryList().map((c) => [c.key, c])), hiring: [] })) {
  const open = item.querySelector(':scope > .dev-detail');
  if (open) {
    open.remove();
    button.setAttribute('aria-expanded', 'false');
    return;
  }
  const panel = el('div', 'dev-detail');
  const parts = render(project);
  panel.append(...(Array.isArray(parts) ? parts : [parts]));
  button.after(panel);
  button.setAttribute('aria-expanded', 'true');
}

const MONTH_FMT = (iso) => {
  const m = /^(\d{4})-(\d{2})/.exec(iso ?? '');
  return m ? `${MONTHS[+m[2] - 1]} ${m[1]}` : '';
};

/** The project panel's parts: header (category, previous/next, close), body and footer. */
function projectPanel(project, { catOf, hiring, step = null, close = null }) {
  const cat = catOf.get(projectCategory(project));
  const head = el('div', 'devx-panel-head');
  const label = el('span', 'devx-panel-cat');
  label.append(categoryBadge(cat, { label: false }), [cat?.label, project.work].filter(Boolean).join(' · '));
  head.append(label);
  if (step || close) {
    const nav = el('span', 'devx-panel-nav');
    if (step) {
      const prev = el('button', 'icon-button devx-prev', '‹');
      prev.type = 'button';
      prev.setAttribute('aria-label', 'Previous project');
      prev.addEventListener('click', () => step(-1));
      const next = el('button', 'icon-button devx-next', '›');
      next.type = 'button';
      next.setAttribute('aria-label', 'Next project');
      next.addEventListener('click', () => step(1));
      nav.append(prev, next);
    }
    if (close) {
      const x = el('button', 'icon-button devx-close', '✕');
      x.type = 'button';
      x.setAttribute('aria-label', 'Close project details');
      x.addEventListener('click', close);
      nav.append(x);
    }
    head.append(nav);
  }

  const body = el('div', 'devx-panel-body dev-pop');
  body.append(el('h3', 'devx-panel-title dev-pop-title', project.name));
  if (project.address) body.append(el('p', 'devx-panel-address', project.address));
  else if (project.place) body.append(el('p', 'devx-panel-address', project.place));
  body.append(el('p', 'devx-panel-note', `${project.source === 'city' ? 'Permit' : 'Filing'} ${project.id}`));
  body.append(el('p', `devx-panel-loc${project.approximate || project.awaiting || project.lat == null ? ' warn' : ''}`, locationNote(project)));
  if (project.aliases?.length) body.append(el('p', 'devx-panel-note', `Also filed as ${project.aliases.slice(0, 4).join(', ')}`));

  const tiles = el('div', 'devx-tiles');
  for (const [k, v] of [
    ['Est. cost', money(project.cost) || 'Not listed'],
    ['Size', project.squareFeet ? `${sqft(project.squareFeet)} sf` : 'Not listed'],
    ['Work', project.work || 'Not listed']
  ]) {
    const t = el('div', 'devx-tile');
    t.append(el('span', '', k), el('b', '', v));
    tiles.append(t);
  }
  body.append(tiles);

  const status = project.status === 'Unknown status' && project.statusCode != null ? `Unknown status (TABS code ${project.statusCode})` : project.status;
  if (status || project.start || project.end) {
    const sched = el('div', 'devx-sched');
    const top = el('div', 'devx-sched-top');
    top.append(el('b', '', status || 'Status not listed'), el('span', '', project.start || project.end ? 'Estimated dates from the filing' : ''));
    sched.append(top);
    if (/^\d{4}-\d{2}/.test(project.start ?? '') && /^\d{4}-\d{2}/.test(project.end ?? '') && project.end >= project.start) {
      const a = Date.parse(project.start);
      const b = Date.parse(project.end);
      const pct = Math.max(0, Math.min(100, ((Date.now() - a) / Math.max(1, b - a)) * 100));
      const track = el('div', 'devx-track');
      track.setAttribute('role', 'img');
      track.setAttribute('aria-label', `Estimated ${Math.round(pct)}% of the way from start to finish by today`);
      const fill = el('i');
      fill.style.width = `${pct}%`;
      track.append(fill);
      const ends = el('div', 'devx-sched-ends');
      ends.append(el('span', '', `Start ${MONTH_FMT(project.start)}`), el('span', '', `Finish ${MONTH_FMT(project.end)}`));
      sched.append(track, ends);
    } else {
      const dates = projectDates(project.start, project.end);
      if (dates) sched.append(el('div', 'devx-sched-ends', dates));
    }
    body.append(sched);
  }

  // A firm named on this filing with open jobs in the feed (growth.js matches the names).
  if (hiring.length) {
    const box = el('div', 'devx-hiring dev-pop-hiring');
    box.append(el('p', 'devx-hiring-title', 'Firms on this filing with open roles'));
    for (const { firm, count } of hiring) {
      const row = el('p', 'devx-hiring-row');
      const a = el('a', 'link', `${count} open ${count === 1 ? 'role' : 'roles'} →`);
      a.href = firmJobsHref(firm, location.pathname);
      row.append(el('span', '', firm), a);
      box.append(row);
    }
    box.append(el('p', 'devx-hiring-note', 'Named on the filing as owner, tenant, architect or contractor. Their openings may not be for this project.'));
    body.append(box);
  }
  if (project.scope) body.append(el('p', 'devx-scope dev-pop-scope', project.scope));

  const people = el('dl', 'devx-people dev-pop-people');
  for (const [k, v] of [
    ['Owner', project.owner],
    ['Tenant', project.tenant],
    ['Contractor', project.contractor],
    ['Architect', project.designFirm],
    ['Permit contact', project.contact],
    ['Filed', project.registered ? new Date(`${project.registered.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null],
    // A permit the city lists at several addresses or parcels: every one, so nothing it filed is hidden.
    ['Also filed at', project.addresses?.length > 1 ? project.addresses.slice(1).join('; ') : null],
    ['Permits', project.permits?.length > 1 ? project.permits.join(', ') : null],
    ['Parcels', project.parcels?.length ? project.parcels.join('; ') : null],
    ['City record ids', project.sourceIds?.length > 1 ? project.sourceIds.join(', ') : null]
  ]) {
    if (!v) continue;
    people.append(el('dt', '', k), el('dd', '', v));
  }
  if (people.children.length) body.append(people);

  const foot = el('div', 'devx-panel-foot');
  foot.append(links(project));
  // Status, finish date and cost changes by email; TABS projects only, since city permits carry no TABS number.
  const follow = project.source === 'city' ? null : followButton(projectItem(project.city, project.id, project.name), 'Follow');
  if (follow) foot.append(follow);
  return [head, body, foot];
}

function sqft(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
  return n.toLocaleString('en-US');
}

function links(project) {
  const row = el('span', 'dev-links');
  const site = link(project.developerUrl, project.developerDirect ? "Developer's site ↗" : "Find the developer's site ↗");
  site.className = 'primary small-accent';
  if (!project.developerDirect && project.owner) site.title = `Opens the top web result for ${project.owner}`;
  const filing = link(project.url, project.source === 'city' ? 'City permit ↗' : 'State filing ↗');
  filing.className = 'secondary';
  row.append(site, filing);
  return row;
}

function link(href, text) {
  const a = el('a', 'link', text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

/**
 * Open public construction bids in the metro (TxDOT lettings from the
 * state's open data portal), soonest to close first. Nothing when none.
 */
export function bidsSection(data, city) {
  const rows = (data?.bids ?? []).filter((b) => b.city === city);
  if (!rows.length) return null;
  const box = el('section', 'dev-bids');
  box.setAttribute('aria-labelledby', 'dev-bids-title');
  const title = el('h4', 'dev-bids-title', 'Public bids');
  title.id = 'dev-bids-title';
  box.append(
    title,
    el('p', 'dev-note', `Road, bridge and maintenance contracts taking bids in the ${city} metro's counties, soonest to close first. From TxDOT's project list on the state's open data portal; search the dataset by the project's CSJ number for the plans and bid details.`)
  );
  const list = el('ol', 'dev-bids-list');
  for (const bid of rows) {
    const item = el('li', 'dev-bid');
    const name = link(bid.url, `${bid.title} ↗`);
    const meta = [bid.agency, `${bid.county} County`, bid.csj ? `CSJ ${bid.csj}` : ''].filter(Boolean).join(' · ');
    item.append(name, el('span', 'dev-meta', meta), el('span', 'dev-meta', `Bids due ${dueDate(bid.due)}`));
    list.append(item);
  }
  box.append(list);
  return box;
}

/** "2026-11-03T13:00" → "Nov 3, 2026, 1:00 PM" (Texas time, as published). */
export function dueDate(due) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(due ?? '');
  if (!m) return due ?? '';
  const [, y, mo, d, h, mi] = m;
  const day = new Date(Date.UTC(+y, +mo - 1, +d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  if (h == null || (h === '00' && mi === '00')) return day;
  const hour = +h % 12 || 12;
  return `${day}, ${hour}:${mi} ${+h < 12 ? 'AM' : 'PM'}`;
}

function money(cost) {
  if (!(cost > 0)) return '';
  if (cost >= 1e9) return `$${(cost / 1e9).toFixed(1)}B`;
  if (cost >= 1e8) return `$${Math.round(cost / 1e6)}M`;
  if (cost >= 1e6) return `$${(cost / 1e6).toFixed(1)}M`;
  return `$${Math.round(cost / 1e3)}K`;
}

function el(tag, cls = '', text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}
