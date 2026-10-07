import { describe, expect, it } from 'vitest';
import { fetchSanAntonioPermits, permitPoint, permitProjects, projectName, siteKey, statePlaneToLatLng, tidyAddress, type PermitRow } from '../src/market/cityPermits.js';
import type { Development } from '../src/market/developments.js';

function permit(over: Partial<PermitRow> = {}): PermitRow {
  return {
    'PERMIT TYPE': 'Comm New Building Permit',
    'PERMIT #': 'COM-BLG-PMT26-1',
    'PROJECT NAME': 'Nacogdoches Apartments - Bld# 1-Apt.',
    'WORK TYPE': 'New',
    ADDRESS: '7010 COMANCHE LAND, CITY OF SAN ANTONIO, TX 78233',
    X_COORD: '-98.38',
    Y_COORD: '29.55',
    'DATE SUBMITTED': '2026-01-10',
    'DATE ISSUED': '2026-03-02',
    'DECLARED VALUATION': '36699990.0',
    'AREA (SF)': '40000.0',
    'PRIMARY CONTACT': 'B&A Architects',
    ...over
  };
}

const NOW = new Date('2026-10-07T00:00:00Z');

describe('San Antonio city permits', () => {
  it('reads state plane feet and plain degrees', () => {
    const [lat, lng] = statePlaneToLatLng(2076498.5, 13708187.9);
    // 8751 State Hwy 151, on the far west side.
    expect(lat).toBeCloseTo(29.44, 1);
    expect(lng).toBeCloseTo(-98.66, 1);
    expect(permitPoint({ X_COORD: -98.469568, Y_COORD: 29.406489 })).toEqual([29.406489, -98.469568]);
    expect(permitPoint({ X_COORD: null, Y_COORD: '29.4' })).toBeNull();
    expect(permitPoint({ X_COORD: '-96.8', Y_COORD: '32.7' })).toBeNull(); // Dallas is a bad point
  });

  it('cleans names and addresses', () => {
    expect(projectName('SPC Hyatt - Event Barn Building Bldg No: 17')).toBe('Hyatt - Event Barn Building');
    expect(projectName('AFF - 23219 N US HWY 281 B1 - STONES CROSSING')).toBe('23219 N US HWY 281 - STONES CROSSING');
    expect(projectName('AFF - B#2 - 10210 ZARZAMORA')).toBe('10210 ZARZAMORA');
    expect(projectName('SCH - ECISD-New HS-Pkg#2- Main')).toBe('ECISD-New HS');
    expect(projectName('HEB SA53 New Store #GEN #REV #NET')).toBe('HEB SA53 New Store');
    expect(projectName('AFF - 15407 LOOKOUT RD B-1A')).toBe('15407 LOOKOUT RD');
    expect(projectName('AFF - 9035 SOMERSET RD - B1- Brickstone Flats')).toBe('9035 SOMERSET RD - Brickstone Flats');
    expect(projectName('Perlen House Bldg No: 1; Unit No: NA')).toBe('Perlen House');
    expect(projectName('Building No: N/A; Unit No: N/A')).toBeNull();
    expect(tidyAddress('8751 STATE HWY 151, City of San Antonio, TX 78245')).toBe('8751 State Hwy 151, San Antonio, TX 78245');
    expect(siteKey('7010 Comanche Land, San Antonio, TX')).toBe(siteKey('7010 COMANCHE LAND, CITY OF SAN ANTONIO, TX 78233'));
    expect(siteKey('13210 PALO ALTO RD Bldg.1-7, City of San Antonio, TX 78224')).toBe('13210 PALO ALTO RD');
  });

  it('makes one project per site from its building permits', () => {
    const rows = [
      permit(),
      permit({ 'PERMIT #': 'COM-BLG-PMT26-2', 'PROJECT NAME': 'Nacogdoches Apartments - Bld# 2-Apt.' }),
      permit({ 'PERMIT TYPE': 'Electrical General Permit', 'PERMIT #': 'COM-BLG-PMT26-1' }),
      permit({ 'PERMIT #': 'SMALL', ADDRESS: '1 MAIN ST, City of San Antonio, TX 78205', 'DECLARED VALUATION': '400000' }),
      permit({ 'PERMIT #': 'OLD', ADDRESS: '2 MAIN ST, City of San Antonio, TX 78205', 'DATE ISSUED': '2024-11-01' }),
      permit({ 'PERMIT #': 'COP', 'PERMIT TYPE': 'Comm Addition Permit', 'PROJECT NAME': 'SPC-South Flores Police Substation Bldg 1', ADDRESS: '8811 S FLORES ST, City of San Antonio, TX 78221', 'DECLARED VALUATION': '22935950.0', X_COORD: '', Y_COORD: '' })
    ];
    const projects = permitProjects(rows, NOW);
    expect(projects.map((p) => p.name)).toEqual(['Nacogdoches Apartments', 'South Flores Police Substation']);
    const [apartments, police] = projects as [Development, Development];
    expect(apartments).toMatchObject({
      city: 'San Antonio',
      cost: 36699990,
      facility: '2 building permits',
      squareFeet: 80000,
      address: '7010 Comanche Land, San Antonio, TX 78233',
      contact: 'B&A Architects',
      isPublic: false,
      lat: 29.55,
      lng: -98.38,
      source: 'city',
      status: 'City permit issued'
    });
    expect(police).toMatchObject({ work: 'Addition', isPublic: true, lat: null });
  });

  it('keeps one project filed under two addresses on one tract', () => {
    const sky = { 'DECLARED VALUATION': '162100000', 'PROJECT NAME': 'SPC JCB Project Sky' };
    const projects = permitProjects(
      [
        permit({ ...sky, 'PERMIT #': 'A', ADDRESS: '13210 PALO ALTO RD, City of San Antonio, TX 78224', X_COORD: '', Y_COORD: '' }),
        permit({ ...sky, 'PERMIT #': 'B', ADDRESS: '13210 STATE HWY 16 RD S, City of San Antonio, TX 78224', X_COORD: '-98.556', Y_COORD: '29.288' })
      ],
      NOW
    );
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ name: 'JCB Project Sky', lat: 29.288 });
  });

  it('pages through the datastore and skips sites TABS already has', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: string | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ success: true, result: { total: 2, records: [permit(), permit({ 'PERMIT #': 'B', ADDRESS: '500 E HOUSTON ST, City of San Antonio, TX 78205', 'PROJECT NAME': 'Tower' })] } }));
    }) as typeof fetch;
    const tabs = [{ city: 'San Antonio', address: '500 E Houston St, San Antonio, TX 78205' } as Development];
    const projects = await fetchSanAntonioPermits(NOW, tabs, { fetchImpl, retries: 0 });
    expect(projects.map((p) => p.name)).toEqual(['Nacogdoches Apartments']);
    expect(urls).toHaveLength(1);
    expect(decodeURIComponent(urls[0]!)).toContain(`"PERMIT TYPE" IN ('Comm New Building Permit','Comm Shell Permit','Comm Addition Permit') AND "DATE ISSUED" >= '2025-04-07'`);
  });
});
