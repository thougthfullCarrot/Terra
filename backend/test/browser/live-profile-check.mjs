// One-off check of the deployed Profile page, as one flagged fake test account.
//
//   SUPABASE_URL=… SUPABASE_ANON_KEY=… SERVICE_ROLE_KEY=… node test/browser/live-profile-check.mjs [shot dir]
//
// Opens https://thougthfullcarrot.github.io/Terra/ on desktop and phone signed in
// as maya.patel@example.edu (app_metadata.terra_test_user), checks the layout,
// then saves with alerts off and on and reads the row back. The account's
// profile row is restored at the end. No email is sent.
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

const css = await (await fetch(`${SITE}style.css`, { cache: 'no-store' })).text();
log('live style.css carries the new Profile layout', css.includes('Profile layout (profile-check.mjs)'));

const users = [];
for (let page = 1; page < 20; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  users.push(...data.users);
  if (data.users.length < 200) break;
}
const user = users.find((u) => u.email === EMAIL);
if (!user?.app_metadata?.terra_test_user) throw new Error(`${EMAIL} is not a flagged test account`);
const { data: original } = await admin.from('profiles').select('*').eq('id', user.id).maybeSingle();

async function session() {
  const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL });
  if (error) throw error;
  const client = createClient(url, anonKey, noSession);
  const { data, error: verr } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  if (verr) throw verr;
  return data.session;
}

const ref = new URL(url).hostname.split('.')[0];
const browser = await chromium.launch();

async function open(mobile) {
  const context = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1440, height: 900 } });
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
  await page.goto(`${SITE}?v=${Date.now()}`);
  await page.waitForTimeout(3000);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  await page.locator('#account-button').click();
  await page.locator('#profile').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(800);
  return page;
}

const measure = (page) =>
  page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top + scrollY, r: r.right, b: r.bottom + scrollY, w: r.width };
    };
    const $ = (s) => document.querySelector(s);
    const overlaps = (a, b) => a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5;
    const head = box($('.prof-meter-head'));
    const bar = box($('#prof-progress .meter-bar'));
    const items = [...document.querySelectorAll('#prof-steps li')].map(box);
    const parts = [head, bar, ...items];
    let overlap = false;
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) if (overlaps(parts[i], parts[j])) overlap = true;
    const stacked = bar.w >= head.w - 1 && head.b <= bar.y + 0.5 && items.every((it, i) => it.y >= bar.b - 0.5 && (i === 0 || it.y >= items[i - 1].b - 0.5));
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
    const labelsFull = fields.every((f) => f.querySelector('.eyebrow').scrollWidth <= f.querySelector('.eyebrow').clientWidth + 1);
    const controls = fields.map((f) => f.querySelector('input,select').getBoundingClientRect());
    const same = new Set(controls.map((c) => `${Math.round(c.width)}x${Math.round(c.height)}`)).size === 1;
    const side = box($('.profile-side'));
    const main = box($('.profile-main'));
    const sections = [$('.profile-main .uploads'), $('#profile-form .about'), $('#alert-settings')].map(box);
    const gaps = [sections[1].y - sections[0].b, sections[2].y - sections[1].b].map(Math.round);
    const doc = document.documentElement;
    return { overlap, stacked, clickable, items: items.length, cols, labelsFull, same, sideBySide: side.r <= main.x && Math.abs(side.y - main.y) <= 1, stackedSide: side.b <= main.y, gaps, noSideScroll: doc.scrollWidth <= doc.clientWidth + 1 };
  });

try {
  for (const mobile of [false, true]) {
    const tag = mobile ? 'phone' : 'desktop';
    const page = await open(mobile);
    if (shots) await page.screenshot({ path: `${shots}/live-${tag}.png`, fullPage: true });
    const m = await measure(page);
    log(`${tag}: no page error`, !page.errors.length, page.errors.join(' | '));
    log(`${tag}: completion card is heading, bar, then one step per row, no overlap`, m.stacked && !m.overlap, `${m.items} steps`);
    log(`${tag}: every open step is clickable`, m.clickable);
    log(`${tag}: About you is ${mobile ? 'one column' : 'two columns'}`, m.cols === (mobile ? 1 : 2), `${m.cols}`);
    log(`${tag}: full labels, same-size inputs`, m.labelsFull && m.same);
    log(`${tag}: sidebar and form ${mobile ? 'stacked' : 'side by side, tops aligned'}`, mobile ? m.stackedSide : m.sideBySide);
    log(`${tag}: equal spacing between Resume, About you and Daily job alerts`, m.gaps[0] === m.gaps[1] && m.gaps[0] > 0, m.gaps.join('/'));
    log(`${tag}: no sideways scroll`, m.noSideScroll);

    if (!mobile) {
      const row = async () => (await admin.from('profiles').select('email_alerts').eq('id', user.id).maybeSingle()).data;
      await page.uncheck('input[name="emailAlerts"]');
      await page.click('#profile-save');
      await page.waitForTimeout(2500);
      let status = await page.locator('#profile-status').innerText();
      log('save with alerts off: page says Saved.', status === 'Saved.', status);
      log('save with alerts off: row has email_alerts false', (await row())?.email_alerts === false);
      await page.check('input[name="emailAlerts"]');
      await page.click('#profile-save');
      await page.waitForTimeout(2500);
      status = await page.locator('#profile-status').innerText();
      log('save with alerts on: page confirms the morning email', status.includes('each morning'), status);
      log('save with alerts on: row has email_alerts true', (await row())?.email_alerts === true);
    }
    await page.context().close();
  }
} finally {
  await browser.close();
  // Put the test account back the way it was.
  if (original) {
    const { error } = await admin.from('profiles').update(original).eq('id', user.id);
    log('test account profile restored', !error, error?.message ?? `email_alerts=${original.email_alerts}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
