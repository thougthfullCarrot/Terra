// One-off check of the deployed Development Map after PR #104, as one flagged
// fake test account. Read-only: nothing is saved to the account.
//
//   SUPABASE_URL=… SUPABASE_ANON_KEY=… SERVICE_ROLE_KEY=… node test/browser/live-devmap-check.mjs [shot dir]
//
// On desktop and phone: Houston filters (count and paint time), a shared-spot
// cluster fanning out when zoomed in, a selected pin, and the PDL Club search
// in San Antonio.
import { mkdir } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright-core';

const SITE = 'https://thougthfullcarrot.github.io/Terra/';
const EMAIL = 'maya.patel@example.edu';
const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey, SERVICE_ROLE_KEY: serviceKey } = process.env;
const shots = process.argv[2] ?? null;
if (shots) await mkdir(shots, { recursive: true });
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, noSession);

let pass = 0;
let fail = 0;
const log = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const js = await (await fetch(`${SITE}devmap.js`, { cache: 'no-store' })).text();
log('live devmap.js carries PR #104', js.includes('A draw now makes any one queued by the fit'));
const mv = await (await fetch(`${SITE}markets-view.js`, { cache: 'no-store' })).text();
log('live markets-view.js carries PR #105', mv.includes('snapshot ??= pruneSnapshot(data)'));

// The live data (the members-only site_snapshots rows the page reads), to pick
// a shared spot to fan out and to find PDL Club.
const row = async (id) => {
  const { data: r, error } = await admin.from('site_snapshots').select('data').eq('id', id).maybeSingle();
  if (error || !r) throw new Error(`site_snapshots ${id}: ${error?.message ?? 'missing'}`);
  return r.data;
};
const market = await row('market');
const data = market.developments;
for (const [city, path] of Object.entries(data.files ?? {})) {
  const file = await row(path);
  data.projects = [...data.projects.filter((p) => p.city !== city), ...file.projects];
}
const houston = data.projects.filter((p) => p.city === 'Houston');
const spots = new Map();
for (const p of houston) if (p.lat != null && !p.approximate) spots.set(`${p.lat},${p.lng}`, [...(spots.get(`${p.lat},${p.lng}`) ?? []), p]);
const cluster = [...spots.values()].filter((m) => m.length >= 2 && new Set(m.map((p) => p.name)).size === m.length).sort((a, b) => b.length - a.length)[0];
console.log(`Houston: ${houston.length} projects; shared spot: ${cluster ? `${cluster.length} at ${cluster[0].lat},${cluster[0].lng}` : 'none'}`);
const pdl = [...(data.smaller ?? []), ...data.projects].find((p) => p.id === 'TABS2026006871');
console.log(`PDL Club: ${pdl ? `${(data.smaller ?? []).includes(pdl) ? 'smaller filings' : 'pinned'} ${pdl.city}` : 'not in the live data'}`);

const users = [];
for (let page = 1; page < 20; page++) {
  const { data: d, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  users.push(...d.users);
  if (d.users.length < 200) break;
}
const user = users.find((u) => u.email === EMAIL);
if (!user?.app_metadata?.terra_test_user) throw new Error(`${EMAIL} is not a flagged test account`);

async function session() {
  const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL });
  if (error) throw error;
  const client = createClient(url, anonKey, noSession);
  const { data: d, error: verr } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  if (verr) throw verr;
  return d.session;
}

const ref = new URL(url).hostname.split('.')[0];
const browser = await chromium.launch();

async function open(mobile, city, full = 0) {
  const context = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1366, height: 1000 }, deviceScaleFactor: 2 });
  await context.addInitScript(
    ([key, value, id]) => {
      try {
        sessionStorage.setItem('terra-pitch-seen', '1');
        localStorage.setItem('terra.profilePromptDismissed', id);
        localStorage.setItem(key, value);
      } catch {}
    },
    [`sb-${ref}-auth-token`, JSON.stringify(await session()), user.id]
  );
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  // Which members-only rows the page asked for, and what came back.
  page.on('response', async (r) => {
    if (!r.url().includes('site_snapshots')) return;
    const id = new URL(r.url()).searchParams.get('id');
    let size = '?';
    try { size = (await r.body()).length; } catch {}
    console.log(`  row ${id}: HTTP ${r.status()}, ${size} bytes`);
  });
  page.on('requestfailed', (r) => r.url().includes('site_snapshots') && console.log(`  row request failed: ${new URL(r.url()).searchParams.get('id')} ${r.failure()?.errorText}`));
  page.on('console', (m) => m.type() === 'error' && console.log(`  console error: ${m.text().slice(0, 200)}`));
  await page.goto(`${SITE}?v=${Date.now()}#markets&tool=map&city=${encodeURIComponent(city)}`);
  await page.waitForSelector('.dev-map.leaflet-container', { timeout: 30000 });
  // The biggest projects draw first; the metro's full list follows from its own row.
  if (full) await page.waitForFunction((n) => Number(document.querySelector('.dev-count strong')?.textContent.replace(/,/g, '')) === n, full, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  return page;
}

const count = (page) => page.locator('.dev-count strong').textContent().then((t) => Number(t.replace(/,/g, '')));
const search = async (page, q) => {
  await page.locator('.dev-search input').fill(q);
  await page.waitForTimeout(500);
};

