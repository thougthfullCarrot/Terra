/**
 * Find each firm's ATS by reading its careers page.
 *
 * The slug probe guessed board identifiers and hit about 1%, because a slug is
 * not derivable from a firm name. This asks a different question: find the
 * firm's own site, follow its careers link, and read which ATS it points at.
 * The answer arrives as evidence — a URL on the firm's own page — rather than
 * a guess that happened to return 200.
 *
 * Every finding carries the page it came from, and a site is only trusted once
 * the firm's name has been found in it. That second part is what the slug probe
 * was missing: it reported `highland` as Highland Capital's board when the
 * board belonged to an animal hospital.
 *
 *   npm run discover:ats                 # every name in data/firm-candidates.txt
 *   npm run discover:ats -- --sql        # print SQL for the supported hits
 *   npm run discover:ats -- --limit 3    # fewer domain guesses per firm
 *   npm run discover:ats -- --file data/employer-candidates-batch1.txt --csv employers.csv --check
 *       # another list; write the registry rows; read each found board once and
 *       # count what would publish, go to review, or be rejected
 *
 * Needs open outbound HTTP. Run it from the "Discover ATS" workflow.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { loadFirmSeed } from '../collector/firmSeed.js';
import { loadCandidates, type Candidate } from '../collector/firmCandidates.js';
import { fetchBoard } from '../collector/run.js';
import { evenIfIncomplete } from '../collector/sources/incomplete.js';
import { emptyRejected, forFirm, normalize, type RejectReason } from '../collector/normalize.js';
import type { FirmRow } from '../db/store.js';
import { domainCandidates } from '../collector/domainCandidates.js';
import { CAREERS_PATHS, careersCandidates, extractLinks } from '../collector/careersLinks.js';
import { detectAts, embeddedUrls, type AtsMatch } from '../collector/atsDetect.js';
import { significant } from '../collector/nameMatch.js';
import { parseRobots, robotsAllows, type RobotsRules } from '../collector/robots.js';
import { sheetsClientFromEnv } from '../sheets/env.js';
import { loadFirms } from '../sheets/firms.js';
import type { Posting } from '../types.js';

const CANDIDATES_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../data/firm-candidates.txt'
);

const USER_AGENT = 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)';
const TIMEOUT_MS = 15_000;

interface Finding {
  firm: string;
  candidate: Candidate;
  domain: string | null;
  match: AtsMatch | null;
  /** The careers page the board link was found on, or the last one read. */
  careersUrl: string | null;
  /** The careers page carries schema.org JobPosting data: readable without an ATS. */
  jsonLd: boolean;
  /** Why no board was found, when none was. */
  reason: 'no-site' | 'no-careers-page' | 'no-ats-link' | 'robots' | null;
  /** The board belongs to a firm TERRA already polls under another name. */
  duplicateBoard?: boolean;
  /** With --check: what one read of the board would do today. */
  check?: BoardCheck;
}

interface BoardCheck {
  ok: boolean;
  fetched: number;
  published: number;
  review: number;
  rejected: Record<RejectReason, number>;
  error?: string;
  /** Postings that would publish, kept for --jobs. */
  postings: Posting[];
}

/** Pause between requests to the same firm's site, so a run stays gentle. */
const PAUSE_MS = 750;

