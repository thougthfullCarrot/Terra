import { describe, expect, it } from 'vitest';
import {
  Aggregator,
  DallasRoll,
  harrisParser,
  median,
  stateClass,
  tarrantParser,
  travisLandLine,
  travisPropLine,
  trimmed
} from '../src/market/appraisal.js';
import { METROS } from '../src/market/metros.js';
import { buildMarketSnapshot } from '../src/market/snapshot.js';

describe('stateClass', () => {
  it('reads commercial, industrial and apartments from the state code prefix', () => {
    expect(stateClass('F1')).toBe('commercial');
    expect(stateClass('F10')).toBe('commercial');
    expect(stateClass('F2 ')).toBe('industrial');
    expect(stateClass('B1')).toBe('multifamily');
    expect(stateClass('B2')).toBeNull();
    expect(stateClass('A1')).toBeNull();
    expect(stateClass('B12', (c) => c.startsWith('B'))).toBe('multifamily');
  });
});

describe('Harris', () => {
  const header = 'acct\tsite_addr_2\tstate_class\tland_ar\tland_val\ttot_appr_val\tprior_tot_appr_val\tnew_construction_val';
  it('keeps Houston commercial, industrial and apartment accounts', () => {
    const parse = harrisParser(header);
    expect(parse('1\tHOUSTON\tF1\t5001\t300060\t310165\t300000\t0')).toEqual({
      cls: 'commercial',
      value: 310165,
      priorValue: 300000,
      landValue: 300060,
      landSqft: 5001,
      newConstruction: 0
    });
    expect(parse('2\tKATY\tF1\t5001\t1\t2\t3\t0')).toBeNull();
    expect(parse('3\tHOUSTON\tA1\t5001\t1\t2\t3\t0')).toBeNull();
    expect(parse('4\tHOUSTON\tX1\t44431\t0\t0\t0\t0')).toBeNull();
  });
});

describe('Dallas', () => {
  it('joins the city, land area and value files by account', () => {
    const roll = new DallasRoll();
    roll.infoLine('"ACCOUNT_NUM","APPRAISAL_YR","DIVISION_CD","PROPERTY_CITY"');
    roll.infoLine('"A1","2026","COM","DALLAS"');
    roll.infoLine('"A2","2026","COM","IRVING"');
    roll.infoLine('"A3","2026","RES","DALLAS"');
    roll.landLine('"ACCOUNT_NUM","APPRAISAL_YR","SECTION_NUM","AREA_SIZE","AREA_UOM_DESC"');
    roll.landLine('"A1","2026","1","10000.000","SQUARE FEET"');
    roll.landLine('"A1","2026","2","0.5","ACRE"');
    const header = '"ACCOUNT_NUM","APPRAISAL_YR","LAND_VAL","TOT_VAL","PREV_MKT_VAL","DIVISION_CD","SPTD_CODE"';
    expect(roll.yearLine(header)).toBeNull();
    expect(roll.yearLine('"A1","2026","500000.00","2000000.00","1800000.00","COM","F10"')).toEqual({
      cls: 'commercial',
      value: 2_000_000,
      priorValue: 1_800_000,
      landValue: 500_000,
      landSqft: 10_000 + 21_780
    });
    expect(roll.yearLine('"A2","2026","1","2","3","COM","F10"')).toBeNull();
    // A duplex: a B code in the residential division is not an apartment property.
    expect(roll.yearLine('"A3","2026","1","2","3","RES","B12"')).toBeNull();
  });
});

describe('Tarrant', () => {
  it('reads Fort Worth accounts and treats B codes on commercial accounts as apartments', () => {
    const parse = tarrantParser('RP|Appraisal_Year|Account_Num|City|State_Use_Code|Land_Value|Appraised_Value|Land_SqFt');
    expect(parse('C|2026|00000051|026|F1|450000|900000|5000.00')).toEqual({
      account: '51',
      cls: 'commercial',
      value: 900000,
      landValue: 450000,
      landSqft: 5000
    });
    expect(parse('C|2026|52|026|BC|1|2|3')?.cls).toBe('multifamily');
    expect(parse('R|2026|53|026|B2|1|2|3')).toBeNull();
    expect(parse('C|2026|54|010|F1|1|2|3')).toBeNull();
  });
});

