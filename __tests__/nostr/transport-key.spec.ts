/**
 * Story 1.3 / AC-3 — the transport keypair: generated once via the 1.2 keygen path,
 * distinct from the identity key, device-local, stored under nostr.transportKey, never
 * backed up, never rotated in v1, and OUTSIDE the NostrSigner seam.
 */
import * as Keychain from "react-native-keychain"

import * as transportApi from "../../app/nostr/transport/transport-key"
import { provisionTransportKey } from "../../app/nostr/transport/transport-key"
import * as signerModule from "../../app/nostr/core/local-nsec-signer"
import { NOSTR_TRANSPORT_SERVICE } from "../../app/nostr/core/keystore"

const setGeneric = Keychain.setGenericPassword as jest.Mock
const getGeneric = Keychain.getGenericPassword as jest.Mock

describe("transport key provisioning (AC-3)", () => {
  afterEach(() => {
    setGeneric.mockReset()
    getGeneric.mockReset()
  })

  it("generates once, stores under nostr.transportKey with AFTER_FIRST_UNLOCK", async () => {
    getGeneric.mockResolvedValue(false) // none stored yet
    setGeneric.mockResolvedValue({ service: NOSTR_TRANSPORT_SERVICE })

    const pubHex = await provisionTransportKey()

    expect(pubHex).toMatch(/^[0-9a-f]{64}$/) // x-only pubkey hex
    expect(setGeneric).toHaveBeenCalledTimes(1)
    const [, , opts] = setGeneric.mock.calls[0]
    expect(opts).toMatchObject({
      service: NOSTR_TRANSPORT_SERVICE,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK,
    })
  })

  it("does not regenerate if a transport key already exists (never rotated)", async () => {
    getGeneric.mockResolvedValue({
      password: "1".repeat(64),
      service: NOSTR_TRANSPORT_SERVICE,
    })
    await provisionTransportKey()
    expect(setGeneric).not.toHaveBeenCalled() // no overwrite / rotation
  })

  it("the transport key is DISTINCT from the identity key", async () => {
    getGeneric.mockResolvedValue(false)
    setGeneric.mockResolvedValue({ service: NOSTR_TRANSPORT_SERVICE })

    const captured: string[] = []
    setGeneric.mockImplementation((_acct: string, value: string) => {
      captured.push(value)
      return Promise.resolve({ service: NOSTR_TRANSPORT_SERVICE })
    })

    await provisionTransportKey()
    const identitySecret = "0".repeat(63) + "5"
    expect(captured[0]).not.toBe(identitySecret)
  })

  it("exposes NO rotation entrypoint and is not on the NostrSigner seam", () => {
    expect((transportApi as Record<string, unknown>).rotateTransportKey).toBeUndefined()
    // the seam (LocalNsecSigner) has no transport-key surface
    const signer = signerModule.createLocalNsecSigner({ readNsecHex: async () => "05" })
    expect((signer as unknown as Record<string, unknown>).transportKey).toBeUndefined()
    expect((signer as unknown as Record<string, unknown>).getTransportKey).toBeUndefined()
  })
})
