import { fetchJson, type FetchJsonOptions } from '../lib/http.js';
import type { City } from '../types.js';
import { AUSTIN_PERMITS_URL, BROWSERISH, COSA_CKAN, COSA_PERMITS_RESOURCE, FORT_WORTH_LAYER, permitPoint, type PermitRow } from './cityPermits.js';
import { addressKey, checkPoint, inferMethod, km, parseAddress, sameSite, zipSlackKm, type LocationMethod, type ZipArea } from './devLocation.js';
import { CITY_CENTERS, METRO_RADIUS_KM, geocodeChecked, geocodeUrl, zipOf, type Development } from './developments.js';

/**
 * Location audit for the Development Map: reads a build's projects and
 * reports, per market, how each is located (method), and which points are
 * missing, approximate, conflicting or suspicious. With `verify`, it also
 * checks a sample of each market against the Census geocoder and the city's
 * own permit GIS, and says which errors are confirmed and which suspected.
 * It reads only; it never changes the data.
 */

export type Finding = 'missing' | 'awaiting' | 'approximate' | 'conflicting' | 'suspicious';

export interface AuditRow {
  id: string;
  city: City;
  name: string;
  place: string | null;
  address: string | null;
  url: string;
  method: LocationMethod;
  at: [number, number] | null;
  source: string;
  verified: string;
  findings: Finding[];
  notes: string[];
}

/** The towns whose city permits can lend a point in each market. */
export const PERMIT_TOWNS: Partial<Record<City, string[]>> = {
  'San Antonio': ['San Antonio'],
  Austin: ['Austin'],
  'Fort Worth': ['Fort Worth', 'Arlington']
};

const townKey = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/^CITY OF\s+/, '').replace(/[^A-Z]/g, '');

