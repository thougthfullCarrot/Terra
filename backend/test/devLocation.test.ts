import { describe, expect, it } from 'vitest';
import { fetchCityPermitProjects, type PermitSource } from '../src/market/cityPermits.js';
import { addressKey, checkPoint, inferMethod, mayReplace, parseAddress, townsMatch, pickGeocode, sameAddress, sameSite, locationInfo, RULES } from '../src/market/devLocation.js';
import type { Development } from '../src/market/developments.js';

describe('parseAddress', () => {
  it('reads a direction wherever it is written', () => {
    expect(parseAddress('100 N Main St, San Antonio, TX 78205')).toMatchObject({ number: '100', dir: 'N', street: 'MAIN ST', zip: '78205', place: 'SAN ANTONIO' });
    expect(parseAddress('100 Main Street North, San Antonio, TX 78205')).toMatchObject({ dir: 'N', street: 'MAIN ST' });
    expect(parseAddress('100 North Main St.')).toMatchObject({ dir: 'N', street: 'MAIN ST' });
  });

  it('unifies interstate, US, state, farm and ranch road spellings', () => {
    const key = (a: string) => parseAddress(a)!.street;
    expect(new Set(['13735 IH-10 W', '13735 IH 10 W', '13735 I-10 West', '13735 Interstate Highway 10 W', '13735 W IH 10'].map(key))).toEqual(new Set(['IH 10']));
    expect(key('8751 State Hwy 151')).toBe('SH 151');
    expect(key('8751 SH-151')).toBe('SH 151');
    expect(key('2000 US Highway 281 N')).toBe('US 281');
    expect(key('2000 FM 1604')).toBe('FM 1604');
    expect(key('2000 Farm to Market Road 1604')).toBe('FM 1604');
    expect(key('2000 Ranch Road 620 N')).toBe('RM 620');
  });

  it('marks frontage, access and service roads, keeping the highway they serve', () => {
    for (const a of ['5200 N IH 35 Frontage Rd', '5200 IH 35 N Access Rd', '5200 N Interstate 35 Svc Rd']) {
      expect(parseAddress(a)).toMatchObject({ number: '5200', street: 'IH 35', dir: 'N', frontage: true });
    }
  });

  it('keeps every house number of a range, and a building or suite apart from the street', () => {
    expect(parseAddress('5730-5734 UTSA Blvd, San Antonio, TX 78249')).toMatchObject({ number: '5730', numbers: ['5730', '5734'], street: 'UTSA BLVD' });
    expect(parseAddress('900 E Main St Bldg 3, Round Rock, TX')).toMatchObject({ unit: '3', street: 'MAIN ST', dir: 'E', place: 'ROUND ROCK', zip: null });
  });

  it('keys one address per town', () => {
    expect(addressKey('100 Main St, Boerne, TX 78006')).not.toBe(addressKey('100 Main St, San Antonio, TX 78205'));
    expect(addressKey('100 N. Main Street, Boerne, TX 78006')).toBe(addressKey('100 N MAIN ST, Boerne, TX 78006'));
  });
});

