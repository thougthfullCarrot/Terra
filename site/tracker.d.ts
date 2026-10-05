// Types for tracker.js, so the backend's tests can import it under strict mode.

export type Stage = 'Saved' | 'Applied' | 'Interviewing' | 'Offer' | 'Not selected';
export const STAGES: Stage[];
export const ACTIVE_STAGES: Stage[];
export const NOTE_LIMIT: number;

export interface JobSummary {
  role: string;
  firm: string;
  city: string;
  kind: string;
  applyUrl: string;
  deadline: string | null;
}

export interface TrackedRow {
  job_id: string;
  stage: Stage;
  note: string | null;
  follow_up: string | null;
  job: JobSummary | Record<string, never>;
  updated_at?: string;
}

interface JobLike {
  id?: string;
  role?: string;
  firm?: string;
  city?: string;
  kind?: string;
  applyUrl?: string;
  deadline?: string | null;
}

export function jobSummary(job: JobLike): JobSummary;
export function trackedRow(
  jobId: string,
  values: { stage?: string; note?: string | null; followUp?: string | null; job?: JobLike | null }
): TrackedRow;
export function groupByStage<T extends { stage: string; updated_at?: string }>(rows: T[]): Map<Stage, T[]>;
export function texasToday(now?: Date): string;
export function followUpLabel(date: string | null | undefined, now?: Date): { text: string; due: boolean } | null;
export function trackerSummary(rows: { stage: string; follow_up: string | null }[], now?: Date): string;
export function importRows(localIds: Iterable<string>, jobs: (JobLike & { id: string })[], tracked: ReadonlySet<string>): TrackedRow[];
