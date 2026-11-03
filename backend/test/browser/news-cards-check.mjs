// Browser check for the News headline cards (layout only).
//
//   node test/browser/news-cards-check.mjs <site dir> [screenshot dir]
//
// Serves the site folder with a synthetic news.json (long headlines, missing source and date, no tags),
// blocks every other host, and on desktop and phone, light and dark, and at 200% zoom checks:
//   - every card has the same border and corner radius, ~24px padding on desktop and ~16px on phones;
//   - source line, headline and tags start at the same left edge, with space between them;
//   - stacked cards never touch; the lead story and the column beside it start at the same top;
//   - the article order matches newest first, links keep their URLs, counts are unchanged;
//   - one-result and no-result states, and the page never scrolls sideways.
// Read-only and offline. Without a screenshot dir it only checks.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const [dir, shotDir] = process.argv.slice(2);
const siteDir = resolve(dir ?? '../site');
const shots = shotDir ? resolve(shotDir) : null;
if (shots) await mkdir(shots, { recursive: true });
const day = (n) => new Date(Date.now() - n * 36e5).toISOString();
const long = 'Developer files plans for a 1.2 million-square-foot mixed-use redevelopment with apartments, Class A office, retail and a hotel on the former industrial site along the river, pending city council zoning approval';
const NEWS = {
  generatedAt: new Date().toISOString(),
  source: 'Google News',
  topics: ['Development', 'Leasing', 'Sales', 'Rare'],
  cities: [
    { city: 'Austin', headlines: [
      { title: long, url: 'https://example.com/a1', source: 'Austin Business Journal', publishedAt: day(1), topics: ['Development'] },
      { title: 'Office tower trades hands downtown', url: 'https://example.com/a2', source: '', publishedAt: '', topics: [] },
      { title: 'Industrial park signs three new tenants near the airport as vacancy tightens', url: 'https://example.com/a3', source: 'Community Impact', publishedAt: day(5), topics: ['Leasing'] },
      { title: 'Supercalifragilisticexpialidocious-unbreakable-hyphenated-headline-word-that-keeps-going-and-going', url: 'https://example.com/a4', source: 'KXAN', publishedAt: day(8), topics: ['Sales', 'Development'] }
    ] },
    { city: 'Dallas', headlines: [
      { title: 'Retail center sells to out-of-state buyer', url: 'https://example.com/d1', source: 'Dallas Morning News', publishedAt: day(3), topics: ['Sales'] },
      { title: 'Office tower trades hands downtown', url: 'https://example.com/a2', source: '', publishedAt: '', topics: [] },
      { title: 'Medical office building breaks ground in Frisco', url: 'https://example.com/d2', source: 'Dallas Business Journal', publishedAt: day(12), topics: ['Development'] },
      { title: 'Apartment developer lines up construction loan for 300 units', url: 'https://example.com/d3', source: 'Bisnow', publishedAt: day(20), topics: ['Development'] }
    ] },
    { city: 'Lubbock', headlines: [{ title: 'Only Lubbock headline: hotel conversion approved', url: 'https://example.com/l1', source: 'KCBD', publishedAt: day(2), topics: ['Rare'] }] }
  ]
};
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/news.json') return res.writeHead(200, { 'content-type': 'application/json' }), res.end(JSON.stringify(NEWS));
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

let pass = 0, fail = 0;
const log = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const SIZES = { desk: { width: 1440, height: 900 }, phone: { width: 390, height: 844 }, zoom200: { width: 720, height: 450 } };

async function open(size, theme, hash) {
  const context = await browser.newContext({ viewport: SIZES[size], colorScheme: theme, deviceScaleFactor: size === 'zoom200' ? 2 : 1, isMobile: size === 'phone', hasTouch: size === 'phone' });
  const page = await context.newPage();
  await page.route(/^(?!http:\/\/localhost)/, (r) => r.abort());
  await page.addInitScript((t) => { try { sessionStorage.setItem('terra-pitch-seen', '1'); localStorage.setItem('terra-theme', t); } catch {} }, theme);
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(base + hash);
  await page.waitForTimeout(700);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  return page;
}

