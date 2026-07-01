import { __publicField, resolveTransform, PAD_SENTINEL, InvalidHashError, PACK_DELIM } from './chunk-KTBKDD63.js';
export { InvalidHashError, PACK_DELIM, registerTransform, registeredTransforms, resolveTransform } from './chunk-KTBKDD63.js';

// src/canonical.ts
function sortValue(v) {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortValue(v[k]);
    return out;
  }
  return v;
}
function canonicalize(value) {
  return JSON.stringify(sortValue(value));
}
var utf8 = new TextEncoder();
var utf8d = new TextDecoder();

// src/serializer.ts
function jsonSerializer(canonical) {
  return {
    serialize: (value) => utf8.encode(canonical ? canonicalize(value) : JSON.stringify(value)),
    deserialize: (bytes) => JSON.parse(utf8d.decode(bytes))
  };
}
var HEX = "0123456789abcdef";
function bytesToHex(b) {
  let s = "";
  for (const x of b) s += HEX[x >> 4] + HEX[x & 15];
  return s;
}
function hexToBytes(h) {
  const s = h.trim().toLowerCase().replace(/[^0-9a-f]/g, "");
  if (s.length % 2) throw new InvalidHashError("hex needs an even length");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}
var textSerializer = {
  serialize: (value) => utf8.encode(String(value)),
  deserialize: (bytes) => utf8d.decode(bytes)
};
var bytesSerializer = {
  serialize: (value) => value instanceof Uint8Array ? value : hexToBytes(String(value)),
  deserialize: (bytes) => bytesToHex(bytes)
};
var serializerRegistry = /* @__PURE__ */ new Map([
  ["text", textSerializer],
  ["bytes", bytesSerializer]
]);
function registerSerializer(name, s) {
  if (name === "json") throw new Error('"json" is reserved');
  serializerRegistry.set(name, s);
}
function resolveSerializer(name) {
  const s = serializerRegistry.get(name);
  if (!s) throw new InvalidHashError(`serializer "${name}" not registered`);
  return s;
}

// src/bytes-io.ts
var ByteWriter = class {
  constructor() {
    __publicField(this, "buf", new Uint8Array(64));
    __publicField(this, "len", 0);
    __publicField(this, "dv", new DataView(new ArrayBuffer(8)));
  }
  ensure(n) {
    if (this.len + n > this.buf.length) {
      const b = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
      b.set(this.buf);
      this.buf = b;
    }
  }
  u8(v) {
    this.ensure(1);
    this.buf[this.len++] = v & 255;
  }
  bytes(a) {
    this.ensure(a.length);
    this.buf.set(a, this.len);
    this.len += a.length;
  }
  uLE(v, n) {
    for (let i = 0; i < n; i++) {
      this.u8(v & 255);
      v = Math.floor(v / 256);
    }
  }
  iLE(v, n) {
    if (v < 0) v += 256 ** n;
    this.uLE(v, n);
  }
  uvar(v) {
    v = Math.floor(v);
    if (v < 0) throw new InvalidHashError("uvar < 0");
    do {
      let b = v % 128;
      v = Math.floor(v / 128);
      if (v > 0) b |= 128;
      this.u8(b);
    } while (v > 0);
  }
  ivar(v) {
    this.uvar(v >= 0 ? v * 2 : -v * 2 - 1);
  }
  f32(v) {
    this.dv.setFloat32(0, v, true);
    this.bytes(new Uint8Array(this.dv.buffer, 0, 4));
  }
  f64(v) {
    this.dv.setFloat64(0, v, true);
    this.bytes(new Uint8Array(this.dv.buffer, 0, 8));
  }
  result() {
    return this.buf.subarray(0, this.len);
  }
};
var ByteReader = class {
  constructor(a) {
    __publicField(this, "a", a);
    __publicField(this, "p", 0);
  }
  u8() {
    return this.a[this.p++];
  }
  bytes(n) {
    const s = this.a.subarray(this.p, this.p + n);
    this.p += n;
    return s;
  }
  uLE(n) {
    let v = 0, m = 1;
    for (let i = 0; i < n; i++) {
      v += this.u8() * m;
      m *= 256;
    }
    return v;
  }
  iLE(n) {
    const v = this.uLE(n);
    const half = 256 ** n / 2;
    return v >= half ? v - 256 ** n : v;
  }
  uvar() {
    let r = 0, m = 1, b;
    do {
      b = this.u8();
      r += (b & 127) * m;
      m *= 128;
    } while (b & 128);
    return r;
  }
  ivar() {
    const z = this.uvar();
    return z % 2 === 0 ? z / 2 : -(z + 1) / 2;
  }
  f32() {
    const b = this.bytes(4);
    return new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, true);
  }
  f64() {
    const b = this.bytes(8);
    return new DataView(b.buffer, b.byteOffset, 8).getFloat64(0, true);
  }
};

