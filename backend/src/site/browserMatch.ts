/**
 * The resume matcher, bundled for the website as site/match.js by
 * `npm run build:site-match`. It is the same scorer the app's server uses;
 * only the text analysis was done ahead of time, by the export.
 */
import { scoreWithInputs, type MatchInputs } from '../matching/score.js';
import { detectSkills, skillLabel } from '../matching/skills.js';
import { STRONG_MATCH, type City, type Kind, type Profile, type Sector } from '../types.js';

export { STRONG_MATCH };

/**
 * Score at or above which the website marks a job "Best match". Lower than
 * STRONG_MATCH, which still decides the app's alerts: across ten test
 * profiles against a live feed, 92 badged one job for one user and nothing
 * for the other five, so the badge almost never showed.
 */
export const BEST_MATCH = 80;

/** The profile fields the website stores, as the site holds them. */
export interface SiteProfile {
  school: string | null;
  gradYear: number | null;
  homeCity: string | null;
  sectors: string[];
  relocationOpen: boolean;
  /** Plain text pulled from the uploaded resume in the browser. */
  resumeText: string | null;
}

export interface SiteJob {
  id: string;
  city: string;
  sector: string;
  kind: string;
  pay: string | null;
  match?: MatchInputs;
}

export interface SiteMatch {
  score: number;
  note: string;
  lines: string[];
  strong: boolean;
}

export { skillLabel };

/** Vocabulary keys (as in job.match.required) found in a resume, for have/missing lists and skill gaps. */
export function resumeSkillKeys(text: string | null): string[] {
  return detectSkills(text ?? '');
}

/** Skills from the matcher's vocabulary found in a resume, for the profile page. */
export function resumeSkills(text: string | null): string[] {
  return detectSkills(text ?? '').map(skillLabel);
}

/**
 * Score every job against a profile. Returns nothing until there is a resume,
 * since without one every score is the same handful of neutral defaults and a
 * "best match" badge would mean nothing.
 */
export function scoreJobs(profile: SiteProfile, jobs: SiteJob[], now = new Date()): Map<string, SiteMatch> {
  const scores = new Map<string, SiteMatch>();
  if (!profile.resumeText?.trim()) return scores;

  const asProfile: Profile = {
    id: '',
    name: null,
    school: profile.school,
    gradYear: profile.gradYear,
    homeCity: profile.homeCity,
    // The whole resume as one "skill": the scorer finds every vocabulary term in it.
    skills: [profile.resumeText],
    sectors: profile.sectors,
    relocationOpen: profile.relocationOpen
  };

  for (const job of jobs) {
    if (!job.match) continue;
    const posting = { city: job.city as City, sector: job.sector as Sector, kind: job.kind as Kind, pay: job.pay };
    const { score, note, lines } = scoreWithInputs(asProfile, posting, job.match, now);
    scores.set(job.id, { score, note, lines, strong: score >= BEST_MATCH });
  }
  return scores;
}
