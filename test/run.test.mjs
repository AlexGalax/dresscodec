import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Dresscodec,
  JsonHash,
  Reader,
  createReader,
  exportReader,
  importReader,
  decodeWith,
  pack,
  unpack,
  BOOTSTRAP,
  compileFormat,
  ALPHABETS,
  registerSerializer,
  textSerializer,
  bytesSerializer,
  InvalidHashError,
} from '../dist/index.js';

// Importing this entry self-registers the 'deflate' transform.
import { deflate } from '../dist/transforms.js';

/* ------------------------------------------------------------------ */
/* JSON round-trips                                                     */
/* ------------------------------------------------------------------ */

test('JSON round-trip across all preset alphabets', () => {
  const obj = { timestamp: 1719300000, settings: { steps: 16, swing: 0.62, scale: 'phrygian', seed: 9183 } };
  for (const name of Object.keys(ALPHABETS)) {
    const r = new Reader(name, { alphabet: ALPHABETS[name] });
    const h = r.encode(obj);
    assert.deepEqual(r.decode(h), obj, `round-trip failed for ${name}`);
  }
});

test('JSON round-trip with prefix and various data shapes', () => {
  const r = new Reader('seed', { alphabet: ALPHABETS.base58, prefix: '~' });
  for (const v of [
    {},
    { a: 1 },
    { nested: { deep: { value: [1, 2, 3] } } },
    { unicode: 'héllo ☃ 🎲', n: -42, f: 3.14159 },
    { arr: [true, false, null, 'x'] },
  ]) {
    const h = r.encode(v);
    assert.ok(h.startsWith('~'), 'prefix present');
    assert.deepEqual(r.decode(h), v);
  }
});

test('canonical encoding is order-independent; non-canonical preserves order difference', () => {
  const canon = new Reader('c', { alphabet: ALPHABETS.base62 });
  assert.equal(canon.encode({ a: 1, b: 2 }), canon.encode({ b: 2, a: 1 }));

  const raw = new Reader('r', { alphabet: ALPHABETS.base62, canonical: false });
  assert.notEqual(raw.encode({ a: 1, b: 2 }), raw.encode({ b: 2, a: 1 }));
  // both still decode back correctly
  assert.deepEqual(raw.decode(raw.encode({ b: 2, a: 1 })), { b: 2, a: 1 });
});

test('leading-zero / empty payload preservation', () => {
  const r = new Reader('z', { alphabet: ALPHABETS.base62, checksum: 0 });
  // bytes serializer with leading zero bytes
  const rb = new Reader('zb', { alphabet: ALPHABETS.base62, serializer: 'bytes', checksum: 0 });
  assert.equal(rb.decode(rb.encode('0000ff')), '0000ff');
  assert.equal(rb.decode(rb.encode('00')), '00');
  assert.deepEqual(r.decode(r.encode(0)), 0);
});

/* ------------------------------------------------------------------ */
/* Schema round-trips                                                   */
/* ------------------------------------------------------------------ */

test('schema round-trip: exact integer/float/bool/enum/str/json types', () => {
  const r = new Reader('smpl', {
    alphabet: ALPHABETS.base62,
    prefix: '#',
    schema: {
      a8: 'u8', a16: 'u16', a32: 'u32', av: 'uv',
      s8: 'i8', s16: 'i16', s32: 'i32', sv: 'iv',
      f: 'f64', g: 'f32',
      b: 'bool',
      e: 'enum:major,minor,phrygian,dorian,lydian',
      str: 'str',
      raw: 'json',
    },
  });
  const v = {
    a8: 255, a16: 65535, a32: 4294967295, av: 1234567,
    s8: -128, s16: -32768, s32: -2147483648, sv: -987654,
    f: 3.141592653589793, g: 0.5,
    b: true,
    e: 'phrygian',
    str: 'hello ☃',
    raw: { nested: [1, 2, 3], k: 'v' },
  };
  const decoded = r.decode(r.encode(v));
  assert.equal(decoded.a8, 255);
  assert.equal(decoded.a32, 4294967295);
  assert.equal(decoded.sv, -987654);
  assert.equal(decoded.f, 3.141592653589793);
  assert.equal(decoded.g, 0.5);
  assert.equal(decoded.b, true);
  assert.equal(decoded.e, 'phrygian');
  assert.equal(decoded.str, 'hello ☃');
  assert.deepEqual(decoded.raw, { nested: [1, 2, 3], k: 'v' });
});

