/**
 * The most years of experience a posting asks for, judged from its text, and
 * whether that is still entry level.
 *
 * Titles say "Analyst" on roles that want three years, so the title filter in
 * seniority.ts lets them through. The description is where the bar is stated:
 * "2+ years of experience", "minimum of three years", "3-5 years in CRE".
 *
 * Terra's line is 0 to 2 years of REQUIRED experience. "2 years" and "1-2
 * years" stay; "2+ years", "at least 2 years" and "2-4 years" go, because each
 * can mean more than two. A preferred figure ("3 years preferred") never
 * excludes a posting whose required bar is within the line.
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
    String.raw`(?=[^.;\n]{0,60}?\b(?:experience|background|work history|track record)\b)`,
  'gi'
);

const BEFORE = new RegExp(
  String.raw`\b(?:experience|background)\b[^.;\n]{0,25}?` +
    String.raw`(at least|minimum(?: of)?|min\.?|no less than|over|more than)?\s*` +
    `${N}` +
    String.raw`(?:\s*(?:-|–|—|to)\s*${N})?` +
    String.raw`\s*(\+|plus|or more)?\s*years?\b`,
  'gi'
);

/** Phrases between the figure and "experience" that mean it is not a work requirement. */
const NOT_EXPERIENCE = /\b(degree|old|graduat\w*|lease|warranty|history|internships?|intern|academic|coursework|co-?op|school|student)\b/i;
/** A figure that names a program's length ('2-year rotational program'), not a bar. Only right after the figure. */
const PROGRAM_LENGTH = /^\W*(?:rotational\s+|training\s+)?(?:program|rotation|term)\b/i;

/** A clause that states a preference rather than a bar. */
const PREFERRED_CLAUSE = /\b(preferred|preferably|prefer|desired|desirable|a plus|nice to have|ideal(?:ly)?|bonus|helpful|advantageous|an advantage|beneficial)\b/i;
/** A clause that states a bar outright. */
const REQUIRED_CLAUSE = /\b(required|requires?|must|minimum|at least|mandatory|necessary)\b/i;

/** Section headings, on a line of their own: 'Preferred Qualifications', 'Nice to have:', 'Requirements'. */
const PREFERRED_HEADING = /^\W*(preferred|desired|additional|bonus|nice[- ]to[- ]haves?|pluses|it would be great|ideal candidate)\b/i;
const REQUIRED_HEADING = /^\W*(required|requirements|minimum|basic|qualifications|what you (need|bring|have)|must[- ]haves?|who you are|you have|job requirements|education (and|&) experience|experience)\b/i;

export interface ExperienceFigure {
  /** Years, with an open-ended floor N counted as N + 0.5. */
  years: number;
  /** False when the clause or its section says 'preferred', 'a plus', 'nice to have'. */
  required: boolean;
  /** The words matched, for the review sheet. */
  text: string;
}

export interface ExperienceRequirement {
  /** The highest required bar, or null when no required figure is stated. */
  required: number | null;
  /** The highest preferred figure, or null. Never decides eligibility on its own. */
  preferred: number | null;
  figures: ExperienceFigure[];
}

/**
 * Every experience figure in the text, each marked required or preferred.
 *
 * Required versus preferred is read from the figure's own clause first ('3
 * years preferred'), then from the section heading it sits under ('Preferred
 * Qualifications'). A figure with neither is treated as required: when a
 * posting does not say, the conservative reading is that it means it.
 */
