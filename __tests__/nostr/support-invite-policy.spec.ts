/**
 * M20 invite policy (Hermes review finding 1; operator decisions D1/D2): only the
 * verified roster bot may start a conversation with this device, and only into a
 * group it admins. PoC + rationale: findings/M20-security.md (blink-support-chat).
 */
import {
  groupAdminsIncludeBot,
  inviteAcceptable,
  isRosterBot,
} from "@app/support-chat/invite-policy"

const BOT = "b".repeat(64)
const AGENT = "a".repeat(64)
const ATTACKER = "e".repeat(64)

/** The roster label lookup (roster signature verified upstream by RosterVerifier). */
const label = (pk: string) => {
  if (pk === BOT) return { verified: true, role: "bot" }
  if (pk === AGENT) return { verified: true, role: "agent" }
  return { verified: false }
}

describe("M20 invite policy", () => {
  it("accepts an invite from the verified roster bot into a bot-admined group", () => {
    expect(inviteAcceptable(BOT, [BOT, AGENT], label)).toBe(true)
  })

  it("refuses an invite from an unverified key, even into a group it claims to admin", () => {
    // the PoC case: the attacker is the only admin of the group it created
    expect(inviteAcceptable(ATTACKER, [ATTACKER], label)).toBe(false)
  })

  it("refuses a roster AGENT as inviter (D1: the bot only)", () => {
    expect(inviteAcceptable(AGENT, [AGENT], label)).toBe(false)
  })

  it("refuses a bot invite into a group the bot does not admin", () => {
    // defence in depth: the inviter is the bot, but the group would be attacker-admined
    expect(inviteAcceptable(BOT, [ATTACKER], label)).toBe(false)
    expect(inviteAcceptable(BOT, [], label)).toBe(false)
  })

  it("an unverified key listed as an admin does not count", () => {
    expect(groupAdminsIncludeBot([ATTACKER], label)).toBe(false)
    expect(groupAdminsIncludeBot([ATTACKER, AGENT], label)).toBe(false)
    expect(groupAdminsIncludeBot([ATTACKER, BOT], label)).toBe(true)
  })

  it("isRosterBot requires BOTH verified and the bot role", () => {
    expect(isRosterBot({ verified: true, role: "bot" })).toBe(true)
    expect(isRosterBot({ verified: true, role: "agent" })).toBe(false)
    expect(isRosterBot({ verified: false, role: "bot" })).toBe(false)
    expect(isRosterBot({ verified: false })).toBe(false)
  })
})
