/**
 * Collect appraisal records district by district into a local cache, so a
 * run can stop at any point and pick up where it left off.
 *
 *   <cache>/<district>/state.json        progress, the source's edit date, errors
 *   <cache>/<district>/ids.json          every object id the layer holds (arcgis)
 *   <cache>/<district>/chunks/<n>.ndjson normalized records, one file per request
 *   <cache>/<district>/records.ndjson    the finished district, written when every chunk is in
 *   <cache>/<district>/hashes.json       account → record hash from the last finished run
 *
 * Incremental updates: an ArcGIS layer reports when it was last edited; when
 * that hasn't moved since the last finished run, the district is skipped.
 * Otherwise every chunk is read again and compared to the last run's hashes,
 * so the report says how many accounts were added, changed and removed.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile, appendFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { fetchJson } from '../lib/http.js';
import type { District } from './districts.js';
import { normalizeRow, resolvedFields, ringCenter } from './normalize.js';
import type { AppraisalRecord } from './types.js';

export interface DistrictState {
  district: string;
  dataset: string;
  startedAt: string;
  completedAt: string | null;
  /** The layer's editingInfo.lastEditDate (or a file's Last-Modified) when this run started. */
  sourceEdited: string | number | null;
  totalIds: number;
  chunkSize: number;
  chunksDone: number[];
  records: number;
  fields: Record<string, string | null>;
  errors: { at: string; chunk?: number; message: string }[];
  changes?: { added: number; changed: number; removed: number; unchanged: number };
}

export interface CollectOptions {
  cacheDir: string;
  /** Stop after this many chunks (pilot runs). The state stays resumable. */
  maxChunks?: number;
  /** Start again from scratch even when an unfinished run exists. */
  restart?: boolean;
  /** Read again even if the source says nothing changed. */
  force?: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  log?: (line: string) => void;
}

export interface DistrictReport {
  district: string;
  status: 'complete' | 'partial' | 'unchanged' | 'unsupported' | 'failed';
  records: number;
  totalIds: number;
  chunksDone: number;
  chunksTotal: number;
  errors: DistrictState['errors'];
  changes?: DistrictState['changes'];
  fields?: Record<string, string | null>;
  seconds: number;
  bytes?: number;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function recordHash(r: AppraisalRecord): string {
  const { retrieved: _r, ...rest } = r;
  return createHash('sha1').update(JSON.stringify(rest)).digest('base64').slice(0, 12);
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(value));
  await rename(tmp, path);
}

interface LayerInfo {
  name?: string;
  description?: string;
  copyrightText?: string;
  maxRecordCount?: number;
  editingInfo?: { lastEditDate?: number };
  fields?: { name: string }[];
  objectIdField?: string;
  error?: { message?: string };
}

