// Signed-out landing (Terrain): contour lines that rise toward the cursor, a
// soft accent light that follows it, and the live counts from stats.json.
const gate = document.getElementById('gate');
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
let t = 0;

// One contour layer per canvas: the landing band, and the band behind the top
// of each signed-in page. Each rises toward the cursor and drifts slowly.
function terrain(canvas, host) {
  const layer = { canvas, host, mx: -1e4, my: -1e4, onScreen: true };
  layer.height = (x, y) => {
    let v = Math.sin(x * 0.006 + t * 0.3) * 1.2 + Math.cos(y * 0.008 + x * 0.002 - t * 0.2) * 1.1 + Math.sin((x + y) * 0.004 + t * 0.15) * 0.9 + Math.cos(x * 0.011 - y * 0.005) * 0.5;
    if (!still) {
      const dx = x - layer.mx;
      const dy = y - layer.my;
      v += 1.6 * Math.exp(-(dx * dx + dy * dy) / 18000);
    }
    return v;
  };
  new IntersectionObserver(([entry]) => {
    layer.onScreen = entry.isIntersecting;
    syncDrift();
  }).observe(canvas);
  return layer;
}

const layers = [];
const visible = (layer) => layer.canvas.offsetParent !== null && layer.onScreen;

function paint(layer) {
  const { canvas } = layer;
  const r = canvas.getBoundingClientRect();
  if (!r.width || !visible(layer)) return;
  const d = devicePixelRatio || 1;
  if (canvas.width !== Math.round(r.width * d) || canvas.height !== Math.round(r.height * d)) {
    canvas.width = Math.round(r.width * d);
    canvas.height = Math.round(r.height * d);
  }
  const g = canvas.getContext('2d');
  g.setTransform(d, 0, 0, d, 0, 0);
  g.clearRect(0, 0, r.width, r.height);
  const css = getComputedStyle(canvas);
  const major = css.getPropertyValue('--terrain-major').trim();
  const minor = css.getPropertyValue('--terrain-minor').trim();
  const s = 8;
  const cols = Math.ceil(r.width / s) + 1;
  const rows = Math.ceil(r.height / s) + 1;
  const v = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) v[j * cols + i] = layer.height(i * s, j * s);
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

let queued = false;
function draw() {
  queued = false;
  layers.forEach(paint);
}

let drifting = false;
function drift() {
  if (!drifting) return;
  t += 0.012;
  draw();
  requestAnimationFrame(drift);
}

function syncDrift() {
  const next = !still && !document.hidden && layers.some(visible);
  if (next === drifting) return;
  drifting = next;
  if (drifting) requestAnimationFrame(drift);
}

function redraw() {
  if (drifting || queued) return;
  queued = true;
  requestAnimationFrame(draw);
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

// Cards and count boxes light up where the cursor is and lean toward it.
function lean(event) {
  const box = event.target.closest?.('.bento-box, .list > .card');
  if (!box) return;
  const q = box.getBoundingClientRect();
  const px = (event.clientX - q.left) / q.width;
  const py = (event.clientY - q.top) / q.height;
  box.style.setProperty('--bx', `${px * 100}%`);
  box.style.setProperty('--by', `${py * 100}%`);
  box.style.setProperty('--ry', `${(px - 0.5) * 6}deg`);
  box.style.setProperty('--rx', `${(0.5 - py) * 6}deg`);
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

for (const [canvasId, hostId] of [['terrain-topo', 'gate'], ['app-topo', 'main']]) {
  const c = document.getElementById(canvasId);
  const host = document.getElementById(hostId);
  if (!c || !host) continue;
  const layer = terrain(c, host);
  layers.push(layer);
  host.addEventListener('pointermove', (event) => {
    const r = c.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    layer.mx = event.clientX - r.left;
    layer.my = event.clientY - r.top;
    host.style.setProperty('--mx', `${event.clientX - h.left}px`);
    host.style.setProperty('--my', `${event.clientY - h.top}px`);
    if (!still) redraw();
    lean(event);
  });
  host.addEventListener('pointerleave', () => {
    layer.mx = layer.my = -1e4;
    redraw();
  });
}

const refresh = () => {
  redraw();
  syncDrift();
};
addEventListener('resize', refresh);
addEventListener('themechange', refresh);
document.addEventListener('visibilitychange', syncDrift);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refresh);
if (gate) new MutationObserver(refresh).observe(gate, { attributes: true, attributeFilter: ['hidden'] });
new MutationObserver(refresh).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
refresh();
if (gate) fillCounts();
