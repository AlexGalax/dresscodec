/* ------------------------------------------------------------------ */
/* Canonical JSON + shared UTF-8 codecs                                 */
/* ------------------------------------------------------------------ */

function sortValue(v: any): any {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) out[k] = sortValue(v[k]);
    return out;
  }
  return v;
}

/** Deterministic JSON string: same data -> same hash. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export const utf8 = new TextEncoder();
export const utf8d = new TextDecoder();
