// Types for growth.js, so the backend's tests can import it under strict mode.

export interface GrowthJob {
  id?: string;
  firm: string;
  city: string;
  sector?: string;
}

export interface GrowthProject {
  id?: string;
  city: string;
  name?: string;
  cost: number;
  isPublic?: boolean;
  owner?: string | null;
  tenant?: string | null;
  designFirm?: string | null;
  contact?: string | null;
}

export interface GrowthRow<J extends GrowthJob, P extends GrowthProject> {
  firm: string;
  sector?: string;
  jobs: J[];
  projects: (P & { roles: string[] })[];
  cost: number;
  label: string;
}

export const ALIASES: Record<string, RegExp>;
export const ROLES: [string, string][];
export function significant(value: string): Set<string>;
export function sameFirm(firm: string, party: string | null | undefined): boolean;
export function rolesOn(firm: string, project: GrowthProject): string[];
export function growthLabel(jobs: number, projects: number): string;
export function growthRows<J extends GrowthJob, P extends GrowthProject>(jobs: J[] | null | undefined, projects: P[] | null | undefined, city?: string): GrowthRow<J, P>[];
export function buildingNotHiring<P extends GrowthProject>(
  jobs: GrowthJob[] | null | undefined,
  projects: P[] | null | undefined,
  city?: string,
  limit?: number
): { owner: string; projects: P[]; cost: number }[];
export function hiringOn(project: GrowthProject, jobs: GrowthJob[] | null | undefined): { firm: string; count: number }[];
export function firmJobsHref(firm: string, path?: string): string;
export function setGrowthJobs(jobs: GrowthJob[] | null | undefined): void;
export function growthJobs(): GrowthJob[];
