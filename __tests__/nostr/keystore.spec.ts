/**
 * Story 1.3 / AC-2, AC-3 — nsec + transport secret live ONLY in the platform keystore
 * via react-native-keychain with AFTER_FIRST_UNLOCK accessibility, namespaced nostr.*.
 * A read before first unlock (keychain returns false) yields nothing.
 */
import * as Keychain from "react-native-keychain"

import {
  readSecret,
  writeSecret,
  clearSecret,
  NOSTR_NSEC_SERVICE,
  NOSTR_TRANSPORT_SERVICE,
} from "../../app/nostr/core/keystore"

const setGeneric = Keychain.setGenericPassword as jest.Mock
const getGeneric = Keychain.getGenericPassword as jest.Mock
const resetGeneric = Keychain.resetGenericPassword as jest.Mock

describe("nostr keystore — keychain confinement (AC-2/AC-3)", () => {
  afterEach(() => {
    setGeneric.mockReset()
    getGeneric.mockReset()
    resetGeneric.mockReset()
  })

  it("writes under the nostr.nsec service with AFTER_FIRST_UNLOCK", async () => {
    setGeneric.mockResolvedValue({ service: NOSTR_NSEC_SERVICE })
    await writeSecret(NOSTR_NSEC_SERVICE, "deadbeef")

    expect(setGeneric).toHaveBeenCalledTimes(1)
    const [account, value, opts] = setGeneric.mock.calls[0]
    expect(value).toBe("deadbeef")
    expect(opts).toMatchObject({
      service: NOSTR_NSEC_SERVICE,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK,
    })
    expect(account).toBeTruthy()
    expect(NOSTR_NSEC_SERVICE).toBe("nostr.nsec")
  })

  it("reads the stored secret back by service", async () => {
    getGeneric.mockResolvedValue({ password: "deadbeef", service: NOSTR_NSEC_SERVICE })
    const value = await readSecret(NOSTR_NSEC_SERVICE)
    expect(getGeneric).toHaveBeenCalledWith({ service: NOSTR_NSEC_SERVICE })
    expect(value).toBe("deadbeef")
  })

  it("read before first unlock (keychain returns false) yields null, not a throw", async () => {
    getGeneric.mockResolvedValue(false)
    await expect(readSecret(NOSTR_NSEC_SERVICE)).resolves.toBeNull()
  })

  it("transport secret uses its own nostr.transportKey service (distinct namespace)", async () => {
    setGeneric.mockResolvedValue({ service: NOSTR_TRANSPORT_SERVICE })
    await writeSecret(NOSTR_TRANSPORT_SERVICE, "cafe")
    const [, , opts] = setGeneric.mock.calls[0]
    expect(opts.service).toBe("nostr.transportKey")
    expect(NOSTR_TRANSPORT_SERVICE).not.toBe(NOSTR_NSEC_SERVICE)
  })

  it("clearSecret resets the keychain entry for the service", async () => {
    resetGeneric.mockResolvedValue(true)
    await clearSecret(NOSTR_NSEC_SERVICE)
    expect(resetGeneric).toHaveBeenCalledWith({ service: NOSTR_NSEC_SERVICE })
  })
})
