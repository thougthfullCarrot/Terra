/**
 * Pilot: can a Workday board be listed for Texas only, through its own
 * location facets, without missing postings the full nationwide list finds?
 *
 *   npm run pilot:workday-facets -- [--boards "JLL=jll/jllcareers@jll.wd1.myworkdayjobs.com;..."]
 *
 * For each board, on the same data in one sitting:
 *   1. Page 0 nationwide: the reported total and every location facet value.
 *   2. Cap check: a list request past offset 2,000 and the sum of the
 *      country-level facet counts, so "2,000 postings" can be told apart from a
 *      real total of 2,000 (Workday's own ceiling, or ours).
 *   3. The full nationwide list, read with the collector's own listAll.
 *   4. The Texas-only list: the board's Texas facet values applied.
 *   5. Comparison: Texas-located postings on the nationwide list that the
 *      facet list misses, multi-location ("N Locations") postings, remote
 *      postings, and for the multi-location and remote ones that pass the
 *      title filter and are missing from the facet list, a detail read to see
 *      whether one of their locations or the text puts them in Texas.
 *
 * Read only; prints a report. One request at a time through the shared
 * Workday gate (lib/http.ts), so it is gentler than a build.
 */
import { fetchJson, requestTally, throttleCounts } from '../lib/http.js';
import { classifyKind } from '../collector/seniority.js';
import { detailUrl, isTexasPlace, listAll, parseTenant, texasFacetFilters, type WorkdayListing, type WorkdayTenant } from '../collector/sources/workday.js';

const DEFAULT_BOARDS = [
  'JLL=jll/jllcareers@jll.wd1.myworkdayjobs.com',
  'Cushman & Wakefield=cw/External@cw.wd1.myworkdayjobs.com',
  'Fifth Third Bank=fifththird/53careers@fifththird.wd5.myworkdayjobs.com',
  'Huntington Bank=huntington/HNBcareers@huntington.wd12.myworkdayjobs.com',
  'Greystar=greystar/External@greystar.wd1.myworkdayjobs.com'
];
const MAX_PAGES = 250;
const MULTI = /^\d+\s+locations$/i;
const REMOTE = /\b(remote|virtual|work from home|telecommut)/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseBoards(): { name: string; tenant: WorkdayTenant }[] {
  const at = process.argv.indexOf('--boards');
  const specs = at > 0 ? process.argv[at + 1]!.split(';') : (process.env.FACET_BOARDS ? process.env.FACET_BOARDS.split(';') : DEFAULT_BOARDS);
  return specs.filter(Boolean).map((spec) => {
    const [name, rest] = spec.split('=');
    const [slug, host] = rest!.split('@');
    return { name: name!.trim(), tenant: parseTenant(host, slug!) };
  });
}

type Detail = { location?: string; additionalLocations?: string[]; jobDescription?: string };

/** Detail reads one at a time, spaced, with a second pass after a pause for the ones a 429 stopped. */
async function readDetails(tenant: WorkdayTenant, paths: string[]): Promise<{ got: Map<string, Detail>; failed: string[] }> {
  const got = new Map<string, Detail>();
  let todo = paths;
  for (let pass = 0; pass < 3 && todo.length; pass++) {
    if (pass) await sleep(90_000);
    const failed: string[] = [];
    for (const path of todo) {
      try {
        const d = await fetchJson<{ jobPostingInfo?: Detail }>(detailUrl(tenant, path), { retries: 2 });
        got.set(path, d.jobPostingInfo ?? {});
      } catch {
        failed.push(path);
      }
      await sleep(1500);
    }
    todo = failed;
  }
  return { got, failed: todo };
}

function reachesTexas(d: Detail): boolean {
  const locs = [d.location, ...(d.additionalLocations ?? [])].filter(Boolean) as string[];
  if (locs.some(isTexasPlace)) return true;
  // A US-remote posting that names Texas as eligible in its text.
  return locs.some((l) => REMOTE.test(l)) && /\b(texas|tx)\b/i.test((d.jobDescription ?? '').replace(/<[^>]+>/g, ' ').slice(0, 6000));
}

