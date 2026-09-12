import { describe, expect, it } from 'vitest';
import { slugCandidates } from '../src/collector/slugCandidates.js';

describe('slugCandidates', () => {
  it('leads with the whole name run together', () => {
    expect(slugCandidates('Stream Realty Partners')[0]).toBe('streamrealtypartners');
  });

  it('offers the name without its corporate suffixes', () => {
    const candidates = slugCandidates('Crow Holdings');
    expect(candidates).toContain('crowholdings');
    expect(candidates).toContain('crow');
  });

  it('strips several trailing filler words at once', () => {
    expect(slugCandidates('Virtus Real Estate Capital')).toContain('virtus');
  });

  it('never strips a name down to nothing', () => {
    // Every word here is on the suffix list; the first must survive.
    const candidates = slugCandidates('Real Estate Partners');
    expect(candidates.every((slug) => slug.length > 1)).toBe(true);
    expect(candidates).toContain('realestatepartners');
  });

  it('handles an ampersand both ways', () => {
    const candidates = slugCandidates('Cushman & Wakefield');
    expect(candidates).toContain('cushmanwakefield');
    expect(candidates).toContain('cushmanandwakefield');
  });

  it('offers an acronym for multi-word names', () => {
    expect(slugCandidates('Trammell Crow Company')).toContain('tcc');
  });

  it('returns a single candidate for a name that is already a slug', () => {
    expect(slugCandidates('CBRE')).toEqual(['cbre']);
  });

  it('includes a hyphenated form', () => {
    expect(slugCandidates('Lincoln Property Company')).toContain('lincoln-property-company');
  });

  it('drops punctuation rather than encoding it', () => {
    const candidates = slugCandidates("O'Connor & Associates, Inc.");
    expect(candidates.every((slug) => /^[a-z0-9-]+$/.test(slug))).toBe(true);
  });

  it('never repeats a candidate', () => {
    const candidates = slugCandidates('Greystar');
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it('respects the limit, so a run stays polite', () => {
    expect(slugCandidates('Some Very Long Real Estate Company Name', 3)).toHaveLength(3);
  });

  it('returns nothing for an empty name', () => {
    expect(slugCandidates('')).toEqual([]);
  });
});
