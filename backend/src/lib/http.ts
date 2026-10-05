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
  /** Defaults to GET. Workday's career-site API is POST-only. */
  method?: 'GET' | 'POST';
  /** JSON request body; sets content-type and implies POST. */
  body?: unknown;
  /** Defaults to application/json. iCIMS career pages are HTML. */
  accept?: string;
  /** Form fields sent url-encoded, as a browser form posts them; implies POST. */
  form?: Record<string, string>;
  /** Extra request headers. */
  headers?: Record<string, string>;
}

const USER_AGENT = 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)';

/**
 * Fetch a JSON document with a timeout and bounded retries.
 *
 * Retries cover timeouts, network errors, 429, and 5xx. A 404 is not retried:
 * on an ATS board that means a wrong slug, and hammering it will not fix the
 * firm list.
 */
export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  return request(url, options, (response) => response.json() as Promise<T>);
}

/** Same timeout and retry policy as fetchJson, for boards that serve HTML. */
export async function fetchText(url: string, options: FetchJsonOptions = {}): Promise<string> {
  return request(url, { accept: 'text/html', ...options }, (response) => response.text());
}

/** Same policy, for binary downloads such as spreadsheets. */
export async function fetchBuffer(url: string, options: FetchJsonOptions = {}): Promise<Buffer> {
  return request(url, { accept: '*/*', ...options }, async (response) => Buffer.from(await response.arrayBuffer()));
}

async function request<T>(
  url: string,
  options: FetchJsonOptions,
  read: (response: Response) => Promise<T>
): Promise<T> {
  const { timeoutMs = 15_000, retries = 2, fetchImpl = fetch, baseDelayMs = 1000 } = options;

  const method = options.method ?? (options.body === undefined && options.form === undefined ? 'GET' : 'POST');
  const headers: Record<string, string> = {
    accept: options.accept ?? 'application/json',
    'user-agent': USER_AGENT,
    ...options.headers
  };
  let body: string | undefined;
  if (options.form !== undefined) {
    headers['content-type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    body = new URLSearchParams(options.form).toString();
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method,
        headers,
        body,
        signal: options.signal ?? controller.signal
      });

      if (!response.ok) {
        const error = new HttpError(
          `${method} ${url} returned ${response.status}`,
          response.status,
          url
        );
        if (!retryable(response.status) || attempt === retries) throw error;
        lastError = error;
      } else {
        return await read(response);
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

  throw lastError instanceof Error ? lastError : new Error(`${method} ${url} failed`);
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
