import { describe, expect, it } from 'vitest';
import { analyzeDeal, DEFAULT_DEAL, monthlyPayment, readDeal, suggestedRate, writeDeal } from '../../site/deal.js';
import { compareRows, readMarketHash, writeMarketHash, type Market, type Metric } from '../../site/market.js';

const markets: Market[] = [
  { city: 'Austin', values: { jobsGrowth: 2.1, taxRate: 1.9, medianRent: 1700 } },
  { city: 'Dallas', values: { jobsGrowth: 1.4, taxRate: 2.2, medianRent: 1500 } },
  { city: 'Houston', values: { jobsGrowth: 2.1, taxRate: 2.4, medianRent: null } },
  { city: 'San Antonio', values: { jobsGrowth: 0.8, taxRate: 2.4, medianRent: null } }
];
const snapshot = { groups: [{ key: 'overview', label: 'Overview', metrics: ['jobsGrowth'] }], metrics: [], markets };

describe('city comparison', () => {
  it('reads the cities from the hash, keeping two to four known ones', () => {
    expect(readMarketHash('#markets&tool=compare&cities=Houston,Nowhere,Dallas,Houston', snapshot)).toMatchObject({
      tool: 'compare',
      compare: ['Houston', 'Dallas']
    });
    // Too few are topped up from the open city, then the list.
    expect(readMarketHash('#markets&tool=compare&city=Houston', snapshot).compare).toEqual(['Houston', 'Austin']);
    expect(readMarketHash('#markets&tool=compare&cities=Austin,Dallas,Houston,San Antonio,Austin', snapshot).compare).toHaveLength(4);
    expect(readMarketHash('#markets&tool=bogus&cities=Austin', snapshot)).toMatchObject({ tool: '', compare: [] });
  });

  it('round-trips the tool through the hash', () => {
    const state = readMarketHash(writeMarketHash({ focus: 'overview', tool: 'compare', compare: ['Dallas', 'San Antonio'] }), snapshot);
    expect(state).toMatchObject({ tool: 'compare', compare: ['Dallas', 'San Antonio'] });
    expect(writeMarketHash({ tool: 'calc', compare: ['Dallas'] })).toBe('#markets&tool=calc');
  });

  it('marks the best city per row, ties included, and none without a better end', () => {
    const metrics: Pick<Metric, 'key' | 'better'>[] = [
      { key: 'jobsGrowth', better: 'high' },
      { key: 'taxRate', better: 'low' },
      { key: 'medianRent', better: null }
    ];
    const rows = compareRows(markets, metrics, ['Houston', 'Austin', 'San Antonio']);
    expect(rows[0]).toMatchObject({ values: [2.1, 2.1, 0.8], best: ['Houston', 'Austin'] });
    expect(rows[1]).toMatchObject({ values: [2.4, 1.9, 2.4], best: ['Austin'] });
    expect(rows[2]).toMatchObject({ values: [null, 1700, null], best: [] });
    // All equal is no winner.
    expect(compareRows(markets, [{ key: 'taxRate', better: 'low' }], ['Houston', 'San Antonio'])[0]?.best).toEqual([]);
  });
});

describe('deal calculator', () => {
  it('computes a standard amortizing payment', () => {
    // $300,000 at 6% over 30 years is $1,798.65 a month.
    expect(monthlyPayment(300_000, 6, 30)).toBeCloseTo(1798.65, 2);
    expect(monthlyPayment(120_000, 0, 10)).toBe(1000);
    expect(monthlyPayment(0, 6, 30)).toBe(0);
  });

  it('works a deal through NOI, leverage and returns', () => {
    const r = analyzeDeal({ price: 1_000_000, income: 120_000, vacancy: 5, expenses: 24_000, down: 25, closing: 2, rate: 6, years: 25 }, 2);
    expect(r.effectiveIncome).toBe(114_000);
    expect(r.propertyTax).toBe(20_000);
    expect(r.noi).toBe(70_000);
    expect(r.capRate).toBeCloseTo(7, 9);
    expect(r.loan).toBe(750_000);
    expect(r.payment).toBeCloseTo(4832.26, 1);
    expect(r.cashInvested).toBe(270_000);
    expect(r.cashFlow).toBeCloseTo(70_000 - r.payment * 12, 6);
    expect(r.cashOnCash).toBeCloseTo((r.cashFlow / 270_000) * 100, 6);
    expect(r.dscr).toBeCloseTo(70_000 / (r.payment * 12), 6);
    expect(r.breakEven).toBeCloseTo(((44_000 + r.payment * 12) / 120_000) * 100, 6);
  });

  it('handles an all-cash deal and an empty one without dividing by zero', () => {
    const cash = analyzeDeal({ price: 500_000, income: 50_000, vacancy: 0, expenses: 10_000, down: 100, closing: 0, rate: 7, years: 30 });
    expect(cash).toMatchObject({ loan: 0, debtService: 0, dscr: null, noi: 40_000, cashOnCash: 8 });
    expect(analyzeDeal({})).toMatchObject({ capRate: null, cashOnCash: null, dscr: null, breakEven: null });
  });

  it('starts the rate at the 10-year Treasury plus the spread', () => {
    expect(suggestedRate([{ key: 'DGS10', value: 4.12 }])).toBe(6.1);
    expect(suggestedRate([{ key: 'DGS10', value: 4.13 }], 1.5)).toBe(5.65);
    expect(suggestedRate([{ key: 'SOFR', value: 4 }])).toBeNull();
    expect(suggestedRate(null)).toBeNull();
  });

  it('round-trips the inputs through the hash and ignores junk', () => {
    const deal = { ...DEFAULT_DEAL, price: 2_000_000, rate: 6.25, city: 'Dallas' };
    expect(readDeal(`#markets&tool=calc&${writeDeal(deal)}`, DEFAULT_DEAL, ['Dallas'])).toEqual(deal);
    expect(readDeal('#markets&price=abc&down=150&taxcity=Nowhere', DEFAULT_DEAL, ['Dallas'])).toEqual({ ...DEFAULT_DEAL, down: 100 });
  });
});