describe('sameSite', () => {
  const at = (address: string, place: string | null = null, ...names: string[]) => ({ address, place, names });

  it('needs the same street direction', () => {
    expect(sameSite(at('100 N Main St, San Antonio, TX 78205'), at('100 S Main St, San Antonio, TX 78205')).same).toBe(false);
    expect(sameSite(at('100 Main St, San Antonio, TX 78205'), at('100 N Main St, San Antonio, TX 78205')).same).toBe(false);
    expect(sameSite(at('100 N Main St, San Antonio, TX 78205'), at('100 Main St N, San Antonio, TX 78205')).same).toBe(true);
  });

  it('matches highway addresses however they are spelled, frontage road or not', () => {
    expect(sameSite(at('13735 IH-10 W, San Antonio, TX 78249'), at('13735 W INTERSTATE 10, City of San Antonio, TX 78249')).same).toBe(true);
    expect(sameSite(at('13735 IH 10 W, San Antonio, TX 78249'), at('13735 IH 10 E, San Antonio, TX 78249')).same).toBe(false);
  });

  it('never joins the same street name in two towns (duplicate street names)', () => {
    const r = sameSite(at('100 Main St, Boerne, TX 78006', 'Boerne'), at('100 MAIN ST, City of San Antonio, TX 78205', 'San Antonio'));
    expect(r).toMatchObject({ same: false });
    expect(r.reason).toMatch(/ZIP/);
    // With no ZIP on one side, the towns decide.
    expect(sameSite(at('400 Main St', 'Arlington'), at('400 Main St, Fort Worth, TX 76102', 'Fort Worth')).same).toBe(false);
    expect(sameSite(at('400 Main St', 'Arlington'), at('400 MAIN ST, Arlington, TX', 'Arlington')).same).toBe(true);
  });

  it('flags a ZIP mismatch within one town and refuses one across towns', () => {
    // TDLR filed The Merc in 78243; the city's permits say 78249.
    expect(sameSite(at('5734 UTSA Blvd, San Antonio, TX 78243', 'San Antonio'), at('5734 UTSA BLVD, San Antonio, TX 78249', 'San Antonio'))).toMatchObject({ same: true, flag: 'filed ZIP 78243 differs from 78249 on the other record' });
    expect(sameSite(at('2100 Pecan St, Schertz, TX 78154', 'Schertz'), at('2100 Pecan St, San Antonio, TX 78210', 'San Antonio')).same).toBe(false);
  });

  it('needs a shared name for campuses, shopping centers and phased sites', () => {
    const campus = at('1 UTSA Circle, San Antonio, TX 78249', 'San Antonio', 'UTSA Main Campus Science and Engineering Building');
    expect(sameSite(campus, at('1 UTSA Cir, San Antonio, TX 78249', 'San Antonio', 'Parking Garage 4')).same).toBe(false);
    expect(sameSite(campus, at('1 UTSA Cir, San Antonio, TX 78249', 'San Antonio', 'UTSA Science & Engineering')).same).toBe(true);
    expect(sameSite(at('500 Retail Way, Austin, TX 78701', 'Austin', 'Domain Phase 2'), at('500 Retail Way, Austin, TX 78701', 'Austin', 'Domain Phase 3')).same).toBe(false);
    expect(sameSite(at('900 E Main St Bldg 3, Round Rock, TX'), at('900 E Main St Bldg 4, Round Rock, TX')).same).toBe(false);
    // An address range is several buildings: the address alone is not enough.
    expect(sameSite(at('5730-5734 UTSA Blvd, San Antonio, TX 78249'), at('5730 UTSA Blvd, San Antonio, TX 78249')).same).toBe(false);
  });

  it('lets a plain single-building address join on address alone, but only sameAddress for listing', () => {
    expect(sameSite(at('8751 State Hwy 151, San Antonio, TX 78245'), at('8751 SH 151, City of San Antonio, TX 78245')).same).toBe(true);
    expect(sameAddress(at('5730-5734 UTSA Blvd, San Antonio, TX 78249'), at('5730 UTSA Blvd, San Antonio, TX 78249')).same).toBe(true);
  });
});

