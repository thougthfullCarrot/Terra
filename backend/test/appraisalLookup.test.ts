import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gradeMatch, matchAddress, parseAddress } from '../src/appraisal/address.js';
import { cachedRecords, collectArcgis } from '../src/appraisal/collect.js';
import { district } from '../src/appraisal/districts.js';
import { lookup, shardOf, writeIndex, type IndexRow } from '../src/appraisal/lookup.js';
import { normalizeRow, ringCenter } from '../src/appraisal/normalize.js';
import type { AppraisalRecord } from '../src/appraisal/types.js';

describe('parseAddress', () => {
  it('standardizes suffixes, directions, ordinals, units, city and ZIP', () => {
    expect(parseAddress('1000 North Main Street Suite 200, San Antonio, TX 78205')).toEqual({
      number: '1000', pre: 'N', name: ['MAIN'], suffix: 'ST', post: null, unit: '200', city: 'SAN ANTONIO', zip: '78205'
    });
    expect(parseAddress('301 W 2nd St')).toMatchObject({ pre: 'W', name: ['2'], suffix: 'ST' });
    expect(parseAddress('500 MAIN ST N')).toMatchObject({ pre: null, post: 'N', name: ['MAIN'] });
    expect(parseAddress('12 Oak Ln #4B')).toMatchObject({ unit: '4B', suffix: 'LN' });
  });
  it('keeps a direction or suffix that is the street name', () => {
    expect(parseAddress('100 West Ave')).toMatchObject({ pre: null, name: ['WEST'], suffix: 'AVE' });
    expect(parseAddress('100 Saint Marys St')).toMatchObject({ name: ['ST', 'MARYS'], suffix: 'ST' });
  });
  it('reads highways as street names', () => {
    expect(parseAddress('13735 Interstate 10 W')).toMatchObject({ name: ['IH', '10'], post: 'W' });
    expect(parseAddress('5800 FM 1960 Rd')).toMatchObject({ name: ['FM', '1960'], suffix: 'RD' });
  });
  it('refuses addresses without a house number', () => {
    expect(parseAddress('Main St')).toBeNull();
    expect(parseAddress('0 Main St')).toBeNull();
    expect(parseAddress('')).toBeNull();
  });
});

describe('gradeMatch', () => {
  const g = (a: string, b: string) => gradeMatch(parseAddress(a)!, parseAddress(b)!);
  it('is exact when every part both carry agrees', () => {
    expect(g('100 N Main Street', '100 N MAIN ST')).toBe('exact');
    expect(g('100 Main St N', '100 N MAIN ST')).toBe('exact');
  });
  it('is only probable when one side leaves out a direction, suffix or unit', () => {
    expect(g('100 Main St', '100 N MAIN ST')).toBe('probable');
    expect(g('100 N Main', '100 N MAIN ST')).toBe('probable');
    expect(g('100 Main St Unit 4', '100 MAIN ST')).toBe('probable');
  });
  it('rejects a different number, name, direction, suffix, unit or ZIP', () => {
    expect(g('100 N Main St', '101 N MAIN ST')).toBe('none');
    expect(g('1601 Elm St', '1601 ELMWOOD ST')).toBe('none');
    expect(g('301 S 2nd St', '301 W 2ND ST')).toBe('none');
    expect(g('100 Main St', '100 MAIN AVE')).toBe('none');
    expect(g('100 Main St Unit 4', '100 MAIN ST UNIT 5')).toBe('none');
    expect(g('100 Main St, 78205', '100 MAIN ST, 78210')).toBe('none');
  });
});