async function main(): Promise<void> {
  const limit = argValue('--limit', 5);
  const wantSql = process.argv.includes('--sql');
  const wantCheck = process.argv.includes('--check');
  const file = argString('--file');
  const csv = argString('--csv');
  const jobsPath = argString('--jobs');
  const firms = await loadCandidates(file ? resolve(file) : CANDIDATES_PATH);
  // Names already on the firm list (seed and, when readable, the live Sheet)
  // are skipped, and so is a board an existing firm already polls.
  const { names: known, boards: knownBoards, source } = await knownFirms();
  console.log(`Known firms: ${known.size} names, ${knownBoards.size} boards (from ${source}).`);
  const skipped = firms.filter((firm) => known.has(firm.name.toLowerCase()));
  if (skipped.length) console.log(`Skipped as already known: ${skipped.map((f) => f.name).join(', ')}`);

  console.log(`Reading careers pages for ${firms.length} firms.\n`);

  const findings: Finding[] = [];
  // Two at a time. Each firm costs several requests against someone's web
  // server, and politeness here is not optional.
  for (let i = 0; i < firms.length; i += 2) {
    const batch = await Promise.all(
      firms
        .slice(i, i + 2)
        .filter((firm) => !known.has(firm.name.toLowerCase()))
        .map((firm) => discover(firm, limit))
    );
    for (const finding of batch) {
      const board = finding.match?.slug ? boardKey(finding.match.ats, finding.match.slug) : null;
      if (board && knownBoards.has(board)) {
        finding.duplicateBoard = true;
      } else if (wantCheck && finding.match?.supported && finding.match.slug) {
        finding.check = await checkBoard(finding);
      }
      if (board) knownBoards.add(board);
      report(finding);
      findings.push(finding);
    }
  }

  summarize(findings);
  summarizeByGroup(findings);
  const unique = uniquePostings(findings);
  summarizeJobs(unique);
  if (jobsPath) {
    await writeFile(resolve(jobsPath), JSON.stringify(unique, null, 2) + '\n');
    console.log(`\nPostings that would publish written to ${jobsPath}.`);
  }
  if (wantSql) printSql(findings);
  if (csv) {
    await writeFile(resolve(csv), registryCsv(findings, new Date()));
    console.log(`\nRegistry rows written to ${csv}.`);
  }

  if (!findings.some((finding) => finding.match)) process.exitCode = 1;
}

async function discover(candidate: Candidate, limit: number): Promise<Finding> {
  const firm = candidate.name;
  const base = { firm, candidate, careersUrl: null, jsonLd: false };
  const domain = await findSite(firm, limit, candidate.domain);
  if (!domain) return { ...base, domain: null, match: null, reason: 'no-site' };

  const origin = `https://${domain}`;
  const robots = await readRobots(origin);
  const allowed = (url: string) => {
    try {
      const u = new URL(url);
      return u.origin !== origin || robotsAllows(robots, u.pathname + u.search);
    } catch {
      return false;
    }
  };
  if (!allowed(`${origin}/`) && !CAREERS_PATHS.some((path) => allowed(`${origin}${path}`))) {
    return { ...base, domain, match: null, reason: 'robots' };
  }
  const home = allowed(`${origin}/`) ? await get(origin) : null;

  // Careers links found on the homepage first, then the usual paths. The
  // homepage link is authoritative; the guessed paths are a fallback.
  const pages: string[] = [];
  if (home) pages.push(...careersCandidates(extractLinks(home.body, home.url), origin));
  pages.push(...CAREERS_PATHS.map((path) => `${origin}${path}`));

  let careersUrl: string | null = null;
  let jsonLd = false;
  let other: AtsMatch | null = null;

  for (const page of dedupe(pages).filter(allowed).slice(0, 8)) {
    await pause();
    const response = await get(page);
    if (!response) continue;
    careersUrl ??= response.url;
    if (/"@type"\s*:\s*"JobPosting"/.test(response.body)) {
      jsonLd = true;
      careersUrl = response.url;
    }

    // The board link may be on the careers page, or the careers URL may itself
    // already be the board — a firm whose /careers redirects to Greenhouse.
    // Embedded boards hide their URL in a script tag rather than a link, so
    // the page's raw text is searched too.
    const direct = detectAts(response.url);
    const found = [direct, ...[...extractLinks(response.body, response.url), ...embeddedUrls(response.body)].map(detectAts)].filter(
      (match): match is AtsMatch => match !== null
    );
    const supported = found.find((match) => match.supported && match.slug) ?? found.find((match) => match.supported);
    if (supported) return { ...base, domain, careersUrl: response.url, jsonLd, match: supported, reason: null };
    other ??= found[0] ?? null;
    if (other) careersUrl = response.url;
  }

  return {
    ...base,
    domain,
    careersUrl,
    jsonLd,
    match: other,
    reason: other ? null : careersUrl ? 'no-ats-link' : 'no-careers-page'
  };
}