/** Read one ArcGIS-hosted district. */
export async function collectArcgis(d: District, opts: CollectOptions): Promise<DistrictReport> {
  const started = Date.now();
  const log = opts.log ?? (() => {});
  const sleep = opts.sleep ?? wait;
  const now = opts.now ?? (() => new Date());
  const http = { fetchImpl: opts.fetchImpl, timeoutMs: 90_000, retries: 4, baseDelayMs: 2000 };
  const dir = join(opts.cacheDir, d.id);
  const chunks = join(dir, 'chunks');
  await mkdir(chunks, { recursive: true });
  const statePath = join(dir, 'state.json');
  const layer = d.layer!;

  const info = await fetchJson<LayerInfo>(`${layer}?f=json`, http);
  if (info.error) throw new Error(`layer info: ${info.error.message ?? 'error'}`);
  const oidField = info.objectIdField ?? info.fields?.find((f) => /^objectid$/i.test(f.name))?.name ?? 'OBJECTID';
  const edited = info.editingInfo?.lastEditDate ?? null;
  const chunkSize = Math.min(info.maxRecordCount ?? 1000, 1000);
  const fields = resolvedFields(d.fields!, (info.fields ?? []).map((f) => f.name));

  let state = await readJson<DistrictState>(statePath);
  const finished = state?.completedAt != null;
  if (state && finished && !opts.force && edited != null && state.sourceEdited === edited) {
    log(`${d.id}: unchanged since ${state.completedAt} (layer edit ${edited})`);
    return { district: d.id, status: 'unchanged', records: state.records, totalIds: state.totalIds, chunksDone: state.chunksDone.length, chunksTotal: Math.ceil(state.totalIds / state.chunkSize), errors: [], fields, seconds: 0 };
  }
  const fresh = !state || finished || opts.restart || (edited != null && state.sourceEdited !== edited);
  if (fresh) {
    await rm(chunks, { recursive: true, force: true });
    await mkdir(chunks, { recursive: true });
    const ids = await fetchJson<{ objectIds?: number[]; error?: { message?: string } }>(
      `${layer}/query?${new URLSearchParams({ f: 'json', where: '1=1', returnIdsOnly: 'true' })}`,
      http
    );
    if (ids.error || !ids.objectIds) throw new Error(`object ids: ${ids.error?.message ?? 'none returned'}`);
    const sorted = [...ids.objectIds].sort((a, b) => a - b);
    await writeJson(join(dir, 'ids.json'), sorted);
    state = {
      district: d.id,
      dataset: layer,
      startedAt: now().toISOString(),
      completedAt: null,
      sourceEdited: edited,
      totalIds: sorted.length,
      chunkSize,
      chunksDone: [],
      records: 0,
      fields,
      errors: []
    };
    await writeJson(statePath, state);
    log(`${d.id}: layer "${info.name}" ${JSON.stringify((info.description ?? '').slice(0, 300))} ${JSON.stringify(info.copyrightText ?? '')}`);
    log(`${d.id}: ${sorted.length} parcels, ${Math.ceil(sorted.length / chunkSize)} requests of ${chunkSize}`);
  } else {
    log(`${d.id}: resuming, ${state!.chunksDone.length} of ${Math.ceil(state!.totalIds / state!.chunkSize)} requests already read`);
  }
  const s = state!;
  const ids = (await readJson<number[]>(join(dir, 'ids.json'))) ?? [];
  const total = Math.ceil(ids.length / s.chunkSize);
  const done = new Set(s.chunksDone);
  const retrieved = now().toISOString().slice(0, 10);
  // A layer without a tax-year field usually names its roll year in its description; null when it doesn't.
  const layerYear = Number(`${info.name ?? ''} ${info.description ?? ''} ${info.copyrightText ?? ''}`.match(/\b(20[1-3]\d)\b/)?.[1]) || null;
  let read = 0;
  let failedInRow = 0;
  for (let n = 0; n < total; n++) {
    if (done.has(n)) continue;
    if (opts.maxChunks != null && read >= opts.maxChunks) break;
    const slice = ids.slice(n * s.chunkSize, (n + 1) * s.chunkSize);
    try {
      const body = await fetchJson<{ features?: { attributes: Record<string, unknown>; geometry?: { rings?: number[][][] } }[]; error?: { message?: string } }>(
        `${layer}/query`,
        {
          ...http,
          form: {
            f: 'json',
            objectIds: slice.join(','),
            outFields: '*',
            returnGeometry: 'true',
            outSR: '4326',
            geometryPrecision: '6',
            // Simplify the outline to roughly 10 m: only its centre is kept.
            maxAllowableOffset: '0.0001'
          }
        }
      );
      if (body.error || !body.features) throw new Error(body.error?.message ?? 'no features');
      const lines: string[] = [];
      for (const f of body.features) {
        const c = ringCenter(f.geometry);
        const r = normalizeRow(d, f.attributes, { retrieved, dataset: layer, lat: c?.lat, lng: c?.lng, taxYear: layerYear });
        if (r) lines.push(JSON.stringify(r));
      }
      await writeFile(join(chunks, `${n}.ndjson`), lines.length ? `${lines.join('\n')}\n` : '');
      s.chunksDone.push(n);
      s.records += lines.length;
    } catch (error) {
      s.errors.push({ at: now().toISOString(), chunk: n, message: (error as Error).message.slice(0, 300) });
      log(`${d.id}: request ${n} failed: ${(error as Error).message}`);
      // Five failures in a row means the server is refusing us: stop, keep what's in, resume later.
      if (++failedInRow >= 5) {
        await writeJson(statePath, s);
        break;
      }
      read++;
      continue;
    }
    failedInRow = 0;
    read++;
    if (read % 25 === 0) {
      await writeJson(statePath, s);
      log(`${d.id}: ${s.chunksDone.length}/${total} requests, ${s.records} records`);
    }
    if (d.pauseMs) await sleep(d.pauseMs);
  }
  await writeJson(statePath, s);
  const complete = s.chunksDone.length === total;
  let bytes: number | undefined;
  if (complete) bytes = await finish(dir, s, now);
  return {
    district: d.id,
    status: complete ? 'complete' : 'partial',
    records: s.records,
    totalIds: s.totalIds,
    chunksDone: s.chunksDone.length,
    chunksTotal: total,
    errors: s.errors,
    changes: s.changes,
    fields,
    seconds: Math.round((Date.now() - started) / 1000),
    bytes
  };
}

