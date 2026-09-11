export type Standing = 'freshman' | 'sophomore' | 'junior' | 'senior' | 'graduate';

const ORDER: Standing[] = ['freshman', 'sophomore', 'junior', 'senior'];

/**
 * Where a student stands in the current academic year.
 *
 * The academic year is taken to flip in August, so a May 2027 graduate is a
 * senior from August 2026 onward. `rising` is the standing they hold in the
 * next academic year, which is the phrasing internship postings use ('rising
 * senior' means a junior applying for next summer).
 */
export function classStanding(
  gradYear: number,
  now = new Date()
): { standing: Standing; rising: Standing | null; remaining: number } {
  const academicYear = now.getUTCFullYear() + (now.getUTCMonth() >= 7 ? 1 : 0);
  const remaining = gradYear - academicYear;

  const standing: Standing =
    remaining < 0 ? 'graduate' : remaining > 3 ? 'freshman' : (ORDER[3 - remaining] as Standing);

  const rising: Standing | null =
    remaining <= 0 ? null : remaining > 3 ? 'sophomore' : (ORDER[4 - remaining] as Standing);

  return { standing, rising, remaining };
}

export interface ClassRequirement {
  /** Standings the posting asks for, e.g. ['junior', 'senior']. */
  standings: Standing[];
  /** Explicit graduation years, e.g. [2027]. */
  years: number[];
  /** The phrase as written, reused verbatim in the match note. */
  phrase: string | null;
}

const STANDING_WORDS: Record<string, Standing> = {
  freshman: 'freshman',
  'first-year': 'freshman',
  sophomore: 'sophomore',
  junior: 'junior',
  senior: 'senior',
  graduate: 'graduate',
  'new grad': 'graduate',
  'recent graduate': 'graduate'
};

/** Pull the class-year requirement out of a posting's text. */
export function parseClassRequirement(text: string): ClassRequirement {
  const lower = (text ?? '').toLowerCase().replace(/\s+/g, ' ');

  const standings = new Set<Standing>();
  let phrase: string | null = null;

  for (const [word, standing] of Object.entries(STANDING_WORDS)) {
    const re = new RegExp(`(rising\\s+)?\\b${word}\\b`);
    const hit = re.exec(lower);
    if (!hit) continue;
    standings.add(standing);
    if (!phrase) phrase = (hit[1] ? `rising ${word}` : word).trim();
  }

  const years = new Set<number>();
  for (const match of lower.matchAll(
    /\b(?:class of|graduat(?:e|ing|ion)(?:\s+in)?|expected graduation)\s*'?(\d{2,4})\b/g
  )) {
    const raw = Number(match[1]);
    years.add(raw < 100 ? 2000 + raw : raw);
  }

  return { standings: [...standings], years: [...years], phrase };
}

/**
 * Whether a profile satisfies a posting's class requirement. A posting that
 * states no requirement returns null — the caller treats that as neutral
 * rather than as a pass or a fail.
 */
export function matchesClass(
  requirement: ClassRequirement,
  gradYear: number | null,
  now = new Date()
): boolean | null {
  if (!requirement.standings.length && !requirement.years.length) return null;
  if (gradYear === null) return null;

  if (requirement.years.includes(gradYear)) return true;

  const { standing, rising } = classStanding(gradYear, now);
  if (requirement.standings.some((s) => s === standing || s === rising)) return true;

  // The posting asked for something specific and this profile is not it.
  return requirement.years.length > 0 || requirement.standings.length > 0 ? false : null;
}
