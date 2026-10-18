// Browser check for the Deal of the week markets and the shared UI fixes.
//
//   node test/browser/ui-fixes-check.mjs [site dir]
//   node test/browser/ui-fixes-check.mjs [site dir] --deal <real deal.json>
//
// With --deal, the Deal of the week checks run against that file (one a CI
// build wrote) instead of the fixture: every market's expected result is
// worked out from the file itself and compared with what the page shows.
// Serves the built site folder with synthetic postings.json and
// property/deal.json (answered by the page's network routes, so nothing is
// written to the site folder), then checks in Chromium, desktop and phone,
// light and dark:
//   - Deal of the week shows the picked market's own deal, an older local
//     deal labeled with its date, or a plain "none" note, never another
//     market's; "All markets" shows the statewide pick; the lookup's side
//     panel follows the market; rapid switching ends on the last pick.
//   - Pill links center their label like pill buttons (Career brief and tour).
//   - Dropdown options have a solid background with readable text.
//   - Jobs rows: bookmark, match score and dates don't overlap, line up
//     across rows, and the phone page doesn't scroll sideways.
// Read-only and offline: everything but the local server is blocked.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const dealAt = args.indexOf('--deal');
const realDealPath = dealAt >= 0 ? args.splice(dealAt, 2)[1] : null;
const siteDir = resolve(args[0] ?? '../site');
const shots = process.env.SHOTS ? resolve(process.env.SHOTS) : null;
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

// ---- Fixtures
const NOW = '2026-10-18T12:00:00Z';
const deal = (o) => ({ week: '2026-10-12', source: 'Test News', publishedAt: '2026-10-14T12:00:00Z', type: 'office', pricePerSqft: null, squareFeet: null, units: null, capRate: null, noi: null, why: null, curated: false, ...o });
const dallas = deal({ title: 'Dallas office tower sells for $210 million', url: 'https://example.com/dallas', city: 'Dallas', place: 'Dallas', price: 210e6, source: 'Dallas Business Journal' });
const sa = deal({ title: 'San Antonio apartment complex with 312 units sells for $48 million', url: 'https://example.com/sa', city: 'San Antonio', place: 'San Antonio', price: 48e6, units: 312, type: 'multifamily' });
const austinOld = deal({ week: '2026-09-21', title: 'Round Rock warehouse sold for $31 million', url: 'https://example.com/rr', city: 'Austin', place: 'Round Rock', price: 31e6, type: 'industrial', publishedAt: '2026-09-23T12:00:00Z' });
const dealFile = {
  generatedAt: NOW,
  assumptions: { office: { low: 7, mid: 8, high: 9.5 }, industrial: { low: 5.25, mid: 6, high: 6.75 }, multifamily: { low: 4.75, mid: 5.25, high: 5.75 }, retail: { low: 6, mid: 6.75, high: 7.5 }, hotel: { low: 7.5, mid: 8.5, high: 9.5 }, land: null, other: { low: 6, mid: 6.75, high: 7.5 } },
  treasury: { value: 4.1, date: '2026-10-16' },
  deal: dallas,
  past: [],
  markets: { Dallas: dallas, 'San Antonio': sa },
  history: [austinOld],
  alsoThisWeek: [{ title: sa.title, url: sa.url, source: sa.source, price: sa.price }]
};
const realDeal = realDealPath ? JSON.parse(await readFile(realDealPath, 'utf8')) : null;

const firms = ['CBRE', 'JLL', 'Transwestern Real Estate Services and Development Partners of North Texas', 'Stewart Title'];
const jobs = Array.from({ length: 16 }, (_, i) => ({
  id: `j${i}`,
  role: i === 1 ? 'Development Analyst, Acquisitions and Capital Markets Group (Multifamily, Industrial and Mixed-Use Investments Across Texas)' : 'Analyst',
  firm: firms[i % firms.length],
  city: ['Houston', 'San Antonio', 'Dallas'][i % 3],
  sector: 'Brokerage',
  kind: 'Full-time',
  pay: i % 3 ? null : '$60,000–$70,000',
  postedAt: new Date(Date.parse(NOW) - (i % 5) * 2 * 864e5).toISOString(),
  deadline: i % 4 ? null : '2026-10-30',
  desc: 'Synthetic test posting.',
  reqs: [],
  applyUrl: `https://example.com/apply/${i}`,
  match: { required: [], requirement: { kind: 'none' } },
  via: i % 5 ? null : 'Adzuna'
}));
const postings = { generatedAt: NOW, boards: { polled: 1, failed: 0 }, cities: ['Houston', 'San Antonio', 'Dallas'], jobs };

