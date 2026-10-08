import { fetchBids } from './src/market/bids.js';
import { PERMIT_SOURCES, permitProjects } from './src/market/cityPermits.js';
import { projectDetails, parseProjectPage, searchMetro, tabsProjectUrl } from './src/market/developments.js';
import { fetchText } from './src/lib/http.js';
import { METROS } from './src/market/metros.js';
const now = new Date();
const cities = METROS.map((m) => m.city);
const bids = await fetchBids(cities, { now }).catch((e) => { console.log('bids failed', e.message); return null; });
if (bids) {
  const by = new Map<string, number>(); for (const b of bids.bids) by.set(b.city, (by.get(b.city) ?? 0) + 1);
  console.log('BIDS', bids.bids.length, JSON.stringify([...by]));
  console.log(JSON.stringify(bids.bids.slice(0, 6), null, 1));
}
for (const s of PERMIT_SOURCES) {
  try {
    const projects = permitProjects(await s.fetch(now, {}), now);
    console.log(`PERMITS ${s.name}: ${projects.length} projects, contractor ${projects.filter((p) => p.contractor).length}, contact ${projects.filter((p) => p.contact).length}, owner ${projects.filter((p) => p.owner).length}`);
  } catch (e) { console.log(s.name, 'failed', (e as Error).message); }
}
for (const city of ['Houston', 'Dallas', 'Fort Worth', 'Austin', 'San Antonio'] as const) {
  const rows = (await searchMetro(city, now)).slice(0, 15);
  let design = 0, owner = 0;
  for (const r of rows) {
    const d = projectDetails(parseProjectPage(await fetchText(tabsProjectUrl(r.ProjectNumber), { timeoutMs: 60_000 })));
    if (d.designFirm) design++; if (d.owner) owner++;
    await new Promise((res) => setTimeout(res, 300));
  }
  console.log(`TABS ${city}: sample ${rows.length}, design firm ${design}, owner ${owner}`);
}
