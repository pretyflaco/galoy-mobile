/**
 * Plain-language action labels for the approval surfaces (issue #1).
 *
 * The UI-free runtime cannot classify requests into human terms (no i18n access), so it sets a
 * generic fallback `humanAction`. The structured fields it ALREADY stamps on the entry —
 * `method`, `eventKind`, `uHost` — are enough to derive a real action phrase at RENDER time,
 * where the i18n context is available. Kind mapping follows the NIP-01 event registry plus
 * NIP-98 (27235 http-auth, origin-bound via the `u` tag host).
 *
 * The label is the phrase used MID-SENTENCE ("PrimalWeb wants to update your follow list");
 * `capitalizeAction` produces the headline form for standalone display.
 */
import type { TranslationFunctions } from "@app/i18n/i18n-types"

/** The structured fields a request-approval entry already carries. */
export type NostrActionFields = {
  method?: string
  eventKind?: number
  uHost?: string | null
  /** Fallback phrase when the method/kind cannot be classified (the runtime's string). */
  fallback?: string
  /** For a kind:3 sign_event: published follow count vs proposed (issue #2 mitigation). */
  followDelta?: { before: number; after: number }
}

/** The i18n namespace these labels read from. */
type ActionT = TranslationFunctions["NostrActionKind"]

/** Base-registry kinds with a dedicated phrase; anything else reads as an unrecognised type. */
const KIND_LABELS: Record<number, (T: ActionT, f: NostrActionFields) => string> = {
  0: (T) => T.updateProfile(),
  1: (T) => T.postNote(),
  // kind 3 is a FULL replacement list — when the raise site could compare against the
  // currently-published list, the headline carries the counts (issue #2 hazard mitigation).
  3: (T, f) =>
    f.followDelta
      ? T.updateFollowListDelta({
          before: f.followDelta.before,
          after: f.followDelta.after,
        })
      : T.updateFollowList(),
  4: (T) => T.sendDirectMessage(),
  6: (T) => T.repostNote(),
  7: (T) => T.reactToNote(),
  22242: (T) => T.relayAuth(),
  30023: (T) => T.publishArticle(),
}

/** True when a kind:3 delta would drop more than half of the followed accounts. */
export const isDrasticFollowShrink = (d?: { before: number; after: number }): boolean =>
  Boolean(d && d.after < d.before / 2)

/**
 * The FR-25 list-shrink warning sentence when the delta is drastic, else undefined. ONE source
 * for every channel that must carry it — the visual banner, the surface's accessible label,
 * and the assertive announcement (Story 3.5: "is announced"; 09 label pattern).
 */
export const followShrinkWarningText = (
  T: TranslationFunctions["NostrRequestApprovalScreen"],
  d?: { before: number; after: number },
): string | undefined =>
  d && isDrasticFollowShrink(d)
    ? T.followShrinkWarning({ before: d.before, after: d.after })
    : undefined

/** Derive the human action phrase, e.g. "update your follow list" / "log in to primal.net". */
export const nostrActionLabel = (T: ActionT, f: NostrActionFields): string => {
  if (f.method === "sign_event") {
    // NIP-98 http-auth: name the origin host when the u-tag parse produced one.
    if (f.eventKind === 27235) {
      return f.uHost ? T.logInTo({ host: f.uHost }) : T.logInGeneric()
    }
    const known = f.eventKind === undefined ? undefined : KIND_LABELS[f.eventKind]
    if (known) return known(T, f)
    // Never a bare kind number in the headline or any accessible label (FR-12, 09 a11y
    // floor) — the number shows only in the visual panel (`kind: N`).
    if (f.eventKind !== undefined) return T.signUnknownEvent()
  }
  if (f.method === "nip04_encrypt" || f.method === "nip44_encrypt")
    return T.encryptMessage()
  if (f.method === "nip04_decrypt" || f.method === "nip44_decrypt")
    return T.decryptMessage()
  return f.fallback ?? f.method ?? ""
}

/** Headline form for standalone display; SR/announce keep the plain phrase. */
export const capitalizeAction = (action: string): string =>
  action.length ? action.charAt(0).toUpperCase() + action.slice(1) : action
