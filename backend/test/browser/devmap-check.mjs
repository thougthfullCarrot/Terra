// Development map filter check against a real built site/market.json.
//
//   node test/browser/devmap-check.mjs [site dir] [screenshot dir]
//
// Serves the site folder, opens the market section in Chromium (desktop and
// phone), and for the metro with the most projects checks every filter on its
// own and in combination, search, pin and list clicks, Clear filters, keyboard
// focus and the folded phone panel. Each filter's expected result is computed
// here, independently of site/market.js, and compared with the count shown,
// the list items visible and the pins Leaflet actually drew. It also audits
// the data the menus are built from. Read-only: no sign-in, no network
// besides the local server (map tiles and fonts are blocked).
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';

const siteDir = resolve(process.argv[2] ?? '../site');
const shots = process.argv[3] ? resolve(process.argv[3]) : null;
const market = JSON.parse(await readFile(join(siteDir, 'market.json'), 'utf8'));
const data = market.developments;
if (!data?.projects?.length) {
  console.log('FAIL  market.json has no development projects');
  process.exit(1);
}
// Each market's full list is its own file (developments/<market>.json), which
// the map downloads when the market opens; check against what it will show.
const headlineCount = data.projects.length;
for (const [city, path] of Object.entries(data.files ?? {})) {
  const file = JSON.parse(await readFile(join(siteDir, path), 'utf8'));
  data.projects = [...data.projects.filter((p) => p.city !== city), ...file.projects];
}
console.log(`market.json: ${headlineCount} headline projects; ${Object.keys(data.files ?? {}).length} market files, ${data.projects.length} projects in all`);
/** Waits until the map has swapped in the market's full file. */
const waitFull = async (page, city) => {
  const want = data.projects.filter((p) => p.city === city).length;
  const ok = await page
    .waitForFunction((n) => document.querySelectorAll('.dev-list .dev-item').length === n, want, { timeout: 30000 })
    .then(() => true, () => false);
  if (!ok) log(`${city}: the map loads the market's full file`, false, `${await page.locator('.dev-list .dev-item').count()} listed, file has ${want}; title "${await page.locator('#dev-title').textContent().catch(() => '')}"`);
};

const results = [];
const log = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const iso = /^\d{4}-\d{2}-\d{2}$/;

