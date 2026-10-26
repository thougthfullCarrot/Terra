// Browser check for the four-feature simplification (Jobs, Development Map, News, Events).
//
//   node test/browser/simplify-check.mjs <site dir> [screenshot dir] [--before]
//
// Serves a built site folder that already holds data files (postings.json,
// market.json, news.json, events.json, property/deal.json; real or synthetic),
// blocks every other host, and in Chromium on desktop and phone, light and dark:
//   - screenshots Jobs, the Development Map, Markets, News, Deal of the week and Events
//     (with --before, the old Property and Career tabs too, and checks nothing else);
//   - checks the navigation offers only the kept sections, and no retired tool chip;
//   - opens every retired URL and checks it lands on a live section with a note,
//     old Deal of the week links keeping their market;
//   - checks Deal of the week under News: the market's own deal, an older local deal
//     with its date, a plain "none" note, the statewide pick, reported facts apart from
//     teaching estimates, source links, and no deal calculator link;
//   - checks a saved job survives a reload, and the phone page never scrolls sideways;
//   - with accounts configured (a fake Supabase that answers "no session"), every
//     section, the deal included, stays behind the sign-in form.
// Read-only and offline.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const before = args.includes('--before');
const [dir, shotDir] = args.filter((a) => !a.startsWith('--'));
const siteDir = resolve(dir ?? '../site');
const shots = shotDir ? resolve(shotDir) : null;
if (shots) await mkdir(shots, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
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

let pass = 0;
let fail = 0;
const log = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const SIZES = { desk: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };

async function open(size, theme, hash, { accounts = false } = {}) {
  const context = await browser.newContext({ viewport: SIZES[size], colorScheme: theme, isMobile: size === 'phone', hasTouch: size === 'phone' });
  const page = await context.newPage();
  await page.route(/^(?!http:\/\/localhost)/, (route) => {
    // The fake Supabase: no one is signed in.
    if (accounts && route.request().url().startsWith('https://fake.supabase.co')) return route.fulfill({ status: 401, json: { error: 'no session' } });
    return route.abort();
  });
  if (accounts) {
    await page.route(/config\.js$/, (route) =>
      route.fulfill({ contentType: 'text/javascript', body: `export const CONFIG = { supabaseUrl: 'https://fake.supabase.co', supabaseAnonKey: 'anon', paymentLink: '', billingPortalLink: '', priceLabel: '', developmentReports: false };` })
    );
  }
  await page.addInitScript((t) => {
    try {
      sessionStorage.setItem('terra-pitch-seen', '1');
      localStorage.setItem('terra-theme', t);
    } catch {}
  }, theme);
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(base + hash);
  await page.waitForTimeout(600);
  return page;
}
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
const shot = async (page, name) => shots && page.screenshot({ path: `${shots}/${before ? 'before' : 'after'}-${name}.png` });

const SECTIONS = [
  ['jobs', '', '#list .card'],
  ['map', '#markets&tool=map', '#m-body .devx, #m-body .state'],
  ['markets', '#markets', '#m-body > *'],
  ['news', '#news', '#n-list .news-item'],
  ['deal', before ? '#property&tool=deal&city=San%20Antonio' : '#news&view=deal&city=San%20Antonio', '.deal-card, .deal-none'],
  ['events', '#events', '#e-list > *'],
  ...(before ? [['property', '#property', '#p-body > *'], ['career', '#career', '#c-body > *']] : [])
];

for (const size of ['desk', 'phone']) {
  for (const theme of ['light', 'dark']) {
    for (const [name, hash, ready] of SECTIONS) {
      const page = await open(size, theme, hash);
      await page.locator(ready).first().waitFor({ timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(400);
      await shot(page, `${name}-${size}-${theme}`);
      if (!before) {
        log(`${size} ${theme} ${name}: draws without a page error`, !page.errors.length, page.errors.join(' | '));
        log(`${size} ${theme} ${name}: content shows`, await visible(page, ready));
        if (size === 'phone') log(`${size} ${theme} ${name}: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
      }
      await page.context().close();
    }
  }
}

if (!before) {
  // ---- Navigation
  {
    const page = await open('desk', 'light', '');
    const tabs = await page.locator('nav.tabs a.tab:not([hidden])').allInnerTexts();
    const names = tabs.map((t) => t.replace(/\d+/g, '').trim());
    log('the tabs are Jobs, Development map, Markets, News, Events', JSON.stringify(names) === JSON.stringify(['Jobs', 'Development map', 'Markets', 'News', 'Events']), JSON.stringify(names));
    log('no Property or Career tab', !(await page.locator('#tab-property, #tab-career').count()));
    await page.goto(`${base}#markets`);
    await page.waitForTimeout(400);
    const chips = await page.locator('#markets-view nav.market-tools a').allInnerTexts();
    log('Markets keeps its other tools and none of the retired ones', JSON.stringify(chips) === JSON.stringify(['City data', 'Development map', 'Lease rates', 'Market reports', 'Zoning alerts', 'Hiring vs. building']), JSON.stringify(chips));
    await page.goto(`${base}#markets&tool=map`);
    await page.waitForTimeout(400);
    log('the Development map tab is marked current on the map', (await page.locator('#tab-map').getAttribute('aria-current')) === 'page' && !(await page.locator('#tab-markets').getAttribute('aria-current')));
    await page.goto(`${base}#news&view=deal`);
    await page.waitForTimeout(400);
    log('Deal of the week is a labeled News section', (await page.locator('#tab-news').getAttribute('aria-current')) === 'page' && (await page.locator('#n-tab-deal').getAttribute('aria-current')) === 'page' && (await page.locator('#n-tab-deal').innerText()) === 'Deal of the week');
    log('the job panel has no Interview brief link', !(await page.locator('#jp-brief').count()));
    const html = await page.content();
    log('no internal link points at a retired tool', !/href="#(property|career)|tool=(compare|calc|uw|sites|pay)\b/.test(html));
    await page.context().close();
  }

  // ---- Old URLs
  const OLD = [
    ['#property&tool=deal&city=Houston', /^#news&view=deal&city=Houston$/, 'Deal of the week has moved to News.'],
    ['#property&tool=deal&city=San%20Antonio', /^#news&view=deal&city=San%20Antonio$/, 'Deal of the week has moved to News.'],
    ['#property&tool=deal', /^#news&view=deal$/, 'Deal of the week has moved to News.'],
    ['#property', /^#markets&tool=map$/, 'retired'],
    ['#property&tool=owner&q=1601%20Elm', /^#markets&tool=map$/, 'Who owns this'],
    ['#property&tool=leases&city=Dallas', /^#markets&tool=map&city=Dallas$/, 'Lease radar'],
    ['#property&tool=distress', /^#markets&tool=map$/, 'Distress'],
    ['#property&tool=drive&city=Houston&lat=29.7&lng=-95.3', /^#markets&tool=map&city=Houston$/, 'Drive time'],
    ['#career', /^$/, 'Career tools'],
    ['#career&tool=brief&firm=CBRE', /^$/, 'Career tools'],
    ['#markets&tool=compare&cities=Dallas,Houston', /^#markets$/, 'Compare cities'],
    ['#markets&tool=calc&price=1000000', /^#markets$/, 'deal calculator'],
    ['#markets&tool=uw', /^#markets$/, 'underwriting model'],
    ['#markets&tool=sites&city=Houston', /^#markets&city=Houston$/, 'Site finder'],
    ['#markets&tool=pay&city=Houston', /^#markets&city=Houston$/, 'Salary check']
  ];
  for (const [hash, want, note] of OLD) {
    const page = await open('phone', 'dark', hash);
    const now = await page.evaluate(() => location.hash);
    const toast = await page.locator('#toast').innerText().catch(() => '');
    const blank = await page.evaluate(() => !document.querySelector('#feed') || [...document.querySelectorAll('#jobs-view, #markets-view, #news-view, #events-view')].every((n) => n.hidden));
    log(`old link ${hash} lands on ${now || '(Jobs)'} with a note`, want.test(now) && toast.includes(note) && !blank && !page.errors.length, `${toast} ${page.errors.join(' | ')}`);
    await page.context().close();
  }
  // An old link followed inside the open page (hashchange) is redirected too.
  {
    const page = await open('desk', 'light', '');
    await page.evaluate(() => (location.hash = '#property&tool=deal&city=Dallas'));
    await page.locator('.deal-card').waitFor({ timeout: 5000 }).catch(() => {});
    log('an in-page old Deal link opens the deal under News on its market', (await page.evaluate(() => location.hash)) === '#news&view=deal&city=Dallas' && (await page.locator('#n-deal-city').inputValue()) === 'Dallas');
    await page.context().close();
  }

  // ---- Deal of the week under News (synthetic deal.json: Dallas statewide, San Antonio local, Austin older, Lubbock none)
  for (const [size, theme] of [['desk', 'light'], ['phone', 'dark']]) {
    const page = await open(size, theme, '#news&view=deal&city=San%20Antonio');
    const card = page.locator('.deal-card, .deal-none').first();
    await card.waitFor();
    const text = async () => (await card.innerText()).replace(/\s+/g, ' ');
    const status = () => page.locator('.deal-card').getAttribute('data-deal-status').catch(() => null);
    log(`${size} ${theme}: San Antonio shows its own deal`, (await page.locator('.deal-card').getAttribute('data-deal-url')) === 'https://example.com/sa' && (await status()) === 'local');
    log(`${size} ${theme}: reported facts are set apart from teaching estimates`, (await page.locator('.deal-reported').count()) === 1 && /teaching estimates/.test(await text()));
    log(`${size} ${theme}: the deal links to its source`, (await page.locator('.deal-title a[href="https://example.com/sa"]').count()) === 1);
    log(`${size} ${theme}: no link to the retired deal calculator`, !(await page.locator('a[href*="tool=calc"]').count()));
    log(`${size} ${theme}: headline filters are hidden on the deal`, !(await visible(page, '#n-topics-group')) && !(await visible(page, '#n-list')));
    await page.selectOption('#n-deal-city', 'Austin');
    await page.waitForFunction(() => document.querySelector('.deal-card')?.dataset.dealUrl === 'https://example.com/rr');
    log(`${size} ${theme}: Austin shows its older deal with its date`, /week of Sep 21, 2026/.test(await page.locator('.deal-older-note').innerText()) && (await page.evaluate(() => location.hash)) === '#news&view=deal&city=Austin');
    await page.selectOption('#n-deal-city', 'Lubbock');
    await page.locator('.deal-none').waitFor();
    log(`${size} ${theme}: Lubbock says there is no local deal`, /No verified Lubbock sale/.test(await text()) && !(await page.locator('.deal-card').count()));
    if (size === 'desk') await shot(page, `deal-none-${size}-${theme}`);
    await page.selectOption('#n-deal-city', '');
    await page.waitForFunction(() => document.querySelector('.deal-card')?.dataset.dealStatus === 'statewide');
    log(`${size} ${theme}: All markets shows the statewide pick`, (await page.locator('.deal-card').getAttribute('data-deal-url')) === 'https://example.com/dallas');
    await page.click('#n-tab-headlines');
    await page.locator('#n-list .news-item').first().waitFor();
    log(`${size} ${theme}: back to Headlines shows the headlines`, (await visible(page, '#n-list .news-item')) && !(await visible(page, '#n-deal')));
    await page.context().close();
  }

  // ---- Saved jobs survive (open site: saved in the browser)
  {
    const page = await open('desk', 'light', '');
    await page.locator('#list .card .save').first().click();
    await page.reload();
    await page.waitForTimeout(600);
    log('a saved job is still saved after a reload', (await page.locator('#saved-count').innerText()) === '1');
    await page.context().close();
  }

  // ---- Sign-in still required
  for (const hash of ['', '#markets&tool=map', '#news', '#news&view=deal&city=Dallas', '#events', '#property&tool=deal&city=Dallas', '#tracker']) {
    const page = await open('desk', 'light', hash, { accounts: true });
    await page.waitForTimeout(800);
    const gate = await visible(page, '#gate');
    const feed = await page.locator('#feed').isHidden();
    const dealShown = await page.locator('.deal-card:visible, #n-list .news-item:visible, #list .card:visible').count();
    log(`signed out ${hash || '(home)'}: only the sign-in page shows`, gate && feed && !dealShown);
    if (!hash) await shot(page, 'signed-out-desk-light');
    await page.context().close();
  }
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