export function experienceRequirement(text: string): ExperienceRequirement {
  const result: ExperienceRequirement = { required: null, preferred: null, figures: [] };
  if (!text) return result;

  const sections = sectionMap(text);
  const seen = new Set<number>();

  for (const re of [AFTER, BEFORE]) {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) {
      const at = match.index!;
      // The span between the figure and the word "experience" decides relevance.
      const tail = re === AFTER ? text.slice(at + match[0].length, at + match[0].length + 60) : '';
      const lead = tail.split(/\b(?:experience|background|work history|track record)\b/i)[0] ?? '';
      if (NOT_EXPERIENCE.test(lead) || NOT_EXPERIENCE.test(match[0]) || PROGRAM_LENGTH.test(lead)) continue;

      const [, floorWord, low, high, plus] = match;
      const lowYears = toNumber(low);
      if (lowYears === null) continue;
      const highYears = toNumber(high);

      // Both patterns can find the same figure; count it once.
      const figureAt = at + match[0].search(/\d|zero|one|two|three|four|five|six|seven|eight|nine|ten/i);
      if (seen.has(figureAt)) continue;
      seen.add(figureAt);

      // "2+", "at least 2", "over 2": all can mean more than 2.
      const openEnded = Boolean(plus || floorWord);
      const years = highYears !== null ? highYears : openEnded ? lowYears + 0.5 : lowYears;

      const clause = clauseAround(text, at, at + match[0].length + (re === AFTER ? lead.length + 10 : 0));
      const required = PREFERRED_CLAUSE.test(clause)
        ? false
        : REQUIRED_CLAUSE.test(clause)
          ? true
          : sections(at) !== 'preferred';

      result.figures.push({ years, required, text: match[0].trim() });
      if (required) {
        if (result.required === null || years > result.required) result.required = years;
      } else if (result.preferred === null || years > result.preferred) {
        result.preferred = years;
      }
    }
  }

  return result;
}

/**
 * The highest required bar in the text, as a number of years, or null when the
 * text states none. An open-ended floor of N counts as more than N, so "2+
 * years" returns 2.5 and fails a 2-year limit while "2 years" passes.
 * Preferred figures do not count.
 */
export function requiredYears(text: string): number | null {
  return experienceRequirement(text).required;
}

/** True when the posting requires no more than MAX_YEARS, or states no required figure at all. */
export function withinExperienceLimit(text: string, max = MAX_YEARS): boolean {
  const years = requiredYears(text);
  return years === null || years <= max;
}

/**
 * Signs that a posting with no stated years is genuinely entry level: the
 * title names a training seat, or the description says entry level, new
 * graduate, or no experience needed in so many words.
 */
const ENTRY_TITLE = /\b(intern(ship)?s?|co-?op|trainee|apprentice(ship)?|entry[- ]level|junior|jr\.?|new grad(uate)?|graduate program|rotational|in[- ]training|early[- ]career|summer analyst|development program|class of 20\d\d)\b|\b(analyst|associate|accountant|coordinator|specialist|appraiser) (i|1)\b/i;
const ENTRY_TEXT = /\b(entry[- ]level|no (prior |previous )?(professional |work )?experience (is )?(required|necessary|needed)|recent (college |university )?grad(uate)?s?|new (college )?grad(uate)?s?|class of 20\d\d|graduating (seniors?|students?|in 20\d\d)|will train|(paid |on-the-job )?training (is )?provided|0\s*(?:-|–|to)\s*[12] years?|early[- ]career)\b/i;

export function entryLevelEvident(title: string, description: string): boolean {
  return ENTRY_TITLE.test(title) || ENTRY_TEXT.test(description);
}

function clauseAround(text: string, start: number, end: number): string {
  const before = text.slice(Math.max(0, start - 120), start);
  const after = text.slice(end, end + 120);
  const head = before.split(/[.;\n•,(]/).pop() ?? '';
  const rest = after.split(/[.;\n•,)]/)[0] ?? '';
  return head + text.slice(start, end) + rest;
}

/** Which heading each offset sits under: a lookup into the lines of the text. */
function sectionMap(text: string): (offset: number) => 'required' | 'preferred' | null {
  const marks: { at: number; kind: 'required' | 'preferred' }[] = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && trimmed.length <= 60) {
      if (PREFERRED_HEADING.test(trimmed)) marks.push({ at: offset, kind: 'preferred' });
      else if (REQUIRED_HEADING.test(trimmed) && !/\d/.test(trimmed)) marks.push({ at: offset, kind: 'required' });
    }
    offset += line.length + 1;
  }
  return (at) => {
    let kind: 'required' | 'preferred' | null = null;
    for (const mark of marks) {
      if (mark.at > at) break;
      kind = mark.kind;
    }
    return kind;
  };
}

function toNumber(value: string | undefined): number | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower in NUMBER_WORDS) return NUMBER_WORDS[lower]!;
  const parsed = Number.parseInt(lower, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
