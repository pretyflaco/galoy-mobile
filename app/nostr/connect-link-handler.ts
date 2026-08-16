/**
 * nostrconnect:// deep-link handler registry (Story A3 / AD-9).
 *
 * The deep-link + QR entry points must RECOGNIZE the nostrconnect:// scheme and FORWARD the raw
 * URI to ConnectFlow — they never parse, approve, or touch the ConnectionStore (AD-9). The live
 * ConnectFlow lives on the runtime, which is constructed in the RN provider. Rather than thread
 * React context into the (payment-critical) navigation URL handler, the provider registers the
 * runtime's `handleConnectUri` here, and the URL/QR entry points call `handleNostrConnectLink`.
 *
 * When the signer flag is OFF the provider registers nothing (or clears the handler), so a
 * nostrconnect:// URL is simply not consumed — the signer stays invisible + inert (AD-13/NFR-9).
 */
import { forwardNostrConnectUri, isNostrConnectUri } from "./transport/connect-entrypoint"

type ConnectHandler = (rawUri: string) => Promise<void>

let activeHandler: ConnectHandler | null = null

/** Register the live runtime's connect handler (called by NostrRuntimeProvider when enabled). */
export const setNostrConnectHandler = (handler: ConnectHandler | null): void => {
  activeHandler = handler
}

/** True iff the raw string is a nostrconnect:// URI (re-exported for the URL/QR call sites). */
export const isNostrConnectLink = (raw: string): boolean => isNostrConnectUri(raw)

/**
 * If `raw` is a nostrconnect:// URI AND a handler is registered (flag on), forward the RAW URI
 * to ConnectFlow and return true (the caller must then NOT treat it as a payment/nav link).
 * Returns false otherwise (not a nostrconnect URI, or the signer is disabled).
 */
export const handleNostrConnectLink = async (raw: string): Promise<boolean> => {
  if (!activeHandler) return false
  return forwardNostrConnectUri(raw, { handleConnect: activeHandler })
}
