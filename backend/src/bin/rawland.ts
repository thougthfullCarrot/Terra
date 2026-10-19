/**
 * Raw Land local prototype (Phase 1). Runs only on a local machine; every output goes to local-data/rawland/
 * (gitignored) and nothing is uploaded, published or deployed.
 *
 *   npm run rawland -- collect --source sara-polygons|zoning|city-parcels|city-limits [--limits-url U --limits-city-field F]
 *   npm run rawland -- build --appraisal-cache DIR [--prev-manifest FILE]
 *   npm run rawland -- serve [--synthetic] [--port 4173]
 *
 * Values come from #84's Bexar read in the local appraisal cache (`npm run appraisal -- collect --districts bexar
 * --cache DIR`), checked with completeness(); the build refuses unless that and every geometry read are complete.
 */
import { execFile } from 'node:child_process';
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip, createGunzip, gzipSync } from 'node:zlib';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { completeness, cachedRecords } from '../appraisal/collect.js';
import { PUBLICATION } from '../appraisal/publish.js';
import { readFiltered, type Feature } from '../rawland/read.js';
import { SOURCES } from '../rawland/sources.js';
import { PolygonIndex, parcelZoning, cityShares, geomKey, type Poly } from '../rawland/spatial.js';
import { zoningStatus } from '../rawland/jurisdiction.js';
import { accountValues } from '../rawland/values.js';
import { cityMatch } from '../rawland/metrics.js';
import { assertBuildable, assertNotPublishable, joinOutlines, privacyScan, compareBaseline, BuildRefused, type Manifest } from '../rawland/guards.js';
import { tileKey } from '../rawland/tiles.js';
import type { AccountRow } from '../rawland/accountIndex.js';
import * as turf from '@turf/turf';
import { synthBuild } from '../rawland/synth.js';
import { rawlandServer } from '../rawland/server.js';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(join(here, '../../../local-data/rawland'));
const args = process.argv.slice(2);
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const log = (m: string) => console.error(`[rawland] ${m}`);
const UA = 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)';
const run = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST the query (long polygons don't fit a URL). curl because Node fetch fails against gis.sara-tx.org. */
async function get(url: string): Promise<unknown> {
  const [base, qs] = url.split('?');
  let last = '';
  for (let t = 0; t < 3; t++) {
    try {
      await sleep(250 + t * 2000); // polite pacing for public servers
      const child = run('curl', ['-sS', '--fail-with-body', '-L', '-m', '120', '-A', UA, '-H', 'Content-Type: application/x-www-form-urlencoded', '--data-binary', '@-', base!], { maxBuffer: 1e9 });
      child.child.stdin?.end(qs);
      return JSON.parse((await child).stdout);
    } catch (e) { last = String((e as Error).message).slice(0, 200); }
  }
  return { _err: last };
}
const q = (layer: string, fmt: string) => (p: Record<string, string>) => `${layer}/query?` + new URLSearchParams({ f: p.returnCountOnly ? 'json' : fmt, ...p });

async function collect(id: keyof typeof SOURCES): Promise<void> {
  const src = { ...SOURCES[id] };
  if (id === 'city-limits') {
    src.layer = arg('--limits-url') ?? null;
    if (!src.layer || !arg('--limits-city-field')) throw new BuildRefused('city limits need --limits-url and --limits-city-field from a verified source (plan D9)');
    src.fields = `OBJECTID,${arg('--limits-city-field')}`;
  }
  const dir = join(OUT, 'raw', id); await mkdir(dir, { recursive: true });
  const file = join(dir, 'features.ndjson.gz'); const gz = createGzip(); const sink = gz.pipe(createWriteStream(file));
  let n = 0; const started = Date.now();
  const res = await readFiltered(get, q(src.layer!, id === 'city-parcels' ? 'json' : 'geojson'), { where: '1=1' }, {
    size: src.size, fields: src.fields, extra: id === 'city-parcels' ? { returnGeometry: 'false' } : { returnGeometry: 'true', outSR: '4326', geometryPrecision: '7' },
    onPage: (f: Feature[]) => { for (const x of f) gz.write(`${JSON.stringify(x)}\n`); n += f.length; if (n % 50000 < f.length) log(`${id}: ${n} rows`); }
  });
  gz.end(); await new Promise<void>((r) => sink.on('finish', () => r()));
  const state = { source: id, layer: src.layer, status: res.status, reason: res.reason, rows: res.rows, pages: res.pages, readAt: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), verified: id === 'city-limits' ? args.includes('--limits-verified') : src.verified };
  await writeFile(join(dir, 'state.json'), JSON.stringify(state, null, 1));
  log(`${id}: ${res.status}${res.reason ? ` (${res.reason})` : ''}, ${res.rows} rows in ${state.seconds}s`);
  if (res.status !== 'complete') process.exitCode = 1;
}

