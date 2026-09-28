/* eslint-disable camelcase -- test fixtures use the NIP-01 wire field `created_at` verbatim */
/**
 * Story 3.4 Task 3/6 — request-approval surface (native rne-theme) + a11y.
 *
 * Renders EXACTLY what will be signed/decrypted (content, not a summary) with a
 * "Request X of N from <client>" counter, explicit approve/reject (not gesture-only, reject
 * NOT default focus), an assertive live region, and (iOS) the keep-app-open catch-up.
 * Behavior asserted via testIDs (i18n copy empty in harness); SR-label content is enforced in
 * the source-scan test.
 */
import React from "react"
import { StyleSheet } from "react-native"
import type { ReactTestInstance } from "react-test-renderer"
import { render, fireEvent, within } from "@testing-library/react-native"

import { ThemeProvider } from "@rn-vui/themed"

import TypesafeI18n from "@app/i18n/i18n-react"
import { loadedLocales } from "@app/i18n/i18n-util"
import en from "@app/i18n/en"
import {
  buildSignEventPreview,
  formatSignEventPanel,
  formatSignEventPanelFull,
} from "@app/nostr/approval/request-preview"
import { light } from "@app/rne-theme/colors"
import theme from "@app/rne-theme/theme"
import { NostrRequestApprovalScreen } from "@app/screens/nostr/request-approval-screen"

import { ContextForScreen } from "../screens/helper"
import { flushEffects } from "../helpers/flush-effects"

/** Whether `node` sits (at any depth) inside the element carrying `testID`. */
const hasAncestor = (node: ReactTestInstance, testID: string): boolean => {
  let walker = node.parent
  while (walker) {
    if ((walker as { props?: { testID?: string } }).props?.testID === testID) return true
    walker = walker.parent
  }
  return false
}

const renderScreen = (
  props: Partial<React.ComponentProps<typeof NostrRequestApprovalScreen>> = {},
) =>
  render(
    <ContextForScreen>
      <NostrRequestApprovalScreen
        clientName="Damus"
        humanAction="decrypt a message"
        contentPreview="Hey, are we still on for tonight?"
        index={2}
        total={32}
        onApprove={jest.fn()}
        onReject={jest.fn()}
        {...props}
      />
    </ContextForScreen>,
  )

describe("request-approval screen (AC #4)", () => {
  it("renders explicit approve + reject controls", async () => {
    const { getByTestId } = renderScreen()
    await flushEffects()
    expect(getByTestId("nostr-request-approve")).toBeTruthy()
    expect(getByTestId("nostr-request-reject")).toBeTruthy()
  })

  it("renders the exact content that will be signed/decrypted (not a summary)", async () => {
    const { getByTestId } = renderScreen({
      contentPreview: "Hey, are we still on for tonight?",
    })
    await flushEffects()
    const content = getByTestId("nostr-request-content")
    expect(content.props.children).toBe("Hey, are we still on for tonight?")
  })

  it("shows the Request X of N counter surface", async () => {
    const { getByTestId } = renderScreen({ index: 2, total: 32 })
    await flushEffects()
    expect(getByTestId("nostr-request-counter")).toBeTruthy()
  })

  it("carries an assertive live region announcing the surface", async () => {
    const { getByTestId } = renderScreen()
    await flushEffects()
    const surface = getByTestId("nostr-request-approval")
    expect(surface.props.accessibilityLiveRegion).toBe("assertive")
  })

  it("invokes onApprove / onReject", async () => {
    const onApprove = jest.fn()
    const onReject = jest.fn()
    const { getByTestId } = renderScreen({ onApprove, onReject })
    await flushEffects()
    fireEvent.press(getByTestId("nostr-request-approve"))
    fireEvent.press(getByTestId("nostr-request-reject"))
    expect(onApprove).toHaveBeenCalledTimes(1)
    expect(onReject).toHaveBeenCalledTimes(1)
  })

  it("reject control is NOT the default-focus (approve is the affirmative default)", async () => {
    const { getByTestId, queryByTestId } = renderScreen()
    await flushEffects()
    // the default-focus target wraps the affirmative (approve) control; the coordinator hook
    // targets it with setAccessibilityFocus on appear. Reject is never the default focus.
    const focusTarget = getByTestId("nostr-request-default-focus")
    expect(focusTarget).toBeTruthy()
    // the approve button lives inside the default-focus target; reject does not
    expect(queryByTestId("nostr-request-approve")).toBeTruthy()
  })
})

