/**
 * Guess the board slugs a firm might use on Greenhouse or Lever.
 *
 * A slug is not derivable from a firm name — it is whatever the company typed
 * when they set the board up. But the space of plausible values is small and
 * the APIs are free to query, so generating candidates and letting a runner
 * test all of them beats one person guessing once. That is the whole point of
 * the prober: replace a guess with an answer.
 *
 * Candidates come back most-likely first, so a caller can stop early.
 */

/** Words firms drop from their board slug far more often than they keep. */
const SUFFIXES = new Set([
  'company',
  'companies',
  'corporation',
  'corp',
  'inc',
  'llc',
  'lp',
  'group',
  'holdings',
  'partners',
  'properties',
  'property',
  'capital',
  'realty',
  'estate',
  'real',
  'advisors',
  'advisory',
  'management',
  'residential',
  'living',
  'trust',
  'reit',
  'development',
  'ventures',
  'services'
]);

export function slugCandidates(firm: string, limit = 8): string[] {
  const words = tokenize(firm);
  if (!words.length) return [];

  const trimmed = stripSuffixes(words);
  const out: string[] = [];

  const add = (value: string) => {
    const slug = value.replace(/[^a-z0-9-]/g, '');
    // A one-character slug is noise, and duplicates waste a request.
    if (slug.length > 1 && !out.includes(slug)) out.push(slug);
  };

  // Most common first: the whole name run together.
  add(words.join(''));
  add(words.join('-'));

  // Then the name without its corporate furniture.
  if (trimmed.length && trimmed.length !== words.length) {
    add(trimmed.join(''));
    add(trimmed.join('-'));
  }

  // '&' is usually dropped, but some boards spell it out.
  if (/&/.test(firm)) add(tokenize(firm.replace(/&/g, ' and ')).join(''));

  // The distinctive leading word, and the first two together.
  add(words[0] as string);
  if (words.length > 1) add(`${words[0]}${words[1]}`);

  // Acronyms are common for firms known by their initials.
  if (words.length > 2) add(words.map((word) => word[0]).join(''));

  return out.slice(0, limit);
}

function tokenize(firm: string): string[] {
  return firm
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Drop trailing filler words, keeping at least the first. 'Crow Holdings'
 * becomes 'crow'; 'Real Estate' alone would become nothing, so the guard
 * matters.
 */
function stripSuffixes(words: string[]): string[] {
  const out = [...words];
  while (out.length > 1 && SUFFIXES.has(out[out.length - 1] as string)) out.pop();
  return out;
}
