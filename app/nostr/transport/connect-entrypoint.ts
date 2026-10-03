/**
 * nostrconnect:// entry point (Story 3.3 Task 10 / AD-9).
 *
 * The EXISTING deep-link handler and QR scanner (`scanning-qrcode-screen.tsx`) are the
 * entry points for a `nostrconnect://` URI. Per AD-9 they only RECOGNIZE the scheme and
 * FORWARD the RAW URI to `ConnectFlow` — they never parse it, never approve, never touch the
 * ConnectionStore. All handshake logic lives in `ConnectFlow` (connect-flow.ts).
 *
 * AD-1: transport is UI-free. The `handleConnect` port is `ConnectFlow.handleConnect`, wired
 * at the screen/deep-link layer.
 */

/** True iff the raw string is a nostrconnect:// URI (the only scheme this entry point owns). */
export const isNostrConnectUri = (raw: string): boolean =>
  raw.startsWith("nostrconnect://")

/** The narrow ConnectFlow port the entry point forwards to. */
export interface ConnectForwardPort {
  handleConnect: (rawUri: string) => Promise<void>
}

/**
 * Forward a raw scanned/deep-linked string to ConnectFlow IF it is a nostrconnect:// URI.
 * Returns true when forwarded (the URI is passed byte-for-byte, unparsed), false otherwise.
 * This function does NO parsing and NO approval — that is ConnectFlow's job (AD-9).
 */
export const forwardNostrConnectUri = async (
  raw: string,
  port: ConnectForwardPort,
): Promise<boolean> => {
  if (!isNostrConnectUri(raw)) return false
  await port.handleConnect(raw)
  return true
}
