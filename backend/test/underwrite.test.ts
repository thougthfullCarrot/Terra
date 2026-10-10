import { describe, expect, it } from 'vitest';
import { DEFAULT_UW, irr, loanBalance, readUw, sensitivity, underwrite, writeUw } from '../../site/underwrite.js';
import { underwriteXlsx, xlsxName } from '../../site/underwrite-xlsx.js';

describe('irr', () => {
  it('finds the rate that zeroes NPV', () => {
    expect(irr([-100, 110])).toBeCloseTo(10, 6);
    expect(irr([-1000, 100, 100, 1100])).toBeCloseTo(10, 6);
  });
  it('is null when the flows never change sign', () => {
    expect(irr([100, 100])).toBeNull();
    expect(irr([-100, -5])).toBeNull();
  });
});

describe('loanBalance', () => {
  it('runs from the principal to zero', () => {
    expect(loanBalance(100000, 6, 25, 0)).toBeCloseTo(100000, 4);
    expect(loanBalance(100000, 6, 25, 25)).toBeCloseTo(0, 4);
    expect(loanBalance(120000, 0, 10, 5)).toBeCloseTo(60000, 4);
  });
});

describe('underwrite', () => {
  const m = underwrite(DEFAULT_UW, 2.2);

  it('prices the sale on the year after the hold', () => {
    expect(m.years).toHaveLength(11);
    expect(m.salePrice).toBeCloseTo((m.years[10]!.noi / 7) * 100, 6);
  });

  it('adds the sale to the last year of each cash flow stream', () => {
    expect(m.levered[0]).toBeCloseTo(-(1500000 * 0.32), 6);
    expect(m.levered[10]).toBeCloseTo(m.years[9]!.cashFlow + m.saleProceeds, 6);
    expect(m.unlevered[10]).toBeCloseTo(m.years[9]!.noi + m.salePrice - m.sellingCosts, 6);
  });

  it('gives sensible returns for the default deal', () => {
    expect(m.goingInCap).toBeCloseTo(6.2, 6);
    expect(m.leveredIrr).toBeCloseTo(9.956, 2);
    expect(m.unleveredIrr).toBeCloseTo(7.841, 2);
  });

  it('raises the IRR with rent growth and lowers it with the exit cap', () => {
    const grid = sensitivity(DEFAULT_UW, 2.2).grid as number[][];
    expect(grid[2]![2]).toBeCloseTo(m.leveredIrr ?? 0, 9);
    expect(grid[4]![2]).toBeGreaterThan(grid[0]![2]!);
    expect(grid[2]![0]).toBeGreaterThan(grid[2]![4]!);
  });
});

describe('the hash', () => {
  it('round-trips the inputs', () => {
    const uw = { ...DEFAULT_UW, hold: 7, exitcap: 6.25, city: 'Austin' };
    expect(readUw(`#markets&tool=uw&${writeUw(uw)}`, DEFAULT_UW, ['Austin'])).toEqual(uw);
  });
  it('clamps the hold to 15 years', () => {
    expect(readUw('#hold=40').hold).toBe(15);
  });
});

describe('underwriteXlsx', () => {
  const bytes = underwriteXlsx(DEFAULT_UW, 2.2, 'Dallas', new Date('2026-10-10T00:00:00Z'));
  const text = new TextDecoder().decode(bytes);

  it('is a zip with the three sheets', () => {
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(text).toContain('name="Assumptions"');
    expect(text).toContain('name="Cash Flow"');
    expect(text).toContain('name="Sensitivity"');
  });

  it('keeps live formulas and recalculates on open', () => {
    expect(text).toContain('fullCalcOnLoad="1"');
    expect(text).toContain('<f>IRR(B21:L21)</f>');
    expect(text).toContain('PMT(');
  });

  it('names the file after the city and date', () => {
    expect(xlsxName('San Antonio', new Date('2026-10-10T00:00:00Z'))).toBe('terra-underwriting-san-antonio-2026-10-10.xlsx');
  });
});
