/* ------------------------------------------------------------------ */
/* Bootstrap codec – the fixed, universal standard                      */
/* ------------------------------------------------------------------ */

import { InvalidHashError } from './errors.js';
import { Reader } from './reader.js';
import type { ReaderDefinition } from './reader.js';
import { PACK_DELIM } from './transforms-registry.js';

/**
 * Reader definitions ("keys") are encoded with this codec. It is FIXED:
 * never change it, otherwise all existing keys become invalid. Every key
 * visibly starts with the bootstrap prefix and is thus always decodable –
 * independent of the alphabet of the actual message reader.
 */
export const BOOTSTRAP = new Reader('::bootstrap', {
  alphabet: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', // base62, fixed
  prefix: 'RDR1.', // visible marker: every key starts with this
  checksum: 2,
  canonical: false, // IMPORTANT: preserve field order (schema layout depends on it)
});

/** Reader -> key (reader hash). */
export function exportReader(reader: Reader): string {
  return BOOTSTRAP.encode(reader.definition());
}

/** Key -> reader. */
export function importReader(key: string): Reader {
  const def = BOOTSTRAP.decode<ReaderDefinition>(key);
  return Reader.fromDefinition(def);
}

/** Decode key + message directly ("key + message"). */
export function decodeWith<T = unknown>(key: string, message: string): T {
  return importReader(key).decode<T>(message);
}

/** Self-contained token: KEY$MESSAGE – carries reader and data in one string. */
export function pack(reader: Reader, value: unknown): string {
  return exportReader(reader) + PACK_DELIM + reader.encode(value);
}

/** Split a self-contained token back apart and decode it. */
export function unpack<T = unknown>(token: string): { reader: Reader; value: T } {
  const i = token.indexOf(PACK_DELIM);
  if (i < 0) throw new InvalidHashError(`no "${PACK_DELIM}" separator – not a valid pack token`);
  const reader = importReader(token.slice(0, i));
  const value = reader.decode<T>(token.slice(i + 1));
  return { reader, value };
}