test('schema round-trip: nested structs and arrays', () => {
  const r = new Reader('nest', {
    alphabet: ALPHABETS.base62,
    schema: {
      header: { version: 'u8', flags: 'u16' },
      points: [{ x: 'i16', y: 'i16' }],
      tags: ['str'],
    },
  });
  const v = {
    header: { version: 2, flags: 1024 },
    points: [{ x: -5, y: 7 }, { x: 100, y: -200 }],
    tags: ['alpha', 'beta', 'gamma'],
  };
  assert.deepEqual(r.decode(r.encode(v)), v);
});

test('schema quantized types are lossy within tolerance', () => {
  const r = new Reader('q', {
    alphabet: ALPHABETS.base62,
    schema: { swing: 'unorm8', fine: 'unorm16', bal: 'snorm8' },
  });
  const d = r.decode(r.encode({ swing: 0.62, fine: 0.62, bal: -0.5 }));
  assert.ok(Math.abs(d.swing - 0.62) < 1 / 255 + 1e-9);
  assert.ok(Math.abs(d.fine - 0.62) < 1 / 65535 + 1e-9);
  assert.ok(Math.abs(d.bal - -0.5) < 1 / 127 + 1e-9);
  // clamping
  const c = r.decode(r.encode({ swing: 5, fine: -5, bal: 9 }));
  assert.equal(c.swing, 1);
  assert.equal(c.fine, 0);
  assert.equal(c.bal, 1);
});

test('schema produces dramatically smaller output than JSON', () => {
  const obj = { timestamp: 1719300000, settings: { steps: 16, swing: 0.62, scale: 'phrygian', seed: 9183 } };
  const jsonR = new Reader('j', { alphabet: ALPHABETS.base62, prefix: '#' });
  const schemaR = new Reader('s', {
    alphabet: ALPHABETS.base62, prefix: '#',
    schema: { timestamp: 'u32', settings: { steps: 'u8', swing: 'unorm8', scale: 'enum:major,minor,phrygian,dorian,lydian', seed: 'u16' } },
  });
  assert.ok(schemaR.encode(obj).length < jsonR.encode(obj).length / 4);
});

test('schema missing field throws', () => {
  const r = new Reader('m', { alphabet: ALPHABETS.base62, schema: { a: 'u8', b: 'u8' } });
  assert.throws(() => r.encode({ a: 1 }), InvalidHashError);
});

test('schema and serializer are mutually exclusive', () => {
  assert.throws(
    () => new Reader('x', { alphabet: ALPHABETS.base62, schema: { a: 'u8' }, serializer: 'text' }),
    /mutually exclusive/,
  );
});

/* ------------------------------------------------------------------ */
/* Format / pattern                                                     */
/* ------------------------------------------------------------------ */

test('format: fixed length license-key round-trip', () => {
  const r = new Reader('key', {
    pattern: '[A-Z]{4}-[A-Z]{4}-[A-Z]{4}-[A-Z]{4}-[A-Z]{4}',
    schema: { steps: 'u8', swing: 'unorm8', scale: 'enum:major,minor,phrygian', seed: 'u16' },
    checksum: 0,
  });
  const v = { steps: 16, swing: 0.62, scale: 'phrygian', seed: 9183 };
  const h = r.encode(v);
  assert.equal(h.length, 24, 'fixed 24 chars incl. separators');
  assert.match(h, /^[A-Z]{4}-[A-Z]{4}-[A-Z]{4}-[A-Z]{4}-[A-Z]{4}$/);
  const d = r.decode(h);
  assert.equal(d.steps, 16);
  assert.equal(d.scale, 'phrygian');
  assert.equal(d.seed, 9183);
  assert.ok(Math.abs(d.swing - 0.62) < 1 / 255 + 1e-9, 'swing within unorm8 tolerance');
});

test('format: grouped patterns compile to the same fixed layout', () => {
  const a = compileFormat('[A-Z]{4}-[A-Z]{4}-[A-Z]{4}-[A-Z]{4}-[A-Z]{4}');
  const b = compileFormat('(([A-Z]{4})-){4}[A-Z]{4}');
  const c = compileFormat('([A-Z]{4}-){4}[A-Z]{4}');
  assert.equal(a.length, b.length);
  assert.equal(a.length, c.length);
  assert.equal(a.dataSymbols.length, b.dataSymbols.length);
  assert.equal(a.capacity, b.capacity);

  // round-trip through a grouped reader
  const r = new Reader('g', { pattern: '(([A-Z]{4})-){4}[A-Z]{4}', serializer: 'text', checksum: 0 });
  assert.equal(r.decode(r.encode('hi')), 'hi');
});

