import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gradeMatch, matchAddress, parseAddress } from '../src/appraisal/address.js';
import { cachedRecords, collapse, collectArcgis, completeness, finish } from '../src/appraisal/collect.js';
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
      if (u.includes('returnCountOnly')) return json({ count: ids.length });
      if (u.includes('returnIdsOnly')) return json({ objectIds: ids });
      const form = new URLSearchParams(String(init?.body ?? ''));
      const asked = form.get('objectIds')!.split(',').map(Number);
      if (fails != null && asked[0] === fails * 1000 + 1) {
        fails = null;
        return new Response('down', { status: 400 });
      }
      return json({ features: asked.map((id) => ({ attributes: { OBJECTID: id, Prop_id: id, Situs: `${id} MAIN ST`, Market_val: id }, geometry: { rings: [[[-98, 29], [-98.002, 29.002]]] } })) });
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

describe('collapse', () => {
  const base = { district: 'bexar', account: '1', owner: 'A', landValue: 10, totalValue: 100 } as AppraisalRecord;
  it('lists each owner once and keeps values, never summing them', () => {
    const r = collapse([base, { ...base, owner: 'B' }, { ...base, owner: 'A' }]);
    expect(r).toMatchObject({ owner: 'A; B', landValue: 10, totalValue: 100 });
    expect(r.conflicting).toBeUndefined();
  });
  it('flags fields whose repeated rows disagree', () => {
    expect(collapse([base, { ...base, totalValue: 120 }]).conflicting).toEqual(['totalValue']);
  });
});

describe('Bexar agricultural land', () => {
  it('counts ag market value in land, keeps productivity value apart, and reconciles to the market total (SARA raw 2025, read 2026-10-19)', () => {
    const r = normalizeRow(district('bexar'), {
      Prop_id: 175721, Situs: '1 TEST RD', Land_hstd_val: 18430, Land_non_hstd_val: 0, AG_Market: 249510, AG_Use_val: 600,
      Imprv_hstd_val: 138060, Imprv_non_hstd_val: 0, Market_val: 406000, Prop_yr: 2025
    }, { retrieved: 'x', dataset: 'x' })!;
    expect(r).toMatchObject({ landValue: 267940, agMarketValue: 249510, agUseValue: 600, improvementValue: 138060, totalValue: 406000 });
    expect(r.landValue! + r.improvementValue!).toBe(r.totalValue);
    // BCAD's 2025 Appraised (157,090) swaps ag market for ag use value; TERRA's market total must not equal it.
    expect(r.totalValue! - r.agMarketValue! + r.agUseValue!).toBe(157090);
    expect(r.totalValue).not.toBe(157090);
  });
});

describe('completeness and publication', () => {
  const setup = async (state: object | null, finished: boolean) => {
    const { mkdir } = await import('node:fs/promises');
    const { gzipSync } = await import('node:zlib');
    const cache = await mkdtemp(join(tmpdir(), 'appraisal-'));
    await mkdir(join(cache, 'harris'), { recursive: true });
    if (state) await writeFile(join(cache, 'harris', 'state.json'), JSON.stringify(state));
    if (finished) await writeFile(join(cache, 'harris', 'records.ndjson.gz'), gzipSync(''));
    return cache;
  };
  it('counts only a finished read of the current source as complete', async () => {
    expect((await completeness(await setup({ completedAt: '2026-10-18' }, true), 'harris')).complete).toBe(true);
    expect(await completeness(await setup({ completedAt: null }, false), 'harris')).toMatchObject({ complete: false, note: expect.stringContaining('first read') });
    expect(await completeness(await setup({ completedAt: null }, true), 'harris')).toMatchObject({ complete: false, note: expect.stringContaining('newer source') });
    expect((await completeness(await setup(null, false), 'harris')).complete).toBe(false);
  });
  it('never publishes an incomplete, held or unlisted district, and nothing while publication is off', async () => {
    const { publishable, PUBLICATION } = await import('../src/appraisal/publish.js');
    const m = (complete: boolean) => ({ records: 1, unmatched: 0, shards: 1, bytes: 1, taxYear: 2026, dataset: 'x', complete, completeness: complete ? 'ok' : 'pilot' });
    const manifest = { built: 'x', districts: { harris: m(true), dallas: m(false), bexar: m(true), comal: m(true) } };
    expect(PUBLICATION.enabled).toBe(false);
    expect(publishable(manifest).every((d) => !d.publish)).toBe(true);
    const on = publishable(manifest, { ...PUBLICATION, enabled: true });
    expect(Object.fromEntries(on.map((d) => [d.district, d.publish]))).toEqual({ harris: true, dallas: false, bexar: false, comal: false });
    expect(on.find((d) => d.district === 'dallas')!.reason).toMatch(/^incomplete/);
    expect(on.find((d) => d.district === 'bexar')!.reason).toMatch(/^held/);
  });
});

