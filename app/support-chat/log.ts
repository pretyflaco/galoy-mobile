/**
 * M20 (review 4d): the single [support-chat] logger. The lines carry pubkeys, group
 * ids and anomaly details — fine in debug builds (the CI smoke asserts on them in
 * logcat), but a release build stays silent unless it explicitly opts into chat debug
 * logs (ENVFILE `SUPPORT_CHAT_DEBUG=on`). No secrets are ever logged either way.
 *
 * With SUPPORT_CHAT_DEBUG=on the lines ALSO go to Caches/support-chat.log: iOS's
 * `log show` does not reliably surface RN's console.log (info level + archive lag —
 * the batch-6 iOS M20 step saw 0 lines), so the CI smoke greps the file in the app
 * container instead. Metadata only, app sandbox, never in production builds.
 */
import Config from "react-native-config"
import RNFS from "react-native-fs"

const enabled = __DEV__ || Config?.SUPPORT_CHAT_DEBUG === "on"
const toFile = Config?.SUPPORT_CHAT_DEBUG === "on"
export const SUPPORT_CHAT_LOG_FILE = `${RNFS.CachesDirectoryPath}/support-chat.log`

/** Once per process: bound the file (start over past 512 KB) BEFORE anything appends. */
let fileReady: Promise<void> | null = null
const ready = (): Promise<void> => {
  if (!fileReady) {
    fileReady = (async () => {
      try {
        if (await RNFS.exists(SUPPORT_CHAT_LOG_FILE)) {
          const st = await RNFS.stat(SUPPORT_CHAT_LOG_FILE)
          if (st.size > 512 * 1024) await RNFS.unlink(SUPPORT_CHAT_LOG_FILE)
        }
      } catch {
        // best effort
      }
    })()
  }
  return fileReady
}

export const supportChatLog = (...args: unknown[]): void => {
  if (enabled) console.log("[support-chat]", ...args)
  if (toFile) {
    const line = `[support-chat] ${args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ")}\n`
    ready()
      .then(() => RNFS.appendFile(SUPPORT_CHAT_LOG_FILE, line, "utf8"))
      .catch(() => undefined)
  }
}
