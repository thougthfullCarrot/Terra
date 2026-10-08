// Temporary: turns Huntington Bank back on in the Sheet's Firms tab after its board passed a re-check. Removed before merge.
import { SheetsClient, sheetsConfigFromEnv, tabRange } from '../src/sheets/google.js';
import { FIRMS_TAB } from '../src/sheets/firms.js';
const config = sheetsConfigFromEnv();
if (!config) throw new Error('Sheet not configured');
const client = new SheetsClient(config);
const values = (await client.read(tabRange(FIRMS_TAB))) as string[][];
const header = (values[0] ?? []).map((c) => c.trim().toLowerCase());
const nameAt = header.indexOf('firm');
const activeAt = header.indexOf('active');
const row = values.findIndex((r) => (r[nameAt] ?? '').trim() === 'Huntington Bank');
console.log('header', header.join('|'), 'row', row + 1, 'was', JSON.stringify(values[row]));
if (row > 0 && activeAt >= 0) {
  const L = String.fromCharCode(65 + activeAt);
  await client.write(tabRange(FIRMS_TAB, `${L}${row + 1}`), [['yes']]);
  console.log(`set ${L}${row + 1} to yes`);
}