// src/schema.ts
var clamp01 = (x) => Math.max(0, Math.min(1, x));
var clampSym = (x) => Math.max(-1, Math.min(1, x));
function encSchema(w, type, val) {
  if (Array.isArray(type)) {
    if (!Array.isArray(val)) throw new InvalidHashError("array expected");
    w.uvar(val.length);
    for (const x of val) encSchema(w, type[0], x);
    return;
  }
  if (type && typeof type === "object") {
    if (!val || typeof val !== "object") throw new InvalidHashError("object expected");
    for (const k of Object.keys(type)) {
      if (!(k in val)) throw new InvalidHashError(`schema field "${k}" missing in value`);
      encSchema(w, type[k], val[k]);
    }
    return;
  }
  const ci = type.indexOf(":");
  const base = ci < 0 ? type : type.slice(0, ci);
  const arg = ci < 0 ? "" : type.slice(ci + 1);
  switch (base) {
    case "u8":
      w.uLE(val, 1);
      break;
    case "u16":
      w.uLE(val, 2);
      break;
    case "u32":
      w.uLE(val, 4);
      break;
    case "uv":
      w.uvar(val);
      break;
    case "i8":
      w.iLE(val, 1);
      break;
    case "i16":
      w.iLE(val, 2);
      break;
    case "i32":
      w.iLE(val, 4);
      break;
    case "iv":
      w.ivar(val);
      break;
    case "f32":
      w.f32(val);
      break;
    case "f64":
      w.f64(val);
      break;
    case "unorm8":
      w.uLE(Math.round(clamp01(val) * 255), 1);
      break;
    case "unorm16":
      w.uLE(Math.round(clamp01(val) * 65535), 2);
      break;
    case "snorm8":
      w.iLE(Math.round(clampSym(val) * 127), 1);
      break;
    case "bool":
      w.u8(val ? 1 : 0);
      break;
    case "enum": {
      const o = arg.split(",");
      const i = o.indexOf(String(val));
      if (i < 0) throw new InvalidHashError(`enum: "${val}" not in [${arg}]`);
      w.uvar(i);
      break;
    }
    case "str": {
      const b = utf8.encode(String(val));
      w.uvar(b.length);
      w.bytes(b);
      break;
    }
    case "json": {
      const b = utf8.encode(canonicalize(val));
      w.uvar(b.length);
      w.bytes(b);
      break;
    }
    default:
      throw new InvalidHashError(`unknown schema type: "${type}"`);
  }
}
function decSchema(r, type) {
  if (Array.isArray(type)) {
    const n = r.uvar();
    const out = [];
    for (let i = 0; i < n; i++) out.push(decSchema(r, type[0]));
    return out;
  }
  if (type && typeof type === "object") {
    const out = {};
    for (const k of Object.keys(type)) out[k] = decSchema(r, type[k]);
    return out;
  }
  const ci = type.indexOf(":");
  const base = ci < 0 ? type : type.slice(0, ci);
  const arg = ci < 0 ? "" : type.slice(ci + 1);
  switch (base) {
    case "u8":
      return r.uLE(1);
    case "u16":
      return r.uLE(2);
    case "u32":
      return r.uLE(4);
    case "uv":
      return r.uvar();
    case "i8":
      return r.iLE(1);
    case "i16":
      return r.iLE(2);
    case "i32":
      return r.iLE(4);
    case "iv":
      return r.ivar();
    case "f32":
      return r.f32();
    case "f64":
      return r.f64();
    case "unorm8":
      return r.uLE(1) / 255;
    case "unorm16":
      return r.uLE(2) / 65535;
    case "snorm8":
      return r.iLE(1) / 127;
    case "bool":
      return !!r.u8();
    case "enum": {
      const o = arg.split(",");
      const i = r.uvar();
      if (i >= o.length) throw new InvalidHashError("enum index out of range");
      return o[i];
    }
    case "str": {
      const n = r.uvar();
      return utf8d.decode(r.bytes(n));
    }
    case "json": {
      const n = r.uvar();
      return JSON.parse(utf8d.decode(r.bytes(n)));
    }
    default:
      throw new InvalidHashError(`unknown schema type: "${type}"`);
  }
}
function schemaSerializer(schema) {
  return {
    serialize: (value) => {
      const w = new ByteWriter();
      encSchema(w, schema, value);
      return w.result();
    },
    deserialize: (bytes) => decSchema(new ByteReader(bytes), schema)
  };
}

