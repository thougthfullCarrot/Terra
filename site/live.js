// live.js — the moving parts shared across the site: the tab underline that
// slides to the open section, numbers that count to a new value, and the small
// Texas map used on the sign-in page and the Markets overview.

import { updatedLabel } from './feed.js';

const still = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/* ---------------------------------------------------------------------------
   Tabs: one underline that slides between sections instead of each tab
   drawing its own. The first placement jumps; every later one glides.
   --------------------------------------------------------------------------- */

export function startTabSlider() {
  const tabs = document.querySelector('.appbar .tabs');
  if (!tabs) return;
  const bar = document.createElement('span');
  bar.className = 'tab-slider';
  bar.setAttribute('aria-hidden', 'true');
  tabs.append(bar);
  let placed = false;
  const place = () => {
    const tab = tabs.querySelector('.tab[aria-current="page"]');
    if (!tab || !tab.offsetWidth) {
      bar.style.opacity = '0';
      placed = false;
      return;
    }
    const jump = !placed || still();
    if (jump) bar.style.transition = 'none';
    bar.style.opacity = '1';
    bar.style.width = `${tab.offsetWidth}px`;
    bar.style.transform = `translateX(${tab.offsetLeft}px)`;
    if (jump) {
      bar.offsetWidth;
      bar.style.transition = '';
    }
    placed = true;
  };
  tabs.classList.add('sliding');
  new MutationObserver(place).observe(tabs, { subtree: true, attributes: true, attributeFilter: ['aria-current', 'hidden'] });
  new ResizeObserver(() => {
    placed = false;
    place();
  }).observe(tabs);
}

/* ---------------------------------------------------------------------------
   Numbers that count from what they said to what they say now. A new target
   mid-count picks up from the value on screen.
   --------------------------------------------------------------------------- */

const counting = new WeakMap();
const NUMBER = /^(\D*?)(-?[\d,]+(?:\.\d+)?)(.*)$/s;

export function countText(node, from, to, ms = 480) {
  const a = NUMBER.exec(from ?? '');
  const b = NUMBER.exec(to ?? '');
  cancelAnimationFrame(counting.get(node) ?? 0);
  if (!a || !b || a[1] !== b[1] || from === to || still()) {
    node.textContent = to;
    return;
  }
  const n0 = Number(a[2].replace(/,/g, ''));
  const n1 = Number(b[2].replace(/,/g, ''));
  const places = (b[2].split('.')[1] ?? '').length;
  const grouped = b[2].includes(',') || Math.abs(n1) >= 1000;
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / ms);
    const v = n0 + (n1 - n0) * (1 - (1 - p) ** 4);
    node.textContent = p < 1 ? `${b[1]}${v.toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places, useGrouping: grouped })}${b[3]}` : to;
    if (p < 1) counting.set(node, requestAnimationFrame(step));
  };
  counting.set(node, requestAnimationFrame(step));
}

/* ---------------------------------------------------------------------------
   The Texas map: a rough state outline and dots at known cities. A locator,
   not a survey; cities it doesn't know are left off rather than guessed.
   --------------------------------------------------------------------------- */

const OUTLINE = [[-106.6, 32.0], [-103.06, 32.0], [-103.06, 36.5], [-100.0, 36.5], [-100.0, 34.56], [-99.2, 34.4], [-98.0, 34.0], [-96.9, 33.9], [-95.9, 33.85], [-94.48, 33.64], [-94.04, 33.55], [-94.04, 31.0], [-93.6, 30.0], [-93.84, 29.7], [-94.7, 29.35], [-95.1, 29.0], [-96.4, 28.4], [-97.2, 27.6], [-97.4, 26.6], [-97.15, 25.95], [-97.5, 25.9], [-98.3, 26.1], [-99.1, 26.45], [-99.5, 27.5], [-100.3, 28.3], [-100.7, 29.1], [-101.4, 29.77], [-102.4, 29.78], [-102.7, 29.4], [-103.1, 29.0], [-103.9, 29.3], [-104.5, 29.7], [-104.9, 30.6], [-105.6, 31.1]];

