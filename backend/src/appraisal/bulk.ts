/**
 * Districts that publish their roll as a downloadable file. The file is kept
 * in the cache with its Last-Modified date, so a later run downloads again
 * only when the district has posted a new one (incremental), and a run that
 * dies after the download starts over from the saved file, not the network.
 */
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import type { CollectOptions, DistrictReport, DistrictState } from './collect.js';
import { finish } from './collect.js';
import type { District } from './districts.js';
import { normalizeRow, resolvedFields } from './normalize.js';

const run = promisify(execFile);
const CHUNK_LINES = 50_000;

/** HTTP Last-Modified of a URL, or null. */
async function lastModified(url: string): Promise<string | null> {
  try {
    const { stdout } = await run('curl', ['-sSfIL', '-m', '60', url], { maxBuffer: 1 << 20 });
    return stdout.match(/^last-modified:\s*(.+)$/im)?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

/** Every line of a file inside a zip, streamed. */
export async function zipLines(zip: string, entry: string, onLine: (line: string) => Promise<void> | void): Promise<void> {
  const child = spawn('unzip', ['-p', zip, entry], { stdio: ['ignore', 'pipe', 'inherit'] });
  child.stdout.setEncoding('latin1');
  for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) await onLine(line);
  const code = await new Promise<number | null>((done) => (child.exitCode != null ? done(child.exitCode) : child.on('close', done)));
  if (code) throw new Error(`unzip ${entry} exited ${code}`);
}

export async function zipEntries(zip: string): Promise<string[]> {
  const { stdout } = await run('unzip', ['-Z1', zip], { maxBuffer: 1 << 24 });
  return stdout.split('\n').filter(Boolean);
}

/** HCAD's real_acct.txt (tab-separated, header line): every Harris County account. */
export async function collectHarris(d: District, opts: CollectOptions & { year?: number; maxLines?: number }): Promise<DistrictReport> {
  const started = Date.now();
  const log = opts.log ?? (() => {});
  const now = opts.now ?? (() => new Date());
  const dir = join(opts.cacheDir, d.id);
  const chunks = join(dir, 'chunks');
  await mkdir(dir, { recursive: true });
  const year = opts.year ?? now().getUTCFullYear();
  let url = `https://download.hcad.org/data/CAMA/${year}/Real_acct_owner.zip`;
  let modified = await lastModified(url);
  let taxYear = year;
  if (!modified) {
    // The new year's folder appears in spring; until then last year's is current.
    url = `https://download.hcad.org/data/CAMA/${year - 1}/Real_acct_owner.zip`;
    modified = await lastModified(url);
    taxYear = year - 1;
  }
  const statePath = join(dir, 'state.json');
  let previous: DistrictState | null = null;
  try {
    previous = JSON.parse(await readFile(statePath, 'utf8')) as DistrictState;
  } catch {}
  if (previous?.completedAt && modified && previous.sourceEdited === modified && !opts.force) {
    log(`${d.id}: unchanged since ${previous.completedAt} (file dated ${modified})`);
    return { district: d.id, status: 'unchanged', records: previous.records, totalIds: previous.totalIds, chunksDone: 1, chunksTotal: 1, errors: [], seconds: 0 };
  }
  const zip = join(dir, 'source.zip');
  const have = await stat(zip).catch(() => null);
  if (!have || previous?.sourceEdited !== modified) {
    log(`${d.id}: downloading ${url}`);
    await run('curl', ['-sSfL', '--retry', '4', '--retry-delay', '15', '-m', '1800', '-o', zip, url], { maxBuffer: 1 << 20 });
  }
  const entry = (await zipEntries(zip)).find((n) => /real_acct\.txt$/i.test(n));
  if (!entry) throw new Error('real_acct.txt not in the zip');
  await rm(chunks, { recursive: true, force: true });
  await mkdir(chunks, { recursive: true });
  const retrieved = now().toISOString().slice(0, 10);
  const state: DistrictState = {
    district: d.id,
    dataset: url,
    startedAt: now().toISOString(),
    completedAt: null,
    sourceEdited: modified,
    totalIds: 0,
    chunkSize: CHUNK_LINES,
    chunksDone: [],
    records: 0,
    fields: {},
    errors: []
  };
  let cols: string[] | null = null;
  let buffer: string[] = [];
  let n = 0;
  let lines = 0;
  const flush = async () => {
    await writeFile(join(chunks, `${n}.ndjson`), buffer.length ? `${buffer.join('\n')}\n` : '');
    state.chunksDone.push(n++);
    buffer = [];
  };
  let stopped = false;
  await zipLines(zip, entry, async (line) => {
    if (stopped) return;
    const row = line.split('\t');
    if (!cols) {
      cols = row.map((c) => c.trim());
      state.fields = resolvedFields(d.fields!, cols);
      return;
    }
    lines++;
    if (opts.maxLines && lines > opts.maxLines) {
      stopped = true;
      return;
    }
    const obj: Record<string, unknown> = {};
    cols.forEach((c, i) => (obj[c] = row[i]));
    const r = normalizeRow(d, obj, { retrieved, dataset: url, taxYear });
    if (r) {
      buffer.push(JSON.stringify(r));
      state.records++;
    }
    if (buffer.length >= CHUNK_LINES) await flush();
  });
  if (buffer.length) await flush();
  state.totalIds = lines;
  await writeFile(statePath, JSON.stringify(state));
  let bytes: number | undefined;
  if (!stopped) bytes = await finish(dir, state, now);
  return {
    district: d.id,
    status: stopped ? 'partial' : 'complete',
    records: state.records,
    totalIds: lines,
    chunksDone: state.chunksDone.length,
    chunksTotal: state.chunksDone.length,
    errors: state.errors,
    changes: state.changes,
    fields: state.fields,
    seconds: Math.round((Date.now() - started) / 1000),
    bytes
  };
}
