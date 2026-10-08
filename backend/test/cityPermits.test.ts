import { describe, expect, it } from 'vitest';
import {
  arlingtonPermit,
  austinPermit,
  fetchCityPermitProjects,
  fortWorthPermit,
  permitPoint,
  permitProjects,
  projectName,
  sanAntonioPermit,
  siteKey,
  statePlaneToLatLng,
  tidyAddress,
  type CityPermit,
  type PermitRow
} from '../src/market/cityPermits.js';
import type { Development } from '../src/market/developments.js';

function row(over: Partial<PermitRow> = {}): PermitRow {
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
const sa = (over: Partial<PermitRow> = {}) => sanAntonioPermit(row(over))!;

const NOW = new Date('2026-10-07T00:00:00Z');

describe('San Antonio permits', () => {
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

  it('skips other permit types', () => {
    expect(sanAntonioPermit(row({ 'PERMIT TYPE': 'Electrical General Permit' }))).toBeNull();
  });
});

describe('grouping permits into projects', () => {
  it('makes one project per site from its building permits', () => {
    const permits = [
      sa(),
      sa({ 'PERMIT #': 'COM-BLG-PMT26-2', 'PROJECT NAME': 'Nacogdoches Apartments - Bld# 2-Apt.' }),
      sa({ 'PERMIT #': 'SMALL', ADDRESS: '1 MAIN ST, City of San Antonio, TX 78205', 'DECLARED VALUATION': '400000' }),
      sa({ 'PERMIT #': 'OLD', ADDRESS: '2 MAIN ST, City of San Antonio, TX 78205', 'DATE ISSUED': '2024-11-01' }),
      sa({ 'PERMIT #': 'COP', 'PERMIT TYPE': 'Comm Addition Permit', 'PROJECT NAME': 'SPC-South Flores Police Substation Bldg 1', ADDRESS: '8811 S FLORES ST, City of San Antonio, TX 78221', 'DECLARED VALUATION': '22935950.0', X_COORD: '', Y_COORD: '' })
    ];
    const projects = permitProjects(permits, NOW);
    expect(projects.map((p) => p.name)).toEqual(['Nacogdoches Apartments', 'South Flores Police Substation']);
    const [apartments, police] = projects as [Development, Development];
    expect(apartments).toMatchObject({
      city: 'San Antonio',
      place: 'San Antonio',
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
        sa({ ...sky, 'PERMIT #': 'A', ADDRESS: '13210 PALO ALTO RD, City of San Antonio, TX 78224', X_COORD: '', Y_COORD: '' }),
        sa({ ...sky, 'PERMIT #': 'B', ADDRESS: '13210 STATE HWY 16 RD S, City of San Antonio, TX 78224', X_COORD: '-98.556', Y_COORD: '29.288' })
      ],
      NOW
    );
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ name: 'JCB Project Sky', lat: 29.288 });
  });
});

