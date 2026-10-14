// Types for labels.js, so the backend's tests can import it under strict mode.
export type LabelKind = 'verified' | 'assumption' | 'estimate';
export type StateKind = 'loading' | 'empty' | 'error';
export const LABELS: Record<LabelKind, { text: string; hint: string }>;
export function labelText(kind: string, source?: string): { text: string; hint: string };
export function labelTag(kind: string, source?: string): HTMLSpanElement;
export function labelLegend(kinds?: LabelKind[]): HTMLParagraphElement;
export function stateKind(kind: StateKind | boolean | string | undefined): StateKind;
export function stateBox(text: string, kind?: StateKind | boolean, options?: { retry?: boolean }): HTMLDivElement;
export function labelHeading(text: string, kind: LabelKind, source?: string): HTMLParagraphElement;
export function taxSource(
  snapshot: { metrics?: { key: string; source?: string }[]; markets?: { city: string; periods?: Record<string, string | null> }[] } | null | undefined,
  city: string
): string;