describe('matchAddress', () => {
  const rec = (account: string, situs: string, place = 'bexar') => ({ account, situs, place });
  const m = (typed: string, rows: ReturnType<typeof rec>[]) => matchAddress(typed, rows, (r) => r.situs, (r) => r.place);

  it('returns one property, with every parcel at that address', () => {
    const r = m('200 E Houston St', [rec('1', '200 E HOUSTON ST'), rec('2', '200 E HOUSTON ST'), rec('3', '202 E HOUSTON ST')]);
    expect(r.status).toBe('match');
    expect(r.status === 'match' && r.records.map((x) => x.account)).toEqual(['1', '2']);
  });
  it('asks the person to choose when a left-out direction fits two streets', () => {
    const r = m('100 Main St', [rec('1', '100 N MAIN ST'), rec('2', '100 S MAIN ST')]);
    expect(r.status).toBe('ambiguous');
    expect(r.status === 'ambiguous' && r.candidates).toHaveLength(2);
  });
  it('does not silently pick the exact one when a partial one also exists', () => {
    expect(m('100 Main St', [rec('1', '100 MAIN ST'), rec('2', '100 N MAIN ST')]).status).toBe('ambiguous');
  });
  it('keeps the same address in two districts apart', () => {
    const r = m('100 Main St', [rec('1', '100 MAIN ST', 'bexar'), rec('2', '100 MAIN ST', 'comal')]);
    expect(r.status === 'ambiguous' && r.reason).toMatch(/more than one appraisal district/);
  });
  it('separates units only when a unit is typed', () => {
    const rows = [rec('1', '50 OAK LN UNIT 1'), rec('2', '50 OAK LN UNIT 2')];
    expect(m('50 Oak Ln', rows).status).toBe('match');
    const one = m('50 Oak Ln Unit 2', rows);
    expect(one.status === 'match' && one.records.map((x) => x.account)).toEqual(['2']);
  });
  it('says so when nothing is at the address', () => {
    expect(m('9 Nowhere Rd', [rec('1', '10 NOWHERE RD')]).status).toBe('none');
    expect(m('Nowhere Rd', [rec('1', '10 NOWHERE RD')]).status).toBe('none');
  });
});

describe('normalizeRow', () => {
  it('maps Bexar county layer fields and keeps situs and mailing apart', () => {
    const r = normalizeRow(
      district('bexar'),
      { Prop_id: 12345, Prop_yr: 2025, Situs: '100 N MAIN AVE', Owner_name: 'EXAMPLE LLC', Addr_line1: 'PO BOX 1', Addr_city: 'DALLAS', Addr_state: 'TX', Zip: '75201', Land_hstd_val: 40, Land_non_hstd_val: 60, Imprv_hstd_val: 0, Imprv_non_hstd_val: 900, Market_val: 1000, Yr_blt: 1999, State_cd: 'F1', Land_acres: 1, Sq_ft: 5000 },
      { retrieved: '2026-10-18', dataset: 'layer' }
    )!;
    expect(r).toMatchObject({ account: '12345', situs: '100 N MAIN AVE', owner: 'EXAMPLE LLC', mailing: 'PO BOX 1, DALLAS, TX, 75201', landValue: 100, improvementValue: 900, totalValue: 1000, landSqft: 43560, buildingSqft: 5000, yearBuilt: 1999, stateCode: 'F1', valueBasis: 'market', taxYear: 2025 });
    expect(r.sourceUrl).toContain('prop_id=12345');
  });
  it('skips rows without an account', () => {
    expect(normalizeRow(district('bexar'), { Situs: 'x' }, { retrieved: 'x', dataset: 'x' })).toBeNull();
  });
  it('centres a polygon', () => {
    expect(ringCenter({ rings: [[[0, 0], [2, 0], [2, 4], [0, 4], [0, 0]]] })).toEqual({ lng: 1, lat: 2 });
  });
});

const sample = (account: string, situs: string, extra: Partial<AppraisalRecord> = {}): AppraisalRecord => ({
  district: 'bexar', account, sourceUrl: null, situs, situsCity: null, situsZip: null, owner: 'O', mailing: null, landValue: 1, improvementValue: 1, totalValue: 2,
  valueBasis: 'market', taxYear: 2026, stateCode: 'F1', landSqft: null, buildingSqft: null, yearBuilt: null, lat: null, lng: null, retrieved: '2026-10-18', dataset: 'd', ...extra
});

