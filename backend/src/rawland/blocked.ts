/**
 * Builds the Raw Land output in spatial blocks so memory stays bounded. Holding all 705k outlines and 768k zoning
 * polygons in memory at once ran a 16 GB Windows PC out of memory. Instead:
 *   1. one pass over the outlines records each account's bounding box (numbers only) and so its block;
 *   2. a second pass writes each outline to its account's block file, and one pass over zoning writes each polygon
 *      to every block whose parcels' extent it overlaps;
 *   3. each block is then loaded, indexed and processed on its own, and its tile entries are appended to tile files.
 * Only the small per-account rows, the city-limit index and the city parcel map stay in memory throughout.
 *
 * Progress is kept on disk under `tmp`: the spilled block files, then one finished file per block (written to a temp
 * name and renamed). An interrupted build resumes from there when `key` (the inputs and options) is unchanged; the
 * tiles and rows are assembled from the finished files at the end. `area` limits the build to accounts whose outline
 * centre lies inside a box (a pilot), and zoning is only spilled where those accounts are.
 */
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { gzipSync } from 'node:zlib';
import Flatbush from 'flatbush';
import * as turf from '@turf/turf';
import { PolygonIndex, parcelZoning, cityShares, geomKey, unionPolys, type Poly } from './spatial.js';
import { zoningStatus } from './jurisdiction.js';
import { cityMatch } from './metrics.js';
import { tileKey } from './tiles.js';
import type { AccountRow } from './accountIndex.js';
import type { accountValues } from './values.js';

type Value = ReturnType<typeof accountValues>;
export interface BlockedInput {
  values: Map<string, Value>;
  outlines: () => AsyncIterable<Poly>; // sara-polygons, read twice
  zoning: () => AsyncIterable<Poly>;
  limits: PolygonIndex;
  cityAcct: Map<string, { acres: unknown; polygons: number }>;
  status: { zoning: string; cityLimits: string };
  tmp: string; tilesDir: string;
  block?: number; // degrees per block side
  log?: (m: string) => void;
  /** Timing trial: process only this many blocks, then stop (nothing is meant to be kept). */
  maxBlocks?: number;
  /** Pilot: only accounts whose outline centre is inside [west, south, east, north]. */
  area?: [number, number, number, number];
  /** Identifies the inputs; saved progress is reused only when it matches. */
  key?: string;
  /** Discard saved progress first. */
  restart?: boolean;
  /** Called after each newly finished block (tests use it to simulate an interruption). */
  afterBlock?: (finished: number) => void;
}
export interface BlockedResult { rows: AccountRow[]; tiles: number; noOutline: number; droppedOutlines: number; outsideArea: number; conflicts: number; unavailable: number; blocks: number; resumedBlocks: number }

const idOf = (f: Poly) => String(f.properties.Prop_id ?? '');

/** Buffered appends to many small files, so a pass never holds more than `limit` lines per file. */
class Spill {
  private buf = new Map<string, string[]>(); private n = 0;
  constructor(private readonly dir: string, private readonly limit = 20000) {}
  async add(name: string, line: string): Promise<void> {
    const b = this.buf.get(name) ?? (this.buf.set(name, []).get(name)!); b.push(line);
    if (++this.n >= this.limit) await this.flush();
  }
  async flush(): Promise<void> {
    for (const [name, lines] of this.buf) await appendFile(join(this.dir, name), lines.join('\n') + '\n');
    this.buf.clear(); this.n = 0;
  }
}
async function* readLines(file: string): AsyncGenerator<string> {
  for await (const l of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) if (l) yield l;
}

