// Strict ArcGIS FeatureServer reads for the Raw Land probes. A read either completes, with every
// guard satisfied, or comes back { status: 'incomplete' | 'failed', reason }. Nothing here turns a
// failed, malformed or truncated response into an empty result.
// `get(url)` returns parsed JSON, or { _err } when the request itself failed (HTTP, timeout, parse).

export class ReadError extends Error {}

/** Throws ReadError unless r is a usable query response with a features array. */
export function checkFeatures(r) {
  if (r === null || typeof r !== 'object' || Array.isArray(r)) throw new ReadError('malformed response (not an object)');
  if (r._err) throw new ReadError(`request failed: ${r._err}`);
  if (r.error) throw new ReadError(`service error: ${JSON.stringify(r.error).slice(0, 200)}`);
  if (!Array.isArray(r.features)) throw new ReadError('malformed response (no features array)');
  return r;
}

export function checkCount(r) {
  if (r === null || typeof r !== 'object') throw new ReadError('malformed count response');
  if (r._err) throw new ReadError(`request failed: ${r._err}`);
  if (r.error) throw new ReadError(`service error: ${JSON.stringify(r.error).slice(0, 200)}`);
  if (!Number.isInteger(r.count) || r.count < 0) throw new ReadError('malformed count response (no integer count)');
  return r.count;
}

const exceededOf = (r) => r.exceededTransferLimit === true || r.properties?.exceededTransferLimit === true;
const attrsOf = (f) => f.attributes ?? f.properties ?? null;

/**
 * Keyset paging on OBJECTID (works for attribute and spatial queries alike).
 * buildUrl(lastOid, size) must return a query for rows with OBJECTID > lastOid, ordered by OBJECTID ASC.
 * Guards: response shape, ArcGIS error JSON, unique and strictly increasing OBJECTIDs (cursor
 * progress), an empty page flagged exceededTransferLimit, short pages that still flag the limit
 * (keep reading), an optional page budget (incomplete, never success) and an optional expected count
 * (a mismatch means the source changed or rows were lost: incomplete).
 */
export function pageByOid(get, buildUrl, { size = 2000, maxPages = Infinity, expectCount = null, oidField = 'OBJECTID' } = {}) {
  const features = []; const seen = new Set(); let last = -1, pages = 0;
  const done = (status, reason) => ({ status, reason: reason ?? null, features, pages });
  for (;;) {
    if (pages >= maxPages) return done('incomplete', `page budget of ${maxPages} reached`);
    let r;
    try { r = checkFeatures(get(buildUrl(last, size))); } catch (e) { return done('failed', e.message); }
    pages++;
    const f = r.features, exceeded = exceededOf(r);
    if (!f.length) {
      if (exceeded) return done('failed', 'empty page while transfer limit is set');
      break;
    }
    for (const x of f) {
      const a = attrsOf(x); const oid = a?.[oidField];
      if (!Number.isFinite(oid)) return done('failed', `row without ${oidField}`);
      if (oid <= last) return done('failed', `cursor did not advance (${oid} after ${last})`);
      if (seen.has(oid)) return done('failed', `repeated ${oidField} ${oid}`);
      seen.add(oid); features.push(x); last = oid;
    }
    if (f.length < size && !exceeded) break;
  }
  if (expectCount != null && features.length !== expectCount) return done('incomplete', `read ${features.length} rows, service reported ${expectCount}`);
  return done('complete');
}

export function mustComplete(res, what) {
  if (res.status !== 'complete') throw new ReadError(`${what}: ${res.status} (${res.reason})`);
  return res;
}