/** Read a found board once, as the collector would, and count what would publish. */
async function checkBoard(finding: Finding): Promise<BoardCheck> {
  const match = finding.match!;
  const firm: FirmRow = {
    id: 0,
    name: finding.firm,
    ats: match.ats as FirmRow['ats'],
    atsSlug: match.slug!,
    atsHost: match.host,
    active: true,
    slugVerified: true
  };
  const check: BoardCheck = { ok: false, fetched: 0, published: 0, review: 0, rejected: emptyRejected(), postings: [] };
  try {
    const jobs = forFirm(firm, await evenIfIncomplete(fetchBoard(firm)));
    check.ok = true;
    check.fetched = jobs.length;
    for (const job of jobs) {
      const result = normalize(job);
      if (result.ok) {
        check.published++;
        check.postings.push(result.posting);
      }
      else if (result.reason === 'needs-review') check.review++;
      else check.rejected[result.reason]++;
    }
  } catch (error) {
    check.error = error instanceof Error ? error.message : String(error);
  }
  return check;
}

/**
 * Firms TERRA already polls: the seed list plus, when Sheets credentials are
 * set, the live Firms tab (read only, never written here). Also the batch 1
 * and firm-candidates names, so a candidate already tried is not re-read.
 */
async function knownFirms(): Promise<{ names: Set<string>; boards: Set<string>; source: string }> {
  const seed = await loadFirmSeed();
  const loaded = await loadFirms(sheetsClientFromEnv(), seed, { write: false });
  const all = [...seed, ...loaded.firms];
  const names = new Set(all.map((firm) => firm.name.toLowerCase()));
  const boards = new Set(all.map((firm) => boardKey(firm.ats, firm.atsSlug)));
  const dataDir = dirname(CANDIDATES_PATH);
  for (const path of ['employer-candidates-batch1.txt']) {
    for (const firm of await loadCandidates(resolve(dataDir, path)).catch(() => [])) names.add(firm.name.toLowerCase());
  }
  return { names, boards, source: loaded.source === 'sheet' ? 'seed + live Firms sheet' : 'seed only' };
}

export function boardKey(ats: string, slug: string): string {
  return `${ats}:${slug}`.toLowerCase();
}

async function readRobots(origin: string): Promise<RobotsRules> {
  try {
    const response = await fetch(`${origin}/robots.txt`, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!response.ok) return { allow: [], disallow: [] };
    return parseRobots((await response.text()).slice(0, 200_000), USER_AGENT);
  } catch {
    return { allow: [], disallow: [] };
  }
}

function pause(): Promise<void> {
  return new Promise((done) => setTimeout(done, PAUSE_MS));
}

/** Category label from the candidate list's comment headers, else its sector. */
function group(finding: Finding): string {
  return finding.candidate.group ?? finding.candidate.sector ?? 'Other';
}

function summarizeByGroup(findings: Finding[]): void {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) groups.set(group(f), [...(groups.get(group(f)) ?? []), f]);
  console.log('\nBy category: firms · site found · supported board · board read · jobs read · would publish · review');
  for (const [name, list] of groups) {
    const read = list.filter((f) => f.check?.ok);
    const sum = (pick: (c: BoardCheck) => number) => read.reduce((n, f) => n + pick(f.check!), 0);
    console.log(
      `  ${name.padEnd(44)} ${list.length} · ${list.filter((f) => f.domain).length} · ` +
        `${list.filter((f) => f.match?.supported && !f.duplicateBoard).length} · ${read.length} · ` +
        `${sum((c) => c.fetched)} · ${sum((c) => c.published)} · ${sum((c) => c.review)}`
    );
  }
  const dupes = findings.filter((f) => f.duplicateBoard);
  if (dupes.length) console.log(`Boards already polled under another name (skipped): ${dupes.map((f) => f.firm).join(', ')}`);
  const robots = findings.filter((f) => f.reason === 'robots');
  if (robots.length) console.log(`Skipped by robots.txt: ${robots.map((f) => f.firm).join(', ')}`);
}

