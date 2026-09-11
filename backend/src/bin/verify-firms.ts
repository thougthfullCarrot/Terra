/**
 * Check every seeded firm's ATS slug against the live board.
 *
 * Run this before the first production collect. A wrong slug is a 404, and a
 * collector pointed at 30 wrong slugs produces an empty feed that looks like a
 * clean run — so this is the cheapest high-value thing you can do.
 *
 *   npx tsx src/bin/verify-firms.ts            # check the seed migration
 *   npx tsx src/bin/verify-firms.ts --from-db  # check what is actually in `firms`
 *   npx tsx src/bin/verify-firms.ts --sql      # also print fix-up SQL
 *
 * Needs outbound access to boards-api.greenhouse.io and api.lever.co.
 *
 * Two failures are reported separately, because they need different fixes:
 *   FAIL  the board did not answer   -> wrong slug, fix or drop the firm
 *   EMPTY the board answered with 0 Texas entry-level roles -> slug is fine,
 *         the firm just is not hiring into this funnel right now
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { FirmRow } from '../db/store.js';
import { loadFirmSeed } from '../collector/firmSeed.js';
import { SupabaseStore } from '../db/supabase.js';
import { fetchGreenhouse } from '../collector/sources/greenhouse.js';
import { fetchLever } from '../collector/sources/lever.js';
import { normalize, type RejectReason } from '../collector/normalize.js';

const SEED_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../supabase/migrations/0002_seed_firms.sql'
);

type Verdict = 'OK' | 'EMPTY' | 'FAIL' | 'SKIP';

interface Result {
  firm: FirmRow;
  verdict: Verdict;
  raw: number;
  kept: number;
  rejected: Record<RejectReason, number>;
  error?: string;
}

async function main(): Promise<void> {
  const fromDb = process.argv.includes('--from-db');
  const wantSql = process.argv.includes('--sql');

  const firms = fromDb ? await SupabaseStore.fromEnv().listFirms() : await loadFirmSeed(SEED_PATH);
  if (!firms.length) {
    console.error('No firms found.');
    process.exitCode = 1;
    return;
  }

  console.log(`Checking ${firms.length} firms from ${fromDb ? 'the database' : SEED_PATH}\n`);

  const results: Result[] = [];
  // Four at a time: these are other people's servers.
  for (let i = 0; i < firms.length; i += 4) {
    results.push(...(await Promise.all(firms.slice(i, i + 4).map(check))));
  }

  report(results);

  if (wantSql) printSql(results);

  const failed = results.filter((result) => result.verdict === 'FAIL');
  if (!failed.length) return;

  if (looksLikeNetworkBlock(results)) {
    // Thirty identical transport failures is one problem, not thirty. Saying
    // 'fix your slugs' here would send you rewriting a firm list that is fine.
    console.log(
      '\nEvery board failed the same way. That is an egress problem on this machine, ' +
        'not 30 wrong slugs —\ncheck that boards-api.greenhouse.io and api.lever.co are ' +
        'reachable, then run this again.'
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\n${failed.length} of ${results.length} slugs need fixing before the first run.`);
  process.exitCode = 1;
}

async function check(firm: FirmRow): Promise<Result> {
  const rejected: Record<RejectReason, number> = {
    'missing-fields': 0,
    'not-texas': 0,
    'not-entry-level': 0
  };

  if (firm.ats !== 'greenhouse' && firm.ats !== 'lever') {
    return { firm, verdict: 'SKIP', raw: 0, kept: 0, rejected, error: `${firm.ats} not implemented` };
  }

  try {
    const jobs =
      firm.ats === 'greenhouse'
        ? await fetchGreenhouse(firm.name, firm.atsSlug, { retries: 1 })
        : await fetchLever(firm.name, firm.atsSlug, { retries: 1 });

    let kept = 0;
    for (const job of jobs) {
      const result = normalize(job);
      if (result.ok) kept++;
      else rejected[result.reason]++;
    }

    // A board that answered is a board whose slug is right, even at zero hits.
    return { firm, verdict: kept > 0 ? 'OK' : 'EMPTY', raw: jobs.length, kept, rejected };
  } catch (error) {
    return {
      firm,
      verdict: 'FAIL',
      raw: 0,
      kept: 0,
      rejected,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function report(results: Result[]): void {
  const width = Math.max(...results.map((result) => result.firm.name.length));

  for (const result of results) {
    const line = [
      result.verdict.padEnd(5),
      result.firm.name.padEnd(width),
      result.firm.ats.padEnd(10),
      result.firm.atsSlug.padEnd(24),
      `${String(result.raw).padStart(4)} jobs`,
      `${String(result.kept).padStart(3)} TX entry-level`
    ].join('  ');
    console.log(result.error ? `${line}  — ${result.error}` : line);
  }

  const total = (verdict: Verdict) => results.filter((r) => r.verdict === verdict).length;
  const kept = results.reduce((sum, result) => sum + result.kept, 0);

  console.log(
    `\n${total('OK')} ok · ${total('EMPTY')} reachable but empty · ${total('FAIL')} unreachable · ` +
      `${total('SKIP')} skipped · ${kept} postings would enter the feed today`
  );
}

/**
 * True when every checked firm failed with the same status, which is what a
 * blocked network looks like. A genuinely wrong firm list fails unevenly: some
 * boards answer, and the ones that do not are 404s, not a uniform 403.
 */
function looksLikeNetworkBlock(results: Result[]): boolean {
  const checked = results.filter((result) => result.verdict !== 'SKIP');
  if (checked.length < 3) return false;
  if (checked.some((result) => result.verdict !== 'FAIL')) return false;

  const statuses = new Set(checked.map((result) => result.error?.match(/returned (\d+)/)?.[1] ?? 'transport'));
  return statuses.size === 1 && !statuses.has('404');
}

/** Fix-up SQL for the firms that did not answer, ready to paste and edit. */
function printSql(results: Result[]): void {
  const failed = results.filter((result) => result.verdict === 'FAIL');
  if (!failed.length) return;

  console.log('\n-- Correct these slugs, or deactivate the firms you cannot place:');
  for (const { firm } of failed) {
    console.log(
      `update firms set ats_slug = '<correct-slug>' where name = '${firm.name.replace(/'/g, "''")}';`
    );
  }
  console.log(
    `update firms set active = false where name in (${failed
      .map(({ firm }) => `'${firm.name.replace(/'/g, "''")}'`)
      .join(', ')});`
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