/** Join the chunks into records.ndjson and compare with the last finished run. */
export async function finish(dir: string, s: DistrictState, now: () => Date = () => new Date()): Promise<number> {
  const chunks = join(dir, 'chunks');
  const names = (await readdir(chunks)).filter((n) => n.endsWith('.ndjson')).sort((a, b) => parseInt(a) - parseInt(b));
  const previous = (await readJson<Record<string, string>>(join(dir, 'hashes.json'))) ?? null;
  const hashes: Record<string, string> = {};
  const out = join(dir, 'records.ndjson.tmp');
  await writeFile(out, '');
  let bytes = 0;
  const changes = { added: 0, changed: 0, removed: 0, unchanged: 0 };
  for (const name of names) {
    const body = await readFile(join(chunks, name), 'utf8');
    bytes += Buffer.byteLength(body);
    await appendFile(out, body);
    for (const line of body.split('\n')) {
      if (!line) continue;
      const r = JSON.parse(line) as AppraisalRecord;
      const h = recordHash(r);
      hashes[r.account] = h;
      if (previous) {
        if (!(r.account in previous)) changes.added++;
        else if (previous[r.account] !== h) changes.changed++;
        else changes.unchanged++;
      }
    }
  }
  if (previous) changes.removed = Object.keys(previous).filter((a) => !(a in hashes)).length;
  await rename(out, join(dir, 'records.ndjson'));
  await writeJson(join(dir, 'hashes.json'), hashes);
  s.completedAt = now().toISOString();
  if (previous) s.changes = changes;
  await writeJson(join(dir, 'state.json'), s);
  return bytes;
}

/** Each finished record of a district, from the cache, streamed line by line (a county can be over 1 GB). */
export async function* cachedRecords(cacheDir: string, id: string): AsyncGenerator<AppraisalRecord> {
  const dir = join(cacheDir, id);
  let files = [join(dir, 'records.ndjson')];
  if (!(await stat(files[0]!).catch(() => null))) {
    // An unfinished (pilot) run: read its chunks.
    const names = await readdir(join(dir, 'chunks')).catch(() => [] as string[]);
    files = names.filter((n) => n.endsWith('.ndjson')).sort((a, b) => parseInt(a) - parseInt(b)).map((n) => join(dir, 'chunks', n));
  }
  for (const file of files) {
    for await (const line of createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity })) if (line) yield JSON.parse(line) as AppraisalRecord;
  }
}