/** [longitude, latitude] for the Texas cities job and market data name. */
export const TEXAS_PLACES = {
  Dallas: [-96.8, 32.78], 'Fort Worth': [-97.33, 32.75], Arlington: [-97.11, 32.74], Irving: [-96.95, 32.81], Plano: [-96.7, 33.02], Frisco: [-96.82, 33.15], McKinney: [-96.62, 33.2],
  Richardson: [-96.73, 32.95], Garland: [-96.64, 32.91], Denton: [-97.13, 33.21], 'Grand Prairie': [-97.0, 32.75], Addison: [-96.83, 32.96],
  Houston: [-95.37, 29.76], 'The Woodlands': [-95.49, 30.17], 'Sugar Land': [-95.63, 29.62], Katy: [-95.82, 29.79], Conroe: [-95.46, 30.31], Galveston: [-94.8, 29.3], Pasadena: [-95.21, 29.69],
  Austin: [-97.74, 30.27], 'Round Rock': [-97.68, 30.51], Georgetown: [-97.68, 30.63], Pflugerville: [-97.62, 30.44], 'San Marcos': [-97.94, 29.88],
  'San Antonio': [-98.49, 29.42], 'New Braunfels': [-98.12, 29.7], 'El Paso': [-106.44, 31.76], 'Corpus Christi': [-97.4, 27.8], Lubbock: [-101.86, 33.58], Amarillo: [-101.83, 35.22],
  McAllen: [-98.23, 26.2], Brownsville: [-97.5, 25.9], Laredo: [-99.51, 27.53], Midland: [-102.08, 32.0], Odessa: [-102.37, 31.85], Waco: [-97.15, 31.55], Killeen: [-97.73, 31.12],
  Tyler: [-95.3, 32.35], Beaumont: [-94.1, 30.08], 'College Station': [-96.33, 30.63], Bryan: [-96.37, 30.67], Abilene: [-99.73, 32.45], 'Wichita Falls': [-98.49, 33.91], Longview: [-94.74, 32.5]
};

/** "Dallas, TX", "Dallas-Fort Worth" and "Dallas" all find Dallas. */
export function placeOf(name) {
  const plain = String(name ?? '').replace(/,\s*(TX|Texas)\b.*$/i, '').trim();
  if (TEXAS_PLACES[plain]) return { name: plain, at: TEXAS_PLACES[plain] };
  const first = plain.split(/\s*[-–\/]\s*/)[0];
  return TEXAS_PLACES[first] ? { name: first, at: TEXAS_PLACES[first] } : null;
}

const project = ([lon, lat]) => [(lon + 106.8) * 26, (36.7 - lat) * 26 * 1.15];
const LAND = `M${OUTLINE.map((p) => project(p).map((n) => n.toFixed(1)).join(',')).join('L')}Z`;
const SVG = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

/**
 * A Texas map with one dot per place: { name, at, r, label, side, tone, onPick }.
 * The outline draws itself and the dots arrive one after another the first
 * time it's on screen; a picked place gets a ring that glides between dots.
 */
export function texasMap(places, { label, picked = null, from = null, animate = true } = {}) {
  const svg = svgEl('svg', { class: 'tx-map', viewBox: '-4 -4 358 336', role: places.some((p) => p.onPick) ? 'group' : 'img', 'aria-label': label });
  if (!animate || still()) svg.classList.add('settled');
  svg.append(svgEl('path', { class: 'tx-land', d: LAND, pathLength: 1 }));
  places.forEach((place, i) => {
    const [x, y] = project(place.at);
    const g = svgEl('g', { class: `tx-pin${place.tone ? ` ${place.tone}` : ''}`, 'data-place': place.name });
    g.style.setProperty('--i', String(i));
    g.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    g.append(svgEl('circle', { class: 'tx-halo', r: (place.r + 5).toFixed(1) }), svgEl('circle', { class: 'tx-dot', r: place.r.toFixed(1) }));
    if (place.label) {
      const left = place.side < 0;
      const text = svgEl('text', { class: 'tx-label', x: left ? -(place.r + 5) : place.r + 5, y: 4, 'text-anchor': left ? 'end' : 'start' });
      text.textContent = place.label;
      if (place.count != null) {
        const n = svgEl('tspan', { class: 'tx-n' });
        n.textContent = ` ${place.count}`;
        text.append(n);
      }
      g.append(text);
    }
    if (place.onPick) {
      g.setAttribute('role', 'button');
      g.setAttribute('tabindex', '0');
      g.setAttribute('aria-label', place.name);
      g.setAttribute('aria-pressed', String(place.name === picked));
      const tip = svgEl('title');
      tip.textContent = place.name;
      g.prepend(tip);
      g.addEventListener('click', () => place.onPick(place.name));
      g.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        place.onPick(place.name);
      });
    }
    svg.append(g);
  });
  const chosen = places.find((p) => p.name === picked);
  if (chosen) {
    const ring = svgEl('g', { class: 'tx-ring', 'aria-hidden': 'true' });
    ring.append(svgEl('circle', { r: (chosen.r + 7).toFixed(1) }));
    const to = project(chosen.at);
    const was = from ? places.find((p) => p.name === from) : null;
    const start = was ? project(was.at) : to;
    ring.style.transform = `translate(${start[0].toFixed(1)}px, ${start[1].toFixed(1)}px)`;
    svg.append(ring);
    // The map is redrawn on each pick, so the ring starts where the last pick was and glides over.
    if (was && was !== chosen) requestAnimationFrame(() => requestAnimationFrame(() => (ring.style.transform = `translate(${to[0].toFixed(1)}px, ${to[1].toFixed(1)}px)`)));
  }
  return svg;
}

