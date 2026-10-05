import { describe, expect, it } from 'vitest';
import { SCHOOLS, eduDomain, schoolFor } from '../../site/school.js';

describe('eduDomain', () => {
  it('folds subdomains to the parent .edu domain, in any case', () => {
    expect(eduDomain('jane@utexas.edu')).toBe('utexas.edu');
    expect(eduDomain('jane@my.utexas.edu')).toBe('utexas.edu');
    expect(eduDomain('Joe@Mail.TAMU.edu')).toBe('tamu.edu');
  });
  it('returns null for non-.edu or malformed emails', () => {
    for (const e of ['a@gmail.com', 'a@edu', 'a@utexas.edu.evil.com', 'nope', '', null, undefined, '@utexas.edu', 'a@bad host.edu']) {
      expect(eduDomain(e)).toBeNull();
    }
  });
});

describe('schoolFor', () => {
  it('names known Texas schools and points at their own favicon', () => {
    expect(schoolFor('a@mail.tamu.edu')).toEqual({
      domain: 'tamu.edu',
      name: 'Texas A&M',
      site: 'https://www.tamu.edu',
      iconUrl: 'https://tamu.edu/favicon.ico',
      alt: 'Texas A&M icon'
    });
    expect(schoolFor('a@utexas.edu')?.name).toBe('UT Austin');
  });
  it('falls back to the domain for unknown .edu schools', () => {
    expect(schoolFor('a@cs.mit.edu')).toMatchObject({ domain: 'mit.edu', name: 'mit.edu', alt: 'mit.edu icon', iconUrl: 'https://mit.edu/favicon.ico' });
  });
  it('shows nothing for non-.edu emails', () => {
    expect(schoolFor('a@gmail.com')).toBeNull();
  });
  it('keys every school by a bare .edu domain with an https site', () => {
    for (const [domain, s] of Object.entries(SCHOOLS)) {
      expect(eduDomain(`x@${domain}`)).toBe(domain);
      expect(s.site).toMatch(/^https:\/\//);
    }
  });
});
