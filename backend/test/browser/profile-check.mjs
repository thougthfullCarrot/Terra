// Browser check for the Profile page layout.
//
//   node test/browser/profile-check.mjs <site dir> [screenshot dir] [--before]
//
// Serves the site folder (after npm run build:site, for vendor/supabase.js),
// blocks every other host and stands in a fake Supabase with a synthetic
// profile row: empty, partly filled, and complete with a long name and email.
// On desktop, phone and 200% zoom, light and dark, it screenshots the page and
// checks that the completion card stacks heading, bar and one step per row
// without overlap, every open step is clickable, About you is two columns on
// desktop and one on phones with full labels and same-size inputs, the sidebar
// and main column line up, and nothing scrolls sideways. It also saves the
// form (alerts off and on) and walks the open steps with the keyboard.
// With --before it only takes screenshots. Read-only and offline.
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

const now = Date.now();
const day = 86400000;
const iso = (offset) => new Date(now + offset).toISOString();
const DATA = {
  'postings.json': { generatedAt: iso(0), jobs: [] },
  'stats.json': { generatedAt: iso(0), roles: 0, firms: 0, topFirms: [] }
};
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const name = path.replace(/^\//, '');
  if (DATA[name]) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(DATA[name]));
  }
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

const ID = '00000000-0000-4000-8000-000000000001';
const LONG_EMAIL = 'maximiliana.alexandra.montgomery-fitzgerald.realestate@my.utsa.edu';
const ALERTS = { email_alerts: false, alert_cities: [], alert_kinds: [], good_matches_only: false };
const PROFILES = {
  empty: null,
  partial: { id: ID, name: 'Pat Rivera', school: 'University of Texas at San Antonio', grad_year: null, major: null, home_city: null, relocation_open: false, sectors: [], resume_path: null, avatar_path: null, ...ALERTS },
  complete: {
    id: ID,
    name: 'Maximiliana Alexandra Montgomery-Fitzgerald de la Cruz',
    school: 'University of Texas at San Antonio',
    grad_year: new Date().getFullYear() + 1,
    major: 'Real Estate Finance and Development',
    home_city: 'San Antonio',
    relocation_open: true,
    sectors: ['Commercial'],
    resume_path: null,
    avatar_path: null,
    ...ALERTS,
    email_alerts: true
  }
};

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const SIZES = { desk: { width: 1440, height: 900 }, phone: { width: 390, height: 844 }, zoom: { width: 720, height: 450 } };

async function open(size, theme, state, saves = []) {
  const email = state === 'complete' ? LONG_EMAIL : 'pat@gmail.com';
  const user = { id: ID, email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: iso(-day), app_metadata: {}, user_metadata: {} };
  let row = PROFILES[state] ? structuredClone(PROFILES[state]) : null;
  const context = await browser.newContext({ viewport: SIZES[size], deviceScaleFactor: size === 'zoom' ? 2 : 1, colorScheme: theme, isMobile: size === 'phone', hasTouch: size === 'phone' });
  const page = await context.newPage();
  await page.route(/^(?!http:\/\/localhost)/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.host !== 'fake.supabase.co') return route.abort();
    if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user });
    if (url.pathname.startsWith('/auth/')) return route.fulfill({ status: 401, json: { msg: 'no session' } });
    if (url.pathname === '/rest/v1/rpc/access_level') return route.fulfill({ json: 'member' });
    const single = (req.headers().accept ?? '').includes('vnd.pgrst.object');
    if (url.pathname === '/rest/v1/profiles') {
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}');
        saves.push(body);
        row = { ...(row ?? {}), ...body };
        return route.fulfill({ json: single ? row : [row] });
      }
      if (row) return route.fulfill({ json: single ? row : [row] });
    }
    if (url.pathname === '/rest/v1/site_snapshots' && url.searchParams.get('id') === 'eq.current') {
      const snap = { data: DATA['postings.json'] };
      return route.fulfill({ json: single ? snap : [snap] });
    }
    if (single) return route.fulfill({ status: 406, json: { code: 'PGRST116', message: 'no rows', details: null, hint: null } });
    if (url.pathname.startsWith('/storage/')) return route.fulfill({ status: 400, json: { message: 'not found' } });
    return route.fulfill({ json: [] });
  });
  await page.route(/config\.js$/, (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `export const CONFIG = { supabaseUrl: 'https://fake.supabase.co', supabaseAnonKey: 'anon', paymentLink: '', billingPortalLink: '', priceLabel: '', developmentReports: false, watchlists: false };`
    })
  );
  await page.addInitScript(
    ({ t, session }) => {
      try {
        sessionStorage.setItem('terra-pitch-seen', '1');
        localStorage.setItem('terra-theme', t);
        localStorage.setItem('terra.profilePromptDismissed', session.user.id);
        localStorage.setItem('sb-fake-auth-token', JSON.stringify(session));
      } catch {}
    },
    { t: theme, session: { access_token: 'token', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(now / 1000) + 3600, refresh_token: 'refresh', user } }
  );
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(base);
  await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  await page.locator('#account-button').click();
  await page.locator('#profile').waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForTimeout(300);
  return page;
}

