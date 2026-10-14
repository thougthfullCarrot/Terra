import { describe, expect, it } from 'vitest';
import { parseRobots, robotsAllows } from '../src/collector/robots.js';

const UA = 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)';

describe('robots.txt', () => {
  it('allows everything when the file is empty', () => {
    expect(robotsAllows(parseRobots('', UA), '/careers')).toBe(true);
  });

  it('applies the * group', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /careers\n', UA);
    expect(robotsAllows(rules, '/careers/jobs')).toBe(false);
    expect(robotsAllows(rules, '/about')).toBe(true);
  });

  it('prefers a group naming our agent over *', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: terra-collector\nDisallow: /private\n', UA);
    expect(robotsAllows(rules, '/careers')).toBe(true);
    expect(robotsAllows(rules, '/private/x')).toBe(false);
  });

  it('lets the longest rule win, Allow on a tie', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /\nAllow: /careers\n', UA);
    expect(robotsAllows(rules, '/careers')).toBe(true);
    expect(robotsAllows(rules, '/admin')).toBe(false);
  });

  it('supports * and $ in paths', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow: /wp-admin\n', UA);
    expect(robotsAllows(rules, '/files/a.pdf')).toBe(false);
    expect(robotsAllows(rules, '/files/a.pdf?x')).toBe(true);
    expect(robotsAllows(rules, '/careers')).toBe(true);
  });

  it('ignores another named agent group', () => {
    const rules = parseRobots('User-agent: GPTBot\nDisallow: /\n', UA);
    expect(robotsAllows(rules, '/careers')).toBe(true);
  });
});

import { parseCandidates } from '../src/collector/firmCandidates.js';

describe('candidate groups', () => {
  it('tags each line with the header above it', () => {
    const list = parseCandidates('# --- Homebuilders ---\nShea Homes | sheahomes.com\n# --- Brokerages ---\nWeitzman\n');
    expect(list.map((c) => c.group)).toEqual(['Homebuilders', 'Brokerages']);
  });
});