describe('Austin, Fort Worth and Arlington permits', () => {
  it('reads an Austin permit and groups by master permit', () => {
    const base = {
      permit_number: '2025-154155 BP',
      permit_class: 'C- 105 Five or More Family Bldgs',
      work_class: 'New',
      permit_location: '6915 BRIDGE POINT PKWY BLDG 12',
      description: 'ePlan: Expedited Review - New Construction of a Multi-Story Mixed Use Multi-Family Bldg. - Lake View East - Module I.',
      issue_date: '2026-06-08T00:00:00.000',
      status_current: 'Active',
      total_job_valuation: '830000000',
      total_new_add_sqft: '36922',
      latitude: '30.35',
      longitude: '-97.80',
      masterpermitnum: '13107658',
      contractor_company_name: 'Harvey-Cleary Builders ***MAIN***',
      original_city: 'AUSTIN',
      original_zip: '78730',
      link: { url: 'https://abc.austintexas.gov/web/permit/x' }
    };
    const a = austinPermit(base)!;
    expect(a).toMatchObject({
      market: 'Austin',
      place: 'Austin',
      group: '13107658',
      address: '6915 Bridge Point Pkwy, Austin, TX 78730',
      lat: 30.35,
      contact: null,
      contractor: 'Harvey-Cleary Builders',
      url: 'https://abc.austintexas.gov/web/permit/x'
    });
    expect(austinPermit({ ...base, status_current: 'Final' })).toBeNull();
    expect(austinPermit({ ...base, contractor_trade: 'General Contractor' })!.contractor).toBe('Harvey-Cleary Builders');
    expect(austinPermit({ ...base, contractor_trade: 'Electrical Contractor' })).toMatchObject({ contractor: null, contact: 'Harvey-Cleary Builders' });
    const garage = austinPermit({ ...base, permit_number: '2025-154179 BP', permit_location: '6915 BRIDGE POINT PKWY BLDG 10 UNIT GAR' })!;
    const projects = permitProjects([a, garage], NOW);
    expect(projects).toHaveLength(1);
    expect(projects[0]!.contractor).toBe('Harvey-Cleary Builders');
  });

  it('reads Fort Worth and Arlington permits onto the Fort Worth map', () => {
    const fw = fortWorthPermit({
      Permit_No: 'PB26-1',
      Permit_SubType: 'New',
      B1_SPECIAL_TEXT: 'X TEAM /// Alliance Logistics Building 7',
      B1_WORK_DESC: 'New warehouse shell',
      Address: '2400 ALLIANCE BLVD, FORT WORTH, TX',
      Zip_Code: '76177',
      Owner_Full_Name: 'Hillwood Development',
      Status_Date: Date.UTC(2026, 4, 1),
      Current_Status: 'Issued',
      Latitude: 32.98,
      Longitude: -97.31,
      JobValue: 42000000,
      SqFt: '600000'
    })!;
    expect(fw).toMatchObject({ market: 'Fort Worth', name: 'Alliance Logistics Building 7', owner: 'Hillwood Development', address: '2400 Alliance Blvd, Fort Worth, TX 76177', lat: 32.98, issued: '2026-05-01' });
    expect(fortWorthPermit({ Current_Status: 'Finaled', Status_Date: Date.UTC(2026, 4, 1) })).toBeNull();
    const ar = arlingtonPermit(
      { FOLDERYEAR: '25', FOLDERSEQUENCE: '072631', STATUSDESC: 'Issued', ISSUEDATE: Date.UTC(2026, 1, 5), SUBDESC: 'Business', WORKDESC: 'New Construction', FOLDERNAME: '1500 CONVENTION CENTER DRIVE', ConstructionValuationDeclared: 227338653, MainUse: 'Hotel/Motel' },
      { x: -97.0818, y: 32.7571 }
    )!;
    expect(ar).toMatchObject({ market: 'Fort Worth', place: 'Arlington', name: 'Hotel/Motel at 1500 Convention Center Drive', lat: 32.7571, value: 227338653 });
  });

  it('runs each source for its market, skips sites TABS has, and survives a failing source', async () => {
    const lines: string[] = [];
    const permit = (over: Partial<CityPermit>): CityPermit => ({ ...sa(), ...over });
    const tabs = [{ city: 'San Antonio', address: '500 E Houston St, San Antonio, TX 78205' } as Development];
    const projects = await fetchCityPermitProjects(['San Antonio', 'Houston'], NOW, tabs, {
      log: (l) => lines.push(l),
      sources: [
        { name: 'San Antonio', market: 'San Antonio', fetch: async () => [permit({}), permit({ permit: 'B', group: '500 E HOUSTON ST', address: '500 E Houston St, San Antonio, TX 78205' })] },
        { name: 'Broken', market: 'San Antonio', fetch: async () => Promise.reject(new Error('502')) },
        { name: 'Austin', market: 'Austin', fetch: async () => [permit({ market: 'Austin' })] }
      ]
    });
    expect(projects.map((p) => p.name)).toEqual(['Nacogdoches Apartments']);
    expect(lines).toEqual(['San Antonio city permits: 1 more projects', 'Broken city permits: not read (502)']);
  });
});
