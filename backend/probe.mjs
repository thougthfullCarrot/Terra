// Temporary probe, round 8: site counts after the per-district land codes.
import { readFileSync } from 'node:fs';
const file = JSON.parse(readFileSync('/tmp/sites.json', 'utf8'));
const by = {};
for (const s of file.sites) by[`${s.city} ${s.use}`] = (by[`${s.city} ${s.use}`] ?? 0) + 1;
console.log(by, 'zoned', file.sites.filter((s) => s.zoning).length, 'of', file.sites.length, 'bytes', JSON.stringify(file).length);
for (const s of file.sites.filter((s) => s.use === 'land' && ['San Antonio', 'Austin'].includes(s.city)).filter((_, i) => i % 30 === 0)) console.log(JSON.stringify(s));
