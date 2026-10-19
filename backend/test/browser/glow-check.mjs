// Cursor light check: the glow behind the top of each signed-in page must stay centred on the pointer.
//
//   CHROMIUM_PATH=/opt/pw-browsers/chromium node test/browser/glow-check.mjs [site dir]
//
// Serves the site folder and, on a wide window, a narrow one and at 200% zoom, moves the mouse, then scrolls,
// resizes and switches tabs, and after each step compares the glow's centre (the --mx/--my of #main, measured
// from the #main::before band it paints) with the pointer. Also checks that touch input leaves no glow behind.
// Read-only; no network besides the local server.
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

/** Where the glow is centred, in viewport px, or null when it is off. */
const glowAt = (page) =>
  page.evaluate(() => {
    const host = document.getElementById('main');
    const mx = host.style.getPropertyValue('--mx');
    const my = host.style.getPropertyValue('--my');
    if (!mx || !my) return null;
    const h = host.getBoundingClientRect();
    const band = getComputedStyle(host, '::before');
    return { x: h.left + parseFloat(band.left) + parseFloat(mx), y: h.top + parseFloat(band.top) + parseFloat(my) };
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
    const near = async (step, x, y) => {
      const g = await glowAt(page);
      check(g && Math.abs(g.x - x) <= 1 && Math.abs(g.y - y) <= 1, `${vp.name} ${theme} ${step}: glow at ${g ? `${g.x.toFixed(1)},${g.y.toFixed(1)}` : 'none'}, pointer at ${x},${y}`);
    };
    const x = Math.round(vp.width * 0.3);
    await page.mouse.move(x, 120);
    await near('after a move', x, 120);
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(200);
    await near('after scrolling', x, 120);
    await page.setViewportSize({ width: vp.width - 200, height: vp.height });
    await page.waitForTimeout(200);
    await page.mouse.move(x - 10, 140);
    await near('after a resize', x - 10, 140);
    await page.evaluate(() => (location.hash = '#news'));
    await page.waitForTimeout(300);
    await page.mouse.move(x, 150);
    await near('after switching to News', x, 150);
    await ctx.close();
  }
}

// Touch: a tap fires pointer events but must not leave a glow (or a tilted card) behind.
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
const page = await ctx.newPage();
await page.goto(`${base}#events`);
await page.waitForSelector('#main', { timeout: 20000 });
await page.touchscreen.tap(120, 200);
check(!(await glowAt(page)), 'phone: a tap leaves no cursor glow');
await ctx.close();

// Reduced motion: the light does not follow the pointer.
const still = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' });
await still.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
const quiet = await still.newPage();
await quiet.goto(`${base}#events`);
await quiet.waitForSelector('#main', { timeout: 20000 });
await quiet.mouse.move(400, 120);
check(!(await glowAt(quiet)), 'reduced motion: no glow follows the pointer');
await still.close();

await browser.close();
server.close();
console.log(failed ? `\n${failed} checks failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
