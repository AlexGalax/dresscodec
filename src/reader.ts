/* ------------------------------------------------------------------ */
/* Reader                                                               */
/* ------------------------------------------------------------------ */

import { InvalidHashError } from './errors.js';
import { encodeBaseN, decodeBaseN } from './base-n.js';
import { checksumBytes, bytesEqual } from './checksum.js';
import { PAD_SENTINEL } from './transforms-registry.js';
import type { Transform } from './transforms-registry.js';
import { resolveTransform } from './transforms-registry.js';
import { compileFormat, encodeFormat, decodeFormat } from './format.js';
import type { CompiledFormat } from './format.js';
import { schemaSerializer } from './schema.js';
import type { Schema } from './schema.js';
import { jsonSerializer, resolveSerializer } from './serializer.js';
import type { Serializer } from './serializer.js';

export interface ReaderOptions {
  /** Character set. Each symbol = exactly ONE Unicode code point, unique, no whitespace. */
  alphabet?: string;
  /**
   * Fixed format instead of a flat alphabet (regex-like), e.g.
   * "[A-Z]{4}-[A-Z]{4}-[A-Z]{4}-[A-Z]{4}-[A-Z]{4}". Classes provide the symbols
   * per position, literals are separators, {n} a fixed repetition -> fixed length
   * and fixed capacity. Mutually exclusive with `alphabet`.
   */
  pattern?: string;
  /** Optional, visible prefix (branding / unique reader identifier). Default "". */
  prefix?: string;
  /** Checksum bytes (0–4). Default 1. 0 = no integrity check / no auto-detect. */
  checksum?: number;
  /** Sort keys -> deterministic. Default true. */
  canonical?: boolean;
  /**
   * Transform pipeline. Strings are resolved via the transform registry and are
   * portable (serializable in the reader key). Inline transform objects work
   * locally but cannot be exported. Default [].
   */
  transforms?: (string | Transform)[];
  /**
   * Fixed target length in characters. Sets minLength = maxLength = length.
   * Every hash becomes exactly this long (padded).
   */
  length?: number;
  /** Minimum length in characters (padded up to it). Activates padding mode. */
  minLength?: number;
  /** Maximum length in characters (upper bound for slider / padding). Activates padding mode. */
  maxLength?: number;
  /**
   * Schema for binary value encoding instead of JSON. Drops the keys/structure ->
   * dramatically smaller hashes. Lossy for quantized types and for anything
   * outside the schema (the schema is the contract).
   */
  schema?: Schema;
  /**
   * Frontend: how the value becomes bytes. 'json' (default), 'text' (any string),
   * 'bytes' (hex/Uint8Array) or a custom serializer object (usable locally but
   * not exportable). Mutually exclusive with `schema`.
   */
  serializer?: 'json' | 'text' | 'bytes' | string | Serializer;
}

export class Reader {
  readonly name: string;
  readonly symbols: string[];
  readonly base: number;
  readonly prefix: string;
  readonly checksum: number;
  readonly canonical: boolean;
  readonly transforms: Transform[];
  readonly transformSpec: (string | Transform)[];
  readonly minLength: number | null;
  readonly maxLength: number | null;
  readonly padded: boolean;
  readonly schema: Schema | null;
  readonly serializer: Serializer;
  readonly serializerName: string | null; // 'json'|'text'|'bytes'|null(inline); null+schema => schema
  readonly format: CompiledFormat | null;
  private readonly index: Map<string, number>;

