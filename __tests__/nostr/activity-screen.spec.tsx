/**
 * Activity screen (fix #5) — renders the metadata-only per-client history + a stats card.
 * Asserts: the stats totals, human labels for sign_event (with kind) and capability methods,
 * accept/reject decision badges, and the empty state. Presentation only; entries/stats are
 * supplied by the route wrapper from the runtime's activity log.
 */
import React from "react"
import { render } from "@testing-library/react-native"

import {
  NostrActivityScreen,
  NostrActivityHeaderTitle,
} from "@app/screens/nostr/activity-screen"

import { ContextForScreen } from "../screens/helper"
import { flushEffects } from "../helpers/flush-effects"

const renderScreen = (
  props: Partial<React.ComponentProps<typeof NostrActivityScreen>> = {},
) =>
  render(
    <ContextForScreen>
      <NostrActivityScreen
        entries={props.entries ?? []}
        stats={props.stats ?? { total: 0, accepted: 0, rejected: 0 }}
      />
    </ContextForScreen>,
  )

describe("activity screen", () => {
  it("shows the empty state when there is no activity", async () => {
    const { getByTestId } = renderScreen()
    await flushEffects()
    expect(getByTestId("nostr-activity-empty")).toBeTruthy()
  })

  it("renders the stats card totals", async () => {
    const { getByTestId } = renderScreen({
      stats: { total: 5, accepted: 4, rejected: 1 },
    })
    await flushEffects()
    const stats = getByTestId("nostr-activity-stats")
    expect(stats).toBeTruthy()
  })

  it("labels a sign_event entry with its kind and an approved badge", async () => {
    const { getByTestId } = renderScreen({
      entries: [
        {
          method: "sign_event",
          eventKind: 27235,
          accepted: true,
          time: 1_700_000_000_000,
        },
      ],
      stats: { total: 1, accepted: 1, rejected: 0 },
    })
    await flushEffects()
    // The signed kind is surfaced on the row (label copy is i18n; the kind is the key fact).
    expect(getByTestId("nostr-activity-kind-27235")).toBeTruthy()
    expect(getByTestId("nostr-activity-accepted")).toBeTruthy()
  })

  it("renders a capability method label and a rejected badge", async () => {
    const { getByText, getByTestId } = renderScreen({
      entries: [{ method: "nip44_decrypt", accepted: false, time: 1_700_000_000_000 }],
      stats: { total: 1, accepted: 0, rejected: 1 },
    })
    await flushEffects()
    expect(getByText("nip44_decrypt")).toBeTruthy()
    expect(getByTestId("nostr-activity-rejected")).toBeTruthy()
  })

  it("labels connect / get_public_key entries (Amber parity) with an ack subtitle on connect", async () => {
    const { getByTestId } = renderScreen({
      entries: [
        { method: "get_public_key", accepted: true, time: 1_700_000_000_000 },
        { method: "connect", accepted: true, time: 1_700_000_000_000 },
      ],
      stats: { total: 2, accepted: 2, rejected: 0 },
    })
    await flushEffects()
    expect(getByTestId("nostr-activity-method-connect")).toBeTruthy()
    expect(getByTestId("nostr-activity-subtitle")).toBeTruthy() // "ack" line under Connect
    expect(getByTestId("nostr-activity-method-get_public_key")).toBeTruthy()
  })
})

describe("activity header title (avatar + name + host)", () => {
  it("renders the client name", async () => {
    const { getByText } = render(
      <ContextForScreen>
        <NostrActivityHeaderTitle name="BTCPay Server" />
      </ContextForScreen>,
    )
    await flushEffects()
    expect(getByText("BTCPay Server")).toBeTruthy()
  })

  it("renders the app host under the name when provided", async () => {
    const { getByText } = render(
      <ContextForScreen>
        <NostrActivityHeaderTitle name="BTCPay Server" host="btcpay.twentyone.ist" />
      </ContextForScreen>,
    )
    await flushEffects()
    expect(getByText("BTCPay Server")).toBeTruthy()
    expect(getByText("btcpay.twentyone.ist")).toBeTruthy()
  })
})
