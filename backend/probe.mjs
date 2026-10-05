// Temporary probe, round 6: run the real research and site exports.
import { readFileSync } from 'node:fs';
import { fetchResearch } from './src/market/research.ts';
const research = await fetchResearch({ cities: ['Dallas', 'Fort Worth', 'Houston', 'Austin', 'San Antonio', 'El Paso'], log: (l) => console.log('research:', l) });
for (const l of research.leases) console.log(`LEASE ${l.city} ${l.type} ${l.broker} vac=${l.vacancy} rent=${l.rent} ${l.rentBasis} ${l.period}`);
console.log(`reports: ${research.reports.length}`);
for (const r of research.reports.filter((r) => r.period)) console.log(`REPORT ${r.city} ${r.broker} ${r.type} ${r.period} ${r.url}`);

const file = JSON.parse(readFileSync('/tmp/sites.json', 'utf8'));
const by = {};
for (const s of file.sites) by[`${s.city} ${s.use}`] = (by[`${s.city} ${s.use}`] ?? 0) + 1;
console.log('sites per city/use', by);
console.log('zoned', file.sites.filter((s) => s.zoning).length, 'of', file.sites.length, 'size bytes', JSON.stringify(file).length);
for (const city of ['Houston', 'Fort Worth', 'San Antonio', 'Austin']) {
  const list = file.sites.filter((s) => s.city === city);
  console.log(`\n${city} samples:`);
  for (const s of list.filter((_, i) => i % 50 === 0)) console.log(JSON.stringify(s));
  const one = list[0];
  if (one?.url) {
    try {
      const r = await fetch(one.url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000) });
      const t = await r.text();
      console.log(`CAD link ${one.url} -> ${r.status} ${r.url} title=${/<title[^>]*>([^<]*)/i.exec(t)?.[1]?.trim()} hasId=${t.includes(one.id)}`);
    } catch (e) { console.log('CAD link error', one.url, e.message); }
  }
}
