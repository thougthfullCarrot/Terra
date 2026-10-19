/**
 * Resumable, replace-on-success storage for one geometry source under local-data/rawland/raw/<id>/:
 *   current/   the last complete read (features.ndjson.gz + state.json); never touched until a new read completes
 *   staging/   the read in progress: one gzip file per validated page plus progress.json, so a rerun resumes
 *   previous/  only exists for an instant during the swap; a crash there is repaired on the next open
 * Each page file and progress.json is written to a temp name and renamed, so a crash leaves at most one orphan
 * page, which resume deletes. The finished output is the page files concatenated (gzip allows multiple members).
 */
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { gzipSync } from 'node:zlib';
import type { Feature, ReadStatus } from './read.js';

export interface Progress { layer: string; fields: string; oidField: string; last: number; rows: number; page: number; startedAt: string }
export interface SourceMeta { source: string; layer: string; oidField: string; jurisdictionField?: string; verified: boolean; updateDate?: string }
export interface SourceState extends SourceMeta { status: ReadStatus; reason: string | null; rows: number; readAt: string; startedAt?: string; pages?: number }
type Reader = (startAfter: number, priorRows: number, onPage: (f: Feature[], last: number) => Promise<void>) => Promise<{ status: ReadStatus; reason: string | null; rows: number }>;

const atomic = async (file: string, data: string | Buffer) => { await writeFile(`${file}.tmp`, data); await rename(`${file}.tmp`, file); };
const pageName = (n: number) => `p${String(n).padStart(6, '0')}.ndjson.gz`;

/** Repairs an interrupted swap: if current/ is missing but previous/ exists, previous/ is restored. */
export async function openSource(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const cur = join(dir, 'current'), prev = join(dir, 'previous');
  if (!existsSync(cur) && existsSync(prev)) await rename(prev, cur);
  else if (existsSync(prev)) await rm(prev, { recursive: true, force: true });
}

export async function readState(dir: string): Promise<SourceState | null> {
  await openSource(dir);
  try { return JSON.parse(await readFile(join(dir, 'current', 'state.json'), 'utf8')) as SourceState; } catch { return null; }
}
export const featuresFile = (dir: string) => join(dir, 'current', 'features.ndjson.gz');

/**
 * Runs or resumes a read. On 'complete' the staged pages replace current/; otherwise current/ is left exactly as
 * it was and staging/ keeps every validated page for the next run. restart discards staging/ first.
 */
export async function collectInto(dir: string, key: { layer: string; fields: string; oidField: string }, read: Reader, meta: SourceMeta, { restart = false, now = () => new Date().toISOString() } = {}): Promise<SourceState & { resumedFrom: number }> {
  await openSource(dir);
  const stage = join(dir, 'staging'), pages = join(stage, 'pages');
  let prog: Progress | null = null;
  if (!restart) { try { prog = JSON.parse(await readFile(join(stage, 'progress.json'), 'utf8')) as Progress; } catch { prog = null; } }
  if (!prog || prog.layer !== key.layer || prog.fields !== key.fields || prog.oidField !== key.oidField) {
    await rm(stage, { recursive: true, force: true }); prog = { ...key, last: -1, rows: 0, page: 0, startedAt: now() };
  }
  await mkdir(pages, { recursive: true });
  for (const f of await readdir(pages)) { const n = Number(f.slice(1, 7)); if (!f.endsWith('.ndjson.gz') || !(n <= prog.page)) await rm(join(pages, f), { force: true }); }
  await atomic(join(stage, 'progress.json'), JSON.stringify(prog));
  const resumedFrom = prog.rows;
  const p = prog;
  const res = await read(p.last, p.rows, async (features, last) => {
    const next = p.page + 1;
    await atomic(join(pages, pageName(next)), gzipSync(features.map((x) => `${JSON.stringify(x)}\n`).join('')));
    Object.assign(p, { last, rows: p.rows + features.length, page: next });
    await atomic(join(stage, 'progress.json'), JSON.stringify(p));
  });
  const state: SourceState = { ...meta, status: res.status, reason: res.reason, rows: res.rows, readAt: now() };
  if (res.status !== 'complete') { await atomic(join(stage, 'last-attempt.json'), JSON.stringify(state, null, 1)); return { ...state, resumedFrom }; }

  // Build the replacement beside current/, then swap with two renames.
  const out = join(dir, 'next'); await rm(out, { recursive: true, force: true }); await mkdir(out);
  const ws = createWriteStream(join(out, 'features.ndjson.gz'));
  for (const f of (await readdir(pages)).filter((x) => x.endsWith('.ndjson.gz')).sort()) await pipeline(createReadStream(join(pages, f)), ws, { end: false });
  await new Promise<void>((r, j) => ws.end((e?: Error | null) => (e ? j(e) : r())));
  await writeFile(join(out, 'state.json'), JSON.stringify({ ...state, startedAt: p.startedAt, pages: p.page }, null, 1));
  const cur = join(dir, 'current'), prev = join(dir, 'previous');
  if (existsSync(cur)) await rename(cur, prev);
  await rename(out, cur);
  await rm(prev, { recursive: true, force: true });
  await rm(stage, { recursive: true, force: true });
  return { ...state, resumedFrom };
}
