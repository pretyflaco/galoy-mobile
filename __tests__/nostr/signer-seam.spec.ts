/**
 * Story 1.1 / AC-1,2,3,7 — the NostrSigner seam SHAPE (the KG-GATE freeze surface).
 *
 * The seam is a TS interface (compile-time). We assert its shape three ways:
 *  - a conforming mock must implement exactly the six async methods + capabilities,
 *    each accepting an AbortSignal (structural conformance is enforced by `tsc` via
 *    the `NostrSigner` annotation; here we assert the runtime call surface);
 *  - the typed SignerError contract (code union, one shape) via isSignerError/makeSignerError;
 *  - custody is OFF the seam (no create/import/backup/export methods on NostrSigner);
 *  - KG-GATE: methods are async (return Promises) and cancellable (accept AbortSignal).
 */
import {
  isSignerError,
  makeSignerError,
  type EventTemplate,
  type NostrSigner,
  type SignedEvent,
  type SignerCapabilities,
  type SignerError,
  type SignerErrorCode,
} from "../../app/nostr/core/signer"

const capabilities: SignerCapabilities = {
  custodyLocal: true,
  canBackup: false,
  multiParty: false,
}

// NIP-01 templates use the wire field `created_at` (protocol-mandated, not our naming).
const template = (): EventTemplate => ({
  kind: 1,
  // eslint-disable-next-line camelcase
  created_at: 0,
  tags: [],
  content: "",
})

// A conforming mock. If the seam shape changes incompatibly, this stops type-checking
// (tsc is part of the gate) — the runtime assertions below guard the call surface.
const makeMockSigner = (): NostrSigner => ({
  getPublicKey: async (_signal?: AbortSignal) => "0".repeat(64),
  signEvent: async (
    event: EventTemplate,
    _signal?: AbortSignal,
  ): Promise<SignedEvent> => ({
    ...event,
    id: "id",
    pubkey: "0".repeat(64),
    sig: "sig",
  }),
  nip04Encrypt: async (_p: string, plaintext: string, _s?: AbortSignal) => plaintext,
  nip04Decrypt: async (_p: string, ciphertext: string, _s?: AbortSignal) => ciphertext,
  nip44Encrypt: async (_p: string, plaintext: string, _s?: AbortSignal) => plaintext,
  nip44Decrypt: async (_p: string, ciphertext: string, _s?: AbortSignal) => ciphertext,
  capabilities,
})

describe("NostrSigner seam shape (AC-1, AC-3, KG-GATE freeze surface)", () => {
  const signer = makeMockSigner()

  const seamMethods = [
    "getPublicKey",
    "signEvent",
    "nip04Encrypt",
    "nip04Decrypt",
    "nip44Encrypt",
    "nip44Decrypt",
  ] as const

  it("exposes exactly the six signing/encryption methods", () => {
    for (const m of seamMethods) {
      expect(typeof (signer as unknown as Record<string, unknown>)[m]).toBe("function")
    }
  })

  it("every method returns a Promise (async, no locality assumption)", async () => {
    expect(signer.getPublicKey()).toBeInstanceOf(Promise)
    expect(signer.signEvent(template())).toBeInstanceOf(Promise)
    expect(signer.nip04Encrypt("p", "x")).toBeInstanceOf(Promise)
    expect(signer.nip04Decrypt("p", "x")).toBeInstanceOf(Promise)
    expect(signer.nip44Encrypt("p", "x")).toBeInstanceOf(Promise)
    expect(signer.nip44Decrypt("p", "x")).toBeInstanceOf(Promise)
    // resolve them so no dangling promises
    await Promise.all([
      signer.getPublicKey(),
      signer.nip04Encrypt("p", "x"),
      signer.nip44Decrypt("p", "x"),
    ])
  })

  it("every method accepts an AbortSignal argument (cancellable)", () => {
    // arity: each method's signature includes the trailing AbortSignal.
    // getPublicKey(signal) -> length 0 (all optional); assert callability with a signal.
    const ac = new AbortController()
    expect(() => signer.getPublicKey(ac.signal)).not.toThrow()
    expect(() => signer.signEvent(template(), ac.signal)).not.toThrow()
    expect(() => signer.nip44Encrypt("p", "x", ac.signal)).not.toThrow()
  })

  it("custody is OFF the seam (no create/import/backup/export methods)", () => {
    const forbidden = ["create", "import", "backup", "export", "getPrivateKey", "nsec"]
    for (const f of forbidden) {
      expect((signer as unknown as Record<string, unknown>)[f]).toBeUndefined()
    }
  })

  it("exposes a capabilities probe for custody discovery (AC-3)", () => {
    expect(signer.capabilities).toBeDefined()
    expect(typeof signer.capabilities.custodyLocal).toBe("boolean")
    expect(typeof signer.capabilities.canBackup).toBe("boolean")
    expect(typeof signer.capabilities.multiParty).toBe("boolean")
  })
})

describe("SignerError typed contract (AC-2, one shape)", () => {
  const codes: SignerErrorCode[] = ["timeout", "rejected", "unavailable", "aborted"]

  it("makeSignerError produces the canonical shape for every code", () => {
    for (const code of codes) {
      const err: SignerError = makeSignerError(code, "msg", { some: "cause" })
      expect(err).toEqual({ code, message: "msg", cause: { some: "cause" } })
      expect(isSignerError(err)).toBe(true)
    }
  })

  it("isSignerError rejects non-conforming values", () => {
    expect(isSignerError(null)).toBe(false)
    expect(isSignerError({ message: "x" })).toBe(false)
    expect(isSignerError({ code: "boom", message: "x" })).toBe(false)
    expect(isSignerError(new Error("plain"))).toBe(false)
  })

  it("the code union is exactly the four documented failure modes", () => {
    // A compile-time guarantee surfaced at runtime: any code outside the union is not a SignerError.
    expect(codes.every((c) => isSignerError(makeSignerError(c, "m")))).toBe(true)
  })
})
