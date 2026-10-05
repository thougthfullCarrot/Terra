import { describe, expect, it, vi } from 'vitest';
import { cesSeries, combine, fetchBls, parseBls, unemploymentSeries, yearOverYear, type Point } from '../src/market/bls.js';
import { acsUrls, fetchAcs, fetchAcsYear, parseAcs, rentalVacancy, renterShare } from '../src/market/census.js';
import { METROS } from '../src/market/metros.js';
import { blsSeriesFor, buildMarketSnapshot, fillFromPrevious, filledCount, GROUPS, METRICS } from '../src/market/snapshot.js';
import {
  barPercent,
  formatValue,
  ordinal,
  pruneSnapshot,
  ranks,
  readMarketHash,
  sortMarkets,
  writeMarketHash
} from '../../site/market.js';

const now = new Date('2026-10-04T15:00:00Z');
const houston = METROS.find((m) => m.city === 'Houston')!;
const dallas = METROS.find((m) => m.city === 'Dallas')!;

function points(start: [number, number], values: number[]): Point[] {
  return values.map((value, i) => {
    const index = start[0] * 12 + (start[1] - 1) + i;
    return { year: Math.floor(index / 12), month: (index % 12) + 1, value };
  });
}

describe('BLS series ids', () => {
  it('builds CES and LAUS ids from the metro codes', () => {
    expect(cesSeries(houston, 'total')).toBe('SMU48264200000000001');
    expect(cesSeries(dallas, 'retail')).toBe('SMU48191244200000001');
    expect(unemploymentSeries(houston)).toBe('LAUMT482642000000003');
    expect(unemploymentSeries(dallas)).toBe('LAUDV481912400000003');
  });

  it('asks for ten series per metro, once for a shared metro', () => {
    expect(blsSeriesFor(METROS)).toHaveLength(90);
    expect(new Set(blsSeriesFor(METROS)).size).toBe(90);
  });
});

describe('parseBls', () => {
  it('keeps monthly values oldest first and drops annual averages and blanks', () => {
    const parsed = parseBls({
      status: 'REQUEST_SUCCEEDED',
      Results: {
        series: [
          {
            seriesID: 'A',
            data: [
              { year: '2026', period: 'M08', value: '3,500.1'.replace(',', '') },
              { year: '2025', period: 'M13', value: '3400' },
              { year: '2026', period: 'M07', value: '-' },
              { year: '2025', period: 'M08', value: '3400.0' }
            ]
          },
          { seriesID: 'B', data: [] }
        ]
      }
    });
    expect(parsed.get('A')).toEqual([
      { year: 2025, month: 8, value: 3400 },
      { year: 2026, month: 8, value: 3500.1 }
    ]);
    expect(parsed.has('B')).toBe(false);
  });
});