/** Classify every project; conflicts look across projects (one address, two points; one point, two addresses). */
export function auditLocations(projects: Development[], zips: Map<string, ZipArea>): AuditRow[] {
  const rows: AuditRow[] = projects.map((p) => {
    const method = inferMethod(p);
    const at: [number, number] | null = p.lat != null && p.lng != null ? [p.lat, p.lng] : null;
    const row: AuditRow = {
      id: p.id,
      city: p.city,
      name: p.name,
      place: p.place ?? null,
      address: p.address,
      url: p.url,
      method,
      at,
      source: p.location?.source ?? (method === 'same-site-permit' ? (p.locatedFrom ?? '') : method === 'zip-area' ? 'ZIP code center (before provenance was kept)' : method === 'geocoded-address' ? 'Census geocoder (before provenance was kept)' : method === 'permit-point' ? 'city permit point' : ''),
      verified: p.location?.verified ?? 'not recorded',
      findings: [],
      notes: [...(p.location?.flags ?? [])]
    };
    if (p.awaiting) row.findings.push('awaiting');
    else if (!at) {
      row.findings.push('missing');
      row.notes.push(!p.address ? 'no address filed' : !/^\d/.test(p.address.trim()) ? 'address has no street number (road segment or "various")' : 'no trustworthy match for the address');
    } else if (method === 'zip-area') row.findings.push('approximate');
    if (at && method !== 'zip-area') {
      const check = checkPoint(at, { center: CITY_CENTERS[p.city], radiusKm: METRO_RADIUS_KM[p.city], zip: zipOf(p.address), zips });
      for (const f of check.flags) if (!row.notes.includes(f)) row.notes.push(f);
      if (check.flags.length) row.findings.push('suspicious');
      // A point lent by a city permit to a project in a town that permit can't be in.
      if (method === 'same-site-permit' && (p.source ?? 'tabs') === 'tabs') {
        const towns = (PERMIT_TOWNS[p.city] ?? []).map(townKey);
        const town = townKey(p.place ?? parseAddress(p.address)?.place);
        if (town && towns.length && !towns.includes(town)) {
          row.findings.push('conflicting');
          row.notes.push(`point borrowed from a ${PERMIT_TOWNS[p.city]!.join('/')} city permit, but the project is in ${p.place}`);
        }
      }
    } else if (at && method === 'zip-area') {
      const zip = zipOf(p.address);
      const area = zip ? zips.get(zip) : undefined;
      if (area && km(at, area.at) > 0.05) row.notes.push(`spread ${(km(at, area.at) * 1000).toFixed(0)} m from the ZIP center, so it looks like a distinct site`);
    }
    if (p.location?.flags?.length && !row.findings.includes('suspicious')) row.findings.push('suspicious');
    return row;
  });
  // One street address in one ZIP/town with points more than 500 m apart.
  const byAddress = new Map<string, AuditRow[]>();
  for (const r of rows) {
    const k = r.at && r.method !== 'zip-area' ? addressKey(r.address) : null;
    if (k) byAddress.set(k, [...(byAddress.get(k) ?? []), r]);
  }
  for (const group of byAddress.values()) {
    const far = group.some((a) => group.some((b) => km(a.at!, b.at!) > 0.5));
    if (!far) continue;
    for (const r of group) {
      if (!r.findings.includes('conflicting')) r.findings.push('conflicting');
      r.notes.push(`same address as ${group.filter((o) => o !== r).map((o) => o.id).join(', ')} but up to ${Math.max(...group.map((o) => km(r.at!, o.at!))).toFixed(1)} km apart`);
    }
  }
  // One exact point carrying different street addresses (not ZIP areas, which share by design).
  const byPoint = new Map<string, AuditRow[]>();
  for (const r of rows) if (r.at && r.method !== 'zip-area') byPoint.set(`${r.at[0].toFixed(6)},${r.at[1].toFixed(6)}`, [...(byPoint.get(`${r.at[0].toFixed(6)},${r.at[1].toFixed(6)}`) ?? []), r]);
  for (const group of byPoint.values()) {
    // "750 E New Hope" and "750 E. New Hope Drive" are one address: compare without the street type.
    const loose = (a: string | null) => addressKey(a)?.replace(/ (ST|AVE|BLVD|RD|DR|LN|PKWY|CT|CIR|PL|TRL|WAY|HWY|FWY|EXPY|LOOP|TER|CV)\|/, '|') ?? null;
    const keys = new Set(group.map((r) => loose(r.address) ?? r.id));
    if (keys.size < 2) continue;
    for (const r of group) {
      if (!r.findings.includes('conflicting')) r.findings.push('conflicting');
      r.notes.push(`exact same point as ${group.filter((o) => o !== r).map((o) => `${o.id} (${o.address ?? 'no address'})`).slice(0, 3).join(', ')}`);
    }
  }
  return rows;
}

// --- Checking a sample against official sources. ---

export interface Reference {
  /** "Census geocoder", "San Antonio permit GIS", … */
  source: string;
  at: [number, number] | null;
  /** The address the source matched or lists. */
  matched?: string | null;
  link: string;
  note?: string;
  /** City permit GIS for the very permit the point claims: an official record. */
  official: boolean;
}

export interface Verified {
  row: AuditRow;
  references: Reference[];
  verdict: 'agrees' | 'confirmed error' | 'suspected error' | 'unverified';
  /** For an agreement: an official record (city permit GIS) or only the Census geocoder again (same source, not independent). */
  evidence: 'official record' | 'Census only (same source)' | 'none';
  /** What kind of problem a suspected case is. */
  kind?: 'address conflict' | 'missing coordinates' | 'uncertain shared site' | 'distance disagreement';
  /** The point the updated build's checks actually leave (from the revalidation run), or null. */
  after: [number, number] | null;
  afterMethod: LocationMethod;
  why: string;
}

/** The permit number a point claims to come from: a city project's own id, or "City permit X at this address". */
export function claimedPermit(p: Development): string | null {
  if (p.locatedFrom) return /City permit (\S+)/.exec(p.locatedFrom)?.[1] ?? null;
  if (p.source === 'city') return p.aliases?.[0] ?? p.id.replace(/^CITY-[A-Za-z]+-/, '');
  return null;
}

