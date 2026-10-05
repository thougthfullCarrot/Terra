/**
 * Summarize the county appraisal district rolls for the market data page.
 *
 *   npm run export:appraisal                  # writes ../appraisal.json
 *   npm run export:appraisal -- --out <path>  --only harris,dallas
 *
 * Downloads each district's free bulk file (about 1.5 GB in all, mostly
 * Travis), streams it through `unzip -p`, and keeps only per-city summaries,
 * so the output is a few kilobytes. Meant for a GitHub Actions runner, which
 * has curl and unzip and the disk for it; appraisal.yml runs it weekly.
 *
 * A district that fails keeps its summary from the previous file, so one
 * site being down does not drop its city. Exits non-zero only when no
 * district answered and there is nothing earlier to keep.
 */
import { execFile, spawn } from 'node:child_process';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { fetchText } from '../lib/http.js';
import {
  Aggregator,
  DallasRoll,
  harrisParser,
  tarrantParser,
  tarrantPriorValues,
  travisLandLine,
  travisPropLine,
  type AppraisalFile,
  type CitySummary
} from '../market/appraisal.js';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = resolve(here, '../../../appraisal.json');
const BROWSER = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function download(url: string, dir: string, name: string): Promise<string> {
  const path = join(dir, name);
  await run('curl', ['-sSfL', '--retry', '3', '--retry-delay', '10', '-A', BROWSER, '-m', '1800', '-o', path, url], {
    maxBuffer: 1 << 20
  });
  return path;
}

/** Every line of one file inside a zip, without unpacking it to disk. */
async function eachLine(zip: string, entry: string, onLine: (line: string, index: number) => void): Promise<number> {
  const child = spawn('unzip', ['-p', zip, entry], { stdio: ['ignore', 'pipe', 'inherit'] });
  child.stdout.setEncoding('latin1');
  let index = 0;
  for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) onLine(line, index++);
  const code = await new Promise<number | null>((done) => (child.exitCode != null ? done(child.exitCode) : child.on('close', done)));
  if (code) throw new Error(`unzip ${entry} exited ${code}`);
  return index;
}

async function entries(zip: string): Promise<string[]> {
  const { stdout } = await run('unzip', ['-Z1', zip], { maxBuffer: 1 << 20 });
  return stdout.split('\n').filter(Boolean);
}

const year = new Date().getUTCFullYear();

async function harris(dir: string): Promise<CitySummary> {
  // The current year's file appears in the spring; until then, last year's.
  let zip: string | null = null;
  let rollYear = year;
  for (const y of [year, year - 1]) {
    try {
      zip = await download(`https://download.hcad.org/data/CAMA/${y}/Real_acct_owner.zip`, dir, 'harris.zip');
      rollYear = y;
      break;
    } catch {
      /* try the year before */
    }
  }
  if (!zip) throw new Error('No Real_acct_owner.zip for this year or last');
  const entry = (await entries(zip)).find((name) => /real_acct\.txt$/i.test(name));
  if (!entry) throw new Error('real_acct.txt not in the zip');
  const totals = new Aggregator();
  let parse: ReturnType<typeof harrisParser> | null = null;
  await eachLine(zip, entry, (line, i) => {
    if (i === 0) parse = harrisParser(line);
    else {
      const parcel = parse!(line);
      if (parcel) totals.add(parcel);
    }
  });
  return totals.summary('Houston', 'Harris Central Appraisal District', `${rollYear} roll`);
}

async function dallas(dir: string): Promise<CitySummary> {
  const page = await fetchText('https://www.dallascad.org/DataProducts.aspx', { timeoutMs: 60_000 });
  // e.g. ViewPDFs.aspx?type=3&id=\\DCAD.ORG\...\DCAD2026_CERTIFIED_07232026.zip
  const links = [...page.matchAll(/href="(ViewPDFs\.aspx\?type=3&(?:amp;)?id=[^"]*DCAD(\d{4})_CERTIFIED_\d+\.zip)"/gi)]
    .map((m) => ({ href: m[1]!.replace(/&amp;/g, '&'), year: Number(m[2]) }))
    .sort((a, b) => b.year - a.year);
  const newest = links[0];
  if (!newest) throw new Error('No certified roll link on the data products page');
  const url = `https://www.dallascad.org/${newest.href.replace(/ /g, '%20')}`;
  const zip = await download(url, dir, 'dallas.zip');
  const roll = new DallasRoll();
  await eachLine(zip, 'ACCOUNT_INFO.CSV', (line) => roll.infoLine(line));
  await eachLine(zip, 'LAND.CSV', (line) => roll.landLine(line));
  const totals = new Aggregator();
  await eachLine(zip, 'ACCOUNT_APPRL_YEAR.CSV', (line) => {
    const parcel = roll.yearLine(line);
    if (parcel) totals.add(parcel);
  });
  return totals.summary('Dallas', 'Dallas Central Appraisal District', `${newest.year} certified`);
}