async function* lines(file: string): AsyncGenerator<Poly> {
  for await (const l of createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity })) if (l) yield JSON.parse(l) as Poly;
}
async function state(id: string) { return JSON.parse(await readFile(join(OUT, 'raw', id, 'state.json'), 'utf8').catch(() => '{"status":"failed","reason":"never collected"}')); }

async function build(): Promise<void> {
  const cache = arg('--appraisal-cache'); if (!cache) throw new BuildRefused('--appraisal-cache DIR is required');
  const values = await completeness(resolve(cache), 'bexar');
  const reads = { 'sara-polygons': await state('sara-polygons'), zoning: await state('zoning'), 'city-limits': await state('city-limits'), 'city-parcels': await state('city-parcels') };
  if (!reads['city-limits'].verified) reads['city-limits'] = { ...reads['city-limits'], status: 'incomplete', reason: 'city-limit source not verified (D9)' };
  assertBuildable({ values, reads });
  assertNotPublishable({ built: '', districts: { bexar: { records: 0, unmatched: 0, shards: 0, bytes: 0, taxYear: 2025, dataset: '', complete: values.complete } } }, PUBLICATION);

  log('loading values');
  const vals = new Map<string, ReturnType<typeof accountValues>>();
  for await (const r of cachedRecords(resolve(cache), 'bexar')) vals.set(r.account, accountValues(r));
  log('loading outlines (values lead; others are dropped)');
  const outlines = new Map<string, Poly>();
  for await (const f of lines(join(OUT, 'raw/sara-polygons/features.ndjson.gz'))) {
    const id = String(f.properties.Prop_id ?? ''); if (!f.geometry || !vals.has(id)) continue;
    const prev = outlines.get(id);
    if (!prev) outlines.set(id, f); else if (geomKey(prev) !== geomKey(f)) outlines.set(id, (turf.union(turf.featureCollection([prev, f])) as Poly) ?? prev);
  }
  const { joined, droppedOutlines, noOutline } = joinOutlines(vals, outlines);
  log('indexing zoning and city limits');
  const zoning: Poly[] = []; for await (const f of lines(join(OUT, 'raw/zoning/features.ndjson.gz'))) if (f.geometry) zoning.push(f);
  const cityField = arg('--limits-city-field') ?? 'city';
  const NOT_A_CITY = /^\s*unincorporated\s*$/i;
  const limits: Poly[] = []; for await (const f of lines(join(OUT, 'raw/city-limits/features.ndjson.gz'))) if (f.geometry && !NOT_A_CITY.test(String(f.properties[cityField] ?? ''))) limits.push({ ...f, properties: { city: f.properties[cityField] } });
  const zi = new PolygonIndex(zoning), li = new PolygonIndex(limits);
  // Account matching only (by id): never adds or removes an account, never makes a spatial claim.
  const cityAcct = new Map<string, { acres: unknown; polygons: number }>();
  for await (const f of lines(join(OUT, 'raw/city-parcels/features.ndjson.gz'))) {
    const a = (f as unknown as Feature).attributes ?? {}; const id = Number(a.PropID); if (!(id > 0)) continue;
    const k = String(id); const prev = cityAcct.get(k); cityAcct.set(k, { acres: prev ? null : a.legal_acre, polygons: (prev?.polygons ?? 0) + 1 });
  }

  const rows: AccountRow[] = []; const tiles = new Map<string, unknown[]>(); let conflicts = 0, unavailable = 0, i = 0;
  for (const { account, value, outline } of joined) {
    if (++i % 50000 === 0) log(`${i} accounts`);
    let zs = { status: 'Outline unavailable', cities: [] as string[] }, bases: string[] = [], c = null as ReturnType<typeof parcelZoning> | null;
    let cx = NaN, cy = NaN;
    if (outline) {
      c = parcelZoning(outline, zi, reads.zoning.status);
      zs = zoningStatus(reads['city-limits'].status, cityShares(outline, li), c);
      if ('districts' in c) { bases = [...new Set(c.districts.map((d) => d.code.split(/\s+/)[0]!))]; if (c.conflict) conflicts++; } else unavailable++;
      [cx, cy] = turf.centroid(outline).geometry.coordinates as [number, number];
    }
    const row: AccountRow = { account, acres: value.acres, stateCode: value.stateCode, zoningBases: bases, zoningStatus: zs.status, market: value.market, land: value.land, landPsf: value.landPsf, valueStatus: value.status, cx, cy };
    rows.push(row);
    if (outline) { const k = tileKey(cx, cy); const t = tiles.get(k) ?? []; t.push({ ...row, cityMatch: cityMatch(value.acres, cityAcct.get(account)), zoning: c, outline: outline.geometry }); tiles.set(k, t); }
  }
  const hits = privacyScan(rows.slice(0, 1000)).concat(...[...tiles.values()].slice(0, 50).map((t) => privacyScan(t)));
  if (hits.length) throw new BuildRefused(`owner/address fields in output: ${hits.slice(0, 5).join(', ')}`);

  const dir = join(OUT, 'build'); await mkdir(join(dir, 'tiles'), { recursive: true });
  await writeFile(join(dir, 'index.json.gz'), gzipSync(JSON.stringify(rows)));
  for (const [k, t] of tiles) await writeFile(join(dir, 'tiles', `${k}.json.gz`), gzipSync(JSON.stringify(t)));
  const manifest: Manifest = {
    built: new Date().toISOString(), pinnedAppraisalCommit: '7b7fda3', sourceYear: 2025,
    counts: { accounts: rows.length, noOutline, droppedOutlines, zoningConflicts: conflicts, coverageUnavailable: unavailable, tiles: tiles.size },
    reads: Object.fromEntries(Object.entries(reads).map(([k, v]) => [k, { readAt: v.readAt, rows: v.rows }]))
  };
  const prev = arg('--prev-manifest') ? JSON.parse(await readFile(arg('--prev-manifest')!, 'utf8')) as Manifest : null;
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ ...manifest, changesFromPrevious: compareBaseline(prev, manifest), values: values.note }, null, 1));
  log(`built ${rows.length} accounts, ${tiles.size} tiles; dropped ${droppedOutlines} outlines without values; ${noOutline} accounts without outline`);
}

