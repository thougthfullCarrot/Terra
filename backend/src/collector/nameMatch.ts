/**
 * Decide whether a job board actually belongs to the firm we were looking for.
 *
 * A board answering 200 at a guessed slug proves a board exists there, not
 * whose it is. Slugs like `lincoln`, `highland` and `integra` belong to
 * whoever registered them first, so without this check a Texas CRE feed
 * quietly fills with insurance and medical-device jobs.
 */

/** Words that appear in half of all company names and identify none of them. */
const FILLER = new Set([
  'the',
  'inc',
  'llc',
  'company',
  'corporation',
  'corp',
  'group',
  'holdings',
  'partners',
  'real',
  'estate',
  'properties',
  'property',
  'capital',
  'realty',
  'advisors',
  'advisory',
  'management',
  'trust',
  'reit'
]);

export function namesMatch(firm: string, owner: string): boolean {
  const a = significant(firm);
  const b = significant(owner);
  if (!a.size || !b.size) return false;

  // Same distinctive words, in any order: 'Lincoln Property Company' and
  // 'Lincoln Property' are the same firm.
  const identical = a.size === b.size && [...a].every((word) => b.has(word));
  if (identical) return true;

  // Otherwise every distinctive word must appear in the board's name, and
  // there must be more than one of them.
  //
  // That second condition is the important one. 'Lincoln Property Company'
  // reduces to the single word 'lincoln', which is also in 'Lincoln Financial
  // Group' and 'Lincoln Electric' — so a one-word overlap proves nothing. Those
  // go to a human instead of being claimed as confirmed.
  return a.size >= 2 && [...a].every((word) => b.has(word));
}

/** A name reduced to the words that actually identify a company. */
export function significant(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !FILLER.has(word))
  );
}
