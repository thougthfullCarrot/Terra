import { describe, expect, it } from 'vitest';
import { namesMatch } from '../src/collector/nameMatch.js';

/**
 * A board answering 200 at a slug proves the board exists, not that it belongs
 * to the firm we wanted. These cases are the ones that decide whether another
 * industry's jobs end up in a Texas CRE feed.
 */
describe('namesMatch', () => {
  it('matches a name to itself', () => {
    expect(namesMatch('Greystar', 'Greystar')).toBe(true);
  });

  it('ignores corporate filler words', () => {
    expect(namesMatch('Lincoln Property Company', 'Lincoln Property')).toBe(true);
    expect(namesMatch('Camden Property Trust', 'Camden Properties')).toBe(true);
  });

  it('refuses a single-word overlap on a generic name', () => {
    // The case that motivated this: 'Lincoln Property Company' reduces to
    // 'lincoln', which several unrelated companies also reduce to.
    expect(namesMatch('Lincoln Property Company', 'Lincoln Financial Group')).toBe(false);
    expect(namesMatch('Lincoln Property Company', 'Lincoln Electric')).toBe(false);
  });

  it('refuses an unrelated company sharing one distinctive word', () => {
    expect(namesMatch('Integra Realty Resources', 'Integra LifeSciences')).toBe(false);
    expect(namesMatch('Highland Capital Real Estate', 'Highland Electric Fleets')).toBe(false);
  });

  it('accepts a longer name fully contained in the board name', () => {
    expect(namesMatch('Stream Realty Partners', 'Stream Realty Partners LP')).toBe(true);
    expect(namesMatch('Crow Holdings', 'Crow Holdings Capital')).toBe(true);
  });

  it('is order independent', () => {
    expect(namesMatch('Trammell Crow Company', 'Crow Trammell')).toBe(true);
  });

  it('rejects genuinely different firms', () => {
    expect(namesMatch('Hillwood', 'Greystar')).toBe(false);
    expect(namesMatch('CBRE', 'JLL')).toBe(false);
  });

  it('rejects a name made only of filler', () => {
    expect(namesMatch('Real Estate Partners', 'Property Group')).toBe(false);
  });

  it('rejects an empty side rather than matching everything', () => {
    expect(namesMatch('', 'Greystar')).toBe(false);
    expect(namesMatch('Greystar', '')).toBe(false);
  });
});
