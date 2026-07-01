/* ------------------------------------------------------------------ */
/* Serializer: JSON (default) OR schema (binary, tiny)                  */
/* ------------------------------------------------------------------ */

import { InvalidHashError } from './errors.js';
import { canonicalize, utf8, utf8d } from './canonical.js';
import { ByteReader, ByteWriter } from './bytes-io.js';
import type { Serializer } from './serializer.js';

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
export type SchemaType = string | Schema | [SchemaType];
export interface Schema {
  [field: string]: SchemaType;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const clampSym = (x: number) => Math.max(-1, Math.min(1, x));

function encSchema(w: ByteWriter, type: SchemaType, val: any): void {
  if (Array.isArray(type)) {
    if (!Array.isArray(val)) throw new InvalidHashError('array expected');
    w.uvar(val.length);
    for (const x of val) encSchema(w, type[0], x);
    return;
  }
  if (type && typeof type === 'object') {
    if (!val || typeof val !== 'object') throw new InvalidHashError('object expected');
    for (const k of Object.keys(type)) {
      if (!(k in val)) throw new InvalidHashError(`schema field "${k}" missing in value`);
      encSchema(w, (type as Schema)[k], val[k]);
    }
    return;
  }
  const ci = type.indexOf(':');
  const base = ci < 0 ? type : type.slice(0, ci);
  const arg = ci < 0 ? '' : type.slice(ci + 1);
  switch (base) {
    case 'u8': w.uLE(val, 1); break;
    case 'u16': w.uLE(val, 2); break;
    case 'u32': w.uLE(val, 4); break;
    case 'uv': w.uvar(val); break;
    case 'i8': w.iLE(val, 1); break;
    case 'i16': w.iLE(val, 2); break;
    case 'i32': w.iLE(val, 4); break;
    case 'iv': w.ivar(val); break;
    case 'f32': w.f32(val); break;
    case 'f64': w.f64(val); break;
    case 'unorm8': w.uLE(Math.round(clamp01(val) * 255), 1); break;
    case 'unorm16': w.uLE(Math.round(clamp01(val) * 65535), 2); break;
    case 'snorm8': w.iLE(Math.round(clampSym(val) * 127), 1); break;
    case 'bool': w.u8(val ? 1 : 0); break;
    case 'enum': { const o = arg.split(','); const i = o.indexOf(String(val)); if (i < 0) throw new InvalidHashError(`enum: "${val}" not in [${arg}]`); w.uvar(i); break; }
    case 'str': { const b = utf8.encode(String(val)); w.uvar(b.length); w.bytes(b); break; }
    case 'json': { const b = utf8.encode(canonicalize(val)); w.uvar(b.length); w.bytes(b); break; }
    default: throw new InvalidHashError(`unknown schema type: "${type}"`);
  }
}

function decSchema(r: ByteReader, type: SchemaType): any {
  if (Array.isArray(type)) {
    const n = r.uvar();
    const out: any[] = [];
    for (let i = 0; i < n; i++) out.push(decSchema(r, type[0]));
    return out;
  }
  if (type && typeof type === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(type)) out[k] = decSchema(r, (type as Schema)[k]);
    return out;
  }
  const ci = type.indexOf(':');
  const base = ci < 0 ? type : type.slice(0, ci);
  const arg = ci < 0 ? '' : type.slice(ci + 1);
  switch (base) {
    case 'u8': return r.uLE(1);
    case 'u16': return r.uLE(2);
    case 'u32': return r.uLE(4);
    case 'uv': return r.uvar();
    case 'i8': return r.iLE(1);
    case 'i16': return r.iLE(2);
    case 'i32': return r.iLE(4);
    case 'iv': return r.ivar();
    case 'f32': return r.f32();
    case 'f64': return r.f64();
    case 'unorm8': return r.uLE(1) / 255;
    case 'unorm16': return r.uLE(2) / 65535;
    case 'snorm8': return r.iLE(1) / 127;
    case 'bool': return !!r.u8();
    case 'enum': { const o = arg.split(','); const i = r.uvar(); if (i >= o.length) throw new InvalidHashError('enum index out of range'); return o[i]; }
    case 'str': { const n = r.uvar(); return utf8d.decode(r.bytes(n)); }
    case 'json': { const n = r.uvar(); return JSON.parse(utf8d.decode(r.bytes(n))); }
    default: throw new InvalidHashError(`unknown schema type: "${type}"`);
  }
}

export function schemaSerializer(schema: Schema): Serializer {
  return {
    serialize: (value) => { const w = new ByteWriter(); encSchema(w, schema, value); return w.result(); },
    deserialize: (bytes) => decSchema(new ByteReader(bytes), schema),
  };
}
