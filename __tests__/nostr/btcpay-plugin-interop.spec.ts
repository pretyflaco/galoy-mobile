/**
 * Story A4 — BTCPay NostrLogin plugin interop.
 *
 * Pins the exact nostrconnect:// URI the btcpay-nostr-login plugin emits (per its README) and
 * proves the signer's parser (Story 3.3) accepts it end-to-end: both plugin-default relays are
 * extracted (AD-11: relays come from the URI, never a hardcoded global list), the mandatory
 * secret is captured verbatim, the fixed sign_event:22242 grant is recognized, and the client
 * name reaches the approval metadata. This is the contract the POC round-trip depends on.
 */
import { parseNostrConnectUri } from "../../app/nostr/transport/connect-flow"
import { parseRelaySetFromUri } from "../../app/nostr/transport/relay-pool"
import { GRANTABLE_SCOPE } from "../../app/nostr/core/connection-store"

const CLIENT_PUBKEY = "c".repeat(64)
const SECRET = "one-time-secret-xyz"

// The verbatim shape from the plugin README:
// nostrconnect://<client-pubkey>?relay=wss://nos.lol&relay=wss://relay.primal.net
//   &secret=<secret>&perms=sign_event:22242&name=BTCPay%20Server
const PLUGIN_URI =
  `nostrconnect://${CLIENT_PUBKEY}` +
  `?relay=wss://nos.lol&relay=wss://relay.primal.net` +
  `&secret=${SECRET}&perms=sign_event:22242&name=BTCPay%20Server`

describe("BTCPay plugin nostrconnect:// interop (A4)", () => {
  it("parses the plugin URI: client pubkey, both plugin-default relays, secret, grant, name", () => {
    const parsed = parseNostrConnectUri(PLUGIN_URI)
    expect(parsed).not.toBeNull()
    if (!parsed) return

    expect(parsed.clientPubkey).toBe(CLIENT_PUBKEY)
    // Both plugin-default relays, in order (AD-11: taken from the URI).
    expect(parsed.relays).toEqual(["wss://nos.lol", "wss://relay.primal.net"])
    // Mandatory secret captured verbatim (echoed back on connect-ack; never persisted).
    expect(parsed.secret).toBe(SECRET)
    // The fixed v1 grant is present.
    expect(parsed.perms).toContain(GRANTABLE_SCOPE)
    // Client identity reaches the approval surface metadata.
    expect(parsed.metadata.name).toBe("BTCPay Server")
  })

  it("the relay-pool parser extracts the same plugin-default relay set from the URI", () => {
    // The relay-pool consumes the same relay= values for its per-connection subscription.
    expect(parseRelaySetFromUri(PLUGIN_URI)).toEqual([
      "wss://nos.lol",
      "wss://relay.primal.net",
    ])
  })

  it("accepts a secret-less plugin URI (interop): parses it, secret undefined", () => {
    // Secret is now OPTIONAL for interop; the human connection approval is the consent gate.
    const noSecret =
      `nostrconnect://${CLIENT_PUBKEY}` +
      `?relay=wss://nos.lol&perms=sign_event:22242&name=BTCPay%20Server`
    const parsed = parseNostrConnectUri(noSecret)
    expect(parsed).not.toBeNull()
    expect(parsed?.secret).toBeUndefined()
    expect(parsed?.perms).toEqual(["sign_event:22242"])
  })
})