describe('pickGeocode', () => {
  const match = (matchedAddress: string, y: number, x: number, extra = {}) => ({ matchedAddress, coordinates: { x, y }, addressComponents: { state: 'TX', ...extra } });

  it('takes a match of the filed address', () => {
    expect(pickGeocode('100 N Main St, San Antonio, TX 78205', [match('100 N MAIN ST, SAN ANTONIO, TX, 78205', 29.43, -98.49, { zip: '78205', preDirection: 'N' })]).at).toEqual([29.43, -98.49]);
  });

  it('refuses a match in another ZIP, on the other side of the street, or at another number', () => {
    expect(pickGeocode('100 Main St, Boerne, TX 78006', [match('100 MAIN ST, SAN ANTONIO, TX, 78205', 29.43, -98.49, { zip: '78205', city: 'SAN ANTONIO' })]).at).toBeNull();
    expect(pickGeocode('100 N Main St, San Antonio, TX 78205', [match('100 S MAIN ST, SAN ANTONIO, TX, 78205', 29.42, -98.49, { zip: '78205', preDirection: 'S' })]).at).toBeNull();
    expect(pickGeocode('120 Main St, San Antonio, TX 78205', [match('100 MAIN ST, SAN ANTONIO, TX, 78205', 29.42, -98.49, { zip: '78205' })]).at).toBeNull();
  });

  it('takes a same-town match when the filing has a wrong ZIP, flagged (TDLR: an Austin site filed in 78209)', () => {
    const r = pickGeocode('7032 US 290 Hwy, Austin, TX 78209', [match('7032 US HWY 290, AUSTIN, TX, 78736', 30.233, -97.875, { zip: '78736', city: 'AUSTIN' })]);
    expect(r.at).toEqual([30.233, -97.875]);
    expect(r.flag).toMatch(/filed ZIP 78209/);
  });

  it('checks the town when no ZIP was filed', () => {
    expect(pickGeocode('400 Main St, Arlington, TX', [match('400 MAIN ST, FORT WORTH, TX, 76102', 32.75, -97.33, { city: 'FORT WORTH' })]).at).toBeNull();
    expect(pickGeocode('400 Main St, Arlington, TX', [match('400 MAIN ST, ARLINGTON, TX, 76010', 32.73, -97.11, { city: 'ARLINGTON' })]).at).toEqual([32.73, -97.11]);
  });

  it('refuses matches that disagree by more than a kilometre', () => {
    const r = pickGeocode('100 Main St, Arlington, TX', [match('100 MAIN ST, ARLINGTON, TX, 76010', 32.73, -97.11), match('100 MAIN ST, ARLINGTON, TX, 76010', 32.7, -97.05)]);
    expect(r.at).toBeNull();
    expect(r.rejected).toMatch(/apart/);
  });
});

describe('checkPoint and provenance', () => {
  const zips = new Map([['78249', { at: [29.57, -98.6] as [number, number], radiusKm: 3.5 }]]);
  const sa = { center: [29.4241, -98.4936] as [number, number], radiusKm: 80 };

  it('flags a point far from its ZIP without moving or rejecting a suburban point', () => {
    expect(checkPoint([29.58, -98.61], { ...sa, zip: '78249', zips })).toEqual({ ok: true, flags: [] });
    const far = checkPoint([29.42, -98.49], { ...sa, zip: '78249', zips });
    expect(far.ok).toBe(true);
    expect(far.flags[0]).toMatch(/km from the center of its ZIP 78249/);
    expect(checkPoint([31.76, -106.48], { ...sa, zip: '78249', zips }).ok).toBe(false);
  });

  it('never replaces a point with weaker evidence', () => {
    const geocoded = locationInfo('geocoded-address', 'Census', '2026-10-26');
    expect(mayReplace(geocoded, 'zip-area')).toBe(false);
    expect(mayReplace(geocoded, 'same-site-permit')).toBe(true);
    expect(mayReplace(locationInfo('permit-point', 'COSA', '2026-10-26'), 'geocoded-address')).toBe(false);
    expect(mayReplace(null, 'zip-area')).toBe(true);
  });

  it('reads the method of a project saved before provenance was kept', () => {
    expect(inferMethod({ lat: 1, lng: 2, approximate: true })).toBe('zip-area');
    expect(inferMethod({ lat: 1, lng: 2, locatedFrom: 'City permit X at this address' })).toBe('same-site-permit');
    expect(inferMethod({ lat: 1, lng: 2, source: 'city' })).toBe('permit-point');
    expect(inferMethod({ lat: null, lng: null })).toBe('none');
  });
});

