import { CITIES, STRONG_MATCH, type Posting, type Profile } from '../types.js';
import { detectSkills, normalizeProfileSkills, skillLabel } from './skills.js';
import { matchesClass, parseClassRequirement, classStanding } from './classYear.js';

/** Component weights, per the spec. They sum to 1. */
export const WEIGHTS = {
  skills: 0.4,
  location: 0.2,
  classYear: 0.2,
  sector: 0.2
} as const;

/**
 * Neutral values, used when a posting or profile simply does not say. Scoring
 * a silent posting as zero would bury it below a worse-fitting one that
 * happened to list its requirements, so silence sits above the midpoint
 * without reaching the strong-match threshold on its own.
 */
const NEUTRAL = {
  skills: 0.6,
  classYear: 0.7,
  sector: 0.6
} as const;

export interface ScoreBreakdown {
  skills: number;
  location: number;
  classYear: number;
  sector: number;
}

export interface ScoredMatch {
  score: number;
  note: string;
  lines: string[];
  breakdown: ScoreBreakdown;
  strong: boolean;
}

/**
 * Score one posting against one profile.
 *
 * Runs server side on insert; the result is written to `matches` and rendered
 * verbatim by the UI, which highlights anything at or above STRONG_MATCH.
 */
export function scoreMatch(profile: Profile, posting: Posting, now = new Date()): ScoredMatch {
  const postingText = [posting.role, posting.description, ...posting.reqs].join('\n');

  const required = detectSkills(postingText);
  const resume = normalizeProfileSkills(profile.skills ?? []);
  const overlap = required.filter((key) => resume.includes(key));

  const skills = required.length ? overlap.length / required.length : NEUTRAL.skills;

  const homeMatches =
    !!profile.homeCity && profile.homeCity.toLowerCase() === posting.city.toLowerCase();
  const location = homeMatches ? 1 : profile.relocationOpen ? 0.75 : 0.15;

  const requirement = parseClassRequirement(postingText);
  const classVerdict = matchesClass(requirement, profile.gradYear, now);
  const classYear = classVerdict === null ? NEUTRAL.classYear : classVerdict ? 1 : 0;

  const declared = (profile.sectors ?? []).map((s) => s.toLowerCase());
  const sector = declared.length
    ? declared.includes(posting.sector.toLowerCase())
      ? 1
      : 0
    : NEUTRAL.sector;

  const breakdown: ScoreBreakdown = { skills, location, classYear, sector };
  const score = Math.round(
    100 *
      (skills * WEIGHTS.skills +
        location * WEIGHTS.location +
        classYear * WEIGHTS.classYear +
        sector * WEIGHTS.sector)
  );

  return {
    score,
    note: buildNote(profile, posting, overlap, requirement.phrase, now),
    lines: buildLines(profile, posting, {
      overlap,
      required,
      homeMatches,
      classVerdict,
      classPhrase: requirement.phrase,
      sectorMatch: sector === 1,
      now
    }),
    breakdown,
    strong: score >= STRONG_MATCH
  };
}

/**
 * The three-part note under a strong-match header: place, strongest skill
 * overlap, class standing — 'Austin · modeling · rising senior'. Parts that
 * have no evidence are dropped rather than filled with filler.
 */
function buildNote(
  profile: Profile,
  posting: Posting,
  overlap: string[],
  classPhrase: string | null,
  now: Date
): string {
  const parts: string[] = [posting.city];

  if (overlap.length) parts.push(skillLabel(overlap[0] as string));

  if (classPhrase) {
    parts.push(classPhrase);
  } else if (profile.gradYear) {
    const { standing, rising } = classStanding(profile.gradYear, now);
    parts.push(posting.kind === 'Internship' && rising ? `rising ${rising}` : standing);
  }

  return parts.slice(0, 3).join(' · ');
}

interface LineContext {
  overlap: string[];
  required: string[];
  homeMatches: boolean;
  classVerdict: boolean | null;
  classPhrase: string | null;
  sectorMatch: boolean;
  now: Date;
}

/**
 * Three or four full sentences explaining the score, shown in the detail
 * sheet's navy panel. Each one names the evidence it came from so the student
 * can tell whether the match is real.
 */
function buildLines(profile: Profile, posting: Posting, ctx: LineContext): string[] {
  const lines: string[] = [];

  if (ctx.overlap.length) {
    const labels = ctx.overlap.map(skillLabel);
    lines.push(
      `${sentenceList(labels)} on your resume, ${
        ctx.overlap.length === 1 ? 'listed' : 'all listed'
      } in what this role asks for.`
    );
  }

  if (ctx.classVerdict === true && ctx.classPhrase) {
    lines.push(
      `You are a ${ctx.classPhrase}${
        profile.school ? ` at ${profile.school}` : ''
      }, which is the class year the posting names.`
    );
  } else if (ctx.classVerdict === true && profile.gradYear) {
    lines.push(`Your ${profile.gradYear} graduation matches the class requirement.`);
  }

  if (ctx.homeMatches) {
    lines.push(`${posting.city} based, so no relocation for this one.`);
  } else if (profile.relocationOpen && (CITIES as readonly string[]).includes(posting.city)) {
    lines.push(`${posting.city} is in state and you marked relocation open.`);
  }

  if (ctx.sectorMatch) {
    lines.push(`${posting.sector} is one of the sectors you follow.`);
  }

  if (posting.pay) {
    lines.push(`Pay is posted at ${posting.pay}, stated on the listing itself.`);
  }

  return lines.slice(0, 4);
}

function sentenceList(items: string[]): string {
  if (items.length === 1) return items[0] as string;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}