describe('withheld records', () => {
  it('drops an account the new read no longer has instead of carrying it over from the last copy', async () => {
    const { mkdir } = await import('node:fs/promises');
    const { gzipSync, gunzipSync } = await import('node:zlib');
    const dir = await mkdtemp(join(tmpdir(), 'appraisal-'));
    await mkdir(join(dir, 'chunks'), { recursive: true });
    const rec = (account: string, owner: string) => JSON.stringify({ district: 'harris', account, owner, totalValue: 1 });
    await writeFile(join(dir, 'records.ndjson.gz'), gzipSync(`${rec('A', 'X')}\n${rec('B', 'Y')}\n`));
    await writeFile(join(dir, 'hashes.json'), JSON.stringify({ A: 'old', B: 'old' }));
    // B was withheld (e.g. Tax Code 25.025) and A's owner redacted in the new export.
    await writeFile(join(dir, 'chunks', '0.ndjson'), `${rec('A', 'CONFIDENTIAL')}\n`);
    const state = { district: 'harris', completedAt: null, chunksDone: [0], records: 1 } as never;
    await finish(dir, state);
    const kept = gunzipSync(await readFile(join(dir, 'records.ndjson.gz'))).toString().trim().split('\n').map((l) => JSON.parse(l));
    expect(kept).toEqual([expect.objectContaining({ account: 'A', owner: 'CONFIDENTIAL' })]);
    expect((state as { changes: { removed: number } }).changes.removed).toBe(1);
  });
});

