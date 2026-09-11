import { describe, expect, it } from 'vitest';
import { classifySector } from '../src/collector/sector.js';
import { extractPay } from '../src/collector/pay.js';
import { extractReqs } from '../src/collector/reqs.js';
import { extractDeadline } from '../src/collector/deadline.js';
import { postingId } from '../src/collector/id.js';
import { stripHtml } from '../src/lib/html.js';

describe('classifySector', () => {
  it('classifies from the title', () => {
    expect(classifySector('Acquisitions Analyst Intern').sector).toBe('Investment');
    expect(classifySector('Leasing Coordinator').sector).toBe('Brokerage');
    expect(classifySector('Development Intern').sector).toBe('Development');
    expect(classifySector('Valuation Analyst I').sector).toBe('Appraisal');
    expect(classifySector('Capital Markets Summer Analyst').sector).toBe('Capital Markets');
  });

  it('weights the title over the description', () => {
    const guess = classifySector(
      'Acquisitions Analyst',
      'You will work closely with the property management team on a retail portfolio.'
    );
    expect(guess.sector).toBe('Investment');
  });

  it('falls back to the description when the title is generic', () => {
    const guess = classifySector(
      'Analyst',
      'Support asset managers on budget variance review and lease renewal analysis.'
    );
    expect(guess.sector).toBe('Asset Mgmt');
  });

  it('reports no match rather than guessing', () => {
    expect(classifySector('Analyst', 'A great place to work.').sector).toBeNull();
  });
});

describe('extractPay', () => {
  it('reads hourly rates', () => {
    expect(extractPay('The rate is $24/hr for the summer.')).toBe('$24/hr');
    expect(extractPay('Paid at $22.50 per hour.')).toBe('$22.5/hr');
  });

  it('reads hourly ranges', () => {
    expect(extractPay('Compensation: $22 - $26 per hour')).toBe('$22–26/hr');
  });

  it('reads salary ranges and formats them in thousands', () => {
    expect(extractPay('Base salary of $62,000 - $70,000 per year.')).toBe('$62–70k');
    expect(extractPay('Salary: $62k–$70k annually')).toBe('$62–70k');
  });

  it('returns null when pay is not stated', () => {
    expect(extractPay('Competitive compensation and benefits.')).toBeNull();
    expect(extractPay('')).toBeNull();
  });

  it('ignores dollar figures that are not compensation', () => {
    // A $250 million portfolio is not a salary range.
    expect(extractPay('We manage a $250,000,000 portfolio.')).toBeNull();
  });
});

describe('extractReqs', () => {
  it('pulls the qualifications section', () => {
    const description = [
      'About the role',
      'You will underwrite live deals.',
      '',
      'Qualifications',
      '- Rising junior or senior, finance coursework',
      '- Argus Enterprise exposure preferred',
      '- Strong Excel modeling fundamentals',
      '- Available 10 weeks in Dallas',
      '',
      'Benefits',
      '- Free lunch'
    ].join('\n');

    expect(extractReqs(description)).toEqual([
      'Rising junior or senior, finance coursework',
      'Argus Enterprise exposure preferred',
      'Strong Excel modeling fundamentals',
      'Available 10 weeks in Dallas'
    ]);
  });

  it('caps at four bullets, matching the detail screen', () => {
    const description = ['Requirements', ...Array.from({ length: 9 }, (_, i) => `- Requirement number ${i}`)].join('\n');
    expect(extractReqs(description)).toHaveLength(4);
  });

  it('falls back to any bulleted list when there is no heading', () => {
    expect(extractReqs('We want:\n• Excel fluency\n• A finance degree')).toEqual([
      'Excel fluency',
      'A finance degree'
    ]);
  });

  it('returns nothing for prose with no list', () => {
    expect(extractReqs('We are looking for a motivated student.')).toEqual([]);
  });
});

describe('extractDeadline', () => {
  const now = new Date('2026-09-11T00:00:00Z');

  it('reads a deadline stated near a cue phrase', () => {
    expect(extractDeadline('Applications close October 3, 2026.', now)).toBe('2026-10-03');
    expect(extractDeadline('Apply by 10/3/2026.', now)).toBe('2026-10-03');
  });

  it('infers the next occurrence of a bare month and day', () => {
    expect(extractDeadline('Application deadline: October 3', now)).toBe('2026-10-03');
    // January has already passed this year, so it means next January.
    expect(extractDeadline('Application deadline: January 5', now)).toBe('2027-01-05');
  });

  it('ignores dates that are not deadlines', () => {
    expect(extractDeadline('The internship starts June 1, 2027.', now)).toBeNull();
  });

  it('ignores a deadline that has already passed', () => {
    expect(extractDeadline('Applications close August 1, 2026.', now)).toBeNull();
  });

  it('returns null when nothing is stated', () => {
    expect(extractDeadline('A great summer program.', now)).toBeNull();
  });
});

describe('postingId', () => {
  it('is stable for the same firm, role, and city', () => {
    expect(postingId('Lone Star Capital', 'Investment Analyst Intern', 'Dallas')).toBe(
      postingId('Lone Star Capital', 'Investment Analyst Intern', 'Dallas')
    );
  });

  it('ignores case, punctuation, and whitespace churn', () => {
    expect(postingId('Lone Star Capital', 'Investment  Analyst Intern ', 'Dallas')).toBe(
      postingId('lone star capital', 'Investment Analyst Intern', 'dallas')
    );
  });

  it('separates different seats at the same firm', () => {
    expect(postingId('Lone Star Capital', 'Investment Analyst Intern', 'Dallas')).not.toBe(
      postingId('Lone Star Capital', 'Investment Analyst Intern', 'Houston')
    );
    expect(postingId('Lone Star Capital', 'Development Intern', 'Dallas')).not.toBe(
      postingId('Lone Star Capital', 'Investment Analyst Intern', 'Dallas')
    );
  });
});

describe('stripHtml', () => {
  it('keeps list structure as bullets', () => {
    expect(stripHtml('<ul><li>Excel</li><li>Argus</li></ul>')).toBe('- Excel\n- Argus');
  });

  it('decodes entities', () => {
    expect(stripHtml('<p>Bachelor&#39;s degree &amp; strong Excel</p>')).toBe(
      "Bachelor's degree & strong Excel"
    );
  });

  it('drops script and style content', () => {
    expect(stripHtml('<p>Hi</p><script>alert(1)</script>')).toBe('Hi');
  });
});
