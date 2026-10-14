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
import { chromium } from 'playwright-core';

const siteDir = resolve(process.argv[2] ?? '../site');
const shots = process.argv[3] ? resolve(process.argv[3]) : null;
const market = JSON.parse(await readFile(join(siteDir, 'market.json'), 'utf8'));
const data = market.developments;
if (!data?.projects?.length) {
  console.log('FAIL  market.json has no development projects');
  process.exit(1);
}

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
      const hay = squash([p.name, p.facility, p.id, p.address, p.place].filter(Boolean).join(' '));
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
    const body = await readFile(join(siteDir, path));
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(body);
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
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const city = biggest;
  await page.goto(`${base}#markets&city=${encodeURIComponent(city)}`);
  const t0 = Date.now();
  await page.waitForSelector('.dev-map.leaflet-container', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('.dev-map')?.dataset.pins != null);
  const firstDraw = Date.now() - t0;
  const all = byCity.get(city);
  const v = vp.name;
  console.log(`\n[${v}] ${city}: ${all.length} projects, ${pinsOf(all)} with coordinates`);

  const panelOpen = await page.locator('.dev-filters').evaluate((d) => d.open);
  log(`${v}: filter panel ${vp.mobile ? 'starts folded' : 'starts open'}`, panelOpen === !vp.mobile);
  if (vp.mobile) {
    const before = await page.locator('.dev-filters-body').isVisible();
    await page.locator('.dev-filters-summary').click();
    const after = await page.locator('.dev-filters-body').isVisible();
    log(`${v}: tapping the panel header opens it`, !before && after);
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    log(`${v}: no sideways scrolling`, scrollW <= vp.width, `${scrollW}px`);
  }

  const state = () =>
    page.evaluate(() => ({
      count: Number(document.querySelector('.dev-count strong').textContent.replace(/,/g, '')),
      pinsText: Number(/(\d[\d,]*) pins?/.exec(document.querySelector('.dev-count').textContent)?.[1].replace(/,/g, '')),
      items: document.querySelectorAll('.dev-list .dev-item:not([hidden])').length,
      offMap: document.querySelectorAll('.dev-list .dev-item:not([hidden]) .dev-off').length,
      markers: document.querySelectorAll('.dev-map .leaflet-overlay-pane path.leaflet-interactive').length,
      empty: !document.querySelector('.dev-empty').hidden
    }));
  const setF = async (f) => {
    await page.locator('.dev-search input').fill(f.query ?? '');
    for (const [k, label] of Object.entries(LABELS)) {
      const select = page.locator('.dev-filter-grid label', { hasText: label }).locator('select');
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
  const menus = await page.$$eval('.dev-filter-grid label', (ls) => ls.map((l) => [l.querySelector('span').textContent, [...l.querySelector('select').options].map((o) => [o.value, o.textContent]).filter(([x]) => x)]));
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
    const select = [...document.querySelectorAll('.dev-filter-grid label')].find((l) => l.textContent.startsWith('Estimated cost')).querySelector('select');
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
  await page.locator('.dev-map .leaflet-overlay-pane path.leaflet-interactive').first().click({ force: true });
  await page.waitForSelector('.leaflet-popup .dev-pop-title', { timeout: 5000 }).catch(() => null);
  const popTitle = await page.locator('.leaflet-popup .dev-pop-title').textContent().catch(() => null);
  const active = await page.locator('.dev-item.active .dev-name').textContent().catch(() => null);
  const popLinks = await page.locator('.leaflet-popup .dev-links a').count();
  log(`${v}: pin click opens the project panel and highlights it in the list`, Boolean(popTitle) && popTitle === active && popLinks === 2, `"${popTitle}"`);
  if (shots) await page.locator('.dev-card').screenshot({ path: join(shots, `${v}-filtered.png`) });
  await page.locator('.leaflet-popup-close-button').click();
  const target = page.locator('.dev-item:not([hidden]):not(:has(.dev-off)):not(.active)').nth(2);
  const pick = await target.locator('.dev-name').textContent();
  await target.locator('.dev-pick').click();
  await page.waitForFunction((t) => document.querySelector('.leaflet-popup .dev-pop-title')?.textContent === t, pick, { timeout: 5000 }).catch(() => null);
  log(`${v}: list click flies to the pin and opens its panel`, (await page.locator('.leaflet-popup .dev-pop-title').textContent().catch(() => null)) === pick, `"${pick}"`);

  // Clear filters.
  await setF({ query: 'a', publicInvolvement: 'private', cost: 'over100', filed: '365' });
  await page.locator('.dev-clear').click();
  await page.waitForTimeout(150);
  const s = await state();
  const reset = (await page.$$eval('.dev-filter-grid select', (ss) => ss.every((x) => x.value === ''))) && (await page.locator('.dev-search input').inputValue()) === '';
  log(`${v}: Clear filters restores every project and pin`, reset && s.count === all.length && s.items === all.length && s.markers === pinsOf(all) && !(await page.locator('.dev-clear').isVisible()), `${s.count} projects, ${s.markers} pins`);

  // Keyboard: reach every control by Tab, each with a visible focus ring.
  if (!vp.mobile) {
    await setF({ cost: 'over100' });
    await page.locator('.dev-filters-summary').focus();
    const order = [];
    for (let i = 0; i < 12; i++) {
      const info = await page.evaluate(() => {
        const a = document.activeElement;
        const cs = getComputedStyle(a);
        const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
        return { tag: a.tagName, cls: a.className, label: a.getAttribute('aria-label') ?? a.closest('label')?.querySelector('span')?.textContent ?? a.textContent.trim().slice(0, 30), ring, visible: a.matches(':focus-visible') };
      });
      order.push(info);
      if (info.cls.includes('dev-clear')) break;
      await page.keyboard.press('Tab');
    }
    const reached = order.map((o) => o.label);
    const want = ['Filter projects', 'Search projects by name, project number or address', ...menus.map(([l]) => l), 'Clear filters'];
    log(`${v}: Tab reaches the panel header, search, every menu and Clear filters in order`, want.every((w, i) => (reached[i] ?? '').startsWith(w)), reached.join(' → '));
    const noRing = order.filter((o) => !o.ring || !o.visible);
    log(`${v}: every control shows a visible keyboard focus ring`, noRing.length === 0, noRing.map((o) => o.label).join(', '));
    await page.locator('.dev-filters-summary').focus();
    await page.keyboard.press('Enter');
    const closed = !(await page.locator('.dev-filters').evaluate((d) => d.open));
    await page.keyboard.press('Enter');
    log(`${v}: Enter folds and unfolds the filter panel`, closed && (await page.locator('.dev-filters').evaluate((d) => d.open)));
    await page.locator('.dev-clear').press('Enter');
    await page.waitForTimeout(100);
    log(`${v}: Enter on Clear filters resets`, (await state()).count === all.length);
  }
  // A project with no pin ("Not on the map") opens its details from the list, by mouse and keyboard.
  // Run in a metro that is known from the data to have one, so the case never silently skips.
  // A fresh tab, so switching metros never tears down a map that is still mid-animation from the steps above.
  if (offCity) {
    const offPage = await ctx.newPage();
    offPage.on('pageerror', (e) => errors.push(e.message));
    await offPage.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await offPage.goto(`${base}#markets&city=${encodeURIComponent(offCity)}`);
    await offPage.waitForFunction(() => document.querySelector('.dev-map')?.dataset.pins != null, null, { timeout: 30000 });
    const offItem = offPage.locator('.dev-item:not([hidden]):has(.dev-off)').first();
    await offItem.scrollIntoViewIfNeeded();
    const offName = await offItem.locator('.dev-name').textContent();
    await offItem.locator('.dev-pick').click();
    const shown = await offItem.locator('.dev-detail .dev-pop-title').textContent().catch(() => null);
    const expanded = await offItem.locator('.dev-pick').getAttribute('aria-expanded');
    const links = await offItem.locator('.dev-detail .dev-links a').count();
    await offItem.locator('.dev-pick').press('Enter');
    const closed = (await offItem.locator('.dev-detail').count()) === 0;
    await offItem.locator('.dev-pick').press('Enter');
    const reopened = (await offItem.locator('.dev-detail').count()) === 1;
    log(`${v}: a project not on the map (${offCity}) opens its details from the list`, shown === offName && expanded === 'true' && links >= 1 && closed && reopened, `"${offName}"`);
  } else {
    log(`${v}: a project not on the map opens its details from the list`, false, 'no project without coordinates in market.json to test with');
  }
  log(`${v}: no page errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}
await browser.close();
server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
