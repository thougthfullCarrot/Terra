/**
 * Measures index lookups in a real browser: headless Chromium fetches a district's gzipped street group from a
 * local static server, unzips it with DecompressionStream, parses it and filters it to one street, the way a
 * static-hosted Property tab would. Network speed is set with Chrome DevTools throttling. Nothing is published.
 *
 *   npx tsx src/bin/appraisal-browser-bench.ts <index dir> [districts]
 */
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const [indexDir, list] = process.argv.slice(2);
if (!indexDir) throw new Error('usage: appraisal-browser-bench <index dir> [districts]');
const districts = (list ?? 'harris,dallas,tarrant,travis,galveston,brazos').split(',');

// Chrome DevTools / Lighthouse presets (throughput in bytes per second).
const PROFILES = [
  { name: 'no throttling (local)', latency: 0, down: -1 },
  { name: 'Slow 4G (150 ms, 1.6 Mbps)', latency: 150, down: (1.6 * 1024 * 1024) / 8 },
  { name: '3G (300 ms, 0.75 Mbps)', latency: 300, down: (750 * 1024) / 8 }
];

const gz = new Map<string, Buffer>();
const server = createServer(async (req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]!).replace(/^\/+/, '');
  if (path === '' || path === 'index.html') {
    res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>bench</title>');
    return;
  }
  const body = gz.get(path);
  if (!body) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
});

async function main(): Promise<void> {
  // Each district's median, 95th-percentile and largest group, by gzipped size.
  const picks: { district: string; label: string; file: string; bytes: number }[] = [];
  for (const d of districts) {
    const dir = join(indexDir!, d);
    const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.json'));
    if (!names.length) continue;
    const sized = await Promise.all(
      names.map(async (n) => {
        const body = gzipSync(await readFile(join(dir, n)));
        return { n, body };
      })
    );
    sized.sort((a, b) => a.body.length - b.body.length);
    const at = (q: number) => sized[Math.min(sized.length - 1, Math.floor(sized.length * q))]!;
    for (const [label, s] of [['p50', at(0.5)], ['p95', at(0.95)], ['max', sized[sized.length - 1]!]] as const) {
      const file = `${d}/${s.n}.gz`;
      gz.set(file, s.body);
      picks.push({ district: d, label, file, bytes: s.body.length });
    }
  }
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const version = browser.version();
  const rows: Record<string, unknown>[] = [];
  try {
    for (const p of PROFILES) {
      const page = await browser.newPage();
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: p.latency, downloadThroughput: p.down, uploadThroughput: p.down });
      await page.goto(`http://127.0.0.1:${port}/`);
      for (const pick of picks) {
        const runs: { fetchMs: number; parseMs: number; rows: number }[] = [];
        for (let i = 0; i < 3; i++) {
          runs.push(
            await page.evaluate(async (url) => {
              const t0 = performance.now();
              const res = await fetch(url);
              const unzipped = res.body!.pipeThrough(new DecompressionStream('gzip'));
              const text = await new Response(unzipped).text();
              const t1 = performance.now();
              const group = JSON.parse(text) as { situs: string | null }[];
              const street = group[0]?.situs?.split(' ').slice(1).join(' ') ?? '';
              const hits = group.filter((r) => r.situs?.endsWith(street));
              void hits;
              return { fetchMs: t1 - t0, parseMs: performance.now() - t1, rows: group.length };
            }, `/${pick.file}`)
          );
        }
        const median = (xs: number[]) => xs.sort((a, b) => a - b)[1]!;
        rows.push({
          profile: p.name,
          district: pick.district,
          group: pick.label,
          gzKB: +(pick.bytes / 1024).toFixed(1),
          rows: runs[0]!.rows,
          downloadAndUnzipMs: Math.round(median(runs.map((r) => r.fetchMs))),
          parseAndMatchMs: Math.round(median(runs.map((r) => r.parseMs))),
          totalMs: Math.round(median(runs.map((r) => r.fetchMs + r.parseMs)))
        });
      }
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`Chromium ${version}`);
  console.table(rows);
  console.log(`BENCH ${JSON.stringify(rows)}`);
}

await main();