describe('collectArcgis proves each reply covers what it asked for', () => {
  const layer = district('bexar').layer!;
  type Mode = { reply: (asked: number[]) => { features: number[]; flagged?: boolean }; exists?: (id: number) => boolean; ids?: number[]; count?: number; editAfter?: number };
  function server(m: Mode) {
    const ids = m.ids ?? [1, 2, 3];
    let infoCalls = 0;
    return (async (url: string, init?: RequestInit) => {
      const u = String(url);
      const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
      if (u.startsWith(`${layer}?f=json`)) {
        infoCalls++;
        const edit = infoCalls > 1 && m.editAfter != null ? m.editAfter : 42;
        return json({ maxRecordCount: 1000, objectIdField: 'OBJECTID', editingInfo: { lastEditDate: edit }, fields: [{ name: 'Prop_id' }, { name: 'Situs' }, { name: 'Market_val' }] });
      }
      if (u.includes('returnCountOnly')) return json({ count: m.count ?? ids.length });
      if (u.includes('returnIdsOnly')) return json({ objectIds: ids });
      const form = new URLSearchParams(String(init?.body ?? ''));
      const asked = form.get('objectIds')!.split(',').map(Number);
      if (form.get('returnIdsOnly')) return json({ objectIds: asked.filter((id) => (m.exists ?? (() => true))(id)) });
      const { features, flagged } = m.reply(asked);
      return json({
        features: features.map((id) => ({ attributes: { OBJECTID: id, Prop_id: id, Situs: `${id} MAIN ST`, Market_val: id }, geometry: { rings: [[[-98, 29], [-98.002, 29.002]]] } })),
        ...(flagged ? { exceededTransferLimit: true } : {})
      });
    }) as unknown as typeof fetch;
  }
  async function run(m: Mode, withPrevious = true) {
    const { mkdir } = await import('node:fs/promises');
    const { gzipSync } = await import('node:zlib');
    const cacheDir = await mkdtemp(join(tmpdir(), 'appraisal-'));
    if (withPrevious) {
      await mkdir(join(cacheDir, 'bexar'), { recursive: true });
      await writeFile(join(cacheDir, 'bexar', 'records.ndjson.gz'), gzipSync(`${JSON.stringify({ account: 'OLD' })}\n`));
      await writeFile(join(cacheDir, 'bexar', 'state.json'), JSON.stringify({ completedAt: '2026-01-01', sourceEdited: 1, chunksDone: [0], totalIds: 1, chunkSize: 1000, records: 1, errors: [] }));
    }
    const report = await collectArcgis(district('bexar'), { cacheDir, sleep: async () => {}, fetchImpl: server(m) });
    const accounts: string[] = [];
    for await (const r of cachedRecords(cacheDir, 'bexar')) accounts.push(r.account);
    return { report, accounts, done: await completeness(cacheDir, 'bexar') };
  }
  const notDone = (r: Awaited<ReturnType<typeof run>>) => {
    expect(r.report.status).toBe('partial');
    expect(r.done.complete).toBe(false);
    expect(r.accounts).toEqual(['OLD']);
  };

  it('does not finish on an empty reply for ids that exist, and keeps the last copy', async () => {
    notDone(await run({ reply: () => ({ features: [] }) }));
  });
  it('asks again for what a transfer limit cut off, and finishes once every id is in', async () => {
    const r = await run({ reply: (asked) => ({ features: asked.slice(0, 1), flagged: asked.length > 1 }) });
    expect(r.report.status).toBe('complete');
    expect(r.accounts.sort()).toEqual(['1', '2', '3']);
    expect(r.done.complete).toBe(true);
  });
  it('does not finish when a short, unflagged reply keeps leaving out an id that exists', async () => {
    notDone(await run({ reply: (asked) => ({ features: asked.filter((id) => id !== 3) }) }));
  });
  it('rejects unrequested and duplicate ids', async () => {
    notDone(await run({ reply: (asked) => ({ features: [...asked, 99] }) }));
    notDone(await run({ reply: (asked) => ({ features: [...asked, asked[0]!] }) }));
  });
  it('accepts an id only once the layer confirms it was deleted during the read', async () => {
    const r = await run({ reply: (asked) => ({ features: asked.filter((id) => id !== 3) }), exists: (id) => id !== 3 });
    expect(r.report.status).toBe('complete');
    expect(r.accounts.sort()).toEqual(['1', '2']);
  });
  it('does not finish a read that spanned a layer edit', async () => {
    notDone(await run({ reply: (asked) => ({ features: asked }), editAfter: 43 }));
  });
  it('refuses a bad id inventory before reading', async () => {
    await expect(run({ reply: (a) => ({ features: a }), ids: [1, 2, 2] })).rejects.toThrow(/duplicate/);
    await expect(run({ reply: (a) => ({ features: a }), count: 4 })).rejects.toThrow(/counts 4/);
  });
});

