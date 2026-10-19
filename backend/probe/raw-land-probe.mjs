// Raw Land probe, round 10: the county Cities layer's object id field and GeoJSON output, as the collector reads it.
// Boundary layer only: no parcel, value, owner or address data. Prints field names, counts and jurisdiction names.
import { execFileSync } from 'node:child_process';
const UA = 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)';
const L = 'https://maps.bexar.org/arcgis/rest/services/LocalJurisdictions/MapServer/0';
const out = (k, v) => console.log(`\n### ${k}\n` + String(JSON.stringify(v ?? null)).slice(0, 8000));
const get = (url, body) => { try { return JSON.parse(execFileSync('curl', ['-sS', '--fail-with-body', '-L', '-m', '90', '-A', UA, '-H', 'Content-Type: application/x-www-form-urlencoded', '--data-binary', body, url], { encoding: 'utf8', maxBuffer: 5e8 })); } catch (e) { return { _err: String(e.message).slice(0, 300) }; } };
const m = get(`${L}`, 'f=json');
out('meta', { objectIdField: m.objectIdField, oidTyped: (m.fields ?? []).filter((f) => f.type === 'esriFieldTypeOID').map((f) => f.name), maxRecordCount: m.maxRecordCount, currentVersion: m.currentVersion, formats: m.supportedQueryFormats, editingInfo: m.editingInfo ?? null });
out('count', get(`${L}/query`, 'f=json&where=1%3D1&returnCountOnly=true'));
const g = get(`${L}/query`, 'f=geojson&where=(1%3D1) AND OBJECTID_1 > -1&outFields=OBJECTID_1,JURIS&orderByFields=OBJECTID_1 ASC&resultRecordCount=2000&returnGeometry=true&outSR=4326&geometryPrecision=7');
out('geojson', g._err || g.error ? g : { type: g.type, n: g.features?.length, exceeded: g.exceededTransferLimit ?? g.properties?.exceededTransferLimit ?? null, ids: (g.features ?? []).map((f) => f.properties?.OBJECTID_1), juris: (g.features ?? []).map((f) => f.properties?.JURIS).sort(), geomTypes: [...new Set((g.features ?? []).map((f) => f.geometry?.type))] });