  constructor(name: string, opts: ReaderOptions) {
    this.name = name;
    this.format = opts.pattern ? compileFormat(opts.pattern) : null;
    this.symbols = opts.alphabet ? [...opts.alphabet] : [];
    this.base = this.symbols.length;
    this.prefix = opts.prefix ?? '';
    this.checksum = opts.checksum ?? 1;
    this.canonical = opts.canonical ?? true;
    this.transformSpec = opts.transforms ?? [];
    this.transforms = this.transformSpec.map((t) =>
      typeof t === 'string' ? resolveTransform(t) : t,
    );

    // Frontend (serializer): schema | named | inline | json (default)
    this.schema = opts.schema ?? null;
    if (this.schema && opts.serializer)
      throw new Error(`schema and serializer are mutually exclusive (${name})`);
    if (this.schema) {
      this.serializer = schemaSerializer(this.schema);
      this.serializerName = null;
    } else if (typeof opts.serializer === 'object') {
      this.serializer = opts.serializer;
      this.serializerName = null; // inline -> not exportable
    } else if (typeof opts.serializer === 'string' && opts.serializer !== 'json') {
      this.serializer = resolveSerializer(opts.serializer);
      this.serializerName = opts.serializer;
    } else {
      this.serializer = jsonSerializer(this.canonical);
      this.serializerName = 'json';
    }

    // Length/padding configuration (not relevant in format mode: fixed length)
    const fixed = opts.length;
    this.minLength = fixed ?? opts.minLength ?? null;
    this.maxLength = fixed ?? opts.maxLength ?? null;
    this.padded = !this.format && (this.minLength !== null || this.maxLength !== null);
    if (this.minLength !== null && this.maxLength !== null && this.maxLength < this.minLength)
      throw new Error(`maxLength < minLength (${name})`);

    if (!this.format && this.base < 2)
      throw new Error(`alphabet needs >= 2 symbols (or pattern) (${name})`);
    if (this.checksum < 0 || this.checksum > 4)
      throw new Error(`checksum must be 0..4 (${name})`);

    this.index = new Map();
    for (let i = 0; i < this.symbols.length; i++) {
      const s = this.symbols[i];
      if (/\s/u.test(s)) throw new Error(`whitespace in alphabet not allowed (${name})`);
      if (this.index.has(s)) throw new Error(`duplicate symbol "${s}" in alphabet (${name})`);
      this.index.set(s, i);
    }
    if (/\s/u.test(this.prefix)) throw new Error(`whitespace in prefix not allowed (${name})`);
  }

  /** Bits per character = log2(base) (in format mode: average over data positions). */
  get bitsPerChar(): number {
    return this.format ? this.format.bits / this.format.dataSymbols.length : Math.log2(this.base);
  }

  /** Upper bound of the hash length (in characters) for N payload bytes. */
  maxLengthForBytes(byteLen: number): number {
    if (this.format) return this.prefix.length + this.format.length;
    const payload = byteLen + this.checksum;
    const digits = payload === 0 ? 0 : Math.floor((payload * 8) / this.bitsPerChar) + 1;
    return this.prefix.length + digits;
  }

  /** Build payload bytes (serializer -> transforms -> + checksum). */
  private buildPayload(value: unknown): Uint8Array {
    let bytes: Uint8Array = this.serializer.serialize(value);
    for (const t of this.transforms) bytes = t.encode(bytes);
    const cs = checksumBytes(bytes, this.checksum);
    const payload = new Uint8Array(bytes.length + cs.length);
    payload.set(bytes, 0);
    payload.set(cs, bytes.length);
    return payload;
  }

  /** Size of the raw data in bytes (after serializer, before transforms/checksum). */
  serializedLength(value: unknown): number {
    return this.serializer.serialize(value).length;
  }

  /**
   * Smallest possible length for this value in padding mode (= floor).
   * Cannot go below it (lossless codec).
   */
  floorLengthFor(value: unknown): number {
    if (this.format) return this.prefix.length + this.format.length;
    const framed = new Uint8Array(this.buildPayload(value).length + 1);
    framed[0] = PAD_SENTINEL;
    framed.set(this.buildPayload(value), 1);
    return this.prefix.length + encodeBaseN(framed, this.symbols).length;
  }

  /**
   * Allowed length range for the slider, depending on the concrete value.
   * min = max(floor, reader.minLength), max = reader.maxLength (or null = open).
   */
  lengthRange(value: unknown): { min: number; max: number | null; floor: number } {
    if (this.format) {
      const L = this.prefix.length + this.format.length;
      return { min: L, max: L, floor: L };
    }
    const floor = this.floorLengthFor(value);
    const min = Math.max(floor, this.minLength ?? 0);
    return { min, max: this.maxLength, floor };
  }

  /**
   * Encode. Optional targetLength pads exactly to this character count
   * (only in padding mode or when targetLength is set). Throws when the data
   * does not fit into maxLength.
   */
  encode(value: unknown, targetLength?: number): string {
    const payload = this.buildPayload(value);

    // Format mode: fixed layout, fixed capacity (padding/targetLength irrelevant).
    if (this.format) return this.prefix + encodeFormat(payload, this.format);

    // Natural mode (shortest possible) when no padding is active/requested.
    if (!this.padded && targetLength == null) {
      return this.prefix + encodeBaseN(payload, this.symbols);
    }

    // Padding mode: prepend sentinel, then fill up with symbols[0].
    const framed = new Uint8Array(payload.length + 1);
    framed[0] = PAD_SENTINEL;
    framed.set(payload, 1);
    const body = encodeBaseN(framed, this.symbols);
    const floor = this.prefix.length + body.length;

    let want = targetLength ?? this.minLength ?? floor;
    want = Math.max(want, this.minLength ?? 0, floor);
    if (this.maxLength != null) {
      if (floor > this.maxLength)
        throw new InvalidHashError(
          `data does not fit into maxLength=${this.maxLength}; needs at least ${floor} characters.`,
        );
      if (want > this.maxLength) want = this.maxLength;
    }

    const pad = this.symbols[0].repeat(want - this.prefix.length - body.length);
    return this.prefix + pad + body;
  }

