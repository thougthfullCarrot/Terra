import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readFirstSheet, columnIndex } from '../src/lib/xlsx.js';
import { parseFredCsv, readRate, RATE_SERIES } from '../src/market/fred.js';
import { METROS } from '../src/market/metros.js';
import { metroZoneCount, parseCountyCounts } from '../src/market/opportunityZones.js';
import { parsePepCounties, parsePepMetros, topGrowingCounties } from '../src/market/pep.js';
import { buildMarketSnapshot, fillFromPrevious, GROUPS, METRICS } from '../src/market/snapshot.js';
import { cityTaxRate, parseTaxRates, type TaxingUnit } from '../src/market/taxRates.js';
import { parseDistrictProjects, phaseBucket } from '../src/market/txdot.js';
import { formatPoints, formatValue } from '../../site/market.js';

const now = new Date('2026-10-05T15:00:00Z');
const tenYear = RATE_SERIES.find((s) => s.id === 'DGS10')!;

describe('FRED', () => {
  it('reads the CSV, skipping missing days', () => {
    const text = 'observation_date,DGS10\n2025-10-02,4.10\n2025-10-03,.\n2026-10-01,4.31\n2026-10-02,\n';
    expect(parseFredCsv(text)).toEqual([
      { date: '2025-10-02', value: 4.1 },
      { date: '2026-10-01', value: 4.31 }
    ]);
  });

  it('gives the latest value and its change from a year earlier, in points', () => {
    const reading = readRate(tenYear, [
      { date: '2025-09-30', value: 4.0 },
      { date: '2025-10-02', value: 4.1 },
      { date: '2026-10-02', value: 4.35 }
    ]);
    expect(reading).toMatchObject({ key: 'DGS10', value: 4.35, change: 0.25, period: 'Oct 2, 2026' });
    expect(reading?.url).toBe('https://fred.stlouisfed.org/series/DGS10');
  });

  it('leaves the change blank without a year of history', () => {
    expect(readRate(tenYear, [{ date: '2026-10-02', value: 4.35 }])?.change).toBeNull();
    expect(readRate(tenYear, [])).toBeNull();
  });

  it('labels quarterly survey readings by quarter', () => {
    const survey = RATE_SERIES.find((s) => s.frequency === 'quarterly')!;
    expect(readRate(survey, [{ date: '2026-07-01', value: -3.7 }])?.period).toBe('Q3 2026');
  });
});

describe('Census population estimates', () => {
  const header =
    'CBSA,MDIV,STCOU,NAME,LSAD,POPESTIMATE2024,POPESTIMATE2025,NPOPCHG2025,NATURALCHG2025,INTERNATIONALMIG2025,DOMESTICMIG2025,NETMIG2025';
  const metroText = [
    header,
    '19100,,,"Dallas-Fort Worth-Arlington, TX",Metropolitan Statistical Area,8300000,8450000,150000,40000,50000,60000,110000',
    '19100,19124,,"Dallas-Plano-Irving, TX",Metropolitan Division,5500000,5600000,100000,30000,35000,35000,70000',
    '19100,19124,48113,"Dallas County, TX",County or equivalent,2600000,2620000,20000,1,2,3,5',
    '19100,23104,,"Fort Worth-Arlington-Grapevine, TX",Metropolitan Division,2800000,2850000,50000,10000,15000,25000,40000',
    '26420,,,"Houston-Pasadena-The Woodlands, TX",Metropolitan Statistical Area,7500000,7700000,200000,50000,90000,60000,150000'
  ].join('\n');

  it('reads metros and metro divisions, not their counties', () => {
    const result = parsePepMetros(metroText, METROS, 2025);
    expect(result.get('19124')).toEqual({
      population: 5600000,
      change: 100000,
      natural: 30000,
      domestic: 35000,
      international: 35000,
      migration: 70000
    });
    expect(result.get('23104')?.population).toBe(2850000);
    expect(result.get('26420')?.migration).toBe(150000);
    expect(result.has('12420')).toBe(false);
  });

  it('reads Texas counties and ranks them by people added', () => {
    const text = [
      'SUMLEV,REGION,DIVISION,STATE,COUNTY,STNAME,CTYNAME,POPESTIMATE2025,NPOPCHG2025,NATURALCHG2025,INTERNATIONALMIG2025,DOMESTICMIG2025,NETMIG2025',
      '040,3,7,48,000,Texas,Texas,31000000,500000,1,1,1,1',
      '050,3,7,48,085,Texas,Collin County,1300000,50000,8000,10000,32000,42000',
      '050,3,7,48,201,Texas,Harris County,5000000,60000,30000,40000,-10000,30000',
      '050,3,7,22,001,Louisiana,Acadia Parish,57000,100,1,1,1,1'
    ].join('\n');
    const counties = parsePepCounties(text, 2025);
    expect(counties.map((c) => c.county)).toEqual(['Collin County', 'Harris County']);
    expect(counties[0]).toMatchObject({ code: '085', change: 50000, migration: 42000 });
    expect(counties[0]!.growth).toBeCloseTo(4, 0);
    expect(topGrowingCounties(counties, 1).map((c) => c.county)).toEqual(['Harris County']);
  });
});

