/**
 * Just enough CSV for the market data files: comma-separated, fields
 * optionally double-quoted with "" for a quote inside. No field in them spans
 * lines, so a file splits on newlines first.
 */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      out.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  out.push(field.replace(/\r$/, ''));
  return out;
}

export function csvLines(text: string): string[] {
  return text.split('\n').filter((line) => line.trim());
}

/** A number from a CSV field, or null for blank, "NA" and the like. */
export function csvNumber(field: string | undefined): number | null {
  if (field == null || !field.trim()) return null;
  const value = Number(field.trim());
  return Number.isFinite(value) ? value : null;
}

/** A month's value and the same month a year earlier, from a wide row of monthly columns. */
export interface MonthlyReading {
  value: number;
  yearAgo: number | null;
  /** e.g. "Aug 2026". */
  period: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthName(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`;
}

/**
 * The newest non-blank month in a row whose monthly columns are named by
 * `toMonth` (which returns null for non-month columns), with the value twelve
 * months before it.
 */
export function latestMonthly(
  header: string[],
  row: string[],
  toMonth: (column: string) => { year: number; month: number } | null
): MonthlyReading | null {
  const months = header
    .map((column, index) => ({ index, at: toMonth(column) }))
    .filter((c): c is { index: number; at: { year: number; month: number } } => c.at != null);
  for (let i = months.length - 1; i >= 0; i--) {
    const value = csvNumber(row[months[i]!.index]);
    if (value == null) continue;
    const { year, month } = months[i]!.at;
    const before = months.find((m) => m.at.year === year - 1 && m.at.month === month);
    return { value, yearAgo: before ? csvNumber(row[before.index]) : null, period: monthName(year, month) };
  }
  return null;
}
