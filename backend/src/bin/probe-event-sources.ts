/**
 * Try candidate event calendars and print which machine-readable feed each one
 * answers with (temporary discovery helper; run from a GitHub runner, since
 * the sandbox cannot reach these hosts). One request at a time, one retry.
 *
 *   npx tsx src/bin/probe-event-sources.ts
 */
import { fetchJson, fetchText } from '../lib/http.js';
import { parseIcs, parseJsonLdEvents, parseLocalist, parseTribe, localistUrl, tribeUrl, RELEVANT, type EventSource } from '../events/events.js';

const CANDIDATES: Array<[string, string]> = [
  // NAIOP chapters
  ['naiop-austin', 'https://naiopaustin.org'], ['naiop-austin2', 'https://www.naiopaustin.org'],
  ['naiop-sa', 'https://www.naiopsa.org'], ['naiop-sa2', 'https://naiopsanantonio.org'],
  ['naiop-houston', 'https://www.naiophouston.org'], ['naiop-ntx', 'https://www.naiopntx.org'],
  ['naiop-ntx2', 'https://naiopnorthtexas.org'], ['naiop-elpaso', 'https://www.naiopelpaso.org'],
  // BOMA
  ['boma-sa', 'https://www.bomasa.org'], ['boma-austin', 'https://www.bomaaustin.org'], ['boma-fw', 'https://www.bomafw.org'],
  ['boma-elpaso', 'https://www.bomaelpaso.org'],
  // SIOR
  ['sior-texas', 'https://www.siortexas.org'], ['sior-ntx', 'https://siornorthtexas.org'], ['sior-ctx', 'https://www.siorcentraltexas.org'],
  // Realtor associations
  ['sabor', 'https://www.sabor.com'], ['abor', 'https://www.abor.com'], ['lar', 'https://www.lubbockrealtors.com'],
  ['mar', 'https://www.midlandrealtors.com'], ['gepar', 'https://www.gepar.org'], ['bcsar', 'https://www.bcsrealtors.com'],
  ['gcar', 'https://www.gcar.net'], ['4rar', 'https://www.4rar.com'], ['metrotex', 'https://www.dfwmetrotex.com'],
  ['grfwar', 'https://www.gfwar.org'], ['txrealtors', 'https://www.texasrealtors.com'],
  // CRE groups
  ['creda-sa', 'https://www.credasa.org'], ['reca', 'https://www.recaustin.org'], ['ulisa', 'https://sanantonio.uli.org'],
  ['ccim-tx', 'https://www.ccimtexas.com'], ['tx-ccim', 'https://texasccim.com'], ['ifma-sa', 'https://www.ifmasa.org'],
  ['aia-austin', 'https://www.aiaaustin.org'], ['aia-dallas', 'https://www.aiadallas.org'], ['aia-houston', 'https://aiahouston.org'],
  ['tab', 'https://www.tabb.org'], ['ccim-ntx', 'https://www.ntxccim.com'], ['crej', 'https://www.realestateforums.com'],
  ['bisnow', 'https://www.bisnow.com'],
  // Chambers / economic development
  ['austin-chamber', 'https://www.austinchamber.com'], ['austin-chamber-gz', 'https://business.austinchamber.com'],
  ['galveston-chamber', 'https://business.galvestonchamber.com'], ['galveston-chamber2', 'https://www.galvestonchamber.com'],
  ['dallas-chamber', 'https://www.dallaschamber.org'], ['ghp', 'https://www.houston.org'], ['gsachamber', 'https://www.sachamber.org'],
  ['gsachamber-gz', 'https://business.sachamber.org'], ['hispanic-sa', 'https://business.sahcc.org'],
  ['nb-edc', 'https://www.nbedc.org'], ['midland-dc', 'https://www.midlandtexas.com'], ['lubbock-edc', 'https://www.lubbockeda.org'],
  ['bvedc', 'https://www.bvedc.org'], ['epdevelopment', 'https://www.borderplexalliance.org'], ['odessa-chamber', 'https://business.odessachamber.com'],
  ['austin-ypc', 'https://business.austinchamber.com'], ['rrchamber', 'https://business.roundrockchamber.org'],
  ['frisco-chamber', 'https://business.friscochamber.com'], ['arlington-chamber', 'https://business.arlingtontx.com'],
  ['katy-chamber', 'https://business.katychamber.com'], ['sugarland-chamber', 'https://business.fortbendchamber.org'],
  ['elpaso-hcc', 'https://business.ephcc.org'], ['nb-chamber', 'https://newbraunfelschamber.growthzoneapp.com'],
  ['cs-city', 'https://www.cstx.gov'], ['galveston-city', 'https://www.galvestontx.gov'],
];

