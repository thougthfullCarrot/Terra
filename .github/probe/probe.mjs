const UA = { 'user-agent': 'Mozilla/5.0 (compatible; TerraBot/0.1)' };
async function get(url) { try { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) }); return { status: r.status, text: await r.text() }; } catch (e) { return { status: 0, text: String(e) }; } }
for (const id of ['drau-zphx', 'qh8x-rm8r', 'de7b-7dna', 'jd6h-b87p']) {
  const m = await get(`https://data.texas.gov/api/views/${id}.json`);
  try { const j = JSON.parse(m.text); console.log(`\n===== ${id} ${j.name} | attribution=${j.attribution} | license=${j.license?.name} | rows? | desc=${(j.description||'').slice(0,600)}\ncols: ${j.columns.map((c) => `${c.fieldName}(${c.dataTypeName})`).join(', ')}`); } catch { console.log(id, m.status, m.text.slice(0, 300)); }
  const r = await get(`https://data.texas.gov/resource/${id}.json?$limit=3&$order=:updated_at DESC`);
  console.log(`--- sample [${r.status}]\n${r.text.slice(0, 3000)}`);
}
const c = await get('https://data.texas.gov/resource/drau-zphx.json?$select=count(*)');
console.log('count', c.text);
const d = await get('https://www.dallasopendata.com/resource/irab-qmty.json?$limit=2');
console.log('dallas', d.status, d.text.slice(0, 1200));
