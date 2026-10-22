/**
 * Raw Land local prototype (Phase 1). Runs only on a local machine; every output goes to local-data/rawland/
 * (gitignored) and nothing is uploaded, published or deployed.
 *
 *   npm run rawland -- collect --source sara-polygons|zoning|city-parcels|city-limits [--restart] [--limits-verified]
 *        (city-limits defaults to the county Cities layer; --limits-url U --limits-city-field F --limits-oid-field O override)
 *   npm run rawland -- build --appraisal-cache DIR [--prev-manifest FILE] [--trial-blocks N] [--area downtown|loop410|W,S,E,N] [--restart]
 *        (--trial-blocks: time the first N blocks only, keep nothing; --area: pilot build of one box; progress is saved
 *         per block and an interrupted build resumes unless --restart)
 *   npm run rawland -- serve [--synthetic] [--port 4173]
 *
 * Values come from #84's Bexar read in the local appraisal cache (`npm run appraisal -- collect --districts bexar
 * --cache DIR`), checked with completeness(); the build refuses unless that and every geometry read are complete.
 */
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip, gunzipSync, gzipSync } from 'node:zlib';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { completeness, cachedRecords } from '../appraisal/collect.js';
import { PUBLICATION } from '../appraisal/publish.js';
import { readFiltered, checkOidField, type Feature } from '../rawland/read.js';
import { collectInto, readState, featuresFile, type SourceState } from '../rawland/store.js';
import { SOURCES } from '../rawland/sources.js';
import { PolygonIndex, parcelZoning, cityShares, geomKey, type Poly } from '../rawland/spatial.js';
import { zoningStatus } from '../rawland/jurisdiction.js';
import { accountValues } from '../rawland/values.js';
import { cityMatch } from '../rawland/metrics.js';
import { assertBuildable, assertNotPublishable, joinOutlines, privacyScan, compareBaseline, BuildRefused, type Manifest } from '../rawland/guards.js';
import { buildBlocked } from '../rawland/blocked.js';
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
    src.layer = arg('--limits-url') ?? src.layer;
    src.jurisdictionField = arg('--limits-city-field') ?? src.jurisdictionField;
    src.oidField = arg('--limits-oid-field') ?? src.oidField;
    if (!src.layer || !src.jurisdictionField) throw new BuildRefused('city limits need a layer and a jurisdiction field (plan D9)');
    src.fields = `${src.oidField},${src.jurisdictionField}`;
  }
  // The layer's own metadata must name the same object id field the paging uses.
  checkOidField(await get(`${src.layer}?f=json`), src.oidField);
  const dir = join(OUT, 'raw', id); const started = Date.now(); let logged = 0;
  const key = { layer: src.layer!, fields: src.fields, oidField: src.oidField };
  const verified = id === 'city-limits' ? args.includes('--limits-verified') : src.verified;
  const st = await collectInto(dir, key, (startAfter, priorRows, onPage) => readFiltered(get, q(src.layer!, id === 'city-parcels' ? 'json' : 'geojson'), { where: '1=1' }, {
    size: src.size, fields: src.fields, oidField: src.oidField, startAfter, priorRows,
    extra: id === 'city-parcels' ? { returnGeometry: 'false' } : { returnGeometry: 'true', outSR: '4326', geometryPrecision: '7' },
    onPage: async (f, last) => { await onPage(f, last); logged += f.length; if (logged >= 50000) { logged = 0; log(`${id}: page through ${src.oidField} ${last}`); } }
  }), { source: id, layer: src.layer!, oidField: src.oidField, ...(src.jurisdictionField ? { jurisdictionField: src.jurisdictionField } : {}), verified, ...(id === 'city-limits' ? { updateDate: 'unknown' } : {}) }, { restart: args.includes('--restart') });
  log(`${id}: ${st.status}${st.reason ? ` (${st.reason})` : ''}, ${st.rows} rows${st.resumedFrom ? ` (resumed after ${st.resumedFrom})` : ''} in ${Math.round((Date.now() - started) / 1000)}s`);
  if (st.status !== 'complete') { log(`${id}: the last complete read is unchanged; rerun to resume${/service reported/.test(st.reason ?? '') ? ', or add --restart if the source changed' : ''}`); process.exitCode = 1; }
}

async function* lines(file: string): AsyncGenerator<Poly> {
  for await (const l of createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity })) if (l) yield JSON.parse(l) as Poly;
}
async function state(id: string) { return (await readState(join(OUT, 'raw', id))) ?? { status: 'failed', reason: 'never collected' } as unknown as SourceState; }
const rawFile = (id: string) => featuresFile(join(OUT, 'raw', id));

