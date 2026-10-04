/**
 * The most years of experience a posting asks for, judged from its text, and
 * whether that is still entry level.
 *
 * Titles say "Analyst" on roles that want three years, so the title filter in
 * seniority.ts lets them through. The description is where the bar is stated:
 * "2+ years of experience", "minimum of three years", "3-5 years in CRE".
 *
 * Terra's line is 0 to 2 years. "2 years" and "1-2 years" stay; "2+ years",
 * "at least 2 years" and "2-4 years" go, because each can mean more than two.
 * A figure only counts when it is about experience, so "4-year degree",
 * "within 2 years of graduation" and "a 3-year rotation" are ignored.
 */

export const MAX_YEARS = 2;

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10
};

// "3", "three", or "three (3)".
const N = String.raw`(\d{1,2}|zero|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s*\(\d{1,2}\))?`;

/**
 * One requirement: an open-ended floor ("2+ years", "at least 2 years",
 * "minimum 2 years") or a figure or range ("2 years", "1-3 years"). The
 * phrase must lead into experience within a short window, either after it
 * ("3+ years of commercial real estate experience") or before it
 * ("experience: 3+ years").
 */
const AFTER = new RegExp(
  String.raw`(at least|minimum(?: of)?|min\.?|no less than|over|more than)?\s*` +
    `${N}` +
    String.raw`(?:\s*(?:-|–|—|to)\s*${N})?` +
    String.raw`\s*(\+|plus|or more)?\s*(?:\+\s*)?years?'?` +
    String.raw`(?=[^.;\n]{0,60}?\bexperience\b)`,
  'gi'
);

const BEFORE = new RegExp(
  String.raw`\bexperience\b[^.;\n]{0,25}?` +
    String.raw`(at least|minimum(?: of)?|min\.?|no less than|over|more than)?\s*` +
    `${N}` +
    String.raw`(?:\s*(?:-|–|—|to)\s*${N})?` +
    String.raw`\s*(\+|plus|or more)?\s*years?\b`,
  'gi'
);

/** Phrases between the figure and "experience" that mean it is not a work requirement. */
const NOT_EXPERIENCE = /\b(degree|old|graduat\w*|program|rotation|term|lease|warranty|history)\b/i;

/**
 * The highest bar any requirement in the text sets, as a number of years, or
 * null when the text states none. An open-ended floor of N counts as more than
 * N, so "2+ years" returns 2.5 and fails a 2-year limit while "2 years" passes.
 */
export function requiredYears(text: string): number | null {
  if (!text) return null;
  let highest: number | null = null;

  for (const re of [AFTER, BEFORE]) {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) {
      // The span between the figure and the word "experience" decides relevance.
      const tail = re === AFTER ? text.slice(match.index! + match[0].length, match.index! + match[0].length + 60) : '';
      const lead = tail.split(/\bexperience\b/i)[0] ?? '';
      if (NOT_EXPERIENCE.test(lead) || NOT_EXPERIENCE.test(match[0])) continue;

      const [, floorWord, low, high, plus] = match;
      const lowYears = toNumber(low);
      if (lowYears === null) continue;
      const highYears = toNumber(high);

      // "2+", "at least 2", "over 2": all can mean more than 2.
      const openEnded = Boolean(plus || floorWord);
      const years = highYears !== null ? highYears : openEnded ? lowYears + 0.5 : lowYears;
      if (highest === null || years > highest) highest = years;
    }
  }

  return highest;
}

/** True when the posting asks for no more than MAX_YEARS, or states no figure at all. */
export function withinExperienceLimit(text: string, max = MAX_YEARS): boolean {
  const years = requiredYears(text);
  return years === null || years <= max;
}

function toNumber(value: string | undefined): number | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower in NUMBER_WORDS) return NUMBER_WORDS[lower]!;
  const parsed = Number.parseInt(lower, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
