import { describe, expect, it } from 'vitest';
import { fetchCityPermitProjects, type PermitSource } from '../src/market/cityPermits.js';
import { addressKey, checkPoint, inferMethod, mayReplace, parseAddress, pickGeocode, sameAddress, sameSite, locationInfo } from '../src/market/devLocation.js';
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
    expect(pickGeocode('100 Main St, Boerne, TX 78006', [match('100 MAIN ST, SAN ANTONIO, TX, 78205', 29.43, -98.49, { zip: '78205' })]).at).toBeNull();
    expect(pickGeocode('100 N Main St, San Antonio, TX 78205', [match('100 S MAIN ST, SAN ANTONIO, TX, 78205', 29.42, -98.49, { zip: '78205', preDirection: 'S' })]).at).toBeNull();
    expect(pickGeocode('120 Main St, San Antonio, TX 78205', [match('100 MAIN ST, SAN ANTONIO, TX, 78205', 29.42, -98.49, { zip: '78205' })]).at).toBeNull();
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
