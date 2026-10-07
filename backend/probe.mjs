const UA = { 'user-agent': 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)' };
const r = await fetch('https://www.dol.gov/agencies/eta/foreign-labor/performance', { headers: UA });
const page = await r.text();
console.log(r.status, page.length);
const links = [...new Set(page.match(/href="[^"]*\.(xlsx|pdf|zip|csv)"/gi) || [])].filter((l) => /LCA/i.test(l));
console.log(links.join('\n'));
for (const l of links.filter((x) => /xlsx/i.test(x)).slice(0, 6)) {
  const url = new URL(l.slice(6, -1), 'https://www.dol.gov').href;
  const h = await fetch(url, { method: 'HEAD', headers: UA });
  console.log(h.status, h.headers.get('content-length'), h.headers.get('last-modified'), url);
}
// Is sheet data shared strings or inline? Read the first 3 MB of the newest file's sheet.