describe('Travis', () => {
  function prop(fields: Record<number, string>): string {
    const line = Array(2800).fill(' ');
    for (const [start, text] of Object.entries(fields)) [...text].forEach((ch, i) => (line[Number(start) - 1 + i] = ch));
    return line.join('');
  }
  it('reads the fixed-width property and land files', () => {
    const land = new Map<string, number>();
    travisLandLine(
      '0000001000082026000008024994LAND      Land                     F1   F00000000005398000000000235120000000000000000000000000000SF   SPECIAL SF00000004232160F',
      land
    );
    expect(land.get('100008')).toBe(23512);

    const austin = prop({ 1: '000000100008', 13: 'R', 1110: 'AUSTIN', 1811: '000000004232160', 1916: '000000005541000', 2732: 'F1' });
    expect(travisPropLine(austin, land)).toEqual({ cls: 'commercial', value: 5_541_000, landValue: 4_232_160, landSqft: 23512 });
    // No situs city: an Austin ZIP code counts, another does not.
    expect(travisPropLine(prop({ 1: '000000100009', 13: 'R', 1140: '78704', 1916: '000000000100000', 2742: 'B1' }), land)?.cls).toBe(
      'multifamily'
    );
    expect(travisPropLine(prop({ 1: '000000100010', 13: 'R', 1140: '78660', 1916: '000000000100000', 2732: 'F1' }), land)).toBeNull();
    expect(travisPropLine(prop({ 1: '000000100011', 13: 'P', 1110: 'AUSTIN', 1916: '000000000100000', 2732: 'F1' }), land)).toBeNull();
  });
});

describe('Aggregator', () => {
  it('summarizes value, growth on properties appraised both years, and trimmed land $/sq ft', () => {
    const totals = new Aggregator();
    for (let i = 1; i <= 200; i++) {
      totals.add({ cls: 'industrial', value: i * 1000, priorValue: i <= 100 ? i * 1000 * 0.9 : null, landValue: i * 10, landSqft: 1000 });
    }
    // An outlier land price and a sliver too small to count.
    totals.add({ cls: 'industrial', value: 1000, landValue: 5_000_000, landSqft: 1000 });
    totals.add({ cls: 'industrial', value: 1000, landValue: 100, landSqft: 10 });
    const summary = totals.summary('Fort Worth', 'Tarrant', '2026 roll');
    const industrial = summary.classes.industrial!;
    expect(industrial.parcels).toBe(202);
    expect(industrial.valueGrowth).toBeCloseTo(11.111, 2);
    expect(industrial.landParcels).toBe(201 - 2 * 2);
    // The $5,000/sq ft outlier is trimmed away; land runs $0.01 to $2.00.
    expect(industrial.landPsf).toBeCloseTo(1.01, 2);
    expect(industrial.medianLandPsf).toBeCloseTo(1.01, 2);
    expect(industrial.newConstruction).toBeNull();
    expect(summary.classes.commercial).toBeUndefined();
  });

  it('median and trim', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(trimmed([5, 1, 3])).toEqual([1, 3, 5]);
    expect(trimmed(Array.from({ length: 100 }, (_, i) => 100 - i))).toHaveLength(98);
  });
});

describe('appraisal figures in the snapshot', () => {
  it('fills the city the district covers and leaves the rest blank', () => {
    const snapshot = buildMarketSnapshot(METROS, null, null, new Date('2026-10-05T00:00:00Z'), {
      appraisal: {
        generatedAt: '2026-10-05T00:00:00Z',
        cities: [
          {
            city: 'Houston',
            district: 'Harris Central Appraisal District',
            period: '2026 roll',
            classes: {
              commercial: {
                parcels: 10,
                totalValue: 5e9,
                medianValue: 1.2e6,
                valueGrowth: 4.2,
                landPsf: 31.5,
                medianLandPsf: 22,
                landParcels: 9,
                newConstruction: 1e8
              }
            }
          }
        ]
      }
    });
    const houston = snapshot.markets.find((m) => m.city === 'Houston')!;
    expect(houston.values.cadCommercialValue).toBe(1.2e6);
    expect(houston.values.cadCommercialLandPsf).toBe(31.5);
    expect(houston.values.cadCommercialGrowth).toBe(4.2);
    expect(houston.values.cadNewConstruction).toBe(1e8);
    expect(houston.periods.cadCommercialTotal).toBe('2026 roll');
    expect(houston.values.cadIndustrialValue).toBeNull();
    expect(snapshot.markets.find((m) => m.city === 'Dallas')!.values.cadCommercialValue).toBeNull();
  });
});
