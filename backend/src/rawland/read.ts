/**
 * Strict ArcGIS FeatureServer reads for Raw Land. A read either completes with every guard satisfied or comes back
 * { status: 'incomplete' | 'failed', reason }. A failed, malformed, truncated or inconsistent response is never
 * turned into an empty result. Ported from the Phase 0 probe (backend/probe/arcgis-read.mjs, 15 tests).
 * `get(url)` resolves to parsed JSON, or to { _err } when the request itself failed (HTTP, timeout, parse).
 */
export type Get = (url: string) => Promise<unknown>;
export type ReadStatus = 'complete' | 'incomplete' | 'failed';
export interface Feature { attributes?: Record<string, unknown>; properties?: Record<string, unknown>; geometry?: unknown; [k: string]: unknown }
export interface ReadResult { status: ReadStatus; reason: string | null; features: Feature[]; pages: number }

export class ReadError extends Error {}

type Obj = Record<string, unknown>;
const isObj = (r: unknown): r is Obj => r !== null && typeof r === 'object' && !Array.isArray(r);
const errOf = (r: Obj) => (r._err ? `request failed: ${String(r._err)}` : r.error ? `service error: ${JSON.stringify(r.error).slice(0, 200)}` : null);

export function checkFeatures(r: unknown): { features: Feature[]; exceeded: boolean } {
  if (!isObj(r)) throw new ReadError('malformed response (not an object)');
  const e = errOf(r); if (e) throw new ReadError(e);
  if (!Array.isArray(r.features)) throw new ReadError('malformed response (no features array)');
  const props = isObj(r.properties) ? r.properties : {};
  return { features: r.features as Feature[], exceeded: r.exceededTransferLimit === true || props.exceededTransferLimit === true };
}

export function checkCount(r: unknown): number {
  if (!isObj(r)) throw new ReadError('malformed count response');
  const e = errOf(r); if (e) throw new ReadError(e);
  if (!Number.isInteger(r.count) || (r.count as number) < 0) throw new ReadError('malformed count response (no integer count)');
  return r.count as number;
}

/**
 * Keyset paging on OBJECTID. buildUrl(lastOid, size) must ask for rows with OBJECTID > lastOid ordered ascending.
 * Guards: response shape, error JSON, unique and strictly increasing ids, an empty page that still flags the
 * transfer limit, short pages that flag it (keep reading), a page budget (incomplete) and an expected count.
 */
export async function pageByOid(get: Get, buildUrl: (last: number, size: number) => string, { size = 2000, maxPages = Infinity, expectCount = null as number | null, oidField = 'OBJECTID', startAfter = -1, priorRows = 0, onPage = null as ((f: Feature[], last: number) => Promise<void> | void) | null } = {}): Promise<ReadResult & { rows: number; last: number }> {
  // With onPage, each validated page is handed over and not kept, so a county-size read never sits in memory.
  // A resumed read starts after startAfter with priorRows already saved; the expected count covers both.
  const features: Feature[] = []; const seen = new Set<number>(); let last = startAfter, pages = 0, rows = priorRows;
  const done = (status: ReadStatus, reason: string | null = null) => ({ status, reason, features, pages, rows, last });
  for (;;) {
    if (pages >= maxPages) return done('incomplete', `page budget of ${maxPages} reached`);
    let page;
    try { page = checkFeatures(await get(buildUrl(last, size))); } catch (e) { return done('failed', (e as Error).message); }
    pages++;
    if (!page.features.length) { if (page.exceeded) return done('failed', 'empty page while transfer limit is set'); break; }
    for (const f of page.features) {
      const oid = (f.attributes ?? f.properties)?.[oidField];
      if (typeof oid !== 'number' || !Number.isFinite(oid)) return done('failed', `row without ${oidField}`);
      if (oid <= last) return done('failed', `cursor did not advance (${oid} after ${last})`);
      if (seen.has(oid)) return done('failed', `repeated ${oidField} ${oid}`);
      seen.add(oid); last = oid;
    }
    rows += page.features.length;
    if (onPage) await onPage(page.features, last); else features.push(...page.features);
    if (page.features.length < size && !page.exceeded) break;
  }
  if (expectCount != null && rows !== expectCount) return done('incomplete', `read ${rows} rows, service reported ${expectCount}`);
  return done('complete');
}

/** Count-validated read: the count query and every page share one filter. query(params) returns a URL. */
export async function readFiltered(get: Get, query: (p: Record<string, string>) => string, filter: Record<string, string>, { size = 2000, fields = 'OBJECTID', oidField = 'OBJECTID', extra = {} as Record<string, string>, maxPages = Infinity, startAfter = -1, priorRows = 0, onPage = null as ((f: Feature[], last: number) => Promise<void> | void) | null } = {}): Promise<ReadResult & { rows: number; last: number; expectCount: number | null }> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(oidField)) throw new ReadError(`bad object id field ${oidField}`);
  let expectCount: number;
  try { expectCount = checkCount(await get(query({ ...filter, returnCountOnly: 'true' }))); } catch (e) { return { status: 'failed', reason: `count: ${(e as Error).message}`, features: [], pages: 0, rows: priorRows, last: startAfter, expectCount: null }; }
  const where = filter.where ?? '1=1';
  const r = await pageByOid(get, (last, n) => query({ ...filter, where: `(${where}) AND ${oidField} > ${last}`, outFields: fields, orderByFields: `${oidField} ASC`, resultRecordCount: String(n), ...extra }), { size, expectCount, maxPages, oidField, startAfter, priorRows, onPage });
  return { ...r, expectCount };
}

/** The layer's own object id field, from its metadata; a configured field that differs fails the read. */
export function checkOidField(meta: unknown, configured: string): string {
  if (!isObj(meta)) throw new ReadError('malformed layer metadata');
  const e = errOf(meta); if (e) throw new ReadError(e);
  const declared = typeof meta.objectIdField === 'string' ? meta.objectIdField
    : Array.isArray(meta.fields) ? (meta.fields as Obj[]).find((f) => f.type === 'esriFieldTypeOID')?.name as string | undefined : undefined;
  if (!declared) throw new ReadError('layer metadata names no object id field');
  if (declared !== configured) throw new ReadError(`layer object id field is ${declared}, configured ${configured}`);
  return declared;
}

export function mustComplete(r: ReadResult, what: string): ReadResult {
  if (r.status !== 'complete') throw new ReadError(`${what}: ${r.status} (${r.reason})`);
  return r;
}
