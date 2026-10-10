// Types for underwrite-xlsx.js, so the backend's tests can import it under strict mode.
import type { Uw } from './underwrite.js';

export function underwriteXlsx(uw: Uw, taxRate?: number | null, city?: string, asOf?: Date): Uint8Array;
export function xlsxName(city: string, asOf?: Date): string;
