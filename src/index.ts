/**
 * dresscodec
 * --------------------------------------------------------------------------
 * Reversible codec: JSON object <-> compact string ("hash").
 *
 * IMPORTANT: This is NOT a cryptographic digest. The "hash" is a lossless,
 * reversible encoding – meant for presets, seeds, themes, shareable config
 * strings. Whoever knows the alphabet can decode.
 *
 * Core idea:
 *   value -> serializer -> bytes -> [transforms] -> (+ checksum)
 *         -> base-N encode with reader alphabet (or fixed format) -> string
 *
 * A "reader" defines the character set (alphabet). From it derive the bits per
 * character and thus the maximum length. Multiple readers can coexist in a
 * Dresscodec registry; decode() detects the reader automatically by prefix or
 * by a valid checksum.
 */

export { InvalidHashError } from './errors.js';

export type { Transform } from './transforms-registry.js';
export {
  registerTransform,
  resolveTransform,
  registeredTransforms,
  PACK_DELIM,
} from './transforms-registry.js';

export type { Serializer } from './serializer.js';
export {
  registerSerializer,
  textSerializer,
  bytesSerializer,
} from './serializer.js';

export type { Schema, SchemaType } from './schema.js';
export { schemaSerializer } from './schema.js';

export type { CompiledFormat } from './format.js';
export { compileFormat } from './format.js';

export type { ReaderOptions, ReaderDefinition } from './reader.js';
export { Reader } from './reader.js';

export type { EncodeStats } from './registry.js';
export { Dresscodec } from './registry.js';
/** @deprecated Renamed to `Dresscodec`. Kept as an alias for compatibility. */
export { Dresscodec as JsonHash } from './registry.js';

export {
  BOOTSTRAP,
  exportReader,
  importReader,
  decodeWith,
  pack,
  unpack,
} from './bootstrap.js';

export { ALPHABETS, createReader } from './presets.js';