const sql = (s: string) => s.replace(/'/g, "''");

/** The city's own record of a permit: its address and point. */
export async function cityRecord(city: City, place: string | null, permit: string, http: FetchJsonOptions): Promise<Reference | null> {
  const headers = { ...BROWSERISH, ...http.headers };
  if (city === 'San Antonio') {
    const q = `SELECT "PERMIT #","ADDRESS","X_COORD","Y_COORD" FROM "${COSA_PERMITS_RESOURCE}" WHERE "PERMIT #" = '${sql(permit)}' LIMIT 5`;
    const link = `${COSA_CKAN}/datastore_search_sql?sql=${encodeURIComponent(q)}`;
    const data = await fetchJson<{ result?: { records?: PermitRow[] } }>(link, { timeoutMs: 60_000, ...http, headers });
    const row = data.result?.records?.[0];
    return { source: `San Antonio permit data (${permit})`, at: row ? permitPoint(row) : null, matched: row?.ADDRESS ?? null, link, official: true, note: row ? undefined : 'permit not found' };
  }
  if (city === 'Austin') {
    const link = `${AUSTIN_PERMITS_URL}?permit_number=${encodeURIComponent(permit)}`;
    const rows = await fetchJson<{ latitude?: string; longitude?: string; permit_location?: string; original_zip?: string }[]>(link, { timeoutMs: 60_000, ...http, headers });
    const row = rows[0];
    const at: [number, number] | null = row?.latitude && row.longitude ? [Number(row.latitude), Number(row.longitude)] : null;
    return { source: `Austin permit data (${permit})`, at, matched: row ? `${row.permit_location ?? ''} ${row.original_zip ?? ''}`.trim() : null, link, official: true, note: row ? undefined : 'permit not found' };
  }
  if (city === 'Fort Worth' && place !== 'Arlington') {
    const link = `${FORT_WORTH_LAYER}/query?where=${encodeURIComponent(`Permit_No = '${sql(permit)}'`)}&outFields=Permit_No,Address,Latitude,Longitude&returnGeometry=true&outSR=4326&f=json`;
    const data = await fetchJson<{ features?: { attributes: { Address?: string; Latitude?: number; Longitude?: number }; geometry?: { x?: number; y?: number } }[] }>(link, { timeoutMs: 60_000, ...http, headers });
    const f = data.features?.[0];
    const lat = f?.attributes.Latitude ?? f?.geometry?.y;
    const lng = f?.attributes.Longitude ?? f?.geometry?.x;
    return { source: `Fort Worth permit GIS (${permit})`, at: lat && lng ? [lat, lng] : null, matched: f?.attributes.Address ?? null, link, official: true, note: f ? `${data.features!.length} rows for this permit` : 'permit not found' };
  }
  return null;
}

const isConflictReason = (r: string) => r !== 'no match';
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Check a sample's points against the Census geocoder (validated: the filed
 * number, direction and ZIP) and, where the point claims a city permit, the
 * city's own record of it. Confirmed errors need an official source to
 * disagree by more than a kilometre, or the lending permit to be in another
 * town or ZIP area; anything else that disagrees is suspected.
 */
