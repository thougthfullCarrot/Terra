// Types for devreports.js, so the backend's tests can import it under strict mode.

export interface ReportInput {
  address?: string;
  name?: string;
  description?: string;
  sourceUrl?: string;
  website?: string;
  pin?: { lat: number; lng: number } | null;
  photo?: { type: string; size: number } | null;
}
export interface ReportRow {
  city: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  name: string | null;
  description: string;
  source_url: string | null;
}
export interface SmallerFiling {
  id: string;
  city: string;
  name: string;
  place: string | null;
  cost: number;
  address?: string | null;
  owner?: string | null;
  [key: string]: unknown;
}
export const LIMITS: { name: number; address: number; description: number; minDescription: number; url: number; photoBytes: number; perDay: number };
export const PHOTO_TYPES: string[];
export const STATUS_LABELS: Record<'pending' | 'approved' | 'rejected' | 'duplicate', string>;
export function reportRow(input: ReportInput, city: string): { errors: string[]; row?: ReportRow; spam?: boolean };
export function reportError(message?: string): string;
export function reportStatus(report: { status: string; possible_duplicate_of?: string | null }): string;
export function coverageNote(options: {
  metro?: { filings: number; cap: number; cutoff: number | null; complete: boolean; city?: string; reported?: number | null; skippedWindows?: number; listed?: number; exact?: number; site?: number; approximate?: number; awaiting?: number; unlocated?: number };
  smaller?: number;
  pinned?: number;
  permits?: string | null;
  reports?: number;
}): string;
export function matchSmaller<T extends SmallerFiling>(list: T[] | null | undefined, city: string, query?: string): T[];
