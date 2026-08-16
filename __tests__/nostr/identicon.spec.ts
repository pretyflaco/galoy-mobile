/**
 * Story 1.5 / AC-3, AC-9 — deterministic identicon from the pubkey. Same pubkey ⇒ same
 * face; different pubkey ⇒ (almost always) a different face; derived from public key
 * only; grid is symmetric (mirrored) for a stable identity cue.
 */
import { deriveIdenticon, IDENTICON_SIZE } from "../../app/nostr/core/identicon"

const PUB_A = "a".repeat(64)
const PUB_B = "b".repeat(64)

describe("deriveIdenticon (AC-3)", () => {
  it("is deterministic for a fixed pubkey", () => {
    expect(deriveIdenticon(PUB_A)).toEqual(deriveIdenticon(PUB_A))
  })

  it("differs for different pubkeys", () => {
    const a = deriveIdenticon(PUB_A)
    const b = deriveIdenticon(PUB_B)
    expect(a.cells).not.toEqual(b.cells)
  })

  it("produces a full IDENTICON_SIZE x IDENTICON_SIZE grid", () => {
    const { cells } = deriveIdenticon(PUB_A)
    expect(cells).toHaveLength(IDENTICON_SIZE * IDENTICON_SIZE)
  })

  it("is left-right mirrored (stable, face-like)", () => {
    const { cells } = deriveIdenticon(PUB_A)
    for (let row = 0; row < IDENTICON_SIZE; row += 1) {
      for (let col = 0; col < IDENTICON_SIZE; col += 1) {
        const mirror = IDENTICON_SIZE - 1 - col
        expect(cells[row * IDENTICON_SIZE + col]).toBe(
          cells[row * IDENTICON_SIZE + mirror],
        )
      }
    }
  })

  it("yields a color and echoes the (lowercased) pubkey — never any secret", () => {
    const model = deriveIdenticon(PUB_A.toUpperCase())
    expect(model.color).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
    expect(model.pubkeyHex).toBe(PUB_A) // lowercased
  })
})
