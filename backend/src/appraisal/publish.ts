/**
 * Which districts' index groups may ever leave the pipeline. Publication is off: nothing in TERRA reads this
 * yet, and turning it on (and changing the lists) is Rod's call, made in code review, after each source's
 * reuse terms are verified (docs/appraisal-lookup.md, "Source terms").
 */
import type { IndexManifest } from './lookup.js';

export const PUBLICATION = {
  enabled: false,
  /** Proposed 2026-10-18: official free bulk downloads with no stated reuse limit. Not approved. */
  proposed: ['harris', 'dallas', 'tarrant', 'travis', 'galveston', 'brazos'],
  /** Held until their permitted use is resolved. */
  held: {
    bexar: 'values come from a third-party mirror (SARA) of a BCAD open-records release; reuse terms unresolved',
    'el-paso': 'EPCAD labels its schemas and exports "intended for development use only"'
  } as Record<string, string>
} as const;

export interface PublishDecision {
  district: string;
  publish: boolean;
  reason: string;
}

/** Decide, per indexed district, whether it may be published; every refusal says why. */
export function publishable(manifest: IndexManifest, policy: { enabled: boolean; proposed: readonly string[]; held: Record<string, string> } = PUBLICATION): PublishDecision[] {
  return Object.entries(manifest.districts).map(([district, m]) => {
    const no = (reason: string) => ({ district, publish: false, reason });
    if (m.complete !== true) return no(`incomplete: ${m.completeness ?? 'completeness not recorded'}`);
    if (policy.held[district]) return no(`held: ${policy.held[district]}`);
    if (!policy.proposed.includes(district)) return no('not on the allowlist');
    if (!policy.enabled) return no('publication is disabled');
    return { district, publish: true, reason: `complete, allowlisted, tax year ${m.taxYear ?? 'unknown'}` };
  });
}