describe('shared permit locations', () => {
  const tabs = (id: string, address: string, place: string, name = 'Office building'): Development =>
    ({ id, city: 'San Antonio', place, name, facility: null, status: 'Registered', work: 'New construction', cost: 5_000_000, registered: '2026-01-01', start: null, end: null, address, owner: null, tenant: null, designFirm: null, scope: null, squareFeet: null, isPublic: false, lat: null, lng: null, approximate: false, developerUrl: '', developerDirect: false, url: '' }) as Development;
  const source = (points: Record<string, { address: string; names?: string[] }>): PermitSource => ({
    name: 'San Antonio',
    market: 'San Antonio',
    fetch: async () => [],
    locate: async (sites) =>
      new Map([...sites.keys()].filter((k) => points[k]).map((k) => [k, { address: points[k]!.address, lat: 29.43, lng: -98.49, permit: 'COM-1', names: points[k]!.names ?? [] }]))
  });

  it('lends a permit point only to a proven same site', async () => {
    const boerne = tabs('T1', '100 Main St, Boerne, TX 78006', 'Boerne');
    const downtown = tabs('T2', '200 N Main Ave, San Antonio, TX 78205', 'San Antonio');
    const mall = tabs('T3', '300 Retail Pkwy, San Antonio, TX 78256', 'San Antonio', 'The Rim Shopping Center Phase 2');
    await fetchCityPermitProjects(['San Antonio'], new Date('2026-10-26'), [boerne, downtown, mall], {
      sources: [source({ '100 MAIN ST': { address: '100 MAIN ST, San Antonio, TX 78205' }, '200 N MAIN AVE': { address: '200 N MAIN AVE, San Antonio, TX 78205' }, '300 RETAIL PKWY': { address: '300 RETAIL PKWY, San Antonio, TX 78256', names: ['Restaurant pad'] } })]
    });
    expect(boerne.lat).toBeNull();
    expect(mall.lat).toBeNull();
    expect(downtown).toMatchObject({ lat: 29.43, locatedFrom: 'City permit COM-1 at this address', location: { method: 'same-site-permit', accuracy: 'address-or-parcel' } });
  });
});

describe('auditLocations', async () => {
  const { auditLocations, pickSample } = await import('../src/market/locationAudit.js');
  const zips = new Map([
    ['78205', { at: [29.425, -98.49] as [number, number], radiusKm: 1.5 }],
    ['78006', { at: [29.79, -98.73] as [number, number], radiusKm: 8 }]
  ]);
  const p = (id: string, over: Partial<Development>): Development => ({ id, city: 'San Antonio', place: 'San Antonio', name: id, address: null, lat: null, lng: null, approximate: false, url: `https://x/${id}`, ...over }) as Development;

  it('reports missing, approximate, conflicting and suspicious points', () => {
    const rows = auditLocations(
      [
        p('none', { address: '100 Main St, San Antonio, TX 78205' }),
        p('zip', { address: '1 New Rd, San Antonio, TX 78205', lat: 29.425, lng: -98.49, approximate: true }),
        p('borrowed', { place: 'Boerne', address: '100 Main St, Boerne, TX 78006', lat: 29.79, lng: -98.73, locatedFrom: 'City permit COM-1 at this address' }),
        p('far', { address: '200 Main St, San Antonio, TX 78205', lat: 29.6, lng: -98.3 }),
        p('a', { address: '300 Elm St, San Antonio, TX 78205', lat: 29.42, lng: -98.49 }),
        p('b', { address: '300 Elm St, San Antonio, TX 78205', lat: 29.43, lng: -98.48 }),
        p('waiting', { awaiting: true })
      ],
      zips
    );
    const by = new Map(rows.map((r) => [r.id, r]));
    expect(by.get('none')!.findings).toEqual(['missing']);
    expect(by.get('zip')).toMatchObject({ method: 'zip-area', findings: ['approximate'] });
    expect(by.get('borrowed')!.findings).toContain('conflicting');
    expect(by.get('far')!.findings).toContain('suspicious');
    expect(by.get('a')!.findings).toContain('conflicting');
    expect(by.get('waiting')!.findings).toEqual(['awaiting']);
    expect(pickSample(rows, 2, 8).map((r) => r.id)).toEqual(expect.arrayContaining(['borrowed', 'far', 'a', 'b']));
  });
});

