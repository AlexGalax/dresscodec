/* ------------------------------------------------------------------ */
/* Format / pattern: regex-like fixed layout (mixed radix)              */
/* ------------------------------------------------------------------ */

import { InvalidHashError } from './errors.js';
import { PAD_SENTINEL } from './transforms-registry.js';

interface FormatSlot { lit?: string; symbols?: string[] }

export interface CompiledFormat {
  pattern: string;
  slots: FormatSlot[];
  dataSymbols: string[][]; // symbol sets of the data positions (left -> right)
  capacity: bigint;        // product of class sizes = max encodable value + 1
  bits: number;            // log2(capacity)
  length: number;          // total length of the formatted string
}

function expandClass(body: string): string[] {
  const cps = [...body];
  const out: string[] = [];
  for (let i = 0; i < cps.length; i++) {
    if (cps[i + 1] === '-' && i + 2 < cps.length) {
      const a = cps[i].codePointAt(0)!, b = cps[i + 2].codePointAt(0)!;
      if (b < a) throw new InvalidHashError(`invalid range in [${body}]`);
      for (let c = a; c <= b; c++) out.push(String.fromCodePoint(c));
      i += 2;
    } else out.push(cps[i]);
  }
  const seen = new Set<string>(), uniq: string[] = [];
  for (const s of out) if (!seen.has(s)) { seen.add(s); uniq.push(s); }
  return uniq;
}

/** Restrictive regex -> fixed format. Supports: [classes], \d \w, (groups), {n}, literals, \-escapes. */
export function compileFormat(pattern: string): CompiledFormat {
  const cps = [...pattern];
  const state = { i: 0, count: 0 };
  const SLOT_CAP = 100000;

  function quant(): number {
    if (cps[state.i] !== '{') return 1;
    let j = state.i + 1, num = '';
    while (j < cps.length && /[0-9]/.test(cps[j])) num += cps[j++];
    if (cps[j] !== '}' || !num) throw new InvalidHashError('quantifier must be {n}');
    state.i = j + 1;
    const n = parseInt(num, 10);
    if (n < 1) throw new InvalidHashError('quantifier {0} not allowed');
    return n;
  }

  function parseClass(): FormatSlot[] {
    let j = state.i + 1, body = '';
    while (j < cps.length && cps[j] !== ']') {
      if (cps[j] === '\\') { body += cps[j + 1] ?? ''; j += 2; }
      else body += cps[j++];
    }
    if (cps[j] !== ']') throw new InvalidHashError('incomplete character class [ ]');
    state.i = j + 1;
    const symbols = expandClass(body);
    if (!symbols.length) throw new InvalidHashError('empty character class');
    return [{ symbols }];
  }

  function parseSeq(insideGroup: boolean): FormatSlot[] {
    const slots: FormatSlot[] = [];
    while (state.i < cps.length) {
      const c = cps[state.i];
      if (c === ')') {
        if (insideGroup) break;
        throw new InvalidHashError('unexpected )');
      }
      let atom: FormatSlot[];
      if (c === '(') {
        state.i++;
        atom = parseSeq(true);
        if (cps[state.i] !== ')') throw new InvalidHashError('incomplete group ( )');
        state.i++;
      } else if (c === '[') {
        atom = parseClass();
      } else if (c === '\\') {
        const nx = cps[state.i + 1]; state.i += 2;
        if (nx === 'd') atom = [{ symbols: expandClass('0-9') }];
        else if (nx === 'w') atom = [{ symbols: expandClass('A-Za-z0-9_') }];
        else atom = [{ lit: nx ?? '' }];
      } else if (c === '^' || c === '$') { state.i++; continue; }
      else if (c === '|') throw new InvalidHashError('alternation | not supported');
      else if (c === '+' || c === '*' || c === '?')
        throw new InvalidHashError(`unbounded quantifier "${c}" not supported`);
      else { atom = [{ lit: c }]; state.i++; }

      const n = quant();
      state.count += atom.length * n;
      if (state.count > SLOT_CAP) throw new InvalidHashError('format too large');
      for (let k = 0; k < n; k++)
        for (const s of atom) slots.push(s.lit !== undefined ? { lit: s.lit } : { symbols: s.symbols });
    }
    return slots;
  }

  const raw = parseSeq(false);

  // merge adjacent literals (cosmetic)
  const slots: FormatSlot[] = [];
  for (const s of raw) {
    const last = slots[slots.length - 1];
    if (s.lit !== undefined && last && last.lit !== undefined) last.lit += s.lit;
    else slots.push(s);
  }

  const dataSymbols: string[][] = [];
  let capacity = 1n, bits = 0, length = 0;
  for (const s of slots) {
    if (s.lit !== undefined) length += [...s.lit].length;
    else { dataSymbols.push(s.symbols!); capacity *= BigInt(s.symbols!.length); bits += Math.log2(s.symbols!.length); length += 1; }
  }
  if (!dataSymbols.length) throw new InvalidHashError('format has no data positions');
  return { pattern, slots, dataSymbols, capacity, bits, length };
}

export function encodeFormat(payload: Uint8Array, f: CompiledFormat): string {
  const framed = new Uint8Array(payload.length + 1);
  framed[0] = PAD_SENTINEL;
  framed.set(payload, 1);
  let V = 0n;
  for (const b of framed) V = (V << 8n) | BigInt(b);
  if (V >= f.capacity)
    throw new InvalidHashError(
      `payload (~${framed.length * 8} bit) does not fit the format (capacity ~${f.bits.toFixed(1)} bit). Use a smaller schema/transform.`,
    );
  const digits = new Array<number>(f.dataSymbols.length).fill(0);
  for (let k = f.dataSymbols.length - 1; k >= 0; k--) {
    const base = BigInt(f.dataSymbols[k].length);
    digits[k] = Number(V % base);
    V = V / base;
  }
  let out = '', di = 0;
  for (const s of f.slots) {
    if (s.lit !== undefined) out += s.lit;
    else out += s.symbols![digits[di++]];
  }
  return out;
}

export function decodeFormat(str: string, f: CompiledFormat): Uint8Array {
  const cps = [...str];
  let pos = 0, V = 0n;
  for (const s of f.slots) {
    if (s.lit !== undefined) {
      for (const lc of [...s.lit]) {
        if (cps[pos] !== lc) throw new InvalidHashError(`format separator "${s.lit}" expected (position ${pos})`);
        pos++;
      }
    } else {
      const ch = cps[pos++];
      const idx = s.symbols!.indexOf(ch);
      if (idx < 0) throw new InvalidHashError(`character "${ch ?? '∅'}" does not fit the format (position ${pos - 1})`);
      V = V * BigInt(s.symbols!.length) + BigInt(idx);
    }
  }
  if (pos !== cps.length) throw new InvalidHashError('input longer than the format allows');
  const rev: number[] = [];
  while (V > 0n) { rev.push(Number(V & 0xffn)); V >>= 8n; }
  const framed = rev.reverse();
  if (!framed.length || framed[0] !== PAD_SENTINEL)
    throw new InvalidHashError('sentinel missing (wrong format?)');
  return new Uint8Array(framed.slice(1));
}
