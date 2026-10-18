/**
 * County appraisal district collection and address lookup.
 *
 *   npm run appraisal -- probe                       # check each district's official pages, downloads, robots.txt
 *   npm run appraisal -- collect --districts bexar   # read into the cache (resumable; rerun to continue)
 *        [--max-chunks 20] [--max-lines 50000] [--restart] [--force] [--cache <dir>]
 *   npm run appraisal -- index [--out <dir>]         # build the address index from the cache
 *   npm run appraisal -- lookup "100 Main St, San Antonio" [--districts bexar]
 *   npm run appraisal -- verify --districts bexar    # pick exact / multi-parcel / ambiguous / no-result cases
 *                                                    # from the index and check them against the live source
 *
 * Writes <cache>/report.json with one entry per district: what was read,
 * what failed, and why. Exits non-zero only when every district asked for failed.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAddress, streetKey, formatStreet } from '../appraisal/address.js';
import { collectBulk } from '../appraisal/bulk.js';
import { cachedRecords, collectArcgis, type DistrictReport } from '../appraisal/collect.js';
import { DISTRICTS, district, type District } from '../appraisal/districts.js';
import { lookup, shardOf, writeIndex, type IndexManifest, type IndexRow } from '../appraisal/lookup.js';
import { normalizeRow } from '../appraisal/normalize.js';
import { fetchJson } from '../lib/http.js';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (name: string) => process.argv.includes(name);
const cacheDir = resolve(arg('--cache') ?? join(here, '../../../.appraisal-cache'));
const indexDir = resolve(arg('--out') ?? join(cacheDir, 'index'));
const chosen = (arg('--districts') ?? DISTRICTS.map((d) => d.id).join(',')).split(',').map((s) => s.trim()).filter(Boolean);
const log = (line: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`);

async function probe(): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  for (const d of chosen.map(district)) {
    const urls = [d.site, d.search, ...(d.downloads ?? []), d.api, d.layer ? `${d.layer}?f=json` : undefined, new URL('/robots.txt', d.site).href].filter(Boolean) as string[];
    const checks: Record<string, unknown>[] = [];
    for (const url of urls) {
      try {
        const res = await fetch(url, { method: /\.zip$/i.test(url) ? 'HEAD' : 'GET', redirect: 'follow', signal: AbortSignal.timeout(30_000), headers: { 'user-agent': 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)' } });
        const body = /\.zip$/i.test(url) ? '' : await res.text();
        const links = [...body.matchAll(/href=["']([^"'#]+)["']/gi)]
          .map((m) => m[1]!)
          .filter((h) => /export|download|data|gis|\.zip|\.csv|api|open|public-info|publicinfo/i.test(h))
          .slice(0, 40);
        checks.push({
          url,
          status: res.status,
          finalUrl: res.url,
          size: res.headers.get('content-length'),
          modified: res.headers.get('last-modified'),
          captcha: /captcha|recaptcha|hcaptcha|turnstile|cf-challenge/i.test(body),
          robots: url.endsWith('/robots.txt') ? body.slice(0, 800) : undefined,
          text: /\.txt$/i.test(url) && !url.endsWith('/robots.txt') ? body.slice(0, 4000) : undefined,
          arcgis: url.endsWith('?f=json') ? (() => { try { const j = JSON.parse(body); return { name: j.name, description: String(j.description ?? '').slice(0, 400), copyright: j.copyrightText, edited: j.editingInfo?.lastEditDate, fields: (j.fields ?? []).map((f: { name: string }) => f.name).join(',') }; } catch { return undefined; } })() : undefined,
          links: links.length ? [...new Set(links)] : undefined
        });
      } catch (error) {
        checks.push({ url, error: (error as Error).message });
      }
    }
    rows.push({ district: d.id, access: d.access, checks });
    log(`${d.id}: ${checks.map((c) => `${c.status ?? 'ERR'} ${c.url}`).join(' | ')}`);
  }
  await mkdir(cacheDir, { recursive: true });
  await writeFile(join(cacheDir, 'probe.json'), JSON.stringify(rows, null, 1));
  console.log(JSON.stringify(rows, null, 1));
}

async function collectOne(d: District): Promise<DistrictReport> {
  const opts = {
    cacheDir,
    maxChunks: arg('--max-chunks') ? Number(arg('--max-chunks')) : undefined,
    restart: has('--restart'),
    force: has('--force'),
    log
  };
  const started = Date.now();
  try {
    if (d.access === 'arcgis') return await collectArcgis(d, opts);
    if (d.access === 'bulk') return await collectBulk(d, { ...opts, maxLines: arg('--max-lines') ? Number(arg('--max-lines')) : undefined });
    return { district: d.id, status: 'unsupported', records: 0, totalIds: 0, chunksDone: 0, chunksTotal: 0, errors: [{ at: new Date().toISOString(), message: d.terms }], seconds: 0 };
  } catch (error) {
    log(`${d.id}: FAILED ${(error as Error).message}`);
    return { district: d.id, status: 'failed', records: 0, totalIds: 0, chunksDone: 0, chunksTotal: 0, errors: [{ at: new Date().toISOString(), message: (error as Error).message.slice(0, 400) }], seconds: Math.round((Date.now() - started) / 1000) };
  }
}

async function collect(): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
  // Districts are on different servers, so they run side by side; each one paces its own requests.
  const reports = await Promise.all(chosen.map((id) => collectOne(district(id))));
  const path = join(cacheDir, 'report.json');
  let earlier: Record<string, DistrictReport> = {};
  try {
    earlier = JSON.parse(await readFile(path, 'utf8'));
  } catch {}
  for (const r of reports) earlier[r.district] = r;
  await writeFile(path, JSON.stringify(earlier, null, 1));
  console.table(reports.map((r) => ({ district: r.district, status: r.status, records: r.records, of: r.totalIds, requests: `${r.chunksDone}/${r.chunksTotal}`, errors: r.errors.length, seconds: r.seconds, changes: r.changes ? JSON.stringify(r.changes) : '' })));
  for (const r of reports) if (r.fields) log(`${r.district} fields: ${JSON.stringify(r.fields)}`);
  if (reports.every((r) => r.status === 'failed')) process.exitCode = 1;
}

async function index(): Promise<void> {
  const manifest: IndexManifest = { built: new Date().toISOString(), districts: {} };
  for (const id of chosen) {
    const summary = await writeIndex(indexDir, id, cachedRecords(cacheDir, id));
    if (!summary.records) continue;
    manifest.districts[id] = summary;
    log(`${id}: ${summary.records} records, ${summary.unmatched} without a street address, ${summary.shards} groups, ${(summary.bytes / 1e6).toFixed(1)} MB`);
  }
  await writeFile(join(indexDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
}

const fileLoader = async (d: string, shard: string): Promise<IndexRow[] | null> => {
  try {
    return JSON.parse(await readFile(join(indexDir, d, `${shard}.json`), 'utf8')) as IndexRow[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // The district is indexed but has no street in this group: an empty answer, not a missing district.
      try {
        await readdir(join(indexDir, d));
        return [];
      } catch {
        return null;
      }
    }
    throw error;
  }
};

async function lookupCmd(): Promise<void> {
  const address = process.argv[3]!;
  const out = await lookup(address, chosen, fileLoader);
  console.log(JSON.stringify(out, null, 1));
}

/** Ask the district's live layer for one address, server-side: the official answer to compare with. */
async function liveByAddress(d: District, address: string): Promise<Record<string, unknown>[]> {
  const p = parseAddress(address)!;
  const field = d.fields!.situs[0]!;
  const where = `UPPER(${field}) LIKE '${p.number} %${streetKey(p).replace(/'/g, "''")}%'`;
  const body = await fetchJson<{ features?: { attributes: Record<string, unknown> }[] }>(
    `${d.layer}/query?${new URLSearchParams({ f: 'json', where, outFields: '*', returnGeometry: 'false', resultRecordCount: '200' })}`,
    { timeoutMs: 60_000, retries: 3 }
  );
  return (body.features ?? []).map((f) => f.attributes);
}

