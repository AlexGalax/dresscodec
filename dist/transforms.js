import { registerTransform } from './chunk-KTBKDD63.js';
import { inflateSync, deflateSync } from 'fflate';

function deflate() {
  return {
    encode: (b) => deflateSync(b, { level: 9 }),
    decode: (b) => inflateSync(b)
  };
}
registerTransform("deflate", deflate);

export { deflate };