// ---- Data audit: what the menus will be built from.
const byCity = new Map();
for (const p of data.projects) byCity.set(p.city, [...(byCity.get(p.city) ?? []), p]);
console.log(`\nData: ${data.projects.length} projects, as of ${data.asOf}`);
for (const [city, rows] of [...byCity].sort((a, b) => b[1].length - a[1].length)) {
  const noPin = rows.filter((p) => p.lat == null || p.lng == null).length;
  console.log(`  ${city}: ${rows.length} projects, ${rows.length - noPin} with coordinates, ${rows.filter((p) => p.source === 'city').length} city permits`);
}
const tally = (key) => [...data.projects.reduce((m, p) => m.set(p[key], (m.get(p[key]) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);
console.log('  Statuses:', JSON.stringify(tally('status')));
console.log('  Work:', JSON.stringify(tally('work')));
console.log('  Public involvement:', JSON.stringify(tally('isPublic')));
const costs = data.projects.map((p) => p.cost).sort((a, b) => a - b);
console.log(`  Cost: min ${costs[0]}, median ${costs[costs.length >> 1]}, max ${costs.at(-1)}`);
const regs = data.projects.map((p) => p.registered).filter(Boolean).sort();
console.log(`  Filed: ${regs[0]} to ${regs.at(-1)}`);
const unknown = data.projects.filter((p) => p.status === 'Unknown status' || p.status === 'Registered' && p.statusCode != null && ![3005, 3008].includes(p.statusCode));
console.log(`  Unknown TABS status codes: ${unknown.length}${unknown.length ? ` ${JSON.stringify([...new Set(unknown.map((p) => p.statusCode))])}` : ''}`);
log('every project has a city, name and id', data.projects.every((p) => p.city && p.name && p.id));
log('every cost is a positive number', data.projects.every((p) => Number.isFinite(p.cost) && p.cost > 0), `${data.projects.filter((p) => !(p.cost > 0)).length} without`);
log('every type of work is New construction or Addition', data.projects.every((p) => ['New construction', 'Addition'].includes(p.work)));
log('filing dates are YYYY-MM-DD or blank', data.projects.every((p) => !p.registered || iso.test(p.registered)), `${data.projects.filter((p) => !p.registered).length} blank`);
log('coordinates come in pairs', data.projects.every((p) => (p.lat == null) === (p.lng == null)));
// Not a failure: the map keys pins by project, not id. Reported because Follow uses the id.
const seen = new Map();
for (const p of data.projects) seen.set(`${p.city}|${p.id}`, [...(seen.get(`${p.city}|${p.id}`) ?? []), p]);
const dups = [...seen.values()].filter((g) => g.length > 1);
console.log(`  Repeated ids within a metro: ${dups.length} ids, ${dups.reduce((n, g) => n + g.length, 0)} projects`);
for (const g of dups.slice(0, 8)) console.log(`    ${g[0].city} ${g[0].id}: ${g.map((p) => `"${p.name}" ${p.address ?? ''} $${p.cost}`).join(' | ')}`);

// ---- Independent expectation (deliberately not importing site/market.js).
const asOf = Date.parse(data.asOf);
const bands = { under5: [0, 5e6], '5to25': [5e6, 25e6], '25to100': [25e6, 1e8], over100: [1e8, Infinity] };
const days = { 30: 30, 90: 90, 180: 182, 365: 365 };
const squash = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function expected(city, f) {
  return (byCity.get(city) ?? []).filter((p) => {
    if (f.query) {
      const hay = squash([p.name, p.facility, p.id, p.address, ...(p.addresses ?? []), p.place, p.owner, ...(p.aliases ?? [])].filter(Boolean).join(' '));
      const all = `${hay} ${hay.replace(/ /g, '')}`;
      if (!squash(f.query).split(' ').filter(Boolean).every((w) => all.includes(w))) return false;
    }
    if (f.place && p.place !== f.place) return false;
    if (f.work && p.work !== f.work) return false;
    if (f.publicInvolvement && (f.publicInvolvement === 'public') !== Boolean(p.isPublic)) return false;
    if (f.cost) {
      const [lo, hi] = bands[f.cost];
      if (!(p.cost > 0 && p.cost >= lo && p.cost < hi)) return false;
    }
    if (f.status && p.status !== f.status) return false;
    if (f.filed && !(p.registered && p.registered >= new Date(asOf - days[f.filed] * 864e5).toISOString().slice(0, 10))) return false;
    // A month picked on the filings chart: filed in that month or later.
    if (f.since && !(p.registered && p.registered.slice(0, 7) >= f.since)) return false;
    return true;
  });
}
const pinsOf = (rows) => rows.filter((p) => p.lat != null && p.lng != null).length;

// ---- Local server.
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.mjs': 'text/javascript' };
const server = createServer(async (req, res) => {
  const raw = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const path = raw.endsWith('/') ? `${raw}index.html` : raw;
  try {
    let body = await readFile(join(siteDir, path));
    const headers = { 'content-type': types[extname(path)] ?? 'application/octet-stream' };
    // Compressed as GitHub Pages serves it, for the slow-phone timing.
    if (/gzip/.test(req.headers['accept-encoding'] ?? '') && /\.(json|js|css|html|mjs|svg)$/.test(path)) {
      body = gzipSync(body);
      headers['content-encoding'] = 'gzip';
    }
    res.writeHead(200, headers).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const offCity = [...byCity].find(([, rows]) => rows.some((p) => p.lat == null))?.[0] ?? null;
const biggest = [...byCity].sort((a, b) => b[1].length - a[1].length)[0][0];
const LABELS = { place: 'City or town', work: 'Type of work', publicInvolvement: 'Public involvement', cost: 'Estimated cost', status: 'Filing status', filed: 'Filed' };

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
if (shots) await mkdir(shots, { recursive: true });
for (const vp of [
  { name: 'desktop', width: 1366, height: 1000 },
  { name: 'phone', width: 390, height: 844, mobile: true }
]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.log(`  ${vp.name} page error: ${e.stack ?? e.message}`);
  });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const city = biggest;
  await page.goto(`${base}#markets&tool=map&city=${encodeURIComponent(city)}`);
  const t0 = Date.now();
  await page.waitForSelector('.dev-map.leaflet-container', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('.dev-map')?.dataset.pins != null);
  await waitFull(page, city);
  const firstDraw = Date.now() - t0;
  const all = byCity.get(city);
  const v = vp.name;
  console.log(`\n[${v}] ${city}: ${all.length} projects, ${pinsOf(all)} with coordinates`);

  // The workspace: the map starts on screen under the header, with the market controls out of the way.
  const ws = await page.evaluate(() => {
    const map = document.querySelector('.devx-mapwrap').getBoundingClientRect();
    const head = document.querySelector('.appbar').getBoundingClientRect();
    const title = document.querySelector('#dev-title').getBoundingClientRect();
    const tabs = document.querySelector('nav.tabs');
    const fixedTabs = tabs && getComputedStyle(tabs).position === 'fixed' ? tabs.getBoundingClientRect().top : innerHeight;
    return { mapTop: map.top, mapBottom: map.bottom, title: title.top, head: head.bottom, controls: document.querySelector('#market-controls').offsetParent !== null, fixedTabs, vh: innerHeight };
  });
  log(`${v}: the map workspace starts under the header with the map on screen`, !ws.controls && ws.title >= ws.head && ws.mapTop < ws.vh * 0.4, JSON.stringify(ws));
  log(`${v}: the map ends above the bottom tabs, so its controls and attribution show`, ws.mapBottom <= ws.fixedTabs + 1, `map bottom ${Math.round(ws.mapBottom)}, tabs at ${Math.round(ws.fixedTabs)}`);

  // Cost, work and funding float over the map; town, status and filed sit under More, folded at first.
  const pillsShown = await page.locator('.devx-filters select[aria-label="Estimated cost"]').isVisible();
  log(`${v}: the main filters show over the map`, pillsShown);
  const moreOpen = await page.locator('.devx-more').evaluate((d) => d.open);
  const before = await page.locator('.devx-more-body').isVisible();
  await page.locator('.devx-more-summary').click();
  const after = await page.locator('.devx-more-body').isVisible();
  log(`${v}: More starts folded and opens on ${vp.mobile ? 'tap' : 'click'}`, !moreOpen && !before && after);
  // Every legend label and count fits inside the side column, with no clipping.
  const legendFit = await page.evaluate(() => {
    const side = document.querySelector('.devx-side').getBoundingClientRect();
    return [...document.querySelectorAll('.devx-legend li:not([hidden]) :is(.devx-legend-label, .devx-legend-count)')]
      .filter((n) => n.getBoundingClientRect().right > side.right - 4 || n.scrollWidth > n.clientWidth + 1)
      .map((n) => n.textContent);
  });
  log(`${v}: every legend label and count fits`, legendFit.length === 0, legendFit.join(', '));
  if (vp.mobile) {
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    log(`${v}: no sideways scrolling`, scrollW <= vp.width, `${scrollW}px`);
  }

  const state = () =>
    page.evaluate(() => ({
      count: Number(document.querySelector('.dev-count strong').textContent.replace(/,/g, '')),
      pinsText: Number(/(\d[\d,]*) pins?/.exec(document.querySelector('.dev-count').textContent)?.[1].replace(/,/g, '')),
      items: document.querySelectorAll('.dev-list .dev-item:not([hidden])').length,
      offMap: document.querySelectorAll('.dev-list .dev-item:not([hidden]) .dev-off').length,
      // Pins are category icons or counted clusters; the map reports how many projects they hold in all.
      markers: Number(document.querySelector('.dev-map').dataset.drawn ?? -1),
      empty: !document.querySelector('.dev-empty').hidden
    }));
  const setF = async (f) => {
    await page.locator('.dev-search input').fill(f.query ?? '');
    await page.locator('.devx-more').evaluate((d) => (d.open = true));
    for (const [k, label] of Object.entries(LABELS)) {
      const select = page.locator(`.devx-filters select[aria-label="${label}"]`);
      if (await select.count()) await select.selectOption(f[k] ?? '');
    }
    await page.waitForTimeout(200);
  };
  const check = async (label, f) => {
    await setF(f);
    const s = await state();
    const exp = expected(city, f);
    const pins = pinsOf(exp);
    const ok = s.count === exp.length && s.items === exp.length && s.markers === pins && s.pinsText === pins && s.offMap === exp.length - pins && s.empty === (exp.length === 0);
    log(`${v}: ${label}`, ok, `expect ${exp.length}/${pins} pins; shown ${s.count}, list ${s.items} (${s.offMap} off map), drawn ${s.markers}`);
  };

  await check('no filters: every project listed, every located one pinned', {});
  const menus = await page.$$eval('.devx-filters select', (ls) => ls.map((l) => [l.getAttribute('aria-label'), [...l.options].map((o) => [o.value, o.textContent]).filter(([x]) => x)]));
  for (const [label, options] of menus) {
    const key = Object.keys(LABELS).find((k) => LABELS[k] === label);
    if (key === 'place' || key === 'work' || key === 'status') {
      const counts = new Map();
      for (const p of all) if (p[key]) counts.set(p[key], (counts.get(p[key]) ?? 0) + 1);
      const shown = options.map(([value, text]) => `${value}|${text}`).sort();
      const want = [...counts].map(([value, n]) => `${value}|${value} (${n})`).sort();
      log(`${v}: ${label} menu lists exactly the values in the data, with counts`, JSON.stringify(shown) === JSON.stringify(want), `${options.length} options`);
    }
    for (const [value] of options) await check(`${label} = ${value}`, { [key]: value });
  }
  const sample = all.find((p) => p.source !== 'city' && p.address) ?? all[0];
  await check(`search by name "${sample.name.split(/\s+/).slice(0, 2).join(' ')}"`, { query: sample.name.split(/\s+/).slice(0, 2).join(' ') });
  await check(`search by project number ${sample.id}`, { query: sample.id });
  if (sample.address) await check('search by street address', { query: sample.address.split(',')[0] });
  const town = [...new Set(all.map((p) => p.place).filter(Boolean))][0];
  await check('combo: town + not public + $5M-$25M', { place: town, publicInvolvement: 'private', cost: '5to25' });
  await check('combo: new construction + last 12 months', { work: 'New construction', filed: '365' });
  await check('combo: public involvement + $100M and up + last 6 months', { publicInvolvement: 'public', cost: 'over100', filed: '180' });
  await check('combo: search + addition + under $5M', { query: 'school', work: 'Addition', cost: 'under5' });
  await check('combo: nothing matches, empty state shows', { query: 'zzqx no such project' });

  // Legend, chart and sort, on their own and with the menus. Categories come
  // from site/market.js's wording rules, so the check here is that the legend
  // is consistent with the list: its counts add up to what is shown, hiding a
  // category removes exactly its rows (and their pins), and nothing else moves.
  const legendState = () =>
    page.$$eval('.devx-legend-item', (bs) => bs.filter((b) => !b.closest('li').hidden).map((b) => ({ key: b.dataset.category, n: Number(b.querySelector('.devx-legend-count').textContent.replace(/,/g, '')), on: b.getAttribute('aria-pressed') === 'true' })));
  const rowsBy = () => page.$$eval('.dev-list .dev-item', (rs) => rs.map((r) => r.dataset.category));
  for (const [label, f] of [['legend alone', {}], ['legend + $5M-$25M + new construction', { cost: '5to25', work: 'New construction' }]]) {
    await setF(f);
    const exp = expected(city, f);
    const legend = await legendState();
    const sum = legend.reduce((a, c) => a + c.n, 0);
    log(`${v}: ${label}: legend counts add up to the ${exp.length} shown`, sum === exp.length && legend.every((c) => c.on), legend.map((c) => `${c.key} ${c.n}`).join(', '));
    const top = [...legend].sort((a, b) => b.n - a.n)[0];
    if (!top) continue;
    const pinsBefore = (await state()).markers;
    const offPins = await page.$$eval('.dev-list .dev-item', (rs, k) => rs.filter((r) => r.dataset.category === k && !r.querySelector('.dev-off')).length, top.key);
    await page.locator(`.devx-legend-item[data-category="${top.key}"]`).click();
    await page.waitForTimeout(200);
    const after = await state();
    const cats = await rowsBy();
    const pressed = await page.locator(`.devx-legend-item[data-category="${top.key}"]`).getAttribute('aria-pressed');
    log(`${v}: ${label}: hiding ${top.key} removes its ${top.n} rows and ${offPins} pins`, after.count === exp.length - top.n && after.items === exp.length - top.n && after.markers === pinsBefore - offPins && !cats.includes(top.key) && pressed === 'false', `shown ${after.count}, drawn ${after.markers}`);
    const legendHidden = (await legendState()).find((c) => c.key === top.key);
    log(`${v}: ${label}: a hidden category still shows its count`, legendHidden?.n === top.n);
    await page.locator(`.devx-legend-item[data-category="${top.key}"]`).click();
    await page.waitForTimeout(200);
    log(`${v}: ${label}: showing it again restores the list`, (await state()).count === exp.length);
  }
  // Filings chart: a bar's click keeps filings from that month on; a second click clears it.
  await setF({});
  const bars = await page.$$eval('.devx-bar-col', (bs) => bs.map((b) => b.dataset.month));
  const regsBy = (rows) => rows.reduce((m, p) => (p.registered ? m.set(p.registered.slice(0, 7), (m.get(p.registered.slice(0, 7)) ?? 0) + 1) : m), new Map());
  const barCounts = await page.$$eval('.devx-bar-col', (bs) => bs.map((b) => Number(/: ([\d,]+)/.exec(b.title)?.[1].replace(/,/g, ''))));
  const byMonth = regsBy(all);
  log(`${v}: chart bars match the filings per month`, bars.length > 0 && bars.every((m, i) => (byMonth.get(m) ?? 0) === barCounts[i]), `${bars.length} months`);
  const mid = bars[Math.floor(bars.length / 2)];
  for (const [label, f] of [['chart month alone', {}], ['chart month + public + $25M-$100M', { publicInvolvement: 'public', cost: '25to100' }]]) {
    await setF(f);
    await page.locator(`.devx-bar-col[data-month="${mid}"]`).click();
    await page.waitForTimeout(200);
    const exp = expected(city, { ...f, since: mid });
    const st = await state();
    log(`${v}: ${label} (${mid} on)`, st.count === exp.length && st.items === exp.length && st.markers === pinsOf(exp) && (await page.locator(`.devx-bar-col[data-month="${mid}"]`).getAttribute('aria-pressed')) === 'true', `expect ${exp.length}, shown ${st.count}`);
    await page.locator(`.devx-bar-col[data-month="${mid}"]`).click();
    await page.waitForTimeout(200);
    log(`${v}: ${label}: clicking the bar again clears it`, (await state()).count === expected(city, f).length);
  }
  // Sorting: the list order follows the chosen sort, filters included.
  await setF({ work: 'New construction' });
  const exp = expected(city, { work: 'New construction' });
  // Ids repeat now and then; only rows with a unique id are compared, each with the previous such row.
  const idCount = exp.reduce((m, p) => m.set(p.id, (m.get(p.id) ?? 0) + 1), new Map());
  const byId = new Map(exp.filter((p) => idCount.get(p.id) === 1).map((p) => [p.id, p]));
  for (const [key, ok] of [
    ['biggest', (a, b) => a.cost >= b.cost],
    ['newest', (a, b) => String(a.registered ?? '') >= String(b.registered ?? '')],
    ['finishing', (a, b) => (/^\d{4}-\d{2}/.test(a.end ?? '') ? a.end : '9999') <= (/^\d{4}-\d{2}/.test(b.end ?? '') ? b.end : '9999')]
  ]) {
    await page.locator(`.devx-seg-item[data-sort="${key}"]`).click();
    await page.waitForTimeout(250);
    const names = await page.$$eval('.dev-list .dev-item', (ns) => ns.slice(0, 300).map((n) => n.dataset.id));
    const rows = names.map((n) => byId.get(n)).filter(Boolean);
    const sorted = rows.length > names.length / 2 && rows.every((r, i) => i === 0 || ok(rows[i - 1], r));
    log(`${v}: sort ${key} orders the filtered list`, sorted && (await page.locator(`.devx-seg-item[data-sort="${key}"]`).getAttribute('aria-pressed')) === 'true' && (await state()).count === exp.length, `${rows.length} of ${names.length} rows with a unique id checked`);
  }
  await page.locator('.devx-seg-item[data-sort="biggest"]').click();
  if (shots) await page.locator('.dev-card').screenshot({ path: join(shots, `${v}-empty.png`) });

  // Search responsiveness: typing to updated count.
  await setF({});
  const typed = await page.evaluate(async (q) => {
    const input = document.querySelector('.dev-search input');
    const count = document.querySelector('.dev-count');
    const before = count.textContent;
    const t = performance.now();
    input.value = q;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => {
      const ob = new MutationObserver(() => {
        if (count.textContent !== before) (ob.disconnect(), r());
      });
      ob.observe(count, { childList: true, subtree: true, characterData: true });
      setTimeout(r, 3000);
    });
    return Math.round(performance.now() - t);
  }, sample.name.slice(0, 4));
  log(`${v}: search updates within 400 ms of typing (120 ms debounce)`, typed < 400, `${typed} ms`);

  // Filter performance on the largest metro: worst case, every pin toggled.
  await setF({});
  const timing = await page.evaluate(async () => {
    const select = document.querySelector('.devx-filters select[aria-label="Estimated cost"]');
    const runs = [];
    for (const value of ['under5', '', 'over100', '', '5to25', '']) {
      const t = performance.now();
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(requestAnimationFrame);
      runs.push(performance.now() - t);
    }
    return { worst: Math.round(Math.max(...runs)), mean: Math.round(runs.reduce((a, b) => a + b, 0) / runs.length) };
  });
  log(`${v}: filter change paints within 150 ms on ${all.length} projects`, timing.worst < 150, `mean ${timing.mean} ms, worst ${timing.worst} ms; first map draw ${firstDraw} ms`);

  // Pin click: popup and list highlight.
  await check('showcase: $25M-$100M', { cost: '25to100' });
  await page.locator('.dev-card').scrollIntoViewIfNeeded();
  // Click a pin that is actually on screen and on top: the first one in the
  // document can sit outside the phone's map view or under another pin.
  await page.locator('.dev-map').scrollIntoViewIfNeeded();
  // Nearby pins share a counted cluster until zoomed in, so click clusters until a project icon is on screen.
  const onTop = (selector) =>
    page.evaluate((selector) => {
      const box = document.querySelector('.dev-map').getBoundingClientRect();
      for (const node of document.querySelectorAll(`.dev-map .leaflet-marker-pane ${selector}`)) {
        const r = node.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        if (x > box.left + 24 && x < box.right - 24 && y > box.top + 24 && y < box.bottom - 24 && document.elementFromPoint(x, y)?.closest(selector) === node) return { x, y };
      }
      return null;
    }, selector);
  let spot = await onTop('.devx-pin-icon');
  for (let i = 0; !spot && i < 8; i++) {
    const cluster = await onTop('.devx-cluster-icon');
    if (!cluster) break;
    await page.mouse.click(cluster.x, cluster.y);
    await page.waitForTimeout(800);
    spot = await onTop('.devx-pin-icon');
  }
  log(`${v}: clicking clusters zooms in to individual category icons`, Boolean(spot));
  console.log(`  ${v}: clicking the pin at ${spot ? `${Math.round(spot.x)},${Math.round(spot.y)}` : 'none on screen; first in page'}`);
  if (spot) await page.mouse.click(spot.x, spot.y);
  else await page.locator('.dev-map .devx-pin-icon').first().click({ force: true });
  await page.waitForSelector('.devx-panel:not([hidden]) .dev-pop-title', { timeout: 5000 }).catch(() => null);
  const popTitle = await page.locator('.devx-panel:not([hidden]) .dev-pop-title').textContent().catch(() => null);
  const active = await page.locator('.dev-item.active .dev-name').textContent().catch(() => null);
  const popLinks = await page.locator('.devx-panel .dev-links a').count();
  log(`${v}: pin click opens the project panel and highlights it in the list`, Boolean(popTitle) && popTitle === active && popLinks === 2, `"${popTitle}"`);
  if (shots) await page.locator('.dev-card').screenshot({ path: join(shots, `${v}-filtered.png`) });
  // The panel must not cover the selected pin (desktop), and must sit inside the map.
  const layout = await page.evaluate(() => {
    const map = document.querySelector('.dev-map').getBoundingClientRect();
    const panel = document.querySelector('.devx-panel').getBoundingClientRect();
    return { inside: panel.left >= map.left - 1 && panel.right <= map.right + 1 && panel.top >= map.top - 1 && panel.bottom <= map.bottom + 1, w: panel.width, h: panel.height };
  });
  log(`${v}: the project panel sits inside the map`, layout.inside && layout.w > 200 && layout.h > 150, `${Math.round(layout.w)}x${Math.round(layout.h)}`);
  await page.locator('.devx-close').click();
  log(`${v}: the panel's close button closes it`, await page.locator('.devx-panel').isHidden());
  const target = page.locator('.dev-item:not([hidden]):not(:has(.dev-off)):not(.active)').nth(2);
  const pick = await target.locator('.dev-name').textContent();
  await target.locator('.dev-pick').click();
  await page.waitForFunction((t) => document.querySelector('.devx-panel:not([hidden]) .dev-pop-title')?.textContent === t, pick, { timeout: 5000 }).catch(() => null);
  log(`${v}: list click flies to the pin and opens its panel`, (await page.locator('.devx-panel:not([hidden]) .dev-pop-title').textContent().catch(() => null)) === pick, `"${pick}"`);
  // Next and previous walk the list in order; Escape closes and returns focus to the row.
  const listNames = await page.$$eval('.dev-list .dev-item .dev-name', (ns) => ns.map((n) => n.textContent));
  await page.locator('.devx-next').click();
  const nextTitle = await page.locator('.devx-panel .dev-pop-title').textContent();
  await page.locator('.devx-prev').click();
  const backTitle = await page.locator('.devx-panel .dev-pop-title').textContent();
  log(`${v}: next and previous step through the list`, nextTitle === listNames[listNames.indexOf(pick) + 1] && backTitle === pick, `"${nextTitle}"`);
  await page.keyboard.press('Escape');
  const escFocus = await page.evaluate(() => document.activeElement?.closest('.dev-item')?.querySelector('.dev-name')?.textContent);
  log(`${v}: Escape closes the panel and returns focus to its row`, (await page.locator('.devx-panel').isHidden()) && escFocus === pick, `focus on "${escFocus}"`);

  // Clear filters.
  await setF({ query: 'a', publicInvolvement: 'private', cost: 'over100', filed: '365' });
  await page.locator('.devx-legend-item:not([aria-pressed="false"])').first().click();
  if (mid) await page.locator(`.devx-bar-col[data-month="${mid}"]`).click();
  await page.locator('.devx-toggle').click();
  await page.waitForTimeout(150);
  await page.locator('.dev-clear').click();
  await page.waitForTimeout(150);
  const s = await state();
  const reset =
    (await page.$$eval('.devx-filters select', (ss) => ss.every((x) => x.value === ''))) &&
    (await page.locator('.dev-search input').inputValue()) === '' &&
    (await page.locator('.devx-legend-item[aria-pressed="false"]').count()) === 0 &&
    (await page.locator('.devx-bar-col[aria-pressed="true"]').count()) === 0 &&
    (await page.locator('.devx-toggle').getAttribute('aria-pressed')) === 'false';
  log(`${v}: Clear all resets search, menus, legend, chart month and the hiring toggle, restoring every project and pin`, reset && s.count === all.length && s.items === all.length && s.markers === pinsOf(all) && !(await page.locator('.dev-clear').isVisible()), `${s.count} projects, ${s.markers} pins`);

  // Keyboard: reach every control by Tab, each with a visible focus ring.
  if (!vp.mobile) {
    await setF({ cost: 'over100' });
    const walk = async (from, stop, max) => {
      await page.locator(from).first().focus();
      const order = [];
      for (let i = 0; i < max; i++) {
        const info = await page.evaluate(() => {
          const a = document.activeElement;
          const cs = getComputedStyle(a);
          const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
          return { tag: a.tagName, cls: String(a.className), label: a.getAttribute('aria-label') ?? a.textContent.trim().replace(/\s+/g, ' ').slice(0, 40), ring, visible: a.matches(':focus-visible') };
        });
        order.push(info);
        if (stop(info)) break;
        await page.keyboard.press('Tab');
      }
      return order;
    };
    // The list side: search, each legend category, each sort, then the first project.
    const legendN = await page.locator('.devx-legend li:not([hidden]) .devx-legend-item').count();
    const side = await walk('.dev-search input', (o) => o.cls.includes('dev-pick'), legendN + 6);
    const sideWant = ['Search projects by name, address, owner, project or permit number', ...Array(legendN).fill('devx-legend-item'), 'devx-seg-item', 'devx-seg-item', 'devx-seg-item', 'dev-pick'];
    log(`${v}: Tab goes search → ${legendN} legend categories → 3 sorts → first project`, sideWant.length === side.length && sideWant.every((w, i) => side[i].label === w || side[i].cls.includes(w)), side.map((o) => o.label).join(' → '));
    // The map side: every filter menu (More is open after setF), the hiring toggle and Clear all.
    const pills = await walk('.devx-filters select', (o) => o.cls.includes('dev-clear'), 14);
    const reached = pills.map((o) => o.label);
    const want = [...menus.slice(0, 3).map(([l]) => l), 'More', ...menus.slice(3).map(([l]) => l), 'Firms hiring now', 'Clear all'];
    log(`${v}: Tab reaches every filter menu, More, Firms hiring now and Clear all in order`, want.length === reached.length && want.every((w, i) => (reached[i] ?? '').startsWith(w)), reached.join(' → '));
    const noRing = [...side, ...pills].filter((o) => !o.ring || !o.visible);
    log(`${v}: every control shows a visible keyboard focus ring`, noRing.length === 0, noRing.map((o) => o.label).join(', '));
    await page.locator('.devx-more-summary').focus();
    await page.keyboard.press('Enter');
    const closed = !(await page.locator('.devx-more').evaluate((d) => d.open));
    await page.keyboard.press('Enter');
    log(`${v}: Enter folds and unfolds More`, closed && (await page.locator('.devx-more').evaluate((d) => d.open)));
    // A legend category and a chart bar work by keyboard too.
    await page.locator('.devx-legend-item').first().press('Enter');
    const legendKey = (await page.locator('.devx-legend-item').first().getAttribute('aria-pressed')) === 'false';
    await page.locator('.devx-bar-col').last().press('Enter');
    const barKey = (await page.locator('.devx-bar-col').last().getAttribute('aria-pressed')) === 'true';
    log(`${v}: Enter toggles a legend category and picks a chart month`, legendKey && barKey);
    await page.locator('.dev-clear').press('Enter');
    await page.waitForTimeout(100);
    log(`${v}: Enter on Clear all resets`, (await state()).count === all.length);
  }
  // A project with no pin ("Not on the map") opens its details from the list, by mouse and keyboard.
  // Run in a metro that is known from the data to have one, so the case never silently skips.
  // A fresh tab, so switching metros never tears down a map that is still mid-animation from the steps above.
  if (offCity) {
    const offPage = await ctx.newPage();
    offPage.on('pageerror', (e) => errors.push(e.message));
    await offPage.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await offPage.goto(`${base}#markets&tool=map&city=${encodeURIComponent(offCity)}`);
    await offPage.waitForFunction(() => document.querySelector('.dev-map')?.dataset.pins != null, null, { timeout: 30000 });
    await waitFull(offPage, offCity);
    const offItem = offPage.locator('.dev-item:not([hidden]):has(.dev-off)').first();
    await offItem.scrollIntoViewIfNeeded();
    const offName = await offItem.locator('.dev-name').textContent();
    await offItem.locator('.dev-pick').click();
    const shown = await offPage.locator('.devx-panel:not([hidden]) .dev-pop-title').textContent().catch(() => null);
    const current = await offItem.locator('.dev-pick').getAttribute('aria-current');
    const links = await offPage.locator('.devx-panel .dev-links a').count();
    const why = await offPage.locator('.devx-panel').textContent();
    await offPage.keyboard.press('Escape');
    const closed = await offPage.locator('.devx-panel').isHidden();
    await offItem.locator('.dev-pick').press('Enter');
    const reopened = (await offPage.locator('.devx-panel:not([hidden]) .dev-pop-title').textContent().catch(() => null)) === offName;
    const noted = /not on the map|no map location|pending|await/i.test(why ?? '');
    log(`${v}: a project not on the map (${offCity}) opens its details from the list`, shown === offName && current === 'true' && links >= 1 && noted && closed && reopened, `"${offName}": panel "${shown}", current ${current}, ${links} links, noted ${noted}, closed ${closed}, reopened ${reopened}`);
  } else {
    log(`${v}: a project not on the map opens its details from the list`, false, 'no project without coordinates in market.json to test with');
    }
  // The Merc (TABS2025017471, TABS2025017477) and its San Antonio city permits:
  // each query must list exactly what the generated data says it should.
  const sa = byCity.get('San Antonio') ?? [];
  if (sa.length) {
    await page.goto(`${base}#markets&tool=map&city=San%20Antonio`);
    await page.waitForFunction(() => document.querySelector('.dev-map')?.dataset.pins != null);
    await waitFull(page, 'San Antonio');
    if (vp.mobile) {
      // Phones: the list sits under the full-height map, so reach it through the visible control, not fill() on a hidden field.
      const open = page.locator('.devx-to-list');
      log(`${v}: a visible "Search & project list" control is on the map`, await open.isVisible());
      await open.click();
      await page.waitForTimeout(700);
      const side = await page.evaluate(() => {
        const r = document.querySelector('.devx-side').getBoundingClientRect();
        const tabs = document.querySelector('nav.tabs')?.getBoundingClientRect();
        const legend = document.querySelector('.devx-legend')?.getBoundingClientRect();
        return { top: r.top, focused: document.activeElement?.closest('.devx-search') != null, legendShown: legend ? legend.height > 0 : false, tabsTop: tabs?.top ?? innerHeight, vh: innerHeight };
      });
      log(`${v}: it scrolls the search and list into view and focuses search`, side.top >= 0 && side.top < side.vh / 2 && side.focused, JSON.stringify(side));
      log(`${v}: the category legend is shown with the list`, side.legendShown);
      const firstName = await page.locator('.dev-list .dev-item .dev-name').first().textContent();
      const before = await page.$$eval('.dev-list .dev-item:not([hidden])', (r) => r.length);
      await page.keyboard.type(firstName);
      await page.waitForTimeout(400);
      const typed = await page.$$eval('.dev-list .dev-item:not([hidden]) .dev-name', (ns) => ns.length);
      log(`${v}: typing in that search filters the list`, typed > 0 && typed < before, `${before} -> ${typed} listed`);
      await page.locator('.dev-search input').fill('');
      await page.waitForTimeout(300);
      // The filter pill row scrolls sideways: every pill can be reached and used, and the page itself never scrolls sideways.
      const pills = await page.evaluate(() => {
        const row = document.querySelector('.devx-filters');
        return { scrolls: row.scrollWidth > row.clientWidth, overflowX: getComputedStyle(row).overflowX, pageWide: document.documentElement.scrollWidth > innerWidth, n: row.querySelectorAll('select').length };
      });
      log(`${v}: the filter pill row scrolls sideways when it overflows; the page doesn't`, (!pills.scrolls || /auto|scroll/.test(pills.overflowX)) && !pills.pageWide, JSON.stringify(pills));
      const last = page.locator('.devx-filters select').last();
      await last.scrollIntoViewIfNeeded();
      const lastBox = await last.boundingBox();
      log(`${v}: the last filter pill can be scrolled into view`, lastBox != null && lastBox.x >= 0 && lastBox.x + lastBox.width <= vp.width + 1, JSON.stringify(lastBox));
    }
    const merc = ['TABS2025017471', 'TABS2025017477'].map((id) => sa.find((p) => p.id === id));
    for (const p of merc.filter(Boolean)) {
      console.log(`  Merc in data: ${p.id} "${p.name}" $${p.cost} at ${p.address ?? 'no address'}; pin ${p.lat ?? '-'},${p.lng ?? '-'} ${p.approximate ? '(ZIP center)' : p.locatedFrom ? `(site point: ${p.locatedFrom})` : p.lat != null ? '(geocoded address)' : '(none)'}; aliases ${JSON.stringify(p.aliases ?? [])}`);
    }
    const street = (a) => String(a ?? '').split(',')[0].toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    for (const p of merc.filter(Boolean)) {
      const twins = sa.filter((x) => x.source === 'city' && street(x.address) === street(p.address));
      log(`${v}: ${p.id} has no city duplicate at ${street(p.address)}`, twins.length === 0, twins.map((x) => x.id).join(', '));
      log(`${v}: ${p.id} has a pin with stated provenance`, p.lat != null , p.approximate ? 'ZIP center' : p.locatedFrom ?? 'geocoded address');
    }
    if (merc.some((p) => !p)) console.log(`  Merc not in data: ${['TABS2025017471', 'TABS2025017477'].filter((_, i) => !merc[i]).join(', ')}`);
    for (const query of ['Merc', 'TABS2025017471', 'TABS2025017477', 'COM-SHL-PMT25-40400053', 'COM-SHL-PMT25-40400055', '5734 Utsa', '5730 Utsa']) {
      await page.locator('.dev-search input').fill(query);
      await page.waitForTimeout(250);
      const listed = await page.$$eval('.dev-list .dev-item:not([hidden]) .dev-name', (ns) => ns.map((n) => n.textContent));
      const want = expected('San Antonio', { query }).map((p) => p.name);
      const mustFind = merc.filter((p) => p && expected('San Antonio', { query }).includes(p)).map((p) => p.name);
      if (mustFind.length) log(`${v}: San Antonio search "${query}" finds ${mustFind.join(' and ')}`, mustFind.every((n) => listed.includes(n)));
      log(`${v}: San Antonio search "${query}" lists what the data holds`, JSON.stringify([...listed].sort()) === JSON.stringify([...want].sort()), `${listed.length}: ${listed.slice(0, 4).join(' | ')}`);
    }
    await page.locator('.dev-search input').fill('');
    // Coverage note and smaller filings (PDL Club, TABS2026006871, $1.2M, is below San Antonio's cutoff).
    const metro = data.metros?.find((m) => m.city === 'San Antonio');
    const note = await page.locator('.dev-coverage').textContent();
    log(`${v}: San Antonio coverage note says the map is not complete`, /not a complete list/.test(note ?? ''), note?.slice(0, 160));
    if (metro?.listed != null) {
      log(`${v}: coverage note lists all ${metro.listed} collected`, (note ?? '').includes(`lists all ${metro.listed.toLocaleString('en-US')}`));
      if (metro.approximate) log(`${v}: coverage note counts ${metro.approximate} approximate`, (note ?? '').includes(`${metro.approximate.toLocaleString('en-US')} near their ZIP code center`));
      if (metro.awaiting) log(`${v}: coverage note counts ${metro.awaiting} awaiting details`, (note ?? '').includes(`${metro.awaiting.toLocaleString('en-US')} still await`));
      if (metro.unlocated) log(`${v}: coverage note counts ${metro.unlocated} unlocated`, (note ?? '').includes(`${metro.unlocated.toLocaleString('en-US')} have no point yet`));
    } else if (metro?.cutoff != null) log(`${v}: coverage note gives the cap of ${metro.cap}`, (note ?? '').includes(`pins the ${metro.cap} biggest`));
    const small = (data.smaller ?? []).filter((s) => s.city === 'San Antonio');
    console.log(`  San Antonio metro: ${metro ? `${metro.filings} filings, cap ${metro.cap}, cutoff ${metro.cutoff}` : 'no coverage row'}; ${small.length} smaller filings`);
    const pdl = small.find((s) => s.id === 'TABS2026006871') ?? sa.find((p) => p.id === 'TABS2026006871');
    console.log(`  PDL Club TABS2026006871: ${pdl ? `${small.includes(pdl) ? 'smaller filings list' : 'pinned map'} $${pdl.cost}${pdl.address ? ` at ${pdl.address}` : ''}` : 'not in this build'}`);
    log(`${v}: PDL Club (TABS2026006871) is in the build`, Boolean(pdl));
    if (pdl) {
      const queries = ['PDL Club', 'TABS2026006871', ...(pdl.address ? [pdl.address.split(',')[0].trim()] : [])];
      // TDLR files the street as "13735 IH 10 W" (no hyphen), so search the address as filed.
      if (small.includes(pdl)) console.log(`  PDL Club pin: ${pdl.lat != null ? `${pdl.lat},${pdl.lng}${pdl.approximate ? ' (ZIP center)' : ''}` : pdl.paged ? 'page read, address not placed' : 'page not read yet'}`);
      for (const query of queries) {
        await page.locator('.dev-search input').fill(query);
        await page.waitForTimeout(300);
        const pinned = await page.$$eval('.dev-list .dev-item:not([hidden]) .dev-name', (ns) => ns.map((n) => n.textContent));
        const hint = await page.locator('.dev-smaller-hint').evaluate((b) => (b.hidden ? '' : b.textContent));
        const listed = await page.$$eval('.dev-smaller-list .dev-name', (ns) => ns.map((n) => n.textContent));
        const found = small.includes(pdl) ? Boolean(hint) && listed.includes(pdl.name) : pinned.includes(pdl.name);
        log(`${v}: map search "${query}" finds PDL Club`, found, small.includes(pdl) ? `hint "${hint}"` : `${pinned.length} listed`);
      }
      if (small.includes(pdl) && pdl.lat != null) {
        await page.locator('.dev-search input').fill('PDL Club');
        await page.waitForTimeout(300);
        log(`${v}: PDL Club search shows its small pin`, (await page.locator('.dev-map').getAttribute('data-small-pins')) === '1');
      }
      await page.locator('.dev-search input').fill('');
      if (small.includes(pdl) && !pdl.address) console.log('  PDL Club address search: its page has not been read yet, so it has no address');
    }
    if (small.length) {
      if (!(await page.locator('.dev-smaller').evaluate((d) => d.open))) await page.locator('.dev-smaller summary').click();
      await page.locator('.dev-smaller-search').fill(small[0].id);
      const found = await page.$$eval('.dev-smaller-list .dev-name', (ns) => ns.map((n) => n.textContent));
      log(`${v}: smaller filings search finds ${small[0].id}`, found.includes(small[0].name), found.slice(0, 3).join(' | '));
    }
    // Smaller pins: every smaller filing with coordinates is drawn while no filter is on, and a filter hides them.
    await page.waitForTimeout(300);
    const wantSmall = small.filter((s) => s.lat != null).length;
    log(`${v}: ${wantSmall} smaller-filing pins drawn`, (await page.locator('.dev-map').getAttribute('data-small-pins')) === String(wantSmall));
    if (wantSmall) {
      const withPin = small.find((s) => s.lat != null);
      if (!(await page.locator('.dev-smaller').evaluate((d) => d.open))) await page.locator('.dev-smaller summary').click();
      await page.locator('.dev-smaller-search').fill(withPin.id);
      await page.locator('.dev-smaller-show').first().click();
      await page.waitForTimeout(1200);
      const popup = await page.locator('.leaflet-popup-content').textContent().catch(() => '');
      log(`${v}: "Show on map" opens ${withPin.id}'s pin`, (popup ?? '').includes(withPin.name), popup?.slice(0, 80));
      await page.locator('.dev-smaller-search').fill('');
    }
    if (wantSmall) {
      const label = page.locator('.devx-filters select[aria-label="Type of work"]');
      if (await label.count()) {
        await label.selectOption({ index: 1 });
        await page.waitForTimeout(300);
        log(`${v}: a filter hides the smaller-filing pins`, (await page.locator('.dev-map').getAttribute('data-small-pins')) === '0');
        await label.selectOption('');
      }
    }
    // Reporting is off until migration 0019 and DEVELOPMENT_REPORTS_ENABLED: no form, the map works as before.
    log(`${v}: no report form while reporting is off`, (await page.locator('.dev-report').count()) === 0);
  }
  // The market pages link into the workspace, and the city menu moves it to another metro.
  const other = [...byCity.keys()].find((c) => c !== biggest);
  await page.goto(`${base}#markets&city=${encodeURIComponent(biggest)}`);
  const teaser = page.locator('.devx-teaser-open');
  const teaserOk = await teaser.waitFor({ timeout: 15000 }).then(() => true, () => false);
  if (teaserOk) {
    await teaser.click();
    await page.waitForFunction(() => document.querySelector('.dev-map')?.dataset.pins != null, null, { timeout: 30000 });
  }
  log(`${v}: a city's market page opens its development map workspace`, teaserOk && /tool=map/.test(await page.evaluate(() => location.hash)) && (await page.locator('#dev-title').textContent()).includes(biggest));
  if (other) {
    const menu = page.locator('.devx-city-menu select');
    const chips = page.locator('.devx-cities .chip', { hasText: other });
    if (await menu.isVisible()) await menu.selectOption(other);
    else await chips.first().click();
    await page.waitForFunction((c) => document.querySelector('#dev-title')?.textContent.includes(c), other, { timeout: 15000 }).catch(() => null);
    log(`${v}: the city ${(await menu.isVisible()) ? 'menu' : 'chips'} switch the map to ${other}`, (await page.locator('#dev-title').textContent()).includes(other) && (await page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get('city'))) === other);
  }
  log(`${v}: no page errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}
// A mid-range phone on a slow connection: Lighthouse's "Slow 4G" (150 ms, 1.6 Mbps down) and a 4x slower CPU.
console.log('\nSlow phone (Slow 4G 1.6 Mbps / 150 ms, CPU 4x slower), gzip as GitHub Pages serves it:');
console.log('| Market | market.json (gzip) | Market file (gzip) | Downloaded | Map ready | Full list |');
console.log('|---|---:|---:|---:|---:|---:|');
const gz = async (path) => (gzipSync(await readFile(join(siteDir, path))).length / 1e6).toFixed(2);
for (const city of ['San Antonio', 'Houston'].filter((c) => byCity.has(c))) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6e6 / 8) * 0.9, uploadThroughput: (750e3 / 8) * 0.9 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  let bytes = 0;
  cdp.on('Network.loadingFinished', (e) => (bytes += e.encodedDataLength));
  const t0 = Date.now();
  await page.goto(`${base}#markets&tool=map&city=${encodeURIComponent(city)}`);
  await page.waitForFunction(() => document.querySelector('.dev-map')?.dataset.pins != null, null, { timeout: 180000 });
  const map = Date.now() - t0;
  const want = data.projects.filter((p) => p.city === city).length;
  await page.waitForFunction((n) => document.querySelectorAll('.dev-list .dev-item').length === n, want, { timeout: 180000 }).catch(() => null);
  const full = Date.now() - t0;
  const file = data.files?.[city];
  console.log(`| ${city} | ${await gz('market.json')} MB | ${file ? `${await gz(file)} MB` : '-'} | ${(bytes / 1e6).toFixed(1)} MB | ${(map / 1000).toFixed(1)} s | ${(full / 1000).toFixed(1)} s |`);
  await ctx.close();
}

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