/** A ring that spreads from a dot, for a count that just went up. */
export function ripple(svg, name) {
  const g = svg.querySelector(`.tx-pin[data-place="${CSS.escape(name)}"]`);
  if (!g || still()) return;
  const r = g.querySelector('.tx-dot').getAttribute('r');
  const ring = svgEl('circle', { class: 'tx-ripple', r });
  g.prepend(ring);
  ring.animate([{ transform: 'scale(1)', opacity: 0.7 }, { transform: 'scale(4.5)', opacity: 0 }], { duration: 1400, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }).onfinish = () => ring.remove();
}

/* ---------------------------------------------------------------------------
   Sign-in page: where today's roles are, from the per-city counts site.yml
   publishes in stats.json (counts only, never postings).
   --------------------------------------------------------------------------- */

const LABELED = 4;

/* ---------------------------------------------------------------------------
   The landing's first-visit motion: the headline word by word, the copy and
   the panel after it, the bands below as they scroll in, and the panel leaning
   toward the cursor. It runs once, the first time the sign-in page shows.
   --------------------------------------------------------------------------- */

export function startLanding() {
  const gate = document.getElementById('gate');
  if (!gate) return;
  let started = false;
  const start = () => {
    if (started || gate.hidden) return;
    started = true;
    arrive(gate);
    fillPill();
    reveal();
    lean(gate.querySelector('.hero-panel'));
  };
  start();
  new MutationObserver(start).observe(gate, { attributes: true, attributeFilter: ['hidden'] });
}

/** Adds an entrance class with a delay, and takes it off once played so later transforms (the lean) aren't held by it. */
function enter(node, cls, delay) {
  node.style.setProperty('--d', `${Math.round(delay)}ms`);
  node.classList.add(cls);
  node.addEventListener('animationend', (event) => event.target === node && node.classList.remove(cls), { once: true });
}

function arrive(gate) {
  const h1 = gate.querySelector('h1');
  let n = 0;
  // Only text nodes are split, so any markup inside the headline survives.
  const split = (node) =>
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === 1) return split(child);
      if (child.nodeType !== 3) return;
      const frag = document.createDocumentFragment();
      for (const part of child.textContent.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          frag.append(part);
          continue;
        }
        const w = document.createElement('span');
        w.className = 'land-w';
        w.style.setProperty('--d', `${120 + n++ * 55}ms`);
        w.textContent = part;
        frag.append(w);
      }
      child.replaceWith(frag);
    });
  if (h1) split(h1);
  let delay = 120 + n * 55;
  for (const node of gate.querySelector('.hero-copy')?.children ?? []) {
    if (node === h1 || node.hidden || node.classList.contains('visually-hidden')) continue;
    enter(node, 'land-in', node.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_PRECEDING ? (delay += 90) : 0);
  }
  const panel = gate.querySelector('.hero-panel');
  if (panel) enter(panel, 'land-panel', Math.min(delay, 520) + 120);
}

/** "79 open roles at 26 firms · updated 2 hours ago", counting up once. */
async function fillPill() {
  const pill = document.getElementById('live-pill');
  if (!pill) return;
  let stats;
  try {
    const response = await fetch('stats.json', { cache: 'no-cache' });
    if (!response.ok) return;
    stats = await response.json();
  } catch {
    return;
  }
  if (!stats?.roles) return;
  pill.hidden = false;
  countText(document.getElementById('live-roles'), '0', String(stats.roles), 800);
  countText(document.getElementById('live-firms'), '0', String(stats.firms ?? 0), 800);
  if (stats.generatedAt) document.getElementById('live-updated').textContent = ` · ${updatedLabel(stats.generatedAt).toLowerCase()}`;
}

function reveal() {
  const nodes = document.querySelectorAll('#welcome .welcome-block > h2, #welcome .steps > li, #welcome .features > *, #welcome .plans > *, #welcome .faq details, #welcome .welcome-cta');
  if (!nodes.length || !('IntersectionObserver' in window)) return;
  const seen = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in');
        seen.unobserve(entry.target);
      }),
    { rootMargin: '0px 0px -80px 0px' }
  );
  for (const node of nodes) {
    node.style.setProperty('--i', String([...node.parentElement.children].indexOf(node) % 8));
    node.classList.add('land-rv');
    seen.observe(node);
  }
}