/** A minimal .xlsx: a zip of shared strings and one sheet, deflated as Excel does. */
function workbook(rows: (string | number)[][]): Buffer {
  const strings: string[] = [];
  const cell = (value: string | number, ref: string) => {
    if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
    strings.push(value);
    return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
  };
  const sheet = `<worksheet><sheetData>${rows
    .map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, `${String.fromCharCode(65 + c)}${r + 1}`)).join('')}</row>`)
    .join('')}</sheetData></worksheet>`;
  const shared = `<sst>${strings.map((s) => `<si><t>${s.replace(/&/g, '&amp;')}</t></si>`).join('')}</sst>`;
  const files: [string, string][] = [
    ['xl/sharedStrings.xml', shared],
    ['xl/worksheets/sheet1.xml', sheet]
  ];

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const raw = Buffer.from(text);
    const data = deflateRawSync(raw);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

describe('xlsx reader', () => {
  it('reads shared strings and numbers in column order', () => {
    const rows = readFirstSheet(workbook([['Statewide Tax Rates'], ['Taxing Unit Name', 'Taxing Unit ID', 'Total Tax Rate'], ['A & B', '001-101-03', 0.5]]));
    expect(rows).toEqual([['Statewide Tax Rates'], ['Taxing Unit Name', 'Taxing Unit ID', 'Total Tax Rate'], ['A & B', '001-101-03', '0.5']]);
  });

  it('turns cell references into column numbers', () => {
    expect(columnIndex('A1')).toBe(0);
    expect(columnIndex('AB7')).toBe(27);
  });
});

describe('Texas Comptroller tax rates', () => {
  const rows = [
    ['Statewide Tax Rates', '', ''],
    ['2025 Statewide Report of Tax Rates', '', ''],
    ['Taxing Unit Name', 'Taxing Unit ID', 'Total Tax Rate'],
    ['Dallas', '057-117-03', '0.6988'],
    ['Dallas', '057-000-00', '0.2155'],
    ['Dallas ISD', '057-905-02', '0.993835'],
    ['Dallas College District **', '057-201-15', '0.106575'],
    ['Dallas County Hospital District', '057-201-11', '0.212'],
    ['Houston', '101-124-03', '0.51919'],
    ['Harris', '101-000-00', '0.38096']
  ];

  it('reads every unit under the header row', () => {
    const units = parseTaxRates(rows);
    expect(units).toHaveLength(7);
    expect(units[3]).toEqual({ id: '057-201-15', name: 'Dallas College District', rate: 0.106575 });
  });

  it('adds up the units covering a typical property in the city', () => {
    const rate = cityTaxRate(parseTaxRates(rows), 'Dallas');
    expect(rate?.total).toBeCloseTo(2.22671, 5);
    expect(rate).toMatchObject({ city: 0.6988, county: 0.2155, school: 0.993835, missing: [] });
  });

  it('reads the older layout, with long ids repeated per county', () => {
    const older = [
      ['2024 Statewide Report of Tax Rates'],
      ['County ID', 'County Name', 'Taxing Unit ID', 'Taxing Unit Name', 'Split Indicator', 'Total Tax Rate'],
      ['057', 'Dallas', '057-117-03-057-057', 'Dallas', 'X', '0.7357'],
      ['061', 'Denton', '057-117-03-057-057', 'Dallas', 'X', '0.7357'],
      ['057', 'Dallas', '057-905-02-057-057', 'Dallas ISD   ', '', '1.0']
    ];
    expect(parseTaxRates(older)).toEqual([
      { id: '057-117-03', name: 'Dallas', rate: 0.7357 },
      { id: '057-905-02', name: 'Dallas ISD', rate: 1 }
    ]);
  });

  it('gives no total when the city, county or school district is missing', () => {
    expect(cityTaxRate(parseTaxRates(rows), 'Houston')).toBeNull();
  });

  it('finds a unit listed by name and reports ones the file lacks', () => {
    const units: TaxingUnit[] = [
      { id: '101-124-03', name: 'Houston', rate: 0.5 },
      { id: '101-000-00', name: 'Harris', rate: 0.4 },
      { id: '101-912-02', name: 'Houston ISD', rate: 0.9 },
      { id: '101-999-15', name: 'Houston Community College System', rate: 0.1 }
    ];
    const rate = cityTaxRate(units, 'Houston')!;
    expect(rate.total).toBeCloseTo(1.9, 5);
    expect(rate.missing).toContain('Port of Houston');
    expect(rate.missing).not.toContain('Houston Community College');
  });
});

describe('Opportunity Zones', () => {
  it('counts tracts per county and adds up a metro', () => {
    const counts = parseCountyCounts({
      features: [{ attributes: { COUNTY: '113', n: 18 } }, { attributes: { COUNTY: '085', n: 1 } }, { attributes: { COUNTY: '439', n: 20 } }]
    });
    const dallas = METROS.find((m) => m.city === 'Dallas')!;
    expect(metroZoneCount(dallas, counts)).toBe(19);
  });

  it('raises the service error', () => {
    expect(() => parseCountyCounts({ error: { message: 'Invalid URL' } })).toThrow('Invalid URL');
  });
});

describe('TxDOT', () => {
  it('sorts phases into underway and planned', () => {
    expect(phaseBucket('Construction begins within 4 years')).toBe('planned');
    expect(phaseBucket('Construction Underway or Begins Soon')).toBe('underway');
    expect(phaseBucket('Completed')).toBeNull();
  });

  it('sums cost per district', () => {
    const { districts, phases } = parseDistrictProjects({
      features: [
        { attributes: { DISTRICT_NAME: 'Houston', PT_PHASE: 'Construction begins within 4 years', cost: 1e9, n: 40 } },
        { attributes: { DISTRICT_NAME: 'Houston', PT_PHASE: 'Under construction', cost: 2e9, n: 30 } },
        { attributes: { DISTRICT_NAME: 'Houston', PT_PHASE: 'Long-term planning', cost: 5e9, n: 10 } }
      ]
    });
    expect(districts.get('Houston')).toEqual({ planned: 1e9, plannedCount: 40, underway: 2e9, underwayCount: 30 });
    expect(phases).toContain('Long-term planning');
  });
});

describe('snapshot with the new sources', () => {
  const dallas = METROS.find((m) => m.city === 'Dallas')!;
  const snapshot = buildMarketSnapshot(METROS, null, null, now, {
    rates: [{ key: 'DGS10', label: '10-year Treasury', note: '', value: 4.35, change: 0.25, period: 'Oct 2, 2026', url: 'u' }],
    population: {
      year: 2025,
      metros: new Map([[dallas.area, { population: 5_600_000, change: 100_000, natural: 30_000, domestic: 35_000, international: 35_000, migration: 70_000 }]]),
      counties: [{ county: 'Collin County', code: '085', population: 1_300_000, change: 50_000, natural: 8000, domestic: 32_000, international: 10_000, migration: 42_000, growth: 4 }]
    },
    taxes: {
      year: 2025,
      current: new Map([['Dallas', { total: 2.2, city: 0.7, county: 0.2, school: 1.0, other: 0.3, missing: [] }]]),
      previous: new Map([['Dallas', { total: 2.0, city: 0.7, county: 0.2, school: 0.9, other: 0.2, missing: [] }]])
    },
    zones: new Map([['113', 18]]),
    txdot: new Map([['Dallas', { planned: 3e9, plannedCount: 50, underway: 1e9, underwayCount: 20 }]])
  });
  const row = snapshot.markets.find((m) => m.city === 'Dallas')!;

  it('fills the population, tax, zone and highway figures', () => {
    expect(row.values.pepPopulation).toBe(5_600_000);
    expect(row.values.pepGrowth).toBeCloseTo(1.818, 2);
    expect(row.values.migrationRate).toBeCloseTo(1.25, 2);
    expect(row.periods.pepPopulation).toBe('July 2025');
    expect(row.values.taxRate).toBe(2.2);
    expect(row.values.taxOnMillion).toBe(22_000);
    expect(row.values.taxRateChange).toBeCloseTo(10, 5);
    expect(row.values.ozTracts).toBe(18);
    expect(row.values.txdotPlanned).toBe(3e9);
  });

  it('carries the national rates and the county list, tagging each county with its market', () => {
    expect(snapshot.rates?.[0]?.key).toBe('DGS10');
    expect(snapshot.counties).toEqual({
      year: 2025,
      rows: [{ county: 'Collin County', market: 'Dallas', population: 1_300_000, change: 50_000, growth: 4, migration: 42_000 }]
    });
  });

  it('keeps the last rates and counties when today they did not answer', () => {
    const bare = buildMarketSnapshot(METROS, null, null, now, {});
    const filled = fillFromPrevious(bare, snapshot);
    expect(filled.rates).toEqual(snapshot.rates);
    expect(filled.counties).toEqual(snapshot.counties);
  });

  it('lists every grouped metric', () => {
    const keys = new Set(METRICS.map((m) => m.key));
    for (const group of GROUPS) for (const key of group.metrics) expect(keys.has(key), `${group.key}: ${key}`).toBe(true);
  });
});

describe('formatting', () => {
  it('shows tax rates to two decimals and rate changes in points', () => {
    expect(formatValue(2.22691, 'taxRate')).toBe('2.23%');
    expect(formatPoints(0.25)).toBe('+0.25 pts');
    expect(formatPoints(-0.1)).toBe('−0.10 pts');
    expect(formatPoints(null)).toBe('—');
  });
});
