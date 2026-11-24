import { AsyncLocalStorage } from 'node:async_hooks';

/** Counts retried requests for whoever runs inside it (one job board, for the run report). */
export const requestTally = new AsyncLocalStorage<{ retries: number; requests: number }>();

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

/**
 * Hosts that share one rate limit across tenants. Every Workday career site
 * sits behind the same edge, and on 2026-11-21 a PR build reading 27 Workday
 * boards four at a time (three details each) got HTTP 429 on 20 of them. Each
 * group gets its own cap on requests in flight, and one 429 pauses the whole
 * group (Retry-After, or a backoff) instead of every board retrying into it.
 */
interface HostGroup {
  limit: number;
  active: number;
  queue: (() => void)[];
  pausedUntil: number;
  /** 429 answers seen, for the run report. */
  throttled: number;
  /** Shared pause spent so far, against the budget below. */
  pausedMs: number;
  /**
   * Most shared pause one process may spend. When an edge keeps throttling,
   * pausing on every 429 would stall the build for good (a PR build hit the
   * 30-minute step limit that way), so past the budget a 429 is retried with
   * the plain backoff and then counted as a failed read, as before.
   */
  budgetMs: number;
}

const GROUPS: Record<string, HostGroup> = {};

export function hostGroup(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  if (host.endsWith('.myworkdayjobs.com') || host.endsWith('.myworkdaysite.com')) return 'workday';
  return null;
}

function group(name: string): HostGroup {
  return (GROUPS[name] ??= {
    limit: Math.max(1, Number(process.env[`${name.toUpperCase()}_CONCURRENCY`] ?? 3)),
    active: 0,
    queue: [],
    pausedUntil: 0,
    throttled: 0,
    pausedMs: 0,
    budgetMs: Number(process.env[`${name.toUpperCase()}_PAUSE_BUDGET_MS`] ?? 90_000)
  });
}

/** 429s per host group so far this process (Workday: how often the edge pushed back). */
export function throttleCounts(): Record<string, number> {
  return Object.fromEntries(Object.entries(GROUPS).map(([name, g]) => [name, g.throttled]));
}

/** Shared pause spent per host group, in seconds. */
export function pauseSeconds(): Record<string, number> {
  return Object.fromEntries(Object.entries(GROUPS).map(([name, g]) => [name, Math.round(g.pausedMs / 1000)]));
}

/** For tests: forget every group's state. */
export function resetHostGroups(): void {
  for (const key of Object.keys(GROUPS)) delete GROUPS[key];
}

async function acquire(g: HostGroup): Promise<void> {
  if (g.active < g.limit) {
    g.active++;
  } else {
    await new Promise<void>((resolve) => g.queue.push(resolve));
  }
  const wait = g.pausedUntil - Date.now();
  if (wait > 0) await delay(wait);
}

function release(g: HostGroup): void {
  const next = g.queue.shift();
  if (next) next();
  else g.active--;
}

/** Seconds or an HTTP date, capped at a minute so one header cannot stall a build. */
function retryAfterMs(response: Response, fallback: number): number {
  const value = response.headers?.get?.('retry-after');
  if (!value) return fallback;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : new Date(value).getTime() - Date.now();
  return Math.min(60_000, Math.max(fallback, Number.isFinite(ms) ? ms : fallback));
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

  const groupName = hostGroup(url);
  const gate = groupName ? group(groupName) : null;
  // A shared edge that rate-limits gets more patience: the pause is shared, so
  // a few extra tries cost little and save the board from a partial read.
  let tries = gate ? Math.max(retries, 4) : retries;

  let lastError: unknown;
  for (let attempt = 0; attempt <= tries; attempt++) {
    const tally = requestTally.getStore();
    if (tally) {
      tally.requests++;
      if (attempt > 0) tally.retries++;
    }
    if (gate) await acquire(gate);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let pause = 0;
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
        if (gate && response.status === 429) {
          gate.throttled++;
          const want = retryAfterMs(response, Math.max(3000, backoffMs(attempt, baseDelayMs)));
          // Only the part that extends the current pause is new waiting.
          const extra = Math.max(0, Date.now() + want - Math.max(gate.pausedUntil, Date.now()));
          if (gate.pausedMs + extra <= gate.budgetMs) {
            gate.pausedMs += extra;
            gate.pausedUntil = Math.max(gate.pausedUntil, Date.now() + want);
            pause = want;
          } else {
            tries = Math.min(tries, retries);
          }
        }
        if (!retryable(response.status) || attempt === tries) throw error;
        lastError = error;
      } else {
        return await read(response);
      }
    } catch (error) {
      if (error instanceof HttpError && !retryable(error.status)) throw error;
      if (attempt === tries) throw error;
      lastError = error;
    } finally {
      clearTimeout(timer);
      if (gate) release(gate);
    }

    // A 429 already paused the group; the next acquire waits that out.
    if (!pause) await delay(backoffMs(attempt, baseDelayMs));
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