export async function verifySample(
  rows: AuditRow[],
  projects: Map<string, Development>,
  zips: Map<string, ZipArea>,
  o: { http?: FetchJsonOptions; pauseMs?: number; log?: (l: string) => void; afterOf?: (row: AuditRow) => { at: [number, number] | null; method: LocationMethod } | undefined } = {}
): Promise<Verified[]> {
  const { http = {}, pauseMs = 400, log = () => {}, afterOf = (r: AuditRow) => ({ at: r.at, method: r.method }) } = o;
  const out: Verified[] = [];
  for (const row of rows) {
    const p = projects.get(`${row.city}|${row.id}`)!;
    const refs: Reference[] = [];
    const address = p.address && /^\d/.test(p.address.trim()) && !/\bfrom:|\bto:/i.test(p.address) ? p.address : null;
    let census: Awaited<ReturnType<typeof geocodeChecked>> | null = null;
    if (address) {
      await pause(pauseMs);
      census = await geocodeChecked(address, p.city, http).catch((e) => ({ at: null, rejected: `geocoder error: ${e instanceof Error ? e.message : String(e)}` }));
      refs.push({ source: 'Census geocoder (validated match)', at: census.at, matched: census.matched ?? null, link: geocodeUrl(address), note: census.rejected, official: false });
    }
    const permit = claimedPermit(p);
    if (permit) {
      await pause(pauseMs);
      const rec = await cityRecord(p.city, p.place, permit, http).catch((e) => ({ source: `city permit ${permit}`, at: null, link: '', official: true, note: `not read: ${e instanceof Error ? e.message : String(e)}` }) as Reference);
      if (rec) refs.push(rec);
    }
    const official = refs.find((r) => r.official && r.at);
    const ref = official ?? refs.find((r) => r.at);
    let verdict: Verified['verdict'] = 'unverified';
    let kind: Verified['kind'];
    let why = 'no reference point to compare';
    const zip = zipOf(p.address);
    const area = zip ? zips.get(zip) : undefined;
    // Agreement with the Census geocoder only repeats the source of a geocoded point; only a city record is independent.
    const evidence: Verified['evidence'] = official ? 'official record' : ref?.at ? 'Census only (same source)' : 'none';
    // The lending permit's own address must be the same site.
    const lent = p.locatedFrom && official ? sameSite({ address: p.address, place: p.place, names: [p.name] }, { address: official.matched ?? null, place: (PERMIT_TOWNS[p.city] ?? [])[0] ?? null }) : null;
    if (row.at && lent && !lent.same && official?.at && km(row.at, official.at) <= 0.5) {
      // The point is the permit's own, but the records don't prove one site: a rule refusal, not a proven wrong pin.
      [verdict, kind] = ['suspected error', 'uncertain shared site'];
      why = `the point is permit ${permit}'s own ("${official!.matched}"), but the records are not proven the same site (${lent.reason})`;
    } else if (row.at && ref?.at) {
      const d = km(row.at, ref.at);
      const outOfZip = area ? km(row.at, area.at) > zipSlackKm(area) : false;
      if (d <= 0.5) [verdict, why] = ['agrees', `${(d * 1000).toFixed(0)} m from ${ref.source}`];
      else if (row.method === 'zip-area') [verdict, why] = ['agrees', `ZIP area only; the address is ${d.toFixed(1)} km from the area's center (expected for an area, it is not a site)`];
      else if (d > 1 && official) [verdict, kind, why] = ['confirmed error', 'distance disagreement', `${d.toFixed(1)} km from ${ref.source}${outOfZip ? `, and outside its filed ZIP ${zip}` : ''}`];
      else [verdict, kind, why] = ['suspected error', 'distance disagreement', `${d.toFixed(1)} km from ${ref.source}${outOfZip ? `, outside its filed ZIP ${zip}` : ''} (Census only, not independent)`];
    } else if (!row.at && ref?.at) [verdict, kind, why] = ['suspected error', 'missing coordinates', `not placed, but ${ref.source} has a point`];
    else if (row.at && census?.rejected && row.method === 'geocoded-address')
      [verdict, kind, why] = ['suspected error', isConflictReason(census.rejected) ? 'address conflict' : 'missing coordinates', `today's checks refuse the geocoder's match (${census.rejected})`];
    const a = afterOf(row);
    const after = a?.at ?? null;
    const afterMethod = a?.method ?? row.method;
    out.push({ row, references: refs, verdict, evidence, ...(kind ? { kind } : {}), after, afterMethod, why });
    log(`verify ${row.id}: ${verdict} (${why})`);
  }
  return out;
}

