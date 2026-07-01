/* ------------------------------------------------------------------ */
/* Low-level byte writer / reader for binary schema encoding            */
/* ------------------------------------------------------------------ */

import { InvalidHashError } from './errors.js';

export class ByteWriter {
  private buf = new Uint8Array(64);
  private len = 0;
  private dv = new DataView(new ArrayBuffer(8));
  private ensure(n: number) {
    if (this.len + n > this.buf.length) {
      const b = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
      b.set(this.buf);
      this.buf = b;
    }
  }
  u8(v: number) { this.ensure(1); this.buf[this.len++] = v & 0xff; }
  bytes(a: Uint8Array) { this.ensure(a.length); this.buf.set(a, this.len); this.len += a.length; }
  uLE(v: number, n: number) { for (let i = 0; i < n; i++) { this.u8(v & 0xff); v = Math.floor(v / 256); } }
  iLE(v: number, n: number) { if (v < 0) v += 256 ** n; this.uLE(v, n); }
  uvar(v: number) { v = Math.floor(v); if (v < 0) throw new InvalidHashError('uvar < 0'); do { let b = v % 128; v = Math.floor(v / 128); if (v > 0) b |= 0x80; this.u8(b); } while (v > 0); }
  ivar(v: number) { this.uvar(v >= 0 ? v * 2 : -v * 2 - 1); }
  f32(v: number) { this.dv.setFloat32(0, v, true); this.bytes(new Uint8Array(this.dv.buffer, 0, 4)); }
  f64(v: number) { this.dv.setFloat64(0, v, true); this.bytes(new Uint8Array(this.dv.buffer, 0, 8)); }
  result() { return this.buf.subarray(0, this.len); }
}

export class ByteReader {
  private p = 0;
  constructor(private a: Uint8Array) {}
  u8() { return this.a[this.p++]; }
  bytes(n: number) { const s = this.a.subarray(this.p, this.p + n); this.p += n; return s; }
  uLE(n: number) { let v = 0, m = 1; for (let i = 0; i < n; i++) { v += this.u8() * m; m *= 256; } return v; }
  iLE(n: number) { const v = this.uLE(n); const half = 256 ** n / 2; return v >= half ? v - 256 ** n : v; }
  uvar() { let r = 0, m = 1, b: number; do { b = this.u8(); r += (b & 0x7f) * m; m *= 128; } while (b & 0x80); return r; }
  ivar() { const z = this.uvar(); return z % 2 === 0 ? z / 2 : -(z + 1) / 2; }
  f32() { const b = this.bytes(4); return new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, true); }
  f64() { const b = this.bytes(8); return new DataView(b.buffer, b.byteOffset, 8).getFloat64(0, true); }
}
