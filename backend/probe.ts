import { fetchZoning } from './src/market/zoning.js';
const r = await fetchZoning({ log: console.log });
const by = new Map<string, number>();
for (const c of r.cases) by.set(c.place, (by.get(c.place) ?? 0) + 1);
console.log([...by].join(' | '), 'failed', r.failed);
for (const c of r.cases.filter((c) => c.place === 'San Antonio' || c.place === 'Galveston').slice(0, 12)) console.log(c.place, c.file, c.kind, c.date, c.title.slice(0, 160));
