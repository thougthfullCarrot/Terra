/** Canonical vocabularies. The UI renders these strings verbatim. */
export const CITIES = [
  'Dallas',
  'Fort Worth',
  'Houston',
  'Austin',
  'San Antonio',
  'El Paso'
] as const;
export type City = (typeof CITIES)[number];

export const SECTORS = [
  'Investment',
  'Brokerage',
  'Development',
  'Property Mgmt',
  'Asset Mgmt',
  'Appraisal',
  'Capital Markets'
] as const;
export type Sector = (typeof SECTORS)[number];

export type Kind = 'Internship' | 'Entry-level';
export type Stage = 'Applied' | 'Interview' | 'Offer';

/** A job as an ATS hands it to us, before any Terra-specific judgement. */
export interface RawJob {
  /** Job title as posted. */
  title: string;
  /** Firm name, from our own `firms` row rather than the ATS payload. */
  firm: string;
  /** Raw location string ('Austin, TX', 'Dallas-Fort Worth', 'Remote — US'). */
  location: string;
  /** Plain text description, HTML already stripped. */
  description: string;
  applyUrl: string;
  /** When the ATS says it went up. Missing on some boards; the collector falls back to now. */
  postedAt?: Date;
  /** Some boards expose an explicit seniority/level field; far more reliable than the title. */
  level?: string;
  /** Which board this came from, for provenance copy. */
  ats: 'greenhouse' | 'lever' | 'workday' | 'icims' | 'aggregator';
}

/** A row of `postings`. */
export interface Posting {
  id: string;
  role: string;
  firm: string;
  city: City;
  sector: Sector;
  kind: Kind;
  pay: string | null;
  /** ISO date (YYYY-MM-DD) or null. */
  deadline: string | null;
  postedAt: Date;
  description: string;
  reqs: string[];
  applyUrl: string;
  source: string;
  active?: boolean;
  firstSeen?: Date;
  lastSeen?: Date;
}

export interface Profile {
  id: string;
  name: string | null;
  school: string | null;
  gradYear: number | null;
  homeCity: string | null;
  skills: string[];
  sectors: string[];
  relocationOpen: boolean;
  resumeUrl?: string | null;
  alerts?: AlertPrefs;
  pushToken?: string | null;
}

export interface AlertPrefs {
  digest: boolean;
  deadlines: boolean;
  internsOnly: boolean;
  market: boolean;
}

export interface Match {
  profileId: string;
  postingId: string;
  score: number;
  note: string;
  lines: string[];
}

/**
 * The posting shape `data-source.js` hands the UI. Differs from the DB row:
 * dates are pre-resolved to the relative numbers the cards render, so the
 * client never does date math.
 */
export interface UiPosting {
  id: string;
  role: string;
  firm: string;
  city: City;
  sector: Sector;
  kind: Kind;
  pay: string | null;
  /** Whole days since posted_at. */
  posted: number;
  /** Display date: 'Oct 3, 2026'. */
  deadline: string | null;
  /** Whole days until the deadline; null when there is no deadline. */
  days: number | null;
  desc: string;
  reqs: string[];
  source: string;
}

/** `match` in the feed payload: posting id -> score/note/lines. */
export type UiMatchIndex = Record<
  string,
  { score: number; note: string; lines: string[] }
>;

export interface MarketData {
  trend: string;
  dir: 'up' | 'down' | 'flat';
  summary: string;
  stats: [string, string, string, string][];
  sectors: [string, string, number][];
  news: [string, string, string][];
  hiring: string;
}

export type UiMarkets = Record<string, MarketData>;

/** The exact object `fetchFeed()` resolves with. */
export interface FeedPayload {
  jobs: UiPosting[];
  match: UiMatchIndex;
  markets: UiMarkets;
  syncedAt: Date;
}

/** A posting is highlighted as a strong match at or above this score. */
export const STRONG_MATCH = 92;