const LOCALIST = [
  'https://events.utep.edu', 'https://calendar.tamu.edu', 'https://calendar.tamug.edu', 'https://events.tamug.edu', 'https://events.ttu.edu',
  'https://calendar.ttu.edu', 'https://www.utsa.edu', 'https://calendar.utsa.edu', 'https://events.utsa.edu', 'https://events.uh.edu', 'https://uh.edu',
  'https://events.rice.edu', 'https://calendar.rice.edu', 'https://calendar.smu.edu', 'https://www.smu.edu', 'https://events.tcu.edu', 'https://calendar.tcu.edu',
  'https://calendar.txstate.edu', 'https://events.txstate.edu', 'https://events.trinity.edu', 'https://calendar.trinity.edu', 'https://events.stmarytx.edu',
  'https://calendar.utpb.edu', 'https://events.utpb.edu', 'https://calendar.uttyler.edu', 'https://events.tamusa.edu', 'https://calendar.baylor.edu',
  'https://calendar.uhcl.edu', 'https://events.uhd.edu', 'https://calendar.stedwards.edu', 'https://events.tsu.edu', 'https://calendar.mays.tamu.edu',
  'https://calendar.utexas.edu', 'https://calendar.unt.edu', 'https://calendar.utdallas.edu', 'https://events.uta.edu'
];

const src = (key: string, base: string): EventSource => ({ key, base, organizer: key, city: 'Dallas', kind: 'tribe', keyword: 'real estate' });
const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 80);
const sample = (titles: string[]) => titles.filter((t) => RELEVANT.test(t)).slice(0, 4).join(' | ');

async function tryOne(label: string, run: () => Promise<string[]>): Promise<string> {
  try {
    const titles = await run();
    return `${label}=${titles.length}${titles.length ? ` [${sample(titles)}]` : ''}`;
  } catch (e) {
    return `${label}=ERR(${short(e)})`;
  }
}

async function main(): Promise<void> {
  const now = new Date();
  const opt = { retries: 1, timeoutMs: 12_000 };
  for (const [key, base] of CANDIDATES) {
    const s = src(key, base);
    const results = [
      await tryOne('tribe', async () => parseTribe((await fetchJson(tribeUrl(base, now), opt)) as never, s).map((e) => e.title)),
      await tryOne('ical', async () => parseIcs(await fetchText(`${base}/events/?ical=1`, { ...opt, accept: 'text/calendar,*/*' }), s, base).map((e) => e.title)),
      await tryOne('gz', async () => parseIcs(await fetchText(`${base}/events/ical`, { ...opt, accept: 'text/calendar,*/*' }), s, base).map((e) => e.title)),
      await tryOne('ld', async () => {
        const html = await fetchText(`${base}/events`, opt);
        const ld = parseJsonLdEvents(html, s, `${base}/events`).map((e) => e.title);
        return ld.length ? ld : (/<html/i.test(html) ? [] : []);
      })
    ];
    console.log(`PROBE ${key} ${base} :: ${results.join(' ; ')}`);
  }
  for (const base of LOCALIST) {
    const s = src(base, base);
    const lw = await tryOne('livewhale', async () => {
      const body = (await fetchJson(`${base}/live/json/events/search/real%20estate/max/50`, opt)) as Array<{ title?: string }> | { data?: Array<{ title?: string }> };
      return (Array.isArray(body) ? body : (body.data ?? [])).map((e) => String(e.title ?? ''));
    });
    const lo = await tryOne('localist', async () => parseLocalist((await fetchJson(localistUrl(s), opt)) as never, s).map((e) => e.title));
    console.log(`PROBE ${base} :: ${lo} ; ${lw}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
