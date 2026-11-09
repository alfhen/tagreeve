// Not re-exported from index.ts: the set decides how every later run is judged, so only this package and its tests reach it.
export const HASH_REQUIRED_VENDORS: ReadonlySet<string> = new Set(['meta-capi']);
