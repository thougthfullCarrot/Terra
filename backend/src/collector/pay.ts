/**
 * Pull a display pay string out of a description. The column is display-only —
 * the UI prints it in a meta tag exactly as stored — so the goal is a clean
 * short string ('$24/hr', '$62–70k'), not a parsed number.
 *
 * Returns null when the description does not state pay, which is the common
 * case; the UI simply omits the tag.
 */
export function extractPay(description: string): string | null {
  if (!description) return null;
  const text = description.replace(/\s+/g, ' ');

  return hourlyRange(text) ?? hourly(text) ?? salaryRange(text) ?? salary(text);
}

const AMOUNT = String.raw`\$\s?([\d,]+(?:\.\d{1,2})?)\s*([kK])?`;
const DASH = String.raw`\s*(?:-|–|—|to)\s*`;
const PER_HOUR = String.raw`\s*(?:\/|per\s+)?\s*(?:hr|hour|hourly)\b`;
const PER_YEAR = String.raw`\s*(?:\/|per\s+)?\s*(?:yr|year|annually|annum)\b`;

function hourlyRange(text: string): string | null {
  const m = new RegExp(AMOUNT + DASH + AMOUNT + PER_HOUR, 'i').exec(text);
  if (!m) return null;
  const lo = money(m[1], m[2]);
  const hi = money(m[3], m[4]);
  if (lo === null || hi === null || lo > 200 || hi > 400) return null;
  return `$${trim(lo)}–${trim(hi)}/hr`;
}

function hourly(text: string): string | null {
  const m = new RegExp(AMOUNT + PER_HOUR, 'i').exec(text);
  if (!m) return null;
  const value = money(m[1], m[2]);
  if (value === null || value > 400) return null;
  return `$${trim(value)}/hr`;
}

function salaryRange(text: string): string | null {
  const m = new RegExp(AMOUNT + DASH + AMOUNT + `(?:${PER_YEAR})?`, 'i').exec(text);
  if (!m) return null;
  const lo = money(m[1], m[2]);
  const hi = money(m[3], m[4]);
  if (lo === null || hi === null) return null;
  if (lo < 20000 || hi > 500000) return null;
  return `$${thousands(lo)}–${thousands(hi)}k`;
}

function salary(text: string): string | null {
  const m = new RegExp(AMOUNT + PER_YEAR, 'i').exec(text);
  if (!m) return null;
  const value = money(m[1], m[2]);
  if (value === null || value < 20000 || value > 500000) return null;
  return `$${thousands(value)}k`;
}

/** '62,500' -> 62500, and '70k' -> 70000. */
function money(raw: string | undefined, suffix: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  return suffix ? value * 1000 : value;
}

function thousands(value: number): string {
  return String(Math.round(value / 1000));
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, '');
}
