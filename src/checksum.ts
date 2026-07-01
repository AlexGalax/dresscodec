/* ------------------------------------------------------------------ */
/* Checksum (CRC32, low-N bytes) – typo detection + reader discriminator */
/* ------------------------------------------------------------------ */

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function checksumBytes(bytes: Uint8Array, n: number): Uint8Array {
  if (n <= 0) return new Uint8Array(0);
  const c = crc32(bytes);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[n - 1 - i] = (c >>> (8 * i)) & 0xff;
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
