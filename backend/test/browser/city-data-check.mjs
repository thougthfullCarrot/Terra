// Browser check for the City data page (markets-view.js cityView).
//
//   node test/browser/city-data-check.mjs <site dir> [screenshot dir]
//
// Serves a built site folder holding a market.json (real or synthetic), blocks
// every other host, and in Chromium checks: the header, picker and coverage
// line; the four headline figures; switching city and topic (click and arrow
// keys) with the URL following; one table row per metric with a period; the
// source fold's link; the missing-figures note; a zero shown as 0; no ranking
// strips; and no sideways scrolling on a phone or at 200% zoom. Read-only and offline.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const [dir, shotDir] = process.argv.slice(2);
const siteDir = resolve(dir ?? '../site');
const shots = shotDir ? resolve(shotDir) : null;
if (shots) await mkdir(shots, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.endsWith('/') ? `${path}index.html` : path;
  try {
    const body = await readFile(join(siteDir, file));
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const market = JSON.parse(await readFile(join(siteDir, 'market.json'), 'utf8'));

let pass = 0;
let fail = 0;
const log = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});

async function open(viewport, hash, { phone = false, theme = 'light', zoom = 1 } = {}) {
  const context = await browser.newContext({ viewport, colorScheme: theme, isMobile: phone, hasTouch: phone, deviceScaleFactor: zoom });
  const page = await context.newPage();
  await page.route(/^(?!http:\/\/localhost)/, (route) => route.abort());
  await page.addInitScript((t) => {
    try {
      sessionStorage.setItem('terra-pitch-seen', '1');
      localStorage.setItem('terra-theme', t);
    } catch {}
  }, theme);
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(base + hash);
  await page.waitForSelector('.city-head', { timeout: 10000 });
  return page;
}
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const cities = market.markets.map((m) => m.city);
const first = cities[0];
const page = await open({ width: 1440, height: 900 }, `#markets&city=${encodeURIComponent(first)}`);
log('header names the city', (await page.textContent('.city-head h2')) === first);
log('coverage line', /\d+ of \d+ figures published/.test(await page.textContent('.city-coverage')));
const tiles = await page.$$eval('.city-kpis .kpi small', (n) => n.map((x) => x.textContent));
log('four headline figures', tiles.length === 4, tiles.join(' | '));
log('no ranking strips', (await page.$$('.strip, .market-groups')).length === 0);
log('top filters hidden on a city page', await page.isHidden('#m-filters'));

// Every row has a metric, value and period, and a metric shows once per topic.
const rows = await page.$$eval('.city-table tbody tr', (trs) => trs.map((tr) => [tr.querySelector('.city-metric-name')?.textContent, tr.querySelector('td.num')?.textContent, tr.querySelector('.city-period')?.textContent]));
log('detail rows complete', rows.length > 0 && rows.every((r) => r.every(Boolean)), `${rows.length} rows`);
log('no metric repeated in the view', new Set([...rows.map((r) => r[0]), ...tiles]).size === rows.length + tiles.length);

// Topic tabs: click, then arrow keys, with the URL following.
const tabs = await page.$$eval('.city-tabs [role=tab]', (n) => n.map((x) => x.id));
await page.click(`#${tabs[1]}`);
log('click opens a topic', (await page.getAttribute(`#${tabs[1]}`, 'aria-selected')) === 'true' && (await page.evaluate(() => location.hash)).includes('focus='));
await page.keyboard.press('ArrowRight');
const focused = await page.evaluate(() => document.activeElement?.id);
log('arrow key moves to the next topic and keeps focus', focused === tabs[2] && (await page.getAttribute(`#${tabs[2]}`, 'aria-selected')) === 'true');
await page.keyboard.press('End');
await page.waitForFunction((id) => document.activeElement?.id === id, tabs.at(-1), { timeout: 2000 }).catch(() => {});
const endAt = await page.evaluate(() => document.activeElement?.id);
log('End jumps to the last topic', endAt === tabs.at(-1), `${endAt} vs ${tabs.at(-1)}`);
log('only the selected tab is in the tab order', (await page.$$eval('.city-tabs [role=tab][tabindex="0"]', (n) => n.length)) === 1);

// Source fold opens from the keyboard and links out.
await page.focus('.city-fold summary');
const summary = await page.$('.city-table .city-fold summary');
await summary.focus();
await page.keyboard.press('Enter');
const link = await page.$eval('.city-table .city-fold[open] a', (a) => ({ href: a.href, target: a.target })).catch(() => null);
log('source fold opens by keyboard with a link', Boolean(link?.href.startsWith('http')), link?.href);
const area = await page.$eval('.city-table .city-fold[open] dl', (d) => d.textContent);
log('fold names the area and method', /Area/.test(area) && /Method/.test(area));

// City switching from the header picker.
await page.selectOption('.city-picker select', cities[1]);
log('picker switches city', (await page.textContent('.city-head h2')) === cities[1] && (await page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get('city'))) === cities[1]);