describe('index and lookup', () => {
  it('reads only the street group asked for, and reports a district it cannot read', async () => {
    const out = await mkdtemp(join(tmpdir(), 'appraisal-'));
    const summary = await writeIndex(out, 'bexar', [sample('1', '100 N MAIN AVE'), sample('2', '9 MARKET ST'), sample('3', 'LOT 4 BLK 2')]);
    expect(summary).toMatchObject({ records: 3, unmatched: 1, shards: 2 });
    const asked: string[] = [];
    const load = async (d: string, shard: string) => {
      asked.push(`${d}/${shard}`);
      if (d !== 'bexar') return null;
      return JSON.parse(await readFile(join(out, d, `${shard}.json`), 'utf8')) as IndexRow[];
    };
    const { result, unavailable } = await lookup('100 North Main Avenue', ['bexar', 'comal'], load);
    expect(asked.sort()).toEqual(['bexar/MAI', 'comal/MAI']);
    expect(unavailable).toEqual(['comal']);
    expect(result.status === 'match' && result.records[0]!.account).toBe('1');
    expect(shardOf('')).toBe('_');
  });
});

describe('collectArcgis', () => {
  const layer = district('bexar').layer!;
  function fakeServer(failChunk: number | null) {
    const ids = Array.from({ length: 2500 }, (_, i) => i + 1);
    let fails = failChunk;
    const impl = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
      if (u.startsWith(`${layer}?f=json`)) return json({ maxRecordCount: 1000, objectIdField: 'OBJECTID', editingInfo: { lastEditDate: 42 }, fields: [{ name: 'Prop_id' }, { name: 'Situs' }, { name: 'Market_val' }] });
      if (u.includes('returnIdsOnly')) return json({ objectIds: ids });
      const form = new URLSearchParams(String(init?.body ?? ''));
      const asked = form.get('objectIds')!.split(',').map(Number);
      if (fails != null && asked[0] === fails * 1000 + 1) {
        fails = null;
        return new Response('down', { status: 400 });
      }
      return json({ features: asked.map((id) => ({ attributes: { Prop_id: id, Situs: `${id} MAIN ST`, Market_val: id }, geometry: { rings: [[[-98, 29], [-98.002, 29.002]]] } })) });
    }) as unknown as typeof fetch;
    return impl;
  }

  it('resumes after a failed request and skips an unchanged layer', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'appraisal-'));
    const opts = { cacheDir, sleep: async () => {}, fetchImpl: fakeServer(1) };
    const first = await collectArcgis(district('bexar'), opts);
    expect(first.status).toBe('partial');
    expect(first.chunksDone).toBe(2);
    expect(first.errors).toHaveLength(1);
    const second = await collectArcgis(district('bexar'), { ...opts, fetchImpl: fakeServer(null) });
    expect(second.status).toBe('complete');
    expect(second.records).toBe(2500);
    const third = await collectArcgis(district('bexar'), { ...opts, fetchImpl: fakeServer(null) });
    expect(third.status).toBe('unchanged');
    const rows = [];
    for await (const r of cachedRecords(cacheDir, 'bexar')) rows.push(r);
    expect(rows).toHaveLength(2500);
    expect(rows[0]).toMatchObject({ account: '1', lat: 29.001, lng: -98.001 });
  });

  it('counts added, changed and removed accounts on a forced reread', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'appraisal-'));
    const opts = { cacheDir, sleep: async () => {}, fetchImpl: fakeServer(null) };
    await collectArcgis(district('bexar'), opts);
    const hashes = JSON.parse(await readFile(join(cacheDir, 'bexar', 'hashes.json'), 'utf8'));
    hashes['1'] = 'old';
    delete hashes['2'];
    hashes['gone'] = 'x';
    await writeFile(join(cacheDir, 'bexar', 'hashes.json'), JSON.stringify(hashes));
    const again = await collectArcgis(district('bexar'), { ...opts, force: true });
    expect(again.changes).toEqual({ added: 1, changed: 1, removed: 1, unchanged: 2498 });
  });
});

