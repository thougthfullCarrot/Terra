import { describe, expect, it } from 'vitest';
import { center, fetchSites, isPublicOwner, siteQuery, SITE_SOURCES, toSite } from '../src/market/sites.js';
import { commonZoning, filterSites, formatArea } from '../../site/sites.js';

const houston = SITE_SOURCES.find((s) => s.city === 'Houston')!;
const fortWorth = SITE_SOURCES.find((s) => s.city === 'Fort Worth')!;
const ring = [[[-95.3, 29.7], [-95.2, 29.7], [-95.2, 29.8], [-95.3, 29.8], [-95.3, 29.7]]];

describe('site sources', () => {
  it('asks each layer for one use in the city, biggest first', () => {
    const q = siteQuery(houston, 'land', 240);
    expect(q.get('where')).toBe("SITE_ADDR_2='HOUSTON' AND (STATE_CLASS LIKE 'C2%' OR STATE_CLASS LIKE 'C3%') AND TOTAL_LAND_AREA >= 10000 AND TOTAL_LAND_AREA <= 4356000");
    expect(q.get('orderByFields')).toBe('TOTAL_LAND_AREA DESC');
    const sa = SITE_SOURCES.find((s) => s.city === 'San Antonio')!;
    expect(siteQuery(sa, 'industrial', 10).get('where')).toContain('Land_acres >= 0.2295');
    // Bexar files vacant land under its own code.
    expect(siteQuery(sa, 'land', 10).get('where')).toContain("(State_cd LIKE 'C1%')");
  });

  it('reads a Houston record and drops public owners', () => {
    const feature = {
      attributes: {
        TAX_ID: '0513850000003',
        STATE_CLASS: 'C2',
        SITE_ADDR_1: '11013 BEAUMONT HWY',
        LAND_VALUE: 1_247_611,
        TOTAL_APPRAISED_VALUE: 980_822,
        TOTAL_LAND_AREA: 1_000_000,
        FLOOD_ZONE: 'AE-FLOODWAY',
        OWNER_LIST: 'ACME LAND LLC'
      },
      geometry: { rings: ring }
    };
    expect(toSite(houston, 'land', feature)).toMatchObject({
      id: '0513850000003',
      city: 'Houston',
      use: 'land',
      code: 'C2',
      landSqft: 1_000_000,
      landPsf: 1.25,
      value: 980_822,
      built: null,
      flood: 'AE-FLOODWAY',
      lat: 29.75,
      lng: -95.25
    });
    expect(toSite(houston, 'land', { ...feature, attributes: { ...feature.attributes, OWNER_LIST: 'CITY OF HOUSTON' } })).toBeNull();
    expect(isPublicOwner('HARRIS COUNTY FLOOD CONTROL')).toBe(true);
    expect(isPublicOwner('PUBLIC STORAGE PROPERTIES LTD')).toBe(false);
    expect(isPublicOwner('SAN ANTONIO WATER SYSTEM __PUBLIC__')).toBe(true);
  });

  it('finds a polygon center', () => {
    expect(center({ rings: ring })).toEqual({ lat: 29.75, lng: -95.25 });
    expect(center(null)).toBeNull();
  });

  it('fetches sites and their zoning', async () => {
    const calls: string[] = [];
    const sites = await fetchSites([fortWorth], {
      perUse: 2,
      get: async (url) => {
        calls.push(url);
        if (url.includes('MapServer/54')) return { features: [{ attributes: { ZONING: 'I' } }] };
        if (!url.includes("STATE_USE_CODE+LIKE+%27F2")) return { features: [] };
        return {
          features: [
            { attributes: { ACCOUNT: '1', STATE_USE_CODE: 'F2', SITUS_ADDR: '1 MAIN', LAND_VAL: 100_000, APPRAISED_VALUE: 500_000, LAND_SQFT: 50_000, OWNER_NAME: 'X LLC' }, geometry: { rings: ring } },
            { attributes: { ACCOUNT: '1', STATE_USE_CODE: 'F2', SITUS_ADDR: '1 MAIN', LAND_VAL: 100_000, APPRAISED_VALUE: 500_000, LAND_SQFT: 50_000, OWNER_NAME: 'X LLC' }, geometry: { rings: ring } },
            { attributes: { ACCOUNT: '2', STATE_USE_CODE: 'F2', SITUS_ADDR: '2 MAIN', LAND_VAL: 0, APPRAISED_VALUE: 1, LAND_SQFT: 20_000, OWNER_NAME: 'FORT WORTH CITY OF' } }
          ]
        };
      }
    });
    expect(sites).toEqual([expect.objectContaining({ id: '1', use: 'industrial', zoning: 'I', landPsf: 2 })]);
    expect(calls.filter((u) => u.includes('MapServer/54'))).toHaveLength(1);
  });
});

describe('site finder filters', () => {
  const sites = [
    { id: 'a', city: 'Houston', use: 'land' as const, landSqft: 100_000, landPsf: 5, value: 400_000, zoning: null },
    { id: 'b', city: 'Austin', use: 'commercial' as const, landSqft: 50_000, landPsf: 40, value: 9_000_000, zoning: 'MF-3-NP' },
    { id: 'c', city: 'Fort Worth', use: 'industrial' as const, landSqft: 500_000, landPsf: 3, value: 2_000_000, zoning: 'PD1234' },
    { id: 'd', city: 'Austin', use: 'land' as const, landSqft: 20_000, landPsf: null, value: null, zoning: 'GR-V-CO' }
  ];

  it('filters by city, use, zoning, price and size', () => {
    expect(filterSites(sites, '').map((s) => s.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(filterSites(sites, 'Austin').map((s) => s.id)).toEqual(['b', 'd']);
    expect(filterSites(sites, '', { use: 'land' }).map((s) => s.id)).toEqual(['a', 'd']);
    expect(filterSites(sites, '', { zoning: 'mf' }).map((s) => s.id)).toEqual(['b']);
    expect(filterSites(sites, '', { zoning: 'PD' }).map((s) => s.id)).toEqual(['c']);
    expect(filterSites(sites, '', { zoning: 'CO' }).map((s) => s.id)).toEqual(['d']);
    expect(filterSites(sites, '', { minPsf: 4, maxPsf: 10 }).map((s) => s.id)).toEqual(['a']);
    expect(filterSites(sites, '', { minAcres: 2 }).map((s) => s.id)).toEqual(['c', 'a']);
  });

  it('sorts by land price with blanks last', () => {
    expect(filterSites(sites, '', { sort: 'psf-asc' }).map((s) => s.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(filterSites(sites, '', { sort: 'psf-desc' }).map((s) => s.id)).toEqual(['b', 'a', 'c', 'd']);
    expect(filterSites(sites, '', { sort: 'value-desc' }).map((s) => s.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('formats areas and lists common zoning', () => {
    expect(formatArea(43_560 * 2.44)).toBe('2.4 acres');
    expect(formatArea(43_560 * 25.6)).toBe('26 acres');
    expect(formatArea(18_500)).toBe('18,500 sq ft');
    expect(commonZoning(sites)).toEqual(['GR', 'MF', 'PD1234']);
  });
});
