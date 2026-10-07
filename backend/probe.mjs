const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', accept: 'application/json,text/html;q=0.9,*/*;q=0.8' };
async function get(url, n = 500, method = 'GET') {
  try {
    const r = await fetch(url, { method, headers: UA, signal: AbortSignal.timeout(30000) });
    const t = method === 'HEAD' ? '' : await r.text();
    console.log(r.status, r.headers.get('content-length'), r.headers.get('content-type'), url, t.length, '\n  ', t.slice(0, n).replace(/\s+/g, ' '));
    return r.ok ? t : null;
  } catch (e) { console.log('ERR', e.message, url); }
}
console.log('=== DOL apiprod');
for (let page = 1; page <= 12; page++) {
  const t = await get(`https://apiprod.dol.gov/v4/datasets?page=${page}`, 0);
  if (!t) break;
  const j = JSON.parse(t);
  for (const d of j.datasets ?? []) if (/OFLC|LCA|H-1B|H1B|foreign labor|prevailing/i.test(JSON.stringify(d))) console.log('  DS', d.id, d.agency?.abbr, d.name, d.api_url, d.frequency, d.published_at);
  if (!(j.datasets ?? []).length) break;
  if (page === 1) console.log('  keys', Object.keys(j), JSON.stringify(j).slice(-300));
}
console.log('=== FLAG');
const flag = await get('https://flag.dol.gov/programs/lca', 0);
if (flag) for (const m of new Set(flag.match(/href="[^"]*"/g) || [])) if (/disclos|xlsx|csv|data|lca/i.test(m)) console.log('  ', m);
for (const u of ['https://flag.dol.gov/sites/default/files/2025/LCA_Disclosure_Data_FY2025_Q4.xlsx', 'https://flag.dol.gov/disclosure', 'https://flag.dol.gov/programs/lca/disclosure-data']) await get(u, 200, 'HEAD');
console.log('=== PrimeGov SA');
const sa = await get('https://sanantonio.primegov.com/api/v2/PublicPortal/ListUpcomingMeetings', 0);
if (sa) {
  const ms = JSON.parse(sa);
  for (const m of ms) console.log('  M', m.id, m.date, m.title, m.committeeId, (m.documentList || []).map((d) => `${d.id}:${d.templateName}:${d.compileOutputType}`).join(' '));
  const zoning = ms.find((m) => /zoning|planning/i.test(m.title)) ?? ms[0];
  const doc = (zoning.documentList || []).find((d) => /html/i.test(d.templateName));
  if (doc) {
    const h = await get(`https://sanantonio.primegov.com/Portal/Meeting?meetingTemplateId=${doc.templateId}`, 300);
    if (h) {
      const text = h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const i = text.search(/zoning case|Z-?20\d\d/i);
      console.log('  TEXT', text.slice(Math.max(0, i - 200), i + 1500));
    }
  }
}
await get('https://sanantonio.primegov.com/api/v2/PublicPortal/ListArchivedMeetings?year=2026', 400);
console.log('=== CivicClerk');
for (const t of ['collegestationtx', 'midlandtx', 'galvestontx', 'lubbock', 'lubbocktexas', 'cityoflubbocktx', 'fortworth', 'fortworthgov', 'houston']) {
  const s = await get(`https://${t}.api.civicclerk.com/v1/Events?$orderby=startDateTime+desc&$top=4&$filter=startDateTime+lt+2026-11-30T00:00:00Z`, 0);
  if (s) for (const e of JSON.parse(s).value) console.log('  E', t, e.id, e.startDateTime, e.eventName, e.categoryName, e.agendaId, e.publishedFiles?.map?.((f) => f.type + ':' + f.fileId).join(' '));
}
const cs = await get('https://collegestationtx.api.civicclerk.com/v1/Events?$orderby=startDateTime+desc&$top=40&$filter=startDateTime+lt+2026-11-30T00:00:00Z', 0);
if (cs) { const e = JSON.parse(cs).value.find((x) => /planning/i.test(x.eventName)); if (e) { console.log(JSON.stringify(e).slice(0, 1500)); await get(`https://collegestationtx.api.civicclerk.com/v1/Meetings/${e.agendaId}`, 3000); } }
console.log('=== Fort Worth legistar');
await get(`https://webapi.legistar.com/v1/fortworthgov/events?$top=3&$orderby=EventDate+desc`, 1200);
await get(`https://webapi.legistar.com/v1/fortworthgov/matters?$top=3&$orderby=MatterId+desc&$filter=substringof('ZC-',MatterFile)`, 1200);
console.log('=== Legistar sample items Dallas');
const ev = await get(`https://webapi.legistar.com/v1/cityofdallas/events?$filter=EventDate+ge+datetime'2026-10-07'+and+EventDate+le+datetime'2026-11-30'&$orderby=EventDate`, 0);
if (ev) { const evs = JSON.parse(ev); for (const e of evs) console.log('  EV', e.EventId, e.EventDate.slice(0,10), e.EventBodyName, e.EventInSiteURL); const z = evs.find((e) => /plan|zoning|council/i.test(e.EventBodyName)); if (z) await get(`https://webapi.legistar.com/v1/cityofdallas/events/${z.EventId}/eventitems?AgendaNote=1`, 3000); }
