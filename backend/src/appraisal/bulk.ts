/**
 * Districts that publish their roll as a downloadable file. The file is kept
 * in the cache with its Last-Modified date (or its link, when the district
 * posts a new file under a new name), so a later run downloads again only
 * when the district has posted a new roll (incremental), and a run that dies
 * after the download reads the saved file instead of the network.
 *
 * Each source turns its file(s) into flat rows of named fields; normalizeRow
 * maps those to the shared record with the district's FieldMap, the same way
 * it does for ArcGIS layers.
 */
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { fetchText } from '../lib/http.js';
import { parseCsvLine } from '../market/csv.js';
import type { CollectOptions, DistrictReport, DistrictState } from './collect.js';
import { finish } from './collect.js';
import type { District } from './districts.js';
import { normalizeRow, resolvedFields } from './normalize.js';

const run = promisify(execFile);
const CHUNK_LINES = 50_000;
type Row = Record<string, string>;

/** HTTP Last-Modified of a URL, or null when the server doesn't answer. */
async function lastModified(url: string): Promise<string | null | false> {
  try {
    const { stdout } = await run('curl', ['-sSfIL', '-m', '60', '-A', BROWSER, url], { maxBuffer: 1 << 20 });
    return stdout.match(/^last-modified:\s*(.+)$/im)?.[1]?.trim() ?? null;
  } catch {
    return false;
  }
}
// An honest user agent: a district that refuses it is reported as blocked, not worked around.
const BROWSER = 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)';

/** Every line of a file inside a zip, streamed. A callback answering false stops the read. */
export async function zipLines(zip: string, entry: string, onLine: (line: string) => Promise<unknown> | unknown): Promise<void> {
  const child = spawn('unzip', ['-p', zip, entry], { stdio: ['ignore', 'pipe', 'inherit'] });
  child.stdout.setEncoding('latin1');
  for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
    if ((await onLine(line)) === false) {
      child.kill();
      return;
    }
  }
  const code = await new Promise<number | null>((done) => (child.exitCode != null ? done(child.exitCode) : child.on('close', done)));
  if (code) throw new Error(`unzip ${entry} exited ${code}`);
}

export async function zipEntries(zip: string): Promise<string[]> {
  const { stdout } = await run('unzip', ['-Z1', zip], { maxBuffer: 1 << 24 });
  return stdout.split('\n').filter(Boolean);
}

function pick(names: string[], pattern: RegExp): string {
  const name = names.find((n) => pattern.test(n));
  if (!name) throw new Error(`${pattern} not in the download (has ${names.slice(0, 12).join(', ')})`);
  return name;
}

/** Rows of a delimited file with a header line. */
async function delimited(zip: string, entry: string, split: (line: string) => string[], onRow: (row: Row) => Promise<unknown> | unknown): Promise<void> {
  let cols: string[] | null = null;
  await zipLines(zip, entry, async (line) => {
    if (!line.trim()) return;
    const values = split(line);
    if (!cols) {
      cols = values.map((c) => c.trim());
      return;
    }
    const row: Row = {};
    cols.forEach((c, i) => (row[c] = values[i] ?? ''));
    return onRow(row);
  });
}

const tabs = (l: string) => l.replace(/\r$/, '').split('\t');
const pipes = (l: string) => l.replace(/\r$/, '').split('|');

/**
 * PACS 8.0 appraisal export (Travis, El Paso and most True Automation /
 * Harris Govern districts): fixed-width PROP.TXT, one line per account and
 * year. Positions from the district's "Appraisal Export Layout - 8.0.x".
 */
export const PACS_PROP: Record<string, readonly [number, number]> = {
  prop_id: [1, 12],
  prop_type_cd: [13, 5],
  prop_val_yr: [18, 5],
  geo_id: [547, 50],
  py_owner_name: [609, 70],
  py_addr_line1: [694, 60],
  py_addr_line2: [754, 60],
  py_addr_line3: [814, 60],
  py_addr_city: [874, 50],
  py_addr_state: [924, 50],
  py_addr_zip: [979, 5],
  situs_street_prefx: [1040, 10],
  situs_street: [1050, 50],
  situs_street_suffix: [1100, 10],
  situs_city: [1110, 30],
  situs_zip: [1140, 10],
  legal_acreage: [1660, 16],
  land_hstd_val: [1796, 15],
  land_non_hstd_val: [1811, 15],
  imprv_hstd_val: [1826, 15],
  imprv_non_hstd_val: [1841, 15],
  appraised_val: [1916, 15],
  imprv_state_cd: [2732, 10],
  land_state_cd: [2742, 10],
  situs_num: [4460, 15],
  situs_unit: [4475, 5]
};