test('format: mixed classes per segment', () => {
  const r = new Reader('mix', { pattern: '[A-Z]{3}-[0-9]{5}', serializer: 'bytes', checksum: 0 });
  const f = r.format;
  assert.equal(f.length, 9); // 3 letters + '-' + 5 digits
  assert.equal(f.dataSymbols.length, 8); // literal '-' is not a data position
  assert.equal(f.dataSymbols[0].length, 26); // [A-Z]
  assert.equal(f.dataSymbols[7].length, 10); // [0-9]
});

test('format: \\d and \\w classes', () => {
  const f = compileFormat('\\d{4}\\w{2}');
  assert.equal(f.dataSymbols[0].length, 10);
  assert.equal(f.dataSymbols[4].length, 63); // A-Za-z0-9_
});

test('format: capacity overflow throws', () => {
  const r = new Reader('tiny', { pattern: '[A-Z]{2}', serializer: 'text', checksum: 0 });
  assert.throws(() => r.encode('this string is far too long to fit'), InvalidHashError);
});

test('format: unsupported regex features throw', () => {
  assert.throws(() => compileFormat('[A-Z]+'), /unbounded quantifier/);
  assert.throws(() => compileFormat('a|b'), /alternation/);
  assert.throws(() => compileFormat('[A-Z]{0}'), /not allowed/);
  assert.throws(() => compileFormat('abc'), /no data positions/);
});

/* ------------------------------------------------------------------ */
/* Text & bytes serializers                                             */
/* ------------------------------------------------------------------ */

test('text serializer round-trips arbitrary strings', () => {
  const r = new Reader('t', { alphabet: ALPHABETS.base58, serializer: 'text' });
  for (const s of ['dresscodec preset v2', '', 'multi\nline\ttext', '☃🎲 unicode']) {
    assert.equal(r.decode(r.encode(s)), s);
  }
});

