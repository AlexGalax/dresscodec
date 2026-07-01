/* ------------------------------------------------------------------ */
/* Serializer registry: JSON is just ONE frontend                       */
/* ------------------------------------------------------------------ */

import { InvalidHashError } from './errors.js';
import { canonicalize, utf8, utf8d } from './canonical.js';

export interface Serializer {
  serialize(value: unknown): Uint8Array;
  deserialize(bytes: Uint8Array): unknown;
}

export function jsonSerializer(canonical: boolean): Serializer {
  return {
    serialize: (value) => utf8.encode(canonical ? canonicalize(value) : JSON.stringify(value)),
    deserialize: (bytes) => JSON.parse(utf8d.decode(bytes)),
  };
}

const HEX = '0123456789abcdef';
function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += HEX[x >> 4] + HEX[x & 0xf];
  return s;
}
function hexToBytes(h: string): Uint8Array {
  const s = h.trim().toLowerCase().replace(/[^0-9a-f]/g, '');
  if (s.length % 2) throw new InvalidHashError('hex needs an even length');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

/** Any string <-> UTF-8 bytes. */
export const textSerializer: Serializer = {
  serialize: (value) => utf8.encode(String(value)),
  deserialize: (bytes) => utf8d.decode(bytes),
};

/** Hex string <-> raw bytes (for IDs, hashes, keys, arbitrary binary data). */
export const bytesSerializer: Serializer = {
  serialize: (value) => (value instanceof Uint8Array ? value : hexToBytes(String(value))),
  deserialize: (bytes) => bytesToHex(bytes),
};

const serializerRegistry = new Map<string, Serializer>([
  ['text', textSerializer],
  ['bytes', bytesSerializer],
]);

export function registerSerializer(name: string, s: Serializer): void {
  if (name === 'json') throw new Error('"json" is reserved');
  serializerRegistry.set(name, s);
}

export function resolveSerializer(name: string): Serializer {
  const s = serializerRegistry.get(name);
  if (!s) throw new InvalidHashError(`serializer "${name}" not registered`);
  return s;
}