export function pacsRow(line: string): Row {
  const row: Row = {};
  for (const [name, [start, length]] of Object.entries(PACS_PROP)) row[name] = line.slice(start - 1, start - 1 + length).trim();
  const n = (k: string) => Number(row[k] || 0);
  row.land_val = String(n('land_hstd_val') + n('land_non_hstd_val'));
  row.imprv_val = String(n('imprv_hstd_val') + n('imprv_non_hstd_val'));
  row.state_cd = row.imprv_state_cd || row.land_state_cd || '';
  row.situs = [row.situs_num, row.situs_street_prefx, row.situs_street, row.situs_street_suffix, row.situs_unit ? `UNIT ${row.situs_unit}` : ''].filter(Boolean).join(' ');
  return row;
}

async function pacs(zip: string, onRow: (row: Row) => Promise<unknown> | unknown, sample: string[]): Promise<void> {
  const names = await zipEntries(zip);
  const land = new Map<string, number>();
  try {
    await zipLines(zip, pick(names, /(^|\/)[^/]*(LAND_DET|APPRAISAL_LAND_DETAIL)\.TXT$/i), (line) => {
      const sqft = Number(line.slice(83, 97).trim());
      if (!sqft) return;
      const id = String(Number(line.slice(0, 12)));
      land.set(id, (land.get(id) ?? 0) + sqft);
    });
  } catch {}
  await zipLines(zip, pick(names, /(^|\/)[^/]*(PROP|APPRAISAL_INFO)\.TXT$/i), async (line) => {
    if (sample.length < 2) sample.push(line.slice(0, 4500));
    const row = pacsRow(line);
    // Real property only: personal property and minerals have no street address to look up.
    if (row.prop_type_cd && row.prop_type_cd !== 'R' && row.prop_type_cd !== 'MH') return;
    row.prop_id = String(Number(row.prop_id));
    const sqft = land.get(row.prop_id);
    if (sqft) row.land_sqft = String(sqft);
    return onRow(row);
  });
}

/**
 * The newest roll export a district's downloads page links to: a .zip whose
 * name says certified, export or appraisal, the latest year first.
 */
export function newestExport(page: string, base: string): { url: string; taxYear: number } | null {
  const links = [...page.matchAll(/href=["']([^"']+\.zip)["']/gi)]
    .map((m) => new URL(m[1]!.replace(/&amp;/g, '&'), base).href)
    .filter((u) => {
      const name = decodeURIComponent(u.split('/').pop()!);
      // "2026-Export-Layout.zip" is only the layout; "2026-CERTIFIED-ROLL-WEB-EXPORT-W-EXPORT-LAYOUT.zip" is the roll with it.
      if (/layout/i.test(name) && !/roll|cert/i.test(name)) return false;
      return /certified|certification|export|appraisal|roll/i.test(name) && !/supplement|personal|mineral|bpp|totals|protest|sales/i.test(name);
    });
  const ranked = links
    // The year in the file name, not the upload folder (/2023/07/2026-CERTIFIED.zip is the 2026 roll).
    .map((url) => ({ url, taxYear: Math.max(0, ...[...decodeURIComponent(url.split('/').pop()!).matchAll(/(?<!\d)20\d\d(?!\d)/g)].map((m) => Number(m[0]))) }))
    .sort((a, b) => b.taxYear - a.taxYear || Number(/certified/i.test(b.url)) - Number(/certified/i.test(a.url)));
  return ranked[0] ?? null;
}

function fromPage(page: string): Source['resolve'] {
  return async (year) => {
    const html = await fetchText(page, { timeoutMs: 60_000, headers: { 'user-agent': BROWSER } });
    const found = newestExport(html, page);
    const all = [...html.matchAll(/href=["']([^"']+\.zip)["']/gi)].map((m) => m[1]);
    console.log(`  ${page}: ${all.length} zip links: ${all.slice(0, 30).join(' ')}`);
    if (!found) throw new Error(`No roll export link on ${page}`);
    return { url: found.url, taxYear: found.taxYear || year };
  };
}

