/**
 * Story 1.2 — fail-closed key generation (AD-6 / NFR-4).
 *
 * generateNostrKey() draws 32 bytes from the platform CSPRNG (react-native-quick-crypto
 * native randomBytes), validates the secp256k1 scalar range, and injects the bytes
 * EXPLICITLY into @noble/curves. It never uses noble's no-arg generator / webcrypto,
 * never polyfills global.crypto, and throws (creating no key) if the native RNG is
 * unavailable.
 *
 * The repo's deterministic quick-crypto mock returns Buffer.alloc(size, 0xab) — a
 * constant fill. Tests override it per-case to exercise valid/invalid/absent RNG.
 */
import Crypto from "react-native-quick-crypto"
import { schnorr } from "@noble/curves/secp256k1.js"

import {
  generateNostrKey,
  isValidSecpScalar,
  assertSecureRng,
  secureRandomBytes,
} from "../../app/nostr/core/keygen"

const mockedRandomBytes = Crypto.randomBytes as jest.Mock

const setRandomBytes = (impl: (size: number) => Uint8Array | Buffer) => {
  mockedRandomBytes.mockImplementation(impl as unknown as (size: number) => Buffer)
}

// A known valid scalar: 0x…01 (32 bytes, big-endian value 1).
const scalarOne = (): Uint8Array => {
  const b = new Uint8Array(32)
  b[31] = 1
  return b
}

describe("generateNostrKey — explicit entropy injection (AC-1)", () => {
  afterEach(() => {
    mockedRandomBytes.mockReset()
  })

  it("consumes randomBytes(32) and derives the matching secp256k1 pubkey", () => {
    const known = scalarOne()
    setRandomBytes(() => known)

    const { privKeyHex, pubKeyHex } = generateNostrKey()

    expect(mockedRandomBytes).toHaveBeenCalledWith(32)
    // pub derived explicitly from the injected bytes (x-only BIP-340, 32 bytes = 64 hex —
    // Nostr's canonical pubkey form; the signer/hub derive it the same way)
    const expectedPub = Buffer.from(schnorr.getPublicKey(known)).toString("hex")
    expect(privKeyHex).toBe(Buffer.from(known).toString("hex"))
    expect(pubKeyHex).toBe(expectedPub)
    expect(pubKeyHex).toMatch(/^[0-9a-f]{64}$/)
    expect(privKeyHex).toMatch(/^[0-9a-f]{64}$/)
  })

  it("redraws when the first draw is an out-of-range scalar (0 or >= n)", () => {
    const zero = new Uint8Array(32) // invalid
    const good = scalarOne()
    let call = 0
    setRandomBytes(() => {
      const isFirst = call === 0
      call += 1
      return isFirst ? zero : good
    })

    const { privKeyHex } = generateNostrKey()

    expect(mockedRandomBytes).toHaveBeenCalledTimes(2)
    expect(privKeyHex).toBe(Buffer.from(good).toString("hex"))
  })
})

describe("isValidSecpScalar (scalar-range validation)", () => {
  it("rejects all-zero and >= n, accepts a valid scalar", () => {
    expect(isValidSecpScalar(new Uint8Array(32))).toBe(false)
    expect(isValidSecpScalar(new Uint8Array(32).fill(0xff))).toBe(false)
    expect(isValidSecpScalar(scalarOne())).toBe(true)
  })
})

describe("fail-closed when native RNG unavailable (AC-3)", () => {
  afterEach(() => mockedRandomBytes.mockReset())

  it("throws and returns no key when randomBytes throws", () => {
    setRandomBytes(() => {
      throw new Error("native RNG missing")
    })
    expect(() => generateNostrKey()).toThrow()
  })

  it("throws when repeated draws never yield a valid scalar (no weak fallback)", () => {
    setRandomBytes(() => new Uint8Array(32)) // always invalid
    expect(() => generateNostrKey()).toThrow()
  })
})

describe("secureRandomBytes — explicit injection helper (AC-5)", () => {
  afterEach(() => mockedRandomBytes.mockReset())

  it("draws from native quick-crypto randomBytes (NIP-44 nonce / NIP-04 IV / Schnorr auxRand source)", () => {
    const known = new Uint8Array([1, 2, 3, 4])
    setRandomBytes(() => known)
    const out = secureRandomBytes(4)
    expect(mockedRandomBytes).toHaveBeenCalledWith(4)
    expect(Array.from(out)).toEqual([1, 2, 3, 4])
  })

  it("fails closed (throws) if the native RNG is unavailable", () => {
    setRandomBytes(() => {
      throw new Error("no native RNG")
    })
    expect(() => secureRandomBytes(12)).toThrow()
  })

  it("throws on short/unusable output rather than returning weak entropy", () => {
    setRandomBytes(() => new Uint8Array(2)) // asked for more than returned
    expect(() => secureRandomBytes(12)).toThrow()
  })
})

describe("release RNG sanity check (AC-4)", () => {
  afterEach(() => mockedRandomBytes.mockReset())

  it("rejects the deterministic mock's constant output", () => {
    setRandomBytes((size: number) => Buffer.alloc(size, 0xab)) // the mock pattern
    expect(() => assertSecureRng()).toThrow()
  })

  it("passes when draws are non-constant (real RNG shape)", () => {
    let n = 0
    setRandomBytes((size: number) => {
      const b = new Uint8Array(size)
      b[0] = n
      n += 1
      return b
    })
    expect(() => assertSecureRng()).not.toThrow()
  })
})
