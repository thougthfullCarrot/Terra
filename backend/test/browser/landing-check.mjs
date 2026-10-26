// Browser check for the free-TERRA landing page, signed-in welcome screen and tour.
//
//   node test/browser/landing-check.mjs <site dir> [screenshot dir] [--before]
//
// Serves the site folder (after npm run build:site, for vendor/supabase.js) with
// synthetic data files, blocks every other host, and stands in a fake Supabase:
//   - signed out: the landing page, the free-access section, the FAQ, the tour;
//   - signed in (a stored session, access_level() = 'member'): the welcome screen.
// In Chromium on desktop and phone, light and dark, plus 200% zoom, it screenshots
// each and checks copy, links, the create/sign-in switch, keyboard use, the tour's
// progress, skip and final action, and that nothing scrolls sideways on a phone.
// With --before it only takes screenshots of the old pages.
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

// ---- Synthetic data (no real data is reachable from the sandbox)
const now = Date.now();
const day = 86400000;
const iso = (offset) => new Date(now + offset).toISOString();
const CITIES = ['Dallas', 'Houston', 'Austin', 'San Antonio'];
const jobs = Array.from({ length: 12 }, (_, i) => ({
  id: `job-${i}`,
  role: ['Acquisitions Analyst Intern', 'Leasing Associate', 'Property Management Coordinator', 'Development Analyst'][i % 4],
  firm: ['Firm A', 'Firm B', 'Firm C'][i % 3],
  city: CITIES[i % 4],
  sector: 'Commercial',
  kind: i % 2 ? 'Full time' : 'Internship',
  pay: null,
  postedAt: iso(-i * day),
  deadline: null,
  desc: 'Synthetic posting for the browser check.',
  reqs: [],
  applyUrl: 'https://example.com/apply'
}));
const DATA = {
  'postings.json': { generatedAt: iso(0), jobs },
  'stats.json': { generatedAt: iso(0), roles: jobs.length, firms: 3, topFirms: ['Firm A', 'Firm B', 'Firm C'] },
  'news.json': {
    generatedAt: iso(0),
    topics: [],
    cities: CITIES.map((city) => ({
      city,
      fetchedAt: iso(0),
      headlines: [0, 1].map((n) => ({ title: `${city} headline ${n + 1}`, url: 'https://example.com/n', source: 'Example News', publishedAt: iso(-n * day), topics: [] }))
    }))
  },
  'events.json': {
    generatedAt: iso(0),
    sources: [],
    cities: CITIES.map((city, i) => ({
      city,
      events: [{ id: `ev-${i}`, title: `${city} CRE mixer`, url: 'https://example.com/e', start: iso((i + 3) * day), end: null, city, organizer: 'Example Org', venue: 'Downtown', cost: null }]
    }))
  }
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

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const SIZES = { desk: { width: 1440, height: 900 }, phone: { width: 390, height: 844 }, zoom: { width: 720, height: 450 } };
const USER = { id: '00000000-0000-4000-8000-000000000001', email: 'pat@gmail.com', aud: 'authenticated', role: 'authenticated', email_confirmed_at: iso(-day), app_metadata: {}, user_metadata: {} };

/**
 * Opens the site with accounts configured. `signedIn` stores a session and answers
 * access_level() with `access`; `otp` records sign-in requests for the form checks.
 */
async function open(size, theme, hash = '', { signedIn = false, access = 'member', tour = false, otp = [] } = {}) {
  const context = await browser.newContext({
    viewport: SIZES[size],
    deviceScaleFactor: size === 'zoom' ? 2 : 1,
    colorScheme: theme,
    isMobile: size === 'phone',
    hasTouch: size === 'phone'
  });
  const page = await context.newPage();
  await page.route(/^(?!http:\/\/localhost)/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.host !== 'fake.supabase.co') return route.abort();
    if (url.pathname === '/auth/v1/otp') {
      const body = JSON.parse(req.postData() || '{}');
      otp.push(body);
      if (body.create_user === false) return route.fulfill({ status: 422, json: { code: 422, error_code: 'otp_disabled', msg: 'Signups not allowed for otp' } });
      return route.fulfill({ status: 200, json: {} });
    }
    if (url.pathname === '/auth/v1/user') return signedIn ? route.fulfill({ json: USER }) : route.fulfill({ status: 401, json: { msg: 'no session' } });
    if (url.pathname.startsWith('/auth/')) return route.fulfill({ status: 401, json: { msg: 'no session' } });
    if (url.pathname === '/rest/v1/rpc/access_level') return route.fulfill({ json: signedIn ? access : null });
    const single = (req.headers().accept ?? '').includes('vnd.pgrst.object');
    if (url.pathname === '/rest/v1/site_snapshots' && url.searchParams.get('id') === 'eq.current' && signedIn && access !== 'none') {
      const row = { data: DATA['postings.json'] };
      return route.fulfill({ json: single ? row : [row] });
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
    ({ t, session, tour }) => {
      try {
        if (!tour) sessionStorage.setItem('terra-pitch-seen', '1');
        localStorage.setItem('terra-theme', t);
        localStorage.setItem('terra.profilePromptDismissed', '00000000-0000-4000-8000-000000000001');
        if (session) localStorage.setItem('sb-fake-auth-token', JSON.stringify(session));
      } catch {}
    },
    {
      t: theme,
      tour,
      session: signedIn
        ? { access_token: 'token', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(now / 1000) + 3600, refresh_token: 'refresh', user: USER }
        : null
    }
  );
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(base + hash);
  await page.waitForTimeout(900);
  return page;
}
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
const shot = async (page, name, fullPage = false) => shots && page.screenshot({ path: `${shots}/${before ? 'before' : 'after'}-${name}.png`, fullPage });
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const closeDialog = (page) => page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));

