/* ------------------------------------------------------------------ */
/* Bytes <-> Base-N (BigInt, exact & reversible, leading-zero safe)     */
/* ------------------------------------------------------------------ */

import { InvalidHashError } from './errors.js';

export function encodeBaseN(bytes: Uint8Array, symbols: string[]): string {
  const base = BigInt(symbols.length);

  // Preserve leading zero bytes separately (they would be lost in the BigInt).
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  let num = 0n;
  for (const b of bytes) num = (num << 8n) | BigInt(b);

  const out: string[] = [];
  while (num > 0n) {
    const rem = Number(num % base);
    num = num / base;
    out.push(symbols[rem]);
  }
  for (let i = 0; i < zeros; i++) out.push(symbols[0]);
  return out.reverse().join('');
}

export function decodeBaseN(
  str: string,
  symbols: string[],
  index: Map<string, number>,
): Uint8Array {
  const base = BigInt(symbols.length);
  const zero = symbols[0];
  const chars = [...str]; // tokenize by code points (Unicode/emoji safe)

  let zeros = 0;
  while (zeros < chars.length && chars[zeros] === zero) zeros++;

  let num = 0n;
  for (const ch of chars) {
    const v = index.get(ch);
    if (v === undefined) throw new InvalidHashError(`unknown character: ${ch}`);
    num = num * base + BigInt(v);
  }

  const rev: number[] = [];
  while (num > 0n) {
    rev.push(Number(num & 0xffn));
    num >>= 8n;
  }
  const body = rev.reverse();
  const out = new Uint8Array(zeros + body.length);
  out.set(body, zeros);
  return out;
}
