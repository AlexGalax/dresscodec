import { T as Transform } from './transforms-registry-BeOofHXJ.cjs';
export { P as PACK_DELIM, r as registerTransform, a as registeredTransforms, b as resolveTransform } from './transforms-registry-BeOofHXJ.cjs';

/** Thrown on any decode/prefix/checksum/character/format failure. */
declare class InvalidHashError extends Error {
    constructor(msg: string);
}

interface Serializer {
    serialize(value: unknown): Uint8Array;
    deserialize(bytes: Uint8Array): unknown;
}
/** Any string <-> UTF-8 bytes. */
declare const textSerializer: Serializer;
/** Hex string <-> raw bytes (for IDs, hashes, keys, arbitrary binary data). */
declare const bytesSerializer: Serializer;
declare function registerSerializer(name: string, s: Serializer): void;

/**
 * Schema types. String shorthands, nested objects, or [T] for arrays.
 *   "u8" "u16" "u32" "uv"      unsigned (fixed / varint)
 *   "i8" "i16" "i32" "iv"      signed (fixed / zigzag-varint)
 *   "f32" "f64"                IEEE float
 *   "unorm8" "unorm16"         0..1 quantized (1/2 bytes) – lossy
 *   "snorm8"                   -1..1 quantized (1 byte)   – lossy
 *   "bool"                     1 byte
 *   "enum:a,b,c"               index into the list (varint)
 *   "str"                      varint length + UTF-8
 *   "json"                     fallback: varint length + canonical JSON
 *   ["u8"]                     array (varint count + elements)
 *   { field: type, ... }       nested struct (field order = schema)
 */
type SchemaType = string | Schema | [SchemaType];
interface Schema {
    [field: string]: SchemaType;
}
declare function schemaSerializer(schema: Schema): Serializer;

interface FormatSlot {
    lit?: string;
    symbols?: string[];
}
interface CompiledFormat {
    pattern: string;
    slots: FormatSlot[];
    dataSymbols: string[][];
    capacity: bigint;
    bits: number;
    length: number;
}
/** Restrictive regex -> fixed format. Supports: [classes], \d \w, (groups), {n}, literals, \-escapes. */
declare function compileFormat(pattern: string): CompiledFormat;

interface ReaderOptions {
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
declare class Reader {
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
    readonly serializerName: string | null;
    readonly format: CompiledFormat | null;
    private readonly index;
    constructor(name: string, opts: ReaderOptions);
    /** Bits per character = log2(base) (in format mode: average over data positions). */
    get bitsPerChar(): number;
    /** Upper bound of the hash length (in characters) for N payload bytes. */
    maxLengthForBytes(byteLen: number): number;
    /** Build payload bytes (serializer -> transforms -> + checksum). */
    private buildPayload;
    /** Size of the raw data in bytes (after serializer, before transforms/checksum). */
    serializedLength(value: unknown): number;
    /**
     * Smallest possible length for this value in padding mode (= floor).
     * Cannot go below it (lossless codec).
     */
    floorLengthFor(value: unknown): number;
    /**
     * Allowed length range for the slider, depending on the concrete value.
     * min = max(floor, reader.minLength), max = reader.maxLength (or null = open).
     */
    lengthRange(value: unknown): {
        min: number;
        max: number | null;
        floor: number;
    };
    /**
     * Encode. Optional targetLength pads exactly to this character count
     * (only in padding mode or when targetLength is set). Throws when the data
     * does not fit into maxLength.
     */
    encode(value: unknown, targetLength?: number): string;
    /** Decode. Throws InvalidHashError on prefix/character/checksum errors. */
    decode<T = unknown>(hash: string): T;
    /** Stable check whether a string is decodable with this reader. */
    canDecode(hash: string): boolean;
    /**
     * Portable definition of this reader (for serialization as a key).
     * Throws if it contains an anonymous inline transform.
     */
    definition(): ReaderDefinition;
    /** Reconstruct a reader from a definition (transforms via registry). */
    static fromDefinition(def: ReaderDefinition): Reader;
    info(): {
        name: string;
        base: number;
        bitsPerChar: number;
        prefix: string;
        checksum: number;
        canonical: boolean;
        transforms: string[];
        minLength: number | null;
        maxLength: number | null;
        schema: Schema | null;
        serializer: string;
        pattern: string | null;
        capacityBits: number | null;
    };
}
/** Serializable reader definition (contents of a reader key). */
interface ReaderDefinition {
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

interface EncodeStats {
    reader: string;
    bytes: number;
    chars: number;
    maxChars: number;
    bitsPerChar: number;
    base: number;
}
declare class Dresscodec {
    private readers;
    private defaultName;
    /** Define a reader. The first reader defined becomes the default. */
    define(name: string, opts: ReaderOptions | Reader, makeDefault?: boolean): Reader;
    reader(name?: string): Reader;
    setDefault(name: string): void;
    list(): string[];
    encode(value: unknown, reader?: string, targetLength?: number): string;
    /**
     * Decode. With a reader name: exactly that reader.
     * Without: auto-detect – first by prefix, then by valid checksum.
     */
    decode<T = unknown>(hash: string, reader?: string): T;
    /** Which reader would decode this hash? (or null) */
    detect(hash: string): string | null;
    stats(value: unknown, reader?: string): EncodeStats;
    /** Export a reader as a key (bootstrap-encoded). */
    exportReader(name: string): string;
    /** Import a reader from a key and (optionally) add it to the registry. */
    importReader(key: string, makeDefault?: boolean): Reader;
    /** Self-contained token (KEY$MESSAGE). */
    pack(value: unknown, reader?: string): string;
    /** Split a token, decode it; the reader is added to the registry. */
    unpack<T = unknown>(token: string): {
        reader: string;
        value: T;
    };
}

/**
 * Reader definitions ("keys") are encoded with this codec. It is FIXED:
 * never change it, otherwise all existing keys become invalid. Every key
 * visibly starts with the bootstrap prefix and is thus always decodable –
 * independent of the alphabet of the actual message reader.
 */
declare const BOOTSTRAP: Reader;
/** Reader -> key (reader hash). */
declare function exportReader(reader: Reader): string;
/** Key -> reader. */
declare function importReader(key: string): Reader;
/** Decode key + message directly ("key + message"). */
declare function decodeWith<T = unknown>(key: string, message: string): T;
/** Self-contained token: KEY$MESSAGE – carries reader and data in one string. */
declare function pack(reader: Reader, value: unknown): string;
/** Split a self-contained token back apart and decode it. */
declare function unpack<T = unknown>(token: string): {
    reader: Reader;
    value: T;
};

declare const ALPHABETS: {
    readonly base16: "0123456789abcdef";
    readonly base32: "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    readonly base58: "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    readonly base62: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    readonly base64url: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    readonly runic: "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ";
    readonly geometric: "◇◈◆◊○●◐◑◒◓□■▢▣△▲▽▼◁◀▷▶★☆◢◣◤◥⬟⬢⬡⬠";
};
/** Convenience: standalone codec without a registry. */
declare function createReader(name: string, opts: ReaderOptions): Reader;

export { ALPHABETS, BOOTSTRAP, type CompiledFormat, Dresscodec, type EncodeStats, InvalidHashError, Dresscodec as JsonHash, Reader, type ReaderDefinition, type ReaderOptions, type Schema, type SchemaType, type Serializer, Transform, bytesSerializer, compileFormat, createReader, decodeWith, exportReader, importReader, pack, registerSerializer, schemaSerializer, textSerializer, unpack };
