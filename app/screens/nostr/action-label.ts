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
}

/** The i18n namespace these labels read from. */
type ActionT = TranslationFunctions["NostrActionKind"]

/** Base-registry kinds with a dedicated phrase; anything else falls back to the kind number. */
const KIND_LABELS: Record<number, (T: ActionT) => string> = {
  0: (T) => T.updateProfile(),
  1: (T) => T.postNote(),
  3: (T) => T.updateFollowList(),
  4: (T) => T.sendDirectMessage(),
  6: (T) => T.repostNote(),
  7: (T) => T.reactToNote(),
  22242: (T) => T.relayAuth(),
  30023: (T) => T.publishArticle(),
}

/** Derive the human action phrase, e.g. "update your follow list" / "log in to primal.net". */
export const nostrActionLabel = (T: ActionT, f: NostrActionFields): string => {
  if (f.method === "sign_event") {
    // NIP-98 http-auth: name the origin host when the u-tag parse produced one.
    if (f.eventKind === 27235) {
      return f.uHost ? T.logInTo({ host: f.uHost }) : T.logInGeneric()
    }
    const known = f.eventKind === undefined ? undefined : KIND_LABELS[f.eventKind]
    if (known) return known(T)
    if (f.eventKind !== undefined) return T.signKindEvent({ kind: f.eventKind })
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
