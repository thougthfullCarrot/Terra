/**
 * The shapes `data-source.js` hands the UI. They mirror the backend's
 * `UiPosting` / `UiMatchIndex` / `MarketData` exactly — the server resolves
 * dates and match scores before they reach here, so no screen does date math
 * or joining.
 */

export type City =
  | 'Dallas'
  | 'Fort Worth'
  | 'Houston'
  | 'Austin'
  | 'San Antonio'
  | 'El Paso';

export type Kind = 'Internship' | 'Entry-level';
export type Stage = 'Applied' | 'Interview' | 'Offer';

export interface Posting {
  id: string;
  role: string;
  firm: string;
  city: City;
  sector: string;
  kind: Kind;
  pay: string | null;
  /** Whole days since the posting went up. */
  posted: number;
  /** Display date: 'Oct 3, 2026'. */
  deadline: string | null;
  /** Whole days until the deadline. */
  days: number | null;
  desc: string;
  reqs: string[];
  source: string;
}

export interface MatchEntry {
  score: number;
  /** 'Austin · modeling · rising senior' — rendered verbatim. */
  note: string;
  /** Three or four sentences for the detail sheet's navy panel. */
  lines: string[];
}

export type MatchIndex = Record<string, MatchEntry>;

export interface Market {
  trend: string;
  dir: 'up' | 'down' | 'flat';
  summary: string;
  /** [label, value, delta, direction] */
  stats: [string, string, string, string][];
  /** [name, note, percent] */
  sectors: [string, string, number][];
  /** [tag, headline, body] */
  news: [string, string, string][];
  hiring: string;
}

export type Markets = Record<string, Market>;

export interface Source {
  name: string;
  endpoint: string;
  poll: string;
  transport: string;
}

export interface Feed {
  jobs: Posting[];
  match: MatchIndex;
  markets: Markets;
  syncedAt: Date;
}
