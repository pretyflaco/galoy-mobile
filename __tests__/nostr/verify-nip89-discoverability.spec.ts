/**
 * Story 4.2 — verify ecosystem discoverability (FR-17 / CAP-9) + iOS foreground-only rollout
 * bound (§7 verdict). AD-15: all under scripts/, none in app/.
 *
 * The live "≥1 real ecosystem client lists Blink" confirmation is inherently operational; here
 * we verify the MECHANISM: a pure predicate over fetched kind-31990 events (authored by the ops
 * identity, declaring the NIP-46 handler, author cross-checked) + the foreground-only rollout
 * bound so the iOS caveat cannot silently drift.
 */
import {
  checkDiscoverable,
  qualifyRolloutCopy,
  IOS_FOREGROUND_ONLY_ROLLOUT_BOUND,
} from "../../scripts/lib/verify-nip89-discoverability"
import {
  buildSignerAdvertisement,
  NIP89_HANDLER_KIND,
  NIP46_KIND,
} from "../../scripts/lib/nip89-advertisement"

const OPS_PUB = "a".repeat(64)
const metadata = { name: "blink", about: "A NIP-46 remote signer." }

const advertEvent = (pubkey = OPS_PUB, kinds = [NIP46_KIND]) => ({
  ...buildSignerAdvertisement({ pubkey, metadata, handledKinds: kinds, createdAt: 1000 }),
  id: "id",
  sig: "sig",
})

const nostrJson = { names: { _: OPS_PUB } }

describe("checkDiscoverable (AC #1)", () => {
  it("discoverable when a kind-31990 event by the ops author declares the NIP-46 handler", () => {
    const result = checkDiscoverable([advertEvent()], {
      authorPubkey: OPS_PUB,
      nostrJson,
    })
    expect(result.discoverable).toBe(true)
  })

  it("NOT discoverable when no kind-31990 event from the ops author is present", () => {
    const other = { ...advertEvent(), kind: 1 } // not a handler advertisement
    const result = checkDiscoverable([other], { authorPubkey: OPS_PUB, nostrJson })
    expect(result.discoverable).toBe(false)
  })

  it("NOT discoverable when the advertisement lacks the NIP-46 k tag (not a signer handler)", () => {
    const noNip46 = advertEvent(OPS_PUB, [30023]) // some other handled kind, not 24133
    const result = checkDiscoverable([noNip46], { authorPubkey: OPS_PUB, nostrJson })
    expect(result.discoverable).toBe(false)
  })

  it("rejects a spoofed advertisement whose author fails the nostr.json cross-check", () => {
    const spoofed = advertEvent("b".repeat(64)) // different author than nostr.json names._
    const result = checkDiscoverable([spoofed], {
      authorPubkey: "b".repeat(64),
      nostrJson,
    })
    expect(result.discoverable).toBe(false)
  })

  it("finds the advertisement among unrelated events", () => {
    const events = [
      { ...advertEvent(), kind: 1 },
      advertEvent(),
      { ...advertEvent(), kind: 0 },
    ]
    expect(
      checkDiscoverable(events, { authorPubkey: OPS_PUB, nostrJson }).discoverable,
    ).toBe(true)
  })
})

describe("iOS foreground-only rollout bound (AC #2, §7 verdict)", () => {
  it("declares iOS foreground-only: no in-background response to a backgrounded user", () => {
    expect(IOS_FOREGROUND_ONLY_ROLLOUT_BOUND.platform).toBe("ios")
    expect(IOS_FOREGROUND_ONLY_ROLLOUT_BOUND.foregroundOnly).toBe(true)
    expect(IOS_FOREGROUND_ONLY_ROLLOUT_BOUND.backgroundResponse).toBe(false)
  })

  it("qualifyRolloutCopy flags copy promising unqualified always-on iOS availability", () => {
    const bad = qualifyRolloutCopy(
      "Sign in with Blink anytime — always available on your iPhone, even when closed.",
    )
    expect(bad.qualified).toBe(false)
  })

  it("qualifyRolloutCopy accepts foreground-bounded / platform-neutral copy", () => {
    const good = qualifyRolloutCopy(
      "Sign in with Blink. On iPhone, open Blink to approve pending requests.",
    )
    expect(good.qualified).toBe(true)
  })
})

describe("AD-15 constants reused from 4.1", () => {
  it("uses the 31990 handler kind and 24133 NIP-46 kind from the builder module", () => {
    expect(NIP89_HANDLER_KIND).toBe(31990)
    expect(NIP46_KIND).toBe(24133)
  })
})
