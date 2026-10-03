/**
 * Deterministic identicon derivation from a pubkey (Story 1.5 / AC-3).
 *
 * Pure hash→grid derivation: the same pubkey ALWAYS yields the same identicon; it is
 * derived only from the PUBLIC key (never the nsec, which is never touched here). The
 * output is a plain data model (grid + colors) that the result screen renders as SVG
 * via the already-present react-native-svg — no new dependency.
 *
 * AD-1: core is UI-free (this returns data, not React).
 */
import { sha256 } from "@noble/hashes/sha2.js"
import { hexToBytes } from "@noble/hashes/utils.js"

/** Identicon is a 5x5 grid, mirrored left-right for a stable "face". */
export const IDENTICON_SIZE = 5

export interface IdenticonModel {
  /** Row-major boolean grid (IDENTICON_SIZE x IDENTICON_SIZE); true = filled cell. */
  cells: boolean[]
  /** Foreground color (hsl string) derived from the hash. */
  color: string
  /** The pubkey this identicon was derived from (hex, lowercase). */
  pubkeyHex: string
}

const hashOf = (pubkeyHex: string): Uint8Array => {
  // Accept hex pubkey; hash it so grid/color are stable and well-distributed.
  const bytes =
    /^[0-9a-f]+$/i.test(pubkeyHex) && pubkeyHex.length % 2 === 0
      ? hexToBytes(pubkeyHex.toLowerCase())
      : new TextEncoder().encode(pubkeyHex)
  return sha256(bytes)
}

/**
 * Derive a deterministic identicon model from a pubkey (x-only hex or npub-hex).
 * Mirrored 5x5 grid; hue from the hash for a distinct, stable color.
 */
export const deriveIdenticon = (pubkeyHex: string): IdenticonModel => {
  const hash = hashOf(pubkeyHex)
  const half = Math.ceil(IDENTICON_SIZE / 2) // 3 columns, mirrored to 5
  const cells: boolean[] = new Array(IDENTICON_SIZE * IDENTICON_SIZE).fill(false)

  for (let row = 0; row < IDENTICON_SIZE; row += 1) {
    for (let col = 0; col < half; col += 1) {
      // One hash byte per left-half cell; fill on even value (deterministic).
      const idx = row * half + col
      const filled = hash[idx % hash.length] % 2 === 0
      const mirrorCol = IDENTICON_SIZE - 1 - col
      cells[row * IDENTICON_SIZE + col] = filled
      cells[row * IDENTICON_SIZE + mirrorCol] = filled
    }
  }

  const hue = (hash[hash.length - 1] * 256 + hash[hash.length - 2]) % 360
  const color = `hsl(${hue}, 62%, 48%)`

  return { cells, color, pubkeyHex: pubkeyHex.toLowerCase() }
}
