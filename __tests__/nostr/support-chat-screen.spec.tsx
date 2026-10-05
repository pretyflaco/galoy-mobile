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
jest.mock("react-native-image-picker", () => ({
  launchImageLibrary: jest.fn(async () => ({
    assets: [
      {
        uri: "file:///mock/caches/shot.jpg",
        type: "image/jpeg",
        width: 800,
        height: 1600,
        fileSize: 1000,
      },
    ],
  })),
}))
jest.mock("react-native-fs", () => ({
  DocumentDirectoryPath: "/mock/documents",
  CachesDirectoryPath: "/mock/caches",
  TemporaryDirectoryPath: "/mock/tmp",
  readFile: jest.fn(async () => "AAEC"),
  unlink: jest.fn(async () => {}),
}))
const mockSaveAsset = jest.fn(async () => ({}))
jest.mock("@react-native-camera-roll/camera-roll", () => ({
  CameraRoll: { saveAsset: (...args: unknown[]) => mockSaveAsset(...(args as [])) },
}))
const mockShareOpen = jest.fn(async () => ({}))
jest.mock("react-native-share", () => ({
  __esModule: true,
  default: { open: (...args: unknown[]) => mockShareOpen(...(args as [])) },
}))
let mockIsAuthed = true
jest.mock("@app/graphql/is-authed-context", () => ({
  ...jest.requireActual("@app/graphql/is-authed-context"),
  useIsAuthed: () => mockIsAuthed,
}))
const mockOpenExternalUrl = jest.fn()
jest.mock("@app/utils/external", () => ({
  openExternalUrl: (...a: unknown[]) => mockOpenExternalUrl(...(a as [])),
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
    role: "bot",
  }),
  members: () => [],
  handoffState: () => "bot",
  unverifiedMembers: () => [],
  start: jest.fn(),
  startNew: jest.fn(),
  send: jest.fn(),
  view: jest.fn(),
  switchTo: jest.fn(async () => false),
  unreadFor: jest.fn(() => 0),
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

  /**
   * M20 (finding 5): the "Support (<name>):" prefix is parsed ONLY from the verified
   * roster bot. From an unverified key or a verified agent it is plain text under the
   * sender's real label — never the trusted agent label.
   */
  it("does NOT honour the Support (<name>): prefix from an unverified sender", async () => {
    const attacker = "e".repeat(64)
    const { getByText, queryByText } = renderScreen({
      ...baseClient,
      label: (pk: string) => ({
        pubkey: pk,
        text: `UNVERIFIED · ${pk.slice(0, 4)}`,
        verified: false,
      }),
      items: [
        {
          id: "1",
          at: 100,
          type: "msg",
          from: attacker,
          text: "Support (pretyflaco): visit https://evil.example",
        },
      ],
    })
    await flushEffects()
    expect(getByText("Support (pretyflaco): visit https://evil.example")).toBeTruthy()
    expect(queryByText("pretyflaco · Blink Support")).toBeNull()
  })

  it("does NOT honour the Support (<name>): prefix from a verified non-bot member", async () => {
    const agent = "a".repeat(64)
    const { getByText, queryByText } = renderScreen({
      ...baseClient,
      label: (pk: string) => ({
        pubkey: pk,
        text: `Agent ${pk.slice(0, 4)}`,
        verified: true,
        role: "agent",
      }),
      items: [
        { id: "1", at: 100, type: "msg", from: agent, text: "Support (pretyflaco): hi" },
      ],
    })
    await flushEffects()
    expect(getByText("Support (pretyflaco): hi")).toBeTruthy()
    expect(queryByText("pretyflaco · Blink Support")).toBeNull()
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

  /** M19 "Share details": the composer's + menu and support's request button. */
  it("the + menu offers sharing details and a transaction", async () => {
    navigate.mockClear()
    const { getByTestId, queryByTestId } = renderScreen({ ...baseClient })
    await flushEffects()
    expect(queryByTestId("support-chat-share-menu")).toBeNull()
    fireEvent.press(getByTestId("support-chat-share"))
    fireEvent.press(getByTestId("support-chat-share-transaction"))
    expect(navigate).toHaveBeenCalledWith("supportChatShareTransaction")
  })

  it("a picked screenshot is previewed with the privacy check, then sent", async () => {
    const client = { ...baseClient, sendImage: jest.fn(async () => undefined) }
    const { getByTestId, queryByTestId } = renderScreen(client)
    await flushEffects()
    fireEvent.press(getByTestId("support-chat-share"))
    fireEvent.press(getByTestId("support-chat-share-image"))
    await flushEffects()
    expect(getByTestId("support-chat-image-preview")).toBeTruthy()
    fireEvent.press(getByTestId("support-chat-image-send"))
    await flushEffects()
    expect(client.sendImage).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({ mime: "image/jpeg", width: 800, height: 1600 }),
    )
    expect(queryByTestId("support-chat-image-preview")).toBeNull()
    // Hermes G: the picker's plaintext temp copy is deleted after a successful send
    const RNFS = jest.requireMock("react-native-fs")
    expect(RNFS.unlink).toHaveBeenCalledWith("/mock/caches/shot.jpg")
  })

  it("Hermes G: cancelling the preview deletes the picker's temp copy too", async () => {
    const client = { ...baseClient, sendImage: jest.fn(async () => undefined) }
    const RNFS = jest.requireMock("react-native-fs")
    RNFS.unlink.mockClear()
    const { getByTestId, queryByTestId } = renderScreen(client)
    await flushEffects()
    fireEvent.press(getByTestId("support-chat-share"))
    fireEvent.press(getByTestId("support-chat-share-image"))
    await flushEffects()
    fireEvent.press(getByTestId("support-chat-image-cancel"))
    await flushEffects()
    expect(queryByTestId("support-chat-image-preview")).toBeNull()
    expect(client.sendImage).not.toHaveBeenCalled()
    expect(RNFS.unlink).toHaveBeenCalledWith("/mock/caches/shot.jpg")
  })

  it("Hermes G: the temp guard never touches a path outside the app's cache/tmp", async () => {
    const picker = jest.requireMock("react-native-image-picker")
    picker.launchImageLibrary.mockResolvedValueOnce({
      assets: [
        {
          uri: "file:///mock/documents/private-gallery.jpg",
          type: "image/jpeg",
          width: 800,
          height: 1600,
          fileSize: 1000,
        },
      ],
    })
    const client = { ...baseClient, sendImage: jest.fn(async () => undefined) }
    const RNFS = jest.requireMock("react-native-fs")
    RNFS.unlink.mockClear()
    const { getByTestId } = renderScreen(client)
    await flushEffects()
    fireEvent.press(getByTestId("support-chat-share"))
    fireEvent.press(getByTestId("support-chat-share-image"))
    await flushEffects()
    fireEvent.press(getByTestId("support-chat-image-cancel"))
    await flushEffects()
    expect(RNFS.unlink).not.toHaveBeenCalled()
  })

  it("Hermes N5: iOS paths are normalized (/private stripped) before the guard", async () => {
    const picker = jest.requireMock("react-native-image-picker")
    picker.launchImageLibrary.mockResolvedValueOnce({
      assets: [
        {
          uri: "file:///private/mock/caches/shot.jpg",
          type: "image/jpeg",
          width: 800,
          height: 1600,
          fileSize: 1000,
        },
      ],
    })
    const client = { ...baseClient, sendImage: jest.fn(async () => undefined) }
    const RNFS = jest.requireMock("react-native-fs")
    RNFS.unlink.mockClear()
    const { getByTestId } = renderScreen(client)
    await flushEffects()
    fireEvent.press(getByTestId("support-chat-share"))
    fireEvent.press(getByTestId("support-chat-share-image"))
    await flushEffects()
    fireEvent.press(getByTestId("support-chat-image-cancel"))
    await flushEffects()
    expect(RNFS.unlink).toHaveBeenCalledWith("/mock/caches/shot.jpg")
  })

  it("tapping a picture opens it full screen with Save to Photos and Share", async () => {
    const { getByTestId, queryByTestId } = renderScreen({
      ...baseClient,
      items: [
        {
          id: "i",
          at: 1,
          type: "msg",
          from: "b".repeat(64),
          text: "Support (pattern): tap here",
          image: { path: "/docs/p.png", width: 400, height: 800 },
        },
      ],
    })
    await flushEffects()
    expect(queryByTestId("support-image-save")).toBeNull()
    fireEvent.press(getByTestId("support-chat-image-open"))
    fireEvent.press(getByTestId("support-image-save"))
    await flushEffects()
    expect(mockSaveAsset).toHaveBeenCalledWith(
      "file:///mock/caches/support-media-live/p.png",
      {
        type: "photo",
        album: "Blink Support",
      },
    )
    fireEvent.press(getByTestId("support-image-save")) // a second tap does not save a duplicate
    await flushEffects()
    expect(mockSaveAsset).toHaveBeenCalledTimes(1)
    fireEvent.press(getByTestId("support-image-share"))
    expect(mockShareOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "file:///mock/caches/support-media-live/p.png",
        type: "image/png",
      }),
    )
    fireEvent.press(getByTestId("support-image-close"))
    await flushEffects()
    expect(queryByTestId("support-image-save")).toBeNull()
  })

  it("a picture whose file is gone shows a text instead of an empty bubble", async () => {
    const { getByTestId, queryByTestId, getByText } = renderScreen({
      ...baseClient,
      items: [
        {
          id: "g",
          at: 1,
          type: "msg",
          mine: true,
          from: "a".repeat(64),
          text: "📷 Screenshot",
          image: { path: "/old/container/support-media/gone.jpg" },
        },
      ],
    })
    await flushEffects()
    fireEvent(getByTestId("support-chat-image"), "error")
    await flushEffects()
    expect(queryByTestId("support-chat-image")).toBeNull()
    expect(getByText(/not available on this device/)).toBeTruthy()
  })

  it("renders a sent screenshot as an image bubble", async () => {
    const { getByTestId } = renderScreen({
      ...baseClient,
      items: [
        {
          id: "i",
          at: 1,
          type: "msg",
          mine: true,
          from: "a".repeat(64),
          text: "📷 Screenshot",
          image: { path: "/docs/x.jpg", width: 400, height: 800 },
        },
      ],
    })
    await flushEffects()
    expect(getByTestId("support-chat-image").props.source).toEqual({
      uri: "file:///mock/caches/support-media-live/x.jpg", // resolved by file name (iOS container UUIDs change)
    })
  })

  it("a request from support shows 'Review & share' and opens the right screen", async () => {
    navigate.mockClear()
    const bot = "b".repeat(64)
    const { getByTestId } = renderScreen({
      ...baseClient,
      items: [
        {
          id: "1",
          at: 1,
          type: "msg",
          from: bot,
          text: "Please share the payment",
          request: "tx",
        },
      ],
    })
    await flushEffects()
    fireEvent.press(getByTestId("support-chat-request"))
    expect(navigate).toHaveBeenCalledWith("supportChatShareTransaction")
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
      await flushEffects()
      expect(client.view).toHaveBeenCalledWith("old1")
      fireEvent.press(getAllByTestId("support-conversation-row")[0])
      await flushEffects()
      expect(client.view).toHaveBeenCalledWith(null)
    })

    it("M20 (D2): a parked support-initiated conversation is SWITCHED to, not viewed", async () => {
      const parked = { gid: "parked1", startedAt: 1761000000, status: "active" }
      const client = {
        ...baseClient,
        conversations: () => [...list, parked],
        view: jest.fn(),
        switchTo: jest.fn(async () => true),
      }
      const { getAllByTestId } = renderList(client)
      await flushEffects()
      fireEvent.press(getAllByTestId("support-conversation-row")[2])
      await flushEffects()
      expect(client.switchTo).toHaveBeenCalledWith("parked1")
      expect(client.view).not.toHaveBeenCalled()
    })

    it("an ended conversation falls back to read-only when switchTo refuses it", async () => {
      const client = {
        ...baseClient,
        conversations: () => list,
        view: jest.fn(),
        // the client refuses ended/unrestorable gids (its own status check)
        switchTo: jest.fn(async () => false),
      }
      const { getAllByTestId } = renderList(client)
      await flushEffects()
      fireEvent.press(getAllByTestId("support-conversation-row")[1]) // old1: ended
      await flushEffects()
      expect(client.switchTo).toHaveBeenCalledWith("old1")
      expect(client.view).toHaveBeenCalledWith("old1")
    })

    it("M20 (Hermes #4): a parked conversation with unread support messages shows a dot", async () => {
      const parked = { gid: "parked1", startedAt: 1761000000, status: "active" }
      const client = {
        ...baseClient,
        conversations: () => [...list, parked],
        unreadFor: (gid: string) => (gid === "parked1" ? 2 : 0),
      }
      const { getAllByTestId } = renderList(client)
      await flushEffects()
      expect(getAllByTestId("support-conversation-unread")).toHaveLength(1)
    })

    it("M20 (Hermes #4): a parked conversation without unread shows no dot", async () => {
      const client = { ...baseClient, conversations: () => list }
      const { queryByTestId } = renderList(client)
      await flushEffects()
      expect(queryByTestId("support-conversation-unread")).toBeNull()
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

  describe("links in support messages (M20)", () => {
    const bot = "b".repeat(64)
    const text =
      "Support (Blink assistant): See https://faq.blink.sv/using-blink/what-are-blinks-account-limits. Or open blink://settings/tx-limits"

    it("a verified support message: web link opens the in-app browser, app link navigates", async () => {
      mockOpenExternalUrl.mockClear()
      navigate.mockClear()
      const { getByTestId, getByText } = renderScreen({
        ...baseClient,
        items: [{ id: "1", at: 100, type: "msg", from: bot, text }],
      })
      await flushEffects()
      fireEvent.press(getByTestId("support-chat-web-link"))
      expect(mockOpenExternalUrl).toHaveBeenCalledWith(
        "https://faq.blink.sv/using-blink/what-are-blinks-account-limits",
      )
      expect(getByText("Open in the app: Transaction limits")).toBeTruthy()
      fireEvent.press(getByTestId("support-chat-app-link"))
      expect(navigate).toHaveBeenCalledWith("transactionLimitsScreen", undefined)
    })

    it("before an account exists (not authed) an app link stays plain text", async () => {
      mockIsAuthed = false
      const { queryByTestId, getByTestId } = renderScreen({
        ...baseClient,
        items: [{ id: "1", at: 100, type: "msg", from: bot, text }],
      })
      await flushEffects()
      expect(queryByTestId("support-chat-app-link")).toBeNull()
      expect(getByTestId("support-chat-web-link")).toBeTruthy() // web links still work
      mockIsAuthed = true
    })

    it("the customer's own message never gets links", async () => {
      const { queryByTestId } = renderScreen({
        ...baseClient,
        items: [
          {
            id: "1",
            at: 100,
            type: "msg",
            from: "a".repeat(64),
            mine: true,
            text: "https://faq.blink.sv/x blink://settings",
          },
        ],
      })
      await flushEffects()
      expect(queryByTestId("support-chat-web-link")).toBeNull()
      expect(queryByTestId("support-chat-app-link")).toBeNull()
    })

    it("an UNVERIFIED member's message never gets links", async () => {
      const { queryByTestId } = renderScreen({
        ...baseClient,
        label: (pk: string) => ({
          pubkey: pk,
          text: `Unknown · ${pk.slice(0, 4)}`,
          verified: false,
          role: "member",
        }),
        unverifiedMembers: () => [],
        items: [{ id: "1", at: 100, type: "msg", from: bot, text }],
      })
      await flushEffects()
      expect(queryByTestId("support-chat-web-link")).toBeNull()
      expect(queryByTestId("support-chat-app-link")).toBeNull()
    })

    it("a non-allowlisted link stays plain text", async () => {
      const { queryByTestId, getByText } = renderScreen({
        ...baseClient,
        items: [
          {
            id: "1",
            at: 100,
            type: "msg",
            from: bot,
            text: "Support (Blink assistant): go to https://claim-blink.example/verify",
          },
        ],
      })
      await flushEffects()
      expect(queryByTestId("support-chat-web-link")).toBeNull()
      expect(getByText("go to https://claim-blink.example/verify")).toBeTruthy()
    })
  })
})
