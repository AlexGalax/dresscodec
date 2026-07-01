'use strict';

var fflate = require('fflate');

// src/transforms.ts

// src/transforms-registry.ts
var transformRegistry = /* @__PURE__ */ new Map();
function registerTransform(name, factory) {
  transformRegistry.set(name, factory);
}

// src/transforms.ts
function deflate() {
  return {
    encode: (b) => fflate.deflateSync(b, { level: 9 }),
    decode: (b) => fflate.inflateSync(b)
  };
}
registerTransform("deflate", deflate);

exports.deflate = deflate;
