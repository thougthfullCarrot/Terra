// Calm-pages check (A3 redesign): nothing on a signed-in page follows or tilts with the cursor any more.
//
//   CHROMIUM_PATH=/opt/pw-browsers/chromium node test/browser/calm-check.mjs [site dir]
//
// The night console painted a light under the pointer (#main::before, placed by --mx/--my) and leaned job
// cards toward it. The redesign retired both. This serves the site folder and, on a wide window, a narrow one
// and at 200% zoom, in dark and light, moves the mouse over the Events page and the job list, scrolls and
// switches tabs, then checks that no light is painted, #main carries no pointer position, and no job card is
// transformed. Also covers touch and reduced motion. Read-only; no network besides the local server.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const siteDir = resolve(process.argv[2] ?? '../site');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const raw = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const path = raw.endsWith('/') ? `${raw}index.html` : raw;
  let body;
  try {
    body = await readFile(join(siteDir, path));
  } catch {
    return res.writeHead(404).end();
  }
  res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

let failed = 0;
const check = (ok, m) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${m}`);
};

/** Anything left over from the cursor effects: a painted light, a pointer position on #main, a tilted card. */
const leftovers = (page) =>
  page.evaluate(() => {
    const host = document.getElementById('main');
    const band = getComputedStyle(host, '::before');
    const out = [];
    if (band.display !== 'none' && band.content !== 'none' && band.backgroundImage !== 'none') out.push('a light is painted behind the page');
    if (host.style.getPropertyValue('--mx') || host.style.getPropertyValue('--my')) out.push('#main tracks the pointer');
    for (const card of document.querySelectorAll('#list > .card')) {
      const t = getComputedStyle(card).transform;
      if (t && t !== 'none') {
        out.push(`a job card is transformed (${t})`);
        break;
      }
    }
    if (document.querySelector('.app-topo, .terrain-topo')) out.push('a contour canvas is on the page');
    return out;
  });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
for (const vp of [
  { name: 'wide', width: 1920, height: 1000 },
  { name: 'desktop', width: 1366, height: 900 },
  { name: 'zoom200', width: 683, height: 450, scale: 2 }
]) {
  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.scale ?? 1, colorScheme: theme });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const page = await ctx.newPage();
    await page.goto(`${base}#events`);
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForSelector('#main', { timeout: 20000 });
    const calm = async (step) => {
      const found = await leftovers(page);
      check(!found.length, `${vp.name} ${theme} ${step}: ${found.length ? found.join('; ') : 'nothing follows the cursor'}`);
    };
    const x = Math.round(vp.width * 0.3);
    await page.mouse.move(x, 120);
    await calm('after a move');
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(200);
    await calm('after scrolling');
    await page.evaluate(() => (location.hash = ''));
    await page.waitForTimeout(400);
    const card = await page.$('#list > .card');
    if (card) {
      const box = await card.boundingBox();
      if (box) await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.3);
      await page.waitForTimeout(300);
    }
    await calm('hovering a job card');
    await ctx.close();
  }
}

// Touch: a tap leaves nothing behind.
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
const page = await ctx.newPage();
await page.goto(`${base}#events`);
await page.waitForSelector('#main', { timeout: 20000 });
await page.touchscreen.tap(120, 200);
const touched = await leftovers(page);
check(!touched.length, `phone: a tap leaves ${touched.length ? touched.join('; ') : 'nothing behind'}`);
await ctx.close();

// Reduced motion: still nothing follows the pointer.
const still = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' });
await still.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
const quiet = await still.newPage();
await quiet.goto(`${base}#events`);
await quiet.waitForSelector('#main', { timeout: 20000 });
await quiet.mouse.move(400, 120);
const moved = await leftovers(quiet);
check(!moved.length, `reduced motion: ${moved.length ? moved.join('; ') : 'nothing follows the pointer'}`);
await still.close();

await browser.close();
server.close();
console.log(failed ? `\n${failed} checks failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
