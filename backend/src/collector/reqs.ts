/**
 * Requirement bullets shown on the detail screen. Boards put these in a
 * 'Qualifications' or 'What you'll need' section, usually as a list; this pulls
 * that section's items, falling back to any bulleted list in the description.
 *
 * The design shows four bullets and they must stay short, so the result is
 * capped at MAX_BULLETS and over-long lines are dropped rather than truncated
 * mid-sentence.
 */
const MAX_BULLETS = 4;
const MAX_CHARS = 120;

const HEADINGS =
  /^(?:what (?:you'?ll need|we'?re looking for|you bring)|qualifications?|requirements?|who you are|basic qualifications|minimum qualifications|skills? (?:and|&) experience|you (?:have|should have))\b[:\s]*$/i;

const NEXT_SECTION =
  /^(?:what you'?ll do|responsibilities|about (?:us|the (?:role|team))|benefits|compensation|perks|equal opportunity|how to apply|nice to have|preferred)\b/i;

export function extractReqs(description: string): string[] {
  if (!description) return [];
  const lines = description
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const sectioned = fromSection(lines);
  const bullets = sectioned.length ? sectioned : lines.filter(isBullet);

  const cleaned: string[] = [];
  for (const line of bullets) {
    const text = stripMarker(line);
    if (text.length < 8 || text.length > MAX_CHARS) continue;
    if (cleaned.includes(text)) continue;
    cleaned.push(text);
    if (cleaned.length === MAX_BULLETS) break;
  }
  return cleaned;
}

function fromSection(lines: string[]): string[] {
  const start = lines.findIndex((line) => HEADINGS.test(stripMarker(line)));
  if (start === -1) return [];

  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (NEXT_SECTION.test(stripMarker(line))) break;
    if (isBullet(line)) {
      out.push(line);
    } else if (out.length) {
      // A non-bullet paragraph after the list means the section ended.
      break;
    }
  }
  return out;
}

function isBullet(line: string): boolean {
  return /^(?:[-*•●▪–—]|\d+[.)])\s+/.test(line);
}

function stripMarker(line: string): string {
  return line
    .replace(/^(?:[-*•●▪–—]|\d+[.)])\s+/, '')
    .replace(/[.;]+$/, '')
    .trim();
}
