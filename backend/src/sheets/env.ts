import { SheetsClient, sheetsConfigFromEnv } from './google.js';

/** The configured client, or null with a warning when the settings are missing or unusable. */
export function sheetsClientFromEnv(env: NodeJS.ProcessEnv = process.env): SheetsClient | null {
  try {
    const config = sheetsConfigFromEnv(env);
    return config ? new SheetsClient(config) : null;
  } catch (error) {
    console.warn(`Google Sheets: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