/** The panel leans a few degrees toward the cursor on a spring: decorative, so fine pointers only. */
function lean(panel) {
  const fine = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
  if (!panel || !fine || still()) return;
  const host = panel.parentElement;
  host.style.perspective = '1400px';
  let x = 0;
  let y = 0;
  let vx = 0;
  let vy = 0;
  let tx = 0;
  let ty = 0;
  let frame = 0;
  let last = 0;
  const loop = (now) => {
    const dt = Math.min(0.032, (now - (last || now)) / 1000) || 0.016;
    last = now;
    vx += (90 * (tx - x) - 13 * vx) * dt;
    vy += (90 * (ty - y) - 13 * vy) * dt;
    x += vx * dt;
    y += vy * dt;
    panel.style.transform = `rotateX(${(-y * 4).toFixed(2)}deg) rotateY(${(x * 6).toFixed(2)}deg)`;
    if (Math.abs(tx - x) + Math.abs(ty - y) + Math.abs(vx) + Math.abs(vy) > 0.001) frame = requestAnimationFrame(loop);
    else {
      frame = 0;
      last = 0;
    }
  };
  const aim = (nx, ny) => {
    tx = nx;
    ty = ny;
    if (!frame) frame = requestAnimationFrame(loop);
  };
  host.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse' || panel.classList.contains('land-panel')) return;
    const r = panel.getBoundingClientRect();
    aim((event.clientX - r.left) / r.width - 0.5, (event.clientY - r.top) / r.height - 0.5);
  });
  host.addEventListener('pointerleave', () => aim(0, 0));
}

/** stats.json is rebuilt every two hours; an open sign-in page checks again this often. */
const RECHECK_MS = 10 * 60 * 1000;

export function startGateMap() {
  const host = document.getElementById('bento-map-box');
  if (!host) return;
  let shown = null;
  let busy = false;
  const check = async () => {
    if (busy || document.hidden || document.getElementById('gate')?.hidden) return;
    busy = true;
    const totals = await cityTotals().finally(() => (busy = false));
    if (!totals) return;
    // Only redraw when something changed; a city whose count went up ripples.
    const key = JSON.stringify([...totals]);
    if (shown && key === shown.key) return;
    const svg = drawGateMap(host, totals, { animate: !shown });
    if (shown) for (const [name, n] of totals) if (n > (shown.totals.get(name) ?? 0)) ripple(svg, name);
    shown = { key, totals };
  };
  check();
  setInterval(check, RECHECK_MS);
  // With accounts on, the sign-in page is shown only after account.js hears from Supabase, after this first check.
  const gate = document.getElementById('gate');
  if (gate) new MutationObserver(() => !gate.hidden && check()).observe(gate, { attributes: true, attributeFilter: ['hidden'] });
}

async function cityTotals() {
  let stats;
  try {
    const response = await fetch('stats.json', { cache: 'no-cache' });
    if (!response.ok) return null;
    stats = await response.json();
  } catch {
    return null;
  }
  const rows = (stats?.byCity ?? []).map((row) => ({ ...row, place: placeOf(row.city) })).filter((row) => row.place && row.n > 0);
  if (!rows.length) return null;
  // Suburbs not on the map are left off; the rest add up per dot.
  const totals = new Map();
  for (const row of rows) totals.set(row.place.name, (totals.get(row.place.name) ?? 0) + row.n);
  return totals;
}

function drawGateMap(host, totals, { animate }) {
  const ranked = [...totals].sort((a, b) => b[1] - a[1]);
  const places = ranked.map(([name, n], i) => ({
    name,
    at: TEXAS_PLACES[name],
    r: 2.5 + Math.sqrt(n) * 1.1,
    label: i < LABELED ? name : '',
    count: i < LABELED ? n : null,
    side: TEXAS_PLACES[name][0] < -97.5 ? -1 : 1
  }));
  const placed = ranked.reduce((sum, [, n]) => sum + n, 0);
  const svg = texasMap(places, { label: `Open roles by Texas city: ${ranked.slice(0, LABELED).map(([name, n]) => `${name} ${n}`).join(', ')}`, animate });
  host.querySelector('.bento-map').replaceChildren(svg);
  host.querySelector('.bento-s').textContent = `${placed.toLocaleString('en-US')} roles in ${ranked.length} ${ranked.length === 1 ? 'city' : 'cities'}`;
  host.hidden = false;
  return svg;
}