let pass = 0;
let fail = 0;
const log = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
async function open(size, theme, hash, { dealDelay = 0 } = {}) {
  const page = await browser.newPage({
    viewport: size === 'phone' ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    colorScheme: theme,
    isMobile: size === 'phone',
    hasTouch: size === 'phone'
  });
  await page.route(/^(?!http:\/\/localhost)/, (route) => route.abort());
  await page.route(/postings\.json/, (route) => route.fulfill({ json: postings }));
  await page.route(/property\/deal\.json/, async (route) => {
    if (dealDelay) await new Promise((r) => setTimeout(r, dealDelay));
    await route.fulfill({ json: realDeal ?? dealFile }).catch(() => {});
  });
  await page.route(/property\/distress\.json/, (route) => route.fulfill({ status: 404 }));
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem('terra-pitch-seen', '1');
    } catch {}
  });
  page.on('pageerror', (e) => log(`${size} ${theme} ${hash}: no page error`, false, e.message));
  await page.goto(base + hash);
  return page;
}
const card = (page) => page.locator('.deal-card, .deal-none').first();

// ---- 1a. Deal of the week against a real deal.json: expectations from the file itself.
if (realDeal) {
  const MARKETS = ['Houston', 'Dallas', 'Fort Worth', 'Austin', 'San Antonio', 'El Paso', 'Lubbock', 'Midland', 'College Station', 'Galveston', 'New Braunfels'];
  const week = new Date(Date.parse(realDeal.generatedAt));
  week.setUTCHours(12, 0, 0, 0);
  week.setUTCDate(week.getUTCDate() - ((week.getUTCDay() + 6) % 7));
  const thisWeek = week.toISOString().slice(0, 10);
  const pool = [...Object.values(realDeal.markets ?? {}), realDeal.deal, ...(realDeal.history ?? []), ...(realDeal.past ?? [])].filter(Boolean);
  const expect = (city) => {
    if (!city) return { status: 'statewide', url: realDeal.deal?.url };
    const mine = pool.filter((d) => d.city === city);
    const now = mine.find((d) => d.week === thisWeek);
    if (now) return { status: 'local', url: now.url, deal: now };
    const old = mine.filter((d) => d.week < thisWeek).sort((a, b) => b.week.localeCompare(a.week))[0];
    return old ? { status: 'older', url: old.url, deal: old } : { status: 'none' };
  };
  const pageDate = (iso) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });
  console.log(`Real deal.json from ${realDeal.generatedAt}, week ${thisWeek}`);
  for (const city of ['', ...MARKETS]) console.log(`  ${city || 'All markets'}: ${JSON.stringify((({ status, url }) => ({ status, url }))(expect(city)))}`);
  for (const [size, theme] of [['desk', 'light'], ['phone', 'dark']]) {
    for (const city of ['', ...MARKETS]) {
      const want = expect(city);
      const name = `real ${size} ${theme}: ${city || 'All markets'} (${want.status})`;
      const page = await open(size, theme, `#property&tool=deal${city ? `&city=${encodeURIComponent(city)}` : ''}`);
      await card(page).waitFor({ timeout: 15000 }).catch(() => {});
      const shown = await page.locator('.deal-card').getAttribute('data-deal-url').catch(() => null);
      const status = await page.locator('.deal-card').getAttribute('data-deal-status').catch(() => null);
      const text = (await card(page).innerText().catch(() => '')).replace(/\s+/g, ' ');
      if (want.status === 'none') {
        log(name, !shown && (await page.locator('.deal-none').count()) === 1 && text.includes(`No verified ${city} sale`), text.slice(0, 120));
      } else {
        const shownDeal = pool.find((d) => d.url === shown);
        const sameMarket = !city || shownDeal?.city === city;
        const reported = want.deal?.publishedAt ? text.includes(pageDate(want.deal.publishedAt)) : true;
        const dated = want.status !== 'older' || (await page.locator('.deal-older-note').innerText()).includes(pageDate(want.deal.week));
        log(name, shown === want.url && status === want.status && sameMarket && reported && dated, `${shownDeal?.city ?? '?'} | ${shownDeal?.title ?? shown}`);
      }
      if (size === 'desk' && theme === 'light' && shots) await page.screenshot({ path: `${shots}/real-deal-${(city || 'all').replace(/\W+/g, '-').toLowerCase()}.png`, fullPage: true });
      await page.close();
    }
  }
  for (const city of ['San Antonio', 'Dallas', 'Houston', 'Lubbock', '']) {
    const want = expect(city);
    const page = await open('desk', 'light', `#property${city ? `&city=${encodeURIComponent(city)}` : ''}`);
    await page.locator('.owner-side-card').waitFor({ timeout: 15000 }).catch(() => {});
    const shown = await page.locator('.owner-side-card').getAttribute('data-deal-url').catch(() => null);
    const text = await page.locator('.owner-side-card').innerText().catch(() => '');
    const ok = want.status === 'none' ? !shown && text.includes(`No ${city} sale`) : shown === want.url;
    log(`real lookup side panel: ${city || 'All markets'} (${want.status})`, ok, text.replace(/\s+/g, ' ').slice(0, 140));
    if (shots) await page.screenshot({ path: `${shots}/real-lookup-${(city || 'all').replace(/\W+/g, '-').toLowerCase()}.png` });
    await page.close();
  }
}

