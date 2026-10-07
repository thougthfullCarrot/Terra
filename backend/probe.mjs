const UA = { 'user-agent': 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)', accept: 'application/json' };
async function json(url) { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) }); console.log(r.status, url); return r.ok ? r.json() : null; }
console.log('=== CivicClerk');
for (const t of ['collegestationtx', 'midlandtx', 'galvestontx']) {
  const ev = await json(`https://${t}.api.civicclerk.com/v1/Events?$orderby=startDateTime+desc&$top=60&$filter=startDateTime+lt+2026-10-08T00:00:00Z+and+startDateTime+gt+2026-08-01T00:00:00Z`);
  const pz = (ev?.value ?? []).filter((e) => /planning|zoning|council/i.test(e.eventName + e.categoryName));
  console.log(t, pz.map((e) => `${e.id}/${e.agendaId} ${e.startDateTime.slice(0, 10)} ${e.eventName} files=${(e.publishedFiles || []).map((f) => f.type + ':' + f.fileId + ':' + f.name).join(',')}`).join('\n  '));
  for (const e of pz.filter((e) => e.agendaId).slice(0, 2)) {
    const m = await json(`https://${t}.api.civicclerk.com/v1/Meetings/${e.agendaId}`);
    const items = m?.items ?? [];
    console.log('  items', items.length, JSON.stringify(items.slice(0, 1)).slice(0, 1500));
    const flat = [];
    const walk = (list) => { for (const i of list || []) { flat.push(i); walk(i.childItems || i.items); } };
    walk(items);
    for (const i of flat) if (/zon|rezon|PD|planned development|conditional use|specific use/i.test(JSON.stringify(i).slice(0, 3000))) console.log('   Z', (i.agendaObjectItemName || i.name || '').slice(0, 300).replace(/\s+/g, ' '));
  }
}
console.log('=== PrimeGov SA');
const up = await json('https://sanantonio.primegov.com/api/v2/PublicPortal/ListUpcomingMeetings');
const arch = await json('https://sanantonio.primegov.com/api/v2/PublicPortal/ListArchivedMeetings?year=2026');
const all = [...(up || []), ...(arch || [])];
const titles = new Set(all.map((m) => m.title));
console.log([...titles].filter((t) => /zon|plan|council/i.test(t)).join(' | '));
const zc = all.filter((m) => /zoning commission/i.test(m.title)).sort((a, b) => b.dateTime.localeCompare(a.dateTime));
console.log('ZC meetings', zc.slice(0, 4).map((m) => `${m.id} ${m.dateTime} ${m.documentList.map((d) => d.templateId + ':' + d.templateName).join(',')}`).join(' ; '));
const m = zc[0];
const doc = m?.documentList.find((d) => /html agenda/i.test(d.templateName));
if (doc) {
  const r = await fetch(`https://sanantonio.primegov.com/Portal/Meeting?meetingTemplateId=${doc.templateId}`, { headers: { 'user-agent': UA['user-agent'] } });
  const h = await r.text();
  console.log(r.status, h.length);
  const i = h.indexOf('MeetingContents');
  const body = h.slice(i);
  const text = body.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  const j = text.search(/Z-?20\d\d|ZONING CASE/i);
  console.log('RAW', text.slice(Math.max(0, j - 2500), j + 3500));
}