// ---- Screenshots (and per-view checks after the change)
for (const size of ['desk', 'phone', 'zoom']) {
  for (const theme of size === 'zoom' ? ['light', 'dark'] : ['light', 'dark']) {
    const tag = `${size}-${theme}`;
    // Landing, whole page.
    {
      const page = await open(size, theme);
      await page.locator('#gate').waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
      // The landing sections fade in as they scroll into view (live.js); scroll through so the full-page shot has them.
      for (let y = 0; y < 8000; y += 300) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        await page.waitForTimeout(60);
      }
      await page.waitForTimeout(800);
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, `landing-${tag}`, true);
      if (!before) {
        log(`${tag} landing: no page error`, !page.errors.length, page.errors.join(' | '));
        log(`${tag} landing: no sideways scroll`, await noSideScroll(page));
      }
      await page.context().close();
    }
    // Tour: first slide, a feature slide, the last slide.
    {
      const page = await open(size, theme, '?tour', { tour: true });
      await page.locator('#pitch').waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(400);
      await shot(page, `tour-1-${tag}`);
      if (size !== 'zoom') {
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(500);
        await shot(page, `tour-news-${tag}`);
        await page.keyboard.press('End');
        await page.waitForTimeout(500);
        await shot(page, `tour-last-${tag}`);
      }
      if (!before) log(`${tag} tour: no sideways scroll`, await noSideScroll(page));
      await page.context().close();
    }
    // Signed-in welcome screen.
    if (!before) {
      const page = await open(size, theme, '#home', { signedIn: true });
      await closeDialog(page);
      await page.locator('#home-view').waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(500);
      await shot(page, `welcome-${tag}`, true);
      log(`${tag} welcome: shows`, await visible(page, '#home-view'), page.errors.join(' | '));
      log(`${tag} welcome: no sideways scroll`, await noSideScroll(page));
      await page.context().close();
    } else {
      // Before: signed in, a gmail account hits the paywall; a member lands on Jobs.
      const page = await open(size, theme, '', { signedIn: true, access: 'none' });
      await page.waitForTimeout(500);
      await shot(page, `signed-in-gmail-${tag}`);
      await page.context().close();
      const member = await open(size, theme, '', { signedIn: true, access: 'college' });
      await closeDialog(member);
      await member.waitForTimeout(500);
      await shot(member, `signed-in-member-${tag}`);
      await member.context().close();
    }
  }
}