async function pilot(name: string, tenant: WorkdayTenant): Promise<void> {
  const say = (line: string) => console.log(`FACET ${name} | ${line}`);
  const reasons: string[] = [];
  const started = Date.now();

  // The same code the collector runs: page 0's facets, then listAll per filter.
  const nation = await listAll(tenant, { retries: 4 }, MAX_PAGES, {});
  say(`nationwide: listed ${nation.listings.length} (total field ${nation.total ?? '?'}); end ${nation.end}${nation.gap ? ` (${nation.gap})` : ''}; ${nation.requests} list requests; ${nation.duplicates} repeated postings dropped`);
  if (nation.end !== 'end' && nation.end !== 'total') reasons.push(`nationwide list ${nation.end}`);

  const firstPage = await fetchJson<{ facets?: unknown[] }>(`https://${tenant.host}/wday/cxs/${tenant.tenant}/${tenant.site}/jobs`, {
    method: 'POST', retries: 4,
    headers: { 'accept-language': 'en-US', origin: `https://${tenant.host}`, referer: `https://${tenant.host}/${tenant.site}` },
    body: { appliedFacets: {}, limit: 20, offset: 0, searchText: '' }
  });
  const filters = texasFacetFilters(firstPage.facets);
  say(`filters: ${filters.map((f) => `${f.label} ${JSON.stringify(f.applied).slice(0, 160)} (${f.count})`).join('; ') || 'none'}`);
  if (!filters.length) {
    say('VERDICT not-applicable (no Texas facet value; stays nationwide)');
    return;
  }

  const union = new Map<string, WorkdayListing>();
  let facetRequests = 1;
  for (const f of filters) {
    const r = await listAll(tenant, { retries: 4 }, MAX_PAGES, f.applied);
    facetRequests += r.requests;
    for (const l of r.listings) union.set(l.externalPath!, l);
    say(`facet ${f.label}: listed ${r.listings.length} (total ${r.total ?? '?'}); end ${r.end}${r.gap ? ` (${r.gap})` : ''}; ${r.requests} requests`);
    if (r.end !== 'end' && r.end !== 'total') reasons.push(`facet ${f.label} list ${r.end}`);
  }

  // Candidates a nationwide build would open but the facet lists do not have.
  const outside = nation.listings.filter((l) => l.externalPath && !union.has(l.externalPath) && l.title && classifyKind(l.title));
  const texasText = outside.filter((l) => l.locationsText && !MULTI.test(l.locationsText) && isTexasPlace(l.locationsText));
  const multi = outside.filter((l) => l.locationsText && MULTI.test(l.locationsText));
  const remote = outside.filter((l) => REMOTE.test(`${l.locationsText ?? ''} ${l.title ?? ''}`) && !multi.includes(l));
  const inFacetMulti = [...union.values()].filter((l) => MULTI.test(l.locationsText ?? '')).length;
  const inFacetRemote = [...union.values()].filter((l) => REMOTE.test(l.locationsText ?? '')).length;
  say(`facet lists hold ${union.size} postings (${inFacetMulti} multi-location, ${inFacetRemote} remote)`);
  say(`outside the facet lists, title-eligible: ${texasText.length} with Texas in the list text, ${multi.length} multi-location, ${remote.length} remote`);

  const check = [...texasText, ...multi, ...remote];
  const { got, failed } = await readDetails(tenant, check.map((l) => l.externalPath!));
  const misses = check.filter((l) => got.has(l.externalPath!) && reachesTexas(got.get(l.externalPath!)!));
  for (const l of misses.slice(0, 10)) {
    const d = got.get(l.externalPath!)!;
    say(`  MISS ${l.title} | ${l.locationsText} | ${[d.location, ...(d.additionalLocations ?? [])].join('; ').slice(0, 140)}`);
  }
  say(`detail checks: ${check.length} needed, ${got.size} read, ${failed.length} failed (rate limits); ${misses.length} reach Texas`);
  if (failed.length) reasons.push(`${failed.length} of ${check.length} detail checks failed`);
  if (misses.length) reasons.push(`${misses.length} Texas postings missed by the facets`);

  const saved = nation.requests ? Math.round((1 - facetRequests / nation.requests) * 100) : 0;
  const used = requestTally.getStore();
  say(`list requests: nationwide ${nation.requests} vs facet ${facetRequests} (${saved}% fewer); all requests ${used?.requests ?? '?'} (${used?.retries ?? '?'} retries); ${((Date.now() - started) / 1000).toFixed(0)}s`);
  say(misses.length ? `VERDICT rejected (${reasons.join('; ')})` : reasons.length ? `VERDICT inconclusive (${reasons.join('; ')})` : 'VERDICT validated');
}

async function main(): Promise<void> {
  for (const { name, tenant } of parseBoards()) {
    try {
      await requestTally.run({ requests: 0, retries: 0 }, () => pilot(name, tenant));
    } catch (error) {
      console.log(`FACET ${name} | VERDICT inconclusive (failed: ${error instanceof Error ? error.message : String(error)})`);
    }
  }
  console.log(`FACET throttled (HTTP 429): ${JSON.stringify(throttleCounts())}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
