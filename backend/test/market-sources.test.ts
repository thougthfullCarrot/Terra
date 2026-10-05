import { describe, expect, it, vi } from 'vitest';
import { findApartmentListFiles, parseRentSummary, parseVacancy } from '../src/market/apartmentList.js';
import { parseCsvLine } from '../src/market/csv.js';
import { METROS } from '../src/market/metros.js';
import { fetchPermits, parsePermitFile, permitFileUrl } from '../src/market/permits.js';
import { buildMarketSnapshot } from '../src/market/snapshot.js';
import { parseZillowCities } from '../src/market/zillow.js';

const cities = METROS.map((m) => m.city);
const now = new Date('2026-10-04T15:00:00Z');

describe('parseCsvLine', () => {
  it('splits on commas outside quotes and unescapes doubled quotes', () => {
    expect(parseCsvLine('a,"Dallas, TX","say ""hi""",,4\r')).toEqual(['a', 'Dallas, TX', 'say "hi"', '', '4']);
  });
});

describe('Zillow', () => {
  const months = Array.from({ length: 13 }, (_, i) => `${i < 5 ? 2025 : 2026}-${String(((i + 7) % 12) + 1).padStart(2, '0')}-28`);
  const header = `RegionID,SizeRank,RegionName,RegionType,StateName,State,Metro,CountyName,${months.join(',')}`;
  const row = (name: string, state: string, first: number, last: string) =>
    `1,1,${name},city,${state},${state},"${name}, ${state}",X County,${first},${Array(11).fill(first + 1).join(',')},${last}`;

  it('reads Texas city rows: the newest month and the same month a year earlier', () => {
    const text = [header, row('Dallas', 'TX', 300000, '315000'), row('Dallas', 'GA', 1, '2'), row('Austin', 'TX', 500000, '')].join('\n');
    const result = parseZillowCities(text, cities);
    expect(result.get('Dallas')).toEqual({ value: 315000, yearAgo: 300000, period: 'Aug 2026' });
    // Austin's newest month is blank, so its latest is July, which has no year-earlier column here.
    expect(result.get('Austin')).toEqual({ value: 500001, yearAgo: null, period: 'Jul 2026' });
    expect(result.has('Houston')).toBe(false);
  });
});

describe('Apartment List', () => {
  it('finds the newest download links on the data page', () => {
    const html = `<a href="//assets.ctfassets.net/x/1/a/Apartment_List_Vacancy_Index_2026_08.csv">
      <a href="//assets.ctfassets.net/x/2/b/Apartment_List_Vacancy_Index_2026_09.csv">
      <a href="//assets.ctfassets.net/x/3/c/Apartment_List_Rent_Estimates_Summary_2026_09.csv">`;
    expect(findApartmentListFiles(html)).toEqual({
      summary: 'https://assets.ctfassets.net/x/3/c/Apartment_List_Rent_Estimates_Summary_2026_09.csv',
      vacancy: 'https://assets.ctfassets.net/x/2/b/Apartment_List_Vacancy_Index_2026_09.csv'
    });
  });

  it('reads city rent and its yearly change from the summary', () => {
    const text = [
      '"location_name","location_type","location_fips_code","population","state","county","metro","year","month","rent_change_mom","rent_change_yoy","rent_change_pandemic","price_overall","price_1br","price_2br"',
      '"Dallas, TX","Metro","19100",1,"Texas","","",2026,9,0,0.05,0,1500,1,1',
      '"Dallas, TX","City","4819000",1,"Texas","Dallas County","Dallas",2026,9,-0.0028,-0.0146,0.1584,1324,1209,1432'
    ].join('\n');
    const dallas = parseRentSummary(text, cities).get('Dallas')!;
    expect(dallas.value).toBe(1324);
    expect(dallas.period).toBe('Sep 2026');
    expect(((dallas.value - dallas.yearAgo!) / dallas.yearAgo!) * 100).toBeCloseTo(-1.46, 6);
  });

  it('reads the newest vacancy column as a percent', () => {
    const text = [
      '"location_name","location_type","location_fips_code","population","state","county","metro","2025_09","2026_08","2026_09"',
      '"Houston, TX","City","4835000",1,"Texas","","",0.07,0.08,0.081'
    ].join('\n');
    expect(parseVacancy(text, cities).get('Houston')).toEqual({ value: 8.1, yearAgo: 7.000000000000001, period: 'Sep 2026' });
  });
});

describe('Census Building Permits Survey', () => {
  const line = (name: string, state = '48') =>
    `202608,${state},240500,0,0,0,0,0,0,0,0,0,0,0,0,0,${name.padEnd(30)},4474,4474,979062414,5,10,603276,7,27,2685653,93,4284,337540704,1,1,1`;

  it('names the year-to-date South Region file', () => {
    expect(permitFileUrl(2026, 8)).toBe('https://www2.census.gov/econ/bps/Place/South%20Region/so2608y.txt');
  });

  it('adds units across building sizes and keeps the 5+ unit count apart', () => {
    const text = ['Survey,FIPS,...', 'Date,State,...', '', line('Fort Worth'), line('Dallas', '13')].join('\n');
    const result = parsePermitFile(text, cities);
    expect(result.get('Fort Worth')).toEqual({ units: 4474 + 10 + 27 + 4284, multifamilyUnits: 4284 });
    expect(result.has('Dallas')).toBe(false);
  });

  it('walks back past months not yet published, and reads the year before', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('so2609y.txt')) return new Response('missing', { status: 404 });
      return new Response(url.endsWith('so2608y.txt') ? line('Austin') : line('Austin').replace('4474,4474', '1,2000'));
    });
    const result = await fetchPermits(cities, { fetchImpl: fetchImpl as unknown as typeof fetch, now, retries: 0 });
    expect(result.period).toBe('Jan–Aug 2026');
    expect(result.current.get('Austin')!.units).toBe(8795);
    expect(result.previous.get('Austin')!.units).toBe(2000 + 10 + 27 + 4284);
  });
});

describe('buildMarketSnapshot with property data', () => {
  it('fills the new figures for the cities each source covers', () => {
    const snapshot = buildMarketSnapshot(METROS, null, null, now, {
      zillow: { homeValue: new Map([['Dallas', { value: 300000, yearAgo: 280000, period: 'Aug 2026' }]]), rent: new Map() },
      apartmentList: { rent: new Map(), vacancy: new Map([['Dallas', { value: 7.5, yearAgo: 7, period: 'Sep 2026' }]]) },
      permits: { current: new Map([['Dallas', { units: 120, multifamilyUnits: 80 }]]), previous: new Map([['Dallas', { units: 100, multifamilyUnits: 50 }]]), period: 'Jan–Aug 2026' }
    });
    const dallas = snapshot.markets.find((m) => m.city === 'Dallas')!;
    expect(dallas.values.zhvi).toBe(300000);
    expect(dallas.values.zhviGrowth).toBeCloseTo(7.142857, 5);
    expect(dallas.values.aptVacancy).toBe(7.5);
    expect(dallas.periods.aptVacancy).toBe('Sep 2026');
    expect(dallas.values.permitUnits).toBe(120);
    expect(dallas.values.permitGrowth).toBe(20);
    expect(dallas.periods.permitUnits).toBe('Jan–Aug 2026');
    expect(snapshot.markets.find((m) => m.city === 'Houston')!.values.zhvi).toBeNull();
  });
});