// src/format.ts
function expandClass(body) {
  const cps = [...body];
  const out = [];
  for (let i = 0; i < cps.length; i++) {
    if (cps[i + 1] === "-" && i + 2 < cps.length) {
      const a = cps[i].codePointAt(0), b = cps[i + 2].codePointAt(0);
      if (b < a) throw new InvalidHashError(`invalid range in [${body}]`);
      for (let c = a; c <= b; c++) out.push(String.fromCodePoint(c));
      i += 2;
    } else out.push(cps[i]);
  }
  const seen = /* @__PURE__ */ new Set(), uniq = [];
  for (const s of out) if (!seen.has(s)) {
    seen.add(s);
    uniq.push(s);
  }
  return uniq;
}
function compileFormat(pattern) {
  const cps = [...pattern];
  const state = { i: 0, count: 0 };
  const SLOT_CAP = 1e5;
  function quant() {
    if (cps[state.i] !== "{") return 1;
    let j = state.i + 1, num = "";
    while (j < cps.length && /[0-9]/.test(cps[j])) num += cps[j++];
    if (cps[j] !== "}" || !num) throw new InvalidHashError("quantifier must be {n}");
    state.i = j + 1;
    const n = parseInt(num, 10);
    if (n < 1) throw new InvalidHashError("quantifier {0} not allowed");
    return n;
  }
  function parseClass() {
    let j = state.i + 1, body = "";
    while (j < cps.length && cps[j] !== "]") {
      if (cps[j] === "\\") {
        body += cps[j + 1] ?? "";
        j += 2;
      } else body += cps[j++];
    }
    if (cps[j] !== "]") throw new InvalidHashError("incomplete character class [ ]");
    state.i = j + 1;
    const symbols = expandClass(body);
    if (!symbols.length) throw new InvalidHashError("empty character class");
    return [{ symbols }];
  }
  function parseSeq(insideGroup) {
    const slots2 = [];
    while (state.i < cps.length) {
      const c = cps[state.i];
      if (c === ")") {
        if (insideGroup) break;
        throw new InvalidHashError("unexpected )");
      }
      let atom;
      if (c === "(") {
        state.i++;
        atom = parseSeq(true);
        if (cps[state.i] !== ")") throw new InvalidHashError("incomplete group ( )");
        state.i++;
      } else if (c === "[") {
        atom = parseClass();
      } else if (c === "\\") {
        const nx = cps[state.i + 1];
        state.i += 2;
        if (nx === "d") atom = [{ symbols: expandClass("0-9") }];
        else if (nx === "w") atom = [{ symbols: expandClass("A-Za-z0-9_") }];
        else atom = [{ lit: nx ?? "" }];
      } else if (c === "^" || c === "$") {
        state.i++;
        continue;
      } else if (c === "|") throw new InvalidHashError("alternation | not supported");
      else if (c === "+" || c === "*" || c === "?")
        throw new InvalidHashError(`unbounded quantifier "${c}" not supported`);
      else {
        atom = [{ lit: c }];
        state.i++;
      }
      const n = quant();
      state.count += atom.length * n;
      if (state.count > SLOT_CAP) throw new InvalidHashError("format too large");
      for (let k = 0; k < n; k++)
        for (const s of atom) slots2.push(s.lit !== void 0 ? { lit: s.lit } : { symbols: s.symbols });
    }
    return slots2;
  }
  const raw = parseSeq(false);
  const slots = [];
  for (const s of raw) {
    const last = slots[slots.length - 1];
    if (s.lit !== void 0 && last && last.lit !== void 0) last.lit += s.lit;
    else slots.push(s);
  }
  const dataSymbols = [];
  let capacity = 1n, bits = 0, length = 0;
  for (const s of slots) {
    if (s.lit !== void 0) length += [...s.lit].length;
    else {
      dataSymbols.push(s.symbols);
      capacity *= BigInt(s.symbols.length);
      bits += Math.log2(s.symbols.length);
      length += 1;
    }
  }
  if (!dataSymbols.length) throw new InvalidHashError("format has no data positions");
  return { pattern, slots, dataSymbols, capacity, bits, length };
}
function encodeFormat(payload, f) {
  const framed = new Uint8Array(payload.length + 1);
  framed[0] = PAD_SENTINEL;
  framed.set(payload, 1);
  let V = 0n;
  for (const b of framed) V = V << 8n | BigInt(b);
  if (V >= f.capacity)
    throw new InvalidHashError(
      `payload (~${framed.length * 8} bit) does not fit the format (capacity ~${f.bits.toFixed(1)} bit). Use a smaller schema/transform.`
    );
  const digits = new Array(f.dataSymbols.length).fill(0);
  for (let k = f.dataSymbols.length - 1; k >= 0; k--) {
    const base = BigInt(f.dataSymbols[k].length);
    digits[k] = Number(V % base);
    V = V / base;
  }
  let out = "", di = 0;
  for (const s of f.slots) {
    if (s.lit !== void 0) out += s.lit;
    else out += s.symbols[digits[di++]];
  }
  return out;
}
function decodeFormat(str, f) {
  const cps = [...str];
  let pos = 0, V = 0n;
  for (const s of f.slots) {
    if (s.lit !== void 0) {
      for (const lc of [...s.lit]) {
        if (cps[pos] !== lc) throw new InvalidHashError(`format separator "${s.lit}" expected (position ${pos})`);
        pos++;
      }
    } else {
      const ch = cps[pos++];
      const idx = s.symbols.indexOf(ch);
      if (idx < 0) throw new InvalidHashError(`character "${ch ?? "\u2205"}" does not fit the format (position ${pos - 1})`);
      V = V * BigInt(s.symbols.length) + BigInt(idx);
    }
  }
  if (pos !== cps.length) throw new InvalidHashError("input longer than the format allows");
  const rev = [];
  while (V > 0n) {
    rev.push(Number(V & 0xffn));
    V >>= 8n;
  }
  const framed = rev.reverse();
  if (!framed.length || framed[0] !== PAD_SENTINEL)
    throw new InvalidHashError("sentinel missing (wrong format?)");
  return new Uint8Array(framed.slice(1));
}

