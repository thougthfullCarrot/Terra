// sites-view.js — the site finder on the Market data tab: land and buildings
// from public parcel maps, filtered by use, zoning, size and land value per
// square foot. The rules live in sites.js; the list in sites.json, loaded the
// first time the finder opens.
import { commonZoning, DEFAULT_SITE_FILTER, filterSites, formatArea, SITE_SORTS } from './sites.js';

const PAGE = 50;
const USES = [
  ['', 'All'],
  ['land', 'Vacant land'],
  ['commercial', 'Commercial buildings'],
  ['industrial', 'Industrial buildings']
];

let file = null;
let loading = null;
let filter = { ...DEFAULT_SITE_FILTER };
let shown = PAGE;

function load() {
  loading ??= fetch('sites.json', { cache: 'no-cache' })
    .then((response) => {
      if (response.status === 404) return { sites: [], sources: [] };
      if (!response.ok) throw new Error(`sites.json returned ${response.status}`);
      return response.json();
    })
    .then((data) => (file = data))
    .catch((error) => {
      loading = null;
      throw error;
    });
  return loading;
}

/** The finder for one city or all of them. Draws a placeholder and fills it once the list has loaded. */
export function sitesView(snapshot, city) {
  const root = el('div', 'sites-view');
  if (file) draw(root, city);
  else {
    root.append(el('div', 'state', 'Loading sites…'));
    load()
      .then(() => root.isConnected && draw(root, city))
      .catch((error) => root.replaceChildren(el('div', 'state error', `Couldn't load the site list. ${error instanceof Error ? error.message : ''}`.trim())));
  }
  return root;
}

function draw(root, city) {
  const sources = file.sources ?? [];
  const covered = sources.map((s) => s.city);
  if (!file.sites?.length) {
    root.replaceChildren(el('div', 'state', 'The site list is being built. Check back after the next update.'));
    return;
  }
  if (city && !covered.includes(city)) {
    root.replaceChildren(
      el(
        'div',
        'state',
        `${city} isn't in the site finder yet: its parcel map doesn't publish appraised values. It covers ${covered.join(', ')}. Pick one of those, or All markets.`
      )
    );
    return;
  }

  const form = el('form', 'card sites-filters');
  form.addEventListener('submit', (e) => e.preventDefault());

  const uses = el('div', 'metric-pills');
  uses.setAttribute('role', 'group');
  uses.setAttribute('aria-label', 'Property use');
  for (const [value, label] of USES) {
    const chip = el('button', 'chip', label);
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(filter.use === value));
    chip.addEventListener('click', () => change({ use: value }));
    uses.append(chip);
  }

  const zoningList = `sites-zoning-${Math.random().toString(36).slice(2, 8)}`;
  const fields = el('div', 'calc-form');
  fields.append(
    field('ZONING', input('text', filter.zoning, (v) => change({ zoning: v }, false), { placeholder: 'e.g. MF, I, PD', list: zoningList })),
    field('LAND $/SQ FT FROM', input('number', filter.minPsf, (v) => change({ minPsf: number(v) }, false), { min: 0, step: 1, placeholder: 'Any' })),
    field('LAND $/SQ FT TO', input('number', filter.maxPsf, (v) => change({ maxPsf: number(v) }, false), { min: 0, step: 1, placeholder: 'Any' })),
    field('ACRES FROM', input('number', filter.minAcres, (v) => change({ minAcres: number(v) }, false), { min: 0, step: 0.5, placeholder: 'Any' })),
    field('ACRES TO', input('number', filter.maxAcres, (v) => change({ maxAcres: number(v) }, false), { min: 0, step: 0.5, placeholder: 'Any' }))
  );
  const sort = el('select');
  for (const [value, label] of SITE_SORTS) sort.append(new Option(label, value));
  sort.value = filter.sort;
  sort.addEventListener('change', () => change({ sort: sort.value }));
  fields.append(field('SORT', sort));

  const suggestions = el('datalist');
  suggestions.id = zoningList;
  for (const z of commonZoning(file.sites.filter((s) => !city || s.city === city))) suggestions.append(new Option(z, z));
  form.append(uses, fields, suggestions);

  const results = el('div', 'sites-results');
  results.setAttribute('aria-live', 'polite');
  root.replaceChildren(form, results, notes(sources, city));
  list(results, city);

  // Typing redraws only the results, so the field keeps focus.
  function change(next, redrawForm = true) {
    filter = { ...filter, ...next };
    shown = PAGE;
    if (redrawForm) draw(root, city);
    else list(results, city);
  }
}