describe('a bulk refresh marks the old copy incomplete before downloading', async () => {
  const { collectBulk } = await import('../src/appraisal/bulk.js');
  async function seeded() {
    const { mkdir } = await import('node:fs/promises');
    const { gzipSync } = await import('node:zlib');
    const cache = await mkdtemp(join(tmpdir(), 'appraisal-bulk-'));
    await mkdir(join(cache, 'travis'), { recursive: true });
    await writeFile(join(cache, 'travis', 'records.ndjson.gz'), gzipSync(`${JSON.stringify({ account: 'OLD' })}\n`));
    await writeFile(join(cache, 'travis', 'state.json'), JSON.stringify({ district: 'travis', completedAt: '2026-10-01T00:00:00Z', sourceEdited: 'https://x/2026.zip v1', records: 1, chunksDone: [], errors: [] }));
    expect((await completeness(cache, 'travis')).complete).toBe(true);
    return cache;
  }
  const source = { resolve: async () => ({ url: 'https://x/2026.zip', taxYear: 2026, extra: { owners: 'https://x/owners.zip' } }), read: async () => {} };
  const hooks = (download: (url: string, dest: string) => Promise<void>) => ({ source, lastModified: async () => 'v2', download });
  async function afterFailure(cache: string) {
    expect((await completeness(cache, 'travis')).complete).toBe(false);
    const got: string[] = [];
    for await (const r of cachedRecords(cache, 'travis')) got.push(r.account);
    expect(got).toEqual(['OLD']);
    const state = JSON.parse(await readFile(join(cache, 'travis', 'state.json'), 'utf8'));
    expect(state).toMatchObject({ completedAt: null, finishedVersion: 'https://x/2026.zip v1', pendingVersion: 'https://x/2026.zip v2' });
    return state;
  }

  it('the main download fails', async () => {
    const cache = await seeded();
    await expect(collectBulk(district('travis'), { cacheDir: cache, hooks: hooks(async () => { throw new Error('HTTP 503'); }) })).rejects.toThrow('503');
    expect((await afterFailure(cache)).downloaded).toEqual({});
  });

  it('an extra archive fails, and the next run reuses only files of the pending version', async () => {
    const cache = await seeded();
    const fetched: string[] = [];
    const download = async (url: string, dest: string) => {
      fetched.push(url);
      if (url.includes('owners')) throw new Error('HTTP 404');
      await writeFile(dest, 'zip');
    };
    await expect(collectBulk(district('travis'), { cacheDir: cache, hooks: hooks(download) })).rejects.toThrow('404');
    expect((await afterFailure(cache)).downloaded).toEqual({ source: 'https://x/2026.zip v2' });
    await expect(collectBulk(district('travis'), { cacheDir: cache, hooks: hooks(download) })).rejects.toThrow('404');
    expect(fetched).toEqual(['https://x/2026.zip', 'https://x/owners.zip', 'https://x/owners.zip']);
  });

  it('the process is interrupted mid-download', async () => {
    const cache = await seeded();
    let finishDownload!: () => void;
    let started!: () => void;
    const begun = new Promise<void>((r) => (started = r));
    const run = collectBulk(district('travis'), {
      cacheDir: cache,
      hooks: hooks(async (url, dest) => {
        await writeFile(dest, 'half');
        if (url.includes('owners')) throw new Error('stopped');
        started();
        await new Promise<void>((r) => (finishDownload = r));
      })
    });
    await begun;
    // State as a killed process would leave it: the half-written file is never taken as the source.
    const state = await afterFailure(cache);
    expect(state.downloaded).toEqual({});
    finishDownload();
    await run.catch(() => {});
  });
});

describe('verification policy', async () => {
  const { failures, runStatus } = await import('../src/appraisal/verdict.js');
  type C = import('../src/appraisal/verdict.js').CaseChecks;
  const ok: C = { index: { state: 'pass' }, accounts: { state: 'pass' }, values: { state: 'pass' }, page: { state: 'pass' } };
  const full = (c: Partial<C>) => runStatus([{ checks: ok }, { checks: { ...ok, ...c } }], 'full');

  it('passes a full run only when every required check passes', () => {
    expect(full({}).exitCode).toBe(0);
    expect(full({}).summary).toMatch(/^FULL verification: 2\/2/);
  });
  it.each([
    ['a wrong expected lookup', { index: { state: 'fail', note: 'expected match' } }],
    ['an official account mismatch', { accounts: { state: 'fail' } }],
    ['an official value mismatch', { values: { state: 'fail' } }],
    ['a failed account page check', { page: { state: 'fail', note: 'value NOT found' } }],
    ['a live check that could not run', { accounts: { state: 'unavailable', note: 'live check failed' }, values: { state: 'unavailable' } }]
  ] as [string, Partial<C>][])('fails a full run on %s', (_name, c) => {
    expect(full(c).exitCode).toBe(1);
  });
  it('fails a full run that checked nothing', () => {
    expect(runStatus([], 'full').exitCode).toBe(1);
  });
  it('labels unavailable and skipped checks rather than counting them as passes', () => {
    const closed: C = { ...ok, page: { state: 'unavailable', note: 'robots.txt disallows' }, values: { state: 'skipped', note: 'bulk' } };
    const s = runStatus([{ checks: closed }], 'full');
    expect(s.exitCode).toBe(0);
    expect(s.summary).toContain('page 0 pass / 0 fail / 1 unavailable');
    expect(s.summary).toContain('values 0 pass / 0 fail / 0 unavailable / 1 skipped');
  });
  it('a quick run requires the index only and says it is not full verification', () => {
    const s = runStatus([{ checks: { ...ok, values: { state: 'fail' } } }], 'quick');
    expect(s.exitCode).toBe(0);
    expect(s.summary).toMatch(/^QUICK check .*not full verification/);
    expect(failures({ ...ok, index: { state: 'fail' } }, 'quick')).toHaveLength(1);
  });
});

