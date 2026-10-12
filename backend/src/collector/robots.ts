/**
 * A small robots.txt reader for the discovery crawler.
 *
 * Discovery reads pages on firms' own websites, so it honours their
 * robots.txt: the group for our user agent if there is one, otherwise `*`.
 * Longest matching rule wins, and Allow beats Disallow on a tie, as in
 * RFC 9309. `*` and `$` in paths are supported. A missing or unreadable file
 * allows everything, which is what the RFC says too.
 */
export interface RobotsRules {
  allow: string[];
  disallow: string[];
}

export function parseRobots(text: string, agent: string): RobotsRules {
  const token = agent.toLowerCase().split('/')[0]!;
  const groups: { agents: string[]; rules: RobotsRules }[] = [];
  let current: { agents: string[]; rules: RobotsRules } | null = null;
  let lastWasAgent = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: { allow: [], disallow: [] } };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current || !value) continue;
    if (key === 'allow') current.rules.allow.push(value);
    if (key === 'disallow') current.rules.disallow.push(value);
  }

  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  return {
    allow: chosen.flatMap((g) => g.rules.allow),
    disallow: chosen.flatMap((g) => g.rules.disallow)
  };
}

export function robotsAllows(rules: RobotsRules, path: string): boolean {
  const best = (patterns: string[]) => Math.max(-1, ...patterns.filter((p) => matches(p, path)).map((p) => p.length));
  const allow = best(rules.allow);
  const disallow = best(rules.disallow);
  return disallow < 0 || allow >= disallow;
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`).test(path);
}