/** Whether robots.txt lets a general crawler fetch a path (Disallow rules for * only). */
export function robotsAllow(robots: string, path: string): boolean {
  let applies = false;
  const rules: string[] = [];
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const [k, ...rest] = line.split(':');
    const v = rest.join(':').trim();
    if (/^user-agent$/i.test(k ?? '')) applies = v === '*';
    else if (applies && /^disallow$/i.test(k ?? '') && v) rules.push(v);
  }
  return !rules.some((r) => path.startsWith(r.replace(/\*.*$/, '')));
}

/**
 * Read the district's own account page and check the owner and value TERRA
 * holds appear on it. One request per case, after robots.txt says yes; a
 * page behind a bot check is reported, not worked around.
 */
async function officialPage(url: string, r: IndexRow): Promise<{ url: string; ok: boolean; note: string }> {
  const ua = { 'user-agent': 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)' };
  try {
    const u = new URL(url);
    const robots = await fetch(new URL('/robots.txt', u).href, { headers: ua, signal: AbortSignal.timeout(20_000) }).then((x) => (x.ok ? x.text() : ''));
    if (!robotsAllow(robots, u.pathname + u.search)) return { url, ok: false, note: 'robots.txt disallows the account page; not read' };
    await new Promise((done) => setTimeout(done, 2000));
    const res = await fetch(url, { headers: ua, signal: AbortSignal.timeout(30_000) });
    const html = await res.text();
    if (!res.ok || /captcha|cf-challenge|turnstile/i.test(html)) return { url, ok: false, note: `page refused automated reading (HTTP ${res.status})` };
    const plain = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;/g, ' ').replace(/\s+/g, ' ').toUpperCase();
    const ownerWord = (r.owner ?? '').toUpperCase().split(/\s+/).find((w) => w.length > 2) ?? '';
    const value = r.totalValue != null ? r.totalValue.toLocaleString('en-US') : '';
    const hasOwner = Boolean(ownerWord) && plain.includes(ownerWord);
    const hasValue = Boolean(value) && plain.includes(value);
    const years = [...plain.matchAll(/\b(20[12]\d)\b/g)].map((m) => Number(m[1]));
    return { url, ok: hasOwner && hasValue, note: `owner ${hasOwner ? 'found' : 'NOT found'}, value $${value} ${hasValue ? 'found' : 'NOT found'}, newest year on page ${years.length ? Math.max(...years) : 'none'}` };
  } catch (error) {
    return { url, ok: false, note: `could not read: ${(error as Error).message}` };
  }
}

