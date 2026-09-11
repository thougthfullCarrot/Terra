import { describe, expect, it } from 'vitest';
import { classifyKind } from '../src/collector/seniority.js';

describe('classifyKind', () => {
  it('recognizes internships', () => {
    expect(classifyKind('Investment Analyst Intern')).toBe('Internship');
    expect(classifyKind('2027 Summer Analyst Program')).toBe('Internship');
    expect(classifyKind('Real Estate Co-op')).toBe('Internship');
  });

  it('recognizes entry-level titles from the spec list', () => {
    expect(classifyKind('Analyst I')).toBe('Entry-level');
    expect(classifyKind('Brokerage Analyst')).toBe('Entry-level');
    expect(classifyKind('Property Management Associate')).toBe('Entry-level');
    expect(classifyKind('Leasing Coordinator')).toBe('Entry-level');
    expect(classifyKind('Appraiser Trainee')).toBe('Entry-level');
  });

  it('rejects senior and mid-level titles', () => {
    expect(classifyKind('Senior Analyst')).toBeNull();
    expect(classifyKind('Sr. Associate, Capital Markets')).toBeNull();
    expect(classifyKind('Director of Asset Management')).toBeNull();
    expect(classifyKind('VP, Development')).toBeNull();
    expect(classifyKind('Property Manager')).toBeNull();
  });

  it('distinguishes Analyst I from Analyst II and III', () => {
    expect(classifyKind('Valuation Analyst I')).toBe('Entry-level');
    expect(classifyKind('Valuation Analyst II')).toBeNull();
    expect(classifyKind('Valuation Analyst III')).toBeNull();
  });

  it('trusts an explicit level field over the title', () => {
    // Board says mid-senior, title looks entry — believe the board.
    expect(classifyKind('Investment Analyst', 'Mid-Senior level')).toBeNull();
    // Board says intern, title forgot to say so.
    expect(classifyKind('Real Estate Analyst', 'Internship')).toBe('Internship');
    expect(classifyKind('Analyst', 'Entry level')).toBe('Entry-level');
  });

  it('reads Lever commitment values', () => {
    expect(classifyKind('Development Analyst', 'Intern')).toBe('Internship');
  });

  it('returns null for titles outside the funnel', () => {
    expect(classifyKind('Chief Investment Officer')).toBeNull();
    expect(classifyKind('Janitorial Services')).toBeNull();
  });
});