describe('mailing town vs jurisdiction', () => {
  it('accepts the same ZIP under two town names (Crowley mailing address, Fort Worth permit)', () => {
    expect(sameSite({ address: '10350 W. Cleburne Rd, Crowley, TX 76036', place: 'Crowley' }, { address: '10350 W CLEBURNE RD, Fort Worth, TX 76036', place: 'Fort Worth' }).same).toBe(true);
    expect(sameSite({ address: '10350 W. Cleburne Rd, Crowley, TX', place: 'Crowley' }, { address: '10350 W CLEBURNE RD, Fort Worth, TX', place: 'Fort Worth' }).same).toBe(false);
  });
});

describe('revalidating cached points', async () => {
  const { revalidatePoint, revalidatePoints, needsRevalidation } = await import('../src/market/developments.js');
  const cached = (over: Partial<Development> = {}): Development =>
    ({ id: 'TABS2025022344', city: 'San Antonio', place: 'San Antonio', name: 'Marbach Brake Check', cost: 1_500_000, address: '2328 W Loop 1604 S, San Antonio, TX 78245', lat: 29.21914, lng: -98.54791, approximate: false, url: '', ...over }) as Development;
  const census = (matches: object[]) => ({ fetchImpl: (async () => new Response(JSON.stringify({ result: { addressMatches: matches } }))) as typeof fetch });
  const now = new Date('2026-10-26T00:00:00Z');

  it('removes a cached point whose address now matches the other side of the road, and adds no ZIP area', async () => {
    const p = cached();
    expect(needsRevalidation(p)).toBe(true);
    // The geocoder's match is on Loop 1604 E, not W: the old point was a bad directional match.
    const r = await revalidatePoint(p, now, census([{ matchedAddress: '2328 SE LOOP 1604, SAN ANTONIO, TX, 78264', coordinates: { x: -98.54791, y: 29.21914 }, addressComponents: { state: 'TX', zip: '78264', preDirection: 'E', city: 'SAN ANTONIO' } }]));
    expect(r).toBe('removed: address conflict');
    expect(p).toMatchObject({ lat: null, lng: null, location: { method: 'none', previous: [29.21914, -98.54791], flags: ['address conflict'] } });
    expect(needsRevalidation(p)).toBe(false);
  });

  it('keeps a cached point the validated match confirms, and moves one it contradicts', async () => {
    const ok = cached({ address: '100 N Main Ave, San Antonio, TX 78205', lat: 29.43, lng: -98.49 });
    expect(await revalidatePoint(ok, now, census([{ matchedAddress: '100 N MAIN AVE, SAN ANTONIO, TX, 78205', coordinates: { x: -98.4901, y: 29.4301 }, addressComponents: { state: 'TX', zip: '78205', preDirection: 'N' } }]))).toBe('kept');
    expect(ok.location).toMatchObject({ method: 'geocoded-address', rules: RULES });
    const moved = cached({ address: '100 N Main Ave, San Antonio, TX 78205', lat: 29.5, lng: -98.6 });
    expect(await revalidatePoint(moved, now, census([{ matchedAddress: '100 N MAIN AVE, SAN ANTONIO, TX, 78205', coordinates: { x: -98.49, y: 29.43 }, addressComponents: { state: 'TX', zip: '78205', preDirection: 'N' } }]))).toBe('moved');
    expect(moved).toMatchObject({ lat: 29.43, lng: -98.49, location: { previous: [29.5, -98.6] } });
  });

  it('keeps a cached point rather than move it to a match outside the filed ZIP (a corridor filed at two addresses)', async () => {
    const p = cached({ id: 'TABS2026017456', city: 'Houston', place: 'Houston', address: '7841 Airline Dr 2521 Airline Dr, Houston, TX 77022', lat: 29.81027, lng: -95.38208 });
    const r = await revalidatePoint(p, now, census([{ matchedAddress: '7841 AIRLINE DR, HOUSTON, TX, 77037', coordinates: { x: -95.38616, y: 29.87488 }, addressComponents: { state: 'TX', zip: '77037', city: 'HOUSTON' } }]));
    expect(r).toBe('kept');
    expect(p).toMatchObject({ lat: 29.81027, lng: -95.38208, location: { rules: RULES } });
    expect(p.location?.flags).toContain('second match elsewhere');
  });

  it('leaves independently supported points alone and keeps a point when the geocoder fails', async () => {
    const permit = cached({ source: 'city' });
    const lent = cached({ locatedFrom: 'City permit X at this address' });
    expect(needsRevalidation(permit) || needsRevalidation(lent)).toBe(false);
    const down = cached();
    expect(await revalidatePoint(down, now, { fetchImpl: (async () => new Response('', { status: 503 })) as typeof fetch })).toBe('error');
    expect(down.lat).toBe(29.21914);
    const done = await revalidatePoints([permit, lent], now, { http: census([]) });
    expect(done.size).toBe(0);
  });
});

