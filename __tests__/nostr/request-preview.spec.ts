/* eslint-disable camelcase -- test fixtures use the NIP-01 wire field `created_at` verbatim */
/**
 * B4 — structured request-preview builders. Verifies the sign_event panel projects the exact
 * signed fields, content is bounded for display, and the capability (encrypt/decrypt) preview is
 * METADATA ONLY (never the payload — leak-audit gate).
 */
import {
  buildCapabilityPreview,
  buildSignEventPreview,
  formatSignEventPanel,
  formatSignEventPanelFull,
  PREVIEW_CONTENT_MAX,
  PREVIEW_TAG_RENDER_MAX,
} from "../../app/nostr/approval/request-preview"

describe("buildSignEventPreview + formatSignEventPanel (B4)", () => {
  it("projects kind / created_at / content / tags of the event", () => {
    const p = buildSignEventPreview({
      kind: 22242,
      created_at: 1734163200,
      content: "BTCPay Server sign-in challenge: deadbeef",
      tags: [["challenge", "deadbeef"]],
    })
    expect(p).toEqual({
      kind: 22242,
      createdAt: 1734163200,
      content: "BTCPay Server sign-in challenge: deadbeef",
      tags: [["challenge", "deadbeef"]],
    })
    const panel = formatSignEventPanel(p)
    expect(panel).toContain("kind: 22242")
    expect(panel).toContain("created_at: 1734163200")
    expect(panel).toContain('content: "BTCPay Server sign-in challenge: deadbeef"')
    expect(panel).toContain('["challenge","deadbeef"]')
  })

  it("truncates over-long content for display (the full event is still what is signed)", () => {
    const long = "x".repeat(PREVIEW_CONTENT_MAX + 50)
    const p = buildSignEventPreview({ kind: 1, created_at: 1, content: long, tags: [] })
    expect(p.content).toHaveLength(PREVIEW_CONTENT_MAX + 1) // sliced + ellipsis
    expect(p.content.endsWith("…")).toBe(true)
  })

  it("renders empty tags as []", () => {
    const panel = formatSignEventPanel(
      buildSignEventPreview({ kind: 1, created_at: 1, content: "gm", tags: [] }),
    )
    expect(panel).toContain("tags: []")
  })

  it("caps rendered tags with a +N marker (issue #1: kind:3 contact lists)", () => {
    const tags = Array.from({ length: PREVIEW_TAG_RENDER_MAX + 40 }, (_, i) => [
      "p",
      `${i}`.padStart(64, "0"),
    ])
    const panel = formatSignEventPanel(
      buildSignEventPreview({ kind: 3, created_at: 1, content: "", tags }),
    )
    expect(panel.match(/"p"/g)).toHaveLength(PREVIEW_TAG_RENDER_MAX)
    expect(panel).toContain(`… +40 more tags`)
  })

  it("formatSignEventPanelFull carries the EXACT untruncated event (SM-C3)", () => {
    const long = "y".repeat(PREVIEW_CONTENT_MAX + 500)
    const tags = Array.from({ length: PREVIEW_TAG_RENDER_MAX + 10 }, (_, i) => [
      "p",
      `${i}`.padStart(64, "0"),
    ])
    const event = { kind: 3, created_at: 1734163200, content: long, tags }
    const full = formatSignEventPanelFull(event)
    // Content never truncated — the whole payload is present verbatim.
    expect(full).toContain(JSON.stringify(long))
    // Every tag renders — nothing elided.
    expect(full.match(/"p"/g)).toHaveLength(tags.length)
    expect(full).not.toContain("more tags")
    // And the summary differs, so the surface can detect "has more to expand".
    expect(full).not.toBe(formatSignEventPanel(buildSignEventPreview(event)))
  })
})

describe("buildCapabilityPreview — metadata only (B4 / leak-audit)", () => {
  const peer = "a".repeat(64)

  it("describes decrypt without ever including the payload", () => {
    const preview = buildCapabilityPreview("nip44_decrypt", peer)
    expect(preview).toMatch(/^Decrypt a message from /)
    expect(preview).toContain(`${peer.slice(0, 8)}:${peer.slice(-8)}`)
  })

  it("describes encrypt without ever including the payload", () => {
    const preview = buildCapabilityPreview("nip04_encrypt", peer)
    expect(preview).toMatch(/^Encrypt a message to /)
  })

  it("never leaks a payload: the preview is derived only from method + peer", () => {
    // The builder has no payload parameter at all — a structural guarantee.
    expect(buildCapabilityPreview).toHaveLength(2)
  })
})
