/**
 * Story 1.5 / AC-8 — ceremony funnel analytics (SM-5) fire through the existing
 * substrate and are metadata-only: NO npub, key material, plaintext, or content.
 */
import analytics from "@react-native-firebase/analytics"

import {
  logNostrIdentityCeremonyStarted,
  logNostrIdentityCeremonyCompleted,
} from "../../app/nostr/analytics"

jest.mock("@react-native-firebase/analytics", () => {
  const logEvent = jest.fn()
  return { __esModule: true, default: () => ({ logEvent }) }
})

const logEvent = (analytics() as unknown as { logEvent: jest.Mock }).logEvent

describe("ceremony funnel analytics (AC-8 / SM-5)", () => {
  afterEach(() => logEvent.mockClear())

  it("started fires with a metadata-only (empty) payload", () => {
    logNostrIdentityCeremonyStarted()
    expect(logEvent).toHaveBeenCalledWith("nostr_identity_ceremony_started")
    // no payload argument carrying npub/key material
    expect(logEvent.mock.calls[0]).toHaveLength(1)
  })

  it("completed fires with no npub / key material in the payload", () => {
    logNostrIdentityCeremonyCompleted()
    expect(logEvent).toHaveBeenCalledWith("nostr_identity_ceremony_completed")
    const payload = logEvent.mock.calls[0][1]
    expect(payload).toBeUndefined()
  })
})
