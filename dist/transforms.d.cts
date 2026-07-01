import { T as Transform } from './transforms-registry-BeOofHXJ.cjs';

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

/** A deflate (zlib raw) transform. Matches the original tool's behavior. */
declare function deflate(): Transform;

export { deflate };