/** localhost only. --synthetic serves invented data; otherwise the local build (which exists only after build passed its gates). */
async function serve(): Promise<void> {
  let data;
  if (args.includes('--synthetic')) data = synthBuild();
  else {
    const dir = join(OUT, 'build'); const { gunzipSync } = await import('node:zlib'); const { readdir } = await import('node:fs/promises');
    const rows = JSON.parse(gunzipSync(await readFile(join(dir, 'index.json.gz'))).toString());
    const tiles = new Map(); for (const f of await readdir(join(dir, 'tiles'))) tiles.set(f.replace('.json.gz', ''), JSON.parse(gunzipSync(await readFile(join(dir, 'tiles', f))).toString()));
    data = { rows, tiles, manifest: JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) };
  }
  const port = Number(arg('--port') ?? 4173);
  rawlandServer(data).listen(port, '127.0.0.1', () => log(`http://127.0.0.1:${port} (${data.manifest.synthetic ? 'synthetic data' : 'local build'})`));
}

const cmd = args[0];
(cmd === 'collect' ? collect(arg('--source') as keyof typeof SOURCES) : cmd === 'build' ? build() : cmd === 'serve' ? serve() : Promise.reject(new Error('usage: rawland collect --source ... | build --appraisal-cache DIR | serve [--synthetic]')))
  .catch((e) => { log((e as Error).message); process.exitCode = 1; });
