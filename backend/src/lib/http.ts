export class HttpError extends Error {
  constructor(
    override readonly message: string,
    readonly status: number,
    readonly url: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface FetchJsonOptions {
  timeoutMs?: number;
  retries?: number;
  /** Injected in tests; defaults to the platform fetch. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** First retry delay; doubles per attempt. Lowered in tests. */
  baseDelayMs?: number;
}

const USER_AGENT = 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)';

/**
 * GET a JSON document with a timeout and bounded retries.
 *
 * Retries cover timeouts, network errors, 429, and 5xx. A 404 is not retried:
 * on an ATS board that means a wrong slug, and hammering it will not fix the
 * firm list.
 */
export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const { timeoutMs = 15_000, retries = 2, fetchImpl = fetch, baseDelayMs = 1000 } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
        signal: options.signal ?? controller.signal
      });

      if (!response.ok) {
        const error = new HttpError(
          `GET ${url} returned ${response.status}`,
          response.status,
          url
        );
        if (!retryable(response.status) || attempt === retries) throw error;
        lastError = error;
      } else {
        return (await response.json()) as T;
      }
    } catch (error) {
      if (error instanceof HttpError && !retryable(error.status)) throw error;
      if (attempt === retries) throw error;
      lastError = error;
    } finally {
      clearTimeout(timer);
    }

    await delay(backoffMs(attempt, baseDelayMs));
  }

  throw lastError instanceof Error ? lastError : new Error(`GET ${url} failed`);
}

function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/** 1s, 2s, 4s … with a little jitter so 30 firms do not retry in lockstep. */
function backoffMs(attempt: number, base: number): number {
  return 2 ** attempt * base + Math.floor(Math.random() * (base / 4));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
