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
 *   3. The full nationwide list (every page, up to what Workday serves).
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
import { resolveCity } from '../collector/texas.js';
import { classifyKind } from '../collector/seniority.js';
import { detailUrl, listUrl, parseTenant, type WorkdayListing, type WorkdayTenant } from '../collector/sources/workday.js';

const DEFAULT_BOARDS = [
  'JLL=jll/jllcareers@jll.wd1.myworkdayjobs.com',
  'Cushman & Wakefield=cw/External@cw.wd1.myworkdayjobs.com',
  'Fifth Third Bank=fifththird/53careers@fifththird.wd5.myworkdayjobs.com',
  'Huntington Bank=huntington/HNBcareers@huntington.wd12.myworkdayjobs.com',
  'Greystar=greystar/External@greystar.wd1.myworkdayjobs.com'
];
const PAGE = 20;
const MAX_PAGES = Number(process.env.FACET_MAX_PAGES ?? 110);
const DETAIL_LIMIT = Number(process.env.FACET_DETAIL_LIMIT ?? 40);

interface FacetValue {
  parameter: string;
  descriptor: string;
  id: string;
  count: number;
}
interface ListResponse {
  total?: number;
  jobPostings?: WorkdayListing[];
  facets?: unknown[];
}

const TEXAS = /\btexas\b|,\s*tx\b|\btx\b|\busa?\s*-\s*tx\b/i;
const OTHER_STATE = /,\s*(?!tx\b)[A-Z]{2}\b/;
const MULTI = /^\d+\s+locations$/i;
const REMOTE = /\b(remote|virtual|work from home|telecommut)/i;

function isTexas(text: string): boolean {
  if (TEXAS.test(text)) return true;
  return !OTHER_STATE.test(text) && Boolean(resolveCity(text));
}

/** Facet values come flat ({descriptor,id,count}) or nested under groups; collect them all. */
function facetValues(facets: unknown[] | undefined, parent = ''): FacetValue[] {
  const out: FacetValue[] = [];
  for (const raw of facets ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as { facetParameter?: string; descriptor?: string; id?: string; count?: number; values?: unknown[] };
    const parameter = f.facetParameter ?? parent;
    if (Array.isArray(f.values)) out.push(...facetValues(f.values, parameter));
    else if (f.id && f.descriptor) out.push({ parameter, descriptor: f.descriptor, id: f.id, count: f.count ?? 0 });
  }
  return out;
}

async function list(tenant: WorkdayTenant, offset: number, appliedFacets: Record<string, string[]>): Promise<ListResponse> {
  return fetchJson<ListResponse>(listUrl(tenant), {
    method: 'POST',
    retries: 4,
    headers: { 'accept-language': 'en-US', origin: `https://${tenant.host}`, referer: `https://${tenant.host}/${tenant.site}` },
    body: { appliedFacets, limit: PAGE, offset, searchText: '' }
  });
}

