/* ------------------------------------------------------------------ */
/* Presets – ready-made alphabets                                       */
/* ------------------------------------------------------------------ */

import { Reader } from './reader.js';
import type { ReaderOptions } from './reader.js';

export const ALPHABETS = {
  base16: '0123456789abcdef',
  base32: '0123456789ABCDEFGHJKMNPQRSTVWXYZ', // Crockford, without I L O U
  base58: '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz', // Bitcoin
  base62: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  base64url: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
  // "sexy" example sets (all single code point):
  runic: 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ', // Elder Futhark, base24
  geometric: '◇◈◆◊○●◐◑◒◓□■▢▣△▲▽▼◁◀▷▶★☆◢◣◤◥⬟⬢⬡⬠', // base32
} as const;

/** Convenience: standalone codec without a registry. */
export function createReader(name: string, opts: ReaderOptions): Reader {
  return new Reader(name, opts);
}
