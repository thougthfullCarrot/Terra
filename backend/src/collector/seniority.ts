import type { Kind } from '../types.js';

/** Titles that are senior no matter what else they contain. */
const SENIOR = [
  /\bsenior\b/,
  /\bsr\.?\b/,
  /\blead\b/,
  /\bprincipal\b/,
  /\bdirector\b/,
  /\bhead of\b/,
  /\bvp\b/,
  /\bvice president\b/,
  /\bexecutive\b/,
  /\bchief\b/,
  /\bpartner\b/,
  /\bmanaging\b/,
  /\bstaff (engineer|scientist|architect)\b/,
  // Analyst II / III / IV. A bare digit only counts right after a job word,
  // so 'Analyst 2' is out but 'Class of 2027' and '2 positions' are not.
  /\b(ii|iii|iv|v)\b/,
  /\b(analyst|associate|accountant|appraiser|specialist|coordinator|administrator|consultant|agent|underwriter)\s*(2|3|4)\b/,
  /\blevel\s*[234]\b/,
  // A manager is not a first seat; an assistant manager can be.
  /^(?!.*\b(assistant|trainee|in[- ]training|intern)\b).*\bmanager\b/
];

const INTERN = [
  /\bintern(ship|s)?\b/,
  /\bsummer analyst\b/,
  /\bco-?op\b/,
  /\bapprentice\b/
];

/**
 * Entry-level title signals, per the collector spec: intern, analyst I,
 * associate, coordinator, trainee. Bare 'analyst' is included because in CRE it
 * is overwhelmingly the first-seat title; the SENIOR list above removes the
 * senior and II+ variants before these are consulted.
 */
const ENTRY = [
  /\banalyst\b/,
  /\bassociate\b/,
  /\bcoordinator\b/,
  /\btrainee\b/,
  /\bentry[- ]level\b/,
  /\bjunior\b/,
  /\bjr\.?\b/,
  /\bassistant\b/,
  /\bgraduate\b/,
  /\bnew grad\b/,
  /\brotational\b/,
  // Homebuilder training seats: 'Superintendent in Training', 'Early Career
  // Construction Program'. 'Assistant Superintendent' is already caught above.
  /\bin[- ]training\b/,
  /\bearly[- ]career\b/,
  // CRE first seats whose titles carry none of the words above. They pass the
  // title gate only; the description still has to show 0 to 2 years or an
  // entry-level signal, or the posting goes to review (normalize.ts).
  /\bleasing (consultant|agent|professional|specialist|representative)\b/,
  /\baccountant\b/,
  /\b(property|lease|leasing|portfolio|real estate|closing|loan|title|escrow|contract) administrator\b/,
  /\b(acquisitions?|land|development|research|leasing|lease|title|escrow|closing|valuation|property tax|tax|appraisal|lease administration|due diligence|entitlement|right[- ]of[- ]way|realty|real estate|loan|credit|underwriting|transaction|transaction management|portfolio|investment|asset management) specialist\b/,
  /\bappraiser\b/,
  /\bunderwriter\b/,
  /\bresearcher\b/,
  /\b(property tax|ad valorem|tax) consultant\b/
];

/**
 * Decide whether a posting belongs in the feed, and as what.
 *
 * An explicit seniority field from the board beats the title in both
 * directions: a board that says 'Mid-Senior' is trusted over a title reading
 * 'Analyst', and one that says 'Internship' is trusted over a title that
 * forgot to say so.
 */
export function classifyKind(title: string, level?: string): Kind | null {
  const t = normalize(title);
  const lvl = level ? normalize(level) : '';

  if (lvl) {
    if (INTERN.some((re) => re.test(lvl))) return 'Internship';
    if (/\b(mid|senior|sr|director|executive|lead|principal)\b/.test(lvl)) return null;
    if (/\b(entry|junior|jr|associate|graduate|new grad)\b/.test(lvl)) {
      return INTERN.some((re) => re.test(t)) ? 'Internship' : 'Entry-level';
    }
  }

  if (INTERN.some((re) => re.test(t))) return 'Internship';
  if (SENIOR.some((re) => re.test(t))) return null;
  if (ENTRY.some((re) => re.test(t))) return 'Entry-level';

  return null;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim();
}
