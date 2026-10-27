// Development map filter timing, for comparing two builds of the site on the
// same data. Measures exactly what devmap-check's "filter change paints within
// 150 ms" step measures (six Estimated cost changes, each timed to the next
// animation frame) on the metro with the most projects, repeated in fresh
// pages so one slow sample can't decide the result.
//
//   node test/browser/devmap-timing.mjs <label> <site dir> [rounds per viewport]
//
// Prints one JSON line per viewport: every round's worst and mean, and the
// median and spread of all samples. Read-only; no network besides the local server.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const label = process.argv[2] ?? 'site';
const siteDir = resolve(process.argv[3] ?? '../site');
const rounds = Number(process.argv[4] ?? 8);
const market = JSON.parse(await readFile(join(siteDir, 'market.json'), 'utf8'));
const data = market.developments;
for (const [city, path] of Object.entries(data.files ?? {})) {
  const file = JSON.parse(await readFile(join(siteDir, path), 'utf8'));
  data.projects = [...data.projects.filter((p) => p.city !== city), ...file.projects];
}
const byCity = new Map();
for (const p of data.projects) byCity.set(p.city, (byCity.get(p.city) ?? 0) + 1);
const [city, count] = [...byCity].sort((a, b) => b[1] - a[1])[0];

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.mjs': 'text/javascript' };
const server = createServer(async (req, res) => {
  const raw = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const path = raw.endsWith('/') ? `${raw}index.html` : raw;
  try {
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(await readFile(join(siteDir, path)));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
for (const vp of [
  { name: 'desktop', width: 1366, height: 1000 },
  { name: 'phone', width: 390, height: 844, mobile: true }
]) {
  const worst = [];
  const means = [];
  const samples = [];
  for (let round = 0; round < rounds; round++) {
    // The same browser settings as devmap-check.
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await page.goto(`${base}#markets&tool=map&city=${encodeURIComponent(city)}`);
    await page.waitForSelector('.dev-map.leaflet-container', { timeout: 30000 });
    await page.waitForFunction((n) => document.querySelectorAll('.dev-list .dev-item').length === n, count, { timeout: 30000 });
    await page.waitForTimeout(400);
    const runs = await page.evaluate(async () => {
      const select = document.querySelector('.devx-filters select[aria-label="Estimated cost"]');
      const out = [];
      for (const value of ['under5', '', 'over100', '', '5to25', '']) {
        const t = performance.now();
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(requestAnimationFrame);
        out.push(performance.now() - t);
      }
      return out;
    });
    worst.push(Math.round(Math.max(...runs)));
    means.push(Math.round(runs.reduce((a, b) => a + b, 0) / runs.length));
    samples.push(...runs.map(Math.round));
    await ctx.close();
  }
  console.log(
    JSON.stringify({
      label,
      viewport: vp.name,
      city,
      projects: count,
      rounds,
      worstPerRound: worst,
      meanPerRound: means,
      roundWorst: { median: quantile(worst, 0.5), min: Math.min(...worst), max: Math.max(...worst), over150: worst.filter((w) => w >= 150).length },
      allChanges: { median: quantile(samples, 0.5), p90: quantile(samples, 0.9), max: Math.max(...samples), n: samples.length }
    })
  );
}
await browser.close();
server.close();