test('bytes serializer round-trips hex IDs', () => {
  const r = new Reader('id', {
    pattern: '[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}',
    serializer: 'bytes',
    checksum: 0,
  });
  const h = r.encode('a1b2c3d4e5');
  assert.match(h, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(r.decode(h), 'a1b2c3d4e5');
});

test('exported textSerializer / bytesSerializer behave as documented', () => {
  assert.deepEqual([...textSerializer.serialize('AB')], [65, 66]);
  assert.equal(textSerializer.deserialize(new Uint8Array([65, 66])), 'AB');
  assert.deepEqual([...bytesSerializer.serialize('00ff')], [0, 255]);
  assert.equal(bytesSerializer.deserialize(new Uint8Array([0, 255])), '00ff');
});

test('custom registered serializer survives key export/import', () => {
  registerSerializer('csv', {
    serialize: (v) => textSerializer.serialize(v.join(',')),
    deserialize: (b) => String(textSerializer.deserialize(b)).split(','),
  });
  const r = new Reader('csvr', { alphabet: ALPHABETS.base62, serializer: 'csv' });
  const key = exportReader(r);
  const r2 = importReader(key);
  assert.deepEqual(r2.decode(r2.encode(['a', 'b', 'c'])), ['a', 'b', 'c']);
});

/* ------------------------------------------------------------------ */
/* Padding & length                                                     */
/* ------------------------------------------------------------------ */

test('padding: floor / minLength / maxLength and clamping', () => {
  const obj = { msg: 'hello world', n: 12345 };
  const r = new Reader('message', { alphabet: ALPHABETS.base62, prefix: '#', maxLength: 200 });
  const range = r.lengthRange(obj);
  assert.equal(range.floor, range.min);
  assert.equal(range.max, 200);

  const shortest = r.encode(obj);
  assert.equal([...shortest].length, range.floor);

  const padded = r.encode(obj, 160);
  assert.equal([...padded].length, 160);
  assert.deepEqual(r.decode(padded), obj);

  // below floor clamps up to floor
  const clamped = r.encode(obj, 1);
  assert.equal([...clamped].length, range.floor);
  assert.deepEqual(r.decode(clamped), obj);
});

test('fixed length: every hash is exactly `length` chars', () => {
  const r = new Reader('stamp', { alphabet: ALPHABETS.base62, length: 48 });
  for (const v of [{ a: 1 }, { a: 1, b: 2, c: [1, 2, 3] }]) {
    const h = r.encode(v);
    assert.equal([...h].length, 48);
    assert.deepEqual(r.decode(h), v);
  }
});

test('maxLength too small throws with required minimum', () => {
  const r = new Reader('cramped', { alphabet: ALPHABETS.base62, maxLength: 3 });
  assert.throws(() => r.encode({ a: 'a much larger value than fits' }), InvalidHashError);
});

test('padding range survives reader key export/import', () => {
  const r = new Reader('padexp', { alphabet: ALPHABETS.base62, prefix: '#', minLength: 20, maxLength: 64 });
  const r2 = importReader(exportReader(r));
  assert.equal(r2.minLength, 20);
  assert.equal(r2.maxLength, 64);
  assert.equal([...r2.encode({ a: 1 }, 40)].length, 40);
});

/* ------------------------------------------------------------------ */
/* Checksum                                                             */
/* ------------------------------------------------------------------ */

test('checksum detects typos / tampering', () => {
  const r = new Reader('ck', { alphabet: ALPHABETS.base62, checksum: 2 });
  const h = r.encode({ value: 42 });
  // flip the last character to something else in the alphabet
  const chars = [...h];
  const last = chars[chars.length - 1];
  chars[chars.length - 1] = last === 'A' ? 'B' : 'A';
  assert.throws(() => r.decode(chars.join('')), InvalidHashError);
});

test('checksum 0 disables integrity check', () => {
  const r = new Reader('nock', { alphabet: ALPHABETS.base62, checksum: 0 });
  assert.deepEqual(r.decode(r.encode({ a: 1 })), { a: 1 });
});

test('checksum bounds are validated', () => {
  assert.throws(() => new Reader('bad', { alphabet: ALPHABETS.base62, checksum: 5 }), /checksum/);
  assert.throws(() => new Reader('bad', { alphabet: ALPHABETS.base62, checksum: -1 }), /checksum/);
});

test('alphabet validation: too small, whitespace, duplicates', () => {
  assert.throws(() => new Reader('s', { alphabet: 'A' }), />= 2 symbols/);
  assert.throws(() => new Reader('w', { alphabet: 'AB C' }), /whitespace/);
  assert.throws(() => new Reader('d', { alphabet: 'AAB' }), /duplicate/);
});

/* ------------------------------------------------------------------ */
/* Reader key export / import                                           */
/* ------------------------------------------------------------------ */

test('exportReader produces an RDR1.-prefixed key', () => {
  const r = new Reader('seed', { alphabet: ALPHABETS.base58, prefix: '~' });
  const key = exportReader(r);
  assert.ok(key.startsWith('RDR1.'), 'bootstrap prefix');
  assert.equal(BOOTSTRAP.prefix, 'RDR1.');
});

test('definition / fromDefinition round-trip preserves all options', () => {
  const r = new Reader('full', {
    alphabet: ALPHABETS.base62, prefix: '#', checksum: 3, canonical: false,
    minLength: 10, maxLength: 100,
  });
  const def = r.definition();
  assert.equal(def.v, 1);
  const r2 = Reader.fromDefinition(def);
  assert.equal(r2.prefix, '#');
  assert.equal(r2.checksum, 3);
  assert.equal(r2.canonical, false);
  assert.equal(r2.minLength, 10);
  assert.equal(r2.maxLength, 100);
});

test('importReader reconstructs a working reader (incl. schema)', () => {
  const r = new Reader('schemakey', {
    alphabet: ALPHABETS.base62, prefix: '#',
    schema: { steps: 'u8', seed: 'u16' },
  });
  const v = { steps: 16, seed: 9183 };
  const key = exportReader(r);
  const r2 = importReader(key);
  // a hash produced by the original reader decodes with the imported one
  assert.deepEqual(r2.decode(r.encode(v)), v);
});

test('decodeWith decodes message given a key', () => {
  const r = new Reader('dw', { alphabet: ALPHABETS.base62, prefix: '#' });
  const key = exportReader(r);
  const msg = r.encode({ hello: 'world' });
  assert.deepEqual(decodeWith(key, msg), { hello: 'world' });
});

test('anonymous inline serializer/transform are not exportable', () => {
  const r = new Reader('inline', {
    alphabet: ALPHABETS.base62,
    serializer: { serialize: (v) => textSerializer.serialize(String(v)), deserialize: (b) => textSerializer.deserialize(b) },
  });
  assert.throws(() => exportReader(r), /not exportable/);
});

/* ------------------------------------------------------------------ */
/* Pack / unpack                                                        */
/* ------------------------------------------------------------------ */

test('pack / unpack carry reader + value in one token', () => {
  const r = new Reader('seed', { alphabet: ALPHABETS.base58, prefix: '~' });
  const obj = { timestamp: 1719300000, settings: { steps: 16, seed: 9183 } };
  const token = pack(r, obj);
  assert.ok(token.startsWith('RDR1.'));
  assert.ok(token.includes('$'));
  const { reader, value } = unpack(token);
  assert.equal(reader.name, 'seed');
  assert.deepEqual(value, obj);
});

test('unpack throws on a token without a delimiter', () => {
  assert.throws(() => unpack('not-a-token'), InvalidHashError);
});

/* ------------------------------------------------------------------ */
/* Registry (Dresscodec / JsonHash alias)                               */
/* ------------------------------------------------------------------ */

test('JsonHash is a deprecated alias of Dresscodec', () => {
  assert.equal(JsonHash, Dresscodec);
});

test('registry: define, default, encode/decode, detect', () => {
  const jh = new Dresscodec();
  jh.define('seed', { alphabet: ALPHABETS.base58, prefix: '~' });
  jh.define('theme', { alphabet: ALPHABETS.base62, prefix: '#' });

  const h = jh.encode({ a: 1 }); // default = seed (first defined)
  assert.ok(h.startsWith('~'));
  assert.deepEqual(jh.decode(h), { a: 1 });

  const ht = jh.encode({ b: 2 }, 'theme');
  assert.ok(ht.startsWith('#'));
  assert.equal(jh.detect(ht), 'theme');
  assert.deepEqual(jh.decode(ht), { b: 2 });
});

test('registry: auto-detect by checksum when no prefix', () => {
  const jh = new Dresscodec();
  jh.define('a', { alphabet: ALPHABETS.base62, checksum: 2 });
  const h = jh.encode({ x: 99 });
  assert.deepEqual(jh.decode(h), { x: 99 });
});

test('registry: stats reports byte/char sizes', () => {
  const jh = new Dresscodec();
  jh.define('seed', { alphabet: ALPHABETS.base58, prefix: '~' });
  const s = jh.stats({ timestamp: 1719300000, settings: { steps: 16, seed: 9183 } }, 'seed');
  assert.equal(s.reader, 'seed');
  assert.equal(s.base, 58);
  assert.ok(s.chars > 0 && s.chars <= s.maxChars);
});

test('registry: pack / unpack adds reader to the registry', () => {
  const jh = new Dresscodec();
  jh.define('seed', { alphabet: ALPHABETS.base62, prefix: '#' });
  const token = jh.pack({ a: 1 }, 'seed');
  const jh2 = new Dresscodec();
  const { reader, value } = jh2.unpack(token);
  assert.equal(reader, 'seed');
  assert.deepEqual(value, { a: 1 });
  assert.ok(jh2.list().includes('seed'));
});

test('createReader builds a standalone reader', () => {
  const r = createReader('solo', { alphabet: ALPHABETS.base62 });
  assert.ok(r instanceof Reader);
  assert.deepEqual(r.decode(r.encode({ ok: true })), { ok: true });
});

/* ------------------------------------------------------------------ */
/* Deflate transform (optional, via dresscodec/transforms)              */
/* ------------------------------------------------------------------ */

test('deflate transform round-trips and is portable by name', () => {
  const r = new Reader('packed', { alphabet: ALPHABETS.base62, prefix: '~', transforms: ['deflate'] });
  const big = { items: Array.from({ length: 40 }, (_, i) => ({ id: i, label: 'repeated-label-' + (i % 3) })) };
  const h = r.encode(big);
  assert.deepEqual(r.decode(h), big);

  // exportable because 'deflate' is registered
  const key = exportReader(r);
  const r2 = importReader(key);
  assert.deepEqual(r2.decode(h), big);
});

test('deflate factory is callable and produces a working inline transform', () => {
  const t = deflate();
  const input = new Uint8Array([1, 2, 3, 3, 3, 3, 3, 3, 3, 3, 9]);
  assert.deepEqual([...t.decode(t.encode(input))], [...input]);
});