  /** Decode. Throws InvalidHashError on prefix/character/checksum errors. */
  decode<T = unknown>(hash: string): T {
    let s = hash.normalize('NFC');
    if (this.prefix) {
      if (!s.startsWith(this.prefix))
        throw new InvalidHashError(`prefix "${this.prefix}" missing`);
      s = s.slice(this.prefix.length);
    }

    let payload: Uint8Array;
    if (this.format) {
      payload = decodeFormat(s, this.format); // sentinel already removed here
    } else {
      payload = decodeBaseN(s, this.symbols, this.index);
      if (this.padded) {
        let i = 0;
        while (i < payload.length && payload[i] === 0) i++;
        if (i >= payload.length || payload[i] !== PAD_SENTINEL)
          throw new InvalidHashError('padding sentinel missing (wrong reader / mode?)');
        payload = payload.subarray(i + 1);
      }
    }

    let data: Uint8Array = payload;
    if (this.checksum > 0) {
      if (payload.length < this.checksum)
        throw new InvalidHashError('hash too short for checksum');
      data = payload.subarray(0, payload.length - this.checksum);
      const got = payload.subarray(payload.length - this.checksum);
      if (!bytesEqual(got, checksumBytes(data, this.checksum)))
        throw new InvalidHashError('checksum invalid (typo / wrong reader?)');
    }

    let bytes: Uint8Array = data;
    for (let i = this.transforms.length - 1; i >= 0; i--)
      bytes = this.transforms[i].decode(bytes);

    return this.serializer.deserialize(bytes) as T;
  }

  /** Stable check whether a string is decodable with this reader. */
  canDecode(hash: string): boolean {
    try {
      this.decode(hash);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Portable definition of this reader (for serialization as a key).
   * Throws if it contains an anonymous inline transform.
   */
  definition(): ReaderDefinition {
    const transforms = this.transformSpec.map((t) => {
      if (typeof t === 'string') return t;
      throw new Error(
        `Reader "${this.name}" contains an anonymous transform and is not exportable. ` +
          `Register it with registerTransform(name, factory) and reference it by name.`,
      );
    });
    if (!this.schema && this.serializerName === null)
      throw new Error(
        `Reader "${this.name}" uses an anonymous serializer and is not exportable. ` +
          `Register it with registerSerializer(name, s) and reference it by name.`,
      );
    return {
      v: 1,
      name: this.name,
      ...(this.format ? { pattern: this.format.pattern } : { alphabet: this.symbols.join('') }),
      prefix: this.prefix,
      checksum: this.checksum,
      canonical: this.canonical,
      transforms,
      ...(this.minLength !== null ? { min: this.minLength } : {}),
      ...(this.maxLength !== null ? { max: this.maxLength } : {}),
      ...(this.schema ? { schema: this.schema } : {}),
      ...(this.serializerName && this.serializerName !== 'json' ? { serializer: this.serializerName } : {}),
    };
  }

  /** Reconstruct a reader from a definition (transforms via registry). */
  static fromDefinition(def: ReaderDefinition): Reader {
    if (def.v !== 1) throw new InvalidHashError(`unknown reader version: ${def.v}`);
    return new Reader(def.name, {
      alphabet: def.alphabet,
      pattern: def.pattern,
      prefix: def.prefix,
      checksum: def.checksum,
      canonical: def.canonical,
      transforms: def.transforms,
      minLength: def.min,
      maxLength: def.max,
      schema: def.schema,
      serializer: def.serializer,
    });
  }

  info() {
    return {
      name: this.name,
      base: this.base,
      bitsPerChar: Number(this.bitsPerChar.toFixed(4)),
      prefix: this.prefix,
      checksum: this.checksum,
      canonical: this.canonical,
      transforms: this.transformSpec.map((t) => (typeof t === 'string' ? t : '<inline>')),
      minLength: this.minLength,
      maxLength: this.maxLength,
      schema: this.schema,
      serializer: this.serializerName ?? (this.schema ? 'schema' : '<inline>'),
      pattern: this.format?.pattern ?? null,
      capacityBits: this.format ? Number(this.format.bits.toFixed(2)) : null,
    };
  }
}

/** Serializable reader definition (contents of a reader key). */
export interface ReaderDefinition {
  v: 1;
  name: string;
  alphabet?: string;
  pattern?: string;
  prefix: string;
  checksum: number;
  canonical: boolean;
  transforms: string[];
  min?: number;
  max?: number;
  schema?: Schema;
  serializer?: string;
}
