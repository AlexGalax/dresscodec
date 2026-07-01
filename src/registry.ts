/* ------------------------------------------------------------------ */
/* Dresscodec – registry for multiple readers                           */
/* ------------------------------------------------------------------ */

import { InvalidHashError } from './errors.js';
import { Reader } from './reader.js';
import type { ReaderOptions } from './reader.js';
import { exportReader, importReader, pack, unpack } from './bootstrap.js';

export interface EncodeStats {
  reader: string;
  bytes: number; // UTF-8 bytes of the (canonical) JSON
  chars: number; // actual hash length
  maxChars: number; // upper bound for this byte count
  bitsPerChar: number;
  base: number;
}

export class Dresscodec {
  private readers = new Map<string, Reader>();
  private defaultName: string | null = null;

  /** Define a reader. The first reader defined becomes the default. */
  define(name: string, opts: ReaderOptions | Reader, makeDefault = false): Reader {
    const reader = opts instanceof Reader ? opts : new Reader(name, opts);
    this.readers.set(name, reader);
    if (makeDefault || this.defaultName === null) this.defaultName = name;
    return reader;
  }

  reader(name?: string): Reader {
    const key = name ?? this.defaultName;
    if (!key) throw new Error('no reader defined');
    const r = this.readers.get(key);
    if (!r) throw new Error(`reader "${key}" not found`);
    return r;
  }

  setDefault(name: string): void {
    if (!this.readers.has(name)) throw new Error(`reader "${name}" not found`);
    this.defaultName = name;
  }

  list(): string[] {
    return [...this.readers.keys()];
  }

  encode(value: unknown, reader?: string, targetLength?: number): string {
    return this.reader(reader).encode(value, targetLength);
  }

  /**
   * Decode. With a reader name: exactly that reader.
   * Without: auto-detect – first by prefix, then by valid checksum.
   */
  decode<T = unknown>(hash: string, reader?: string): T {
    if (reader) return this.reader(reader).decode<T>(hash);

    // 1) Prefer prefix match (unambiguous & fast)
    const prefixed = [...this.readers.values()].filter(
      (r) => r.prefix && hash.startsWith(r.prefix),
    );
    for (const r of prefixed) {
      try {
        return r.decode<T>(hash);
      } catch {
        /* next */
      }
    }

    // 2) Checksum discriminator
    for (const r of this.readers.values()) {
      if (r.prefix) continue; // already tried above
      try {
        return r.decode<T>(hash);
      } catch {
        /* next */
      }
    }
    throw new InvalidHashError('no matching reader found for this hash');
  }

  /** Which reader would decode this hash? (or null) */
  detect(hash: string): string | null {
    for (const r of this.readers.values()) if (r.canDecode(hash)) return r.name;
    return null;
  }

  stats(value: unknown, reader?: string): EncodeStats {
    const r = this.reader(reader);
    const bytes = r.serializedLength(value);
    return {
      reader: r.name,
      bytes,
      chars: [...r.encode(value)].length,
      maxChars: r.maxLengthForBytes(bytes),
      bitsPerChar: Number(r.bitsPerChar.toFixed(4)),
      base: r.base,
    };
  }

  /** Export a reader as a key (bootstrap-encoded). */
  exportReader(name: string): string {
    return exportReader(this.reader(name));
  }

  /** Import a reader from a key and (optionally) add it to the registry. */
  importReader(key: string, makeDefault = false): Reader {
    const r = importReader(key);
    return this.define(r.name, r, makeDefault);
  }

  /** Self-contained token (KEY$MESSAGE). */
  pack(value: unknown, reader?: string): string {
    return pack(this.reader(reader), value);
  }

  /** Split a token, decode it; the reader is added to the registry. */
  unpack<T = unknown>(token: string): { reader: string; value: T } {
    const { reader, value } = unpack<T>(token);
    this.define(reader.name, reader);
    return { reader: reader.name, value };
  }
}
