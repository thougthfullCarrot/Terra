/**
 * Greenhouse returns job content as an HTML string; Lever returns HTML per
 * section. Both need flattening to text before any keyword work, and the list
 * structure has to survive because that is where the requirement bullets are.
 */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  bull: '•'
};

export function stripHtml(html: string): string {
  if (!html) return '';

  return decodeEntities(
    html
      // List items become bullets so extractReqs() can still see the list.
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<\/li>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|h[1-6]|ul|ol|tr)>/gi, '\n')
      .replace(/<(?:script|style)[^>]*>[\s\S]*?<\/(?:script|style)>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    // <li>…</li> opens and closes a line each; collapse the gap so a list reads
    // as consecutive bullets rather than blank-line-separated paragraphs.
    .replace(/\n{2,}(?=- )/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    const key = code.toLowerCase();
    if (key in ENTITIES) return ENTITIES[key] as string;
    if (key.startsWith('#x')) {
      const point = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
    }
    if (key.startsWith('#')) {
      const point = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
    }
    return whole;
  });
}
