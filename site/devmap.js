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
  cityProjects,
  COST_BANDS,
  EMPTY_DEV_FILTERS,
  FILED_WINDOWS,
  filterChoices,
  filterProjects,
  markerRadius,
  projectDates,
  PUBLIC_INVOLVEMENT
} from './market.js';
import { firmJobsHref, growthJobs, hiringOn } from './growth.js';

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
/** The filter panel's open state once someone toggles it; null follows the screen width. */
let panelOpen = null;

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
  liveMap?.remove();
  liveMap = null;
}

/**
 * The map card. With several cities it shows a city switcher and calls
 * onCity when one is picked; on a city's own page, cities is just that one.
 */
export function developmentMap({ data, cities, city, bids, onCity }) {
  const box = el('section', 'card dev-card');
  box.setAttribute('aria-labelledby', 'dev-title');
  const head = el('div', 'dev-head');
  const title = el('h3', 'group-title', `${city} metro development map`);
  title.id = 'dev-title';
  head.append(
    title,
    el(
      'p',
      'group-blurb',
      `New buildings and additions under way in the ${city} metro, from state filings over the last two years${PERMIT_CITIES[city] ? ` and ${PERMIT_CITIES[city]} building permits` : ''}. Click a pin or a project for the details and a link to the developer.`
    )
  );
  // Watchlists (migration 0017): new filings in this metro by email. Null while they're off.
  const followArea = followButton(areaItem(city), 'Follow new filings here');
  if (followArea) head.append(followArea);
  box.append(head);

  const controls = el('div', 'dev-controls');
  if (cities.length > 1) {
    const pick = el('div', 'metric-pills dev-cities');
    pick.setAttribute('role', 'group');
    pick.setAttribute('aria-label', 'City');
    for (const name of cities) {
      const chip = el('button', 'chip', name);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(name === city));
      chip.addEventListener('click', () => onCity(name));
      pick.append(chip);
    }
    controls.append(pick);
  }
  const legend = el('span', 'dev-legend');
  legend.append(el('i', 'dot private'), 'Public involvement not indicated ', el('i', 'dot public'), 'Public involvement indicated');
  box.append(controls);

  if (filtersCity !== city) {
    filters = { ...filters, place: '' };
    filtersCity = city;
  }
  const all = cityProjects(data?.projects, city);
  const asOf = data?.asOf ?? new Date().toISOString();
  const panel = filterPanel(all, () => apply());
  controls.append(panel.node);

  const results = el('div', 'dev-results');
  const count = el('p', 'dev-count');
  count.setAttribute('aria-live', 'polite');
  const clear = el('button', 'chip dev-clear', 'Clear filters');
  clear.type = 'button';
  clear.addEventListener('click', () => {
    filters = { ...EMPTY_DEV_FILTERS };
    panel.sync();
    apply();
  });
  results.append(count, clear, legend);
  box.append(results);

  const layout = el('div', 'dev-layout');
  const mapNode = el('div', 'dev-map');
  mapNode.setAttribute('role', 'region');
  mapNode.setAttribute('aria-label', `Map of ${city} metro development projects`);
  mapNode.append(el('div', 'state dev-loading', 'Loading the map…'));
  const list = el('ol', 'dev-list');
  list.setAttribute('aria-label', `${city} metro development projects, biggest first`);
  const empty = el('li', 'dev-empty');
  empty.hidden = true;
  const emptyClear = el('button', 'link dev-empty-clear', 'Clear filters');
  emptyClear.type = 'button';
  emptyClear.addEventListener('click', () => clear.click());
  const hint = el('span', 'dev-meta', 'Try a wider cost range or filing window, or ');
  hint.append(emptyClear, '.');
  empty.append(el('strong', '', 'No projects match these filters.'), hint);
  layout.append(mapNode, list);
  const note = el('p', 'dev-note');
  box.append(layout, note);
  const bidList = bidsSection(bids, city);
  if (bidList) box.append(bidList);

  const placed = all.filter((p) => p.lat != null && p.lng != null);
  const updated = data?.asOf ? new Date(data.asOf).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const near = placed.filter((p) => p.approximate).length;
  const parts = [`${placed.length} of ${all.length} projects have a map location`];
  if (near) parts.push(`${near} with a dashed outline sit at the center of their ZIP code because their new address is not on the Census street map yet`);
  const sources = all.some((p) => p.source === 'city') ? `state TABS filings and ${PERMIT_CITIES[city] ?? 'city'} building permits` : 'state TABS filings';
  note.textContent = all.length
    ? `${parts.join('; ')}. From ${sources}${updated ? `, updated ${updated}` : ''}. Costs are the owner's estimate. The filing date is the TABS registration date, or the permit's issue date for city permits. Single-family homes are not included${PERMIT_CITIES[city] ? '' : ", and this metro's cities do not publish their permits, so smaller projects may be missing"}.`
    : 'No projects to show yet.';

  const items = drawList(list, all);
  list.append(empty);
  let map = null;

  const apply = () => {
    const shown = filterProjects(all, filters, asOf);
    // Keyed by the project itself: city permit ids can repeat in a metro.
    const ids = new Set(shown);
    for (const [project, item] of items) item.hidden = !ids.has(project);
    empty.hidden = shown.length > 0 || !all.length;
    const active = activeFilterCount(filters);
    const pins = shown.filter((p) => p.lat != null && p.lng != null).length;
    count.replaceChildren(
      el('strong', '', shown.length.toLocaleString('en-US')),
      ` ${active ? `of ${all.length.toLocaleString('en-US')} ` : ''}${shown.length === 1 ? 'project' : 'projects'}`,
      el('span', 'dev-count-pins', ` · ${pins.toLocaleString('en-US')} ${pins === 1 ? 'pin' : 'pins'} on the map`)
    );
    clear.hidden = !active;
    panel.badge(active);
    mapNode.dataset.matches = String(shown.length);
    map?.show(ids);
  };
  apply();
  // After the card is on the page: Leaflet measures its container.
  queueMicrotask(() =>
    drawMap(mapNode, list, all, city)
      .then((drawn) => {
        if (!drawn) return;
        map = drawn;
        apply();
      })
      .catch((error) => {
        mapNode.replaceChildren(el('div', 'state error', error instanceof Error ? error.message : "Couldn't load the map."));
      })
  );
  return box;
}

