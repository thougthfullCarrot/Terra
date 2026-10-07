import { fetchZoning } from './src/market/zoning.js';
const r = await fetchZoning({ log: (l) => console.log(l) });
console.log('covered', r.covered.join(', '), '| failed', r.failed.join(', '));
const by = new Map<string, number>();
for (const c of r.cases) by.set(c.place, (by.get(c.place) ?? 0) + 1);
console.log([...by].map(([p, n]) => `${p} ${n}`).join(', '));
for (const c of r.cases.filter((c) => ['San Antonio', 'College Station', 'Midland', 'Galveston', 'Plano', 'Mesquite'].includes(c.place))) console.log(`${c.date} | ${c.place} | ${c.kind} | ${c.uses.join('/')} | ${c.file} | ${c.title.slice(0, 160)}`);