interface Source {
  /** The file to download now and the tax year it holds; `extra` names more files read with it. */
  resolve: (year: number) => Promise<{ url: string; taxYear: number; extra?: Record<string, string> }>;
  read: (zip: string, onRow: (row: Row) => Promise<unknown> | unknown, sample: string[], extra: Record<string, string>) => Promise<void>;
}

const EPCAD = 'https://propertysearch.blob.core.windows.net/abepublicfiles/';
/** Column order of EPCAD's ~-delimited dumps, from its Schemas.txt. */
export const EPCAD_COLUMNS: Record<string, string[]> = {
  Properties: ['dbId', 'PropertyId', 'LegalDescription', 'AgentCode', 'GeoID', 'Type', 'PropertyUseCode', 'PropertyUseDescription', 'Location_Address', 'Location_Neighborhood', 'Location_NeighborhoodCD', 'Location_Mapsco', 'Location_MapID', 'Year'],
  Owners: ['dbId', 'Name', 'OwnerID', 'MailingAddress', 'PercentOwnership', 'Excemptions', 'Property_dbId', 'Year', 'CareOf'],
  Rolls: ['RollId', 'Year', 'Improvements', 'LandMarket', 'AgValuation', 'Appraised', 'HSCap', 'Assessed', 'Property_dbId'],
  Lands: ['LandId', 'Type', 'Description', 'Acres', 'SquareFootage', 'EffFront', 'EffDepth', 'MarketValue', 'ProdValue', 'Property_dbId', 'Year'],
  Improvements: ['ImprovementId', 'Type', 'StateCode', 'LivingArea', 'Value', 'Description', 'ClassCD', 'ExteriorWall', 'YearBuilt', 'SquareFootage', 'Year', 'Property_dbId', 'BuildingId', 'TypeCD']
};

/** Rows of one EPCAD dump: ~ between columns, in Schemas.txt order (a header line, if any, is skipped). */
async function epcadRows(zip: string, table: string, onRow: (row: Row) => unknown, sample?: string[]): Promise<void> {
  const cols = EPCAD_COLUMNS[table]!;
  const entry = (await zipEntries(zip)).find((n) => !n.endsWith('/'))!;
  let first = true;
  await zipLines(zip, entry, (line) => {
    if (!line.trim()) return;
    const v = line.replace(/\r$/, '').split('~');
    if (first) {
      first = false;
      sample?.push(`${table}: ${line.slice(0, 400)}`);
      if (v[0] === cols[0]) return;
    }
    const row: Row = {};
    cols.forEach((c, i) => (row[c] = (v[i] ?? '').replace(/\0/g, '').trim()));
    return onRow(row);
  });
}

const EPCAD_CITIES = /\s((?:EL PASO|SOCORRO|HORIZON CITY|CANUTILLO|ANTHONY|CLINT|SAN ELIZARIO|VINTON|FABENS|TORNILLO|SANTA TERESA)\s*)$/;