if (!before) {
  // ---- Landing copy and links
  {
    const page = await open('desk', 'light');
    const text = await page.locator('body').innerText();
    log('hero headline', (await page.locator('#gate-title').innerText()) === 'Explore Texas real estate.');
    log('hero lede', (await page.locator('#gate .lede').innerText()).includes('Find jobs, see what’s being built, follow industry news and discover local events—all in one place.'));
    log('hero note', (await page.locator('#gate-lede').innerText()) === 'Free to use. Create an account to get started.');
    log('main actions are Create free account and Sign in', (await page.locator('#mode-create').innerText()) === 'Create free account' && (await page.locator('#mode-signin').innerText()) === 'Sign in');
    log('free-access section', (await page.locator('#free-title').innerText()) === '$0. For anyone.');
    const nav = await page.locator('nav.landing-nav a').allInnerTexts();
    log('no Pricing in the landing nav', !nav.some((t) => /pric/i.test(t)), JSON.stringify(nav));
    for (const href of await page.locator('nav.landing-nav a').evaluateAll((as) => as.map((a) => a.getAttribute('href')))) {
      log(`landing nav ${href} has a target`, (await page.locator(href).count()) === 1);
    }
    const banned = /\.edu|college email|subscri|upgrade|\$\d|per month|\/month|pricing|salary check|compare cities|calculator|underwriting|site finder|who owns this|lease radar|drive time|career tools|property tools/i;
    const visibleHit = text.match(banned);
    log('no pricing, .edu, upgrade or retired-tool copy on the landing page', !visibleHit, visibleHit?.[0]);
    const tourText = await page.locator('#pitch').evaluate((n) => n.textContent);
    const tourHit = tourText.match(banned);
    log('no pricing, .edu or retired-tool copy in the tour', !tourHit, tourHit?.[0]);
    const meta = await page.evaluate(() => [document.title, ...[...document.querySelectorAll('meta[name=description], meta[property^="og:"]')].map((m) => m.content)].join(' '));
    log('title and share metadata match the four features and free access', /Explore Texas real estate/.test(meta) && !/students|\.edu/i.test(meta), meta.slice(0, 120));
    log('feature previews name the four features', JSON.stringify(await page.locator('.core-features h3').allInnerTexts()) === JSON.stringify(['Jobs', 'Development map', 'News', 'Events']));
    log('Deal of the week is explained within News', (await page.locator('.core-features .feature').nth(2).innerText()).includes('Deal of the week'));
    log('no app content for a signed-out visitor', !(await visible(page, '#feed')) && !(await visible(page, '#home-view')) && !(await visible(page, '#tab-home')));
    await page.context().close();
  }

  // ---- Create account vs sign in
  {
    const otp = [];
    const page = await open('desk', 'light', '', { otp });
    await page.fill('#signin-email', 'lee@gmail.com');
    await page.click('#signin-submit');
    await page.waitForTimeout(500);
    log('a non-.edu email can create an account', otp.length === 1 && otp[0].create_user === true && (await visible(page, '#verify')), JSON.stringify(otp[0] ?? {}));
    log('the code message asks for nothing else', /We emailed a code to lee@gmail\.com/.test(await page.locator('#signin-status').innerText()) && !/subscri|college/i.test(await page.locator('#signin-status').innerText()));
    await page.context().close();

    const otp2 = [];
    const page2 = await open('desk', 'light', '', { otp: otp2 });
    await page2.click('#mode-signin');
    log('Sign in switches the button wording', (await page2.locator('#signin-submit').innerText()) === 'Email me a sign-in code' && (await page2.locator('#mode-signin').getAttribute('aria-pressed')) === 'true');
    await page2.fill('#signin-email', 'new@gmail.com');
    await page2.click('#signin-submit');
    await page2.waitForTimeout(500);
    log('Sign in never creates an account', otp2.length === 1 && otp2[0].create_user === false);
    log('an unknown email on Sign in points to Create free account', /Create free account/.test(await page2.locator('#signin-status').innerText()), await page2.locator('#signin-status').innerText());
    await page2.click('#welcome-start');
    log('the bottom Create free account button returns to create mode', (await page2.locator('#signin-submit').innerText()) === 'Create free account');
    await page2.click('#signin-jump');
    log('the header Sign in button switches to sign-in mode', (await page2.locator('#mode-signin').getAttribute('aria-pressed')) === 'true');
    await page2.context().close();
  }

  // ---- Keyboard on the landing page
  {
    const page = await open('desk', 'light');
    const seen = [];
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      seen.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.textContent?.trim().slice(0, 30)));
    }
    log('Tab reaches the create/sign-in switch, the email field and the submit button', ['mode-create', 'mode-signin', 'signin-email', 'signin-submit'].every((id) => seen.includes(id)));
    const ring = await page.evaluate(() => {
      document.getElementById('mode-signin').focus();
      return getComputedStyle(document.getElementById('mode-signin')).outlineStyle;
    });
    log('the switch shows a focus ring', ring !== 'none');
    await page.context().close();
  }

  // ---- Tour: progress, skip, keyboard, final action (signed out and signed in)
  {
    const page = await open('desk', 'light', '?tour', { tour: true });
    log('tour opens from ?tour', await visible(page, '#pitch'));
    const total = await page.locator('#pitch .pitch-slide').count();
    log('tour is six slides: welcome, four features, get started', total === 6, String(total));
    log('progress starts at 1 / 6', (await page.locator('#pitch-count').innerText()) === '1 / 6');
    await page.keyboard.press('ArrowRight');
    log('ArrowRight moves on and the bar grows', (await page.locator('#pitch-count').innerText()) === '2 / 6' && Math.abs(parseFloat(await page.locator('#pitch-progress').evaluate((n) => n.style.width)) - (2 / 6) * 100) < 0.1);
    const labels = await page.locator('#pitch .pitch-slide').evaluateAll((s) => s.map((n) => n.getAttribute('aria-label')));
    log('slide order', JSON.stringify(labels) === JSON.stringify(['1 of 6: Welcome', '2 of 6: Jobs', '3 of 6: Development map', '4 of 6: News and Deal of the week', '5 of 6: Events', '6 of 6: Get started']), JSON.stringify(labels));
    await page.keyboard.press('End');
    log('last slide offers Create free account and Sign in', (await page.locator('#pitch-start').innerText()) === 'Create free account' && (await visible(page, '#pitch-signin')));
    await page.click('#pitch-signin');
    await page.waitForTimeout(400);
    log('the tour Sign in closes it and opens the form in sign-in mode', !(await visible(page, '#pitch')) && (await page.locator('#mode-signin').getAttribute('aria-pressed')) === 'true');
    log('closing removes ?tour from the address', !page.url().includes('tour'));
    await page.context().close();

    const skip = await open('phone', 'dark', '', { tour: true });
    log('the tour opens once for a signed-out visitor', await visible(skip, '#pitch'));
    await skip.click('#pitch-skip');
    log('Skip the tour closes it', !(await visible(skip, '#pitch')));
    await skip.reload();
    await skip.waitForTimeout(800);
    log('and it stays closed for the rest of the visit', !(await visible(skip, '#pitch')));
    await skip.context().close();

    const esc = await open('desk', 'dark', '?tour', { tour: true });
    await esc.keyboard.press('Escape');
    log('Escape closes the tour', !(await visible(esc, '#pitch')));
    await esc.context().close();

    const member = await open('desk', 'light', '#home', { signedIn: true });
    await closeDialog(member);
    await member.click('#home-tour');
    await member.waitForTimeout(300);
    await member.keyboard.press('End');
    log('signed in, the tour ends with Go to my welcome screen and no sign-in', (await member.locator('#pitch-start').innerText()) === 'Go to my welcome screen' && !(await visible(member, '#pitch-signin')));
    await member.goto(`${base}#jobs`);
    await member.waitForTimeout(500);
    await member.evaluate(() => document.getElementById('home-tour').click());
    await member.keyboard.press('End');
    await member.click('#pitch-start');
    await member.waitForTimeout(400);
    log('which goes to #home', new URL(member.url()).hash === '#home' && (await visible(member, '#home-view')));
    await member.context().close();
  }

  // ---- Welcome screen
  {
    const page = await open('desk', 'light', '#home', { signedIn: true });
    await closeDialog(page);
    await page.waitForTimeout(400);
    const hrefs = await page.locator('.home-cards a').evaluateAll((as) => as.map((a) => [a.querySelector('.home-card-title').textContent, a.getAttribute('href')]));
    log('four entry cards linking to each feature', JSON.stringify(hrefs) === JSON.stringify([['Jobs', '#'], ['Development map', '#markets&tool=map'], ['News', '#news'], ['Events', '#events']]), JSON.stringify(hrefs));
    log('Deal of the week link goes to News', (await page.locator('#home-deal').getAttribute('href')) === '#news&view=deal');
    log('jobs count is the real number in the feed', (await page.locator('#home-jobs-count').innerText()) === `${jobs.length} open roles listed now`, await page.locator('#home-jobs-count').innerText());
    log('news count is the real number of headlines', (await page.locator('#home-news-count').innerText()) === '8 headlines in the latest update');
    log('events count is the real number of upcoming events', (await page.locator('#home-events-count').innerText()) === '4 upcoming events listed');
    log('the map card claims no count', !(await page.locator('#home-map .home-card-count').count()));
    log('Home tab is shown and current', (await page.locator('#tab-home').getAttribute('aria-current')) === 'page');
    log('Profile, saved jobs and the tour are reachable', (await visible(page, '#home-profile')) && (await visible(page, '#home-saved')) && (await visible(page, '#home-tour')));
    await page.click('#home-map');
    await page.waitForTimeout(500);
    log('the map card opens the Development map', new URL(page.url()).hash === '#markets&tool=map' && (await visible(page, '#markets-view')) && !(await visible(page, '#home-view')));
    await page.goto(`${base}#home`);
    await page.waitForTimeout(500);
    await page.click('#home-news');
    await page.waitForTimeout(400);
    log('the news card opens News', await visible(page, '#news-view'));
    await page.goto(`${base}#home`);
    await page.waitForTimeout(500);
    await page.click('#home-profile');
    await page.waitForTimeout(400);
    log('Profile opens the profile page', await visible(page, '#profile'));
    log('the profile says Free account', (await page.locator('#profile-access').innerText()) === 'Free account');
    await page.context().close();

    const tab = await open('desk', 'light', '#home', { signedIn: true });
    await closeDialog(tab);
    await tab.keyboard.press('Tab');
    const order = [];
    for (let i = 0; i < 40; i++) {
      order.push(await tab.evaluate(() => document.activeElement?.id || ''));
      await tab.keyboard.press('Tab');
    }
    log('Tab reaches every welcome card', ['home-jobs', 'home-map', 'home-news', 'home-events', 'home-deal', 'home-profile', 'home-saved'].every((id) => order.includes(id)), order.filter(Boolean).join(','));
    await tab.context().close();

    const plain = await open('desk', 'light', '', { signedIn: true });
    await closeDialog(plain);
    log('a reload with no section keeps Jobs (only a fresh sign-in starts on Home)', await visible(plain, '#jobs-view'));
    await plain.context().close();
  }

  // ---- Unopened account
  {
    const page = await open('desk', 'light', '', { signedIn: true, access: 'none' });
    log('an account the database has not opened sees no app and no payment ask', (await visible(page, '#paywall')) && !(await visible(page, '#feed')) && !/subscri|\$|pay/i.test(await page.locator('#paywall').innerText()));
    await page.context().close();
  }
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
