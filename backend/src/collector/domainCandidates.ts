/**
 * Guess a firm's own web domain.
 *
 * Unlike an ATS slug, a domain is largely derivable from the name — firms buy
 * the obvious one. And a wrong guess is self-correcting rather than dangerous:
 * the crawler confirms the site belongs to the firm by looking for its name in
 * the page before trusting anything it finds there.
 */
const SUFFIXES = new Set([
  'inc',
  'llc',
  'lp',
  'company',
  'companies',
  'corporation',
  'corp',
  'the'
]);

export function domainCandidates(firm: string, limit = 5): string[] {
  const words = firm
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[.'’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !SUFFIXES.has(word));

  if (!words.length) return [];

  const out: string[] = [];
  const add = (name: string) => {
    const domain = `${name}.com`;
    if (name.length > 2 && !out.includes(domain)) out.push(domain);
  };

  add(words.join(''));
  // Firms routinely drop a generic tail from the domain: Griffin Partners is
  // griffinpartners.com, but Stream Realty Partners is streamrealty.com.
  if (words.length > 2) add(words.slice(0, 2).join(''));
  if (words.length > 1) add(words[0] as string);
  add(words.join('-'));
  if (words.length > 2) add(words.map((word) => word[0]).join(''));

  return out.slice(0, limit);
}
