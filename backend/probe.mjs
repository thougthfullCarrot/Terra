// Temporary: run the statewide lookup end to end against the live services.
import { geocodeUrl, readGeocode, identifyUrl, pickStatewide } from '../site/property.js';
const h = { origin: 'https://thougthfullcarrot.github.io', referer: 'https://thougthfullcarrot.github.io/Terra/', 'user-agent': 'Mozilla/5.0 Terra' };
for (const q of ['919 Milam St, Houston, TX 77002', '1500 Broadway, Lubbock, TX 79401', '300 N Marienfeld St, Midland, TX 79701', '2228 Mechanic St, Galveston, TX 77550', '1100 Congress Ave, Austin, TX 78701', '500 W Texas Ave, Midland, TX 79701']) {
  const g = await fetch(geocodeUrl(q), { headers: h });
  const point = readGeocode(await g.json());
  console.log('\n' + q, 'geocode', g.status, g.headers.get('access-control-allow-origin'), JSON.stringify(point));
  if (!point) continue;
  const r = await fetch(identifyUrl(point), { headers: h });
  const picked = pickStatewide(await r.json(), q);
  for (const p of picked.slice(0, 3)) console.log('  ', p.source.county, '|', p.address, '|', p.owner, '|', p.mail, '|', p.value, p.acquired);
  await new Promise((r) => setTimeout(r, 1100));
}
