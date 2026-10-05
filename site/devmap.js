// devmap.js — the development map on the market data section: each city's
// biggest current projects from the state's TABS register, as pins on an
// OpenStreetMap map, with a list beside it. Each project links to its
// developer's website and its state filing.
//
// Leaflet (site/vendor, copied from npm by build:site) loads the first time a
// map is shown, so the rest of the site never waits for it.
import { cityProjects, markerRadius, projectDates } from './market.js';

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

/** Where to center a city with no pins. */
const CENTERS = {
  Dallas: [32.7767, -96.797],
  'Fort Worth': [32.7555, -97.3308],
  Houston: [29.7604, -95.3698],
  Austin: [30.2672, -97.7431],
  'San Antonio': [29.4241, -98.4936],
  'El Paso': [31.7619, -106.485]
};

let leaflet = null;
let liveMap = null;
let privateOnly = false;

function loadLeaflet() {
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
export function developmentMap({ data, cities, city, onCity }) {
  const box = el('section', 'card dev-card');
  box.setAttribute('aria-labelledby', 'dev-title');
  const head = el('div', 'dev-head');
  const title = el('h3', 'group-title', `${city} development map`);
  title.id = 'dev-title';
  head.append(
    title,
    el(
      'p',
      'group-blurb',
      'The biggest new buildings and additions registered with the state in the last year. Click a pin or a project for the details and a link to the developer.'
    )
  );
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
  const toggle = el('label', 'dev-toggle');
  const check = el('input');
  check.type = 'checkbox';
  check.checked = privateOnly;
  toggle.append(check, ' Private developments only');
  const legend = el('span', 'dev-legend');
  legend.append(el('i', 'dot private'), 'Private ', el('i', 'dot public'), 'Public (schools, cities, universities)');
  controls.append(toggle, legend);
  box.append(controls);

  const layout = el('div', 'dev-layout');
  const mapNode = el('div', 'dev-map');
  mapNode.setAttribute('role', 'region');
  mapNode.setAttribute('aria-label', `Map of ${city} development projects`);
  const list = el('ol', 'dev-list');
  list.setAttribute('aria-label', `${city} development projects, biggest first`);
  layout.append(mapNode, list);
  const note = el('p', 'dev-note');
  box.append(layout, note);

  const draw = () => {
    const projects = cityProjects(data?.projects, city, { privateOnly });
    const placed = projects.filter((p) => p.lat != null && p.lng != null);
    const updated = data?.asOf ? new Date(data.asOf).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    const near = placed.filter((p) => p.approximate).length;
    const parts = [`${placed.length} of ${projects.length} projects are on the map`];
    if (near) parts.push(`${near} with a dashed outline sit at the center of their ZIP code because their new address is not on the Census street map yet`);
    note.textContent = projects.length
      ? `${parts.join('; ')}. From state TABS filings${updated ? `, updated ${updated}` : ''}. Costs are the owner's estimate.`
      : 'No projects to show yet.';
    drawList(list, projects);
    drawMap(mapNode, list, projects, city).catch((error) => {
      mapNode.replaceChildren(el('div', 'state error', error instanceof Error ? error.message : "Couldn't load the map."));
    });
  };
  check.addEventListener('change', () => {
    privateOnly = check.checked;
    draw();
  });
  // After the card is on the page: Leaflet measures its container.
  queueMicrotask(draw);
  return box;
}

const markers = new Map();

async function drawMap(node, list, projects, city) {
  const L = await loadLeaflet();
  if (!node.isConnected) return;
  disposeMap();
  markers.clear();
  const map = L.map(node, { scrollWheelZoom: false });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>');
  liveMap = map;
  L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);

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
    marker.on('popupopen', () => highlight(list, project.id));
    marker.addTo(map);
    markers.set(project.id, marker);
  }
  if (placed.length) map.fitBounds(L.latLngBounds(placed.map((p) => [p.lat, p.lng])), { padding: [28, 28], maxZoom: 14 });
  else map.setView(CENTERS[city] ?? [31, -99], 11);
}

function drawList(list, projects) {
  list.replaceChildren(
    ...projects.map((project) => {
      const item = el('li', 'dev-item');
      item.dataset.id = project.id;
      const onMap = project.lat != null && project.lng != null;
      const button = el('button', 'dev-pick');
      button.type = 'button';
      const meta = [money(project.cost), project.work, project.status].filter(Boolean).join(' · ');
      button.append(
        el('span', `dot ${project.isPublic ? 'public' : 'private'}`),
        el('span', 'dev-name', project.name),
        el('span', 'dev-meta', meta),
        el('span', 'dev-meta', project.owner ? `Owner: ${project.owner}` : 'Owner not listed')
      );
      if (!onMap) button.append(el('span', 'dev-off', 'Not on the map'));
      button.addEventListener('click', () => {
        const marker = markers.get(project.id);
        if (!marker || !liveMap) return;
        liveMap.flyTo(marker.getLatLng(), Math.max(liveMap.getZoom(), 15), { duration: 0.6 });
        liveMap.once('moveend', () => marker.openPopup());
      });
      item.append(button, links(project));
      return item;
    })
  );
}

function highlight(list, id) {
  for (const item of list.children) item.classList.toggle('active', item.dataset.id === id);
  const active = list.querySelector('.dev-item.active');
  if (active) list.scrollTo({ top: active.offsetTop - list.offsetTop - 8, behavior: 'smooth' });
}

function popup(project) {
  const box = el('div', 'dev-pop');
  box.append(el('strong', 'dev-pop-title', project.name));
  if (project.facility) box.append(el('span', 'dev-pop-line', project.facility));
  if (project.address) box.append(el('span', 'dev-pop-line muted', project.address));
  if (project.approximate) box.append(el('span', 'dev-pop-line muted', 'Pin is near the ZIP code center, not the exact site.'));
  const facts = [money(project.cost), project.work, project.squareFeet ? `${project.squareFeet.toLocaleString('en-US')} sq ft` : ''].filter(Boolean);
  box.append(el('span', 'dev-pop-line', facts.join(' · ')));
  const when = [project.status, projectDates(project.start, project.end)].filter(Boolean).join(' · ');
  if (when) box.append(el('span', 'dev-pop-line muted', when));
  const people = el('dl', 'dev-pop-people');
  for (const [label, value] of [
    ['Owner', project.owner],
    ['Tenant', project.tenant],
    ['Design', project.designFirm]
  ]) {
    if (!value) continue;
    people.append(el('dt', '', label), el('dd', '', value));
  }
  if (people.children.length) box.append(people);
  if (project.scope) box.append(el('p', 'dev-pop-scope', project.scope));
  box.append(links(project));
  return box;
}

function links(project) {
  const row = el('span', 'dev-links');
  const site = link(project.developerUrl, project.developerDirect ? "Developer's site ↗" : "Find the developer's site ↗");
  if (!project.developerDirect && project.owner) site.title = `Opens the top web result for ${project.owner}`;
  row.append(site, link(project.url, 'State filing ↗'));
  return row;
}

function link(href, text) {
  const a = el('a', 'link', text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
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
