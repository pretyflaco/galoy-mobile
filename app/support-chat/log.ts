/**
 * M20 (review 4d): the single [support-chat] logger. The lines carry pubkeys, group
 * ids and anomaly details — fine in debug builds (the CI smoke asserts on them in
 * logcat), but a release build stays silent unless it explicitly opts into chat debug
 * logs (ENVFILE `SUPPORT_CHAT_DEBUG=on`). No secrets are ever logged either way.
 */
import Config from "react-native-config"

const enabled = __DEV__ || Config?.SUPPORT_CHAT_DEBUG === "on"

export const supportChatLog = (...args: unknown[]): void => {
  if (enabled) console.log("[support-chat]", ...args)
}
