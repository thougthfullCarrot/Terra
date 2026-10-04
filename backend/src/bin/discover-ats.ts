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
 *
 * Needs open outbound HTTP. Run it from the "Discover ATS" workflow.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadFirmCandidates } from '../collector/firmCandidates.js';
import { domainCandidates } from '../collector/domainCandidates.js';
import { CAREERS_PATHS, careersCandidates, extractLinks } from '../collector/careersLinks.js';
import { detectAts, type AtsMatch } from '../collector/atsDetect.js';
import { significant } from '../collector/nameMatch.js';

const CANDIDATES_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../data/firm-candidates.txt'
);

const USER_AGENT = 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)';
const TIMEOUT_MS = 15_000;

interface Finding {
  firm: string;
  domain: string | null;
  match: AtsMatch | null;
  /** Why no board was found, when none was. */
  reason: 'no-site' | 'no-careers-page' | 'no-ats-link' | null;
}

async function main(): Promise<void> {
  const limit = argValue('--limit', 5);
  const wantSql = process.argv.includes('--sql');
  const firms = await loadFirmCandidates(CANDIDATES_PATH);

  console.log(`Reading careers pages for ${firms.length} firms.\n`);

  const findings: Finding[] = [];
  // Two at a time. Each firm costs several requests against someone's web
  // server, and politeness here is not optional.
  for (let i = 0; i < firms.length; i += 2) {
    const batch = await Promise.all(firms.slice(i, i + 2).map((firm) => discover(firm, limit)));
    for (const finding of batch) {
      report(finding);
      findings.push(finding);
    }
  }

  summarize(findings);
  if (wantSql) printSql(findings);

  if (!findings.some((finding) => finding.match)) process.exitCode = 1;
}

async function discover(firm: string, limit: number): Promise<Finding> {
  const domain = await findSite(firm, limit);
  if (!domain) return { firm, domain: null, match: null, reason: 'no-site' };

  const origin = `https://${domain}`;
  const home = await get(origin);

  // Careers links found on the homepage first, then the usual paths. The
  // homepage link is authoritative; the guessed paths are a fallback.
  const pages: string[] = [];
  if (home) pages.push(...careersCandidates(extractLinks(home.body, home.url), origin));
  pages.push(...CAREERS_PATHS.map((path) => `${origin}${path}`));

  let sawCareersPage = false;

  for (const page of dedupe(pages).slice(0, 8)) {
    const response = await get(page);
    if (!response) continue;
    sawCareersPage = true;

    // The board link may be on the careers page, or the careers URL may itself
    // already be the board — a firm whose /careers redirects to Greenhouse.
    const direct = detectAts(response.url);
    if (direct) return { firm, domain, match: direct, reason: null };

    for (const link of extractLinks(response.body, response.url)) {
      const match = detectAts(link);
      if (match) return { firm, domain, match, reason: null };
    }
  }

  return {
    firm,
    domain,
    match: null,
    reason: sawCareersPage ? 'no-ats-link' : 'no-careers-page'
  };
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
async function findSite(firm: string, limit: number): Promise<string | null> {
  const words = [...significant(firm)];

  for (const domain of domainCandidates(firm, limit)) {
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
      null: ''
    }[String(finding.reason)];
    console.log(`MISS  ${name} ${(finding.domain ?? '-').padEnd(28)} ${why}`);
    return;
  }

  const { ats, supported, slug, url } = finding.match;
  const label = supported ? 'FOUND' : 'OTHER';
  console.log(
    `${label} ${name} ${(finding.domain ?? '-').padEnd(28)} ${ats.padEnd(16)} ${slug ?? '-'}\n` +
      `        via ${url}`
  );
}

function summarize(findings: Finding[]): void {
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