async function readEpcad(properties: string, onRow: (row: Row) => unknown, sample: string[], extra: Record<string, string>): Promise<void> {
  // Each table is keyed by the property's database id; the newest year wins where a table holds several.
  const newer = (a: Row | undefined, b: Row) => !a || Number(b.Year || 0) > Number(a.Year || 0);
  const owners = new Map<string, Row>();
  await epcadRows(extra.Owners!, 'Owners', (r) => {
    const had = owners.get(r.Property_dbId!);
    // The largest share in the newest year is the owner of record.
    if (newer(had, r) || (had!.Year === r.Year && Number(r.PercentOwnership || 0) > Number(had!.PercentOwnership || 0))) owners.set(r.Property_dbId!, r);
  }, sample);
  const rolls = new Map<string, Row>();
  await epcadRows(extra.Rolls!, 'Rolls', (r) => {
    // Next year's roll rows exist before they carry values; keep the newest year that has an appraisal.
    if (!r.Appraised?.trim()) return;
    if (newer(rolls.get(r.Property_dbId!), r)) rolls.set(r.Property_dbId!, r);
  }, sample);
  const land = new Map<string, number>();
  await epcadRows(extra.Lands!, 'Lands', (r) => {
    const sqft = Number(r.SquareFootage || 0) || Number(r.Acres || 0) * 43_560;
    if (sqft) land.set(r.Property_dbId!, (land.get(r.Property_dbId!) ?? 0) + sqft);
  }, sample);
  const imps = new Map<string, { area: number; built: number | null; code: string }>();
  await epcadRows(extra.Improvements!, 'Improvements', (r) => {
    const had = imps.get(r.Property_dbId!) ?? { area: 0, built: null, code: '' };
    const built = Number(r.YearBuilt || 0) || null;
    imps.set(r.Property_dbId!, { area: had.area + (Number(r.LivingArea || 0) || 0), built: built && (!had.built || built < had.built) ? built : had.built, code: had.code || r.StateCode || '' });
  }, sample);
  let joined = 0;
  let total = 0;
  await epcadRows(properties, 'Properties', (p) => {
    if (p.Type && !/^r/i.test(p.Type)) return;
    const k = p.dbId!.trim();
    total++;
    if (owners.has(k) || rolls.has(k)) joined++;
    const o = owners.get(k);
    const roll = rolls.get(k);
    const imp = imps.get(k);
    // "700 CRESTAMIRA DR EL PASO, TX": the city is run into the street line.
    const [street = '', ...after] = (p.Location_Address ?? '').split(',');
    const city = street.toUpperCase().match(EPCAD_CITIES)?.[1] ?? '';
    return onRow({
      ...p,
      Location_Address: city ? street.slice(0, street.length - city.length).trim() : [street, ...after].join(',').trim(),
      SitusCity: city.trim(),
      OwnerName: o?.Name ?? '',
      MailingAddress: o?.MailingAddress ?? '',
      LandMarket: roll?.LandMarket ?? '',
      Improvements: roll?.Improvements ?? '',
      Appraised: roll?.Appraised ?? '',
      RollYear: roll?.Year || p.Year || '',
      LandSqft: land.has(k) ? String(Math.round(land.get(k)!)) : '',
      LivingArea: imp?.area ? String(imp.area) : '',
      YearBuilt: imp?.built ? String(imp.built) : '',
      StateCode: imp?.code ?? ''
    });
  }, sample);
  sample.push(`joins: ${owners.size} owners, ${rolls.size} rolls with values, ${land.size} lands, ${imps.size} improvements; ${joined} of ${total} properties matched an owner or roll`);
}

