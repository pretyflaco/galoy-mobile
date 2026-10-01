/**
 * Pinned roster key + shipped signed snapshot for the support chat.
 *
 * Spec 03 §4 req 3: the app is the control for who is Blink Support — it pins ONE
 * roster key and fails closed without a valid roster. The shipped snapshot seeds
 * the very first run (patternn review point): the RosterVerifier re-verifies its
 * signature and applies the same floor/expiry rules as to a relay event, and a live
 * roster (newer `created_at`) replaces it.
 *
 * Source: build-time config only (react-native-config: the CI smoke's throwaway key,
 * the dogfood build's product key). P7: there is NO committed default — a build
 * without SUPPORT_ROSTER_PUBKEY pins nothing and the chat fails closed (and the
 * feature is off unless the build opts in, see feature-flags-context).
 */
import Config from "react-native-config"
import type { Event } from "nostr-tools/pure"

const configuredKey = Config?.SUPPORT_ROSTER_PUBKEY
export const SUPPORT_ROSTER_PUBKEY: string =
  typeof configuredKey === "string" && /^[0-9a-f]{64}$/.test(configuredKey)
    ? configuredKey
    : ""

function parseConfiguredSnapshot(): Event | null {
  const raw = Config?.SUPPORT_ROSTER_SNAPSHOT
  if (typeof raw !== "string" || !raw.startsWith("{")) return null
  try {
    const event = JSON.parse(raw) as Event
    if (event?.pubkey !== SUPPORT_ROSTER_PUBKEY) return null // snapshot must match the pin
    return event
  } catch {
    return null
  }
}

export const ROSTER_SNAPSHOT: Event | null = SUPPORT_ROSTER_PUBKEY
  ? parseConfiguredSnapshot()
  : null
