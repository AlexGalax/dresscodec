# dresscodec

A **reversible codec** — turn JSON, text, or bytes into a compact, formattable
string and exactly back again.

> **Not a crypto digest.** The "hash" is a lossless, reversible encoding: whoever
> knows the alphabet/key can decode. The checksum catches typos, not tampering.

```
value → serializer → bytes → [transforms] → (+checksum) → base-N / format → string
```

A **Reader** is the dress code for your data (character set, format, schema). It
turns a value into a hash; share both as a **Key** or a self-contained
**pack token**.

## Install

```bash
npm i dresscodec
# optional, only for the deflate transform:
npm i fflate
```

Zero runtime dependencies. `fflate` is an optional peer dependency, used only by
the separate `dresscodec/transforms` entry.

## 60-second quick start

```ts
import { Dresscodec, Reader, ALPHABETS, exportReader, importReader, pack, unpack } from 'dresscodec';

// 1) Create a reader, encode & decode
const r = new Reader('seed', { alphabet: ALPHABETS.base58, prefix: '~' });
const hash = r.encode({ timestamp: 1719300000, settings: { steps: 16, seed: 9183 } });
const back = r.decode(hash); // -> the original object

// 2) Reader-Key + pack/unpack (carry the reader with the data)
const key = exportReader(r);          // "RDR1.…" — share once
const r2  = importReader(key);        // reconstruct the reader
const token = pack(r, { a: 1 });      // "RDR1.…$~…" — self-contained
const { value } = unpack(token);      // { a: 1 }

// 3) Schema for tiny hashes (encode only the values, binary-packed)
const s = new Reader('smpl', {
  alphabet: ALPHABETS.base62, prefix: '#',
  schema: { steps: 'u8', swing: 'unorm8', scale: 'enum:major,minor,phrygian', seed: 'u16' },
});
s.encode({ steps: 16, swing: 0.62, scale: 'phrygian', seed: 9183 }); // ~12 chars vs ~120 for JSON

// 4) Regex format for fixed-length license-key strings
const k = new Reader('key', {
  pattern: '[A-Z]{4}-[A-Z]{4}-[A-Z]{4}-[A-Z]{4}-[A-Z]{4}', // 24 chars, ~94 bit
  schema: { steps: 'u8', seed: 'u16' }, checksum: 0,
});
k.encode({ steps: 16, seed: 9183 }); // "AAAA-…-RNZO"

// 5) Text / bytes serializers (any input, not just JSON)
new Reader('t',  { alphabet: ALPHABETS.base58, serializer: 'text' }).encode('any string');
new Reader('id', { pattern: '[A-Z0-9]{4}-[A-Z0-9]{4}', serializer: 'bytes', checksum: 0 }).encode('a1b2c3');
```

Use a `Dresscodec` registry to hold several readers and auto-detect on decode:

```ts
const dc = new Dresscodec();
dc.define('seed',  { alphabet: ALPHABETS.base58, prefix: '~' });
dc.define('theme', { alphabet: ALPHABETS.base62, prefix: '#' });
dc.decode(hash);    // auto-detect: prefix first, then valid checksum
dc.detect(hash);    // 'seed' | 'theme' | null
```

## Schema types

`u8 u16 u32 uv` (unsigned) · `i8 i16 i32 iv` (signed) · `f32 f64` ·
`unorm8 unorm16` (0..1) · `snorm8` (-1..1) · `bool` · `enum:a,b,c` · `str` ·
`json` (fallback) · `[T]` (array) · `{…}` (nested struct). Field order = layout.
Quantized types are lossy; only schema fields survive.

## Deflate transform (optional)

For shorter hashes on repetitive data (~25–40%):

```bash
npm i fflate
```

```ts
import 'dresscodec/transforms';            // self-registers 'deflate'
const r = new Reader('packed', { alphabet: ALPHABETS.base62, transforms: ['deflate'] });
```

Importing `dresscodec/transforms` registers `deflate` by name, so readers using
`transforms: ['deflate']` are portable through Key export/import.

## API cheat-sheet

| | |
|---|---|
| `new Reader(name, opts)` / `createReader(name, opts)` | Standalone reader |
| `reader.encode(value, targetLength?)` / `reader.decode(hash)` | Encode / decode |
| `reader.lengthRange(value)` / `reader.floorLengthFor(value)` | Padding bounds |
| `new Dresscodec()` (alias `JsonHash`, deprecated) | Registry |
| `.define(name, opts, makeDefault?)` · `.encode` · `.decode` · `.detect` · `.stats` | Registry ops |
| `exportReader(r)` / `importReader(key)` / `decodeWith(key, msg)` | Reader keys |
| `pack(r, value)` / `unpack(token)` | Self-contained token |
| `compileFormat(pattern)` | Inspect a regex format |
| `registerTransform(name, factory)` / `resolveTransform(name)` | Transforms |
| `registerSerializer(name, s)` · `textSerializer` · `bytesSerializer` | Serializers |
| `ALPHABETS` | `base16 base32 base58 base62 base64url runic geometric` |
| `BOOTSTRAP` | The fixed `RDR1.` key codec |
| `InvalidHashError` | Thrown on decode failure |

`ReaderOptions`: `alphabet` **or** `pattern` (required), `prefix=''`,
`checksum=1` (0–4), `canonical=true`, `transforms=[]`, `length` / `minLength` /
`maxLength`, `schema` **or** `serializer` (mutually exclusive).

## License

MIT — Alexander Schornberg