// ---- 1. Deal of the week by market (fixture)
for (const [size, theme] of realDeal ? [] : [['desk', 'light'], ['phone', 'dark']]) {
  const page = await open(size, theme, '#property&tool=deal&city=San%20Antonio');
  await card(page).waitFor();
  const text = async () => (await card(page).innerText()).replace(/\s+/g, ' ');
  log(`${size} ${theme}: San Antonio shows its own deal`, (await card(page).getAttribute('data-deal-url')) === sa.url && !/Dallas/.test(await text()));
  const calc = await page.locator('.deal-card a[href*="#markets&tool=calc"]').getAttribute('href');
  log(`${size} ${theme}: the calculator link carries the deal's market and price`, /taxcity=San(\+|%20)Antonio/.test(calc ?? '') && /price=48000000/.test(calc ?? ''), calc ?? 'no link');
  log(`${size} ${theme}: reported facts are set apart from estimates`, (await page.locator('.deal-reported').count()) === 1 && /teaching estimates/.test(await text()));
  log(`${size} ${theme}: a market page doesn't list other markets' sales`, !(await page.locator('text=Other Texas sales in the news').count()));

  await page.selectOption('#p-city', 'Austin');
  await page.waitForFunction(() => document.querySelector('.deal-card')?.dataset.dealUrl === 'https://example.com/rr');
  log(`${size} ${theme}: Austin offers its older local deal, labeled with its date`, /week of Sep 21, 2026/.test(await page.locator('.deal-older-note').innerText()), await page.locator('.deal-older-note').innerText());

  await page.selectOption('#p-city', 'Lubbock');
  await page.locator('.deal-none').waitFor();
  log(`${size} ${theme}: Lubbock says no local deal instead of showing Dallas`, /No verified Lubbock sale/.test(await text()) && !(await page.locator('.deal-card').count()));

  await page.selectOption('#p-city', '');
  await page.waitForFunction(() => document.querySelector('.deal-card')?.dataset.dealStatus === 'statewide');
  log(`${size} ${theme}: All markets shows the statewide pick`, (await card(page).getAttribute('data-deal-url')) === dallas.url);
  await page.close();
}

// Rapid switching with a slow file: the last pick wins.
if (!realDeal) {
  const page = await open('desk', 'light', '#property&tool=deal&city=Dallas', { dealDelay: 1200 });
  await page.locator('#p-city option').nth(3).waitFor({ state: 'attached' });
  for (const city of ['San Antonio', 'Lubbock', 'Dallas', 'Austin']) await page.selectOption('#p-city', city);
  await page.waitForTimeout(2500);
  const url = await page.locator('.deal-card').getAttribute('data-deal-url').catch(() => null);
  log('rapid market switching ends on the last market picked (Austin)', url === austinOld.url && (await page.locator('.deal-card, .deal-none').count()) === 1, String(url));
  await page.close();
}