function list(box, city) {
  const matches = filterSites(file.sites, city, filter);
  const count = el('p', 'market-asof', `${matches.length.toLocaleString('en-US')} site${matches.length === 1 ? '' : 's'}${city ? ` in ${city}` : ''}`);
  if (!matches.length) {
    box.replaceChildren(count, el('div', 'state', 'No sites match. Widen the price or size range, or clear the zoning filter.'));
    return;
  }
  const wrap = el('div', 'table-wrap');
  const table = el('table', 'market-table sites-table');
  table.append(el('caption', 'visually-hidden', 'Sites matching the filters'));
  const head = el('tr');
  for (const [text, cls] of [['Site', 'city-col'], ['Use', ''], ['Zoning', ''], ['Land', 'num'], ['Land $/sq ft', 'num'], ['Appraised value', 'num']]) {
    const th = el('th', cls, text);
    th.scope = 'col';
    head.append(th);
  }
  const thead = el('thead');
  thead.append(head);
  const body = el('tbody');
  for (const site of matches.slice(0, shown)) {
    const tr = el('tr');
    const name = el('th', 'city-col');
    name.scope = 'row';
    name.append(el('span', 'site-address', site.address));
    const links = el('span', 'metro');
    links.append(`${site.city} · `);
    if (site.lat != null) links.append(link('Map', `https://www.google.com/maps/search/?api=1&query=${site.lat},${site.lng}`), ' · ');
    if (site.url) links.append(link('Appraisal record', site.url));
    else links.append(`Appraisal account ${site.id}`);
    name.append(links);
    const use = el('td', '', { land: 'Vacant land', commercial: 'Commercial', industrial: 'Industrial' }[site.use]);
    use.append(el('span', 'metric-meta', [site.code, site.built ? `built ${site.built}` : '', site.flood && !/^X/.test(site.flood) ? `flood ${site.flood}` : ''].filter(Boolean).join(' · ')));
    const zoning = el('td', 'site-zoning', site.zoning ?? (site.city === 'Houston' ? 'No zoning' : '—'));
    tr.append(
      name,
      use,
      zoning,
      el('td', 'num', formatArea(site.landSqft)),
      el('td', 'num', site.landPsf == null ? '—' : `$${site.landPsf.toFixed(2)}`),
      el('td', 'num', money(site.value))
    );
    body.append(tr);
  }
  table.append(thead, body);
  wrap.append(table);
  const parts = [count, wrap];
  if (matches.length > shown) {
    const more = el('button', 'chip sites-more', `Show ${Math.min(PAGE, matches.length - shown)} more`);
    more.type = 'button';
    more.addEventListener('click', () => {
      shown += PAGE;
      list(box, city);
    });
    parts.push(more);
  }
  box.replaceChildren(...parts);
}

function notes(sources, city) {
  const box = el('div', 'market-sources');
  const p = el('p', '', 'Sources: ');
  sources
    .filter((s) => !city || s.city === city)
    .forEach((s, i) => {
      p.append(i ? ' · ' : '', link(s.name, s.page));
    });
  box.append(
    p,
    el(
      'p',
      '',
      'The largest privately owned parcels per city and use, between a quarter acre and 100 acres. In San Antonio and Austin, vacant land includes every vacant tract, so check the zoning column. Values are what the appraisal district set for taxes, not asking or sale prices. Zoning is the city zoning map at the center of the parcel; confirm it with the city before relying on it. Houston has no zoning.'
    ),
    el('p', '', `List built ${file.generatedAt ? new Date(file.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}. Dallas and El Paso publish parcel maps without values, so they are not covered yet.`)
  );
  return box;
}

function field(label, control) {
  const wrap = el('label', 'calc-field');
  wrap.append(el('span', 'eyebrow', label), control);
  return wrap;
}

function input(type, value, onInput, attrs = {}) {
  const box = el('span', 'calc-input');
  const node = el('input');
  node.type = type;
  if (type === 'number') node.inputMode = 'decimal';
  node.value = value == null ? '' : String(value);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  node.addEventListener('input', () => onInput(node.value));
  box.append(node);
  return box;
}

function money(value) {
  if (value == null) return '—';
  if (value >= 1e6) return `$${(value / 1e6).toFixed(value >= 1e8 ? 0 : 1)}M`;
  if (value >= 1e3) return `$${Math.round(value / 1e3)}K`;
  return `$${Math.round(value)}`;
}

function number(text) {
  if (String(text).trim() === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function link(text, href) {
  const a = el('a', 'link', text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function el(tag, cls = '', text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}
