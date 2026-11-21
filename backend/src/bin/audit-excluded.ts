/**
 * Look through the board postings the filters left out for ones that may be
 * missed matches, so filter changes are argued from real postings.
 *
 *   npm run audit:excluded -- <excluded.json>     # written by export-site --excluded
 *
 * Flags, per rejection reason:
 *   not-texas        a Texas place, suburb or "remote (Texas)" in the description
 *                    or a later location segment the resolver did not pick up
 *   not-entry-level  a title with a first-seat word the title gate does not know
 *   over-experience  a description that also says 0-2 years, "or equivalent",
 *                    "preferred" next to the figure that excluded it, or a degree
 *                    in place of years
 *   off-topic        a CRE word in the title (lease, property, title, escrow...)
 *
 * It only reads and prints. Nothing it flags is published.
 */
import { readFile } from 'node:fs/promises';
import { experienceRequirement } from '../collector/experience.js';
import { resolveCity } from '../collector/texas.js';
import type { ExcludedJob } from '../collector/run.js';

const PER_FLAG = Number(process.env.AUDIT_EXAMPLES ?? 8);

const TX_IN_TEXT = /\b(remote[^.\n]{0,40}\b(texas|tx)\b|\b(texas|tx)\b[^.\n]{0,40}remote|must (reside|live) in (texas|tx)|(dallas|houston|austin|san antonio|fort worth)[^.\n]{0,30}(office|metro|area|based))/i;
const FIRST_SEAT = /\b(i|1|level i|level 1|trainee|apprentice|assistant|coordinator|associate|analyst|specialist|representative|technician|clerk|processor|administrator|estimator|project engineer|field engineer|assistant project manager|assistant superintendent|marketing coordinator)\b/i;
const SOFT_YEARS = /\b(0\s*[-–to]+\s*[12]|1\s*[-–to]+\s*2|or equivalent|preferred|a plus|bachelor'?s degree (or|and\/or) (equivalent )?(work )?experience|recent (college )?graduate|new grad)/i;
const CRE_WORD = /\b(lease|leasing|property|properties|real estate|title|escrow|closing|appraisal|apprais|valuation|acquisition|development|construction|land|asset management|underwrit|loan|mortgage|commercial real estate|cre|tenant|facilities)\b/i;

interface Flagged {
  job: ExcludedJob;
  why: string;
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) throw new Error('usage: audit:excluded <excluded.json>');
  const jobs = JSON.parse(await readFile(path, 'utf8')) as ExcludedJob[];

  const byReason = new Map<string, number>();
  for (const job of jobs) byReason.set(job.reason, (byReason.get(job.reason) ?? 0) + 1);

  const flags = new Map<string, Flagged[]>();
  const add = (name: string, job: ExcludedJob, why: string) => {
    const list = flags.get(name) ?? [];
    list.push({ job, why });
    flags.set(name, list);
  };

  for (const job of jobs) {
    const text = job.description;
    if (job.reason === 'not-texas') {
      // A later location segment or the description naming a Texas place.
      const segments = job.location.split(/[;|]/).map((s) => s.trim()).filter(Boolean);
      const second = segments.slice(1).map(resolveCity).find(Boolean);
      if (second) add('not-texas: Texas office in a later location segment', job, `segment -> ${second}`);
      else if (TX_IN_TEXT.test(text)) add('not-texas: description says remote in Texas or names a Texas office', job, TX_IN_TEXT.exec(text)![0].slice(0, 80));
      else if (/\bremote\b/i.test(job.location) && /\b(us|usa|united states|nationwide|anywhere)\b/i.test(job.location + ' ' + text.slice(0, 600))) add('not-texas: US-wide remote (Texas-eligible?)', job, job.location);
    } else if (job.reason === 'not-entry-level') {
      if (FIRST_SEAT.test(job.role) && !/\b(senior|sr|manager|director|lead|principal|vp|ii|iii)\b/i.test(job.role)) add('not-entry-level: first-seat title word the gate does not know', job, FIRST_SEAT.exec(job.role)![0]);
      else {
        const need = experienceRequirement(text);
        if (need.required !== null && need.required <= 2) add('not-entry-level: title rejected but description asks 0-2 years', job, `required ${need.required}`);
      }
    } else if (job.reason === 'over-experience') {
      const need = experienceRequirement(text);
      const soft = SOFT_YEARS.exec(text);
      if (soft) add('over-experience: description also softens the bar', job, `required ${need.required}; "${soft[0]}"`);
    } else if (job.reason === 'off-topic') {
      if (CRE_WORD.test(job.role)) add('off-topic: CRE word in the title', job, CRE_WORD.exec(job.role)![0]);
    }
  }

  console.log(`Excluded board postings audited: ${jobs.length} (${[...byReason].map(([r, n]) => `${r} ${n}`).join(', ')})`);
  for (const [name, list] of [...flags].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\nAUDIT ${name}: ${list.length}`);
    for (const { job, why } of list.slice(0, PER_FLAG)) {
      console.log(`AUDIT   ${job.role} | ${job.firm} | ${job.location.slice(0, 70)} | ${why} | ${job.url}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
