// Byte- and BigInt-safe value encoding shared by the POC KV stores (F-M1-3).
// SerializedClientState is a bare Uint8Array; StoredKeyPackage nests Uint8Arrays
// and BigInt fields. JSON round-tripping breaks both, so stores encode values as
// JSON with { $u8: base64 } and { $bigint: decimal } tags. JSON-unsafe values
// beyond that (Date, Map, ...) are not supported — POC scope.
const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
const fromHex = (hex) => (hex === "" ? new Uint8Array(0) : new Uint8Array(hex.match(/../g).map((b) => parseInt(b, 16))))

// Hex instead of base64: no atob/btoa dependency, works identically on Node and Hermes.
export const encodeValue = (v) => {
  if (v instanceof Uint8Array) return { $u8: toHex(v) }
  if (typeof v === "bigint") return { $bigint: v.toString() }
  if (Array.isArray(v)) return v.map(encodeValue)
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encodeValue(x)]))
  return v
}

export const decodeValue = (v) => {
  if (Array.isArray(v)) return v.map(decodeValue)
  if (v && typeof v === "object") {
    const keys = Object.keys(v)
    if (keys.length === 1 && typeof v.$u8 === "string") return fromHex(v.$u8)
    if (keys.length === 1 && typeof v.$bigint === "string") return BigInt(v.$bigint)
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decodeValue(x)]))
  }
  return v
}
