/**
 * The app's only data layer.
 *
 * Today this points at the prototype's seed data so the screens run with no
 * backend. To go live, change the import below to the real client and nothing
 * else in the app changes — the signatures and the shapes are identical:
 *
 *   import * as impl from './live';   // a copy of client/data-source.js
 *
 * (Copy the file into this folder first; Metro will not resolve a path outside
 * the project root.)
 */
import * as impl from './seed.js';
import type { Feed, Markets, Source } from './types';

// The seed file is plain JS, so TypeScript infers `string` where the app wants
// the narrower unions. The contract guarantees the narrow values; asserting
// once here keeps every screen honestly typed.
export const SOURCE = impl.SOURCE as Source;

export function fetchFeed(options?: { state?: string }): Promise<Feed> {
  return impl.fetchFeed(options ?? {}) as unknown as Promise<Feed>;
}

export function fetchMarkets(): Promise<Markets> {
  return impl.fetchMarkets() as unknown as Promise<Markets>;
}

/** Dev only — drives the Profile screen's "Test failure" button. */
export function simulateFailure(): void {
  impl.simulateFailure();
}
