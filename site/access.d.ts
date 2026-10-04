// Types for access.js, so the backend's tests can import it under strict mode.

export interface ProfileValues {
  name?: string;
  school?: string;
  gradYear?: string | number;
  major?: string;
  homeCity?: string;
  relocationOpen?: boolean;
  sectors?: string[];
}

export interface ProfileRow {
  name: string | null;
  school: string | null;
  grad_year: number | null;
  major: string | null;
  home_city: string | null;
  relocation_open: boolean;
  sectors: string[];
}

export interface FileLike {
  name: string;
  type: string;
  size: number;
}

export function isEmail(value: string): boolean;
export function isCollegeEmail(email: string): boolean;
export function isConfigured(config: { supabaseUrl?: string; supabaseAnonKey?: string } | null | undefined): boolean;
export function checkoutUrl(paymentLink: string, user: { userId: string; email?: string | null }): string | null;
export const PROFILE_CITIES: string[];
export const PROFILE_SECTORS: string[];
export function gradYears(now?: Date): number[];
export function profileRow(values: ProfileValues, now?: Date): ProfileRow;
export const AVATAR_LIMIT: number;
export const RESUME_LIMIT: number;
export function fileProblem(file: FileLike | null | undefined, kind: 'avatar' | 'resume'): string | null;
export function storagePath(userId: string, kind: 'avatar' | 'resume', fileName?: string): string;
export function resumeContentType(fileName: string): string;
export function initials(name: string | null | undefined, email: string | null | undefined): string;
