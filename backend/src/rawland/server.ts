/**
 * Localhost-only server for the Raw Land prototype. County-wide queries run on the account index here; the map asks
 * for tiles separately. Binds 127.0.0.1 and serves nothing outside its own UI, Leaflet and the build it was given.
 */
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { AccountIndex, predicate, type Filters, type SortKey } from './accountIndex.js';
import { tilesFor } from './tiles.js';
import { LABELS, CITY_ZONING } from './labels.js';
import type { TileFeature } from './synth.js';

const here = dirname(fileURLToPath(import.meta.url));
const leafletDir = dirname(createRequire(import.meta.url).resolve('leaflet/dist/leaflet.js'));
const TYPES: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', png: 'image/png', json: 'application/json' };

export function parseFilters(u: URLSearchParams): Filters {
  const num = (k: string) => (u.get(k) ? Number(u.get(k)) : undefined);
  const list = (k: string) => (u.get(k) ? u.get(k)!.split(',').filter(Boolean) : undefined);
  return { minAcres: num('minAcres'), maxAcres: num('maxAcres'), minMarket: num('minMarket'), maxMarket: num('maxMarket'), minPsf: num('minPsf'), maxPsf: num('maxPsf'), zoning: list('zoning'), stateCodes: list('stateCodes'), vacant: u.get('vacant') === '1' };
}

export function rawlandServer(data: { rows: ConstructorParameters<typeof AccountIndex>[0]; tiles: Map<string, TileFeature[]>; manifest: Record<string, unknown> }): Server {
  const index = new AccountIndex(data.rows);
  const byId = new Map<string, TileFeature>(); for (const t of data.tiles.values()) for (const f of t) byId.set(f.account, f);
  const zoningCodes = [...new Set(data.rows.flatMap((r) => r.zoningBases))].sort();
  return createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://localhost');
    const send = (code: number, body: string | Buffer, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
    try {
      if (u.pathname === '/api/meta') return send(200, JSON.stringify({ manifest: data.manifest, labels: LABELS, cityZoning: CITY_ZONING, zoningCodes }));
      if (u.pathname === '/api/query') {
        const f = parseFilters(u.searchParams);
        const bbox = u.searchParams.get('bbox')?.split(',').map(Number);
        const after = u.searchParams.get('after') ? JSON.parse(u.searchParams.get('after')!) : null;
        const page = index.query(f, { key: (u.searchParams.get('sort') ?? 'landPsf') as SortKey, dir: u.searchParams.get('dir') === 'asc' ? 'asc' : 'desc' }, { pageSize: Math.min(100, Number(u.searchParams.get('n') ?? 25)), after, bbox: bbox?.length === 4 ? { west: bbox[0]!, south: bbox[1]!, east: bbox[2]!, north: bbox[3]! } : null });
        return send(200, JSON.stringify(page));
      }
      if (u.pathname === '/api/tiles') {
        const [west, south, east, north] = (u.searchParams.get('bbox') ?? '').split(',').map(Number) as [number, number, number, number];
        const keys = tilesFor({ west, south, east, north });
        if (keys.length > 400) return send(200, JSON.stringify({ tooMany: true, features: [] }));
        const p = predicate(parseFilters(u.searchParams));
        const features = keys.flatMap((k) => data.tiles.get(k) ?? []).map((f) => ({ account: f.account, outline: f.outline, match: p(f), zoningStatus: f.zoningStatus, landPsf: f.landPsf, conflict: Boolean((f.zoning as { conflict?: boolean } | null)?.conflict) }));
        return send(200, JSON.stringify({ features }));
      }
      if (u.pathname.startsWith('/api/account/')) { const f = byId.get(decodeURIComponent(u.pathname.slice(13))); return f ? send(200, JSON.stringify(f)) : send(404, '{}'); }
      if (u.pathname.startsWith('/leaflet/')) { const name = u.pathname.slice(9).replace(/[^\w.\-/]/g, ''); return send(200, await readFile(join(leafletDir, name)), TYPES[name.split('.').pop()!] ?? 'application/octet-stream'); }
      const file = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
      if (!/^[\w.-]+$/.test(file)) return send(404, 'not found', 'text/plain');
      return send(200, await readFile(join(here, 'ui', file)), TYPES[file.split('.').pop()!] ?? 'text/plain');
    } catch (e) { return send(404, String((e as Error).message).slice(0, 100), 'text/plain'); }
  });
}
