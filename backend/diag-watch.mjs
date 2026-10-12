// Read-only: which project items are watched, and are they in stored history? No user ids or emails printed.
import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.SUPABASE_URL, process.env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const items = await db.from('watchlist_items').select('kind, city, ref, created_at');
if (items.error) throw new Error(items.error.message);
console.log('watchlist items by kind:', JSON.stringify(items.data.reduce((a, i) => ((a[i.kind] = (a[i.kind] ?? 0) + 1), a), {})));
const hist = await db.from('market_history').select('day, data').order('day');
if (hist.error) throw new Error(hist.error.message);
console.log('history days:', hist.data.map((h) => h.day).join(', '));
const latest = hist.data.at(-1)?.data;
for (const i of items.data.filter((i) => i.kind === 'project')) {
  console.log(`project item ref=${i.ref} city=${i.city} added=${i.created_at}`);
  for (const h of hist.data) console.log(`  ${h.day}:`, JSON.stringify(h.data.projects[i.ref] ?? null));
}
const rr = Object.entries(latest?.projects ?? {}).filter(([, p]) => /roadrunner/i.test(p.n));
console.log('Roadrunner-named projects in latest history:', JSON.stringify(rr));
const prof = await db.from('profiles').select('watch_emails, digest_frequency');
if (!prof.error) console.log('profiles watch_emails=true:', prof.data.filter((p) => p.watch_emails).length, 'of', prof.data.length);
const rec = await db.rpc('watch_recipients');
console.log('watch_recipients rows:', rec.error ? rec.error.message : rec.data.length);
const sends = await db.from('watch_sends').select('state'); console.log('watch_sends rows:', sends.error ? sends.error.message : sends.data.length);
const dig = await db.from('watch_digests').select('last_day'); console.log('watch_digests rows:', dig.error ? dig.error.message : dig.data.length);
