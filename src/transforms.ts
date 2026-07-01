/**
 * dresscodec/transforms
 * --------------------------------------------------------------------------
 * Optional compression transform built on `fflate`. Importing this module
 * self-registers the 'deflate' transform in the transform registry, so a
 * reader with `transforms: ['deflate']` becomes usable (and exportable).
 *
 * `fflate` is an OPTIONAL peer dependency — install it only if you use this:
 *   npm i fflate
 */

import { deflateSync, inflateSync } from 'fflate';
import { registerTransform } from './transforms-registry.js';
import type { Transform } from './transforms-registry.js';

/** A deflate (zlib raw) transform. Matches the original tool's behavior. */
export function deflate(): Transform {
  return {
    encode: (b) => deflateSync(b, { level: 9 }),
    decode: (b) => inflateSync(b),
  };
}

// Self-register on import (side effect). This entry is intentionally NOT
// tree-shaken (see package.json "sideEffects").
registerTransform('deflate', deflate);
