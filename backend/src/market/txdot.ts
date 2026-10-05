import { fetchJson, type FetchJsonOptions } from '../lib/http.js';

/**
 * State highway projects from TxDOT's Project Tracker map service (free, no
 * key): every active project with its district, estimated construction cost
 * and phase. New and widened highways lift land values and open sites, so the
 * dollars each district has lined up are a read on where access is improving.
 */

const SERVICE = 'https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_Projects_Info/FeatureServer/0/query';

export const TXDOT_STATS_URL =
  `${SERVICE}?` +
  new URLSearchParams({
    where: "PROJ_STAT='Active'",
    groupByFieldsForStatistics: 'DISTRICT_NAME,PT_PHASE',
    outStatistics: JSON.stringify([
      { statisticType: 'sum', onStatisticField: 'EST_CONSTRUCTION_COST', outStatisticFieldName: 'cost' },
      { statisticType: 'count', onStatisticField: 'OBJECTID', outStatisticFieldName: 'n' }
    ]),
    f: 'json'
  }).toString();

export interface DistrictProjects {
  /** Estimated cost of projects under construction now. */
  underway: number;
  underwayCount: number;
  /** Estimated cost of projects set to start construction within four years. */
  planned: number;
  plannedCount: number;
}

interface StatsResponse {
  features?: { attributes: Record<string, unknown> }[];
  error?: { message?: string };
}

/** Which bucket a Project Tracker phase belongs in, or null for ones counted in neither (finished, long-range). */
export function phaseBucket(phase: string): 'underway' | 'planned' | null {
  if (/under\s*construction|construction\s+(underway|in progress|has begun|began)/i.test(phase)) return 'underway';
  if (/construction begins within/i.test(phase)) return 'planned';
  return null;
}

export function parseDistrictProjects(body: StatsResponse): { districts: Map<string, DistrictProjects>; phases: string[] } {
  if (body.error) throw new Error(`TxDOT: ${body.error.message ?? 'error'}`);
  const districts = new Map<string, DistrictProjects>();
  const phases = new Set<string>();
  for (const { attributes } of body.features ?? []) {
    const district = String(attributes.DISTRICT_NAME ?? '').trim();
    const phase = String(attributes.PT_PHASE ?? '').trim();
    phases.add(phase || '(none)');
    const bucket = phaseBucket(phase);
    if (!district || !bucket) continue;
    const entry = districts.get(district) ?? { underway: 0, underwayCount: 0, planned: 0, plannedCount: 0 };
    entry[bucket] += Number(attributes.cost) || 0;
    entry[`${bucket}Count`] += Number(attributes.n) || 0;
    districts.set(district, entry);
  }
  return { districts, phases: [...phases].sort() };
}

export async function fetchTxdot(options: FetchJsonOptions = {}): Promise<{ districts: Map<string, DistrictProjects>; phases: string[] }> {
  const result = parseDistrictProjects(await fetchJson<StatsResponse>(TXDOT_STATS_URL, { timeoutMs: 60_000, ...options }));
  if (!result.districts.size) throw new Error(`TxDOT: no projects matched a phase (phases seen: ${result.phases.join('; ')})`);
  return result;
}