/** The filter controls: a search box and menus built from the values the metro's projects carry. */
function filterPanel(all, onChange) {
  const choices = filterChoices(all);
  const details = el('details', 'dev-filters');
  const narrow = window.matchMedia?.('(max-width: 760px)').matches;
  details.open = panelOpen ?? !narrow;
  details.addEventListener('toggle', () => {
    panelOpen = details.open;
  });
  const summary = el('summary', 'dev-filters-summary');
  const badge = el('span', 'dev-filters-badge');
  summary.append(el('span', '', 'Filter projects'), badge);
  const body = el('div', 'dev-filters-body');
  details.append(summary, body);

  const search = el('label', 'search dev-search');
  const input = el('input');
  input.type = 'search';
  input.placeholder = 'Search name, project number or address';
  input.setAttribute('aria-label', 'Search projects by name, project number or address');
  input.autocomplete = 'off';
  input.enterKeyHint = 'search';
  search.insertAdjacentHTML('beforeend', '<svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>');
  search.append(input);
  let timer = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      filters = { ...filters, query: input.value };
      onChange();
    }, 120);
  });
  body.append(search);

  const grid = el('div', 'filters dev-filter-grid');
  const selects = {};
  const menu = (key, label, options) => {
    if (!options.length) return;
    const wrap = el('label');
    const select = el('select');
    select.append(new Option(`All`, ''));
    for (const o of options) select.append(new Option(o.label, o.value));
    select.addEventListener('change', () => {
      filters = { ...filters, [key]: select.value };
      onChange();
    });
    wrap.append(el('span', 'dev-filter-label', label), select);
    grid.append(wrap);
    selects[key] = select;
  };
  const tally = (rows) => rows.map((r) => ({ value: r.value, label: `${r.value} (${r.count})` }));
  if (choices.places.length > 1) menu('place', 'City or town', tally(choices.places));
  menu('work', 'Type of work', tally(choices.works));
  menu('publicInvolvement', 'Public involvement', PUBLIC_INVOLVEMENT.map((o) => ({ value: o.key, label: o.label })));
  menu('cost', 'Estimated cost', COST_BANDS.map((b) => ({ value: b.key, label: b.label })));
  if (choices.statuses.length > 1) menu('status', 'Filing status', tally(choices.statuses));
  menu('filed', 'Filed', FILED_WINDOWS.map((w) => ({ value: w.key, label: w.label })));
  body.append(grid);

  const sync = () => {
    input.value = filters.query;
    for (const [key, select] of Object.entries(selects)) {
      // A saved choice this metro doesn't carry (another metro's status) shows as All and is dropped.
      select.value = filters[key];
      if (select.value !== filters[key]) {
        select.value = '';
        filters = { ...filters, [key]: '' };
      }
    }
  };
  sync();
  return {
    node: details,
    sync,
    badge(active) {
      badge.textContent = active ? `${active} on` : '';
      badge.hidden = !active;
    }
  };
}

