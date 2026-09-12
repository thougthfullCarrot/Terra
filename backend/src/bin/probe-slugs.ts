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
import { namesMatch } from '../collector/nameMatch.js';

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
  /** The board's own company name, where the platform exposes one. */
  owner: string | null;
  /** True only when the board's company name matches the firm we wanted. */
  confirmed: boolean;
  /** What each probed host answered, kept so a null result can be judged. */
  evidence?: string;
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
    const greenhouse = await checkGreenhouse(firm, slug);
    if (greenhouse) return { firm, hit: greenhouse, tried };

    const lever = await checkLever(firm, slug);
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

async function checkGreenhouse(firm: string, slug: string): Promise<Hit | null> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`;
  const body = await getJson<{ jobs?: unknown[] }>(url);
  if (!body) return null;

  // A 200 proves a board exists at this slug, NOT that it belongs to this firm.
  // Generic slugs like 'lincoln' or 'integra' are owned by whoever registered
  // them first, so the board's own company name decides it.
  const board = await getJson<{ name?: string }>(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}`
  );
  const owner = board?.name ?? null;

  return {
    ats: 'greenhouse',
    slug,
    // A real board with nothing open still answers 200 — the slug is what is
    // being established here, not whether they are hiring.
    jobs: Array.isArray(body.jobs) ? body.jobs.length : 0,
    owner,
    confirmed: owner ? namesMatch(firm, owner) : false
  };
}

async function checkLever(firm: string, slug: string): Promise<Hit | null> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
  const body = await getJson<{ categories?: { team?: string } }[]>(url);
  if (!Array.isArray(body)) return null;

  // Lever exposes no company name, so ownership cannot be settled from the API.
  // Reported as unconfirmed rather than guessed at.
  return { ats: 'lever', slug, jobs: body.length, owner: null, confirmed: false };
}

/**
 * Workday tenants live at <tenant>.wd<n>.myworkdayjobs.com.
 *
 * Two earlier versions of this got it wrong in opposite directions, so it now
 * reports what the host actually said instead of ruling on it:
 *
 *   v1 used HEAD and required status < 400 — a tenant answering 405 or
 *      redirecting read as missing, and it found 0 tenants across 30 firms.
 *   v2 asked only whether the hostname resolved — but *.wd1.myworkdayjobs.com
 *      is a wildcard, so every firm "had" a tenant, including ones that plainly
 *      do not.
 *
 * A wildcard DNS record answers for any name; the question is whether anything
 * is actually served there. Only a 200 counts as a tenant, and the status of
 * every attempt is kept so the next run can be judged on evidence rather than
 * on another guess about what Workday does.
 */
async function checkWorkday(slug: string): Promise<Hit | null> {
  const seen: string[] = [];

  for (const number of WORKDAY_HOSTS) {
    const host = `${slug}.wd${number}.myworkdayjobs.com`;
    const status = await statusOf(`https://${host}/`);
    seen.push(`wd${number}:${status ?? 'no-response'}`);

    if (status === 200) {
      return { ats: 'workday', slug, jobs: null, host, owner: null, confirmed: false, evidence: seen.join(' ') };
    }
  }

  // Nothing served. The statuses are attached to the miss so a run that finds
  // no Workday tenants can be told apart from a run whose probe is broken.
  lastWorkdayEvidence.set(slug, seen.join(' '));
  return null;
}

/** Per-slug record of what each Workday host answered, for the miss report. */
const lastWorkdayEvidence = new Map<string, string>();

export function workdayEvidence(slug: string): string | undefined {
  return lastWorkdayEvidence.get(slug);
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

/**
 * The status a host answers with after redirects, or null if it never answered.
 * Redirects are followed because a live Workday tenant bounces to its careers
 * site — the destination is the thing worth knowing, not the hop.
 */
async function statusOf(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent': USER_AGENT,
        // Without this every tenant answered 406 Not Acceptable — uniformly,
        // for firms that have a Workday tenant and firms that do not. The
        // request was simply malformed: asking for an HTML page while stating
        // no acceptable type at all.
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
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
    const evidence = workdayEvidence(slugCandidates(result.firm, 1)[0] ?? '');
    const workday = evidence ? ` · workday ${evidence}` : '';
    console.log(
      `MISS  ${name}  nothing on greenhouse, lever or workday (${result.tried} candidates)${workday}`
    );
    return;
  }

  const { ats, slug, jobs, host, owner, confirmed } = result.hit;
  const detail =
    ats === 'workday'
      ? `tenant ${host} — site name still needed`
      : `${jobs} jobs · board belongs to ${owner ?? 'an unnamed company'}`;

  // CHECK means a board exists but is not provably this firm's. Treating those
  // as findings is how a feed fills up with another industry's jobs.
  const label = confirmed ? 'HIT  ' : 'CHECK';
  console.log(`${label} ${name}  ${ats.padEnd(10)} ${slug.padEnd(24)} ${detail}`);
}

function summarize(results: Result[]): void {
  const count = (ats: Hit['ats']) => results.filter((r) => r.hit?.ats === ats).length;
  const misses = results.filter((r) => !r.hit).length;
  const confirmed = results.filter((r) => r.hit?.confirmed).length;
  const unconfirmed = results.filter((r) => r.hit && !r.hit.confirmed).length;

  console.log(
    `\n${count('greenhouse')} greenhouse · ${count('lever')} lever · ` +
      `${count('workday')} workday tenants · ${misses} not found`
  );
  console.log(
    `${confirmed} confirmed as the right company · ${unconfirmed} need a human to confirm`
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

  console.log('\n-- Boards confirmed to belong to the firm:');
  for (const { firm, hit } of hits) {
    if (!hit || !hit.confirmed) continue;
    const name = firm.replace(/'/g, "''");
    console.log(
      `update firms set ats = '${hit.ats}', ats_slug = '${hit.slug}', ats_host = null ` +
        `where name = '${name}';`
    );
  }

  console.log('\n-- Boards found but NOT confirmed as this firm. Open each one and');
  console.log('-- check the company before enabling it:');
  for (const { firm, hit } of hits) {
    if (!hit || hit.confirmed) continue;
    const name = firm.replace(/'/g, "''");
    if (hit.ats === 'workday') {
      console.log(
        `update firms set ats = 'workday', ats_host = '${hit.host}', ` +
          `ats_slug = '${hit.slug}/<site>' where name = '${name}';  -- site still needed`
      );
    } else {
      const board =
        hit.ats === 'lever'
          ? `https://jobs.lever.co/${hit.slug}`
          : `https://boards.greenhouse.io/${hit.slug}`;
      console.log(`-- ${firm}: ${board} (${hit.ats}, board says "${hit.owner ?? 'unnamed'}")`);
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
