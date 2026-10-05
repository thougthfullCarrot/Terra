// Types for school.js, so the backend's tests can import it under strict mode.

export interface SchoolInfo {
  domain: string;
  name: string;
  site: string;
  iconUrl: string;
  alt: string;
}

export const SCHOOLS: Record<string, { name: string; site: string }>;
export function eduDomain(email: string | null | undefined): string | null;
export function schoolFor(email: string | null | undefined): SchoolInfo | null;
