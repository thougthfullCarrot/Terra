import { describe, expect, it } from 'vitest';
import { resolveCity } from '../src/collector/texas.js';

describe('resolveCity', () => {
  it('resolves the six tracked cities', () => {
    expect(resolveCity('Dallas, TX')).toBe('Dallas');
    expect(resolveCity('Fort Worth, TX')).toBe('Fort Worth');
    expect(resolveCity('Houston, Texas')).toBe('Houston');
    expect(resolveCity('Austin, TX')).toBe('Austin');
    expect(resolveCity('San Antonio, TX')).toBe('San Antonio');
    expect(resolveCity('El Paso, TX')).toBe('El Paso');
  });

  it('rolls suburbs up to their metro', () => {
    expect(resolveCity('Plano, TX')).toBe('Dallas');
    expect(resolveCity('Frisco, TX')).toBe('Dallas');
    expect(resolveCity('The Woodlands, TX')).toBe('Houston');
    expect(resolveCity('Round Rock, TX')).toBe('Austin');
    // Tarrant county belongs to Fort Worth, not Dallas.
    expect(resolveCity('Arlington, TX')).toBe('Fort Worth');
    expect(resolveCity('Southlake, TX')).toBe('Fort Worth');
  });

  it('handles metro aliases and abbreviations', () => {
    expect(resolveCity('DFW')).toBe('Dallas');
    expect(resolveCity('Dallas-Fort Worth, TX')).toBe('Dallas');
    expect(resolveCity('Ft. Worth, TX')).toBe('Fort Worth');
  });

  it('rejects same-named cities in other states', () => {
    expect(resolveCity('Austin, MN')).toBeNull();
    expect(resolveCity('Houston, MO')).toBeNull();
    expect(resolveCity('Paris, France')).toBeNull();
  });

  it('rejects postings with no Texas presence', () => {
    expect(resolveCity('New York, NY')).toBeNull();
    expect(resolveCity('Remote')).toBeNull();
    expect(resolveCity('')).toBeNull();
  });

  it('picks the Texas office out of a multi-location string', () => {
    expect(resolveCity('New York, NY; Dallas, TX')).toBe('Dallas');
    expect(resolveCity('Chicago, IL | Houston, TX')).toBe('Houston');
  });

  it('accepts a remote posting anchored to a Texas city', () => {
    expect(resolveCity('Remote - Austin, TX')).toBe('Austin');
  });

  it('accepts a bare Texas city name with no state given', () => {
    expect(resolveCity('Austin')).toBe('Austin');
  });
});
