// Raw Land collection: county-layer object id paging, layer metadata, and resumable replace-on-success storage.
import { mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { readFiltered, checkOidField, type Feature } from '../src/rawland/read.js';
import { collectInto, readState, featuresFile, openSource } from '../src/rawland/store.js';
import { SOURCES } from '../src/rawland/sources.js';

// County Cities layer shape: OBJECTID_1 is the object id; OBJECTID is an ordinary field with repeats and gaps.
const county = Array.from({ length: 7 }, (_, i) => ({ attributes: { OBJECTID_1: i + 1, OBJECTID: 3, JURIS: i === 6 ? 'Unincorporated' : `City ${i}` } }));
function layer(rows = county, { failAt = -1 } = {}) {
  const seen: Record<string, string>[] = []; let pages = 0;
  const get = async (u: string) => {
    const p = JSON.parse(u) as Record<string, string>; seen.push(p);
    if (p.returnCountOnly) return { count: rows.length };
    if (pages++ === failAt) return { _err: 'curl: (28) timed out' };
    const m = p.where!.match(/AND (\w+) > (-?\d+)$/)!; const [, field, last] = m;
    const f = rows.filter((r) => (r.attributes as unknown as Record<string, number>)[field!]! > Number(last)).slice(0, Number(p.resultRecordCount));
    return { features: f, exceededTransferLimit: rows.some((r) => r.attributes.OBJECTID_1 > (f.at(-1)?.attributes.OBJECTID_1 ?? Infinity)) };
  };
  return { get, seen };
}
const q = (p: Record<string, string>) => JSON.stringify(p);

describe('county layer object id', () => {
  it('pages, filters and orders on OBJECTID_1 and reads every row once', async () => {
    const { get, seen } = layer();
    const r = await readFiltered(get, q, { where: '1=1' }, { size: 3, fields: 'OBJECTID_1,JURIS', oidField: 'OBJECTID_1' });
    expect(r.status).toBe('complete'); expect(r.features.map((f) => f.attributes!.OBJECTID_1)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const p of seen.filter((x) => !x.returnCountOnly)) { expect(p.where).toMatch(/AND OBJECTID_1 > -?\d+$/); expect(p.orderByFields).toBe('OBJECTID_1 ASC'); }
  });
  it('paging on the plain OBJECTID field of that layer fails instead of returning a short read', async () => {
    const r = await readFiltered(layer().get, q, { where: '1=1' }, { size: 3, fields: 'OBJECTID_1,JURIS', oidField: 'OBJECTID' });
    expect(r.status).not.toBe('complete');
  });
  it('layer metadata must name the configured object id field', () => {
    expect(checkOidField({ objectIdField: 'OBJECTID_1' }, 'OBJECTID_1')).toBe('OBJECTID_1');
    expect(checkOidField({ fields: [{ name: 'OBJECTID', type: 'esriFieldTypeInteger' }, { name: 'OBJECTID_1', type: 'esriFieldTypeOID' }] }, 'OBJECTID_1')).toBe('OBJECTID_1');
    expect(() => checkOidField({ objectIdField: 'OBJECTID_1' }, 'OBJECTID')).toThrow(/OBJECTID_1, configured OBJECTID/);
    expect(() => checkOidField({ error: { code: 400 } }, 'OBJECTID_1')).toThrow();
  });
  it('the city-limits source is configured with OBJECTID_1 and JURIS', () => {
    expect(SOURCES['city-limits']).toMatchObject({ oidField: 'OBJECTID_1', jurisdictionField: 'JURIS', fields: 'OBJECTID_1,JURIS' });
  });
});

describe('resumable collection keeps the last complete output', () => {
  let dir = '';
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });
  const key = { layer: 'L', fields: 'OBJECTID_1,JURIS', oidField: 'OBJECTID_1' };
  const meta = { source: 'city-limits', layer: 'L', oidField: 'OBJECTID_1', jurisdictionField: 'JURIS', verified: true, updateDate: 'unknown' };
  const reader = (get: (u: string) => Promise<unknown>) => (startAfter: number, priorRows: number, onPage: (f: Feature[], last: number) => Promise<void>) =>
    readFiltered(get, q, { where: '1=1' }, { size: 3, fields: key.fields, oidField: 'OBJECTID_1', startAfter, priorRows, onPage });
  const ids = async () => gunzipSync(await readFile(featuresFile(dir))).toString().trim().split('\n').map((l) => JSON.parse(l).attributes.OBJECTID_1);

  it('a failed read leaves the previous output, and the rerun resumes after the last saved page', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rl-'));
    const first = await collectInto(dir, key, reader(layer(county.slice(0, 4)).get), meta);
    expect(first.status).toBe('complete'); expect(await ids()).toEqual([1, 2, 3, 4]);

    const broken = layer(county, { failAt: 1 });
    const second = await collectInto(dir, key, reader(broken.get), meta);
    expect(second.status).toBe('failed');
    expect(await ids()).toEqual([1, 2, 3, 4]); // untouched
    expect((await readState(dir))!.rows).toBe(4);

    const again = layer();
    const third = await collectInto(dir, key, reader(again.get), meta);
    expect(third).toMatchObject({ status: 'complete', rows: 7, resumedFrom: 3 });
    expect(again.seen.find((p) => !p.returnCountOnly)!.where).toMatch(/OBJECTID_1 > 3$/);
    expect(await ids()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it('state records the jurisdiction field and the unknown update date for the build', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rl-'));
    await collectInto(dir, key, reader(layer().get), meta);
    expect(await readState(dir)).toMatchObject({ status: 'complete', jurisdictionField: 'JURIS', oidField: 'OBJECTID_1', updateDate: 'unknown', rows: 7 });
  });
  it('a crash between the two swap renames is repaired from previous/', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rl-'));
    await collectInto(dir, key, reader(layer().get), meta);
    await rename(join(dir, 'current'), join(dir, 'previous'));
    await openSource(dir);
    expect(existsSync(join(dir, 'current'))).toBe(true); expect(await ids()).toHaveLength(7);
  });
  it('a changed field list or --restart discards staged pages instead of mixing them', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rl-'));
    await collectInto(dir, key, reader(layer(county, { failAt: 1 }).get), meta);
    const g = layer(); const r = await collectInto(dir, key, reader(g.get), meta, { restart: true });
    expect(r).toMatchObject({ status: 'complete', resumedFrom: 0 }); expect(await ids()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it('a row added behind the resume point makes the read incomplete and keeps the old output', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rl-'));
    await collectInto(dir, key, reader(layer(county.slice(0, 4)).get), meta);
    await collectInto(dir, key, reader(layer(county, { failAt: 1 }).get), meta);
    const r = await collectInto(dir, key, reader(layer([{ attributes: { OBJECTID_1: 0, OBJECTID: 3, JURIS: 'New city' } }, ...county]).get), meta);
    expect(r.status).toBe('incomplete'); expect(r.reason).toMatch(/service reported 8/); expect(await ids()).toEqual([1, 2, 3, 4]);
  });
});
