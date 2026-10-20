/**
 * A controlled before/after for the board collector: record every board
 * response once, then run two versions of the collector over exactly the
 * same responses.
 *
 *   npm run board:replay -- --record capture.json                 # live read, saved
 *   npm run board:replay -- --replay capture.json --out head.json  # this checkout's collector
 *   npm run board:replay -- --replay capture.json --code ../base/backend --out base.json
 *   npm run board:replay -- --compare base.json head.json
 *
 * Only official board hosts are recorded (no aggregators). The firm list is
 * read once at record time (Sheet when configured, else seed) and saved with
 * the capture, so both versions read the same boards. A request the capture
 * does not hold is answered 599 and counted, so a version that asks for
 * something new cannot quietly read the live board instead.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FirmRow } from '../db/store.js';
import type { Posting } from '../types.js';
import { loadFirmSeed } from '../collector/firmSeed.js';
import { sheetsClientFromEnv } from '../sheets/env.js';
import { loadFirms } from '../sheets/firms.js';

interface Exchange {
  key: string;
  status: number;
  body: string;
}

interface Capture {
  recordedAt: string;
  firms: FirmRow[];
  exchanges: Exchange[];
}

interface RunSummary {
  code: string;
  replayMisses: number;
  published: { firm: string; role: string; city: string; applyUrl: string; id: string }[];
  review: number;
  rejected: Record<string, number>;
  boards?: { firm: string; status: string; listed?: number; total?: number; kept: number }[];
}

const BOARD_HOSTS = /(^|\.)((boards-api\.)?greenhouse\.io|myworkdayjobs\.com|icims\.com|workable\.com|lever\.co|ashbyhq\.com|smartrecruiters\.com)$/;
const realFetch = globalThis.fetch;

function keyOf(input: string | URL | Request, init?: RequestInit): string {
  const url = String(input instanceof Request ? input.url : input);
  return `${init?.method ?? 'GET'} ${url} ${typeof init?.body === 'string' ? init.body : ''}`;
}

function isBoard(input: string | URL | Request): boolean {
  try {
    return BOARD_HOSTS.test(new URL(String(input instanceof Request ? input.url : input)).hostname);
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };

  const compare = process.argv.indexOf('--compare');
  if (compare >= 0) {
    const [a, b] = await Promise.all([1, 2].map(async (n) => JSON.parse(await readFile(resolve(process.argv[compare + n]!), 'utf8')) as RunSummary));
    console.log(compareRuns(a!, b!));
    return;
  }

  const record = arg('--record');
  const replay = arg('--replay');
  if (record) {
    const firms = (await loadFirms(sheetsClientFromEnv(), await loadFirmSeed(), { write: false })).firms;
    const exchanges = new Map<string, Exchange>();
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const response = await realFetch(input, init);
      if (isBoard(input)) {
        const body = await response.clone().text();
        const key = keyOf(input, init);
        // Retries overwrite: the last answer is the one the collector used.
        exchanges.set(key, { key, status: response.status, body });
      }
      return response;
    }) as typeof fetch;
    const summary = await runWith('.', firms, 0);
    await writeFile(resolve(record), `${JSON.stringify({ recordedAt: new Date().toISOString(), firms, exchanges: [...exchanges.values()] } satisfies Capture)}\n`);
    console.log(`Recorded ${exchanges.size} board responses from ${firms.length} firms; this checkout published ${summary.published.length}.`);
    const out = arg('--out');
    if (out) await writeFile(resolve(out), `${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  if (!replay) throw new Error('Pass --record <file>, --replay <file> or --compare <a> <b>.');

  const capture = JSON.parse(await readFile(resolve(replay), 'utf8')) as Capture;
  const byKey = new Map(capture.exchanges.map((exchange) => [exchange.key, exchange]));
  let misses = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (!isBoard(input)) return new Response('not recorded: replay reads boards only', { status: 599 });
    const hit = byKey.get(keyOf(input, init));
    if (!hit) {
      misses++;
      return new Response('not in the capture', { status: 599 });
    }
    return new Response(hit.body, { status: hit.status });
  }) as typeof fetch;

  const summary = await runWith(arg('--code') ?? '.', capture.firms, 0, () => misses);
  const out = arg('--out');
  if (out) await writeFile(resolve(out), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`${summary.code}: published ${summary.published.length}, review ${summary.review}, replay misses ${summary.replayMisses}.`);
}

/** Run the collector found under `code` (a backend/ directory) against `firms`, with no retry delay. */
async function runWith(code: string, firms: FirmRow[], _retries: number, misses: () => number = () => 0): Promise<RunSummary> {
  const root = resolve(code);
  const run = (await import(pathToFileURL(resolve(root, 'src/collector/run.ts')).href)) as typeof import('../collector/run.js');
  const { MemoryStore } = (await import(pathToFileURL(resolve(root, 'src/db/store.ts')).href)) as typeof import('../db/store.js');
  const store = new MemoryStore(firms);
  const report = await run.runCollector({ store, now: new Date('2026-10-20T12:00:00Z') });
  const published = [...store.postings.values()].map((p: Posting) => ({ firm: p.firm, role: p.role, city: p.city, applyUrl: p.applyUrl, id: p.id }));
  published.sort((a, b) => a.applyUrl.localeCompare(b.applyUrl));
  const boards = (report as { boards?: { firm: string; status: string; listed?: number; total?: number; kept: number }[] }).boards;
  return {
    code: root,
    replayMisses: misses(),
    published,
    review: report.reviewed,
    rejected: report.rejected,
    ...(boards ? { boards: boards.map(({ firm, status, listed, total, kept }) => ({ firm, status, listed, total, kept })) } : {})
  };
}

/** Markdown: counts side by side, then every posting only one version published. */
export function compareRuns(before: RunSummary, after: RunSummary): string {
  const urls = (s: RunSummary) => new Map(s.published.map((p) => [`${p.firm}|${p.applyUrl}`, p]));
  const a = urls(before);
  const b = urls(after);
  const added = [...b.keys()].filter((k) => !a.has(k));
  const removed = [...a.keys()].filter((k) => !b.has(k));
  const reasons = [...new Set([...Object.keys(before.rejected), ...Object.keys(after.rejected)])];
  const lines = [
    '| | Before | After |',
    '|---|---|---|',
    `| Published | ${before.published.length} | ${after.published.length} |`,
    `| Held for review | ${before.review} | ${after.review} |`,
    ...reasons.map((r) => `| Rejected: ${r} | ${before.rejected[r] ?? 0} | ${after.rejected[r] ?? 0} |`),
    `| Replay misses | ${before.replayMisses} | ${after.replayMisses} |`,
    '',
    `Published only after (${added.length}):`,
    ...added.map((k) => `+ ${b.get(k)!.firm} | ${b.get(k)!.role} | ${b.get(k)!.city} | ${b.get(k)!.applyUrl}`),
    '',
    `Published only before (${removed.length}):`,
    ...removed.map((k) => `- ${a.get(k)!.firm} | ${a.get(k)!.role} | ${a.get(k)!.city} | ${a.get(k)!.applyUrl}`)
  ];
  return lines.join('\n');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
