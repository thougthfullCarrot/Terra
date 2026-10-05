import { createSign } from 'node:crypto';

/**
 * A minimal Google Sheets client for one spreadsheet, signed in as a Google
 * Cloud service account.
 *
 * Written against the REST API with Node's own crypto rather than the googleapis
 * package: three calls (read a range, write a range, add a tab) do not justify
 * a dependency that size. The Sheets API is free; the service account only
 * sees spreadsheets someone has shared with its address.
 *
 * Every write uses valueInputOption=RAW, so a job title that starts with '='
 * lands as text and never runs as a formula in the owner's sheet.
 */

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface SheetsConfig {
  account: ServiceAccount;
  spreadsheetId: string;
}

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * Read GOOGLE_SERVICE_ACCOUNT_JSON and TERRA_SHEET_ID. Null when either is
 * missing, which callers treat as "Sheets not set up" rather than an error.
 * Throws when they are present but unusable, so a pasted-wrong key says so.
 */
export function sheetsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SheetsConfig | null {
  const json = env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  const sheet = env.TERRA_SHEET_ID?.trim();
  if (!json || !sheet) return null;

  let account: ServiceAccount;
  try {
    account = JSON.parse(json) as ServiceAccount;
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON; paste the whole key file.');
  }
  if (!account.client_email || !account.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON has no client_email or private_key; use the service account key file.');
  }
  return { account, spreadsheetId: spreadsheetId(sheet) };
}

/** Accepts the bare id or the whole URL copied from the browser. */
export function spreadsheetId(value: string): string {
  return /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(value)?.[1] ?? value;
}

/** A1 reference to a whole tab, quoted so names like "Sign-ups" work. */
export function tabRange(title: string, cells = ''): string {
  const quoted = `'${title.replace(/'/g, "''")}'`;
  return cells ? `${quoted}!${cells}` : quoted;
}

export type Cell = string | number | boolean | null;

export class SheetsClient {
  private token: { value: string; expires: number } | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly config: SheetsConfig,
    options: { fetchImpl?: typeof fetch } = {}
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Tab titles in the spreadsheet. Also the cheapest check that sharing worked. */
  async tabs(): Promise<string[]> {
    const body = await this.call<{ sheets?: { properties: { title: string } }[] }>(
      'GET',
      `?fields=${encodeURIComponent('sheets.properties.title')}`
    );
    return (body.sheets ?? []).map((sheet) => sheet.properties.title);
  }

  /** Add any of these tabs that do not exist yet, with the header row frozen. */
  async ensureTabs(titles: string[]): Promise<string[]> {
    const existing = new Set(await this.tabs());
    const missing = titles.filter((title) => !existing.has(title));
    if (missing.length) {
      await this.call('POST', ':batchUpdate', {
        requests: missing.map((title) => ({
          addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } }
        }))
      });
    }
    return missing;
  }

  /** Cell values as displayed text; trailing empty rows and cells are omitted by the API. */
  async read(range: string): Promise<string[][]> {
    const body = await this.call<{ values?: string[][] }>(
      'GET',
      `/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`
    );
    return body.values ?? [];
  }

  async write(range: string, rows: Cell[][]): Promise<void> {
    await this.call('PUT', `/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
      range,
      majorDimension: 'ROWS',
      values: rows.map((row) => row.map((cell) => cell ?? ''))
    });
  }

  async clear(range: string): Promise<void> {
    await this.call('POST', `/values/${encodeURIComponent(range)}:clear`, {});
  }

  /** Replace a whole tab with these rows (header first). */
  async replaceTab(title: string, rows: Cell[][]): Promise<void> {
    await this.clear(tabRange(title));
    await this.write(tabRange(title, 'A1'), rows);
  }

  private async call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${API}/${encodeURIComponent(this.config.spreadsheetId)}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await this.accessToken()}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) throw new Error(`Google Sheets ${method} returned ${response.status}: ${await errorText(response)}`);
    return (await response.json()) as T;
  }

  private async accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.token && this.token.expires - 60 > now) return this.token.value;

    const { account } = this.config;
    const tokenUri = account.token_uri || TOKEN_URI;
    const assertion = signJwt(
      { iss: account.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 },
      account.private_key
    );
    const response = await this.fetchImpl(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) throw new Error(`Google sign-in returned ${response.status}: ${await errorText(response)}`);
    const body = (await response.json()) as { access_token: string; expires_in?: number };
    this.token = { value: body.access_token, expires: now + (body.expires_in ?? 3600) };
    return body.access_token;
  }
}

export function signJwt(claims: Record<string, unknown>, privateKey: string): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(claims)}`;
  // A key pasted through a form can arrive with literal \n instead of newlines.
  const key = privateKey.includes('\\n') ? privateKey.replace(/\\n/g, '\n') : privateKey;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key).toString('base64url');
  return `${unsigned}.${signature}`;
}

/** Google's error message without the whole JSON body, and never the token. */
async function errorText(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const body = JSON.parse(text) as { error?: { message?: string } | string; error_description?: string };
    if (typeof body.error === 'object' && body.error?.message) return body.error.message;
    return body.error_description ?? String(body.error ?? text).slice(0, 200);
  } catch {
    return text.slice(0, 200);
  }
}