const measure = (page) => page.evaluate(() => {
  const cards = [...document.querySelectorAll('#n-list .news-item')];
  return {
    order: cards.map((c) => c.querySelector('.news-title a')?.href),
    count: document.getElementById('n-count')?.textContent,
    scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    cards: cards.map((c) => {
      const s = getComputedStyle(c), r = c.getBoundingClientRect();
      const parts = [...c.children].map((k) => { const b = k.getBoundingClientRect(); return { left: Math.round(b.left), top: b.top, bottom: b.bottom }; });
      return { lead: c.classList.contains('news-lead'), pad: [parseFloat(s.paddingLeft), parseFloat(s.paddingTop)], border: `${s.borderTopWidth} ${s.borderTopStyle}`, radius: s.borderTopLeftRadius, left: r.left, top: r.top, bottom: r.bottom, right: r.right, parts, inner: r.left + parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft) };
    })
  };
});

for (const size of ['desk', 'phone', 'zoom200']) {
  for (const theme of ['light', 'dark']) {
    const tag = `${size} ${theme}`;
    const page = await open(size, theme, '#news');
    await page.locator('#n-list .news-item').first().waitFor();
    if (shots) await page.screenshot({ path: join(shots, `news-${size}-${theme}.png`), fullPage: size !== 'zoom200' });
    const m = await measure(page);
    const want = size === 'phone' ? 16 : 24;
    log(`${tag}: card padding ~${want}px`, m.cards.every((c) => Math.abs(c.pad[0] - want) <= 2 && Math.abs(c.pad[1] - want) <= 2), JSON.stringify(m.cards.map((c) => c.pad[0])));
    log(`${tag}: one border style and radius`, new Set(m.cards.map((c) => c.border + c.radius)).size === 1, [...new Set(m.cards.map((c) => c.border + ' ' + c.radius))].join(' | '));
    log(`${tag}: meta, headline, tags share a left edge`, m.cards.every((c) => c.parts.every((p) => Math.abs(p.left - c.inner) <= 1)));
    log(`${tag}: space between meta, headline, tags`, m.cards.every((c) => c.parts.every((p, i) => !i || p.top - c.parts[i - 1].bottom >= 6)));
    const rest = m.cards.filter((c) => !c.lead).sort((a, b) => a.top - b.top);
    log(`${tag}: stacked cards don't touch`, rest.every((c, i) => !i || c.top - rest[i - 1].bottom >= 8));
    if (size === 'desk') log(`${tag}: lead and side column top-aligned`, Math.abs(m.cards[0].top - rest[0].top) <= 1);
    log(`${tag}: newest first, links kept`, m.order.join() === ['a1', 'l1', 'd1', 'a3', 'a4', 'd2', 'd3', 'a2'].map((k) => `https://example.com/${k}`).join(), m.order.map((u) => u.slice(-2)).join());
    log(`${tag}: count unchanged`, m.count === '8 headlines across Texas', m.count);
    log(`${tag}: no sideways scroll`, m.scrollX <= 0, String(m.scrollX));
    // Keyboard focus lands on the headline link and is visible.
    await page.locator('#n-list .news-title a').first().focus();
    const ring = await page.evaluate(() => { const c = document.querySelector('#n-list .news-item'); const s = getComputedStyle(c); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0; });
    log(`${tag}: focus ring on the headline card`, ring);
    if (shots && size === 'desk') await page.screenshot({ path: join(shots, `news-${size}-${theme}-focus.png`) });
    log(`${tag}: no page errors`, !page.errors.length, page.errors.join('; '));
    await page.context().close();

    for (const [name, hash, n, text] of [['one result', '#news&city=Lubbock', 1, '1 headline in Lubbock'], ['no results', '#news&city=Dallas&topic=Leasing', 0, '0 headlines in Dallas · Leasing']]) {
      const p = await open(size, theme, hash);
      await p.locator('#n-list > *').first().waitFor();
      const mm = await measure(p);
      log(`${tag}: ${name} shows ${n}`, mm.cards.length === n && mm.count === text, `${mm.cards.length} ${mm.count}`);
      log(`${tag}: ${name} no sideways scroll`, mm.scrollX <= 0);
      if (shots) await p.screenshot({ path: join(shots, `news-${size}-${theme}-${name.replace(' ', '-')}.png`) });
      await p.context().close();
    }
  }
}
// Deal of the week tab still swaps in.
{
  const p = await open('desk', 'light', '#news&view=deal');
  const shown = await p.evaluate(() => !document.getElementById('n-deal').hidden && document.getElementById('n-list').hidden);
  log('Deal of the week still replaces the headlines', shown);
  await p.context().close();
}
await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
