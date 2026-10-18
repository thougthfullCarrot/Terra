// Browser checks for the Raw Land screen on synthetic data. Skipped when no Chromium is installed
// (set CHROMIUM_PATH, or install with `npx playwright-core install chromium`). The OSM basemap is not needed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Browser, Page } from 'playwright-core';
import { rawlandServer } from '../src/rawland/server.js';
import { synthBuild } from '../src/rawland/synth.js';

let browser: Browser | null = null;
let base = '';
let close = (): void => {};
try {
  const { chromium } = await import('playwright-core');
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
} catch (e) {
  if (process.env.REQUIRE_BROWSER) throw new Error(`REQUIRE_BROWSER is set but Chromium did not launch: ${String(e)}`);
  browser = null;
}

beforeAll(async () => {
  if (!browser) return;
  const srv = rawlandServer(synthBuild());
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/`;
  close = () => srv.close();
});
afterAll(async () => { await browser?.close(); close(); });

async function open(viewport: { width: number; height: number }): Promise<Page> {
  const p = await browser!.newPage({ viewport });
  await p.route(/openstreetmap\.org/, (r) => r.abort());
  await p.goto(base); await p.waitForFunction(() => (globalThis as any).__rawland);
  return p;
}
const select = (p: Page, id: string) => p.evaluate(async (i) => { await (globalThis as any).__rawland.select(i, true); }, id);
type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe.skipIf(!browser && !process.env.REQUIRE_BROWSER)('Raw Land screen (phone, synthetic)', () => {
  const PHONE = { width: 390, height: 844 };

  it('details cover Results/Filters, scroll to the last field, and keep Close reachable', async () => {
    const p = await open(PHONE);
    await select(p, 'SYN-100082');
    expect(await p.isVisible('#side')).toBe(false);
    const d = (await p.locator('#detail').boundingBox())!;
    expect(d.y + d.height).toBeGreaterThanOrEqual(PHONE.height - 1);
    await p.evaluate(() => { const el = (globalThis as any).document.getElementById('detail')!; el.scrollTop = el.scrollHeight; });
    const last = (await p.locator('#detail .fact').last().boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(PHONE.height + 1);
    const c = (await p.locator('#detail .close').boundingBox())!;
    expect(c.y).toBeGreaterThanOrEqual(d.y); expect(c.y + c.height).toBeLessThanOrEqual(d.y + 80);
    await p.click('#detail .close');
    expect(await p.isVisible('#side')).toBe(true);
    await p.close();
  });

  it('map attribution never crosses the detail panel or the results sheet', async () => {
    const p = await open(PHONE);
    const attr = p.locator('.leaflet-control-attribution');
    const side = (await p.locator('#side').boundingBox())!;
    if (await attr.isVisible()) expect(overlaps((await attr.boundingBox())!, side)).toBe(false);
    await select(p, 'SYN-100082');
    const d = (await p.locator('#detail').boundingBox())!;
    if (await attr.isVisible()) expect(overlaps((await attr.boundingBox())!, d)).toBe(false);
    await p.close();
  });

  it('conflicting zoning records are listed separately with the non-additive note', async () => {
    const p = await open(PHONE);
    await select(p, 'SYN-100082');
    expect(await p.locator('#detail .records li').count()).toBe(2);
    expect(await p.textContent('#detail')).toMatch(/do not add up to 100%/);
    await p.close();
  });

  it('unmatched accounts do not say "Matched by account number only"', async () => {
    const p = await open(PHONE);
    await select(p, 'SYN-100004'); // i % 4 === 0 → not matched
    const t = (await p.textContent('#detail'))!;
    expect(t).toContain('account not matched in the city parcel layer; current status unknown');
    expect(t).not.toMatch(/Matched by account number only/);
    await p.close();
  });

  it('unincorporated details name the county classification and the unknown boundary date', async () => {
    const p = await open(PHONE);
    await select(p, 'SYN-100480');
    const t = (await p.textContent('#detail'))!;
    expect(t).toMatch(/JURIS = "Unincorporated"/);
    expect(t).toMatch(/Boundary last updated: unknown/);
    await p.close();
  });

  it('result summaries do not repeat a zoning code', async () => {
    const p = await open({ width: 1440, height: 900 });
    const metas = await p.locator('.row .meta').allTextContents();
    for (const m of metas) { const codes = m.split(' · ').at(-1)!.split(', '); expect(new Set(codes).size).toBe(codes.length); }
    await p.close();
  });
});