const markers = new Map();

/**
 * Draws every project's pin once; show() then adds or removes pins as the
 * filters change, so filtering never rebuilds the map. Null when the card
 * left the page while Leaflet loaded.
 */
async function drawMap(node, list, projects, city) {
  const L = await loadLeaflet();
  if (!node.isConnected) return null;
  disposeMap();
  markers.clear();
  node.replaceChildren();
  const map = L.map(node, { scrollWheelZoom: true });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>');
  liveMap = map;
  L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
  const layer = L.featureGroup().addTo(map);

  const styles = getComputedStyle(document.documentElement);
  const color = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  const fills = { private: color('--accent', '#2b4a8b'), public: color('--amber', '#b8722e') };
  const max = Math.max(...projects.map((p) => p.cost), 1);
  const placed = projects.filter((p) => p.lat != null && p.lng != null);
  for (const project of placed) {
    const fill = project.isPublic ? fills.public : fills.private;
    const marker = L.circleMarker([project.lat, project.lng], {
      radius: markerRadius(project.cost, max),
      color: '#ffffff',
      weight: 1.5,
      fillColor: fill,
      fillOpacity: project.approximate ? 0.45 : 0.78,
      dashArray: project.approximate ? '3 3' : null
    });
    marker.bindPopup(() => popup(project), { maxWidth: 300, autoPanPadding: [24, 24] });
    marker.bindTooltip(project.name, { direction: 'top', offset: [0, -6] });
    marker.on('popupopen', () => highlight(list, project));
    markers.set(project, marker);
  }
  const center = () => map.setView(CENTERS[city] ?? [31, -99], 9);
  let last = null;
  let viewed = false;
  return {
    show(ids) {
      const key = projects.map((p) => (ids.has(p) ? 1 : 0)).join('');
      if (key === last) return;
      last = key;
      const visible = [];
      for (const [project, marker] of markers) {
        const on = ids.has(project);
        if (on) visible.push(marker.getLatLng());
        if (on !== layer.hasLayer(marker)) on ? layer.addLayer(marker) : layer.removeLayer(marker);
      }
      node.dataset.pins = String(visible.length);
      if (visible.length) map.fitBounds(L.latLngBounds(visible), { padding: [28, 28], maxZoom: 14 });
      else if (!viewed) center();
      viewed = true;
    }
  };
}

/** The list beside the map, every project once; filtering hides items. Returns project → item. */
function drawList(list, projects) {
  const items = new Map();
  list.replaceChildren(
    ...projects.map((project) => {
      const item = el('li', 'dev-item');
      const onMap = project.lat != null && project.lng != null;
      const button = el('button', 'dev-pick');
      button.type = 'button';
      const meta = [project.place, money(project.cost), project.work, project.status].filter(Boolean).join(' · ');
      button.append(
        el('span', `dot ${project.isPublic ? 'public' : 'private'}`),
        el('span', 'dev-name', project.name),
        el('span', 'dev-meta', meta),
        el('span', 'dev-meta', project.owner ? `Owner: ${project.owner}` : project.source === 'city' ? 'City building permit' : 'Owner not listed')
      );
      if (!onMap) button.append(el('span', 'dev-off', 'Not on the map'));
      button.addEventListener('click', () => {
        const marker = markers.get(project);
        if (!marker || !liveMap) return;
        liveMap.flyTo(marker.getLatLng(), Math.max(liveMap.getZoom(), 15), { duration: 0.6 });
        liveMap.once('moveend', () => marker.openPopup());
      });
      item.append(button, links(project));
      items.set(project, item);
      rows.set(project, item);
      return item;
    })
  );
  return items;
}

