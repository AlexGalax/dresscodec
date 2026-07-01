interface Transform {
    encode(bytes: Uint8Array): Uint8Array;
    decode(bytes: Uint8Array): Uint8Array;
}
declare function registerTransform(name: string, factory: () => Transform): void;
declare function resolveTransform(name: string): Transform;
declare function registeredTransforms(): string[];
/** Reserved delimiter for self-contained tokens (KEY$MESSAGE). */
declare const PACK_DELIM = "$";

export { PACK_DELIM as P, type Transform as T, registeredTransforms as a, resolveTransform as b, registerTransform as r };