// src/base-n.ts
function encodeBaseN(bytes, symbols) {
  const base = BigInt(symbols.length);
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let num = 0n;
  for (const b of bytes) num = num << 8n | BigInt(b);
  const out = [];
  while (num > 0n) {
    const rem = Number(num % base);
    num = num / base;
    out.push(symbols[rem]);
  }
  for (let i = 0; i < zeros; i++) out.push(symbols[0]);
  return out.reverse().join("");
}
function decodeBaseN(str, symbols, index) {
  const base = BigInt(symbols.length);
  const zero = symbols[0];
  const chars = [...str];
  let zeros = 0;
  while (zeros < chars.length && chars[zeros] === zero) zeros++;
  let num = 0n;
  for (const ch of chars) {
    const v = index.get(ch);
    if (v === void 0) throw new InvalidHashError(`unknown character: ${ch}`);
    num = num * base + BigInt(v);
  }
  const rev = [];
  while (num > 0n) {
    rev.push(Number(num & 0xffn));
    num >>= 8n;
  }
  const body = rev.reverse();
  const out = new Uint8Array(zeros + body.length);
  out.set(body, zeros);
  return out;
}

// src/checksum.ts
var CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 4294967295;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ c >>> 8;
  return (c ^ 4294967295) >>> 0;
}
function checksumBytes(bytes, n) {
  if (n <= 0) return new Uint8Array(0);
  const c = crc32(bytes);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[n - 1 - i] = c >>> 8 * i & 255;
  return out;
}
function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// src/reader.ts
var Reader = class _Reader {
  constructor(name, opts) {
    __publicField(this, "name");
    __publicField(this, "symbols");
    __publicField(this, "base");
    __publicField(this, "prefix");
    __publicField(this, "checksum");
    __publicField(this, "canonical");
    __publicField(this, "transforms");
    __publicField(this, "transformSpec");
    __publicField(this, "minLength");
    __publicField(this, "maxLength");
    __publicField(this, "padded");
    __publicField(this, "schema");
    __publicField(this, "serializer");
    __publicField(this, "serializerName");
    // 'json'|'text'|'bytes'|null(inline); null+schema => schema
    __publicField(this, "format");
    __publicField(this, "index");
    this.name = name;
    this.format = opts.pattern ? compileFormat(opts.pattern) : null;
    this.symbols = opts.alphabet ? [...opts.alphabet] : [];
    this.base = this.symbols.length;
    this.prefix = opts.prefix ?? "";
    this.checksum = opts.checksum ?? 1;
    this.canonical = opts.canonical ?? true;
    this.transformSpec = opts.transforms ?? [];
    this.transforms = this.transformSpec.map(
      (t) => typeof t === "string" ? resolveTransform(t) : t
    );
    this.schema = opts.schema ?? null;
    if (this.schema && opts.serializer)
      throw new Error(`schema and serializer are mutually exclusive (${name})`);
    if (this.schema) {
      this.serializer = schemaSerializer(this.schema);
      this.serializerName = null;
    } else if (typeof opts.serializer === "object") {
      this.serializer = opts.serializer;
      this.serializerName = null;
    } else if (typeof opts.serializer === "string" && opts.serializer !== "json") {
      this.serializer = resolveSerializer(opts.serializer);
      this.serializerName = opts.serializer;
    } else {
      this.serializer = jsonSerializer(this.canonical);
      this.serializerName = "json";
    }
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
    this.index = /* @__PURE__ */ new Map();
    for (let i = 0; i < this.symbols.length; i++) {
      const s = this.symbols[i];
      if (/\s/u.test(s)) throw new Error(`whitespace in alphabet not allowed (${name})`);
      if (this.index.has(s)) throw new Error(`duplicate symbol "${s}" in alphabet (${name})`);
      this.index.set(s, i);
    }
    if (/\s/u.test(this.prefix)) throw new Error(`whitespace in prefix not allowed (${name})`);
  }
  /** Bits per character = log2(base) (in format mode: average over data positions). */
  get bitsPerChar() {
    return this.format ? this.format.bits / this.format.dataSymbols.length : Math.log2(this.base);
  }
  /** Upper bound of the hash length (in characters) for N payload bytes. */
  maxLengthForBytes(byteLen) {
    if (this.format) return this.prefix.length + this.format.length;
    const payload = byteLen + this.checksum;
    const digits = payload === 0 ? 0 : Math.floor(payload * 8 / this.bitsPerChar) + 1;
    return this.prefix.length + digits;
  }
  /** Build payload bytes (serializer -> transforms -> + checksum). */
  buildPayload(value) {
    let bytes = this.serializer.serialize(value);
    for (const t of this.transforms) bytes = t.encode(bytes);
    const cs = checksumBytes(bytes, this.checksum);
    const payload = new Uint8Array(bytes.length + cs.length);
    payload.set(bytes, 0);
    payload.set(cs, bytes.length);
    return payload;
  }
  /** Size of the raw data in bytes (after serializer, before transforms/checksum). */
  serializedLength(value) {
    return this.serializer.serialize(value).length;
  }
  /**
   * Smallest possible length for this value in padding mode (= floor).
   * Cannot go below it (lossless codec).
   */
  floorLengthFor(value) {
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
  lengthRange(value) {
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
  encode(value, targetLength) {
    const payload = this.buildPayload(value);
    if (this.format) return this.prefix + encodeFormat(payload, this.format);
    if (!this.padded && targetLength == null) {
      return this.prefix + encodeBaseN(payload, this.symbols);
    }
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
          `data does not fit into maxLength=${this.maxLength}; needs at least ${floor} characters.`
        );
      if (want > this.maxLength) want = this.maxLength;
    }
    const pad = this.symbols[0].repeat(want - this.prefix.length - body.length);
    return this.prefix + pad + body;
  }
  /** Decode. Throws InvalidHashError on prefix/character/checksum errors. */
  decode(hash) {
    let s = hash.normalize("NFC");
    if (this.prefix) {
      if (!s.startsWith(this.prefix))
        throw new InvalidHashError(`prefix "${this.prefix}" missing`);
      s = s.slice(this.prefix.length);
    }
    let payload;
    if (this.format) {
      payload = decodeFormat(s, this.format);
    } else {
      payload = decodeBaseN(s, this.symbols, this.index);
      if (this.padded) {
        let i = 0;
        while (i < payload.length && payload[i] === 0) i++;
        if (i >= payload.length || payload[i] !== PAD_SENTINEL)
          throw new InvalidHashError("padding sentinel missing (wrong reader / mode?)");
        payload = payload.subarray(i + 1);
      }
    }
    let data = payload;
    if (this.checksum > 0) {
      if (payload.length < this.checksum)
        throw new InvalidHashError("hash too short for checksum");
      data = payload.subarray(0, payload.length - this.checksum);
      const got = payload.subarray(payload.length - this.checksum);
      if (!bytesEqual(got, checksumBytes(data, this.checksum)))
        throw new InvalidHashError("checksum invalid (typo / wrong reader?)");
    }
    let bytes = data;
    for (let i = this.transforms.length - 1; i >= 0; i--)
      bytes = this.transforms[i].decode(bytes);
    return this.serializer.deserialize(bytes);
  }
  /** Stable check whether a string is decodable with this reader. */
  canDecode(hash) {
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
  definition() {
    const transforms = this.transformSpec.map((t) => {
      if (typeof t === "string") return t;
      throw new Error(
        `Reader "${this.name}" contains an anonymous transform and is not exportable. Register it with registerTransform(name, factory) and reference it by name.`
      );
    });
    if (!this.schema && this.serializerName === null)
      throw new Error(
        `Reader "${this.name}" uses an anonymous serializer and is not exportable. Register it with registerSerializer(name, s) and reference it by name.`
      );
    return {
      v: 1,
      name: this.name,
      ...this.format ? { pattern: this.format.pattern } : { alphabet: this.symbols.join("") },
      prefix: this.prefix,
      checksum: this.checksum,
      canonical: this.canonical,
      transforms,
      ...this.minLength !== null ? { min: this.minLength } : {},
      ...this.maxLength !== null ? { max: this.maxLength } : {},
      ...this.schema ? { schema: this.schema } : {},
      ...this.serializerName && this.serializerName !== "json" ? { serializer: this.serializerName } : {}
    };
  }
  /** Reconstruct a reader from a definition (transforms via registry). */
  static fromDefinition(def) {
    if (def.v !== 1) throw new InvalidHashError(`unknown reader version: ${def.v}`);
    return new _Reader(def.name, {
      alphabet: def.alphabet,
      pattern: def.pattern,
      prefix: def.prefix,
      checksum: def.checksum,
      canonical: def.canonical,
      transforms: def.transforms,
      minLength: def.min,
      maxLength: def.max,
      schema: def.schema,
      serializer: def.serializer
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
      transforms: this.transformSpec.map((t) => typeof t === "string" ? t : "<inline>"),
      minLength: this.minLength,
      maxLength: this.maxLength,
      schema: this.schema,
      serializer: this.serializerName ?? (this.schema ? "schema" : "<inline>"),
      pattern: this.format?.pattern ?? null,
      capacityBits: this.format ? Number(this.format.bits.toFixed(2)) : null
    };
  }
};

// src/bootstrap.ts
var BOOTSTRAP = new Reader("::bootstrap", {
  alphabet: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  // base62, fixed
  prefix: "RDR1.",
  // visible marker: every key starts with this
  checksum: 2,
  canonical: false
  // IMPORTANT: preserve field order (schema layout depends on it)
});
function exportReader(reader) {
  return BOOTSTRAP.encode(reader.definition());
}
function importReader(key) {
  const def = BOOTSTRAP.decode(key);
  return Reader.fromDefinition(def);
}
function decodeWith(key, message) {
  return importReader(key).decode(message);
}
function pack(reader, value) {
  return exportReader(reader) + PACK_DELIM + reader.encode(value);
}
function unpack(token) {
  const i = token.indexOf(PACK_DELIM);
  if (i < 0) throw new InvalidHashError(`no "${PACK_DELIM}" separator \u2013 not a valid pack token`);
  const reader = importReader(token.slice(0, i));
  const value = reader.decode(token.slice(i + 1));
  return { reader, value };
}

// src/registry.ts
var Dresscodec = class {
  constructor() {
    __publicField(this, "readers", /* @__PURE__ */ new Map());
    __publicField(this, "defaultName", null);
  }
  /** Define a reader. The first reader defined becomes the default. */
  define(name, opts, makeDefault = false) {
    const reader = opts instanceof Reader ? opts : new Reader(name, opts);
    this.readers.set(name, reader);
    if (makeDefault || this.defaultName === null) this.defaultName = name;
    return reader;
  }
  reader(name) {
    const key = name ?? this.defaultName;
    if (!key) throw new Error("no reader defined");
    const r = this.readers.get(key);
    if (!r) throw new Error(`reader "${key}" not found`);
    return r;
  }
  setDefault(name) {
    if (!this.readers.has(name)) throw new Error(`reader "${name}" not found`);
    this.defaultName = name;
  }
  list() {
    return [...this.readers.keys()];
  }
  encode(value, reader, targetLength) {
    return this.reader(reader).encode(value, targetLength);
  }
  /**
   * Decode. With a reader name: exactly that reader.
   * Without: auto-detect – first by prefix, then by valid checksum.
   */
  decode(hash, reader) {
    if (reader) return this.reader(reader).decode(hash);
    const prefixed = [...this.readers.values()].filter(
      (r) => r.prefix && hash.startsWith(r.prefix)
    );
    for (const r of prefixed) {
      try {
        return r.decode(hash);
      } catch {
      }
    }
    for (const r of this.readers.values()) {
      if (r.prefix) continue;
      try {
        return r.decode(hash);
      } catch {
      }
    }
    throw new InvalidHashError("no matching reader found for this hash");
  }
  /** Which reader would decode this hash? (or null) */
  detect(hash) {
    for (const r of this.readers.values()) if (r.canDecode(hash)) return r.name;
    return null;
  }
  stats(value, reader) {
    const r = this.reader(reader);
    const bytes = r.serializedLength(value);
    return {
      reader: r.name,
      bytes,
      chars: [...r.encode(value)].length,
      maxChars: r.maxLengthForBytes(bytes),
      bitsPerChar: Number(r.bitsPerChar.toFixed(4)),
      base: r.base
    };
  }
  /** Export a reader as a key (bootstrap-encoded). */
  exportReader(name) {
    return exportReader(this.reader(name));
  }
  /** Import a reader from a key and (optionally) add it to the registry. */
  importReader(key, makeDefault = false) {
    const r = importReader(key);
    return this.define(r.name, r, makeDefault);
  }
  /** Self-contained token (KEY$MESSAGE). */
  pack(value, reader) {
    return pack(this.reader(reader), value);
  }
  /** Split a token, decode it; the reader is added to the registry. */
  unpack(token) {
    const { reader, value } = unpack(token);
    this.define(reader.name, reader);
    return { reader: reader.name, value };
  }
};

// src/presets.ts
var ALPHABETS = {
  base16: "0123456789abcdef",
  base32: "0123456789ABCDEFGHJKMNPQRSTVWXYZ",
  // Crockford, without I L O U
  base58: "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz",
  // Bitcoin
  base62: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  base64url: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  // "sexy" example sets (all single code point):
  runic: "\u16A0\u16A2\u16A6\u16A8\u16B1\u16B2\u16B7\u16B9\u16BA\u16BE\u16C1\u16C3\u16C7\u16C8\u16C9\u16CA\u16CF\u16D2\u16D6\u16D7\u16DA\u16DC\u16DE\u16DF",
  // Elder Futhark, base24
  geometric: "\u25C7\u25C8\u25C6\u25CA\u25CB\u25CF\u25D0\u25D1\u25D2\u25D3\u25A1\u25A0\u25A2\u25A3\u25B3\u25B2\u25BD\u25BC\u25C1\u25C0\u25B7\u25B6\u2605\u2606\u25E2\u25E3\u25E4\u25E5\u2B1F\u2B22\u2B21\u2B20"
  // base32
};
function createReader(name, opts) {
  return new Reader(name, opts);
}

export { ALPHABETS, BOOTSTRAP, Dresscodec, Dresscodec as JsonHash, Reader, bytesSerializer, compileFormat, createReader, decodeWith, exportReader, importReader, pack, registerSerializer, schemaSerializer, textSerializer, unpack };