/**
 * Pick test cases from the index: an address one account holds, an address
 * several accounts share, a typed address that leaves out a direction that
 * tells two streets apart, and a house number nobody has. Check each against
 * the live layer: the same accounts, the same values.
 */
async function verify(): Promise<void> {
  const results: Record<string, unknown>[] = [];
  for (const id of chosen) {
    const d = district(id);
    const bySite = new Map<string, IndexRow[]>();
    const byNoDir = new Map<string, Set<string>>();
    for await (const r of cachedRecords(cacheDir, id)) {
      const p = parseAddress(r.situs);
      if (!p) continue;
      const row = r as unknown as IndexRow;
      const key = formatStreet({ ...p, unit: null, city: null, zip: null });
      (bySite.get(key) ?? bySite.set(key, []).get(key)!).push(row);
      const dir = p.pre ?? p.post;
      if (dir) {
        const k = `${p.number} ${streetKey(p)} ${p.suffix ?? ''}`.trim();
        (byNoDir.get(k) ?? byNoDir.set(k, new Set()).get(k)!).add(dir);
      }
    }
    if (!bySite.size) continue;
    const entries = [...bySite.entries()];
    const single = entries.find(([k, v]) => v.length === 1 && /^\d+ [A-Z]/.test(k) && (v[0]!.totalValue ?? 0) > 100_000);
    const multi = entries.filter(([, v]) => v.length >= 3 && v.length <= 40).sort((a, b) => b[1].length - a[1].length)[0];
    const twoDirs = [...byNoDir.entries()].find(([, dirs]) => dirs.size >= 2);
    const anySite = (single ?? entries[0]!)[0];
    const none = anySite.replace(/^\d+/, '99999');
    const cases = [
      single && { kind: 'exact', address: single[0], expect: 'match', accounts: single[1].map((r) => r.account) },
      multi && { kind: 'multiple parcels', address: multi[0], expect: 'match', accounts: multi[1].map((r) => r.account) },
      twoDirs && { kind: 'ambiguous (direction left out)', address: twoDirs[0], expect: 'ambiguous' },
      { kind: 'no result', address: none, expect: 'none' }
    ].filter(Boolean) as { kind: string; address: string; expect: string; accounts?: string[] }[];
    for (const c of cases) {
      const { result, unavailable } = await lookup(c.address, [id], fileLoader);
      const got = result.status === 'match' ? result.records.map((r) => r.account) : result.status === 'ambiguous' ? result.candidates.map((x) => x.record.account) : [];
      let official: { accounts: string[]; agrees: boolean; valuesAgree?: boolean; note?: string } | undefined;
      if (d.access === 'arcgis' && d.layer) {
        try {
          const live = await liveByAddress(d, c.address);
          const today = new Date().toISOString().slice(0, 10);
          const liveRecords = live.map((a) => normalizeRow(d, a, { retrieved: today, dataset: d.layer! })!).filter(Boolean);
          const { matchAddress } = await import('../appraisal/address.js');
          const liveMatch = matchAddress(c.address, liveRecords, (r) => [r.situs, r.situsCity, r.situsZip].filter(Boolean).join(', '));
          const liveAccounts = liveMatch.status === 'match' ? liveMatch.records.map((r) => r.account) : liveMatch.status === 'ambiguous' ? liveMatch.candidates.map((x) => x.record.account) : [];
          const same = [...liveAccounts].sort().join() === [...got].sort().join();
          const indexed = new Map((result.status === 'match' ? result.records : result.status === 'ambiguous' ? result.candidates.map((x) => x.record) : []).map((r) => [r.account, r.totalValue]));
          const valuesAgree = liveRecords.filter((r) => indexed.has(r.account)).every((r) => indexed.get(r.account) === r.totalValue);
          official = { accounts: liveAccounts, agrees: same && liveMatch.status === result.status, valuesAgree };
        } catch (error) {
          official = { accounts: [], agrees: false, note: `live check failed: ${(error as Error).message}` };
        }
      }
      let page: { url: string; ok: boolean; note: string } | undefined;
      const first = result.status === 'match' ? result.records[0] : undefined;
      if (first?.sourceUrl && d.access === 'arcgis') page = await officialPage(first.sourceUrl, first);
      const row = { district: id, ...c, page, status: result.status, reason: 'reason' in result ? result.reason : undefined, got, passed: result.status === c.expect && (!c.accounts || [...c.accounts].sort().join() === [...got].sort().join()), official, unavailable, sample: result.status === 'match' ? result.records[0] : result.status === 'ambiguous' ? result.candidates[0]?.record : undefined };
      results.push(row);
      log(`${id} ${c.kind}: "${c.address}" → ${result.status} (${got.length}) ${row.passed ? 'PASS' : 'FAIL'}${page ? ` district page: ${page.note}` : ''}${official ? ` official ${official.agrees ? 'agrees' : 'DIFFERS'}${official.valuesAgree === false ? ' (values differ)' : ''}${official.note ? ` ${official.note}` : ''}` : ''}`);
    }
  }
  await writeFile(join(cacheDir, 'verify.json'), JSON.stringify(results, null, 1));
  console.log(JSON.stringify(results, null, 1));
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}

const command = process.argv[2];
const commands: Record<string, () => Promise<void>> = { probe, collect, index, lookup: lookupCmd, verify };
if (!command || !commands[command]) {
  console.error(`usage: appraisal <${Object.keys(commands).join('|')}>`);
  process.exit(2);
}
await commands[command]!();