/** Pilot areas are plain boxes ([west, south, east, north], WGS84), approximate by design; --area also takes four numbers. */
export const PILOT_AREAS: Record<string, [number, number, number, number]> = {
  downtown: [-98.503, 29.414, -98.479, 29.437], // central business district, roughly ZIP 78205
  loop410: [-98.585, 29.355, -98.405, 29.555] // roughly inside Loop 410
};
function pilotArea(v: string | undefined): { name: string; box: [number, number, number, number] } | null {
  if (!v) return null;
  if (PILOT_AREAS[v]) return { name: v, box: PILOT_AREAS[v]! };
  const n = v.split(',').map(Number);
  if (n.length !== 4 || n.some((x) => !Number.isFinite(x)) || n[0]! >= n[2]! || n[1]! >= n[3]!) throw new BuildRefused(`--area must be ${Object.keys(PILOT_AREAS).join(' | ')} or west,south,east,north`);
  return { name: 'custom', box: n as [number, number, number, number] };
}

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
  // Outlines and zoning are processed in spatial blocks (rawland/blocked.ts) so memory stays bounded.
  log('indexing city limits');
  const cityField = reads['city-limits'].jurisdictionField;
  if (!cityField) throw new BuildRefused('city-limit collection recorded no jurisdiction field; recollect it');
  const limits: Poly[] = []; for await (const f of lines(rawFile('city-limits'))) if (f.geometry) limits.push({ ...f, properties: { city: String(f.properties[cityField] ?? '').trim() } });
  const li = new PolygonIndex(limits);
  // Account matching only (by id): never adds or removes an account, never makes a spatial claim.
  const cityAcct = new Map<string, { acres: unknown; polygons: number }>();
  for await (const f of lines(rawFile('city-parcels'))) {
    const a = (f as unknown as Feature).attributes ?? {}; const id = Number(a.PropID); if (!(id > 0)) continue;
    const k = String(id); const prev = cityAcct.get(k); cityAcct.set(k, { acres: prev ? null : a.legal_acre, polygons: (prev?.polygons ?? 0) + 1 });
  }
  const area = pilotArea(arg('--area'));
  if (area) log(`pilot area: ${area.name} [${area.box.join(', ')}]`);
  const dir = join(OUT, 'build'); await rm(dir, { recursive: true, force: true }); await mkdir(join(dir, 'tiles'), { recursive: true });
  log('processing outlines and zoning in blocks');
  const res = await buildBlocked({
    values: vals, outlines: () => lines(rawFile('sara-polygons')), zoning: () => lines(rawFile('zoning')), limits: li, cityAcct,
    status: { zoning: reads.zoning.status, cityLimits: reads['city-limits'].status }, tmp: join(OUT, 'build-tmp'), tilesDir: join(dir, 'tiles'), log,
    ...(arg('--trial-blocks') ? { maxBlocks: Number(arg('--trial-blocks')) } : {}),
    ...(area ? { area: area.box } : {}),
    key: JSON.stringify({ reads: Object.fromEntries(Object.entries(reads).map(([k, v]) => [k, [v.readAt, v.rows]])), values: values.note }),
    restart: args.includes('--restart')
  });
  if (arg('--trial-blocks')) { await rm(dir, { recursive: true, force: true }); log('timing trial only: nothing kept'); return; }
  const rows = res.rows, { noOutline, droppedOutlines, conflicts, unavailable } = res;
  const tileSample = await Promise.all((await readdir(join(dir, 'tiles'))).slice(0, 50).map(async (f) => JSON.parse(gunzipSync(await readFile(join(dir, 'tiles', f))).toString()) as unknown[]));
  const hits = privacyScan(rows.slice(0, 1000)).concat(...tileSample.map((t) => privacyScan(t)));
  if (hits.length) throw new BuildRefused(`owner/address fields in output: ${hits.slice(0, 5).join(', ')}`);

  await writeFile(join(dir, 'index.json.gz'), gzipSync(JSON.stringify(rows)));
  const manifest: Manifest = {
    built: new Date().toISOString(), pinnedAppraisalCommit: 'dd8a267', sourceYear: 2025,
    counts: { accounts: rows.length, noOutline, droppedOutlines, zoningConflicts: conflicts, coverageUnavailable: unavailable, tiles: res.tiles, ...(area ? { outsidePilotArea: res.outsideArea } : {}) },
    reads: Object.fromEntries(Object.entries(reads).map(([k, v]) => [k, { readAt: v.readAt, rows: v.rows }]))
  };
  const prev = arg('--prev-manifest') ? JSON.parse(await readFile(arg('--prev-manifest')!, 'utf8')) as Manifest : null;
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ ...manifest, ...(area ? { pilot: { area: area.name, box: area.box, note: 'Pilot build: only accounts whose outline centre is inside this box. Counts are not county totals.' } } : {}), changesFromPrevious: compareBaseline(prev, manifest), values: values.note }, null, 1));
  log(`built ${rows.length} accounts, ${res.tiles} tiles; dropped ${droppedOutlines} outlines without values; ${noOutline} accounts without outline`);
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