try {
  for (const mobile of [false, true]) {
    const v = mobile ? 'phone' : 'desktop';
    const page = await open(mobile, 'Houston', houston.length);
    const all = await count(page);
    log(`${v}: Houston map lists every project`, all === houston.length, `${all} of ${houston.length}`);
    const specks = Number(await page.locator('.dev-map').getAttribute('data-specks'));
    const pills = await page.locator('.devx-pill-icon').count();
    log(`${v}: price pills and dots drawn`, pills > 0 && specks > 0, `${pills} pills, ${specks} dots`);

    // Filtering: each cost band narrows the list to what the data says, and paints fast.
    const runs = await page.evaluate(async () => {
      const select = document.querySelector('.devx-filters select[aria-label="Estimated cost"]');
      const out = [];
      for (const value of ['under5', '', 'over100', '', '5to25', '']) {
        const t = performance.now();
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(requestAnimationFrame);
        out.push({ value, ms: Math.round(performance.now() - t), n: Number(document.querySelector('.dev-count strong').textContent.replace(/,/g, '')) });
      }
      return out;
    });
    const band = { under5: (c) => c > 0 && c < 5e6, over100: (c) => c >= 1e8, '5to25': (c) => c >= 5e6 && c < 25e6 };
    const counts = runs.every((r) => r.n === (r.value ? houston.filter((p) => band[r.value](p.cost)).length : houston.length));
    log(`${v}: cost filters give the right counts`, counts, runs.map((r) => `${r.value || 'all'} ${r.n}`).join(', '));
    const worst = Math.max(...runs.map((r) => r.ms));
    log(`${v}: filter change paints within 150 ms`, worst < 150, `worst ${worst} ms, all ${runs.map((r) => r.ms).join('/')}`);

    // Selected pin: picking a list row opens the panel and marks its pin.
    // Pick from what the page actually lists (only the biggest load while the full list doesn't).
    const listed = new Set(await page.$$eval('.dev-list .dev-item', (ns) => ns.map((n) => n.dataset.id)));
    const shared = [...spots.values()].filter((m) => m.length >= 2 && m.every((p) => listed.has(p.id)) && new Set(m.map((p) => p.name)).size === m.length).sort((a, b) => b.length - a.length)[0];
    const cluster = shared ?? null;
    console.log(`  ${v}: listed shared spot: ${cluster ? `${cluster.length} projects` : 'none'}`);
    const target = cluster?.[0] ?? houston.find((p) => listed.has(p.id) && p.lat != null && !p.approximate);
    await search(page, target.name);
    await page.locator(`.dev-list .dev-item[data-id="${target.id}"] .dev-pick`).first().click();
    await page.waitForTimeout(1500);
    const chosen = await page.evaluate((id) => [...document.querySelectorAll('.devx-pin-icon.chosen')].map((n) => n.dataset.id).includes(id), target.id);
    const panel = await page.locator('.panel-open').count();
    log(`${v}: selected pin is marked and its panel opens`, chosen && panel > 0, target.name);
    if (shots) await page.screenshot({ path: `${shots}/${v}-selected.png` });

    // Cluster: projects sharing one point fan out with leader lines when zoomed in.
    if (cluster && !mobile) {
      // Clear the search first (that refits the map), then pick a member straight
      // from the full list so the map flies to the cluster and stays there.
      await page.evaluate(() => document.querySelector('[aria-label="Close project details"]')?.click());
      await search(page, '');
      await page.waitForTimeout(1500);
      const row = page.locator(`.dev-list .dev-item[data-id="${cluster[0].id}"] .dev-pick`).first();
      await row.scrollIntoViewIfNeeded();
      await row.click();
      await page.waitForTimeout(2000);
      for (let i = 0; i < 4; i++) {
        await page.locator('.leaflet-control-zoom-in').click();
        await page.waitForTimeout(700);
      }
      const ids = cluster.map((p) => p.id);
      const fanned = await page.evaluate((ids) => {
        const at = [...document.querySelectorAll('.devx-pin-icon')].filter((n) => ids.includes(n.dataset.id));
        const spots = new Set(at.map((n) => n.style.transform));
        return { shown: at.length, spots: spots.size, leaders: document.querySelectorAll('.devx-leader').length };
      }, ids);
      console.log(`  ${v}: cluster check at zoom ${await page.locator('.dev-map').evaluate((n) => n.dataset.drawn + ' drawn, ' + n.dataset.specks + ' dots')}`);
      log(`${v}: shared-spot cluster fans out when zoomed in`, fanned.shown === ids.length && fanned.spots === ids.length && fanned.leaders >= ids.length, `${fanned.shown}/${ids.length} pins, ${fanned.spots} positions, ${fanned.leaders} leader lines`);
      if (shots) await page.screenshot({ path: `${shots}/${v}-cluster.png` });
    }
    log(`${v}: Houston page has no errors`, !page.errors.length, page.errors.join(' | '));
    await page.context().close();

    // PDL Club search in its metro.
    if (pdl) {
      const sa = await open(mobile, pdl.city, data.projects.filter((p) => p.city === pdl.city).length);
      const small = (data.smaller ?? []).includes(pdl);
      for (const q of ['PDL Club', 'TABS2026006871']) {
        await search(sa, q);
        const pinned = await sa.$$eval('.dev-list .dev-item .dev-name', (ns) => ns.map((n) => n.textContent));
        const listed = await sa.$$eval('.dev-smaller-list .dev-name', (ns) => ns.map((n) => n.textContent));
        const hint = await sa.locator('.dev-smaller-hint').evaluate((b) => (b.hidden ? '' : b.textContent)).catch(() => '');
        log(`${v}: search "${q}" finds PDL Club`, small ? Boolean(hint) && listed.includes(pdl.name) : pinned.includes(pdl.name), small ? `hint "${hint}"` : `${pinned.length} listed`);
      }
      if (shots) await sa.screenshot({ path: `${shots}/${v}-pdl.png` });
      log(`${v}: ${pdl.city} page has no errors`, !sa.errors.length, sa.errors.join(' | '));
      await sa.context().close();
    } else log(`${v}: PDL Club is in the live data`, false);
  }
} finally {
  await browser.close();
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
