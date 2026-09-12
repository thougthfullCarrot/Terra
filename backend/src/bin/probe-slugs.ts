/**
 * Find each firm's real ATS board by asking, instead of guessing.
 *
 * The seeded slugs scored 0 for 30 — not near misses, a clean sweep across both
 * Greenhouse and Lever. That pattern says the firms were assigned the wrong ATS
 * rather than a misspelled slug, so this probes three things per firm:
 *
 *   1. Greenhouse, for every plausible slug
 *   2. Lever, for every plausible slug
 *   3. Workday, for whether a tenant host exists at all
 *
 * Workday is only half-answerable this way: the tenant host is guessable, the
 * site name inside it is not. A hit therefore reports "this firm is on Workday,
 * tenant X" and leaves the site to be read off their careers page — which is
 * still the difference between a research task and a dead end.
 *
 *   npm run probe:slugs                 # every firm in the seed migration
 *   npm run probe:slugs -- --sql        # also print fix-up SQL for the hits
 *   npm run probe:slugs -- --limit 4    # fewer candidates per firm
 *
 * Needs outbound access to boards-api.greenhouse.io, api.lever.co and
 * *.myworkdayjobs.com. Run it from the "Probe ATS boards" workflow.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadFirmSeed } from '../collector/firmSeed.js';
import { slugCandidates } from '../collector/slugCandidates.js';

const SEED_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../supabase/migrations/0002_seed_firms.sql'
);

/** Workday spreads tenants across numbered hosts; these cover almost all of them. */
const WORKDAY_HOSTS = [1, 3, 5, 12, 101];

const USER_AGENT = 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)';

interface Hit {
  ats: 'greenhouse' | 'lever' | 'workday';
  slug: string;
  /** Jobs on the board, or null when the count is not knowable (Workday). */
  jobs: number | null;
  host?: string;
}

interface Result {
  firm: string;
  hit: Hit | null;
  tried: number;
}

async function main(): Promise<void> {
  const limit = argValue('--limit', 8);
  const wantSql = process.argv.includes('--sql');

  const firms = await loadFirmSeed(SEED_PATH);
  if (!firms.length) {
    console.error('No firms found in the seed migration.');
    process.exitCode = 1;
    return;
  }

  console.log(`Probing ${firms.length} firms, up to ${limit} slug candidates each.\n`);

  const results: Result[] = [];
  // Two firms at a time. These are public APIs answering for free; a burst of
  // 400 parallel requests is how you get rate limited and learn nothing.
  for (let i = 0; i < firms.length; i += 2) {
    const batch = await Promise.all(
      firms.slice(i, i + 2).map((firm) => probe(firm.name, limit))
    );
    for (const result of batch) {
      report(result);
      results.push(result);
    }
  }

  summarize(results);
  if (wantSql) printSql(results);

  // A run that finds nothing is a real answer, not an error: it means these
  // firms are not on the platforms this collector can read.
  if (!results.some((result) => result.hit)) process.exitCode = 1;
}

async function probe(firm: string, limit: number): Promise<Result> {
  const candidates = slugCandidates(firm, limit);
  let tried = 0;

  for (const slug of candidates) {
    tried++;
    const greenhouse = await checkGreenhouse(slug);
    if (greenhouse) return { firm, hit: greenhouse, tried };

    const lever = await checkLever(slug);
    if (lever) return { firm, hit: lever, tried };
  }

  // Only the two strongest candidates get the Workday sweep — five hosts each
  // is already a lot of requests for a maybe.
  for (const slug of candidates.slice(0, 2)) {
    const workday = await checkWorkday(slug);
    if (workday) return { firm, hit: workday, tried };
  }

  return { firm, hit: null, tried };
}

async function checkGreenhouse(slug: string): Promise<Hit | null> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`;
  const body = await getJson<{ jobs?: unknown[] }>(url);
  if (!body) return null;
  // A real board with nothing open still answers 200 — the slug is what is
  // being established here, not whether they are hiring.
  return { ats: 'greenhouse', slug, jobs: Array.isArray(body.jobs) ? body.jobs.length : 0 };
}

async function checkLever(slug: string): Promise<Hit | null> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
  const body = await getJson<unknown[]>(url);
  if (!Array.isArray(body)) return null;
  return { ats: 'lever', slug, jobs: body.length };
}

/**
 * Workday tenants live at <tenant>.wd<n>.myworkdayjobs.com. The host either
 * resolves or it does not, which is enough to say the firm is on Workday; the
 * site path inside it still has to be read off their careers page.
 */
async function checkWorkday(slug: string): Promise<Hit | null> {
  for (const number of WORKDAY_HOSTS) {
    const host = `${slug}.wd${number}.myworkdayjobs.com`;
    const status = await headStatus(`https://${host}/`);
    // Workday answers a bare tenant root with a redirect or a page; a missing
    // tenant fails to resolve at all.
    if (status && status < 400) return { ats: 'workday', slug, jobs: null, host };
  }
  return null;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function headStatus(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(12_000)
    });
    return response.status;
  } catch {
    return null;
  }
}

function report(result: Result): void {
  const name = result.firm.padEnd(30);
  if (!result.hit) {
    console.log(`MISS  ${name}  nothing on greenhouse, lever or workday (${result.tried} candidates)`);
    return;
  }

  const { ats, slug, jobs, host } = result.hit;
  const detail =
    ats === 'workday'
      ? `tenant ${host} — site name still needed`
      : `${jobs} jobs on the board`;
  console.log(`HIT   ${name}  ${ats.padEnd(10)} ${slug.padEnd(24)} ${detail}`);
}

function summarize(results: Result[]): void {
  const count = (ats: Hit['ats']) => results.filter((r) => r.hit?.ats === ats).length;
  const misses = results.filter((r) => !r.hit).length;

  console.log(
    `\n${count('greenhouse')} greenhouse · ${count('lever')} lever · ` +
      `${count('workday')} workday tenants · ${misses} not found`
  );

  if (count('workday')) {
    console.log(
      '\nWorkday hits need one manual step each: open the firm careers page, find the\n' +
        '/wday/cxs/<tenant>/<site>/ request in devtools, and use <tenant>/<site> as ats_slug.'
    );
  }
}

function printSql(results: Result[]): void {
  const hits = results.filter((result) => result.hit);
  if (!hits.length) return;

  console.log('\n-- Verified boards:');
  for (const { firm, hit } of hits) {
    if (!hit) continue;
    const name = firm.replace(/'/g, "''");
    if (hit.ats === 'workday') {
      console.log(
        `update firms set ats = 'workday', ats_host = '${hit.host}', ` +
          `ats_slug = '${hit.slug}/<site>' where name = '${name}';  -- site still needed`
      );
    } else {
      console.log(
        `update firms set ats = '${hit.ats}', ats_slug = '${hit.slug}', ats_host = null ` +
          `where name = '${name}';`
      );
    }
  }

  const misses = results.filter((result) => !result.hit).map(({ firm }) => `'${firm.replace(/'/g, "''")}'`);
  if (misses.length) {
    console.log('\n-- Not on any readable ATS; deactivate until replaced:');
    console.log(`update firms set active = false where name in (${misses.join(', ')});`);
  }
}

function argValue(flag: string, fallback: number): number {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
