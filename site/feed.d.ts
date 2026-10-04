// Types for feed.js, so the backend's tests can import it under strict mode.

export interface Job {
  id: string;
  role: string;
  firm: string;
  city: string;
  sector: string;
  kind: string;
  pay: string | null;
  postedAt: string;
  deadline: string | null;
  desc: string;
  reqs: string[];
  applyUrl: string;
}

export interface FilterState {
  q?: string;
  city?: string;
  firm?: string;
  kind?: string;
  sector?: string;
}

export interface QueryState {
  q: string;
  city: string;
  firm: string;
  kind: string;
  sector: string;
  sort: 'newest' | 'deadline';
}

export const FILTERS: readonly ['city', 'firm', 'kind', 'sector'];
export const SORTS: readonly ['newest', 'deadline'];

export function daysBetween(from: Date, to: Date): number;
export function facet<T extends Job>(jobs: T[], field: keyof Job): { value: string; count: number }[];
export function filterJobs<T extends Job>(jobs: T[], state?: FilterState): T[];
export function sortJobs<T extends Job>(jobs: T[], sort?: string): T[];
export function postedLabel(postedAt: string, now?: Date): string;
export function deadlineLabel(deadline: string | null, now?: Date): { text: string; urgent: boolean } | null;
export function updatedLabel(generatedAt: string, now?: Date): string;
export function safeUrl(url: string): string | null;
export function readQuery(search: string): QueryState;
export function writeQuery(state: Partial<QueryState>): string;
