// Signed-out landing: the live counts from stats.json in the "Right now" panel.
// (This file used to draw the Terrain contour lines and the cursor light; the
// A3 redesign retired both, and live.js runs the landing's motion.)
const gate = document.getElementById('gate');
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Counts rise from zero the first time they arrive.
function countTo(el, n) {
  if (still) {
    el.textContent = n.toLocaleString('en-US');
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / 900);
    el.textContent = Math.round(n * (1 - (1 - p) ** 3)).toLocaleString('en-US');
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

async function fillCounts() {
  try {
    const response = await fetch('stats.json', { cache: 'no-cache' });
    if (!response.ok) return;
    const stats = await response.json();
    if (stats?.roles) countTo(document.getElementById('bento-roles'), stats.roles);
    if (stats?.firms) countTo(document.getElementById('bento-firms'), stats.firms);
    const top = stats?.topFirms ?? [];
    if (top.length) {
      const list = document.getElementById('bento-top');
      list.replaceChildren(...top.map((firm) => Object.assign(document.createElement('li'), { textContent: firm })));
      document.getElementById('bento-top-box').hidden = false;
    }
  } catch {}
}

if (gate) fillCounts();
