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
  readSecretThisDeviceOnly,
  writeSecretThisDeviceOnly,
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

  it("M20 (Hermes #3): device-only writes use the .tdo name and the THIS_DEVICE_ONLY class", async () => {
    setGeneric.mockResolvedValue({ service: "supportchat.key.device.tdo" })
    await writeSecretThisDeviceOnly("supportchat.key.device", "deadbeef")
    const [, value, opts] = setGeneric.mock.calls[0]
    expect(value).toBe("deadbeef")
    expect(opts).toMatchObject({
      service: "supportchat.key.device.tdo",
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    })
  })

  it("M20 (Hermes B): a device-only read of an already-migrated item is a PURE read", async () => {
    getGeneric.mockResolvedValue({
      password: "deadbeef",
      service: "supportchat.key.device.tdo",
    })
    const value = await readSecretThisDeviceOnly("supportchat.key.device")
    expect(value).toBe("deadbeef")
    expect(setGeneric).not.toHaveBeenCalled() // no delete-then-insert on every launch
  })

  it("M20 (Hermes B): a legacy item is migrated copy → verify → delete (same value)", async () => {
    const store = new Map<string, string>([["supportchat.key.device", "deadbeef"]])
    getGeneric.mockImplementation(async ({ service }: { service: string }) =>
      store.has(service) ? { password: store.get(service), service } : false,
    )
    setGeneric.mockImplementation(
      async (_a: string, v: string, opts: { service: string }) => {
        store.set(opts.service, v)
        return { service: opts.service }
      },
    )
    resetGeneric.mockImplementation(async ({ service }: { service: string }) => {
      store.delete(service)
      return true
    })
    const value = await readSecretThisDeviceOnly("supportchat.key.device")
    expect(value).toBe("deadbeef")
    expect(setGeneric).toHaveBeenCalledTimes(1)
    const [, rewritten, opts] = setGeneric.mock.calls[0]
    expect(rewritten).toBe("deadbeef")
    expect(opts.service).toBe("supportchat.key.device.tdo")
    expect(resetGeneric).toHaveBeenCalledWith({ service: "supportchat.key.device" })
  })

  it("M20 (Hermes B): a missing item reads null and writes nothing", async () => {
    getGeneric.mockResolvedValue(false)
    const value = await readSecretThisDeviceOnly("supportchat.key.device")
    expect(value).toBeNull()
    expect(setGeneric).not.toHaveBeenCalled()
  })

  it("M20 (Hermes B): a failed migration throws (the legacy item is kept)", async () => {
    getGeneric.mockImplementation(async ({ service }: { service: string }) =>
      service === "supportchat.key.device" ? { password: "deadbeef", service } : false,
    )
    setGeneric.mockResolvedValue({ service: "supportchat.key.device.tdo" })
    await expect(readSecretThisDeviceOnly("supportchat.key.device")).rejects.toThrow(
      "migration failed",
    )
    expect(resetGeneric).not.toHaveBeenCalled()
  })
})
