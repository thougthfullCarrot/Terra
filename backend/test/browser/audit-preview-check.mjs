// The development audit's preview site, checked in a real browser.
//
//   node test/browser/audit-preview-check.mjs [site dir] [screenshot dir]
//
// The site folder's market.json must be the audit preview (every eligible
// development, no cost cap). For The Merc's two TABS filings and PDL Club it
// searches by name, id and street address, opens each result, and checks the
// details and that the pin is drawn. It checks that ZIP-center pins say they
// are approximate, that projects without coordinates stay searchable and open
// their details in the list, and times each market's map with the bigger data.
// Read-only: a local server, no sign-in, outside requests blocked.
import { createServer } from 'node:http';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const siteDir = resolve(process.argv[2] ?? '../site');
const shots = process.argv[3] ? resolve(process.argv[3]) : null;
// Optional: today's market.json, timed under the same slow phone conditions for comparison.
const baseline = process.argv[4] ? resolve(process.argv[4]) : null;
const file = join(siteDir, 'market.json');
const market = JSON.parse(await readFile(file, 'utf8'));
const projects = market.developments?.projects ?? [];
const TARGETS = ['TABS2025017471', 'TABS2025017477', 'TABS2026006871'];

const results = [];
const log = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const byCity = new Map();
for (const p of projects) byCity.set(p.city, [...(byCity.get(p.city) ?? []), p]);
console.log(`market.json: ${((await stat(file)).size / 1e6).toFixed(1)} MB, ${projects.length} developments`);
for (const [city, rows] of byCity) {
  const pins = rows.filter((p) => p.lat != null).length;
  console.log(`  ${city}: ${rows.length} listed, ${pins} with a pin (${rows.filter((p) => p.approximate).length} approximate), ${rows.length - pins} without`);
}
log('coordinates come in pairs', projects.every((p) => (p.lat == null) === (p.lng == null)));
log('only ZIP-center points are marked approximate, and each has a point', projects.filter((p) => p.approximate).every((p) => p.lat != null && !p.locatedFrom));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.mjs': 'text/javascript' };
// Gzipped like GitHub Pages serves text, so transfer sizes and timings are realistic.
const zipped = new Map();
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const raw = decodeURIComponent(url.pathname);
  const path = raw.endsWith('/') ? `${raw}index.html` : raw;
  try {
    const source = path === '/market.json' && url.searchParams.has('baseline') && baseline ? baseline : join(siteDir, path);
    let body = await readFile(source);
    const headers = { 'content-type': types[extname(path)] ?? 'application/octet-stream' };
    if (/gzip/.test(req.headers['accept-encoding'] ?? '') && /\.(json|js|css|html|mjs|svg)$/.test(path)) {
      body = zipped.get(source) ?? zipped.set(source, gzipSync(body)).get(source);
      headers['content-encoding'] = 'gzip';
    }
    res.writeHead(200, headers).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
if (shots) await mkdir(shots, { recursive: true });

async function open(ctx, city) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const t0 = Date.now();
  await page.goto(`${base}#markets&city=${encodeURIComponent(city)}`);
  await page.waitForSelector('.dev-map.leaflet-container', { timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('.dev-map')?.dataset.pins != null, null, { timeout: 60000 });
  return { page, errors, ms: Date.now() - t0 };
}

async function search(page, query) {
  const t0 = Date.now();
  await page.locator('.dev-search input').fill(query);
  await page.waitForFunction((q) => document.querySelector('.dev-search input')?.value === q, query);
  await page.waitForTimeout(250);
  return Date.now() - t0;
}

const visibleNames = (page) => page.$$eval('.dev-list .dev-item:not([hidden]) .dev-name', (ns) => ns.map((n) => n.textContent));

/** Click a list result; returns the details text and whether its pin's popup opened. */
async function pick(page, name) {
  const item = page.locator('.dev-list .dev-item:not([hidden])').filter({ has: page.locator('.dev-name', { hasText: name }) }).first();
  await item.locator('.dev-pick').click();
  try {
    await page.waitForFunction((n) => [...document.querySelectorAll('.leaflet-popup .dev-pop-title')].some((t) => t.textContent === n), name, { timeout: 8000 });
    return { text: await page.locator('.leaflet-popup .dev-pop').first().innerText(), popup: true };
  } catch {
    const detail = item.locator('.dev-detail');
    return { text: (await detail.count()) ? await detail.innerText() : '', popup: false };
  }
}

for (const vp of [
  { name: 'desktop', width: 1366, height: 1000 },
  { name: 'phone', width: 390, height: 844, mobile: true }
]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile });
  const v = vp.name;
  const { page, errors, ms } = await open(ctx, 'San Antonio');
  console.log(`\n[${v}] San Antonio map ready in ${ms} ms`);
  if (vp.mobile) {
    const body = page.locator('.dev-filters-body');
    if (!(await body.isVisible())) await page.locator('.dev-filters-summary').click();
  }
  for (const id of TARGETS) {
    const p = projects.find((x) => x.id === id);
    log(`${v}: ${id} is in the preview data`, Boolean(p));
    if (!p) continue;
    const street = (p.address ?? '').split(',')[0].trim();
    for (const [kind, query] of [['name', p.name], ['id', id], ['address', street]]) {
      if (!query) {
        log(`${v}: ${id} ${kind} search`, false, 'no value to search');
        continue;
      }
      await search(page, query);
      const names = await visibleNames(page);
      log(`${v}: ${kind} search "${query}" lists ${p.name}`, names.includes(p.name), `${names.length} listed`);
    }
    await search(page, id);
    const got = await pick(page, p.name);
    log(`${v}: ${id} opens its pin with details`, got.popup && p.lat != null, got.popup ? 'popup on the map' : 'no popup');
    log(`${v}: ${id} details show the address`, Boolean(p.address) && got.text.includes(p.address));
    const label = p.approximate ? /ZIP code center/ : p.locatedFrom ? /site's location from a city permit/ : null;
    if (label) log(`${v}: ${id} details label where the pin came from`, label.test(got.text), got.text.split('\n').find((l) => /Pin is/.test(l)) ?? '');
    const pins = Number(await page.locator('.dev-map').getAttribute('data-pins'));
    log(`${v}: ${id} pin is drawn when it is the only result`, pins === 1, `${pins} pins`);
    if (shots) await page.screenshot({ path: join(shots, `${v}-${id}.png`) });
    await page.keyboard.press('Escape');
  }

  // A ZIP-center project: dashed pin and a popup that says approximate.
  const approx = (byCity.get('San Antonio') ?? []).find((p) => p.approximate);
  if (approx) {
    await search(page, approx.id);
    const got = await pick(page, approx.name);
    log(`${v}: approximate pin (${approx.id}) says it is near the ZIP code center`, got.popup && /ZIP code center/.test(got.text));
    const dashed = await page.$$eval('.dev-map path.leaflet-interactive', (ps) => ps.filter((x) => x.getAttribute('stroke-dasharray')).length);
    log(`${v}: approximate pin is drawn dashed`, dashed >= 1, `${dashed} dashed`);
  }
  // A project without coordinates: still found, marked, details in the list.
  const off = (byCity.get('San Antonio') ?? []).find((p) => p.lat == null) ?? projects.find((p) => p.lat == null);
  if (off) {
    if (off.city !== 'San Antonio') await page.goto(`${base}#markets&city=${encodeURIComponent(off.city)}`), await page.waitForSelector('.dev-map.leaflet-container');
    await search(page, off.id);
    const names = await visibleNames(page);
    log(`${v}: no-coordinate project ${off.id} (${off.city}) is searchable`, names.includes(off.name));
    const marked = await page.locator('.dev-list .dev-item:not([hidden]) .dev-off').count();
    log(`${v}: it is marked "Not on the map"`, marked >= 1);
    const got = await pick(page, off.name);
    log(`${v}: it opens its details in the list`, !got.popup && got.text.includes(off.name));
  }
  log(`${v}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.close();

  // Performance with every eligible development, per market.
  if (!vp.mobile) {
    console.log('\nPerformance (desktop):');
    console.log('| Market | Listed | Pins | Map ready (ms) | Search keystroke (ms) | JS heap (MB) |');
    console.log('|---|---:|---:|---:|---:|---:|');
    for (const [city, rows] of [...byCity].sort((a, b) => b[1].length - a[1].length)) {
      const o = await open(ctx, city);
      const typed = (await search(o.page, "build")) - 250;
      await search(o.page, '');
      const heap = await o.page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize / 1e6 : null));
      console.log(`| ${city} | ${rows.length} | ${rows.filter((p) => p.lat != null).length} | ${o.ms} | ${typed} | ${heap == null ? '?' : heap.toFixed(0)} |`);
      log(`${city}: map ready within 15 s with ${rows.length} developments`, o.ms < 15000, `${o.ms} ms`);
      log(`${city}: no page errors`, o.errors.length === 0, o.errors.slice(0, 2).join(' | '));
      await o.page.close();
    }
  }
  await ctx.close();
}
// A mid-range phone on a slow connection: Lighthouse's "Slow 4G" (150 ms, 1.6 Mbps down) and a 4x slower CPU.
async function slowPhone(city, useBaseline) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  if (useBaseline) await page.route(/\/market\.json(\?|$)/, (r) => r.continue({ url: `${base}market.json?baseline=1` }));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6e6 / 8) * 0.9, uploadThroughput: (750e3 / 8) * 0.9 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  let bytes = 0;
  cdp.on('Network.loadingFinished', (e) => (bytes += e.encodedDataLength));
  const t0 = Date.now();
  await page.goto(`${base}#markets&city=${encodeURIComponent(city)}`);
  await page.waitForSelector('.dev-list .dev-item', { timeout: 180000 });
  const list = Date.now() - t0;
  await page.waitForFunction(() => document.querySelector('.dev-map')?.dataset.pins != null, null, { timeout: 180000 });
  const map = Date.now() - t0;
  if (!(await page.locator('.dev-filters-body').isVisible())) await page.locator('.dev-filters-summary').click();
  const typed = (await search(page, 'build')) - 250;
  await ctx.close();
  return { list, map, typed, mb: bytes / 1e6 };
}
console.log('\nSlow phone (Slow 4G 1.6 Mbps / 150 ms, CPU 4x slower), gzip as GitHub Pages serves it:');
console.log('| Market | Data | Downloaded | List shown | Map ready | Search keystroke |');
console.log('|---|---|---:|---:|---:|---:|');
for (const city of ['San Antonio', 'Houston']) {
  for (const useBaseline of baseline ? [true, false] : [false]) {
    const r = await slowPhone(city, useBaseline);
    console.log(`| ${city} | ${useBaseline ? "today's market.json" : 'audit preview'} | ${r.mb.toFixed(1)} MB | ${(r.list / 1000).toFixed(1)} s | ${(r.map / 1000).toFixed(1)} s | ${r.typed} ms |`);
    if (!useBaseline) log(`slow phone: ${city} map ready within 30 s`, r.map < 30000, `${(r.map / 1000).toFixed(1)} s`);
  }
}
await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
