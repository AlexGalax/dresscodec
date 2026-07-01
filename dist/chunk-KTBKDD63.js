var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/errors.ts
var InvalidHashError = class extends Error {
  constructor(msg) {
    super(msg);
    this.name = "InvalidHashError";
  }
};

// src/transforms-registry.ts
var transformRegistry = /* @__PURE__ */ new Map();
function registerTransform(name, factory) {
  transformRegistry.set(name, factory);
}
function resolveTransform(name) {
  const f = transformRegistry.get(name);
  if (!f) throw new InvalidHashError(`transform "${name}" not registered`);
  return f();
}
function registeredTransforms() {
  return [...transformRegistry.keys()];
}
var PACK_DELIM = "$";
var PAD_SENTINEL = 1;

export { InvalidHashError, PACK_DELIM, PAD_SENTINEL, __publicField, registerTransform, registeredTransforms, resolveTransform };