/** Layout facts measured in the page. */
const measure = (page) =>
  page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top + scrollY, r: r.right, b: r.bottom + scrollY, w: r.width, h: r.height };
    };
    const $ = (s) => document.querySelector(s);
    const overlaps = (a, b) => a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5;
    const head = box($('.prof-meter-head'));
    const bar = box($('#prof-progress .meter-bar'));
    const items = [...document.querySelectorAll('#prof-steps li')].map(box);
    const parts = [head, bar, ...items];
    let overlap = false;
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) if (overlaps(parts[i], parts[j])) overlap = true;
    const fullBar = bar.w >= head.w - 1;
    const stacked = fullBar && head.b <= bar.y + 0.5 && items.every((it, i) => it.y >= bar.b - 0.5 && (i === 0 || it.y >= items[i - 1].b - 0.5));
    // Every open step: its center hits the button itself.
    const links = [...document.querySelectorAll('#prof-steps .link')];
    const clickable = links.every((a) => {
      a.scrollIntoView({ block: 'center' });
      const r = a.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit === a || a.contains(hit);
    });
    scrollTo(0, 0);
    const fields = [...document.querySelectorAll('#profile-form .fields > label')];
    const cols = new Set(fields.map((f) => Math.round(f.getBoundingClientRect().left))).size;
    const labelsFull = fields.every((f) => {
      const s = f.querySelector('.eyebrow');
      return s.scrollWidth <= s.clientWidth + 1;
    });
    const controls = fields.map((f) => f.querySelector('input,select').getBoundingClientRect());
    const sameHeight = new Set(controls.map((c) => Math.round(c.height))).size === 1;
    const sameWidth = new Set(controls.map((c) => Math.round(c.width))).size === 1;
    const side = box($('.profile-side'));
    const main = box($('.profile-main'));
    const sections = [$('.profile-main .uploads'), $('#profile-form .about'), $('#alert-settings')].map(box);
    const gaps = [sections[1].y - sections[0].b, sections[2].y - sections[1].b].map(Math.round);
    const doc = document.documentElement;
    return {
      overlap,
      stacked,
      clickable,
      links: links.length,
      items: items.length,
      cols,
      labelsFull,
      sameHeight,
      sameWidth,
      sideBySide: side.r <= main.x,
      topAligned: Math.abs(side.y - main.y) <= 1,
      stackedSide: side.b <= main.y,
      gaps,
      noSideScroll: doc.scrollWidth <= doc.clientWidth + 1,
      emailFits: $('#profile-email').scrollWidth <= $('#profile-email').clientWidth + 1,
      nameFits: $('#profile-title').scrollWidth <= $('#profile-title').clientWidth + 1
    };
  });