/** Each project's list item, for highlighting the one whose pin opened. */
const rows = new WeakMap();

function highlight(list, project) {
  const row = rows.get(project);
  for (const item of list.children) item.classList.toggle('active', item === row);
  const active = list.querySelector('.dev-item.active');
  if (active) list.scrollTo({ top: active.offsetTop - list.offsetTop - 8, behavior: 'smooth' });
}

function popup(project) {
  const box = el('div', 'dev-pop');
  box.append(el('strong', 'dev-pop-title', project.name));
  if (project.facility) box.append(el('span', 'dev-pop-line', project.facility));
  if (project.place && !project.address) box.append(el('span', 'dev-pop-line muted', project.place));
  if (project.address) box.append(el('span', 'dev-pop-line muted', project.address));
  if (project.approximate) box.append(el('span', 'dev-pop-line muted', 'Pin is near the ZIP code center, not the exact site.'));
  const facts = [money(project.cost), project.work, project.squareFeet ? `${project.squareFeet.toLocaleString('en-US')} sq ft` : ''].filter(Boolean);
  box.append(el('span', 'dev-pop-line', facts.join(' · ')));
  const status = project.status === 'Unknown status' && project.statusCode != null ? `Unknown status (TABS code ${project.statusCode})` : project.status;
  const when = [status, projectDates(project.start, project.end)].filter(Boolean).join(' · ');
  if (when) box.append(el('span', 'dev-pop-line muted', when));
  const people = el('dl', 'dev-pop-people');
  for (const [label, value] of [
    ['Owner', project.owner],
    ['Tenant', project.tenant],
    ['Architect', project.designFirm],
    ['Contractor', project.contractor],
    ['Permit contact', project.contact],
    // A permit the city lists at several addresses or parcels: every one, so nothing it filed is hidden.
    ['Also filed at', project.addresses?.length > 1 ? project.addresses.slice(1).join('; ') : null],
    ['Permits', project.permits?.length > 1 ? project.permits.join(', ') : null],
    ['Parcels', project.parcels?.length ? project.parcels.join('; ') : null],
    ['City record ids', project.sourceIds?.length > 1 ? project.sourceIds.join(', ') : null]
  ]) {
    if (!value) continue;
    people.append(el('dt', '', label), el('dd', '', value));
  }
  if (people.children.length) box.append(people);
  // A firm on this project with open jobs in the feed (growth.js matches the names).
  const hiring = hiringOn(project, growthJobs());
  if (hiring.length) {
    const line = el('p', 'dev-pop-hiring', 'Hiring now: ');
    hiring.forEach(({ firm, count }, i) => {
      if (i) line.append(', ');
      const a = el('a', 'link', `${firm} (${count} ${count === 1 ? 'job' : 'jobs'})`);
      a.href = firmJobsHref(firm, location.pathname);
      line.append(a);
    });
    box.append(line);
  }
  if (project.scope) box.append(el('p', 'dev-pop-scope', project.scope));
  box.append(links(project));
  // Status, finish date and cost changes by email; TABS projects only, since city permits carry no TABS number.
  const followProject = project.source === 'city' ? null : followButton(projectItem(project.city, project.id, project.name), 'Follow this project');
  if (followProject) box.append(followProject);
  return box;
}

function links(project) {
  const row = el('span', 'dev-links');
  const site = link(project.developerUrl, project.developerDirect ? "Developer's site ↗" : "Find the developer's site ↗");
  if (!project.developerDirect && project.owner) site.title = `Opens the top web result for ${project.owner}`;
  row.append(site, link(project.url, project.source === 'city' ? 'City permit ↗' : 'State filing ↗'));
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
