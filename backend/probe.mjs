// Temporary probe: what the property export wrote.
import { readFileSync } from 'node:fs';
const read = (n) => { try { return JSON.parse(readFileSync(`/tmp/property/${n}.json`, 'utf8')); } catch (e) { return null; } };
const t = read('tracts'); console.log('tracts', t?.tracts.length, t?.acsYear, t?.lodesYear, JSON.stringify(t).length, t?.tracts.slice(0, 3));
const l = read('leases'); console.log('moves', l?.moves.length, JSON.stringify(l).length);
for (const m of l?.moves ?? []) console.log(' ', m.city, '|', m.tenant, '|', m.building, '|', m.squareFeet, '|', m.end, '|', m.address);
const d = read('distress'); console.log('sales', d?.sales.length, JSON.stringify(d?.counties), JSON.stringify(d).length);
const by = {}; for (const s of d?.sales ?? []) { const k = `${s.city}|${s.status}`; by[k] = (by[k] ?? 0) + 1; } console.log(by);
console.log(d?.sales.slice(0, 3));
console.log('delinquent', d?.delinquent?.asOf, d?.delinquent?.accounts.length, d?.delinquent?.accounts.slice(0, 5));
const deal = read('deal'); console.log(JSON.stringify(deal, null, 1));
