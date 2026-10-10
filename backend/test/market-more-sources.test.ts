import { describe, expect, it } from 'vitest';
import { parseFhfaMetro } from '../src/market/fhfa.js';
import { RATE_SERIES, readRate } from '../src/market/fred.js';
import { parseFmr } from '../src/market/hudFmr.js';
import { parseLihtc } from '../src/market/lihtc.js';
import { METROS } from '../src/market/metros.js';
import { parseRealtorMetro } from '../src/market/realtor.js';
import { parseRedfinLines } from '../src/market/redfin.js';
import { buildMarketSnapshot, GROUPS, METRICS } from '../src/market/snapshot.js';

const now = new Date('2026-10-05T15:00:00Z');

describe('Redfin city tracker', () => {
  const head = [
    'PERIOD_BEGIN', 'PERIOD_END', 'PERIOD_DURATION', 'REGION_TYPE', 'IS_SEASONALLY_ADJUSTED', 'REGION', 'CITY', 'STATE', 'STATE_CODE',
    'PROPERTY_TYPE', 'MEDIAN_SALE_PRICE', 'MEDIAN_SALE_PRICE_YOY', 'INVENTORY', 'MEDIAN_DOM', 'AVG_SALE_TO_LIST'
  ].map((h) => `"${h}"`).join('\t');
  const row = (end: string, city: string, state: string, type: string, price: string, sa = 'false') =>
    [`"2026-06-01"`, `"${end}"`, '90', '"place"', `"${sa}"`, `"${city}, ${state}"`, `"${city}"`, '"Texas"', `"${state}"`, `"${type}"`, price, '0.031', '4210', '52', '0.9712'].join('\t');

  it('keeps the latest All Residential row per Texas city, as percents', async () => {
    const lines = [
      head,
      row('2026-07-31', 'Dallas', 'TX', 'All Residential', '400000'),
      row('2026-08-31', 'Dallas', 'TX', 'All Residential', '410000'),
      row('2026-08-31', 'Dallas', 'TX', 'All Residential', '999999', 'true'),
      row('2026-08-31', 'Dallas', 'TX', 'Single Family Residential', '500000'),
      row('2026-08-31', 'Austin', 'GA', 'All Residential', '1'),
      row('2026-08-31', 'El Paso', 'TX', 'All Residential', 'NA')
    ];
    const out = await parseRedfinLines(lines, ['Dallas', 'El Paso', 'Austin']);
    expect(out.get('Dallas')).toMatchObject({ medianSalePrice: 410000, medianSalePriceYoy: 3.1, inventory: 4210, medianDom: 52, saleToList: 97.12, period: 'Aug 2026' });
    expect(out.get('El Paso')?.medianSalePrice).toBeNull();
    expect(out.has('Austin')).toBe(false);
  });
});

describe('Realtor.com metro inventory', () => {
  it('takes the latest month per CBSA and the price-cut share as a percent', () => {
    const text = [
      'month_date_yyyymm,cbsa_code,cbsa_title,HouseholdRank,median_listing_price,active_listing_count,median_days_on_market,price_reduced_share',
      '202608,19100,"Dallas-Fort Worth-Arlington, TX",4,425000,31000,55,0.2123',
      '202607,19100,"Dallas-Fort Worth-Arlington, TX",4,430000,30000,50,0.2',
      '202608,12420,"Austin-Round Rock-San Marcos, TX",26,499000,12000,68,0.25',
      '202608,99999,"Elsewhere",1,1,1,1,0.1',
      'quality_flag,,,,,,,'
    ].join('\n');
    const out = parseRealtorMetro(text, ['19100', '12420']);
    expect(out.get('19100')).toEqual({ medianListingPrice: 425000, activeListings: 31000, medianDom: 55, priceReducedShare: 21.23, period: 'Aug 2026' });
    expect(out.size).toBe(2);
  });
});

describe('FHFA metro HPI', () => {
  it('reads the headerless file, with 1- and 5-year change', () => {
    const lines = ['"Dallas-Plano-Irving, TX (MSAD)",19124,2021,2,200.00,1.5', '"Dallas-Plano-Irving, TX (MSAD)",19124,2025,2,290.00,1.5'];
    lines.push('"Dallas-Plano-Irving, TX (MSAD)",19124,2026,2,300.00,1.6', '"Austin-Round Rock, TX",12420,2026,2,-,-', '"Other",11111,2026,2,100,1');
    const out = parseFhfaMetro(lines.join('\n'), ['19124', '12420']);
    expect(out.get('19124')).toEqual({ index: 300, change1y: 3.4, change5y: 50, period: 'Q2 2026' });
    expect(out.has('12420')).toBe(false);
  });
});