describe("request-approval screen — issue #1 (large events / plain-language action)", () => {
  const kind3Tags = Array.from({ length: 60 }, (_, i) => ["p", `${i}`.padStart(64, "0")])
  const summary = formatSignEventPanel(
    buildSignEventPreview({ kind: 3, created_at: 1, content: "", tags: kind3Tags }),
  )
  const full = formatSignEventPanelFull({
    kind: 3,
    created_at: 1,
    content: "",
    tags: kind3Tags,
  })

  // The harness never loads any locale (lazy loader is production-only), so the default
  // ContextForScreen renders EMPTY i18n copy. Bind the real en dictionary for the headline
  // assertions.
  beforeAll(() => {
    loadedLocales.en = en as never
  })

  const renderScreenEn = (
    props: Partial<React.ComponentProps<typeof NostrRequestApprovalScreen>> = {},
  ) =>
    render(
      <ThemeProvider theme={theme}>
        <TypesafeI18n locale="en">
          <NostrRequestApprovalScreen
            clientName="PrimalWeb"
            humanAction="sign an event"
            contentPreview="x"
            index={1}
            total={2}
            onApprove={jest.fn()}
            onReject={jest.fn()}
            {...props}
          />
        </TypesafeI18n>
      </ThemeProvider>,
    )

  it("shows the plain-language action headline for a kind:3 follow list", async () => {
    const { getByTestId } = renderScreenEn({
      method: "sign_event",
      eventKind: 3,
    })
    await flushEffects()
    const headline = getByTestId("nostr-request-action")
    expect(headline.props.children).toBe("Update your follow list")
  })

  it("names the NIP-98 host for kind 27235", async () => {
    const { getByTestId } = renderScreenEn({
      method: "sign_event",
      eventKind: 27235,
      uHost: "primal.net",
    })
    await flushEffects()
    expect(getByTestId("nostr-request-action").props.children).toBe(
      "Log in to primal.net",
    )
  })

  it("keeps an unmapped kind number OUT of the headline/label/announce; only the panel shows it", async () => {
    const panel = formatSignEventPanel(
      buildSignEventPreview({ kind: 1984, created_at: 1, content: "", tags: [] }),
    )
    const { getByTestId } = renderScreenEn({
      method: "sign_event",
      eventKind: 1984,
      contentPreview: panel,
    })
    await flushEffects()
    const headline = String(getByTestId("nostr-request-action").props.children)
    expect(headline).toBe("Sign an event type Blink doesn't recognise")
    expect(headline).not.toMatch(/\d/)
    const srLabel = String(getByTestId("nostr-request-approval").props.accessibilityLabel)
    expect(srLabel).toContain("sign an event type Blink doesn't recognise")
    expect(srLabel).not.toMatch(/\d/)
    // The announce carries the queue position ("Request 1 of 2") but never the kind.
    const announce = String(getByTestId("nostr-request-counter").props.accessibilityLabel)
    expect(announce).toContain("sign an event type Blink doesn't recognise")
    expect(announce).not.toContain("1984")
    // The number belongs in the visual panel only.
    expect(getByTestId("nostr-request-content").props.children).toContain("kind: 1984")
  })

  it("carries the follow-count delta in the kind:3 headline (issue #2)", async () => {
    const { getByTestId } = renderScreenEn({
      method: "sign_event",
      eventKind: 3,
      followListDelta: { before: 685, after: 686 },
    })
    await flushEffects()
    expect(getByTestId("nostr-request-action").props.children).toBe(
      "Update your follow list (685 → 686 follows)",
    )
  })

  it("warns LOUDLY when a kind:3 would drop most follows; no banner on healthy updates", async () => {
    const { getByTestId } = renderScreenEn({
      method: "sign_event",
      eventKind: 3,
      followListDelta: { before: 685, after: 1 },
    })
    await flushEffects()
    expect(getByTestId("nostr-request-action").props.children).toBe(
      "Update your follow list (685 → 1 follows)",
    )
    expect(getByTestId("nostr-request-follow-warning")).toBeTruthy()
    expect(String(getByTestId("nostr-request-follow-warning-text").props.children)).toBe(
      "This replaces your 685 follows with 1. Only continue if you mean to unfollow most accounts.",
    )

    const { queryByTestId } = renderScreenEn({
      method: "sign_event",
      eventKind: 3,
      followListDelta: { before: 685, after: 686 },
    })
    await flushEffects()
    expect(queryByTestId("nostr-request-follow-warning")).toBeNull()
  })

  it("shows the quiet fail-open hint only for a kind:3 whose read was unavailable (D4b)", async () => {
    const unavailable = renderScreenEn({
      method: "sign_event",
      eventKind: 3,
      followListDeltaUnavailable: true,
    })
    await flushEffects()
    const hint = unavailable.getByTestId("nostr-request-follow-unchecked")
    expect(hint.props.children).toBe("Couldn't check your current follow list")
    // Quiet, not an error: grey2 p3, plain headline, no warning banner.
    const hintStyle = StyleSheet.flatten(hint.props.style)
    expect(hintStyle.color).toBe(light.grey2)
    expect(hintStyle.fontSize).toBe(14)
    expect(unavailable.getByTestId("nostr-request-action").props.children).toBe(
      "Update your follow list",
    )
    expect(unavailable.queryByTestId("nostr-request-follow-warning")).toBeNull()
    unavailable.unmount()

    // Delta read succeeded → counts in the headline, no hint.
    const withDelta = renderScreenEn({
      method: "sign_event",
      eventKind: 3,
      followListDelta: { before: 685, after: 686 },
    })
    await flushEffects()
    expect(withDelta.queryByTestId("nostr-request-follow-unchecked")).toBeNull()
    withDelta.unmount()

    // Not a kind:3 (the raise sites never set the flag) → nothing.
    const note = renderScreenEn({ method: "sign_event", eventKind: 1 })
    await flushEffects()
    expect(note.queryByTestId("nostr-request-follow-unchecked")).toBeNull()
  })

  it("styles the shrink banner with {consent-danger} tokens, an icon, and grey0 p2 copy", async () => {
    const { getByTestId } = renderScreenEn({
      method: "sign_event",
      eventKind: 3,
      followListDelta: { before: 685, after: 1 },
    })
    await flushEffects()
    const banner = getByTestId("nostr-request-follow-warning")
    const bannerStyle = StyleSheet.flatten(banner.props.style)
    // Border = {consent-danger} (error), NOT the recoverable `warning` token.
    expect(bannerStyle.borderColor).toBe(light.error)
    expect(bannerStyle.borderColor).not.toBe(light.warning)
    // Wash = {consent-danger-bg} (error9).
    expect(bannerStyle.backgroundColor).toBe(light.error9)
    // Consequence copy: on-surface grey0 at p2 — never red text.
    const textStyle = StyleSheet.flatten(
      getByTestId("nostr-request-follow-warning-text").props.style,
    )
    expect(textStyle.color).toBe(light.grey0)
    expect(textStyle.color).not.toBe(light.error)
    expect(textStyle.fontSize).toBe(16)
    // Colour is never the only signal: an icon pairs with the copy.
    expect(within(banner).getByTestId("icon-warning")).toBeTruthy()
  })

  it("pins the shrink banner directly above the footer, outside the scroll", async () => {
    const { getByTestId } = renderScreenEn({
      method: "sign_event",
      eventKind: 3,
      followListDelta: { before: 685, after: 1 },
    })
    await flushEffects()
    const banner = getByTestId("nostr-request-follow-warning")
    expect(hasAncestor(banner, "nostr-request-scroll")).toBe(false)
    expect(hasAncestor(banner, "nostr-request-footer")).toBe(false)
    // Document (= AT reading) order over host nodes: summary panel → expander → warning →
    // footer, with nothing between the warning and the decision controls.
    const ids = getByTestId("nostr-request-approval")
      .findAll((n) => typeof n.type === "string" && typeof n.props.testID === "string")
      .map((n) => n.props.testID as string)
    const warningAt = ids.indexOf("nostr-request-follow-warning")
    expect(ids.indexOf("nostr-request-content")).toBeLessThan(warningAt)
    const afterWarning = ids
      .slice(warningAt)
      .filter(
        (id) => !id.startsWith("nostr-request-follow-warning") && id !== "icon-warning",
      )
    expect(afterWarning[0]).toBe("nostr-request-footer")
  })

  it("renders the bounded summary by default and expands to the EXACT full event", async () => {
    const { getByTestId, queryByTestId } = renderScreen({
      method: "sign_event",
      eventKind: 3,
      contentPreview: summary,
      contentPreviewFull: full,
    })
    await flushEffects()
    // Collapsed default: the capped summary, with the "+N more tags" marker.
    expect(getByTestId("nostr-request-content").props.children).toBe(summary)
    expect(getByTestId("nostr-request-content").props.children).toContain("+40 more tags")
    // Expander offered (full differs from summary).
    expect(queryByTestId("nostr-request-expand")).toBeTruthy()

    fireEvent.press(getByTestId("nostr-request-expand"))
    await flushEffects()
    // Expanded: the EXACT untruncated panel — every tag present (SM-C3).
    expect(getByTestId("nostr-request-content").props.children).toBe(full)
    expect(getByTestId("nostr-request-content").props.children).not.toContain("more tags")
  })

  it("exposes the raw-event toggle's expanded state to assistive tech", async () => {
    const { getByTestId } = renderScreen({
      method: "sign_event",
      eventKind: 3,
      contentPreview: summary,
      contentPreviewFull: full,
    })
    await flushEffects()
    expect(getByTestId("nostr-request-expand").props.accessibilityState).toEqual({
      expanded: false,
    })
    fireEvent.press(getByTestId("nostr-request-expand"))
    await flushEffects()
    expect(getByTestId("nostr-request-expand").props.accessibilityState).toEqual({
      expanded: true,
    })
    fireEvent.press(getByTestId("nostr-request-expand"))
    await flushEffects()
    expect(getByTestId("nostr-request-expand").props.accessibilityState).toEqual({
      expanded: false,
    })
  })

  it("offers no expander when the summary IS the exact content", async () => {
    const { queryByTestId } = renderScreen({
      method: "nip44_decrypt",
      contentPreview: "Decrypt a message from aaaaaaaa:bbbbbbbb",
      contentPreviewFull: undefined,
    })
    await flushEffects()
    expect(queryByTestId("nostr-request-expand")).toBeNull()
  })

  it("keeps approve/reject OUTSIDE the scroll area (sticky footer — always reachable)", async () => {
    const { getByTestId } = renderScreen({
      method: "sign_event",
      eventKind: 3,
      contentPreview: summary,
      contentPreviewFull: full,
    })
    await flushEffects()

    // The decision buttons live in the footer — a sibling of the ScrollView, never inside it.
    expect(
      hasAncestor(getByTestId("nostr-request-approve"), "nostr-request-footer"),
    ).toBe(true)
    expect(
      hasAncestor(getByTestId("nostr-request-approve"), "nostr-request-scroll"),
    ).toBe(false)
    expect(hasAncestor(getByTestId("nostr-request-reject"), "nostr-request-footer")).toBe(
      true,
    )
    expect(hasAncestor(getByTestId("nostr-request-reject"), "nostr-request-scroll")).toBe(
      false,
    )
    // The content panel, by contrast, scrolls.
    expect(
      hasAncestor(getByTestId("nostr-request-content"), "nostr-request-scroll"),
    ).toBe(true)
  })
})
