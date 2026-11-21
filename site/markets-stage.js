// markets-stage.js — the Markets page in the Horizon look: one metro on
// stage at a time (its name, metro, and the topic's headline figures with
// their ranks), Previous/Next and a rail of every metro, then all of them
// ranked on one figure as bars. Picking a bar puts that metro on stage;
// "Open <city>" goes to the city's own page (markets-view.js).
//
// Every figure, rank and "same as <metro>" note comes from market.js, the
// same helpers the table and city pages use. A figure a city repeats from
// its metro is shown with that note and is not ranked twice.
import { defaultOrder, formatValue, ordinal, rankedCount, ranks, sharedWith, sortMarkets } from './market.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** The metro on stage and the figure the bars rank by survive re-renders. */
let onStage = null;
let barKey = null;
let keysBound = false;

/** "#2 of 11" where the metric has a better end; "3rd highest of 11" where it has none (rent, prices). */
function rankText(markets, metric, city) {
  const market = markets.find((m) => m.city === city);
  if (!market || market.values?.[metric.key] == null) return 'No figure';
  const shared = sharedWith(market, metric.key);
  if (shared) return `Same as ${shared}`;
  const place = ranks(markets, metric).get(city);
  const n = rankedCount(markets, metric.key);
  if (!place) return '';
  return metric.better ? `#${place} of ${n}` : `${ordinal(place)} highest of ${n}`;
}

/**
 * @param {object} o
 * @param {object} o.snapshot    the pruned market snapshot
 * @param {object} o.group       the open topic (its metrics lead the stage)
 * @param {(key: string) => object|undefined} o.metricFor
 * @param {(city: string) => string} o.cityHref   the city page's hash
 */