const STATES = ['empty', 'partial', 'complete'];
for (const size of ['desk', 'phone', 'zoom']) {
  for (const theme of ['light', 'dark']) {
    for (const state of STATES) {
      const tag = `${state}-${size}-${theme}`;
      const page = await open(size, theme, state);
      if (shots) await page.screenshot({ path: `${shots}/${before ? 'before' : 'after'}-${tag}.png`, fullPage: true });
      if (!before) {
        const m = await measure(page);
        log(`${tag}: no page error`, !page.errors.length, page.errors.join(' | '));
        log(`${tag}: completion card is heading, bar, then one step per row`, m.stacked && !m.overlap, JSON.stringify({ stacked: m.stacked, overlap: m.overlap }));
        log(`${tag}: every open step is clickable`, m.clickable, `${m.links} open`);
        log(`${tag}: About you is ${size === 'desk' ? 'two columns' : 'one column'}`, m.cols === (size === 'desk' ? 2 : 1), `${m.cols} columns`);
        log(`${tag}: full field labels, same-size inputs`, m.labelsFull && m.sameHeight && m.sameWidth, JSON.stringify({ labels: m.labelsFull, h: m.sameHeight, w: m.sameWidth }));
        log(`${tag}: sidebar and form ${size === 'desk' ? 'side by side, tops aligned' : 'stacked'}`, size === 'desk' ? m.sideBySide && m.topAligned : m.stackedSide);
        log(`${tag}: equal spacing between Resume, About you and Daily job alerts`, m.gaps[0] === m.gaps[1] && m.gaps[0] > 0, m.gaps.join('/'));
        log(`${tag}: long name and email fit, no sideways scroll`, m.noSideScroll && m.emailFits && m.nameFits);
      }
      await page.context().close();
    }
  }
}

if (!before) {
  // Saving: optional fields and alerts stay optional.
  {
    const saves = [];
    const page = await open('desk', 'light', 'empty', saves);
    await page.fill('input[name="name"]', 'Pat Rivera');
    await page.click('#profile-save');
    await page.waitForTimeout(500);
    const status = await page.locator('#profile-status').innerText();
    log('saving with only a name works, alerts stay off', saves.length === 1 && saves[0].name === 'Pat Rivera' && saves[0].email_alerts === false && status === 'Saved.', status);
    log('the card updates after saving', (await page.locator('#prof-steps li.done').count()) === 1);
    await page.check('input[name="emailAlerts"]');
    await page.click('#profile-save');
    await page.waitForTimeout(500);
    log('turning alerts on saves and confirms', saves.at(-1)?.email_alerts === true && (await page.locator('#profile-status').innerText()).includes('each morning'));
    await page.context().close();
  }
  // Keyboard: Tab reaches each open step; Enter moves focus to its field.
  {
    const page = await open('desk', 'dark', 'partial');
    await page.locator('#profile-close').focus();
    const reached = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const t = await page.evaluate(() => (document.activeElement?.closest('#prof-steps') ? document.activeElement.textContent : ''));
      if (t) reached.push(t);
    }
    const open_ = await page.locator('#prof-steps .link').allInnerTexts();
    log('Tab reaches every open step', open_.every((t) => reached.includes(t)), reached.join(', '));
    await page.locator('#prof-steps .link', { hasText: 'Home city' }).focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    log('Enter on a step focuses its field', await page.evaluate(() => document.activeElement?.name === 'homeCity'));
    const ring = await page.locator('#prof-steps .link').first().evaluate((el) => {
      el.focus();
      const s = getComputedStyle(el);
      return s.outlineStyle !== 'none' || s.boxShadow !== 'none';
    });
    log('focused steps show a focus ring', ring);
    await page.context().close();
  }
}

await browser.close();
server.close();
if (!before) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
