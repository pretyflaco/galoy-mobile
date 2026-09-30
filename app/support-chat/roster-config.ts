/**
 * Pinned roster key + shipped signed snapshot for the support chat.
 *
 * Spec 03 §4 req 3: the app is the control for who is Blink Support — it pins ONE
 * roster key and fails closed without a valid roster. The shipped snapshot seeds
 * the very first run (patternn review point): the RosterVerifier re-verifies its
 * signature and applies the same floor/expiry rules as to a relay event, and a live
 * roster (newer `created_at`) replaces it.
 *
 * Sources, in order: build-time config (react-native-config — the CI smoke points
 * the app at its own throwaway roster key + snapshot + local relay; also the P7
 * "config-driven roster key" direction), then the committed DEV defaults.
 *
 * DEV DEFAULTS are a THROWAWAY test key (blink-support-chat interop/v2/
 * make-roster-snapshot.mjs, state in the git-ignored interop/.p1-state/) — never
 * the product roster key (Amber custody, AGENTS.md). P7 removes the dev defaults
 * entirely (no test identities in shipped builds). The listed bot is the REAL bot
 * identity (d30a8b87…, the long-lived POC bot key the v2 bot runs on).
 */
import Config from "react-native-config"
import type { Event } from "nostr-tools/pure"

export const SUPPORT_ROSTER_PUBKEY: string =
  typeof Config?.SUPPORT_ROSTER_PUBKEY === "string" && Config.SUPPORT_ROSTER_PUBKEY.length === 64
    ? Config.SUPPORT_ROSTER_PUBKEY
    : "165567414598ec00ebf368269a1e491cb0279c0d4f404a69ff1d9df8a5fd705d"

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

export const ROSTER_SNAPSHOT: Event =
  parseConfiguredSnapshot() ??
  ({
    kind: 30000,
    created_at: 1790776195,
    tags: [
      ["d", "blink-support-team"],
      ["title", "Blink Support team"],
      [
        "p",
        "d30a8b87aab61319782e60ca1adf07e400d8522fdb86bae84c0959f7224355e7",
        "",
        "P1 Test Bot",
      ],
      [
        "role",
        "d30a8b87aab61319782e60ca1adf07e400d8522fdb86bae84c0959f7224355e7",
        "bot",
      ],
      ["expiration", "1798675200"],
    ],
    content: "",
    pubkey: "165567414598ec00ebf368269a1e491cb0279c0d4f404a69ff1d9df8a5fd705d",
    id: "885b8fe81ced8be2728ed8da258a33770c43741d14f36f214310f27e672b9202",
    sig: "3ec6ac4b1531eaf5babf70d12b6d46525d12c8711e2c4796924f51ed8ee92f8c388db3cbbeb7ab4461930c4cb4119d435239b134579c1b4e825924baa8901791",
  } satisfies Event)