export function marketStage({ snapshot, group, metricFor, cityHref }) {
  const markets = snapshot.markets;
  const metrics = group.metrics.map(metricFor).filter(Boolean).filter((m) => markets.some((x) => x.values?.[m.key] != null));
  const lead = metrics[0];
  if (!lead) return el('p', 'muted', 'No figures for this topic yet.');
  const order = sortMarkets(markets, lead.key, defaultOrder(lead));
  if (!order.some((m) => m.city === onStage)) onStage = order[0].city;
  if (!metrics.some((m) => m.key === barKey)) barKey = lead.key;
  const shown = metrics.slice(0, 4);

  const root = el('div', 'mstage-wrap');

  // ---- The stage.
  const stage = el('section', 'mstage');
  stage.setAttribute('aria-label', 'One market at a time');
  const top = el('div', 'mstage-top');
  const count = el('p', 'mstage-count');
  const arrows = el('div', 'mstage-arrows');
  const prev = el('button', 'mstage-arrow');
  prev.type = 'button';
  prev.setAttribute('aria-label', 'Previous market');
  prev.innerHTML = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M11 3L5 9l6 6"/></svg>';
  const next = el('button', 'mstage-arrow');
  next.type = 'button';
  next.setAttribute('aria-label', 'Next market');
  next.innerHTML = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M7 3l6 6-6 6"/></svg>';
  arrows.append(prev, next);
  top.append(count, arrows);

  const name = el('h2', 'mstage-city');
  name.setAttribute('aria-live', 'polite');
  const metro = el('p', 'mstage-metro');
  const figs = el('div', 'mstage-figs');
  const open = el('a', 'mstage-open');
  const rail = el('div', 'mstage-rail');
  rail.setAttribute('role', 'group');
  rail.setAttribute('aria-label', 'Markets');
  for (const m of order) {
    const b = el('button', '', m.city);
    b.type = 'button';
    b.addEventListener('click', () => put(m.city));
    rail.append(b);
  }
  stage.append(top, name, metro, figs, open, rail);

  // ---- All of them on one figure.
  const compare = el('section', 'mcompare');
  const chead = el('div', 'mcompare-head');
  chead.append(el('h3', 'mcompare-title', `All ${order.length}, one figure`));
  const pick = el('div', 'mcompare-pick');
  pick.setAttribute('role', 'group');
  pick.setAttribute('aria-label', 'Figure');
  for (const m of metrics) {
    const b = el('button', 'mcompare-chip', m.label);
    b.type = 'button';
    b.dataset.key = m.key;
    b.addEventListener('click', () => {
      barKey = m.key;
      drawBars();
    });
    pick.append(b);
  }
  chead.append(pick);
  const bars = el('div', 'mcompare-bars');
  const note = el('p', 'mcompare-note');
  compare.append(chead, bars, note);
  root.append(stage, compare);

  function put(city) {
    onStage = city;
    const i = order.findIndex((m) => m.city === city);
    const m = order[i];
    count.textContent = `Market ${i + 1} of ${order.length} · ranked by ${lead.label.toLowerCase()}`;
    name.replaceChildren(...[...m.city].map((c, k) => {
      const s = el('span', 'ch', c === ' ' ? ' ' : c);
      s.style.setProperty('--k', String(k));
      return s;
    }));
    name.classList.remove('swap');
    void name.offsetWidth; // restart the letters' entrance
    name.classList.add('swap');
    metro.textContent = m.metro ?? '';
    figs.replaceChildren(...shown.map((metric) => {
      const box = el('div', 'mstage-fig');
      const shared = sharedWith(m, metric.key);
      box.append(
        el('b', 'num', formatValue(m.values?.[metric.key], metric.unit)),
        el('span', 'label', metric.label),
        el('span', 'rank', rankText(markets, metric, m.city))
      );
      if (shared) box.title = `Same figure as ${shared} (shared metro)`;
      return box;
    }));
    open.href = cityHref(m.city);
    open.textContent = `Open ${m.city} →`;
    for (const b of rail.children) b.setAttribute('aria-current', String(b.textContent === m.city));
    rail.children[i]?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
    drawBars();
  }

  function drawBars() {
    const metric = metricFor(barKey) ?? lead;
    for (const b of pick.children) b.setAttribute('aria-pressed', String(b.dataset.key === metric.key));
    const rows = sortMarkets(markets, metric.key, defaultOrder(metric)).filter((m) => m.values?.[metric.key] != null);
    const vals = rows.map((m) => m.values[metric.key]);
    const lo = Math.min(0, ...vals);
    const hi = Math.max(0, ...vals);
    const span = hi - lo || 1;
    bars.replaceChildren(...rows.map((m) => {
      const v = m.values[metric.key];
      const shared = sharedWith(m, metric.key);
      const b = el('button', `mcompare-bar${m.city === onStage ? ' on' : ''}`);
      b.type = 'button';
      const track = el('span', 'track');
      const fill = el('i');
      // Bars grow from zero, so a negative change reads as a bar to the left of the axis.
      const zero = ((0 - lo) / span) * 100;
      const at = ((v - lo) / span) * 100;
      fill.style.left = `${Math.min(zero, at)}%`;
      fill.style.width = `${Math.max(0.6, Math.abs(at - zero))}%`;
      track.append(fill);
      b.append(el('span', 'city', m.city), track, el('span', 'val num', `${formatValue(v, metric.unit)}${shared ? '*' : ''}`));
      if (shared) b.title = `Same figure as ${shared} (shared metro)`;
      b.addEventListener('click', () => {
        put(m.city);
        stage.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      });
      return b;
    }));
    const sharedAny = rows.some((m) => sharedWith(m, metric.key));
    note.textContent = `${metric.label}${metric.note ? ` · ${metric.note}` : ''}${sharedAny ? ' · * repeats its metro’s figure' : ''}`;
  }

  const step = (d) => {
    const i = order.findIndex((m) => m.city === onStage);
    put(order[(i + d + order.length) % order.length].city);
  };
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  if (!keysBound) {
    keysBound = true;
    addEventListener('keydown', (e) => {
      const live = document.querySelector('.mstage');
      if (!live || !live.isConnected || live.closest('[hidden]') || e.target.closest?.('input, select, textarea')) return;
      if (e.key === 'ArrowRight') live.querySelector('.mstage-arrow:last-child')?.click();
      if (e.key === 'ArrowLeft') live.querySelector('.mstage-arrow:first-child')?.click();
    });
  }

  put(onStage);
  return root;
}
