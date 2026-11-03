// Browser check for the Events cards layout (no data or behavior change).
//
//   node test/browser/events-cards-check.mjs <site dir> [screenshot dir] [--write-fixture <path>]
//
// Serves the site folder with a synthetic events.json (short and long titles, a missing venue, an
// unconfirmed time, a multi-session course), blocks every other host, and on desktop, phone and 200% zoom,
// light and dark, checks: same card border, radius and padding as News (~24px desktop, ~16px phone);
// date, event and actions columns top-aligned on desktop, actions under the event on phones with 44px
// targets; titles wrap without touching the date or the buttons; the date text stays inside its box;
// spacing between title, time/place and tags; cards never touch; the mini calendar starts level with the
// first card; order and counts unchanged; no sideways scroll.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const fx = args.indexOf('--write-fixture');
const fixturePath = fx >= 0 ? args.splice(fx, 2)[1] : null;
const [dir, shotDir] = args;
const siteDir = resolve(dir ?? '../site');
const shots = shotDir ? resolve(shotDir) : null;
if (shots) await mkdir(shots, { recursive: true });

// Dates relative to today, at fixed Central times, so the fixture never goes stale.
const dayAt = (d, h, m = 0) => {
  const t = new Date(Date.now() + d * 864e5);
  const ymd = t.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  return `${ymd}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-06:00`;
};
const tz = 'America/Chicago';
const EVENTS = [
  { id: 'short', title: 'Mixer', url: 'https://example.org/s', start: dayAt(2, 17, 30), end: dayAt(2, 19, 30), city: 'Austin', organizer: 'CREW Austin', venue: 'Cafe', cost: null, timezone: tz },
  { id: 'long', title: 'Annual Central Texas Commercial Real Estate Outlook Breakfast and Panel Discussion on Office, Industrial, Multifamily and Retail Capital Markets with Keynote', url: 'https://example.org/l', start: dayAt(4, 7, 30), end: dayAt(4, 10, 0), city: 'Austin', organizer: 'Urban Land Institute Austin District Council', venue: 'The Long Center for the Performing Arts, Rollins Theatre Lobby and Terrace Level Two', address: '701 W Riverside Dr, Austin, TX 78704', cost: '$85', timezone: tz },
  { id: 'novenue', title: 'Young Professionals Happy Hour', url: 'https://example.org/n', start: dayAt(5, 18, 0), end: dayAt(5, 20, 0), city: 'Austin', organizer: 'NAIOP Austin', venue: null, cost: null, timezone: tz },
  { id: 'unconfirmed', title: 'Holiday Party', url: 'https://example.org/h', start: dayAt(6, 0, 0), end: null, city: 'Austin', organizer: 'CREW Austin', venue: 'Urbanspace Interiors', cost: null, timezone: tz, dateOnly: true, timeUnconfirmed: true },
  { id: 'course', title: 'BOMA Foundations of Real Estate Management', url: 'https://example.org/c', start: dayAt(8, 13), end: dayAt(36, 17), city: 'Austin', organizer: 'BOMA Austin', venue: 'BOMA Office', cost: '$450', timezone: tz, enrollment: 'open', registrationUrl: 'https://example.org/c/register', sessions: [{ start: dayAt(8, 13), end: dayAt(8, 17) }, { start: dayAt(22, 13), end: dayAt(22, 17) }, { start: dayAt(36, 13), end: dayAt(36, 17) }] },
  { id: 'dallas', title: 'Dallas Industrial Tour', url: 'https://example.org/d', start: dayAt(3, 9), end: dayAt(3, 12), city: 'Dallas', organizer: 'NAIOP North Texas', venue: 'Bus from Love Field', cost: null, timezone: tz }
];
const EVENTS_FILE = {
  generatedAt: new Date().toISOString(),
  sources: [],
  cities: [{ city: 'Austin', events: EVENTS.filter((e) => e.city === 'Austin') }, { city: 'Dallas', events: EVENTS.filter((e) => e.city === 'Dallas') }],
  report: ['Austin', 'Dallas'].map((city) => ({ city, state: 'events', sourcesChecked: 1, sourcesOk: 1, sourcesFailed: 0, upcoming: EVENTS.filter((e) => e.city === city).length, virtual: 0, duplicatesRemoved: 0, stale: 0, lastVerifiedAt: new Date().toISOString() }))
};
if (fixturePath) {
  await writeFile(fixturePath, JSON.stringify(EVENTS_FILE, null, 1));
  console.log(`wrote ${fixturePath}`);
  process.exit(0);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/events.json') return res.writeHead(200, { 'content-type': 'application/json' }), res.end(JSON.stringify(EVENTS_FILE));
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
  await page.waitForTimeout(800);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  return page;
}