/** The sample to check in one market: every flagged point first, then an even spread of the rest by method. */
export function pickSample(rows: AuditRow[], size: number, flaggedMax: number): AuditRow[] {
  const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const flagged = rows.filter((r) => r.at && r.findings.some((f) => f === 'conflicting' || f === 'suspicious')).sort((a, b) => hash(a.id) - hash(b.id)).slice(0, flaggedMax);
  const rest = rows.filter((r) => !flagged.includes(r) && !r.findings.includes('awaiting'));
  const byMethod = new Map<LocationMethod, AuditRow[]>();
  for (const r of rest.sort((a, b) => hash(a.id) - hash(b.id))) byMethod.set(r.method, [...(byMethod.get(r.method) ?? []), r]);
  const spread: AuditRow[] = [];
  for (let i = 0; spread.length < size && [...byMethod.values()].some((l) => l.length > i); i++) for (const l of byMethod.values()) if (l[i] && spread.length < size) spread.push(l[i]!);
  return [...flagged, ...spread];
}

// --- Report. ---

const fmt = (at: [number, number] | null) => (at ? `${at[0].toFixed(5)}, ${at[1].toFixed(5)}` : 'none');
const cell = (s: string | null | undefined) => (s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
const METHOD_WORDS: Record<LocationMethod, string> = {
  'permit-point': "City permit's own point (address/parcel)",
  'same-site-permit': "Another permit's point at the same site (address/parcel)",
  'geocoded-address': 'Census geocode of the filed address (street interpolation)',
  'zip-area': 'ZIP area only: Location not verified',
  none: 'No point'
};

export function marketReport(city: City, rows: AuditRow[], verified: Verified[] = []): string {
  const count = (f: (r: AuditRow) => boolean) => rows.filter(f).length;
  const lines = [`## ${city}`, '', `${rows.length} projects listed.`, '', '| Location method | Projects |', '|---|---|'];
  for (const m of Object.keys(METHOD_WORDS) as LocationMethod[]) lines.push(`| ${METHOD_WORDS[m]} | ${count((r) => r.method === m)} |`);
  lines.push('', '| Finding | Projects |', '|---|---|');
  for (const f of ['awaiting', 'missing', 'approximate', 'conflicting', 'suspicious'] as Finding[]) lines.push(`| ${f} | ${count((r) => r.findings.includes(f))} |`);
  const flagged = rows.filter((r) => r.findings.includes('conflicting') || r.findings.includes('suspicious'));
  if (flagged.length) {
    lines.push('', `### Flagged points (${flagged.length}${flagged.length > 40 ? ', first 40' : ''})`, '', '| Project | Address | Method | Point | Why |', '|---|---|---|---|---|');
    for (const r of flagged.slice(0, 40)) lines.push(`| [${cell(r.id)}](${r.url}) ${cell(r.name)} | ${cell(r.address)} | ${r.method} | ${fmt(r.at)} | ${cell(r.notes.join('; '))} |`);
  }
  if (verified.length) {
    for (const v of ['confirmed error', 'suspected error', 'agrees', 'unverified'] as const) {
      const list = verified.filter((x) => x.verdict === v);
      if (!list.length) continue;
      lines.push('', `### Sample: ${v} (${list.length})`, '', '| Project | Address | Method | Kind / evidence | Before (live) | After (updated build) | Detail |', '|---|---|---|---|---|---|---|');
      for (const x of list)
        lines.push(
          `| [${cell(x.row.id)}](${x.row.url}) ${cell(x.row.name)} | ${cell(x.row.address)} | ${x.row.method} | ${x.kind ?? ''}${x.kind ? '; ' : ''}${x.evidence} | ${fmt(x.row.at)} | ${fmt(x.after)} (${x.afterMethod}) | ${cell(x.why)}; ${x.references.map((r) => `[${cell(r.source)}](${r.link})${r.matched ? ` matched "${cell(r.matched)}"` : ''}${r.at ? ` at ${fmt(r.at)}` : ` (${cell(r.note ?? 'no point')})`}`).join('; ')} |`
        );
    }
  }
  return lines.join('\n');
}
