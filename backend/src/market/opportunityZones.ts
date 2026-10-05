import { fetchJson, type FetchJsonOptions } from '../lib/http.js';
import type { Metro } from './metros.js';

/**
 * Qualified Opportunity Zones: census tracts where investing capital gains
 * defers and cuts federal tax on them. HUD publishes the designated tracts
 * as a free map service; this counts them per Texas county and adds up each
 * metro's counties. The current zones were designated in 2018.
 */

export const OZ_COUNT_URL =
  'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Opportunity_Zones/FeatureServer/13/query?' +
  new URLSearchParams({
    where: "STATE='48'",
    groupByFieldsForStatistics: 'COUNTY',
    outStatistics: JSON.stringify([{ statisticType: 'count', onStatisticField: 'OBJECTID', outStatisticFieldName: 'n' }]),
    f: 'json'
  }).toString();

interface StatsResponse {
  features?: { attributes: Record<string, unknown> }[];
  error?: { message?: string };
}

/** Tracts per three-digit county code. */
export function parseCountyCounts(body: StatsResponse): Map<string, number> {
  if (body.error) throw new Error(`Opportunity Zones: ${body.error.message ?? 'error'}`);
  const out = new Map<string, number>();
  for (const { attributes } of body.features ?? []) {
    const county = String(attributes.COUNTY ?? '');
    const n = Number(attributes.n);
    if (/^\d{3}$/.test(county) && Number.isFinite(n)) out.set(county, n);
  }
  return out;
}

export function metroZoneCount(metro: Metro, counts: Map<string, number>): number {
  return metro.counties.reduce((sum, county) => sum + (counts.get(county) ?? 0), 0);
}

export async function fetchOpportunityZones(options: FetchJsonOptions = {}): Promise<Map<string, number>> {
  const counts = parseCountyCounts(await fetchJson<StatsResponse>(OZ_COUNT_URL, { timeoutMs: 60_000, ...options }));
  if (!counts.size) throw new Error('Opportunity Zones: no Texas tracts returned');
  return counts;
}
