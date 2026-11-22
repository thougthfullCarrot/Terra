// landing-welcome.js — the Horizon sections under the landing hero: the
// statements row, "Hiring most right now" and the metros map. Public data
// only: stats.json (role and firm counts, the top firms, roles by city),
// which the sign-in page already shows. No postings, market figures or
// filings, which stay behind sign-in.
import { OUTLINE, TEXAS_PLACES, project } from './live.js';
import { countText } from './live.js';

const METROS = ['Dallas', 'Fort Worth', 'Houston', 'Austin', 'San Antonio', 'El Paso', 'New Braunfels', 'College Station', 'Galveston', 'Lubbock', 'Midland'];
const LABEL_AT = { Dallas: [10, -8, 'start'], 'Fort Worth': [-10, -8, 'end'], Houston: [10, -6, 'start'], Galveston: [10, 12, 'start'], Austin: [-10, -6, 'end'], 'San Antonio': [-10, 10, 'end'], 'New Braunfels': [10, 8, 'start'], 'College Station': [8, -10, 'start'], Lubbock: [0, -12, 'middle'], Midland: [0, 16, 'middle'], 'El Paso': [0, 16, 'middle'] };
const SVG = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function drawMetros(host) {
  if (!host || host.firstChild) return;
  const land = OUTLINE.map(project);
  const xs = land.map((p) => p[0]);
  const ys = land.map((p) => p[1]);
  const pad = 30;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const w = Math.max(...xs) - minX + pad;
  const h = Math.max(...ys) - minY + pad;
  const map = svg('svg', { viewBox: `${minX} ${minY} ${w} ${h}`, role: 'img', 'aria-label': `Texas, with the metros Terra covers: ${METROS.join(', ')}` });
  map.append(svg('path', { class: 'hzm-land', d: `M${land.map((p) => p.map((n) => n.toFixed(1)).join(',')).join('L')}Z` }));
  for (const city of METROS) {
    const [x, y] = project(TEXAS_PLACES[city]);
    map.append(svg('circle', { class: 'hzm-dot', cx: x.toFixed(1), cy: y.toFixed(1), r: 3.2 }));
    const [dx, dy, anchor] = LABEL_AT[city] ?? [0, 14, 'middle'];
    const t = svg('text', { class: 'hzm-label', x: (x + dx).toFixed(1), y: (y + dy).toFixed(1), 'text-anchor': anchor });
    t.textContent = city.toUpperCase();
    map.append(t);
  }
  host.append(map);
}

async function fill() {
  let stats;
  try {
    const response = await fetch('stats.json', { cache: 'no-cache' });
    if (!response.ok) return;
    stats = await response.json();
  } catch {
    return;
  }
  // Statements the hero's counts don't already make: how many cities have
  // roles, and the city with the most.
  const byCity = (stats?.byCity ?? []).filter((r) => r.n > 0 && r.city && r.city !== 'Texas').sort((a, b) => b.n - a.n);
  const values = { cities: byCity.length, top: byCity[0]?.n };
  for (const node of document.querySelectorAll('#hz-stats [data-k]')) {
    const n = values[node.dataset.k];
    if (Number.isFinite(n) && n > 0) countText(node, '0', String(n), 900);
  }
  if (byCity[0]) document.getElementById('hz-top-text').textContent = `open roles in ${byCity[0].city}, the most of any Texas city right now, each linking straight to the firm.`;
  const firms = document.getElementById('hz-firms');
  if (firms && Array.isArray(stats?.topFirms) && stats.topFirms.length) {
    firms.replaceChildren(
      ...stats.topFirms.map((name, i) => {
        const li = document.createElement('li');
        li.className = 'hz-card';
        const b = document.createElement('b');
        b.textContent = name;
        const s = document.createElement('span');
        s.textContent = i === 0 ? 'Most open roles right now' : 'Hiring now';
        li.append(b, s);
        return li;
      })
    );
  }
  const cities = document.getElementById('hz-cities');
  const rows = byCity.slice(0, 3);
  if (cities && rows.length) cities.textContent = `Most roles in ${rows.map((r) => `${r.city} (${r.n})`).join(', ')}.`;
}

export function startLandingWelcome() {
  const welcome = document.getElementById('welcome');
  if (!welcome) return;
  drawMetros(document.getElementById('hz-metros'));
  // Every "Create a free account" in these sections goes back to the one sign-up form.
  welcome.addEventListener('click', (event) => {
    const button = event.target.closest('[data-signup]');
    if (!button) return;
    document.getElementById('mode-create')?.click();
    const email = document.getElementById('signin-email');
    document.getElementById('gate')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    setTimeout(() => email?.focus({ preventScroll: true }), 400);
  });
  let done = false;
  const go = () => {
    if (done || welcome.hidden) return;
    done = true;
    fill();
  };
  go();
  new MutationObserver(go).observe(welcome, { attributes: true, attributeFilter: ['hidden'] });
}