describe('revalidation queue across builds', async () => {
  const { revalidatePoint, revalidatePoints, needsRevalidation } = await import('../src/market/developments.js');
  const now = new Date('2026-10-26T00:00:00Z');
  const at = (i: number): [number, number] => [29.4 + i / 1000, -98.5];
  const project = (i: number, over: Partial<Development> = {}): Development =>
    ({ id: `TABS${i}`, city: 'San Antonio', place: 'San Antonio', name: `P${i}`, cost: 1_000_000 * (10 - i), address: `${100 + i} N Main Ave, San Antonio, TX 78205`, lat: at(i)[0], lng: at(i)[1], approximate: false, url: '', ...over }) as Development;
  // A Census stand-in that answers each address with its own point, and counts the calls.
  const fake = (calls: string[], fail: (address: string) => Response | null = () => null) => ({
    fetchImpl: (async (url: string | URL) => {
      const address = new URL(String(url)).searchParams.get('address') ?? '';
      calls.push(address);
      const bad = fail(address);
      if (bad) return bad;
      const i = Number(/^(\d+)/.exec(address)![1]) - 100;
      return new Response(JSON.stringify({ result: { addressMatches: [{ matchedAddress: `${100 + i} N MAIN AVE, SAN ANTONIO, TX, 78205`, coordinates: { x: at(i)[1], y: at(i)[0] }, addressComponents: { state: 'TX', zip: '78205', preDirection: 'N' } }] } }));
    }) as typeof fetch,
    retries: 0
  });

  it('keeps the point and leaves it due on a timeout, a blocked request or a malformed answer', async () => {
    const answers: Array<[string, () => Promise<Response>]> = [
      ['timeout', async () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); }],
      ['blocked', async () => new Response('Forbidden', { status: 403 })],
      ['malformed', async () => new Response('<html>not json</html>')],
      ['no result', async () => new Response(JSON.stringify({ errors: ['busy'] }))]
    ];
    for (const [, answer] of answers) {
      const p = project(1);
      expect(await revalidatePoint(p, now, { fetchImpl: answer as unknown as typeof fetch, retries: 0 })).toBe('error');
      expect([p.lat, p.lng]).toEqual(at(1));
      expect(needsRevalidation(p)).toBe(true);
      expect(p.location?.retry?.attempts).toBe(1);
    }
  });

  it('advances 3 a build through 8 due points, survives a restart, and checks each record once', async () => {
    let saved = JSON.stringify(Array.from({ length: 8 }, (_, i) => project(i)));
    const calls: string[] = [];
    const per: number[] = [];
    for (let build = 0; build < 5; build++) {
      // Each build starts from the saved lists, as after a restart.
      const projects = JSON.parse(saved) as Development[];
      const done = await revalidatePoints(projects, now, { budget: 3, pauseMs: 0, http: fake(calls) });
      per.push(done.size);
      saved = JSON.stringify(projects);
    }
    expect(per).toEqual([3, 3, 2, 0, 0]);
    expect(new Set(calls).size).toBe(calls.length);
    expect((JSON.parse(saved) as Development[]).every((p) => !needsRevalidation(p) && p.location?.rules === RULES)).toBe(true);
  });

  it('puts a failing record behind the rest, so it never holds the queue', async () => {
    const projects = Array.from({ length: 4 }, (_, i) => project(i));
    const calls: string[] = [];
    const http = fake(calls, (a) => (a.startsWith('100 ') ? new Response('', { status: 503 }) : null));
    const first = await revalidatePoints(projects, now, { budget: 2, pauseMs: 0, http });
    expect([...first.values()]).toEqual(['error', 'kept']);
    const second = await revalidatePoints(projects, now, { budget: 2, pauseMs: 0, http });
    expect([...second.keys()]).toEqual(['San Antonio|TABS2', 'San Antonio|TABS3']);
    expect(projects[0]!.lat).toBe(at(0)[0]);
  });

  it('brings back a point removed under older checks once the checks accept it', async () => {
    // Removed by the rules-2 parser ("S. W." read as S + W ...), with its old point kept.
    const p = project(5, { lat: null, lng: null, location: { method: 'none', accuracy: 'none', source: 'Location unavailable: match is not the filed address', verified: '2026-10-26', rules: RULES - 1, previous: at(5), flags: ['address conflict'] } });
    expect(needsRevalidation(p)).toBe(true);
    expect(await revalidatePoint(p, now, fake([]))).toBe('restored');
    expect(p).toMatchObject({ lat: at(5)[0], lng: at(5)[1], location: { method: 'geocoded-address', rules: RULES } });
    // Removed under today's checks: not retried until the checks change.
    const gone = project(6, { lat: null, lng: null, location: { method: 'none', accuracy: 'none', source: 'x', verified: '2026-10-26', rules: RULES, previous: at(6), flags: ['address conflict'] } });
    expect(needsRevalidation(gone)).toBe(false);
  });
});

