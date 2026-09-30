// M11: key-package discovery publication for marmot-ts master (Marmot v2).
// The library publishes the kind-30443 key package itself (`ensurePublished` is
// idempotent and rotates when the current one is used up), but it does NOT
// publish the kind-10051 key-package relay list (0.5.1's helper is gone —
// F-M9-7), and White Noise/MDK resolve invitees via kind 10050 (inbox relays)
// + kind 10002 (NIP-65), not 10051 (F-M9-12, proven live in M9 stage 3).
// Publishing all three relay-list kinds made the M9 spike app discoverable by
// WN, Amethyst and marmot-ts peers alike.
//
// Tag shapes are exactly the M9 spike's (findings/M9-v2.md stage 2/3):
//   10051 and 10050: one ["relay", <url>] tag per relay, empty content
//   10002:           one ["r", <url>] tag per relay (NIP-65)
// All three are replaceable kinds (10000-19999): republishing replaces.
//
// Also here: the peer-side lookup the inviter needs (the support bot's / a
// peer's current key package event), so callers don't hand-roll filters.

/**
 * Ensure this client is invitable: a current kind-30443 key package plus the
 * 10051/10050/10002 relay lists that let peers (MDK, quartz, marmot-ts) find
 * both the package and the inbox its Welcomes should be delivered to.
 *
 * @param {object} client a marmot-ts MarmotClient (v2 API: keyPackages.ensurePublished)
 * @param {object} network a NostrNetworkInterface (SimplePoolNetwork) — used to publish
 * @param {object} options
 * @param {string[]} options.relays where to publish (also listed in the relay events)
 * @param {object} options.signer signs the relay-list events (first-party; e.g. TestEventSigner or the Blink form)
 * @returns {Promise<{ keyPackage: object, relayLists: Record<string, { id: string, results: object }> }>}
 */
export async function ensureDiscoverable(client, network, { relays, signer }) {
  if (!relays?.length) throw new Error("ensureDiscoverable: relays are required")
  const keyPackage = await client.keyPackages.ensurePublished({ relays })
  const created_at = Math.floor(Date.now() / 1000)
  const relayLists = {}
  for (const [kind, tag] of [[10051, "relay"], [10050, "relay"], [10002, "r"]]) {
    const event = await signer.signEvent({
      kind,
      created_at,
      tags: relays.map((url) => [tag, url]),
      content: "",
    })
    relayLists[kind] = { id: event.id, results: await network.publish(relays, event) }
  }
  return { keyPackage, relayLists }
}

/**
 * The peer's current kind-30443 key package event (for inviting them), or null.
 * Same lookup the M9 spike used (limit 1, newest the relay returns).
 */
export async function fetchKeyPackageEvent(network, relays, pubkey) {
  const [event] = await network.request(relays, [{ kinds: [30443], authors: [pubkey], limit: 1 }])
  return event ?? null
}
