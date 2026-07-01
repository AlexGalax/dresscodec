/* ------------------------------------------------------------------ */
/* Transform pipeline (e.g. compression) – synchronous, pluggable       */
/* ------------------------------------------------------------------ */

import { InvalidHashError } from './errors.js';

export interface Transform {
  encode(bytes: Uint8Array): Uint8Array;
  decode(bytes: Uint8Array): Uint8Array;
}

/**
 * So that readers stay portable, transforms are referenced ONLY by name.
 * An implementation must be registered at runtime (e.g. via
 * `import 'dresscodec/transforms'` for 'deflate').
 */
const transformRegistry = new Map<string, () => Transform>();

export function registerTransform(name: string, factory: () => Transform): void {
  transformRegistry.set(name, factory);
}

export function resolveTransform(name: string): Transform {
  const f = transformRegistry.get(name);
  if (!f) throw new InvalidHashError(`transform "${name}" not registered`);
  return f();
}

export function registeredTransforms(): string[] {
  return [...transformRegistry.keys()];
}

/** Reserved delimiter for self-contained tokens (KEY$MESSAGE). */
export const PACK_DELIM = '$';

/** Sentinel byte before the real payload in padding mode (marks data start). */
export const PAD_SENTINEL = 0x01;