describe('HUD Fair Market Rents', () => {
  it('reads a metro without small areas', () => {
    const body = { data: { year: '2026', basicdata: { Efficiency: 1201, 'One-Bedroom': 1300, 'Two-Bedroom': 1550, 'Three-Bedroom': 2010, 'Four-Bedroom': 2400 } } };
    expect(parseFmr(body)).toEqual({ rents: [1201, 1300, 1550, 2010, 2400], period: 'FY 2026' });
  });

  it('uses the MSA level row of a small-area response', () => {
    const body = {
      data: {
        year: 2026,
        basicdata: [
          { zip_code: '75201', Efficiency: 2000, 'One-Bedroom': 2100, 'Two-Bedroom': 2500, 'Three-Bedroom': 3000, 'Four-Bedroom': 3500 },
          { zip_code: 'MSA level', Efficiency: 1400, 'One-Bedroom': 1500, 'Two-Bedroom': 1750, 'Three-Bedroom': 2200, 'Four-Bedroom': 2700 }
        ]
      }
    };
    expect(parseFmr(body)?.rents).toEqual([1400, 1500, 1750, 2200, 2700]);
    expect(parseFmr({})).toBeNull();
  });
});

describe('HUD LIHTC database', () => {
  it('counts properties and low-income units per metro from the census tract', () => {
    const text = [
      'HUD_ID,PROJECT,PROJ_CTY,PROJ_ST,FIPS2010,ST2010,CNTY2010,N_UNITS,LI_UNITS,YR_PIS',
      'TXA1,"Oak Court, Phase 1",Dallas,TX,48113010100,48,113,100,90,2023',
      'TXA2,Elm,Irving,TX,48113020200,48,113,50,,1999',
      'TXA3,Bayou,Houston,TX,48201310100,48,201,200,200,8888',
      'TXA4,Far,Lubbock,TX,48303000100,48,303,40,40,2024',
      'OKA1,Okie,Tulsa,OK,40143000100,40,143,40,40,2024'
    ].join('\n');
    const out = parseLihtc(text, METROS, now);
    expect(out.get('19124')).toEqual({ projects: 2, units: 140, recentProjects: 1 });
    expect(out.get('26420')).toEqual({ projects: 1, units: 200, recentProjects: 0 });
    expect(out.get('31180')).toEqual({ projects: 1, units: 40, recentProjects: 1 });
    expect(out.size).toBe(3);
  });
});

describe('Dallas Fed survey via FRED', () => {
  it('labels the monthly diffusion index as an index', () => {
    const series = RATE_SERIES.find((s) => s.id === 'BACTSAMFRBDAL')!;
    const reading = readRate(series, [
      { date: '2025-09-01', value: -5 },
      { date: '2026-09-01', value: 3.2 }
    ]);
    expect(reading).toMatchObject({ value: 3.2, change: 8.2, period: 'Sep 2026', format: 'index' });
  });
});

describe('snapshot with the new sources', () => {
  it('fills the new figures and lists them in groups', () => {
    const snap = buildMarketSnapshot(METROS, null, null, now, {
      redfin: new Map([['Dallas', { medianSalePrice: 410000, medianSalePriceYoy: 3.1, inventory: 4210, medianDom: 52, saleToList: 97.1, periodEnd: '2026-08-31', period: 'Aug 2026', seasonallyAdjusted: false }]]),
      realtor: new Map([['19100', { medianListingPrice: 425000, activeListings: 31000, medianDom: 55, priceReducedShare: 21.2, period: 'Aug 2026' }]]),
      fhfa: new Map([['23104', { index: 300, change1y: 3.4, change5y: 50, period: 'Q2 2026' }]]),
      fmr: new Map([['Houston', { rents: [1100, 1200, 1450, 1900, 2300], period: 'FY 2026' }]]),
      lihtc: new Map([['21340', { projects: 40, units: 5000, recentProjects: 6 }]])
    });
    const by = (city: string) => snap.markets.find((m) => m.city === city)!;
    expect(by('Dallas').values.redfinPrice).toBe(410000);
    expect(by('Fort Worth').values.rdcListPrice).toBe(425000);
    expect(by('Fort Worth').periods.rdcListPrice).toBe('Aug 2026, DFW metro');
    expect(by('Fort Worth').values.hpiGrowth5y).toBe(50);
    expect(by('Houston').values.fmr2).toBe(1450);
    // LIHTC is not published while HUD's download is blocked, even if counts are passed in.
    expect(by('El Paso').values.lihtcUnits).toBeUndefined();
    expect(METRICS.some((m) => m.key.startsWith('lihtc'))).toBe(false);
    // Fort Worth's Realtor.com figure is the DFW metro's, the same observation as Dallas's.
    expect(by('Fort Worth').shared?.rdcListPrice).toBe('Dallas');
    expect(by('Austin').values.redfinPrice).toBeNull();
    const keys = new Set(METRICS.map((m) => m.key));
    for (const group of GROUPS) for (const key of group.metrics) expect(keys.has(key)).toBe(true);
    expect(snap.sources.some((s) => s.name.startsWith('Redfin'))).toBe(true);
  });
});
