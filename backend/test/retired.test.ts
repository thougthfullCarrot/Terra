import { describe, expect, it } from 'vitest';
import { retiredRoute } from '../../site/retired.js';
import { readNewsHash, writeNewsHash } from '../../site/news.js';
import { readMarketHash } from '../../site/market.js';

describe('old links to retired tools', () => {
  it('sends Deal of the week to News, keeping the market', () => {
    expect(retiredRoute('#property&tool=deal&city=San%20Antonio')?.hash).toBe('#news&view=deal&city=San%20Antonio');
    expect(retiredRoute('#property&tool=deal')?.hash).toBe('#news&view=deal');
  });
  it('sends the other Property tools to the Development Map', () => {
    expect(retiredRoute('#property')).toEqual({ hash: '#markets&tool=map', note: "Who owns this has been retired. Here's the Development Map instead." });
    expect(retiredRoute('#property&tool=drive&city=Houston&lat=1&lng=2')?.hash).toBe('#markets&tool=map&city=Houston');
  });
  it('sends Career links to Jobs and retired market tools to the city data', () => {
    expect(retiredRoute('#career&tool=brief&firm=CBRE')?.hash).toBe('#');
    expect(retiredRoute('#markets&tool=calc&price=1')?.hash).toBe('#markets');
    expect(retiredRoute('#markets&tool=pay&city=Dallas')?.hash).toBe('#markets&city=Dallas');
  });
  it('leaves live links alone', () => {
    for (const hash of ['', '#news', '#news&view=deal', '#events', '#markets', '#markets&tool=map', '#markets&tool=zoning', '#tracker']) expect(retiredRoute(hash)).toBeNull();
  });
  it('retired market tools no longer open', () => {
    for (const tool of ['compare', 'calc', 'uw', 'sites', 'pay']) expect(readMarketHash(`#markets&tool=${tool}`, null).tool).toBe('');
    expect(readMarketHash('#markets&tool=map', null).tool).toBe('map');
  });
});

describe('the News hash', () => {
  it('reads and writes the deal section with its market', () => {
    const state = readNewsHash('#news&view=deal&city=Austin', null);
    expect(state).toMatchObject({ open: true, view: 'deal', dealCity: 'Austin' });
    expect(writeNewsHash(state)).toBe('#news&view=deal&city=Austin');
    expect(writeNewsHash({ city: '', topic: '' })).toBe('#news');
  });
});
