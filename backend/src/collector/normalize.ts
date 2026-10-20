import type { Posting, RawJob, Sector } from '../types.js';
import type { FirmRow } from '../db/store.js';
import { postingId } from './id.js';
import { resolveCity } from './texas.js';
import { classifyKind } from './seniority.js';
import { MAX_YEARS, entryLevelEvident, experienceRequirement } from './experience.js';
import { creRelevance } from './relevance.js';
import { classifySector } from './sector.js';
import { extractPay } from './pay.js';
import { extractReqs } from './reqs.js';
import { extractDeadline } from './deadline.js';

export type RejectReason =
  | 'missing-fields'
  | 'not-texas'
  /** The title is senior, or names no entry-level seat. */
  | 'not-entry-level'
  /** The description requires 3+ years, or an open-ended 2+. */
  | 'over-experience'
  | 'off-topic';

/** Every way a posting can fail to publish, for the run's counts. */
export function emptyRejected(): Record<RejectReason, number> {
  return { 'missing-fields': 0, 'not-texas': 0, 'not-entry-level': 0, 'over-experience': 0, 'off-topic': 0 };
}

/** Why a posting is held for a person to look at instead of published. */
export type ReviewReason =
  /** No required years stated, and nothing in the title or text says entry level. */
  | 'experience-unstated';

export type NormalizeResult =
  | { ok: true; posting: Posting; sectorGuessed: boolean }
  | { ok: false; reason: RejectReason }
  | { ok: false; reason: 'needs-review'; review: ReviewReason; posting: Posting; sectorGuessed: boolean };

/** On-site apartment leasing seats: Leasing Professional, Leasing & Sales Consultant, Community Assistant. */
const ONSITE_LEASING = /\bleasing\b.*\b(consultant|agent|professional|specialist|representative|coordinator|associate)\b|\bcommunity assistant\b/i;

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
  // An 'Analyst' title can still require three years; the description says so.
  // Only the required bar counts: "1-2 years required, 3 preferred" stays.
  const experience = experienceRequirement(description);
  if (experience.required !== null && experience.required > MAX_YEARS) return { ok: false, reason: 'over-experience' };
  // A bank's teller or a real estate firm's IT seat is not a CRE job.
  if (creRelevance(role, description, Boolean(raw.creOnly)) === 'off-topic') return { ok: false, reason: 'off-topic' };
  const guess = raw.sector ? { sector: raw.sector } : classifySector(role, description);

  const posting: Posting = {
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
    source: provenance(raw.ats),
    ...(raw.sourceId ? { sourceId: raw.sourceId } : {})
  };
  const sectorGuessed = guess.sector === null;

  // No required figure: publish only a seat that plainly is entry level. A
  // generic 'Leasing Consultant' or 'Accountant' with no stated bar waits for
  // review rather than going out on the strength of its title.
  const boardSaysEntry = /\b(entry|junior|graduate|new grad)\b/i.test(raw.level ?? '');
  if (experience.required === null && kind !== 'Internship' && !boardSaysEntry && !entryLevelEvident(role, description)) {
    // Rod (2026-10-11): an on-site apartment leasing seat with no stated bar
    // is not a CRE career listing. Dropped, not held for review.
    if (ONSITE_LEASING.test(role)) return { ok: false, reason: 'off-topic' };
    return { ok: false, reason: 'needs-review', review: 'experience-unstated', posting, sectorGuessed };
  }

  return { ok: true, sectorGuessed, posting };
}

/** A firm's pinned sector and real-estate-only rule, carried onto each of its jobs. */
export function forFirm(firm: Pick<FirmRow, 'sector' | 'creOnly'>, jobs: RawJob[]): RawJob[] {
  if (!firm.sector && !firm.creOnly) return jobs;
  return jobs.map((job) => ({ ...job, ...(firm.sector ? { sector: firm.sector } : {}), ...(firm.creOnly ? { creOnly: true } : {}) }));
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
    case 'workable':
    case 'ashby':
    case 'smartrecruiters':
      return 'Posted on the firm careers page';
    case 'aggregator':
      return 'Aggregated from a Texas jobs board';
    case 'usajobs':
      return 'Posted on USAJOBS';
  }
}

function collapse(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function collapseBlank(value: string): string {
  return value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
