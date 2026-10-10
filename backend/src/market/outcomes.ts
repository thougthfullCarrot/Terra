import { redact } from '../lib/redact.js';
import type { SourceOutcome } from './snapshot.js';

/**
 * The per-source record export-market writes into market.json (refresh):
 * attempt() runs one source, records ok or failed (with a redacted reason)
 * and turns a failure into null so the source's last figures are kept.
 */
export function outcomeLog(secrets: (string | undefined)[], logError: (line: string) => void = () => {}) {
  const outcomes: SourceOutcome[] = [];
  const record = (source: string, status: SourceOutcome['status'], detail?: string) => {
    const entry: SourceOutcome = { source, status };
    if (detail) entry.detail = redact(detail, secrets);
    outcomes.push(entry);
  };
  const attempt = <T>(name: string, run: () => Promise<T>): Promise<T | null> =>
    run().then(
      (result) => {
        record(name, 'ok');
        return result;
      },
      (error: unknown) => {
        const message = redact(error instanceof Error ? error.message : String(error), secrets);
        logError(`${name}: ${message}`);
        record(name, 'failed', message);
        return null;
      }
    );
  /** Mark the latest outcome for a source partial, with what was missing. */
  const partial = (source: string, detail: string) => {
    const entry = [...outcomes].reverse().find((o) => o.source === source);
    if (entry?.status === 'ok') Object.assign(entry, { status: 'partial', detail: redact(detail, secrets) });
  };
  return { outcomes, record, attempt, partial };
}
