import { describe, expect, it } from 'vitest';
import {
  checkoutUrl,
  fileProblem,
  gradYears,
  initials,
  isCollegeEmail,
  isConfigured,
  isEmail,
  profileRow,
  resumeContentType,
  storagePath
} from '../../site/access.js';

const now = new Date('2026-10-04T15:00:00Z');

describe('isCollegeEmail', () => {
  it('accepts .edu domains and their subdomains, in any case', () => {
    expect(isCollegeEmail('jane@utexas.edu')).toBe(true);
    expect(isCollegeEmail('jane@mail.utexas.edu')).toBe(true);
    expect(isCollegeEmail('  Jane@TAMU.EDU ')).toBe(true);
  });

  it('rejects look-alikes and everything else', () => {
    expect(isCollegeEmail('jane@edu.com')).toBe(false);
    expect(isCollegeEmail('jane@utexas.edu.co')).toBe(false);
    expect(isCollegeEmail('jane@notedu')).toBe(false);
    expect(isCollegeEmail('jane.edu@gmail.com')).toBe(false);
    expect(isCollegeEmail('')).toBe(false);
  });
});

describe('isEmail and isConfigured', () => {
  it('checks the shape of an address', () => {
    expect(isEmail('a@b.co')).toBe(true);
    expect(isEmail('a@b')).toBe(false);
    expect(isEmail('not an email')).toBe(false);
  });

  it('needs both the project URL and the anon key', () => {
    expect(isConfigured({ supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k' })).toBe(true);
    expect(isConfigured({ supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: '' })).toBe(false);
    expect(isConfigured(null)).toBe(false);
  });
});

describe('checkoutUrl', () => {
  it('carries the user id and email through Stripe checkout', () => {
    const url = new URL(checkoutUrl('https://buy.stripe.com/test_abc', { userId: 'u-1', email: 'a+b@gmail.com' })!);
    expect(url.origin + url.pathname).toBe('https://buy.stripe.com/test_abc');
    expect(url.searchParams.get('client_reference_id')).toBe('u-1');
    expect(url.searchParams.get('prefilled_email')).toBe('a+b@gmail.com');
  });

  it('refuses links that are not https', () => {
    expect(checkoutUrl('javascript:alert(1)', { userId: 'u' })).toBeNull();
    expect(checkoutUrl('http://buy.stripe.com/x', { userId: 'u' })).toBeNull();
    expect(checkoutUrl('not a url', { userId: 'u' })).toBeNull();
  });
});

describe('profileRow', () => {
  it('trims text, keeps known choices, and drops the rest', () => {
    expect(
      profileRow(
        {
          name: '  Jane   Doe ',
          school: 'Texas A&M University',
          gradYear: '2027',
          major: '',
          homeCity: 'Austin',
          relocationOpen: true,
          sectors: ['Brokerage', 'Underwater Basket Weaving', 'Investment']
        },
        now
      )
    ).toEqual({
      name: 'Jane Doe',
      school: 'Texas A&M University',
      grad_year: 2027,
      major: null,
      home_city: 'Austin',
      relocation_open: true,
      sectors: ['Investment', 'Brokerage']
    });
  });

  it('nulls a grad year or city outside the offered choices', () => {
    const row = profileRow({ gradYear: '1999', homeCity: 'Chicago' }, now);
    expect(row.grad_year).toBeNull();
    expect(row.home_city).toBeNull();
  });

  it('offers last year through six years out', () => {
    expect(gradYears(now)).toEqual([2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032]);
  });
});

describe('uploads', () => {
  it('accepts pictures and resumes within the bucket limits', () => {
    expect(fileProblem({ name: 'me.png', type: 'image/png', size: 1000 }, 'avatar')).toBeNull();
    expect(fileProblem({ name: 'Resume.PDF', type: '', size: 1000 }, 'resume')).toBeNull();
    expect(fileProblem({ name: 'cv.docx', type: '', size: 1000 }, 'resume')).toBeNull();
  });

  it('explains what is wrong with anything else', () => {
    expect(fileProblem({ name: 'me.svg', type: 'image/svg+xml', size: 10 }, 'avatar')).toMatch(/JPG/);
    expect(fileProblem({ name: 'me.png', type: 'image/png', size: 3 * 1024 * 1024 }, 'avatar')).toMatch(/2 MB/);
    expect(fileProblem({ name: 'cv.pages', type: '', size: 10 }, 'resume')).toMatch(/PDF/);
    expect(fileProblem({ name: 'cv.pdf', type: '', size: 6 * 1024 * 1024 }, 'resume')).toMatch(/5 MB/);
    expect(fileProblem(null, 'resume')).toMatch(/Pick/);
  });

  it("stores files under the user's own folder", () => {
    expect(storagePath('u-1', 'avatar')).toBe('u-1/avatar');
    expect(storagePath('u-1', 'resume', 'My Resume.PDF')).toBe('u-1/resume.pdf');
    expect(resumeContentType('cv.docx')).toMatch(/wordprocessingml/);
  });

  it('falls back to initials without a picture', () => {
    expect(initials('jane van doe', 'x@y.edu')).toBe('JV');
    expect(initials('', 'sam@y.edu')).toBe('S');
  });
});