async function listAll(tenant: WorkdayTenant, facets: Record<string, string[]>): Promise<{ postings: WorkdayListing[]; total?: number; requests: number; error?: string }> {
  const postings: WorkdayListing[] = [];
  let total: number | undefined;
  let requests = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    let batch: ListResponse;
    try {
      requests++;
      batch = await list(tenant, page * PAGE, facets);
    } catch (error) {
      return { postings, total, requests, error: `page ${page + 1}: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (page === 0) total = batch.total;
    const got = batch.jobPostings ?? [];
    postings.push(...got);
    if (got.length < PAGE) break;
  }
  return { postings, total, requests };
}

function parseBoards(): { name: string; tenant: WorkdayTenant }[] {
  const at = process.argv.indexOf('--boards');
  const specs = at > 0 ? process.argv[at + 1]!.split(';') : (process.env.FACET_BOARDS ? process.env.FACET_BOARDS.split(';') : DEFAULT_BOARDS);
  return specs.filter(Boolean).map((spec) => {
    const [name, rest] = spec.split('=');
    const [slug, host] = rest!.split('@');
    return { name: name!.trim(), tenant: parseTenant(host, slug!) };
  });
}

async function pilot(name: string, tenant: WorkdayTenant): Promise<void> {
  const say = (line: string) => console.log(`FACET ${name} | ${line}`);
  const started = Date.now();

  // 1. Facets and the reported total.
  const first = await list(tenant, 0, {});
  const values = facetValues(first.facets);
  const params = [...new Set(values.map((v) => v.parameter))];
  say(`reported total ${first.total ?? '?'}; facet parameters: ${params.map((p) => `${p} (${values.filter((v) => v.parameter === p).length})`).join(', ') || 'none'}`);

  // 2. Cap check: past offset 2,000, and the country/region sums.
  for (const offset of [2000, 2020]) {
    try {
      const past = await list(tenant, offset, {});
      say(`offset ${offset}: ${past.jobPostings?.length ?? 0} postings returned (total field ${past.total ?? '?'})`);
    } catch (error) {
      say(`offset ${offset}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const p of params.filter((p) => /country|region|state|main/i.test(p))) {
    const sum = values.filter((v) => v.parameter === p).reduce((n, v) => n + v.count, 0);
    say(`sum of ${p} facet counts: ${sum}`);
  }

  // Texas facet values: prefer a state-level value, else every Texas city/site value.
  const locationValues = values.filter((v) => /location|state|region|country|city|site/i.test(v.parameter));
  const state = locationValues.filter((v) => /state|region/i.test(v.parameter) && /\btexas\b|\btx\b/i.test(v.descriptor));
  const texasValues = state.length ? state : locationValues.filter((v) => !/country/i.test(v.parameter) && isTexas(v.descriptor));
  const remoteValues = locationValues.filter((v) => REMOTE.test(v.descriptor));
  say(`Texas facet values used: ${texasValues.length} (${texasValues.slice(0, 12).map((v) => `${v.descriptor}=${v.count}`).join(', ')}${texasValues.length > 12 ? ', ...' : ''}); sum ${texasValues.reduce((n, v) => n + v.count, 0)}`);
  if (remoteValues.length) say(`remote facet values (not applied): ${remoteValues.slice(0, 8).map((v) => `${v.descriptor}=${v.count}`).join(', ')}`);
  if (!texasValues.length) {
    say('no Texas facet value; a facet read is not possible on this board');
    return;
  }

  // 3. Full nationwide list.
  const all = await listAll(tenant, {});
  say(`nationwide: listed ${all.postings.length} of ${all.total ?? '?'} in ${all.requests} requests${all.error ? `; stopped: ${all.error}` : ''}`);

  // 4. Texas facet list. Group by parameter, as Workday ANDs parameters and ORs values.
  const applied: Record<string, string[]> = {};
  for (const v of texasValues) (applied[v.parameter] ??= []).push(v.id);
  const tx = await listAll(tenant, applied);
  say(`texas facet: listed ${tx.postings.length} of ${tx.total ?? '?'} in ${tx.requests} requests${tx.error ? `; stopped: ${tx.error}` : ''}`);

  // 5. Compare on the same data.
  const facetPaths = new Set(tx.postings.map((p) => p.externalPath));
  const nationTexas = all.postings.filter((p) => p.locationsText && !MULTI.test(p.locationsText) && isTexas(p.locationsText));
  const missed = nationTexas.filter((p) => !facetPaths.has(p.externalPath));
  const multi = all.postings.filter((p) => p.locationsText && MULTI.test(p.locationsText));
  const remote = all.postings.filter((p) => REMOTE.test(`${p.locationsText ?? ''} ${p.title ?? ''}`));
  const extra = tx.postings.filter((p) => !(p.locationsText && isTexas(p.locationsText)));
  say(`nationwide Texas-located ${nationTexas.length}; facet list has ${nationTexas.length - missed.length}; missed ${missed.length}`);
  for (const p of missed.slice(0, 8)) say(`  missed: ${p.title} — ${p.locationsText} — ${p.externalPath}`);
  say(`facet list postings without Texas in their list text (multi-location etc.): ${extra.length} (${extra.filter((p) => MULTI.test(p.locationsText ?? '')).length} multi-location)`);
  say(`nationwide multi-location ${multi.length} (${multi.filter((p) => facetPaths.has(p.externalPath)).length} in the facet list); remote ${remote.length} (${remote.filter((p) => facetPaths.has(p.externalPath)).length} in the facet list)`);

  // Multi-location and remote postings outside the facet list that a build would open: do any reach Texas?
  const open = [...multi, ...remote]
    .filter((p, i, arr) => arr.findIndex((q) => q.externalPath === p.externalPath) === i)
    .filter((p) => !facetPaths.has(p.externalPath) && p.title && classifyKind(p.title))
    .slice(0, DETAIL_LIMIT);
  let texasOutside = 0;
  for (const p of open) {
    try {
      const d = await fetchJson<{ jobPostingInfo?: { location?: string; additionalLocations?: string[]; jobDescription?: string } }>(detailUrl(tenant, p.externalPath!), { retries: 3 });
      const info = d.jobPostingInfo ?? {};
      const locs = [info.location, ...(info.additionalLocations ?? [])].filter(Boolean).join('; ');
      const remoteTx = REMOTE.test(locs) && /\b(texas|tx)\b/i.test(`${locs} ${(info.jobDescription ?? '').slice(0, 4000)}`);
      if (isTexas(locs) || remoteTx) {
        texasOutside++;
        say(`  outside facet but Texas: ${p.title} — ${locs.slice(0, 120)}${remoteTx ? ' (remote, Texas named)' : ''}`);
      }
    } catch (error) {
      say(`  detail failed: ${p.externalPath} (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  say(`multi-location/remote postings outside the facet list that a build would open: ${open.length} checked, ${texasOutside} reach Texas`);

  const used = requestTally.getStore();
  say(`requests: nationwide ${all.requests} vs facet ${tx.requests} list requests (${all.requests ? Math.round((1 - tx.requests / all.requests) * 100) : 0}% fewer); detail checks ${open.length}; all requests incl. retries ${used?.requests ?? '?'} (${used?.retries ?? '?'} retries); ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

async function main(): Promise<void> {
  for (const { name, tenant } of parseBoards()) {
    try {
      await requestTally.run({ requests: 0, retries: 0 }, () => pilot(name, tenant));
    } catch (error) {
      console.log(`FACET ${name} | failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`FACET throttled (HTTP 429): ${JSON.stringify(throttleCounts())}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
