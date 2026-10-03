/**
 * Support-chat conversation screen (P2; M19 redesign). Copy is i18n; behavior asserted
 * via testIDs and a stubbed client: the policy default (an unverified member warns
 * AND blocks sending), the start button only without a conversation, the notice/
 * warning/item rendering, and the header clock that opens Conversations (no top bar).
 */
import React from "react"
import { fireEvent, render } from "@testing-library/react-native"

/* eslint-disable @typescript-eslint/no-explicit-any */
let mockedClient: any = null
// M18: push is not under test here (and its notification lib is untranspiled ESM)
jest.mock("@app/support-chat/push", () => ({
  PUSH_SERVER_PUBKEY: "",
  askPermission: jest.fn(async () => false),
}))
jest.mock("@app/support-chat/use-support-chat", () => ({
  useSupportChat: () => ({ client: mockedClient, error: null }),
}))
const navigate = jest.fn()
let headerOptions: any = null
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({
    navigate,
    goBack: jest.fn(),
    setOptions: (o: any) => {
      headerOptions = o
    },
  }),
}))

import { SupportChatScreen } from "@app/screens/support-chat/support-chat-screen"
import { SupportConversationsScreen } from "@app/screens/support-chat/support-conversations-screen"
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
  setScreenFocused: jest.fn(),
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
  it("renders the composer, and no top bar, when a conversation exists", async () => {
    const { getByTestId, queryByTestId } = renderScreen({ ...baseClient })
    await flushEffects()
    expect(getByTestId("support-chat-input")).toBeTruthy()
    expect(queryByTestId("support-chat-start")).toBeNull()
    // M19 (Andrej): the 🔒 line, the handoff pill and the ⋯ menu are gone
    expect(queryByTestId("support-chat-handoff")).toBeNull()
    expect(queryByTestId("support-chat-details-toggle")).toBeNull()
    expect(queryByTestId("support-chat-menu")).toBeNull()
  })

  it("puts a clock in the header that opens Conversations", async () => {
    headerOptions = null
    renderScreen({ ...baseClient })
    await flushEffects()
    const clock = render(
      <ContextForScreen>{headerOptions.headerRight()}</ContextForScreen>,
    )
    fireEvent.press(clock.getByTestId("support-chat-conversations"))
    expect(navigate).toHaveBeenCalledWith("supportChatConversations")
  })

  it("no clock before the first conversation; the empty state offers Start chat", async () => {
    headerOptions = null
    const { getByTestId, getByText } = renderScreen({
      ...baseClient,
      groupId: null,
      current: () => null,
      conversations: () => [],
    })
    await flushEffects()
    expect(headerOptions.headerRight).toBeUndefined()
    expect(getByText("Chat with Blink Support")).toBeTruthy()
    expect(getByTestId("support-chat-start")).toBeTruthy()
    expect(getByText("Start chat")).toBeTruthy()
  })

  it("marks the client focused while the screen is in front (unread badge)", async () => {
    const client = { ...baseClient, setScreenFocused: jest.fn() }
    renderScreen(client)
    await flushEffects()
    expect(client.setScreenFocused).toHaveBeenCalledWith(true)
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
        { id: "1", at: 1, type: "notice", text: "joined: Blink Support · pretyflaco" }, // pre-M19 case
        { id: "2", at: 2, type: "warning", text: "Blink Support roster changed" },
      ],
    }
    const { getByTestId } = render(
      <ContextForScreen>
        <SupportChatScreen />
      </ContextForScreen>,
    )
    await flushEffects()
    expect(String(getByTestId("support-chat-notice").props.children)).toContain("Joined:")
    expect(getByTestId("support-chat-warning")).toBeTruthy()
  })

  it("shows a relayed human reply under its author, prefix stripped, one label per run", async () => {
    const bot = "b".repeat(64)
    const { getByText, getAllByText, queryByText } = renderScreen({
      ...baseClient,
      items: [
        { id: "1", at: 100, type: "msg", from: bot, text: "Support (pretyflaco): hello" },
        {
          id: "2",
          at: 101,
          type: "msg",
          from: bot,
          text: "Support (pretyflaco): how can I help",
        },
        {
          id: "3",
          at: 102,
          type: "msg",
          from: bot,
          text: "Support (Blink assistant): hi",
        },
      ],
    })
    await flushEffects()
    expect(getAllByText("pretyflaco · Blink Support")).toHaveLength(1) // one run
    expect(getByText("hello")).toBeTruthy()
    expect(queryByText("Support (pretyflaco): hello")).toBeNull()
    expect(getByText("Blink assistant")).toBeTruthy()
  })

  it("a pause of more than 5 minutes starts a new run (author shown again)", async () => {
    const bot = "b".repeat(64)
    const { getAllByText } = renderScreen({
      ...baseClient,
      items: [
        { id: "1", at: 1000, type: "msg", from: bot, text: "Support (pretyflaco): one" },
        {
          id: "2",
          at: 1000 + 6 * 60,
          type: "msg",
          from: bot,
          text: "Support (pretyflaco): two",
        },
      ],
    })
    await flushEffects()
    expect(getAllByText("pretyflaco · Blink Support")).toHaveLength(2)
  })

  /** Option C (F-M16-1): conversations are sessions; an ended one is never a dead end. */
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

  it("an imported Nostr-identity conversation is read-only with a way forward (M19)", async () => {
    const { getByTestId } = renderScreen({
      ...baseClient,
      current: () => ({
        gid: "group1",
        startedAt: 1,
        status: "ended",
        reason: "identity",
      }),
    })
    await flushEffects()
    expect(getByTestId("support-chat-ended").props.children).toMatch(/its own key/)
    expect(getByTestId("support-chat-start-new")).toBeTruthy()
  })

  it("shows a previous conversation read-only", async () => {
    const past = { gid: "old1", startedAt: 1, status: "ended", reason: "stuck" }
    const viewing = renderScreen({
      ...baseClient,
      viewing: "old1",
      viewItems: [{ id: "p1", at: 1, type: "notice", text: "an old notice" }],
      conversations: () => [{ gid: "group1", startedAt: 2, status: "active" }, past],
    })
    await flushEffects()
    expect(viewing.getByTestId("support-chat-viewing-past")).toBeTruthy()
    expect(viewing.getByTestId("support-chat-back")).toBeTruthy()
    // no current conversation (e.g. only imported ones): no "back", the start button instead
    const noCurrent = renderScreen({
      ...baseClient,
      groupId: null,
      current: () => null,
      viewing: "old1",
      viewItems: [],
      conversations: () => [past],
    })
    await flushEffects()
    expect(noCurrent.queryByTestId("support-chat-back")).toBeNull()
    expect(noCurrent.getByTestId("support-chat-start")).toBeTruthy()
    expect(viewing.queryByTestId("support-chat-input")).toBeNull()
    expect(String(viewing.getByTestId("support-chat-notice").props.children)).toContain(
      "an old notice",
    )
  })

  /** M19 (Andrej): the Conversations screen — titles, the current one checked, Start new. */
  describe("conversations screen", () => {
    const list = [
      {
        gid: "group1",
        startedAt: 1760000000,
        status: "active",
        title: "need help with login",
      },
      { gid: "old1", startedAt: 1750000000, status: "ended", reason: "user" },
    ]
    const renderList = (client: any) => {
      mockedClient = client
      return render(
        <ContextForScreen>
          <SupportConversationsScreen />
        </ContextForScreen>,
      )
    }

    it("lists titles (first message), a fallback title, and checks the current one", async () => {
      const { getByText, getAllByTestId } = renderList({
        ...baseClient,
        conversations: () => list,
      })
      await flushEffects()
      expect(getByText("need help with login")).toBeTruthy()
      expect(getByText("Conversation")).toBeTruthy() // no title yet
      expect(getAllByTestId("support-conversation-current")).toHaveLength(1)
    })

    it("opens an old conversation read-only, the current one writable", async () => {
      const client = { ...baseClient, conversations: () => list, view: jest.fn() }
      const { getAllByTestId } = renderList(client)
      await flushEffects()
      fireEvent.press(getAllByTestId("support-conversation-row")[1])
      expect(client.view).toHaveBeenCalledWith("old1")
      fireEvent.press(getAllByTestId("support-conversation-row")[0])
      expect(client.view).toHaveBeenCalledWith(null)
    })

    it("Start new ends the current conversation and starts a fresh one", async () => {
      const client = { ...baseClient, conversations: () => list, startNew: jest.fn() }
      const { getByTestId } = renderList(client)
      await flushEffects()
      fireEvent.press(getByTestId("support-conversations-start-new"))
      await flushEffects()
      expect(client.startNew).toHaveBeenCalled()
    })

    it("Start new without a current conversation just starts one", async () => {
      const client = {
        ...baseClient,
        groupId: null,
        conversations: () => [list[1]],
        start: jest.fn(),
        startNew: jest.fn(),
      }
      const { getByTestId } = renderList(client)
      await flushEffects()
      fireEvent.press(getByTestId("support-conversations-start-new"))
      await flushEffects()
      expect(client.start).toHaveBeenCalled()
      expect(client.startNew).not.toHaveBeenCalled()
    })
  })
})