describe('bulk readers', async () => {
  const { pacsRow, newestExport, PACS_PROP } = await import('../src/appraisal/bulk.js');
  it('reads a PACS 8.0 fixed-width line', () => {
    const line = Array(4500).fill(' ');
    const put = (name: string, value: string) => {
      const [start] = PACS_PROP[name]!;
      for (let i = 0; i < value.length; i++) line[start - 1 + i] = value[i]!;
    };
    put('prop_id', '000000012345');
    put('prop_type_cd', 'R');
    put('prop_val_yr', '2026');
    put('py_owner_name', 'EXAMPLE LP');
    put('situs_num', '100');
    put('situs_street_prefx', 'N');
    put('situs_street', 'MESA');
    put('situs_street_suffix', 'ST');
    put('land_hstd_val', '000000000001000');
    put('land_non_hstd_val', '000000000000500');
    put('imprv_non_hstd_val', '000000000002000');
    put('appraised_val', '000000000003500');
    const row = pacsRow(line.join(''));
    expect(row).toMatchObject({ situs: '100 N MESA ST', land_val: '1500', imprv_val: '2000', py_owner_name: 'EXAMPLE LP', prop_val_yr: '2026' });
    const r = normalizeRow(district('travis'), { ...row, prop_id: '12345' }, { retrieved: 'x', dataset: 'x' })!;
    expect(r).toMatchObject({ account: '12345', situs: '100 N MESA ST', landValue: 1500, improvementValue: 2000, totalValue: 3500, taxYear: 2026 });
  });
  it('picks the newest certified roll export from a downloads page', () => {
    const page = `<a href="/files/2025 Certified Export.zip">a</a><a href="/files/2026%20Certified%20Appraisal%20Export.zip">b</a>
      <a href="/files/2026 Supplement Export.zip">c</a><a href="/files/2026 Export Layout.zip">d</a>`;
    expect(newestExport(page, 'https://cad.example/downloads/')).toEqual({ url: 'https://cad.example/files/2026%20Certified%20Appraisal%20Export.zip', taxYear: 2026 });
    expect(newestExport('<a href="x.pdf">', 'https://cad.example/')).toBeNull();
  });
});

describe('roll quirks', () => {
  it('cuts a city run into the street line', () => {
    const r = normalizeRow(district('bexar'), { Prop_id: 1, Situs: '11502 TANGLEBRIAR TRL AUSTIN 78750', SITUS_CITY: 'AUSTIN' }, { retrieved: 'x', dataset: 'x' })!;
    expect(r.situs).toBe('11502 TANGLEBRIAR TRL');
  });
  it('treats a differently written city as a weaker match, not a miss', () => {
    expect(gradeMatch(parseAddress('1200 Winding Brook Dr, Garland')!, parseAddress('1200 WINDING BROOK DR ,GARLAND (DALLAS CO), TX 75044')!)).toBe('exact');
    expect(gradeMatch(parseAddress('1200 Winding Brook Dr, Mesquite')!, parseAddress('1200 WINDING BROOK DR, GARLAND')!)).toBe('probable');
  });
});

describe('export year', async () => {
  const { newestExport } = await import('../src/appraisal/bulk.js');
  it('ignores run numbers that look like years', () => {
    const page = '<a href="/u/2023/07/2023-07-26_002061_CERTIFIED-ROLL.zip"></a><a href="/u/2026/08/2026-CERTIFIED-ROLL-WEB-EXPORT-W-EXPORT-LAYOUT.zip"></a>';
    expect(newestExport(page, 'https://g.example/')?.taxYear).toBe(2026);
  });
});

describe('a failed collection', () => {
  it('keeps serving the last finished copy while a new read is half done', async () => {
    const { mkdir } = await import('node:fs/promises');
    const { gzipSync } = await import('node:zlib');
    const cache = await mkdtemp(join(tmpdir(), 'appraisal-'));
    await mkdir(join(cache, 'bexar', 'chunks'), { recursive: true });
    await writeFile(join(cache, 'bexar', 'records.ndjson.gz'), gzipSync(`${JSON.stringify({ account: 'OLD' })}\n`));
    await writeFile(join(cache, 'bexar', 'chunks', '0.ndjson'), `${JSON.stringify({ account: 'PARTIAL' })}\n`);
    const got: string[] = [];
    for await (const r of cachedRecords(cache, 'bexar')) got.push(r.account);
    expect(got).toEqual(['OLD']);
  });
});