export async function buildBlocked(inp: BlockedInput): Promise<BlockedResult> {
  const B = inp.block ?? 0.05, log = inp.log ?? (() => {});
  const oDir = join(inp.tmp, 'outlines'), zDir = join(inp.tmp, 'zoning'), dDir = join(inp.tmp, 'done'), tDir = join(inp.tmp, 'tiles');
  const key = JSON.stringify({ key: inp.key ?? '', area: inp.area ?? null, block: B, v: 1 });
  const keyFile = join(inp.tmp, 'key.json'), spilledFile = join(inp.tmp, 'spilled.json');
  const sameKey = existsSync(keyFile) && (await readFile(keyFile, 'utf8')) === key;
  if (inp.restart || !sameKey || inp.maxBlocks != null) await rm(inp.tmp, { recursive: true, force: true });
  await Promise.all([oDir, zDir, dDir, inp.tilesDir].map((d) => mkdir(d, { recursive: true })));
  await writeFile(keyFile, key);
  const inArea = (x: Float64Array) => { const a = inp.area; if (!a) return true; const cx = (x[0]! + x[2]!) / 2, cy = (x[1]! + x[3]!) / 2; return cx >= a[0] && cx <= a[2] && cy >= a[1] && cy <= a[3]; };

  let spilled: { dropped: number; outsideArea: number; accounts: number; blocks: number } | null = null;
  if (existsSync(spilledFile)) spilled = JSON.parse(await readFile(spilledFile, 'utf8'));
  if (spilled) log(`resuming: ${spilled.accounts} accounts already split into ${spilled.blocks} blocks`);
  else {
    // A half-written spill is not resumable; start the spill over.
    await rm(oDir, { recursive: true, force: true }); await rm(zDir, { recursive: true, force: true }); await rm(dDir, { recursive: true, force: true });
    await Promise.all([oDir, zDir, dDir].map((d) => mkdir(d, { recursive: true })));
    // 1. Each account's bounding box (all its outline records together) decides its block.
    const box = new Map<string, Float64Array>(); const dropped = new Set<string>();
    for await (const f of inp.outlines()) {
      const id = idOf(f); if (!f.geometry) continue;
      if (!inp.values.has(id)) { dropped.add(id); continue; }
      const [a, b, c, d] = turf.bbox(f); const x = box.get(id);
      if (!x) box.set(id, Float64Array.of(a, b, c, d)); else { x[0] = Math.min(x[0]!, a); x[1] = Math.min(x[1]!, b); x[2] = Math.max(x[2]!, c); x[3] = Math.max(x[3]!, d); }
    }
    let outsideArea = 0;
    for (const [id, x] of box) if (!inArea(x)) { box.delete(id); outsideArea++; }
    const blockOf = (x: Float64Array) => `${Math.floor((x[0]! + x[2]!) / 2 / B)}_${Math.floor((x[1]! + x[3]!) / 2 / B)}`;
    const extent = new Map<string, number[]>();
    for (const x of box.values()) {
      const k = blockOf(x), e = extent.get(k);
      if (!e) extent.set(k, [x[0]!, x[1]!, x[2]!, x[3]!]); else { e[0] = Math.min(e[0]!, x[0]!); e[1] = Math.min(e[1]!, x[1]!); e[2] = Math.max(e[2]!, x[2]!); e[3] = Math.max(e[3]!, x[3]!); }
    }
    log(`${box.size} accounts with outlines in ${extent.size} blocks${inp.area ? ` (pilot area; ${outsideArea} outside it skipped)` : ''}`);

    // 2. Spill outlines to their account's block, and zoning to every block whose parcel extent it overlaps.
    const so = new Spill(oDir);
    for await (const f of inp.outlines()) { const x = f.geometry ? box.get(idOf(f)) : undefined; if (x) await so.add(blockOf(x), JSON.stringify(f)); }
    await so.flush();
    const keys = [...extent.keys()]; const bi = new Flatbush(Math.max(1, keys.length));
    for (const k of keys) { const e = extent.get(k)!; bi.add(e[0]!, e[1]!, e[2]!, e[3]!); }
    if (!keys.length) bi.add(0, 0, 0, 0);
    bi.finish();
    const sz = new Spill(zDir); let zCopies = 0;
    for await (const z of inp.zoning()) {
      if (!z.geometry || !keys.length) continue;
      const [a, b, c, d] = turf.bbox(z); const hit = bi.search(a, b, c, d); if (!hit.length) continue;
      const line = JSON.stringify(z);
      for (const i of hit) { await sz.add(keys[i]!, line); zCopies++; }
    }
    await sz.flush();
    log(`zoning spilled to blocks (${zCopies} copies)`);
    spilled = { dropped: dropped.size, outsideArea, accounts: box.size, blocks: extent.size };
    await writeFile(`${spilledFile}.tmp`, JSON.stringify(spilled)); await rename(`${spilledFile}.tmp`, spilledFile);
  }

  // 3. Process block by block; each finished block is saved, so a rerun skips it.
  const zFiles = new Set(await readdir(zDir)); const finished = new Set((await readdir(dDir)).filter((f) => !f.endsWith('.tmp')));
  let done = 0, nb = 0, resumedBlocks = 0; const t0 = Date.now();
  for (const name of (await readdir(oDir)).sort()) {
    if (inp.maxBlocks != null && nb >= inp.maxBlocks) break;
    nb++;
    if (finished.has(name)) { resumedBlocks++; continue; }
    const outlines = new Map<string, Poly>();
    for await (const l of readLines(join(oDir, name))) {
      const f = JSON.parse(l) as Poly; const id = idOf(f); const prev = outlines.get(id);
      if (!prev) outlines.set(id, f); else if (geomKey(prev) !== geomKey(f)) outlines.set(id, unionPolys([prev, f]) ?? prev);
    }
    const zoning: Poly[] = [];
    if (zFiles.has(name)) for await (const l of readLines(join(zDir, name))) zoning.push(JSON.parse(l) as Poly);
    const zi = new PolygonIndex(zoning); const out: string[] = [];
    for (const [account, outline] of outlines) {
      const value = inp.values.get(account)!;
      const c = parcelZoning(outline, zi, inp.status.zoning);
      const zs = zoningStatus(inp.status.cityLimits, cityShares(outline, inp.limits), c);
      const bases = 'districts' in c ? [...new Set(c.districts.map((d) => d.code.split(/\s+/)[0]!))] : [];
      const [cx, cy] = turf.centroid(outline).geometry.coordinates as [number, number];
      const row: AccountRow = { account, acres: value.acres, stateCode: value.stateCode, zoningBases: bases, zoningStatus: zs.status, market: value.market, land: value.land, landPsf: value.landPsf, valueStatus: value.status, cx, cy };
      out.push(JSON.stringify({ ...row, cityMatch: cityMatch(value.acres, inp.cityAcct.get(account)), zoning: c, outline: outline.geometry }));
      if (++done % 10000 === 0) log(`${done} accounts (${Math.round(done / ((Date.now() - t0) / 60000))}/min); heap ${Math.round(process.memoryUsage().heapUsed / 2 ** 20)} MB`);
    }
    const f = join(dDir, name); await writeFile(`${f}.tmp`, out.length ? out.join('\n') + '\n' : ''); await rename(`${f}.tmp`, f);
    inp.afterBlock?.(nb - resumedBlocks);
  }
  log(`${done} accounts processed in ${nb - resumedBlocks} blocks${resumedBlocks ? ` (${resumedBlocks} blocks already done)` : ''}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (inp.maxBlocks != null) { await rm(inp.tmp, { recursive: true, force: true }); return { rows: [], tiles: 0, noOutline: 0, droppedOutlines: spilled.dropped, outsideArea: spilled.outsideArea, conflicts: 0, unavailable: 0, blocks: nb, resumedBlocks }; }

  // 4. Assemble rows and tiles from the finished blocks.
  await rm(tDir, { recursive: true, force: true }); await mkdir(tDir, { recursive: true });
  const rows = new Map<string, AccountRow>(); const tiles = new Spill(tDir, 5000); const tileNames = new Set<string>(); let conflicts = 0, unavailable = 0;
  for (const name of (await readdir(dDir)).filter((f) => !f.endsWith('.tmp')).sort()) {
    for await (const l of readLines(join(dDir, name))) {
      const e = JSON.parse(l) as AccountRow & { cityMatch: string; zoning: { districts?: unknown; conflict?: boolean }; outline: unknown };
      const { cityMatch: _m, zoning: c, outline: _o, ...row } = e;
      rows.set(row.account, row);
      if (c && 'districts' in c) { if (c.conflict) conflicts++; } else unavailable++;
      const k = tileKey(row.cx, row.cy); tileNames.add(k); await tiles.add(k, l);
    }
  }
  await tiles.flush();

  // Accounts without an outline stay listed, in the values order like before (a pilot lists only its area).
  const out: AccountRow[] = []; let noOutline = 0;
  for (const [account, value] of inp.values) {
    const r = rows.get(account);
    if (r) { out.push(r); continue; }
    if (inp.area) continue;
    noOutline++;
    out.push({ account, acres: value.acres, stateCode: value.stateCode, zoningBases: [], zoningStatus: 'Outline unavailable', market: value.market, land: value.land, landPsf: value.landPsf, valueStatus: value.status, cx: NaN, cy: NaN });
  }
  for (const k of tileNames) {
    const entries = (await readFile(join(tDir, k), 'utf8')).split('\n').filter(Boolean);
    await writeFile(join(inp.tilesDir, `${k}.json.gz`), gzipSync(`[${entries.join(',')}]`));
  }
  await rm(inp.tmp, { recursive: true, force: true });
  return { rows: out, tiles: tileNames.size, noOutline, droppedOutlines: spilled.dropped, outsideArea: spilled.outsideArea, conflicts, unavailable, blocks: nb, resumedBlocks };
}
