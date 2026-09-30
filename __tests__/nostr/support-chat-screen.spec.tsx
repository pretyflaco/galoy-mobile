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
import { loadLocale } from "@app/i18n/i18n-util.sync"

import { ContextForScreen } from "../screens/helper"
import { flushEffects } from "../helpers/flush-effects"

loadLocale("en")

const baseClient: any = {
  status: "ready",
  items: [],
  pubkey: "a".repeat(64),
  groupId: "group1",
  rosterStatus: () => "valid · 1 members",
  label: (pk: string) => ({
    pubkey: pk,
    text: `Blink Support · ${pk.slice(0, 4)}`,
    verified: true,
  }),
  members: () => [],
  handoffState: () => "bot",
  unverifiedMembers: () => [],
  start: jest.fn(),
  startNew: jest.fn(),
  send: jest.fn(),
  view: jest.fn(),
  viewing: null,
  viewItems: [],
  current: () => ({ gid: "group1", startedAt: 1, status: "active" }),
  conversations: () => [{ gid: "group1", startedAt: 1, status: "active" }],
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
    const unverified = {
      pubkey: "b".repeat(64),
      text: "UNVERIFIED member bbbbbbbb",
      verified: false,
    }
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
    expect(getByTestId("support-chat-notice").props.children.join("")).toContain(
      "joined:",
    )
    expect(getByTestId("support-chat-warning")).toBeTruthy()
  })

  it("shows the agent handoff state when a verified agent is present", async () => {
    const { getByTestId } = renderScreen({ ...baseClient, handoffState: () => "agent" })
    await flushEffects()
    expect(getByTestId("support-chat-handoff")).toBeTruthy()
  })

  /** Option C (F-M16-1): conversations are sessions; an ended one is never a dead end. */
  it("an active conversation offers 'New conversation' next to the composer", async () => {
    const { getByTestId, queryByTestId } = renderScreen({ ...baseClient })
    await flushEffects()
    expect(getByTestId("support-chat-new-conversation")).toBeTruthy()
    expect(queryByTestId("support-chat-ended")).toBeNull()
  })

  it("a stuck conversation is ENDED: readable, no composer, start-new offered", async () => {
    const { getByTestId, queryByTestId } = renderScreen({
      ...baseClient,
      items: [
        { id: "1", at: 1, type: "msg", from: "b".repeat(64), text: "earlier reply" },
      ],
      current: () => ({ gid: "group1", startedAt: 1, status: "ended", reason: "stuck" }),
    })
    await flushEffects()
    expect(getByTestId("support-chat-ended").props.children).toMatch(
      /can't continue on this device/,
    )
    expect(getByTestId("support-chat-start-new")).toBeTruthy()
    expect(queryByTestId("support-chat-input")).toBeNull()
    expect(getByTestId("support-chat-message")).toBeTruthy() // history stays readable
  })

  it("lists previous conversations and shows one read-only", async () => {
    const past = { gid: "old1", startedAt: 1, status: "ended", reason: "stuck" }
    const listed = renderScreen({
      ...baseClient,
      conversations: () => [{ gid: "group1", startedAt: 2, status: "active" }, past],
    })
    await flushEffects()
    expect(listed.getByTestId("support-chat-previous-toggle")).toBeTruthy()

    const viewing = renderScreen({
      ...baseClient,
      viewing: "old1",
      viewItems: [{ id: "p1", at: 1, type: "notice", text: "an old notice" }],
      conversations: () => [{ gid: "group1", startedAt: 2, status: "active" }, past],
    })
    await flushEffects()
    expect(viewing.getByTestId("support-chat-viewing-past")).toBeTruthy()
    expect(viewing.getByTestId("support-chat-back")).toBeTruthy()
    expect(viewing.queryByTestId("support-chat-input")).toBeNull()
    expect(viewing.getByTestId("support-chat-notice").props.children.join("")).toContain(
      "an old notice",
    )
  })
})
