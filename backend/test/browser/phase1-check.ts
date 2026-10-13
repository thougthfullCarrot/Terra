// Desktop and phone browser check for the Phase 1 labels and states.
//
//   npx tsx test/browser/phase1-check.ts [screenshot-dir]
//
// Serves site/ in open mode (no accounts) with test-only data files built
// from the real metric, group and source lists, so nothing live is read or
// written. The figures are made up for the check and never leave this
// process. Drives Chromium (playwright-core) and exits non-zero on a failure.
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { GROUPS, METRICS, SOURCES } from '../../src/market/snapshot.js';
import { METROS } from '../../src/market/metros.js';

const site = resolve(import.meta.dirname, '../../../site');
const shots = process.argv[2] ?? '';

// A city-limits figure on the Compare page's key figures (KEY_METRICS in site/market.js).
const CITY_KEY = 'taxRate';

/** A value inside each metric's valid range, different per city. */
function fixtureMarket() {
  const markets = METROS.map((metro, i) => {
    const values: Record<string, number | null> = {};
    const periods: Record<string, string | null> = {};
    const status: Record<string, string> = {};
    for (const m of METRICS) {
      const { min, max } = m.valid;
      const lo = Math.max(min, Math.min(max, 0));
      values[m.key] = Math.round((lo + ((max - lo) * (0.1 + i * 0.05))) * 100) / 100;
      periods[m.key] = m.source === 'BLS' ? 'Aug 2026' : m.source === 'Census ACS' ? '2024' : 'Sep 2026';
      status[m.key] = 'fresh';
    }
    return { city: metro.city, metro: metro.name, values, periods, fetchedAt: {}, status, shared: {} as Record<string, string> };
  });
  // Austin reports one city figure a month later than the rest; New Braunfels repeats San Antonio's metro jobs and has one stale figure.
  const austin = markets.find((m) => m.city === 'Austin')!;
  const cityMetric = METRICS.find((m) => m.key === CITY_KEY)!;
  austin.periods[cityMetric.key] = 'Oct 2026';
  const nb = markets.find((m) => m.city === 'New Braunfels');
  const bls = METRICS.find((m) => m.source === 'BLS')!;
  if (nb) {
    nb.shared[bls.key] = 'San Antonio';
    nb.status[cityMetric.key] = 'retained';
  }
  return {
    schemaVersion: 2,
    generatedAt: '2026-10-12T00:00:00Z',
    metrics: METRICS,
    groups: GROUPS,
    markets,
    sources: SOURCES,
    rates: [{ key: 'DGS10', label: '10-year Treasury', note: '', value: 4.1, change: null, period: 'Oct 10, 2026' }],
    developments: { asOf: '2026-10-12', projects: [] }
  };
}

const sitesFile = {
  generatedAt: '2026-10-12T00:00:00Z',
  sources: [{ city: 'Austin', name: 'Travis Central Appraisal District', page: 'https://example.org/' }],
  sites: [
    { id: 'T1', city: 'Austin', use: 'land', code: 'D1', address: '100 Test Rd', landSqft: 435600, landValue: 2000000, value: 2000000, landPsf: 4.59, built: null, buildingSqft: null, zoning: 'MF-3', flood: 'AE', lat: 30.3, lng: -97.7, url: null }
  ]
};