const measure = (page) => page.evaluate(() => {
  const box = (n) => { const r = n.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
  const cards = [...document.querySelectorAll('#e-list .event-card')];
  const side = document.querySelector('.events-side:not([hidden]) .cal');
  return {
    count: document.getElementById('e-count')?.textContent,
    order: cards.map((c) => c.querySelector('.event-title')?.textContent),
    scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    side: side ? box(side) : null,
    cards: cards.map((c) => {
      const s = getComputedStyle(c);
      const date = c.querySelector('.date-block'), body = c.querySelector('.event-body'), acts = c.querySelector('.event-actions');
      const dateKids = [...date.children].map((k) => ({ ...box(k), sw: k.scrollWidth, cw: k.clientWidth }));
      return {
        pad: [parseFloat(s.paddingLeft), parseFloat(s.paddingTop)], border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopLeftRadius}`,
        card: box(c), date: box(date), dateKids, body: box(body), acts: box(acts),
        actItems: [...acts.children].map((k) => box(k)),
        parts: [...body.children].map(box), titleFull: c.querySelector('.event-title').scrollWidth <= c.querySelector('.event-title').clientWidth + 1
      };
    })
  };
});

for (const size of ['desk', 'phone', 'zoom200']) {
  for (const theme of ['light', 'dark']) {
    const tag = `${size} ${theme}`;
    const page = await open(size, theme, '#events&city=Austin');
    await page.locator('#e-list .event-card').first().waitFor();
    if (shots) await page.screenshot({ path: join(shots, `events-${size}-${theme}.png`), fullPage: size !== 'zoom200' });
    const m = await measure(page);
    const want = size === 'phone' ? 16 : 24;
    log(`${tag}: card padding ~${want}px`, m.cards.every((c) => Math.abs(c.pad[0] - want) <= 2 && Math.abs(c.pad[1] - want) <= 2), m.cards.map((c) => c.pad.join('/')).join(' '));
    log(`${tag}: one border and radius`, new Set(m.cards.map((c) => c.border)).size === 1, [...new Set(m.cards.map((c) => c.border))].join(' | '));
    log(`${tag}: date and event top-aligned`, m.cards.every((c) => Math.abs(c.date.t - c.body.t) <= 1));
    log(`${tag}: date text inside its box`, m.cards.every((c) => c.dateKids.every((k) => k.l >= c.date.l - 0.5 && k.r <= c.date.r + 0.5 && k.sw <= k.cw + 1)));
    log(`${tag}: title/body clear of date`, m.cards.every((c) => c.body.l >= c.date.r + 8));
    if (size === 'phone') {
      log(`${tag}: actions under the event`, m.cards.every((c) => c.acts.t >= c.body.b + 8));
      log(`${tag}: 44px touch targets`, m.cards.every((c) => c.actItems.every((a) => a.b - a.t >= 43.5)));
    } else {
      log(`${tag}: actions in their own column, top-aligned`, m.cards.every((c) => c.acts.l >= c.body.r + 8 && Math.abs(c.acts.t - c.body.t) <= 1));
      log(`${tag}: actions column lines up across cards`, new Set(m.cards.map((c) => Math.round(c.acts.l))).size === 1, [...new Set(m.cards.map((c) => Math.round(c.acts.l)))].join(','));
    }
    log(`${tag}: spacing between title, time/place, tags`, m.cards.every((c) => c.parts.every((p, i) => !i || p.t - c.parts[i - 1].b >= 6)));
    log(`${tag}: full titles kept`, m.cards.every((c) => c.titleFull) && m.order.some((t) => t.includes('with Keynote')));
    const sorted = [...m.cards].sort((a, b) => a.card.t - b.card.t);
    log(`${tag}: cards never touch`, sorted.every((c, i) => !i || c.card.t - sorted[i - 1].card.b >= 8));
    if (size === 'desk' && m.side) log(`${tag}: mini calendar top = first card top`, Math.abs(m.side.t - m.cards[0].card.t) <= 1, `${m.side.t} vs ${m.cards[0].card.t}`);
    log(`${tag}: order unchanged`, m.order.join('|') === ['Mixer', EVENTS[1].title, 'Young Professionals Happy Hour', 'Holiday Party', 'BOMA Foundations of Real Estate Management'].join('|'), m.order.join('|').slice(0, 120));
    log(`${tag}: count`, /5 /.test(m.count ?? ''), m.count);
    log(`${tag}: no sideways scroll`, m.scrollX <= 0, String(m.scrollX));
    log(`${tag}: no page errors`, !page.errors.length, page.errors.join('; '));
    await page.context().close();
  }
}
await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
