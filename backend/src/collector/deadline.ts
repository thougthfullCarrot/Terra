const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december'
];

const CUE =
  /(?:appl(?:y|ications?)\s+(?:by|close[sd]?|deadline|due)|deadline|closes?\s+on|accepting applications until|submit by)\b/i;

/**
 * Find an application deadline stated in the description, as an ISO date.
 *
 * Most ATS payloads carry no deadline field at all, so this only fires when the
 * text says so near a cue phrase. Returns null otherwise — the UI hides the
 * countdown rather than inventing one.
 */
export function extractDeadline(description: string, now = new Date()): string | null {
  if (!description) return null;
  const text = description.replace(/\s+/g, ' ');

  const cue = CUE.exec(text);
  if (!cue) return null;

  // Only look in the window just after the cue; a date further away is
  // describing something else (a start date, a program term).
  const window = text.slice(cue.index, cue.index + 120);
  const iso = parseDate(window, now);
  if (!iso) return null;

  // A deadline already in the past is stale data, not a deadline.
  return iso >= toIso(now) ? iso : null;
}

function parseDate(text: string, now: Date): string | null {
  const named = new RegExp(
    `\\b(${MONTHS.join('|')}|${MONTHS.map((m) => m.slice(0, 3)).join('|')})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`,
    'i'
  ).exec(text);
  if (named) {
    const month = MONTHS.findIndex((m) => m.startsWith(named[1]!.toLowerCase()));
    const day = Number(named[2]);
    const year = named[3] ? Number(named[3]) : inferYear(month, day, now);
    return build(year, month, day);
  }

  const numeric = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(text);
  if (numeric) {
    const month = Number(numeric[1]) - 1;
    const day = Number(numeric[2]);
    const rawYear = numeric[3] ? Number(numeric[3]) : inferYear(month, day, now);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    return build(year, month, day);
  }

  return null;
}

/** A bare 'October 3' means the next October 3 that has not passed. */
function inferYear(month: number, day: number, now: Date): number {
  const year = now.getUTCFullYear();
  const candidate = Date.UTC(year, month, day);
  return candidate >= Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    ? year
    : year + 1;
}

function build(year: number, month: number, day: number): string | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return toIso(date);
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