// The lookup's side panel follows the market.
for (const [city, want] of realDeal ? [] : [['San Antonio', sa.url], ['Dallas', dallas.url], ['', dallas.url]]) {
  const page = await open('desk', 'light', `#property${city ? `&city=${encodeURIComponent(city)}` : ''}`);
  await page.locator('.owner-side-card').waitFor();
  log(`lookup side panel for ${city || 'All markets'} shows ${want.split('/').pop()}`, (await page.locator('.owner-side-card').getAttribute('data-deal-url')) === want);
  await page.close();
}
if (!realDeal) {
  const page = await open('desk', 'light', '#property&city=Lubbock');
  await page.locator('.owner-side-card').waitFor();
  log('lookup side panel for Lubbock says there is no local deal', /No Lubbock sale/.test(await page.locator('.owner-side-card').innerText()) && !(await page.locator('.owner-side-card[data-deal-url]').count()));
  await page.close();
}

// ---- 2-4. Buttons, dropdowns, Jobs rows
const centered = (page, selector) =>
  page.locator(selector).evaluate((node) => {
    const box = node.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(node);
    const text = range.getBoundingClientRect();
    return { dy: Math.abs(text.top + text.height / 2 - (box.top + box.height / 2)), dx: Math.abs(text.left + text.width / 2 - (box.left + box.width / 2)), h: box.height };
  });
for (const size of ['desk', 'phone']) {
  for (const theme of ['light', 'dark']) {
    const tag = `${size} ${theme}`;
    let page = await open(size, theme, '#career&firm=CBRE');
    await page.locator('.brief-actions a.secondary').waitFor();
    const link = await centered(page, '.brief-actions a.secondary');
    const button = await centered(page, '.brief-actions button.secondary');
    const tops = await page.locator('.brief-actions > *').evaluateAll((n) => n.map((x) => Math.round(x.getBoundingClientRect().top)));
    log(`${tag}: "See its jobs" label is centered and lines up with "Print or save as PDF"`, link.dy <= 1.5 && link.dx <= 1.5 && button.dy <= 1.5 && (size === 'phone' || new Set(tops).size === 1) && link.h >= 40, JSON.stringify({ link, button, tops }));
    await page.close();

    page = await open(size, theme, '');
    await page.locator('#list .card').first().waitFor();
    for (const id of ['firm', 'sector', 'sort']) {
      const o = await page.locator(`#${id}`).evaluate((s) => {
        const cs = getComputedStyle(s.options[s.options.length - 1]);
        return { color: cs.color, bg: cs.backgroundColor };
      });
      const solid = o.bg !== 'rgba(0, 0, 0, 0)' && o.bg !== 'transparent';
      log(`${tag}: #${id} options have a solid background behind their text`, solid && o.color !== o.bg, JSON.stringify(o));
    }
    // Rows with and without a score, New, deadline and source: nothing overlaps and the right edges line up.
    const rows = await page.locator('#list > .card').evaluateAll((cards) =>
      cards.slice(0, 8).map((c) => {
        const r = (n) => n && n.getBoundingClientRect();
        const save = r(c.querySelector('.save'));
        const dates = r(c.querySelector('.dates'));
        const title = r(c.querySelector('.card-title'));
        const overlap = (a, b) => a && b && a.width && b.width && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        return { saveRight: Math.round(save.right), saveTop: Math.round(save.top - r(c).top), clash: !!(overlap(save, dates) || overlap(title, dates) || overlap(title, save)) };
      })
    );
    log(`${tag}: Jobs row bookmarks, dates and titles don't overlap`, rows.every((r) => !r.clash), JSON.stringify(rows.filter((r) => r.clash)));
    log(`${tag}: Jobs row bookmarks sit in the same place on every row`, new Set(rows.map((r) => r.saveRight)).size === 1 && new Set(rows.map((r) => r.saveTop)).size === 1, JSON.stringify(rows));
    log(`${tag}: no sideways page scroll on Jobs`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await page.close();
  }
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