async function tarrant(dir: string): Promise<CitySummary> {
  const base = 'https://www.tad.org/content/data-download/';
  const current = await download(`${base}PropertyData(Delimited).ZIP`, dir, 'tarrant.zip');
  // Last year's certified commercial and residential files, for year-over-year change.
  const prior = new Map<string, number>();
  for (const kind of ['C', 'R']) {
    try {
      const zip = await download(`${base}PropertyData_${kind}_${year - 1}(Certified).ZIP`, dir, `tarrant-${kind}.zip`);
      let read: ReturnType<typeof tarrantPriorValues> | null = null;
      await eachLine(zip, (await entries(zip))[0]!, (line, i) => (i === 0 ? (read = tarrantPriorValues(line)) : read!(line, prior)));
    } catch (error) {
      console.error(`Tarrant ${year - 1} ${kind} file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const totals = new Aggregator();
  let parse: ReturnType<typeof tarrantParser> | null = null;
  let rollYear = year;
  await eachLine(current, (await entries(current))[0]!, (line, i) => {
    if (i === 0) return void (parse = tarrantParser(line));
    if (i === 1) rollYear = Number(line.split('|')[1]) || year;
    const parcel = parse!(line);
    if (!parcel) return;
    totals.add({ ...parcel, priorValue: prior.get(parcel.account) ?? null });
  });
  return totals.summary('Fort Worth', 'Tarrant Appraisal District', `${rollYear} roll`);
}

async function travis(dir: string): Promise<CitySummary> {
  const page = await fetchText('https://traviscad.org/publicinformation', { timeoutMs: 60_000 });
  const links = [...page.matchAll(/https:\/\/traviscad\.org\/wp-content\/largefiles\/(\d{4})%20Certified%20Appraisal%20Export[^"']*?\.zip/gi)]
    .map((m) => ({ url: m[0], year: Number(m[1]) }))
    .sort((a, b) => b.year - a.year);
  const newest = links[0];
  if (!newest) throw new Error('No certified appraisal export link on the public information page');
  const zip = await download(newest.url, dir, 'travis.zip');
  const names = await entries(zip);
  const pick = (pattern: RegExp) => {
    const name = names.find((n) => pattern.test(n));
    if (!name) throw new Error(`${pattern} not in the export`);
    return name;
  };
  const land = new Map<string, number>();
  await eachLine(zip, pick(/(^|\/)LAND_DET\.TXT$/i), (line) => travisLandLine(line, land));
  const totals = new Aggregator();
  await eachLine(zip, pick(/(^|\/)PROP\.TXT$/i), (line) => {
    const parcel = travisPropLine(line, land);
    if (parcel) totals.add(parcel);
  });
  return totals.summary('Austin', 'Travis Central Appraisal District', `${newest.year} certified`);
}

const DISTRICTS: Record<string, (dir: string) => Promise<CitySummary>> = { harris, dallas, tarrant, travis };

async function main(): Promise<void> {
  const out = resolve(flag('--out') ?? DEFAULT_OUT);
  const only = flag('--only')?.split(',');
  let previous: AppraisalFile | null = null;
  try {
    previous = JSON.parse(await readFile(out, 'utf8')) as AppraisalFile;
  } catch {
    /* first run */
  }

  const cities: CitySummary[] = [];
  let answered = 0;
  for (const [name, read] of Object.entries(DISTRICTS)) {
    if (only && !only.includes(name)) continue;
    const dir = await mkdtemp(join(tmpdir(), `cad-${name}-`));
    const started = Date.now();
    try {
      const summary = await read(dir);
      answered++;
      cities.push(summary);
      const usd = (v: number | null) => (v == null ? 'n/a' : `$${v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2)}`);
      const parts = Object.entries(summary.classes).map(
        ([cls, s]) =>
          `${cls} ${s.parcels} parcels, median ${usd(s.medianValue)}, total ${usd(s.totalValue)}, ` +
          `change ${s.valueGrowth == null ? 'n/a' : `${s.valueGrowth.toFixed(1)}%`}, ` +
          `land ${usd(s.landPsf)}/sq ft avg, ${usd(s.medianLandPsf)} median on ${s.landParcels}`
      );
      console.log(`${name}: ${summary.city} ${summary.period}: ${parts.join('; ')} (${Math.round((Date.now() - started) / 1000)}s)`);
    } catch (error) {
      console.error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  // Keep a district's earlier summary when it did not answer this time.
  for (const old of previous?.cities ?? []) {
    if (!cities.some((c) => c.city === old.city)) cities.push(old);
  }
  if (!cities.length) {
    console.error('No appraisal district answered and there is no earlier file.');
    process.exitCode = 1;
    return;
  }
  const file: AppraisalFile = { generatedAt: new Date().toISOString(), cities };
  await writeFile(out, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`Wrote ${out} (${answered} districts answered, ${cities.length} cities)`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `answered=${answered}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
