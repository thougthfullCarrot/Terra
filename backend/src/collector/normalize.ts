import type { Posting, RawJob, Sector } from '../types.js';
import { postingId } from './id.js';
import { resolveCity } from './texas.js';
import { classifyKind } from './seniority.js';
import { classifySector } from './sector.js';
import { extractPay } from './pay.js';
import { extractReqs } from './reqs.js';
import { extractDeadline } from './deadline.js';

export type RejectReason =
  | 'missing-fields'
  | 'not-texas'
  | 'not-entry-level';

export type NormalizeResult =
  | { ok: true; posting: Posting; sectorGuessed: boolean }
  | { ok: false; reason: RejectReason };

/** Sector used when no keyword matched; counted separately so it stays visible. */
const FALLBACK_SECTOR: Sector = 'Investment';

/**
 * Turn one raw ATS job into a `postings` row, or say why it was dropped.
 *
 * The four filters run in the order the spec lists them — Texas, then
 * seniority, then sector, then normalization — because each is cheaper than the
 * one after it and the first two reject the overwhelming majority.
 */
export function normalize(raw: RawJob, now = new Date()): NormalizeResult {
  const role = collapse(raw.title);
  const firm = collapse(raw.firm);
  if (!role || !firm || !raw.applyUrl) return { ok: false, reason: 'missing-fields' };

  const city = resolveCity(raw.location ?? '');
  if (!city) return { ok: false, reason: 'not-texas' };

  const kind = classifyKind(role, raw.level);
  if (!kind) return { ok: false, reason: 'not-entry-level' };

  const description = collapseBlank(raw.description ?? '');
  const guess = classifySector(role, description);

  return {
    ok: true,
    sectorGuessed: guess.sector === null,
    posting: {
      id: postingId(firm, role, city),
      role,
      firm,
      city,
      sector: guess.sector ?? FALLBACK_SECTOR,
      kind,
      pay: extractPay(description),
      deadline: extractDeadline(description, now),
      postedAt: raw.postedAt ?? now,
      description,
      reqs: extractReqs(description),
      applyUrl: raw.applyUrl,
      source: provenance(raw.ats)
    }
  };
}

/**
 * The `source` column holds only the stem. The ', verified N days ago' half of
 * the string the design shows is recency, so the API appends it from
 * `last_seen` at read time — stored text would be wrong within a day.
 */
function provenance(ats: RawJob['ats']): string {
  switch (ats) {
    case 'greenhouse':
    case 'lever':
    case 'workday':
    case 'icims':
      return 'Posted on the firm careers page';
    case 'aggregator':
      return 'Aggregated from a Texas jobs board';
  }
}

function collapse(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function collapseBlank(value: string): string {
  return value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
