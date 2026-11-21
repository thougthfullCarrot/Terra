// devoverview.js — the Development map's first screen: all of Texas in the
// Horizon look. The state outline, every headline filing as a point at its
// own coordinates, a ring and a label for each metro, and a row of metros
// with their filing counts. Picking a metro (its ring, its label or its
// button) opens the street map for it (devmap.js).
//
// Counts: a metro's filings come from developments.metros (what the build
// read from TDLR TABS for it) when the build carries them; otherwise from the
// projects listed. The points are the headline projects in market.json, so
// "shown" is how many of those have coordinates. Status is the filing's own
// (Registered or Plans reviewed), never construction progress.
import { OUTLINE, TEXAS_PLACES, project } from './live.js';

const SVG = 'http://www.w3.org/2000/svg';

/**
 * Where each metro's label sits, in screen pixels from its ring, with a
 * leader line when it is pulled out: DFW, the I-35 run (Austin, New
 * Braunfels, San Antonio) and the coast (Houston, Galveston) otherwise
 * overprint each other. [dx, dy, anchor]
 */
const LABEL_AT = {
  Dallas: [34, -22, 'start'],
  'Fort Worth': [-36, 22, 'end'],
  Austin: [-46, -34, 'end'],
  'College Station': [34, -34, 'start'],
  'New Braunfels': [52, 22, 'start'],
  'San Antonio': [-48, 26, 'end'],
  Houston: [44, -30, 'start'],
  Galveston: [40, 34, 'start'],
  Lubbock: [0, -26, 'middle'],
  Midland: [0, 30, 'middle'],
  'El Paso': [0, 30, 'middle']
};
/** On a phone the pull-outs shrink with the map. */
const PHONE_SCALE = 0.62;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** 2976 -> "3.0K", 143 -> "143". */
export function compactCount(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

/** Per metro: filings on record (the build's TABS count when present) and the projects drawn. */
export function metroCounts(data, cities) {
  const read = new Map((data?.metros ?? []).map((m) => [m.city, m.filings]));
  return cities
    .map((city) => {
      const listed = (data?.projects ?? []).filter((p) => p.city === city);
      return { city, filings: Number.isFinite(read.get(city)) ? read.get(city) : listed.length, listed };
    })
    .sort((a, b) => b.filings - a.filings);
}

export function devOverview({ data, cities, onCity }) {
  const metros = metroCounts(data, cities);
  const total = metros.reduce((n, m) => n + m.filings, 0);
  const pinned = (data?.projects ?? []).filter((p) => cities.includes(p.city) && p.lat != null && p.lng != null);

  const box = el('section', 'devx-overview');
  box.setAttribute('aria-labelledby', 'devo-title');

  const head = el('div', 'devo-head');
  head.append(
    el('p', 'devo-eyebrow', `${total.toLocaleString('en-US')} filings · ${pinned.length.toLocaleString('en-US')} shown`),
    Object.assign(el('h2', 'devo-title', 'Texas'), { id: 'devo-title' }),
    el('p', 'devo-hint', 'Pick a metro to open its map.')
  );

  // The state, projected the way the landing map does it (live.js).
  const land = OUTLINE.map(project);
  const xs = land.map((p) => p[0]);
  const ys = land.map((p) => p[1]);
  const pad = 24;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const w = Math.max(...xs) - minX + pad + 36; // room for the Galveston label
  const h = Math.max(...ys) - minY + pad;
  const map = svg('svg', { viewBox: `${minX.toFixed(1)} ${minY.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`, class: 'devo-map', role: 'group', 'aria-label': 'Texas development filings by metro' });
  map.append(svg('path', { class: 'devo-land', d: `M${land.map((p) => p.map((n) => n.toFixed(1)).join(',')).join('L')}Z` }));

  // Every headline filing at its own point: square = plans reviewed, dot = registered, hollow = approximate location.
  const points = svg('g', { class: 'devo-points', 'aria-hidden': 'true' });
  const marks = pinned.map((p, i) => {
    const [x, y] = project([p.lng, p.lat]);
    const node = p.status === 'Plans reviewed' ? svg('rect') : svg('circle', { cx: x.toFixed(2), cy: y.toFixed(2) });
    node.setAttribute('class', `devo-pt${p.approximate ? ' approx' : ''}`);
    node.style.setProperty('--i', String(i % 40));
    points.append(node);
    return { node, x, y };
  });
  map.append(points);

  // A ring and label per metro, each a button into its map.
  const hubs = svg('g', { class: 'devo-hubs' });
  const rings = [];
  for (const m of metros) {
    const at = TEXAS_PLACES[m.city];
    if (!at) continue;
    const [x, y] = project(at);
    const hub = svg('g', { class: 'devo-hub', tabindex: 0, role: 'button', 'aria-label': `${m.city}: ${m.filings.toLocaleString('en-US')} filings. Open its map.` });
    const ring = svg('circle', { class: 'devo-ring', cx: x.toFixed(1), cy: y.toFixed(1) });
    const hit = svg('circle', { class: 'devo-hit', cx: x.toFixed(1), cy: y.toFixed(1) });
    const glow = svg('circle', { class: 'devo-glow', cx: x.toFixed(1), cy: y.toFixed(1) });
    const leader = svg('line', { class: 'devo-leader' });
    const label = svg('text', { class: 'devo-label' });
    const name = svg('tspan', { class: 'devo-name' });
    name.textContent = m.city.toUpperCase();
    const num = svg('tspan', { class: 'devo-num' });
    num.textContent = m.filings.toLocaleString('en-US');
    label.append(name, num);
    hub.append(glow, ring, hit, leader, label);
    rings.push({ ring, glow, hit, leader, label, name, num, x, y, at: LABEL_AT[m.city] ?? [0, 30, 'middle'], share: m.filings / Math.max(1, metros[0].filings) });
    const go = () => onCity(m.city);
    hub.addEventListener('click', go);
    hub.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
      }
    });
    hubs.append(hub);
  }
  map.append(hubs);

  // Marks and labels keep a steady on-screen size whatever size the state is
  // drawn at: u is one screen pixel in map units, measured from the drawing.
  const fit = () => {
    const box = map.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const u = 1 / Math.min(box.width / w, box.height / h);
    const f = (n) => (n * u).toFixed(2);
    for (const { node, x, y } of marks) {
      if (node.tagName === 'rect') {
        const half = box.width < 520 ? 1.1 : 1.6;
        node.setAttribute('x', (x - half * u).toFixed(2));
        node.setAttribute('y', (y - half * u).toFixed(2));
        node.setAttribute('width', f(half * 2));
        node.setAttribute('height', f(half * 2));
      } else node.setAttribute('r', f(box.width < 520 ? 1.2 : 1.7));
    }
    const small = box.width < 520;
    const k = small ? PHONE_SCALE : 1;
    for (const { ring, glow, hit, leader, label, name, num, x, y, at, share } of rings) {
      // Ring area follows the metro's filings: Houston biggest, the smallest still visible.
      const r = (4 + 10 * Math.sqrt(share)) * k * u;
      ring.setAttribute('r', r.toFixed(2));
      glow.setAttribute('r', (r * 2.2).toFixed(2));
      hit.setAttribute('r', (r + 10 * u).toFixed(2));
      const [dx, dy, anchor] = at;
      const lx = x + dx * k * u;
      const ly = y + dy * k * u;
      // A leader from the ring's edge toward the label when it is pulled out.
      const far = Math.hypot(dx, dy) * k > 30;
      leader.setAttribute('visibility', far ? 'visible' : 'hidden');
      if (far) {
        const t = r / Math.hypot(lx - x, ly - y);
        leader.setAttribute('x1', (x + (lx - x) * t).toFixed(2));
        leader.setAttribute('y1', (y + (ly - y) * t).toFixed(2));
        leader.setAttribute('x2', (lx - (anchor === 'start' ? 4 : anchor === 'end' ? -4 : 0) * u).toFixed(2));
        leader.setAttribute('y2', (ly - 4 * u).toFixed(2));
      }
      label.setAttribute('text-anchor', anchor);
      label.setAttribute('font-size', f(small ? 9 : 11.5));
      label.setAttribute('stroke-width', f(3));
      name.setAttribute('x', lx.toFixed(2));
      name.setAttribute('y', ly.toFixed(2));
      num.setAttribute('x', lx.toFixed(2));
      num.setAttribute('dy', '1.25em');
    }
  };
  new ResizeObserver(fit).observe(map);

  const stage = el('div', 'devo-stage');
  stage.append(map);

  const legend = el('p', 'devo-legend');
  legend.innerHTML = '<span><i class="sq"></i>Plans reviewed</span><span><i class="dot"></i>Registered</span><span><i class="ring"></i>Approximate location</span><span>Filing status, not construction progress</span>';

  // The metros as buttons, biggest first.
  const row = el('div', 'devo-metros');
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Metros');
  const all = el('button', 'devo-metro on', 'All Texas');
  all.type = 'button';
  all.setAttribute('aria-pressed', 'true');
  row.append(all);
  for (const m of metros) {
    const b = el('button', 'devo-metro');
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    b.append(m.city, ' ', el('span', 'n', compactCount(m.filings)));
    b.addEventListener('click', () => onCity(m.city));
    row.append(b);
  }

  // Arrows either side scroll the row; each dims at its end. Wheel, swipe and Tab still work too.
  const rowWrap = el('div', 'devo-metros-wrap');
  const arrow = (dir, label) => {
    const b = el('button', `devo-scroll ${dir < 0 ? 'prev' : 'next'}`);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.innerHTML = `<svg viewBox="0 0 18 18" aria-hidden="true"><path d="${dir < 0 ? 'M11 3L5 9l6 6' : 'M7 3l6 6-6 6'}"/></svg>`;
    b.addEventListener('click', () => row.scrollBy({ left: dir * row.clientWidth * 0.8, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
    return b;
  };
  const back = arrow(-1, 'Scroll metros left');
  const fwd = arrow(1, 'Scroll metros right');
  const ends = () => {
    const max = row.scrollWidth - row.clientWidth - 1;
    back.disabled = row.scrollLeft <= 0;
    fwd.disabled = row.scrollLeft >= max;
    rowWrap.classList.toggle('more-left', row.scrollLeft > 0);
    rowWrap.classList.toggle('more-right', row.scrollLeft < max);
  };
  row.addEventListener('scroll', ends, { passive: true });
  new ResizeObserver(ends).observe(row);
  rowWrap.append(back, row, fwd);

  box.append(head, stage, legend, rowWrap);
  return box;
}
