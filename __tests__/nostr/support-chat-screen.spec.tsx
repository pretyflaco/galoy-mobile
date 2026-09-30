/**
 * Support-chat conversation screen (P2). Copy is i18n; behavior asserted via
 * testIDs and a stubbed client: the policy default (an unverified member warns
 * AND blocks sending), the start button only without a conversation, and the
 * notice/warning/item rendering.
 */
import React from "react"
import { render } from "@testing-library/react-native"

/* eslint-disable @typescript-eslint/no-explicit-any */
let mockedClient: any = null
jest.mock("@app/support-chat/use-support-chat", () => ({
  useSupportChat: () => ({ client: mockedClient, error: null }),
}))

import { SupportChatScreen } from "@app/screens/support-chat/support-chat-screen"

import { ContextForScreen } from "../screens/helper"
import { flushEffects } from "../helpers/flush-effects"

const baseClient: any = {
  status: "ready",
  items: [],
  pubkey: "a".repeat(64),
  groupId: "group1",
  rosterStatus: () => "valid · 1 members",
  label: (pk: string) => ({ pubkey: pk, text: `Blink Support · ${pk.slice(0, 4)}`, verified: true }),
  members: () => [],
  handoffState: () => "bot",
  unverifiedMembers: () => [],
  start: jest.fn(),
  send: jest.fn(),
  subscribe: () => () => {},
}

const renderScreen = (client: any) => {
  mockedClient = client
  return render(
    <ContextForScreen>
      <SupportChatScreen />
    </ContextForScreen>,
  )
}

describe("support-chat screen", () => {
  it("renders the handoff banner, status and composer when a conversation exists", async () => {
    const { getByTestId, queryByTestId } = renderScreen({ ...baseClient })
    await flushEffects()
    expect(getByTestId("support-chat-handoff")).toBeTruthy()
    expect(getByTestId("support-chat-input")).toBeTruthy()
    expect(queryByTestId("support-chat-start")).toBeNull()
  })

  it("shows the start button only without an active conversation", async () => {
    const { getByTestId, queryByTestId } = renderScreen({ ...baseClient, groupId: null })
    await flushEffects()
    expect(getByTestId("support-chat-start")).toBeTruthy()
    expect(queryByTestId("support-chat-input")).toBeNull()
  })

  /** Policy default (03 §5): an unverified member warns AND blocks sending. */
  it("blocks the composer and warns while an unverified member is present", async () => {
    const unverified = { pubkey: "b".repeat(64), text: "UNVERIFIED member bbbbbbbb", verified: false }
    const { getByTestId } = renderScreen({
      ...baseClient,
      unverifiedMembers: () => [unverified],
      members: () => [unverified],
    })
    await flushEffects()
    expect(getByTestId("support-chat-unverified")).toBeTruthy()
    expect(getByTestId("support-chat-input").props.editable).toBe(false)
  })

  it("renders membership notices and warnings from the item list", async () => {
    mockedClient = {
      ...baseClient,
      items: [
        { id: "1", at: 1, type: "notice", text: "joined: Blink Support · pretyflaco" },
        { id: "2", at: 2, type: "warning", text: "Blink Support roster changed" },
      ],
    }
    const { getByTestId } = render(
      <ContextForScreen>
        <SupportChatScreen />
      </ContextForScreen>,
    )
    await flushEffects()
    expect(getByTestId("support-chat-notice").props.children.join("")).toContain("joined:")
    expect(getByTestId("support-chat-warning")).toBeTruthy()
  })

  it("shows the agent handoff state when a verified agent is present", async () => {
    const { getByTestId } = renderScreen({ ...baseClient, handoffState: () => "agent" })
    await flushEffects()
    expect(getByTestId("support-chat-handoff")).toBeTruthy()
  })
})
