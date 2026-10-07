import { fetchZoning } from './src/market/zoning.js';
import { fetchText } from './src/lib/http.js';
import { stripHtml } from './src/market/zoning.js';
const r = await fetchZoning({ log: (l) => console.log(l) });
console.log('covered', r.covered.join(', '), 'failed', r.failed.join(', '));
for (const c of r.cases.slice(0, 400)) console.log(`${c.date} | ${c.place} | ${c.body} | ${c.kind} | ${c.uses.join('/')} | ${c.file} | ${c.title.slice(0, 220)}`);
// San Antonio raw text sample
const html = await fetchText('https://sanantonio.primegov.com/Portal/Meeting?meetingTemplateId=66318', { headers: { 'user-agent': 'terra-collector/0.1' } });
const text = stripHtml(html.slice(html.indexOf('MeetingContents'))).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');
const i = text.search(/Z-?20\d\d/);
console.log('SA TEXT', i, text.slice(Math.max(0, i - 1500), i + 2500));