describe('ranges and units found in the first revalidation run', () => {
  const m = (matchedAddress: string, zip: string, city: string) => [{ matchedAddress, coordinates: { x: -97, y: 32.8 }, addressComponents: { state: 'TX', zip, city } }];
  it('accepts a match at any number of a filed range', () => {
    expect(pickGeocode('2122-2154 Estrada Pkwy, Irving, TX 75061', m('2154 ESTRADA PKWY, IRVING, TX, 75061', '75061', 'IRVING')).at).not.toBeNull();
    expect(pickGeocode('6301 and 6351 NE Loop 820, North Richland Hills, TX 76180', m('6351 NE LOOP 820, NORTH RICHLAND HILLS, TX, 76180', '76180', 'NORTH RICHLAND HILLS')).at).not.toBeNull();
    expect(pickGeocode('2122-2154 Estrada Pkwy, Irving, TX 75061', m('2200 ESTRADA PKWY, IRVING, TX, 75061', '75061', 'IRVING')).at).toBeNull();
  });
  it('reads the town before the state, not a building part', () => {
    expect(parseAddress('13330 Theis Lane, Bldg3, Tomball, TX 77057')).toMatchObject({ place: 'TOMBALL', zip: '77057' });
    expect(pickGeocode('13330 Theis Lane, Bldg3, Tomball, TX 77057', m('13330 THEIS LN, TOMBALL, TX, 77375', '77375', 'TOMBALL')).flag).toMatch(/filed ZIP 77057/);
  });
});

describe('revalidation false removals from the 6adb81f run', () => {
  it('reads "S. W." and "3459N" as directions', () => {
    expect(parseAddress('237 S. W. Anderson Street, Burleson, TX 76028')).toMatchObject({ number: '237', dir: 'SW', street: 'ANDERSON ST' });
    expect(parseAddress('3459N Country Club Road, Irving, TX 75017')).toMatchObject({ number: '3459', dir: 'N', street: 'COUNTRY CLUB RD' });
  });
  it('accepts the geocoder cutting a town name short', () => {
    expect(townsMatch('MANSFIEL', 'MANSFIELD')).toBe(true);
    expect(townsMatch('ALLEN', 'ALLENDALE')).toBe(false);
  });
});
