import { fetchJson, fetchText } from './src/lib/http.js';
import { stripHtml } from './src/market/zoning.js';
const up = await fetchJson<any[]>('https://sanantonio.primegov.com/api/v2/PublicPortal/ListUpcomingMeetings');
const arch = await fetchJson<any[]>('https://sanantonio.primegov.com/api/v2/PublicPortal/ListArchivedMeetings?year=2026');
const ms = [...up, ...arch].filter((m) => /zoning commission|zoning and land use|council a session/i.test(m.title)).sort((a, b) => b.dateTime.localeCompare(a.dateTime)).slice(0, 4);
for (const m of ms) {
  const doc = m.documentList.find((d: any) => /html/i.test(d.templateName));
  console.log('MEETING', m.id, m.title, m.dateTime, doc?.templateId, doc?.templateName);
  if (!doc) continue;
  const html = await fetchText(`https://sanantonio.primegov.com/Portal/Meeting?meetingTemplateId=${doc.templateId}`);
  const text = stripHtml(html.slice(html.indexOf('MeetingContents'))).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');
  const hits = [...text.matchAll(/.{0,120}\b(Z|PA)-?20\d\d-?\d+.{0,200}/gi)].slice(0, 5).map((x) => x[0]);
  console.log(text.length, hits.join('\n---\n'));
}
