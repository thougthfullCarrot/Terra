/**
 * Development collection and location audit: a dry run that reads public
 * sources and writes local files only. It never writes to Supabase, the Sheet
 * or the site.
 *
 *   npm run audit:developments -- [--out dir] [--cache dir] [--previous market.json]
 *     [--markets "San Antonio,Austin"] [--max-pages 3000] [--max-searches 2000]
 *     [--max-geocodes 4000] [--max-minutes 100] [--trace TABS...,TABS...]
 *
 * Every search, page, geocode and city read is cached under --cache, so a run
 * that stops (time limit, budget, a crash) picks up where it left off when run
 * again the same day; pages and geocodes carry over across days.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIT_MARKETS, auditBudget, auditMarket, marketReport, summaryReport, toDevelopments, traceLines, type AuditCache, type MarketAudit, type RefreshKind } from '../market/devAudit.js';
import { fetchZipCenters, type DevelopmentsResult } from '../market/developments.js';
import type { City } from '../types.js';

const here = dirname(fileURLToPath(import.meta.url));
const flag = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const num = (name: string, fallback: number) => Number(flag(name) ?? fallback);

/** The Merc's two filings and PDL Club (Rod's reports of 2026-10-14 and 2026-10-15). */
export const DEFAULT_TRACE = ['TABS2025017471', 'TABS2025017477', 'TABS2026006871'];

export function fileCache(dir: string): AuditCache {
  const path = (key: string) => {
    const [kind = 'misc'] = key.split('/');
    return join(dir, kind, `${createHash('sha1').update(key).digest('hex')}.json`);
  };
  return {
    async get<T>(key: string) {
      try {
        return (JSON.parse(await readFile(path(key), 'utf8')) as { value: T }).value;
      } catch {
        return undefined;
      }
    },
    async set(key, value) {
      const file = path(key);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify({ key, value, savedAt: new Date().toISOString() }));
    },
    async savedAt(key) {
      // Entries written before savedAt was recorded fall back to the file's time, which actions/cache keeps.
      try {
        const entry = JSON.parse(await readFile(path(key), 'utf8')) as { savedAt?: string };
        return entry.savedAt ?? (await stat(path(key))).mtime.toISOString();
      } catch {
        return undefined;
      }
    }
  };
}

const slug = (city: string) => city.toLowerCase().replace(/\W+/g, '-');

async function main(): Promise<void> {
  const started = Date.now();
  const out = resolve(flag('--out') ?? join(here, '../../../dev-audit-output'));
  const cache = fileCache(resolve(flag('--cache') ?? join(out, '.cache')));
  const markets = (flag('--markets')?.split(',').map((m) => m.trim()) ?? AUDIT_MARKETS) as City[];
  const trace = flag('--trace')?.split(',') ?? DEFAULT_TRACE;
  // --refresh search,city re-asks TDLR and the cities instead of using cached answers (a fresh verification run).
  const refresh = (flag('--refresh')?.split(',').filter(Boolean) ?? []) as RefreshKind[];
  // The day the run started, so a resumed run asks TABS for the same windows.
  const now = new Date(`${new Date().toISOString().slice(0, 10)}T12:00:00Z`);
  const budget = auditBudget({
    pages: num('--max-pages', 3000),
    searches: num('--max-searches', 2000),
    geocodes: num('--max-geocodes', 4000),
    deadline: started + num('--max-minutes', 100) * 60_000,
    pauseMs: num('--pause-ms', 300)
  });
  let previous: DevelopmentsResult | undefined;
  const prevPath = flag('--previous');
  if (prevPath) {
    try {
      previous = (JSON.parse(await readFile(resolve(prevPath), 'utf8')) as { developments?: DevelopmentsResult }).developments;
      console.log(`previous build: ${previous?.projects.length ?? 0} projects, ${previous?.smaller?.filter((s) => s.paged).length ?? 0} paged smaller filings`);
    } catch (error) {
      console.log(`previous build not read (${error instanceof Error ? error.message : String(error)}); every page is read fresh`);
    }
  }
  let zipCenters = new Map<string, [number, number]>((await cache.get<[string, [number, number]][]>('zip/centers')) ?? []);
  if (!zipCenters.size) {
    zipCenters = await fetchZipCenters(now).catch(() => new Map());
    if (zipCenters.size) await cache.set('zip/centers', [...zipCenters]);
  }
  console.log(`ZIP centers: ${zipCenters.size}`);

  await mkdir(out, { recursive: true });
  const audits: MarketAudit[] = [];
  for (const [i, market] of markets.entries()) {
    const t = Date.now();
    // Each market gets an equal share of the pages still left, so the first big metro can't use them all;
    // what it leaves unused goes on to the next.
    const pagesLeft = budget.pages;
    budget.pages = Math.floor(pagesLeft / (markets.length - i));
    const share = budget.pages;
    const a = await auditMarket(market, { now, cache, budget, trace, refresh, previous: { projects: previous?.projects, smaller: previous?.smaller }, zipCenters, log: (l) => console.log(l) });
    budget.pages = pagesLeft - (share - budget.pages);
    if (!a.counties.length) {
      console.log(`${market}: no TABS counties configured; skipped`);
      continue;
    }
    audits.push(a);
    const asOf = now.toISOString().slice(0, 10);
    await writeFile(join(out, `${slug(market)}.md`), marketReport(a, { asOf, now, traces: trace }));
    await writeFile(join(out, `${slug(market)}.json`), JSON.stringify({ market, records: a.records, duplicates: a.duplicates, exclusions: a.exclusions }, null, 1));
    console.log(`${market}: ${a.records.length} developments, ${((Date.now() - t) / 60_000).toFixed(1)} min`);
  }
  const asOf = now.toISOString().slice(0, 10);
  const minutes = (Date.now() - started) / 60_000;
  const traces = ['# Traces', '', ...trace.flatMap((id) => traceLines(id, audits, now))].join('\n');
  await writeFile(join(out, 'traces.md'), traces);
  await writeFile(join(out, 'summary.md'), summaryReport(audits, { asOf, budget, minutes, markets }));
  await writeFile(join(out, 'run.json'), JSON.stringify({ asOf, minutes, used: budget.used, left: { searches: budget.searches, pages: budget.pages, geocodes: budget.geocodes } }, null, 1));
  // A copy of the site's market.json with the map's developments replaced by the audit's, for a preview build.
  const previewFrom = flag('--preview-from');
  if (previewFrom) {
    try {
      const market = JSON.parse(await readFile(resolve(previewFrom), 'utf8')) as { developments?: DevelopmentsResult };
      const projects = audits.flatMap(toDevelopments);
      market.developments = {
        ...(market.developments ?? {}),
        asOf: now.toISOString(),
        projects,
        smaller: [],
        waiting: 0,
        metros: audits.map((a) => ({ city: a.market, filings: a.eligible, cap: a.records.length, cutoff: null, complete: a.complete, reported: a.reported, skippedWindows: 0 }))
      };
      const target = resolve(flag('--preview-out') ?? join(out, 'market-preview.json'));
      await writeFile(target, JSON.stringify(market));
      console.log(`preview market data: ${projects.length} developments -> ${target}`);
    } catch (error) {
      console.log(`preview not written (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  console.log(`wrote ${out} in ${minutes.toFixed(1)} min`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
