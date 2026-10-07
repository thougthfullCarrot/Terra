// Types for insights-view.js's pure helpers, so the backend's tests can import them under strict mode.
import type { SalaryFile, SalaryRow } from '../backend/src/market/salaries.js';
import type { ZoningCase, ZoningResult } from '../backend/src/market/zoning.js';

export function payRows(salaries: SalaryFile | null | undefined, city: string, query?: string, family?: string): (SalaryRow & { city: string })[];
export const ZONING_GAPS: [string, string][];
export function zoningCases(
  zoning: ZoningResult | null | undefined,
  city: string,
  options?: { when?: 'upcoming' | 'recent'; kind?: string; today?: string }
): ZoningCase[];
export function money(value: number): string;
export function payView(snapshot: unknown, city: string): unknown;
export function zoningView(snapshot: unknown, city: string): unknown;
export function growthView(snapshot: unknown, city: string): unknown;
