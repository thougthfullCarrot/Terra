// landing-field.js — the landing page's light field, from the Horizon
// concept: the outline of Texas, slowly turning, with a column of light for
// every open role, standing in the city it is in.
//
// Only public data: the per-city role counts the sign-in page already shows
// (stats.json, through live.js cityTotals). Development filings stay behind
// sign-in, so they are not drawn here. Every column in a city's bundle is
// the same height; a bundle's height and density both follow how many roles
// that city has, so nothing reads as a figure it isn't.
import { OUTLINE, TEXAS_PLACES, cityTotals } from './live.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function startLandingField() {
  const gate = document.getElementById('gate');
  const canvas = document.getElementById('gate-field');
  const caption = document.getElementById('gate-field-cap');
  if (!gate || !canvas) return;
  const ctx = canvas.getContext('2d');
  let w = 0;
  let h = 0;
  let theta = -0.5;
  let running = false;
  let seen = true;
  let cols = [];
  let labels = [];
  let maxH = 1;

  const lons = OUTLINE.map((p) => p[0]);
  const lats = OUTLINE.map((p) => p[1]);
  const cLon = (Math.min(...lons) + Math.max(...lons)) / 2;
  const cLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kLat = Math.cos((cLat * Math.PI) / 180);
  const toPlane = ([lon, lat]) => [(lon - cLon) * kLat, -(lat - cLat)];
  const ground = OUTLINE.map(toPlane);

  const size = () => {
    const r = Math.min(devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * r);
    canvas.height = Math.round(h * r);
    ctx.setTransform(r, 0, 0, r, 0, 0);
  };

  const draw = () => {
    ctx.clearRect(0, 0, w, h);
    if (!w || !h) return;
    const phone = w < 760;
    // Texas spans about 11.6 squeezed degrees. It sits inside the page's
    // 1240px column, to the right of the copy, so a wide window doesn't
    // blow it up across the headline; on a phone it fills the top.
    const col = Math.min(w, 1240);
    const left = (w - col) / 2;
    const scale = Math.min(phone ? w * 0.9 : col * 0.36, h * 0.9) / 11.6;
    const cx = phone ? w * 0.5 : left + col * 0.8;
    const cy = phone ? h * 0.24 : h * 0.56;
    const tall = h * (phone ? 0.15 : 0.3);
    const tilt = 0.46;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const P = ([x, y], z = 0) => {
      const rx = x * cos - y * sin;
      const ry = x * sin + y * cos;
      const depth = 1 + (ry * tilt) / 16;
      return [cx + (rx * scale) / depth, cy + (ry * tilt * scale) / depth - (z * tall) / depth, ry];
    };
    ctx.beginPath();
    ground.forEach((g, i) => {
      const [x, y] = P(g);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(240,240,250,0.025)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(240,240,250,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.globalCompositeOperation = 'lighter';
    const drawn = cols.map((c) => ({ c, b: P(c.at), t: P(c.at, c.h / maxH) })).sort((a, b) => a.b[2] - b.b[2]);
    for (const { b } of drawn) {
      ctx.fillStyle = 'rgba(240,240,250,0.10)';
      ctx.beginPath();
      ctx.arc(b[0], b[1], 2, 0, 7);
      ctx.fill();
    }
    for (const { c, b, t } of drawn) {
      const g = ctx.createLinearGradient(b[0], b[1], t[0], t[1]);
      g.addColorStop(0, 'rgba(240,240,250,0)');
      g.addColorStop(1, c.lead ? 'rgba(240,240,250,0.9)' : 'rgba(240,240,250,0.55)');
      ctx.strokeStyle = g;
      ctx.lineWidth = c.lead ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(b[0], b[1]);
      ctx.lineTo(t[0], t[1]);
      ctx.stroke();
      if (c.lead) {
        ctx.fillStyle = 'rgba(240,240,250,0.9)';
        ctx.fillRect(t[0] - 1.5, t[1] - 1.5, 3, 3);
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    // City names under the biggest bundles, as on the Horizon concept.
    if (!phone) {
      ctx.font = '600 10px Archivo, "Arial Narrow", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(240,240,250,0.6)';
      const placed = [];
      for (const { name, at } of labels) {
        const [x, y] = P(at);
        if (placed.some(([a, b]) => Math.hypot(a - x, b - y) < 70)) continue;
        placed.push([x, y]);
        ctx.fillText(name.toUpperCase().split('').join('\u200A'), x, y + 18);
      }
    }
  };

  // Turn by time, not by frame, so a 120 or 144 Hz screen doesn't spin it
  // faster: about one full turn every five minutes.
  let last = 0;
  const loop = (now) => {
    if (!running) return;
    if (last) theta += Math.min(now - last, 100) * 0.000021;
    last = now;
    draw();
    requestAnimationFrame(loop);
  };
  const run = () => {
    const want = seen && !document.hidden && !gate.hidden && !reduced();
    if (want && !running) {
      running = true;
      last = 0;
      requestAnimationFrame(loop);
    } else if (!want) running = false;
  };

  const load = async () => {
    const totals = await cityTotals();
    if (!totals) return;
    // One column per open role, fanned around its city on a small spiral so a
    // bundle reads as a bundle; the busiest city's columns get a bright tip.
    const ranked = [...totals].sort((a, b) => b[1] - a[1]);
    const top = ranked[0]?.[1] ?? 1;
    cols = [];
    for (const [name, n] of ranked) {
      const at = TEXAS_PLACES[name];
      if (!at) continue;
      const base = toPlane(at);
      const height = 0.25 + Math.sqrt(n / top);
      for (let i = 0; i < n; i++) {
        const a = i * 2.399963; // golden angle
        const rr = 0.045 * Math.sqrt(i);
        cols.push({ at: [base[0] + Math.cos(a) * rr, base[1] + Math.sin(a) * rr], h: height, lead: n === top && i < 3 });
      }
    }
    maxH = Math.max(...cols.map((c) => c.h), 1);
    labels = ranked.slice(0, 5).filter(([name]) => TEXAS_PLACES[name]).map(([name]) => ({ name, at: toPlane(TEXAS_PLACES[name]) }));
    const roles = ranked.reduce((s, [, n]) => s + n, 0);
    if (caption) {
      caption.textContent = `Each column of light is an open role, standing in its city: ${roles.toLocaleString('en-US')} roles in ${ranked.length} ${ranked.length === 1 ? 'city' : 'cities'}. ${ranked[0][0]} leads with ${ranked[0][1]}.`;
      caption.hidden = false;
    }
    draw();
  };

  new ResizeObserver(() => {
    size();
    draw();
  }).observe(canvas);
  new IntersectionObserver(([e]) => {
    seen = e.isIntersecting;
    run();
  }).observe(canvas);
  document.addEventListener('visibilitychange', run);
  new MutationObserver(() => {
    run();
    if (!gate.hidden && !cols.length) load();
  }).observe(gate, { attributes: true, attributeFilter: ['hidden'] });
  load();
  run();
}
