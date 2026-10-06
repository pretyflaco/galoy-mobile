/**
 * M19: the support chat's own per-device key. Created once and kept in the keychain
 * (never regenerated while it exists), signs verifiable events, and does NIP-44 both ways
 * — with every random value from the injected CSPRNG.
 */
import { verifyEvent } from "nostr-tools/pure"
import { bytesToHex } from "@noble/hashes/utils.js"

const keychain = new Map<string, string>()
jest.mock("@app/nostr/core/keystore", () => ({
  readSecret: jest.fn(async (service: string) => keychain.get(service) ?? null),
  writeSecret: jest.fn(async (service: string, hex: string) => {
    keychain.set(service, hex)
  }),
  // M20 device-only variants share the in-memory map
  readSecretThisDeviceOnly: jest.fn(
    async (service: string) => keychain.get(service) ?? null,
  ),
  writeSecretThisDeviceOnly: jest.fn(async (service: string, hex: string) => {
    keychain.set(service, hex)
  }),
}))
let counter = 0
jest.mock("@app/nostr/core/keygen", () => ({
  ...jest.requireActual("@app/nostr/core/keygen"),
  // distinct, valid draws (the global mock returns a constant)
  secureRandomBytes: (n: number) => {
    counter += 1
    return Uint8Array.from({ length: n }, (_, i) => (i * 7 + counter) % 251)
  },
}))

const load = () =>
  new Promise<typeof import("@app/support-chat/support-key")>((resolve) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    jest.isolateModules(() => resolve(require("@app/support-chat/support-key")))
  })

describe("support key (M19)", () => {
  beforeEach(() => keychain.clear())

  it("is created once and then read back from the keychain", async () => {
    const a = await (await load()).loadOrCreateSupportKey()
    expect(keychain.get("supportchat.key.device")).toBe(bytesToHex(a))
    const b = await (await load()).loadOrCreateSupportKey() // a fresh module = an app restart
    expect(bytesToHex(b)).toBe(bytesToHex(a))
    expect(keychain.size).toBe(1)
  })

  it("refuses an invalid stored key instead of silently replacing it", async () => {
    keychain.set("supportchat.key.device", "00".repeat(32))
    await expect((await load()).loadOrCreateSupportKey()).rejects.toThrow(/invalid/)
    expect(keychain.get("supportchat.key.device")).toBe("00".repeat(32))
  })

  it("signs verifiable events and round-trips NIP-44 with a peer", async () => {
    const m = await load()
    const alice = m.createSupportSigner(await m.loadOrCreateSupportKey())
    keychain.clear()
    const bob = m.createSupportSigner(await (await load()).loadOrCreateSupportKey())
    // eslint-disable-next-line camelcase
    const ev = await alice.signEvent({ kind: 9, tags: [], content: "hi", created_at: 1 })
    expect(ev.pubkey).toBe(await alice.getPublicKey())
    expect(verifyEvent(ev as Parameters<typeof verifyEvent>[0])).toBe(true)
    const alicePk = await alice.getPublicKey()
    const bobPk = await bob.getPublicKey()
    expect(alicePk).not.toBe(bobPk)
    const ct = await alice.nip44.encrypt(bobPk, "secret")
    expect(await bob.nip44.decrypt(alicePk, ct)).toBe("secret")
  })
})
