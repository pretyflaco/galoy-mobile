/**
 * Issue #1 — plain-language action labels derived from the structured entry fields
 * (method / eventKind / uHost), replacing the runtime's technical fallback on the
 * approval surfaces and in the assertive announcement. The i18n namespace is bound
 * from the REAL en templates so the phrases asserted are the shipped ones.
 */
import type { TranslationFunctions } from "@app/i18n/i18n-types"
import en from "@app/i18n/en"

import {
  capitalizeAction,
  isDrasticFollowShrink,
  nostrActionLabel,
} from "@app/screens/nostr/action-label"

type ActionT = TranslationFunctions["NostrActionKind"]

// Bind en template strings ("log in to {host:string}") into callables matching ActionT.
const bind =
  (tpl: string) =>
  (params?: Record<string, string | number>): string =>
    tpl.replace(/\{(\w+):[^}]+\}/g, (_, k: string) => String(params?.[k] ?? ""))
const enActions = (en as { NostrActionKind: Record<string, string> }).NostrActionKind
const T = Object.fromEntries(
  Object.entries(enActions).map(([k, v]) => [k, bind(v)]),
) as unknown as ActionT

const label = (f: Parameters<typeof nostrActionLabel>[1]): string =>
  nostrActionLabel(T, f)

describe("nostrActionLabel — sign_event kinds (NIP-01 registry + NIP-98)", () => {
  it("kind 3 → update your follow list", () => {
    expect(label({ method: "sign_event", eventKind: 3 })).toBe("update your follow list")
  })

  it("kind 3 with a delta names the counts (issue #2 mitigation)", () => {
    expect(
      label({
        method: "sign_event",
        eventKind: 3,
        followDelta: { before: 685, after: 686 },
      }),
    ).toBe("update your follow list (685 → 686 follows)")
    expect(
      label({
        method: "sign_event",
        eventKind: 3,
        followDelta: { before: 685, after: 1 },
      }),
    ).toBe("update your follow list (685 → 1 follows)")
  })

  it("isDrasticFollowShrink flags >50% drops only", () => {
    expect(isDrasticFollowShrink({ before: 685, after: 1 })).toBe(true)
    expect(isDrasticFollowShrink({ before: 100, after: 49 })).toBe(true)
    expect(isDrasticFollowShrink({ before: 100, after: 50 })).toBe(false)
    expect(isDrasticFollowShrink({ before: 685, after: 686 })).toBe(false)
    expect(isDrasticFollowShrink(undefined)).toBe(false)
  })

  it("kind 1 → post a note; kind 0 → update profile; kind 30023 → article", () => {
    expect(label({ method: "sign_event", eventKind: 1 })).toBe("post a note")
    expect(label({ method: "sign_event", eventKind: 0 })).toBe("update your profile")
    expect(label({ method: "sign_event", eventKind: 30023 })).toBe(
      "publish a long-form article",
    )
  })

  it("kind 27235 (NIP-98) names the u-tag host; missing host stays generic", () => {
    expect(label({ method: "sign_event", eventKind: 27235, uHost: "primal.net" })).toBe(
      "log in to primal.net",
    )
    expect(label({ method: "sign_event", eventKind: 27235, uHost: null })).toBe(
      "log in to a website",
    )
  })

  it("unknown kinds fall back to naming the kind number", () => {
    expect(label({ method: "sign_event", eventKind: 9999 })).toBe(
      "sign a kind 9999 event",
    )
    // No eventKind stamped (never happens from the runtime) → method-name fallback.
    expect(label({ method: "sign_event" })).toBe("sign_event")
  })

  it("capability methods map to encrypt/decrypt phrases", () => {
    expect(label({ method: "nip04_encrypt" })).toBe("encrypt a message")
    expect(label({ method: "nip44_encrypt" })).toBe("encrypt a message")
    expect(label({ method: "nip04_decrypt" })).toBe("decrypt a message")
    expect(label({ method: "nip44_decrypt" })).toBe("decrypt a message")
  })

  it("unclassifiable methods use the runtime's fallback phrase, then the method name", () => {
    expect(label({ method: "ping", fallback: "answer a ping" })).toBe("answer a ping")
    expect(label({ method: "ping" })).toBe("ping")
    expect(label({})).toBe("")
  })
})

describe("capitalizeAction — headline form", () => {
  it("capitalizes the first letter only", () => {
    expect(capitalizeAction("update your follow list")).toBe("Update your follow list")
    expect(capitalizeAction("log in to primal.net")).toBe("Log in to primal.net")
    expect(capitalizeAction("")).toBe("")
  })
})
