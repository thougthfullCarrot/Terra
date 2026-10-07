const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.9' };
async function get(url, n = 500, method = 'GET') {
  try {
    const r = await fetch(url, { method, headers: UA, signal: AbortSignal.timeout(25000) });
    const t = method === 'HEAD' ? '' : await r.text();
    console.log(r.status, r.headers.get('content-length'), url, t.length, '\n  ', t.slice(0, n).replace(/\s+/g, ' '));
    return r.ok ? t : null;
  } catch (e) { console.log('ERR', e.message, url); }
}
console.log('=== DOL');
await get('https://www.dol.gov/agencies/eta/foreign-labor/performance', 200);
await get('https://flag.dol.gov/programs/lca', 200);
await get('https://data.dol.gov/', 200);
await get('https://apiprod.dol.gov/v4/datasets', 1500);
await get('https://dataportal.dol.gov/datasets', 300);
await get('https://catalog.data.gov/api/3/action/package_show?id=labor-condition-application-for-nonimmigrant-workers-lca-program-historical-data', 3000);
await get('https://www.uscis.gov/tools/reports-and-studies/h-1b-employer-data-hub', 200);
await get('https://h1bdata.info/index.php?em=CBRE&job=&city=DALLAS&year=2025', 300);
console.log('=== Legistar latest matters');
for (const c of ['fortworthgov', 'sanantonio', 'cityofdallas', 'austintexas', 'elpasotexas', 'newbraunfels']) {
  await get(`https://webapi.legistar.com/v1/${c}/matters?$top=2&$orderby=MatterId+desc`, 500);
  await get(`https://webapi.legistar.com/v1/${c}/events?$top=2&$orderby=EventId+desc`, 300);
}
console.log('=== Legistar exists?');
for (const c of ['frisco', 'allen', 'carrollton', 'richardson', 'cityofrichardson', 'cityofdenton', 'pflugerville', 'georgetown', 'georgetowntx', 'sanmarcos', 'sanmarcostx', 'kyle', 'leaguecity', 'missouricity', 'katy', 'bryantx', 'bryan', 'cityofbryan', 'lubbocktx', 'cityoflubbock', 'cityofmidland', 'odessa', 'texascity', 'leander', 'cedarpark', 'grandprairie', 'mesquite', 'lewisville', 'flowermound', 'southlake', 'keller', 'mansfield', 'burleson', 'hurst', 'bedford', 'grapevine', 'schertz', 'seguin', 'boerne', 'converse', 'humble', 'baytown', 'pasadenatx', 'friendswood', 'thewoodlands', 'woodlandstownship', 'hcad', 'harriscounty', 'traviscounty', 'bexar', 'dallascounty', 'tarrantcounty', 'collegestationtx', 'cstx-gov', 'brazoscounty', 'galvestoncounty', 'midlandcounty', 'lubbockcounty']) {
  try {
    const r = await fetch(`https://webapi.legistar.com/v1/${c}/bodies?$top=1`, { signal: AbortSignal.timeout(15000) });
    console.log(r.status, c);
  } catch (e) { console.log('ERR', c); }
}
console.log('=== Other agenda platforms');
for (const u of [
  'https://sanantonio.primegov.com/api/v2/PublicPortal/ListUpcomingMeetings',
  'https://fortworthgov.primegov.com/api/v2/PublicPortal/ListUpcomingMeetings',
  'https://fortworth.primegov.com/api/v2/PublicPortal/ListUpcomingMeetings',
  'https://houston.primegov.com/api/v2/PublicPortal/ListUpcomingMeetings',
  'https://lubbock.primegov.com/api/v2/PublicPortal/ListUpcomingMeetings',
  'https://collegestation.primegov.com/api/v2/PublicPortal/ListUpcomingMeetings',
  'https://cstx.primegov.com/api/v2/PublicPortal/ListUpcomingMeetings',
  'https://midlandtx.primegov.com/api/v2/PublicPortal/ListUpcomingMeetings',
  'https://galvestontx.primegov.com/api/v2/PublicPortal/ListUpcomingMeetings',
  'https://fortworthtx.api.civicclerk.com/v1/Events?$top=2',
  'https://sanantoniotx.api.civicclerk.com/v1/Events?$top=2',
  'https://lubbocktx.api.civicclerk.com/v1/Events?$top=2',
  'https://collegestationtx.api.civicclerk.com/v1/Events?$top=2',
  'https://midlandtx.api.civicclerk.com/v1/Events?$top=2',
  'https://galvestontx.api.civicclerk.com/v1/Events?$top=2',
  'https://houstontx.api.civicclerk.com/v1/Events?$top=2',
  'https://www.fortworthtexas.gov/departments/development-services/zoning/cases',
  'https://www.sanantonio.gov/DSD/Zoning',
  'https://data.sanantonio.gov/api/3/action/package_search?q=zoning&rows=5',
  'https://data.austintexas.gov/api/views/metadata/v1?limit=5&q=zoning',
  'https://www.dallasopendata.com/api/catalog/v1?q=zoning&limit=5',
  'https://data.fortworthtexas.gov/api/catalog/v1?q=zoning&limit=5'
]) await get(u, 600);
