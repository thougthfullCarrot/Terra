// Types for career.js, so the backend's tests can import it under strict mode.

export interface CareerJob {
  id?: string;
  role: string;
  firm: string;
  city: string;
  sector: string;
  postedAt: string;
  openSince?: string;
  reposts?: number;
  match?: { required: string[] };
}

export interface CareerProject {
  city: string;
  name?: string;
  facility?: string | null;
  place?: string | null;
  cost: number;
  isPublic?: boolean;
  approximate?: boolean;
  address?: string | null;
  lat: number | null;
  lng: number | null;
  owner?: string | null;
  tenant?: string | null;
  designFirm?: string | null;
  contractor?: string | null;
  [key: string]: unknown;
}

export interface Point {
  lat: number;
  lng: number;
}

export interface JobFlag {
  kind: 'stale' | 'repost';
  label: string;
  hint: string;
}

export interface CareerState {
  open: boolean;
  tool: string;
  city: string;
  firm: string;
  campus: string;
}

export const CAREER_TOOLS: [string, string][];
export const STALE_DAYS: number;
export const TOUR_STOPS: number;
export const SKILL_LABELS: Record<string, string>;
export const CAMPUSES: { key: string; name: string; city: string; lat: number; lng: number }[];
export const TITLE_GUIDE: { key: string; title: string; match: RegExp; sectors: string[]; skills: string[]; pay: string; next: string[]; does: string; day: string[] }[];

export function readCareerHash(hash: string): CareerState;
export function writeCareerHash(state: Partial<CareerState>): string;
export function jobFlags(job: CareerJob, now?: Date): JobFlag[];
export function decodeTitle(role: string): (typeof TITLE_GUIDE)[number] | null;
export function titleRows(jobs: CareerJob[], salaries: unknown, city?: string): ((typeof TITLE_GUIDE)[number] & { jobs: CareerJob[]; pay: { family: string; median: number | null; entry: number | null; filings: number } })[];
export function skillDemand(
  jobs: CareerJob[],
  city?: string,
  minJobs?: number
): {
  total: number;
  sectors: { sector: string; jobs: number }[];
  rows: { key: string; label: string; count: number; share: number; cells: { sector: string; count: number; share: number }[] }[];
};
export function miles(a: Point, b: Point): number;
export function nearCampus(
  projects: CareerProject[],
  jobs: CareerJob[],
  campus: Point,
  radius?: number
): { projects: (CareerProject & { miles: number })[]; firms: { name: string; roles: string[]; projects: CareerProject[]; cost: number; jobs: CareerJob[] }[] };
export function tourStops(projects: CareerProject[], city: string, start: Point, options?: { stops?: number; pool?: number; minCost?: number }): (CareerProject & { leg: number })[];
export function tourUrl(start: Point, stops: { lat: number | null; lng: number | null }[]): string;
export function tourMiles(stops: { leg: number }[]): number;
export function mentions(firm: string, text: string): boolean;
export function briefFirms(jobs: CareerJob[]): { firm: string; jobs: number }[];
export function buildBrief(firm: string, input: { jobs?: CareerJob[]; projects?: CareerProject[]; news?: unknown; zoning?: unknown; salaries?: unknown; sponsors?: unknown }): {
  firm: string;
  sector: string;
  cities: string[];
  jobs: CareerJob[];
  projects: (CareerProject & { roles: string[] })[];
  cost: number;
  headlines: { title: string; url: string; city: string }[];
  cases: { title: string }[];
  pay: { employer: string; title: string; median: number; filings: number; city: string }[];
  sponsor: { name: string; newAgents: number } | null;
  points: string[];
  questions: string[];
};
export function sponsorRows(sponsors: unknown, city?: string, query?: string): { name: string; city: string; newAgents: number; agents: number }[];
