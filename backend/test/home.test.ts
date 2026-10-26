import { describe, expect, it } from 'vitest';
import { countLabel } from '../../site/home.js';

describe('welcome screen counts', () => {
  it('shows a real number with its noun', () => {
    expect(countLabel(1, 'open role', 'listed now')).toBe('1 open role listed now');
    expect(countLabel(1234, 'headline')).toBe('1,234 headlines');
  });
  it('shows nothing rather than a guess when there is no count', () => {
    for (const n of [0, -1, NaN, null, undefined]) expect(countLabel(n as number, 'event')).toBe('');
  });
});
