/**
 * M20 invite policy (Hermes review 2026-10-04, finding 1; operator decisions D1/D2).
 *
 * The device's key packages are PUBLIC on the relay (kind 30443), so anyone can send
 * this device a Marmot invite. Before M20 every "joinable" invite was joined
 * unsolicited — a phishing lure that also ended the customer's current ticket.
 *
 * D1: an invite is accepted ONLY when its author is the verified roster bot. The
 * author (`invite.pubkey`) is authenticated by the NIP-59 gift-wrap seal (marmot-ts
 * verifies it on decrypt; PoC C6 in findings/M20-security.md), so this check cannot be
 * spoofed. Defence in depth: the group's admins (readable pre-join via
 * `previewWelcome`) must also include the verified roster bot.
 */

type RosterLabel = { verified: boolean; role?: string }

export const isRosterBot = (l: RosterLabel): boolean => l.verified && l.role === "bot"

/** Push announcements and the like go only into groups the verified roster bot admins. */
export const groupAdminsIncludeBot = (
  adminPubkeys: string[],
  label: (pk: string) => RosterLabel,
): boolean => adminPubkeys.some((pk) => isRosterBot(label(pk)))

/** D1: accept only an invite from the verified roster bot into a bot-admined group. */
export const inviteAcceptable = (
  invitePubkey: string,
  adminPubkeys: string[],
  label: (pk: string) => RosterLabel,
): boolean => {
  if (!isRosterBot(label(invitePubkey))) return false
  return groupAdminsIncludeBot(adminPubkeys, label)
}
