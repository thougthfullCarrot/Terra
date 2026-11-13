// pages-fx.js: motion for the signed-in pages (Jobs, Development map, Markets
// and its city pages, News, Events). Cards that a view draws rise in one after
// another, headline figures slide up into place, and the city page's name
// rises in letter by letter. Decoration only: it never changes content, and
// it does nothing under reduced motion.
const still = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

const CARDS = [
  '#list > .card',
  '.news-item',
  '.event-card',
  '.deal-card',
  '.kpi',
  '.city-topics',
  '.talk-card',
  '.devx-teaser',
  '.market-group',
  '.growth-card',
  '.today-stat',
  '.track-card',
  '.city-panel tbody tr',
].join(',');

const seen = new WeakSet();
let batch = [];
let queued = false;

function flush() {
  queued = false;
  const nodes = batch.filter((n) => n.isConnected && n.offsetParent !== null);
  batch = [];
  let i = 0;
  for (const node of nodes) {
    // Only what is on screen or just below it staggers; the rest appears at once.
    const top = node.getBoundingClientRect().top;
    if (top > innerHeight * 1.4) continue;
    node.style.setProperty('--pfx-i', String(Math.min(i++, 12)));
    node.classList.remove('pfx-in');
    node.offsetWidth;
    node.classList.add('pfx-in');
    node.addEventListener('animationend', () => node.classList.remove('pfx-in'), { once: true });
  }
}

function collect(root) {
  if (root.nodeType !== 1) return;
  const found = root.matches?.(CARDS) ? [root] : [];
  found.push(...root.querySelectorAll(CARDS));
  for (const node of found) {
    if (seen.has(node)) continue;
    seen.add(node);
    batch.push(node);
  }
  for (const name of root.matches?.('.city-head-name .role') ? [root] : root.querySelectorAll('.city-head-name .role')) letters(name);
  if (batch.length && !queued) {
    queued = true;
    requestAnimationFrame(flush);
  }
}

/** The city name rises in letter by letter; the heading keeps its text for screen readers. */
function letters(h) {
  if (h.dataset.pfxLetters) return;
  h.dataset.pfxLetters = '1';
  const text = h.textContent;
  h.setAttribute('aria-label', text);
  h.replaceChildren(
    ...[...text].map((ch, i) => {
      const s = document.createElement('span');
      s.className = 'pfx-letter';
      s.setAttribute('aria-hidden', 'true');
      s.style.setProperty('--pfx-i', String(i));
      s.textContent = ch;
      return s;
    }),
  );
}

function start() {
  if (still()) return;
  const main = document.getElementById('main');
  if (!main) return;
  document.documentElement.classList.add('pfx');
  collect(main);
  new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach(collect);
    // A view that was hidden and is shown again replays its entrance.
    for (const r of records) if (r.type === 'attributes' && !r.target.hidden) r.target.querySelectorAll(CARDS).forEach((n) => { seen.delete(n); collect(n); });
  }).observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