describe('fetchBls', () => {
  const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it('splits into requests of 25 series without a key, and sends the key when there is one', async () => {
    const fetchImpl = vi.fn(async () => reply({ status: 'REQUEST_SUCCEEDED', Results: { series: [] } }));
    const ids = Array.from({ length: 60 }, (_, i) => `S${i}`);
    await fetchBls(ids, { fetchImpl: fetchImpl as typeof fetch, now });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const first = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(first).toMatchObject({ startyear: '2024', endyear: '2026' });
    expect(first.seriesid).toHaveLength(25);

    fetchImpl.mockClear();
    await fetchBls(ids, { fetchImpl: fetchImpl as typeof fetch, now, apiKey: 'k' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/v2/');
    expect(JSON.parse(init.body as string).registrationkey).toBe('k');
  });

  it('throws when the API refuses the request outright', async () => {
    const fetchImpl = vi.fn(async () => reply({ status: 'REQUEST_NOT_PROCESSED', message: ['daily threshold reached'] }));
    await expect(fetchBls(['A'], { fetchImpl: fetchImpl as typeof fetch, now })).rejects.toThrow('daily threshold');
  });
});

describe('combine and yearOverYear', () => {
  it('adds and subtracts series over the months they share', () => {
    const a = points([2025, 1], [10, 11, 12]);
    const b = points([2025, 2], [5, 5]);
    expect(combine([{ points: a, weight: 1 }, { points: b, weight: -1 }])).toEqual([
      { year: 2025, month: 2, value: 6 },
      { year: 2025, month: 3, value: 7 }
    ]);
    expect(combine([{ points: a, weight: 1 }, { points: undefined, weight: 1 }])).toBeUndefined();
  });

  it('compares the latest month with the same month a year earlier', () => {
    const series = points([2025, 8], [100, ...Array(11).fill(101), 103]);
    expect(yearOverYear(series)).toBeCloseTo(3);
    expect(yearOverYear(points([2026, 1], [1, 2]))).toBeNull();
  });
});

const ACS_HEADER = [
  'NAME',
  'B01003_001E',
  'B19013_001E',
  'B25064_001E',
  'B25077_001E',
  'B25003_001E',
  'B25003_003E',
  'B25004_002E',
  'B25004_003E'
];

describe('Census ACS', () => {
  it('asks for whole metros in one call and the Dallas and Fort Worth divisions under their parent', () => {
    const urls = acsUrls(2025, METROS);
    expect(urls).toHaveLength(2);
    expect(decodeURIComponent(urls[0]!)).toContain('for=metropolitan statistical area/micropolitan statistical area:26420,12420,41700,21340');
    expect(decodeURIComponent(urls[1]!)).toContain(
      'for=metropolitan division:19124,23104&in=metropolitan statistical area/micropolitan statistical area:19100'
    );
  });

  it('leaves the geography clause unencoded but for spaces, which is all the API accepts', () => {
    const [url] = acsUrls(2025, METROS);
    expect(url).toContain('&for=metropolitan%20statistical%20area/micropolitan%20statistical%20area:26420,12420,41700,21340');
  });

  it('turns an error page into a readable failure', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html><body><p>error: unknown/unsupported geography hierarchy</p></body></html>'));
    await expect(fetchAcsYear(2025, METROS, { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(
      'ACS 2025: error: unknown/unsupported geography hierarchy'
    );
  });

  it('reads rows by geography and treats negative codes as missing', () => {
    const rows = parseAcs([
      [...ACS_HEADER, 'metropolitan statistical area/micropolitan statistical area'],
      ['Houston', '7500000', '80000', '1400', '-666666666', '2700000', '1100000', '90000', '10000', '26420']
    ]);
    const row = rows.get('26420')!;
    expect(row).toMatchObject({ population: 7_500_000, medianRent: 1400, medianHomeValue: null });
    expect(rentalVacancy(row)).toBeCloseTo(7.5);
    expect(renterShare(row)).toBeCloseTo(40.74, 1);
  });

  it('uses the newest release that answers, and the year before it', async () => {
    const asked: number[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      const year = Number(/data\/(\d{4})\//.exec(url)![1]);
      asked.push(year);
      if (year === 2025) return new Response('', { status: 204 });
      const geo = url.includes('division') ? 'metropolitan division' : 'metropolitan statistical area/micropolitan statistical area';
      return new Response(JSON.stringify([[...ACS_HEADER, geo], ['x', '1', '1', '1', '1', '1', '1', '1', '1', '26420']]), {
        status: 200
      });
    });
    const result = await fetchAcs(METROS, { fetchImpl: fetchImpl as unknown as typeof fetch, now, retries: 0 });
    expect(result.year).toBe(2024);
    expect(asked).toEqual([2025, 2024, 2024, 2023, 2023]);
  });
});

describe('buildMarketSnapshot', () => {
  const series = new Map<string, Point[]>();
  const yearOf = (base: number, growth: number) => points([2025, 8], [base, ...Array(11).fill(base), base * (1 + growth)]);
  series.set(cesSeries(houston, 'total'), yearOf(3500, 0.02));
  series.set(cesSeries(houston, 'financial'), yearOf(200, 0.01));
  series.set(cesSeries(houston, 'professional'), yearOf(500, 0.01));
  series.set(cesSeries(houston, 'information'), yearOf(30, 0.01));
  series.set(cesSeries(houston, 'manufacturing'), yearOf(220, 0));
  series.set(cesSeries(houston, 'tradeTransportUtilities'), yearOf(650, 0));
  series.set(cesSeries(houston, 'retail'), yearOf(330, -0.01));
  series.set(cesSeries(houston, 'miningConstruction'), yearOf(260, 0.03));
  series.set(unemploymentSeries(houston), points([2026, 8], [4.6]));

  const row = {
    population: 7_600_000,
    medianIncome: 80_000,
    medianRent: 1400,
    medianHomeValue: 300_000,
    occupied: 2_700_000,
    renterOccupied: 1_100_000,
    forRent: 90_000,
    rentedNotOccupied: 10_000,
    burdenTotal: 1_000_000,
    burden30to35: 100_000,
    burden35to40: 80_000,
    burden40to50: 90_000,
    burden50plus: 230_000,
    burdenNotComputed: 0
  };
  const acs = {
    year: 2025,
    current: new Map([['26420', row]]),
    previous: new Map([['26420', { ...row, population: 7_400_000, medianRent: 1350 }]])
  };

  const snapshot = buildMarketSnapshot(METROS, series, acs, now);
  const h = snapshot.markets.find((m) => m.city === 'Houston')!;

  it('turns BLS thousands into jobs and growth, with the month they are for', () => {
    expect(h.values.jobs).toBe(3_570_000);
    expect(h.values.jobsGrowth).toBeCloseTo(2);
    expect(h.periods.jobs).toBe('Aug 2026');
    expect(h.values.officeJobs).toBe(Math.round(730 * 1.01 * 1000));
    // Manufacturing plus trade, transportation and utilities, less retail.
    expect(h.values.industrialJobs).toBe(Math.round((220 + 650 - 330 * 0.99) * 1000));
    expect(h.values.retailJobsGrowth).toBeCloseTo(-1);
    // Construction falls back to mining, logging and construction.
    expect(h.values.constructionJobsGrowth).toBeCloseTo(3);
    expect(h.values.unemployment).toBe(4.6);
  });

  it('reads Census levels for the year and growth against the year before', () => {
    expect(h.values.population).toBe(7_600_000);
    expect(h.values.populationGrowth).toBeCloseTo((200_000 / 7_400_000) * 100);
    expect(h.values.rentGrowth).toBeCloseTo((50 / 1350) * 100);
    expect(h.values.rentalVacancy).toBeCloseTo(7.5);
    expect(h.periods.population).toBe('2025');
    expect(h.periods.rentGrowth).toBe('2024–25');
  });

  it('gives New Braunfels San Antonio metro figures, labeled, and dedupes the shared requests', () => {
    const sa = METROS.find((m) => m.city === 'San Antonio')!;
    const s = new Map(series);
    s.set(unemploymentSeries(sa), points([2026, 8], [4.1]));
    const both = buildMarketSnapshot(METROS, s, { year: 2025, current: new Map([['41700', row]]), previous: new Map() }, now);
    const nb = both.markets.find((m) => m.city === 'New Braunfels')!;
    const satx = both.markets.find((m) => m.city === 'San Antonio')!;
    expect(nb.values.unemployment).toBe(4.1);
    expect(nb.values.population).toBe(satx.values.population);
    expect(nb.periods.population).toBe('2025, San Antonio metro');
    expect(satx.periods.population).toBe('2025');
    const ids = blsSeriesFor(METROS);
    expect(new Set(ids).size).toBe(ids.length);
    expect(acsUrls(2025, METROS)[0]!.match(/41700/g)).toHaveLength(1);
  });

  it('lists every metric for every city, blank where a source had nothing', () => {
    expect(snapshot.markets.map((m) => m.city)).toEqual(['Dallas', 'Fort Worth', 'Houston', 'Austin', 'San Antonio', 'El Paso', 'New Braunfels', 'College Station', 'Galveston', 'Lubbock', 'Midland']);
    for (const market of snapshot.markets) expect(Object.keys(market.values).sort()).toEqual(METRICS.map((m) => m.key).sort());
    expect(snapshot.markets.find((m) => m.city === 'Austin')!.values.jobs).toBeNull();
  });

  it('only groups metrics it defines', () => {
    const keys = new Set(METRICS.map((m) => m.key));
    for (const group of GROUPS) for (const key of group.metrics) expect(keys.has(key)).toBe(true);
  });

  it('fills a figure a source missed from the last copy, keeping that copy’s date', () => {
    const empty = buildMarketSnapshot(METROS, null, null, now);
    expect(filledCount(empty)).toBe(0);
    const filled = fillFromPrevious(empty, snapshot);
    const fh = filled.markets.find((m) => m.city === 'Houston')!;
    expect(fh.values.jobs).toBe(3_570_000);
    expect(fh.periods.jobs).toBe('Aug 2026');
    expect(fillFromPrevious(empty, null)).toBe(empty);
  });
});

describe('market.js (site)', () => {
  const markets = [
    { city: 'Houston', values: { growth: 2.1, vacancy: 7.5 } },
    { city: 'Austin', values: { growth: 3.4, vacancy: 9.1 } },
    { city: 'El Paso', values: { growth: null, vacancy: 6.2 } },
    { city: 'Dallas', values: { growth: 2.1, vacancy: null } }
  ];

  it('sorts either way with blanks last, and by name', () => {
    expect(sortMarkets(markets, 'growth', 'desc').map((m) => m.city)).toEqual(['Austin', 'Dallas', 'Houston', 'El Paso']);
    expect(sortMarkets(markets, 'growth', 'asc').map((m) => m.city)).toEqual(['Dallas', 'Houston', 'Austin', 'El Paso']);
    expect(sortMarkets(markets, 'city', 'asc').map((m) => m.city)).toEqual(['Austin', 'Dallas', 'El Paso', 'Houston']);
  });

  it('ranks the better end first, ties share a place', () => {
    expect([...ranks(markets, { key: 'growth', better: 'high' })]).toEqual([
      ['Austin', 1],
      ['Dallas', 2],
      ['Houston', 2]
    ]);
    expect(ranks(markets, { key: 'vacancy', better: 'low' }).get('El Paso')).toBe(1);
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(11)).toBe('11th');
  });

  it('formats each unit', () => {
    expect(formatValue(7_581_000, 'count')).toBe('7.58M');
    expect(formatValue(3_570_000, 'count')).toBe('3.57M');
    expect(formatValue(1_200_000, 'count')).toBe('1.2M');
    expect(formatValue(456_300, 'count')).toBe('456K');
    expect(formatValue(1_500, 'count')).toBe('1.5K');
    expect(formatValue(1412.4, 'usd')).toBe('$1,412');
    expect(formatValue(45_120_000_000, 'usd')).toBe('$45.1B');
    expect(formatValue(12_340_000, 'usd')).toBe('$12.3M');
    expect(formatValue(4.5, 'usd')).toBe('$4.50');
    expect(formatValue(2.345, 'change')).toBe('+2.3%');
    expect(formatValue(-0.96, 'change')).toBe('−1.0%');
    expect(formatValue(0.01, 'change')).toBe('0.0%');
    expect(formatValue(4.56, 'rate')).toBe('4.6%');
    expect(formatValue(null, 'rate')).toBe('—');
  });

  it('sizes bars from zero for levels and from the lowest value for changes', () => {
    expect(barPercent(50, [50, 100], 'count')).toBe(50);
    expect(barPercent(1, [1, 3], 'change')).toBe(4);
    expect(barPercent(3, [1, 3, null], 'change')).toBe(100);
    expect(barPercent(null, [1], 'count')).toBe(0);
  });

  it('round-trips the view through the hash and drops what the data does not have', () => {
    const snapshot = { groups: GROUPS, metrics: METRICS, markets: [{ city: 'Houston', values: {} }] };
    const state = readMarketHash(writeMarketHash({ city: 'Houston', focus: 'multifamily', sort: 'rentalVacancy', order: 'asc' }), snapshot);
    expect(state).toEqual({ open: true, city: 'Houston', focus: 'multifamily', sort: 'rentalVacancy', order: 'asc', tool: '', compare: [] });

    // Vacancy defaults to lowest first; a city or sort the data lacks falls back.
    expect(readMarketHash('#markets&focus=multifamily', snapshot)).toMatchObject({ sort: 'aptVacancy', order: 'asc', city: '' });
    expect(readMarketHash('#markets&city=Nowhere&focus=office&sort=rentalVacancy', snapshot)).toMatchObject({
      city: '',
      sort: 'officeJobsGrowth',
      order: 'desc'
    });
    expect(readMarketHash('', snapshot).open).toBe(false);
  });

  it('hides metrics nobody has and groups left empty', () => {
    const pruned = pruneSnapshot({
      metrics: [
        { key: 'a', label: 'A', unit: 'count', better: 'high' },
        { key: 'b', label: 'B', unit: 'count', better: 'high' }
      ],
      groups: [
        { key: 'one', label: 'One', metrics: ['a', 'b'] },
        { key: 'two', label: 'Two', metrics: ['b'] }
      ],
      markets: [{ city: 'Houston', values: { a: 1, b: null } }]
    });
    expect(pruned.metrics.map((m) => m.key)).toEqual(['a']);
    expect(pruned.groups).toEqual([{ key: 'one', label: 'One', metrics: ['a'] }]);
  });
});