// Missing values and zeros, found from the data.
const groups = market.groups;
let missingCase = null;
let zeroCase = null;
for (const m of market.markets)
  for (const g of groups) {
    const keys = g.metrics.filter((k) => !['jobsGrowth', 'unemployment', 'pepGrowth', 'netMigration'].includes(k));
    if (!missingCase && keys.some((k) => m.values[k] == null) && keys.some((k) => m.values[k] != null)) missingCase = { city: m.city, group: g.key, n: new Set(keys.filter((k) => m.values[k] == null && market.markets.some((o) => o.values[k] != null))).size };
    const z = keys.find((k) => m.values[k] === 0);
    if (!zeroCase && z) zeroCase = { city: m.city, group: g.key, label: market.metrics.find((x) => x.key === z).label };
  }
if (missingCase) {
  await page.goto(`${base}#markets&city=${encodeURIComponent(missingCase.city)}&focus=${missingCase.group}`);
  await page.waitForSelector('.city-head');
  const note = await page.textContent('.city-missing summary').catch(() => '');
  log('missing figures summed in one note', /not available/.test(note) && (await page.$$eval('.city-table td.num', (n) => n.filter((x) => x.textContent.trim() === '—').length)) === 0, `${missingCase.city}/${missingCase.group}: ${note}`);
  await page.click('.city-missing summary');
  log('missing note lists them', (await page.$$('.city-missing-list li')).length === missingCase.n, `${missingCase.n} expected`);
} else log('missing case in data', false, 'none found');
if (zeroCase) {
  await page.goto(`${base}#markets&city=${encodeURIComponent(zeroCase.city)}&focus=${zeroCase.group}`);
  await page.waitForSelector('.city-head');
  const value = await page.$$eval('.city-table tbody tr', (trs, label) => trs.find((tr) => tr.querySelector('.city-metric-name').textContent.startsWith(label))?.querySelector('td.num').textContent, zeroCase.label);
  log('zero shown as 0', /^\$?0(\.0+)?%?$/.test(value?.trim() ?? ''), `${zeroCase.city} ${zeroCase.label}: ${value}`);
} else console.log('SKIP  zero case (no zero in this data)');
log('no page errors (desktop)', page.errors.length === 0, page.errors.join('; '));
await page.context().close();

// Every city and topic on a phone: no sideways scroll, no clipped label, every row with a period, no dash rows.
{
  const phone = await open({ width: 390, height: 844 }, `#markets&city=${encodeURIComponent(first)}`, { phone: true });
  const problems = [];
  let views = 0;
  for (const city of cities)
    for (const g of market.groups) {
      await phone.evaluate((h) => (location.hash = h), `#markets&city=${encodeURIComponent(city)}&focus=${g.key}`);
      await phone.waitForFunction((c) => document.querySelector('.city-head h2')?.textContent === c, city);
      const bad = await phone.evaluate(() => {
        const out = [];
        if (document.documentElement.scrollWidth > document.documentElement.clientWidth) out.push('sideways scroll');
        for (const n of document.querySelectorAll('.city-metric-name, .city-kpis small, .city-tab'))
          if (n.scrollWidth > n.clientWidth + 1) out.push(`clipped: ${n.textContent}`);
        for (const tr of document.querySelectorAll('.city-table tbody tr')) {
          if (tr.querySelector('td.num')?.textContent.trim() === '—') out.push(`dash row: ${tr.querySelector('.city-metric-name').textContent}`);
          if (!tr.querySelector('.city-period')?.textContent.trim()) out.push('row without period');
        }
        return out;
      });
      views++;
      for (const b of bad) problems.push(`${city}/${g.key}: ${b}`);
    }
  log('every city and topic reads cleanly on a phone', problems.length === 0, problems.length ? problems.slice(0, 8).join('; ') : `${views} views`);
  log('no page errors (all views)', phone.errors.length === 0, phone.errors.join('; '));
  await phone.context().close();
}

// Phone, and 200% zoom (a 720px-wide window at twice the scale), in both themes.
for (const theme of ['light', 'dark']) {
  const phone = await open({ width: 390, height: 844 }, `#markets&city=${encodeURIComponent(first)}`, { phone: true, theme });
  const cols = await phone.$eval('.city-kpis', (n) => getComputedStyle(n).gridTemplateColumns.split(' ').length);
  log(`phone ${theme}: two-column headline grid`, cols === 2);
  log(`phone ${theme}: no sideways scroll`, (await sideways(phone)) <= 0);
  if (shots) await phone.screenshot({ path: join(shots, `after-phone-${theme}.png`), fullPage: true });
  await phone.context().close();
  const zoom = await open({ width: 720, height: 450 }, `#markets&city=${encodeURIComponent(first)}`, { zoom: 2, theme });
  log(`200% zoom ${theme}: no sideways scroll`, (await sideways(zoom)) <= 0);
  if (shots) await zoom.screenshot({ path: join(shots, `after-zoom200-${theme}.png`), fullPage: true });
  await zoom.context().close();
  const desk = await open({ width: 1440, height: 900 }, `#markets&city=${encodeURIComponent(first)}`, { theme });
  if (shots) await desk.screenshot({ path: join(shots, `after-desktop-${theme}.png`), fullPage: true });
  await desk.context().close();
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