/** Postings that would publish, once each (same id = same firm, role and city). */
export function uniquePostings(findings: Finding[]): (Posting & { category: string })[] {
  const seen = new Map<string, Posting & { category: string }>();
  for (const f of findings) {
    for (const posting of f.check?.postings ?? []) {
      if (!seen.has(posting.id)) seen.set(posting.id, { ...posting, category: group(f) });
    }
  }
  return [...seen.values()];
}

function summarizeJobs(postings: Posting[]): void {
  if (!postings.length) return;
  const count = (key: (p: Posting) => string) => {
    const m = new Map<string, number>();
    for (const p of postings) m.set(key(p), (m.get(key(p)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ');
  };
  console.log(`\nUnique postings that would publish: ${postings.length}`);
  console.log(`By specialty: ${count((p) => p.sector)}`);
  console.log(`By kind: ${count((p) => p.kind)}`);
  console.log(`By city: ${count((p) => p.city)}`);
  console.log('\nEvery posting (firm | specialty | kind | city | title | apply link):');
  for (const p of postings) console.log(`  ${p.firm} | ${p.sector} | ${p.kind} | ${p.city} | ${p.role} | ${p.applyUrl}`);
}

const CSV_COLUMNS = ['name', 'website', 'careers_url', 'ats', 'board_id', 'ats_host', 'supported', 'json_ld', 'sector', 'markets', 'status', 'board_jobs', 'tx_published', 'tx_review', 'checked_at'];

/**
 * One row per firm for data/employers.csv: what was found and the evidence
 * for it. 'status' is verified (supported board read), board-only (board
 * found, not read), unsupported (ATS with no reader), json-ld, or not-found.
 */
export function registryCsv(findings: Finding[], now: Date): string {
  const rows = findings.map((f) => {
    const status = f.check?.ok
      ? 'verified'
      : f.match?.supported
        ? 'board-only'
        : f.match
          ? 'unsupported'
          : f.jsonLd
            ? 'json-ld'
            : 'not-found';
    return [
      f.firm,
      f.domain ?? f.candidate.domain ?? '',
      f.careersUrl ?? '',
      f.match?.ats ?? '',
      f.match?.slug ?? '',
      f.match?.host ?? '',
      f.match ? String(f.match.supported) : '',
      String(f.jsonLd),
      f.candidate.sector ?? '',
      f.candidate.markets ?? '',
      status,
      f.check?.ok ? String(f.check.fetched) : '',
      f.check?.ok ? String(f.check.published) : '',
      f.check?.ok ? String(f.check.review) : '',
      f.check?.ok ? now.toISOString().slice(0, 10) : ''
    ];
  });
  return [CSV_COLUMNS, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The firm's own domain, confirmed by finding ALL of its distinctive words in
 * the page.
 *
 * An earlier version accepted a single word, on the reasoning that a domain is
 * the firm's own rather than a shared namespace. That was simply wrong — a
 * domain belongs to whoever registered it. `domainCandidates('Jackson-Shaw')`
 * offers `jackson.com`, that page contains "jackson", and the crawler went on
 * to report Jackson National Life's Workday tenant as the Dallas developer
 * Jackson-Shaw's. Wealth-management roles in Nashville and Lansing were what
 * gave it away.
 *
 * So the bar is the same one board attribution uses: every distinctive word, or
 * the single word when that is genuinely all the name has.
 */
async function findSite(firm: string, limit: number, hint?: string): Promise<string | null> {
  const words = [...significant(firm)];

  for (const domain of dedupe([...(hint ? [hint] : []), ...domainCandidates(firm, limit)])) {
    const response = await get(`https://${domain}`);
    if (!response) continue;
    if (!words.length) continue;

    const text = response.body.toLowerCase();
    if (words.every((word) => text.includes(word))) return domain;
  }

  return null;
}

async function get(url: string): Promise<{ url: string; body: string } | null> {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!response.ok) return null;

    const type = response.headers.get('content-type') ?? '';
    if (!type.includes('html')) return null;

    // Careers pages are small; a cap keeps one enormous page from stalling a run.
    return { url: response.url, body: (await response.text()).slice(0, 600_000) };
  } catch {
    return null;
  }
}

function report(finding: Finding): void {
  const name = finding.firm.padEnd(32);

  if (!finding.match) {
    const why = {
      'no-site': 'no site found',
      'no-careers-page': 'site found, no careers page',
      'no-ats-link': 'careers page found, no ATS link',
      robots: 'robots.txt disallows the careers pages',
      null: ''
    }[String(finding.reason)];
    console.log(`MISS  ${name} ${(finding.domain ?? '-').padEnd(28)} ${why}${finding.jsonLd ? ' (careers page has JobPosting data)' : ''}`);
    return;
  }

  const { ats, supported, slug, url } = finding.match;
  const label = finding.duplicateBoard ? 'KNOWN' : supported ? 'FOUND' : 'OTHER';
  console.log(
    `${label} ${name} ${(finding.domain ?? '-').padEnd(28)} ${ats.padEnd(16)} ${slug ?? '-'}\n` +
      `        via ${url}`
  );
  const check = finding.check;
  if (check) {
    console.log(
      check.ok
        ? `        board read: ${check.fetched} jobs, ${check.published} TX publish, ${check.review} review, ` +
            `${check.rejected['not-texas']} not TX, ${check.rejected['not-entry-level'] + check.rejected['over-experience']} not entry, ${check.rejected['off-topic']} off-topic`
        : `        board read failed: ${check.error}`
    );
  }
}

function summarize(findings: Finding[]): void {
  const checked = findings.filter((f) => f.check?.ok);
  if (checked.length) {
    const sum = (pick: (c: BoardCheck) => number) => checked.reduce((n, f) => n + pick(f.check!), 0);
    console.log(
      `\nBoards read: ${checked.length} · with a TX opening today: ${checked.filter((f) => f.check!.published > 0).length} · ` +
        `jobs ${sum((c) => c.fetched)} · would publish ${sum((c) => c.published)} · review ${sum((c) => c.review)}`
    );
  }
  const jsonLd = findings.filter((f) => !f.match && f.jsonLd).length;
  if (jsonLd) console.log(`${jsonLd} careers pages with JobPosting data and no ATS (a reader for those is the next step).`);
  const supported = findings.filter((f) => f.match?.supported);
  const other = findings.filter((f) => f.match && !f.match.supported);

  console.log(
    `\n${supported.length} on a supported ATS · ${other.length} on one with no fetcher · ` +
      `${findings.length - supported.length - other.length} not found`
  );

  const byAts = new Map<string, number>();
  for (const finding of findings) {
    if (!finding.match) continue;
    byAts.set(finding.match.ats, (byAts.get(finding.match.ats) ?? 0) + 1);
  }
  if (byAts.size) {
    console.log(
      '\nBy platform: ' +
        [...byAts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([ats, n]) => `${ats} ${n}`)
          .join(' · ')
    );
    console.log('An unsupported platform with a real count is the next fetcher worth writing.');
  }
}

function printSql(findings: Finding[]): void {
  const hits = findings.filter((f) => f.match?.supported && f.match.slug);
  if (!hits.length) return;

  console.log('\n-- Boards read off each firm own careers page:');
  for (const { firm, match } of hits) {
    if (!match?.slug) continue;
    const name = firm.replace(/'/g, "''");
    const host = match.host ? `'${match.host}'` : 'null';
    console.log(
      `insert into firms (name, ats, ats_slug, ats_host, slug_verified) values ` +
        `('${name}', '${match.ats}', '${match.slug}', ${host}, true) ` +
        `on conflict (name) do nothing;  -- ${match.url}`
    );
  }
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function argString(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
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