export const BULK_SOURCES: Record<string, Source> = {
  harris: {
    async resolve(year) {
      // The new year's folder appears in spring; until then last year's is current.
      for (const y of [year, year - 1]) {
        const url = `https://download.hcad.org/data/CAMA/${y}/Real_acct_owner.zip`;
        if ((await lastModified(url)) !== false) return { url, taxYear: y };
      }
      throw new Error('No Real_acct_owner.zip for this year or last');
    },
    async read(zip, onRow) {
      const names = await zipEntries(zip);
      // owners.txt lists every owner of an account in order; the first is the owner of record.
      const owners = new Map<string, string>();
      try {
        await delimited(zip, pick(names, /(^|\/)owners\.txt$/i), tabs, (r) => {
          const acct = r.acct?.trim();
          if (acct && !owners.has(acct) && r.name) owners.set(acct, r.name.trim());
        });
      } catch {}
      await delimited(zip, pick(names, /(^|\/)real_acct\.txt$/i), tabs, (r) => {
        const o = owners.get(r.acct?.trim() ?? '');
        if (o) r.owner_name = o;
        return onRow(r);
      });
    }
  },
  tarrant: {
    async resolve(year) {
      return { url: 'https://www.tad.org/content/data-download/PropertyData(Delimited).ZIP', taxYear: year };
    },
    async read(zip, onRow) {
      const names = await zipEntries(zip);
      // RP: R residential and C commercial real property; P (business personal property) and M (minerals) have no place to look up.
      await delimited(zip, names[0]!, pipes, (r) => (r.RP && !['R', 'C'].includes(r.RP.trim()) ? undefined : onRow(r)));
    }
  },
  dallas: {
    async resolve() {
      const page = await fetchText('https://www.dallascad.org/DataProducts.aspx', { timeoutMs: 60_000 });
      const newest = [...page.matchAll(/href="(ViewPDFs\.aspx\?type=3&(?:amp;)?id=[^"]*DCAD(\d{4})_CERTIFIED_\d+\.zip)"/gi)]
        .map((m) => ({ href: m[1]!.replace(/&amp;/g, '&'), year: Number(m[2]) }))
        .sort((a, b) => b.year - a.year)[0];
      if (!newest) throw new Error('No certified roll link on the DCAD data products page');
      return { url: `https://www.dallascad.org/${newest.href.replace(/ /g, '%20')}`, taxYear: newest.year };
    },
    async read(zip, onRow) {
      // Values are in ACCOUNT_APPRL_YEAR; the address and owner in ACCOUNT_INFO.
      const values = new Map<string, Row>();
      await delimited(zip, 'ACCOUNT_APPRL_YEAR.CSV', parseCsvLine, (r) => {
        values.set(r.ACCOUNT_NUM!, { LAND_VAL: r.LAND_VAL!, IMPR_VAL: r.IMPR_VAL!, TOT_VAL: r.TOT_VAL!, SPTD_CODE: r.SPTD_CODE!, APPRAISAL_YR: r.APPRAISAL_YR! });
      });
      await delimited(zip, 'ACCOUNT_INFO.CSV', parseCsvLine, (r) => {
        // Business personal property (BPP) accounts are equipment and inventory, not places.
        if (r.DIVISION_CD && !['RES', 'COM'].includes(r.DIVISION_CD.trim())) return;
        const v = values.get(r.ACCOUNT_NUM!);
        const situs = [r.STREET_NUM, r.STREET_HALF_NUM, r.FULL_STREET_NAME, r.UNIT_ID ? `UNIT ${r.UNIT_ID}` : ''].map((x) => x?.trim()).filter(Boolean).join(' ');
        return onRow({ ...r, ...(v ?? {}), SITUS: situs });
      });
    }
  },
  travis: {
    async resolve() {
      const page = await fetchText('https://traviscad.org/publicinformation', { timeoutMs: 60_000 });
      const newest = [...page.matchAll(/https:\/\/traviscad\.org\/wp-content\/largefiles\/(\d{4})%20Certified%20Appraisal%20Export[^"']*?\.zip/gi)]
        .map((m) => ({ url: m[0], year: Number(m[1]) }))
        .sort((a, b) => b.year - a.year)[0];
      if (!newest) throw new Error('No certified appraisal export link on the TCAD public information page');
      return newest ? { url: newest.url, taxYear: newest.year } : (undefined as never);
    },
    read: pacs
  },
  brazos: { resolve: fromPage('https://brazoscad.org/certified-data-downloads/'), read: pacs },
  galveston: { resolve: fromPage('https://galvestoncad.org/preliminary-and-certified-roll-export-data/'), read: pacs },
  'el-paso': {
    async resolve(year) {
      // The dumps carry next year's number in their names (Properties2027Dump.zip in 2026) and hold current values.
      const y = year + 1;
      const file = (t: string) => `${EPCAD}${t}${y}Dump.zip`;
      return { url: file('Properties'), taxYear: year, extra: { Owners: file('Owners'), Rolls: file('Rolls'), Lands: file('Lands'), Improvements: file('Improvements') } };
    },
    read: readEpcad
  }
};

/** Read one bulk-file district into the cache. */
export async function collectBulk(d: District, opts: CollectOptions & { maxLines?: number }): Promise<DistrictReport> {
  const source = BULK_SOURCES[d.id];
  if (!source) throw new Error(`No bulk reader for ${d.id}`);
  const started = Date.now();
  const log = opts.log ?? (() => {});
  const now = opts.now ?? (() => new Date());
  const dir = join(opts.cacheDir, d.id);
  const chunks = join(dir, 'chunks');
  await mkdir(dir, { recursive: true });
  const { url, taxYear, extra = {} } = await source.resolve(now().getUTCFullYear());
  const modified = (await lastModified(url)) || null;
  // A file posted under a new name is a new roll even when the server sends no date.
  const version = `${url} ${modified ?? ''}`.trim();
  const statePath = join(dir, 'state.json');
  let previous: DistrictState | null = null;
  try {
    previous = JSON.parse(await readFile(statePath, 'utf8')) as DistrictState;
  } catch {}
  if (previous?.completedAt && previous.sourceEdited === version && !opts.force) {
    log(`${d.id}: unchanged since ${previous.completedAt} (${version})`);
    return { district: d.id, status: 'unchanged', records: previous.records, totalIds: previous.totalIds, chunksDone: 1, chunksTotal: 1, errors: [], seconds: 0 };
  }
  const zip = join(dir, 'source.zip');
  const have = await stat(zip).catch(() => null);
  if (!have || previous?.sourceEdited !== version) {
    log(`${d.id}: downloading ${url}`);
    await run('curl', ['-sSfL', '--retry', '4', '--retry-delay', '15', '-A', BROWSER, '-m', '2400', '-o', `${zip}.part`, url], { maxBuffer: 1 << 20 });
    await run('mv', [`${zip}.part`, zip]);
  } else log(`${d.id}: reading the saved download`);
  const extraFiles: Record<string, string> = {};
  for (const [name, link] of Object.entries(extra)) {
    const path = join(dir, `${name}.zip`);
    if (!(await stat(path).catch(() => null)) || previous?.sourceEdited !== version) {
      log(`${d.id}: downloading ${link}`);
      await run('curl', ['-sSfL', '--retry', '4', '--retry-delay', '15', '-A', BROWSER, '-m', '2400', '-o', `${path}.part`, link], { maxBuffer: 1 << 20 });
      await run('mv', [`${path}.part`, path]);
    }
    extraFiles[name] = path;
  }
  // Saved before reading, so a run that dies here reads the same file next time.
  await writeFile(statePath, JSON.stringify({ ...(previous ?? {}), sourceEdited: version, completedAt: null }));
  await rm(chunks, { recursive: true, force: true });
  await mkdir(chunks, { recursive: true });
  const retrieved = now().toISOString().slice(0, 10);
  const state: DistrictState = {
    district: d.id, dataset: url, startedAt: now().toISOString(), completedAt: null, sourceEdited: version,
    totalIds: 0, chunkSize: CHUNK_LINES, chunksDone: [], records: 0, fields: {}, errors: []
  };
  let buffer: string[] = [];
  let n = 0;
  let lines = 0;
  let stopped = false;
  const sample: string[] = [];
  // Some files repeat an account (Tarrant has a line per building); the first line is the account's.
  const seen = new Set<string>();
  let repeated = 0;
  const flush = async () => {
    await writeFile(join(chunks, `${n}.ndjson`), buffer.length ? `${buffer.join('\n')}\n` : '');
    state.chunksDone.push(n++);
    buffer = [];
  };
  await source.read(
    zip,
    async (row) => {
      if (stopped) return false;
      if (!lines) state.fields = { ...resolvedFields(d.fields!, Object.keys(row)), available: Object.keys(row).slice(0, 80).join(',') };
      lines++;
      if (opts.maxLines && lines > opts.maxLines) {
        stopped = true;
        return false;
      }
      const r = normalizeRow(d, row, { retrieved, dataset: url, taxYear });
      if (r && seen.has(r.account)) repeated++;
      else if (r) {
        seen.add(r.account);
        buffer.push(JSON.stringify(r));
        state.records++;
      }
      if (buffer.length >= CHUNK_LINES) await flush();
    },
    sample,
    extraFiles
  );
  if (buffer.length) await flush();
  if (repeated) log(`${d.id}: ${repeated} repeated account lines skipped`);
  for (const line of sample.slice(1, 8)) log(`${d.id}: raw ${JSON.stringify(line.slice(0, 400))}`);
  if (sample.length) log(`${d.id}: first raw line ${JSON.stringify(sample[0]!.replace(/ {3,}/g, (s) => `‹${s.length}›`).slice(0, 1500))}`);
  state.totalIds = Math.min(lines, opts.maxLines ?? Infinity);
  await writeFile(statePath, JSON.stringify(state));
  let bytes: number | undefined;
  if (!stopped) {
    bytes = await finish(dir, state, now);
    // The next run checks the file's date before downloading, so the zips needn't be kept.
    await rm(zip, { force: true });
    for (const path of Object.values(extraFiles)) await rm(path, { force: true });
  }
  return {
    district: d.id,
    status: stopped ? 'partial' : 'complete',
    records: state.records,
    totalIds: state.totalIds,
    chunksDone: state.chunksDone.length,
    chunksTotal: state.chunksDone.length,
    errors: state.errors,
    changes: state.changes,
    fields: state.fields,
    seconds: Math.round((Date.now() - started) / 1000),
    bytes
  };
}
