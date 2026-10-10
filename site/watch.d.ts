// Types for watch.js, so the backend's tests can import it under strict mode.

export type WatchKind = 'market' | 'area' | 'project';
export interface WatchItemDraft {
  kind: WatchKind;
  city: string;
  ref: string;
  filters: { above?: number; below?: number; work?: string[]; minCost?: number; name?: string };
}
export const WATCH_LIMIT: number;
export const DIGEST_FREQUENCIES: ('weekly' | 'daily')[];
export const DEFAULT_FREQUENCY: 'weekly';
export const WORK_TYPES: string[];
export function marketItem(city: string, metric?: string, threshold?: { above?: number; below?: number }): WatchItemDraft;
export function areaItem(city: string, filters?: { work?: string[]; minCost?: number }): WatchItemDraft;
export function projectItem(city: string, projectId: string, name?: string): WatchItemDraft;
export function itemKey(item: Pick<WatchItemDraft, 'kind' | 'city' | 'ref'>): string;
export function itemLabel(item: WatchItemDraft, metricLabel?: (key: string) => string): string;
export function countLine(count: number): string;
export function digestRow(values: { watchEmails: unknown; digestFrequency: unknown }): { watch_emails: boolean; digest_frequency: 'weekly' | 'daily' };
export function addProblem(message: unknown): string;
export function unsubscribeParams(
  search: string
): null | { kind: 'jobs' | 'watch'; valid: false } | { kind: 'jobs' | 'watch'; user: string; token: string; valid: true };