describe('account page value rows', async () => {
  const { pageValue } = await import('../src/appraisal/verdict.js');
  // BCAD's page for account 249983, read 2026-10-18 (value rows only): the Appraised column has no "$".
  const header = 'YEAR IMPROVEMENTS LAND MARKET AG VALUATION APPRAISED HS CAP ASSESSED';
  const bcad = `TAX YEAR: 2027 - VALUES NOT AVAILABLE 2026 2025 2024 2023 TOTAL VALUE: $129,530 ${header} 2026 $69,430 $60,100 0 129,530 $0 $129,530 2025 $65,570 $60,100 0 125,670 $0 $125,670 2024 $71,230 $56,180 0 127,410 $0 $127,410`;

  it("matches a market value to Improvements + Land Market in TERRA's tax-year row", () => {
    const got = pageValue(bcad, 125_670, 2025, 'market');
    expect(got.hasValue).toBe(true);
    expect(got.yearRow?.year).toBe(2025);
    expect(got.compared).toBe('Improvements + Land Market 125,670');
    expect(got.years).toMatch(/newest year with values 2026/);
  });
  it('matches an appraised value to the Appraised column, printed without $', () => {
    expect(pageValue(bcad, 125_670, 2025, 'appraised').hasValue).toBe(true);
  });
  it('still fails a value that is only in another year', () => {
    expect(pageValue(bcad, 129_530, 2025, 'market').hasValue).toBe(false);
    expect(pageValue(bcad, 127_410, 2025, 'market').hasValue).toBe(false);
  });
  it('does not take a digit run inside a larger figure as a match', () => {
    expect(pageValue(bcad, 25_670, 2025, 'market').hasValue).toBe(false);
  });
  it('fails when the requested year has no row, even if the value is elsewhere on the page', () => {
    const got = pageValue(bcad, 127_410, 2023, 'market');
    expect(got.hasValue).toBe(false);
    expect(got.compared).toBe('no 2023 row');
    expect(pageValue(`TOTAL VALUE: $125,670 ${header}`, 125_670, 2025, 'market').hasValue).toBe(false);
  });
  it('does not accept a value that only equals the land or improvements cell', () => {
    expect(pageValue(bcad, 60_100, 2025, 'market').hasValue).toBe(false);
    expect(pageValue(bcad, 65_570, 2025, 'market').hasValue).toBe(false);
    expect(pageValue(bcad, 60_100, 2025, 'appraised').hasValue).toBe(false);
  });
  it('does not treat Appraised or Assessed as market value', () => {
    // Homestead with a cap: market 300,000, appraised 280,000, assessed 280,000.
    const capped = `${header} 2025 $200,000 $100,000 0 280,000 $20,000 $280,000`;
    expect(pageValue(capped, 280_000, 2025, 'market').hasValue).toBe(false);
    expect(pageValue(capped, 300_000, 2025, 'market').hasValue).toBe(true);
    expect(pageValue(capped, 280_000, 2025, 'appraised').hasValue).toBe(true);
  });
  it('counts ag market inside Land Market (BCAD 175721, read raw 2026-10-19)', () => {
    // SARA 2025: Imprv_hstd 138,060, Land_hstd 18,430, AG_Market 249,510, AG_Use 600, Market_val 406,000.
    const ag = `${header} 2026 $130,000 $255,000 500 148,040 $0 $148,040 2025 $138,060 $267,940 600 157,090 $0 $157,090 2024 $170,020 $235,980 880 187,130 $14,658 $172,472`;
    expect(pageValue(ag, 406_000, 2025, 'market').hasValue).toBe(true);
    // Appraised uses the ag use value (406,000 - 249,510 + 600) and must not pass as market.
    expect(pageValue(ag, 157_090, 2025, 'market').hasValue).toBe(false);
    expect(pageValue(ag, 157_090, 2025, 'appraised').hasValue).toBe(true);
  });
  it('fails without the column header or with an unknown basis', () => {
    const row = '2025 $65,570 $60,100 0 125,670 $0 $125,670';
    expect(pageValue(row, 125_670, 2025, 'market').compared).toBe('no column header');
    expect(pageValue(bcad, 125_670, 2025, null).hasValue).toBe(false);
  });
});
