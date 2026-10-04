/**
 * M20 (4d): the [support-chat] logger — console in debug, file only with
 * SUPPORT_CHAT_DEBUG=on (the CI smoke greps that file on iOS).
 */
jest.mock("react-native-config", () => ({ SUPPORT_CHAT_DEBUG: "on" }))
const files = new Map<string, string>()
jest.mock("react-native-fs", () => ({
  CachesDirectoryPath: "/mock/caches",
  appendFile: jest.fn(async (path: string, line: string) => {
    files.set(path, (files.get(path) ?? "") + line)
  }),
  exists: jest.fn(async (path: string) => files.has(path)),
  stat: jest.fn(async (path: string) => ({ size: (files.get(path) ?? "").length })),
  unlink: jest.fn(async (path: string) => {
    files.delete(path)
  }),
}))

import { SUPPORT_CHAT_LOG_FILE, supportChatLog } from "@app/support-chat/log"

describe("support-chat logger (4d)", () => {
  beforeEach(() => files.clear())

  it("writes the line to the log file with the [support-chat] prefix", async () => {
    supportChatLog("invite from aabbccdd refused: not a roster-bot, bot-admined group")
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20)
    })
    expect(files.get(SUPPORT_CHAT_LOG_FILE)).toContain(
      "[support-chat] invite from aabbccdd refused: not a roster-bot, bot-admined group",
    )
  })

  it("serializes non-string args", async () => {
    supportChatLog("value", { a: 1 })
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20)
    })
    expect(files.get(SUPPORT_CHAT_LOG_FILE)).toContain('[support-chat] value {"a":1}')
  })

  it("starts the file over past 512 KB (once per process)", async () => {
    files.set(SUPPORT_CHAT_LOG_FILE, "x".repeat(600 * 1024))
    // a fresh module = a new process (the once-per-process check re-runs)
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { supportChatLog: log2 } = require("@app/support-chat/log")
      log2("after a big file")
    })
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 30)
    })
    const content = files.get(SUPPORT_CHAT_LOG_FILE) ?? ""
    expect(content.length).toBeLessThan(600 * 1024)
    expect(content).toContain("after a big file")
  })
})