const files: Record<string, unknown> = {
  '/market.json': fixtureMarket(),
  '/sites.json': sitesFile,
  '/postings.json': { generatedAt: '2026-10-12T00:00:00Z', jobs: [] },
  '/news.json': { generatedAt: '2026-10-12T00:00:00Z', items: [] },
  '/events.json': { generatedAt: '2026-10-12T00:00:00Z', events: [] }
};
const types: Record<string, string> = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
// Set by a step to hold one file back, so its loading box can be seen.
let hold: string | null = null;

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  if (hold && path === hold) await new Promise((r) => setTimeout(r, 2500));
  if (path in files) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(files[path]));
  const file = normalize(join(site, path.endsWith('/') ? `${path}index.html` : path));
  if (!file.startsWith(site)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const address = server.address();
const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
if (shots) await mkdir(shots, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
const devices = {
  desktop: { viewport: { width: 1280, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
};
const failures: string[] = [];
const results: string[] = [];

async function check(dev: string, name: string, test: () => Promise<boolean | string>) {
  let outcome: boolean | string;
  try {
    outcome = await test();
  } catch (error) {
    outcome = error instanceof Error ? error.message.split('\n')[0]! : String(error);
  }
  const line = `${dev} · ${name}: ${outcome === true ? 'ok' : `FAIL (${outcome || 'false'})`}`;
  results.push(line);
  if (outcome !== true) failures.push(line);
}

async function go(page: Page, hash: string) {
  await page.goto(`${origin}/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
}

async function shot(page: Page, dev: string, name: string) {
  if (shots) await page.screenshot({ path: join(shots, `${name}-${dev}.png`), fullPage: false });
}

for (const [dev, opts] of Object.entries(devices)) {
  const ctx = await browser.newContext(opts);
  await ctx.route('https://**/*', (route) => route.fulfill({ status: 204, body: '' }));
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // Loading box while market.json is held back, then the table with source lines.
  hold = '/market.json';
  await page.goto(`${origin}/#markets`);
  await check(dev, 'market loading box is a busy status', async () => (await page.locator('#m-body .state.loading[aria-busy="true"][role="status"]').count()) === 1);
  await shot(page, dev, 'loading');
  hold = null;
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await check(dev, 'market table columns show source and period', async () => {
    const text = await page.locator('.market-table th .figure-source').first().innerText();
    return /·/.test(text) || `got "${text}"`;
  });

  // City view: KPI tiles carry source lines.
  await go(page, '#markets&city=Austin');
  await check(dev, 'city figures show their source line', async () => (await page.locator('.kpi .figure-source').count()) > 0);
  await check(dev, 'development map section still renders', async () => (await page.locator('#markets-view').innerText()).length > 100);
  await shot(page, dev, 'city');

  // Compare: warnings for different periods and areas.
  await go(page, '#markets&tool=compare&cities=Austin,Dallas,New%20Braunfels');
  await check(dev, 'compare lists period and area warnings', async () => {
    const boxes = page.locator('.compare-warnings');
    if (!(await boxes.count())) return 'no warning box';
    const text = (await boxes.allInnerTexts()).join('\n');
    return (/Different reporting periods/.test(text) && /metro division|San Antonio figure/.test(text)) || text.slice(0, 160);
  });
  await check(dev, 'compare rows are flagged and show periods', async () => (await page.locator('.compare-flag').count()) > 0 && (await page.locator('.compare-period').count()) > 0);
  await check(dev, 'compare has no page-wide horizontal scroll', async () => page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth + 1'));
  await shot(page, dev, 'compare');
  await page.locator('.compare-warnings').first().scrollIntoViewIfNeeded();
  await shot(page, dev, 'compare-warnings');

  // Deal calculator: inputs are assumptions, results estimates, the city tax rate verified.
  await go(page, '#markets&tool=calc');
  await check(dev, 'deal calculator shows all three labels', async () => {
    const card = page.locator('.calc-card').first();
    const n = async (k: string) => card.locator(`.prov-${k}`).count();
    return ((await n('verified')) > 0 && (await n('assumption')) > 0 && (await n('estimate')) > 0) || 'missing a label';
  });
  await check(dev, 'tax tag drops when no city is picked', async () => {
    await page.locator('select[name="taxcity"]').selectOption('');
    return (await page.locator('.calc-form .prov-verified').count()) === 0;
  });
  await shot(page, dev, 'deal');

  // Underwriting: same labels, and still computes.
  await go(page, '#markets&tool=uw');
  await check(dev, 'underwriting labels inputs and results', async () => (await page.locator('.prov-assumption').count()) > 0 && (await page.locator('.prov-estimate').count()) >= 3);
  await check(dev, 'underwriting still computes an IRR', async () => /%/.test(await page.locator('.calc-results .rate-value').first().innerText()));
  await shot(page, dev, 'underwriting');

  // Site finder: appraisal columns verified, $/sq ft an estimate.
  await go(page, '#markets&tool=sites&city=Austin');
  await check(dev, 'site finder tags appraisal columns verified and $/sq ft estimate', async () => {
    const heads = page.locator('.sites-table thead th');
    const psf = heads.filter({ hasText: 'Land $/sq ft' });
    return ((await page.locator('.sites-table thead .prov-verified').count()) >= 3 && (await psf.locator('.prov-estimate').count()) === 1) || 'tags wrong';
  });
  await shot(page, dev, 'sites');

  // Empty states on Jobs, News and Events with empty files.
  await go(page, '#');
  await check(dev, 'jobs empty state', async () => (await page.locator('#list .state[role="status"]').count()) === 1);
  await go(page, '#news');
  await check(dev, 'news empty state', async () => (await page.locator('#n-list .state').count()) === 1);
  await go(page, '#events');
  await check(dev, 'events empty state', async () => (await page.locator('#e-list .state').count()) === 1);
  await go(page, '#career');
  await check(dev, 'career tab renders', async () => (await page.locator('#career-view').innerText()).length > 30);

  // Error state with a retry button when market.json fails.
  // A fresh page, since the market file stays loaded for the life of one.
  const failing = await ctx.newPage();
  failing.on('pageerror', (e) => errors.push(String(e)));
  await failing.route('**/market.json', (route) => route.fulfill({ status: 500, body: '' }));
  await go(failing, '#markets');
  await check(dev, 'market error is an alert with a retry button', async () => (await failing.locator('#m-body .state.error[role="alert"] .state-retry').count()) === 1);
  await shot(failing, dev, 'error');

  await check(dev, 'no script errors', async () => errors.length === 0 || errors.join(' | ').slice(0, 200));
  await ctx.close();
}

await browser.close();
server.close();
console.log(results.join('\n'));
console.log(failures.length ? `\n${failures.length} failed` : `\nAll ${results.length} checks passed`);
process.exit(failures.length ? 1 : 0);
