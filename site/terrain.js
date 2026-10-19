// Signed-out landing (Terrain): contour lines that rise toward the cursor, a
// soft accent light that follows it, and the live counts from stats.json.
const gate = document.getElementById('gate');
const canvas = document.getElementById('terrain-topo');
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
let t = 0;
let drifting = false;
let mx = -1e4;
let my = -1e4;
let queued = false;

function height(x, y) {
  let v = Math.sin(x * 0.006 + t * 0.3) * 1.2 + Math.cos(y * 0.008 + x * 0.002 - t * 0.2) * 1.1 + Math.sin((x + y) * 0.004 + t * 0.15) * 0.9 + Math.cos(x * 0.011 - y * 0.005) * 0.5;
  if (!still) {
    const dx = x - mx;
    const dy = y - my;
    v += 1.6 * Math.exp(-(dx * dx + dy * dy) / 18000);
  }
  return v;
}

function draw() {
  queued = false;
  if (!canvas || gate.hidden) return;
  const r = canvas.getBoundingClientRect();
  if (!r.width) return;
  const d = devicePixelRatio || 1;
  if (canvas.width !== Math.round(r.width * d) || canvas.height !== Math.round(r.height * d)) {
    canvas.width = Math.round(r.width * d);
    canvas.height = Math.round(r.height * d);
  }
  const g = canvas.getContext('2d');
  g.setTransform(d, 0, 0, d, 0, 0);
  g.clearRect(0, 0, r.width, r.height);
  const css = getComputedStyle(gate);
  const major = css.getPropertyValue('--terrain-major').trim();
  const minor = css.getPropertyValue('--terrain-minor').trim();
  const s = 8;
  const cols = Math.ceil(r.width / s) + 1;
  const rows = Math.ceil(r.height / s) + 1;
  const v = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) v[j * cols + i] = height(i * s, j * s);
  let k = 0;
  for (let L = -3; L <= 4.6; L += 0.35, k++) {
    g.strokeStyle = k % 4 === 0 ? major : minor;
    g.lineWidth = k % 4 === 0 ? 1.2 : 1;
    g.beginPath();
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = v[j * cols + i];
        const b = v[j * cols + i + 1];
        const c = v[(j + 1) * cols + i];
        const e = v[(j + 1) * cols + i + 1];
        const x = i * s;
        const y = j * s;
        const p = [];
        if ((a - L) * (b - L) < 0) p.push(x + ((L - a) / (b - a)) * s, y);
        if ((b - L) * (e - L) < 0) p.push(x + s, y + ((L - b) / (e - b)) * s);
        if ((c - L) * (e - L) < 0) p.push(x + ((L - c) / (e - c)) * s, y + s);
        if ((a - L) * (c - L) < 0) p.push(x, y + ((L - a) / (c - a)) * s);
        if (p.length >= 4) {
          g.moveTo(p[0], p[1]);
          g.lineTo(p[2], p[3]);
        }
        if (p.length === 8) {
          g.moveTo(p[4], p[5]);
          g.lineTo(p[6], p[7]);
        }
      }
    }
    g.stroke();
  }
}

// The terrain drifts slowly while the landing is on screen and the tab is visible.
function drift() {
  if (!drifting) return;
  t += 0.012;
  draw();
  requestAnimationFrame(drift);
}

function setDrift(on) {
  const next = on && !still;
  if (next === drifting) return;
  drifting = next;
  if (drifting) requestAnimationFrame(drift);
}

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

function redraw() {
  if (drifting) return;
  if (!queued) {
    queued = true;
    requestAnimationFrame(draw);
  }
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

if (gate && canvas) {
  gate.addEventListener('pointermove', (event) => {
    const r = gate.getBoundingClientRect();
    mx = event.clientX - r.left;
    my = event.clientY - r.top;
    gate.style.setProperty('--mx', `${mx}px`);
    gate.style.setProperty('--my', `${my}px`);
    if (!still) redraw();
    const box = event.target.closest?.('.bento-box');
    if (box) {
      const q = box.getBoundingClientRect();
      const px = (event.clientX - q.left) / q.width;
      const py = (event.clientY - q.top) / q.height;
      box.style.setProperty('--bx', `${px * 100}%`);
      box.style.setProperty('--by', `${py * 100}%`);
      box.style.setProperty('--ry', `${(px - 0.5) * 10}deg`);
      box.style.setProperty('--rx', `${(0.5 - py) * 10}deg`);
    }
  });
  const syncDrift = () => setDrift(!gate.hidden && !document.hidden && onScreen);
  let onScreen = true;
  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    syncDrift();
  }).observe(gate);
  document.addEventListener('visibilitychange', syncDrift);
  new MutationObserver(syncDrift).observe(gate, { attributes: true, attributeFilter: ['hidden'] });
  gate.addEventListener('pointerleave', () => {
    mx = my = -1e4;
    redraw();
  });
  addEventListener('resize', redraw);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
  new MutationObserver(redraw).observe(gate, { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  redraw();
  fillCounts();
}
