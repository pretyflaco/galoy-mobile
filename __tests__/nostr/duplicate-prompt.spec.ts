/**
 * Duplicate-prompt store (fix #4) — the runtime-owned 3-way (Replace/Keep/Cancel) that lives
 * outside the binary approval coordinator. Verifies the promise resolves with the chosen value,
 * the active entry clears afterwards, and subscribers are notified on show + resolve.
 */
import { createDuplicatePromptStore } from "@app/nostr/core/duplicate-prompt"
import type { DuplicateConnectionRequest } from "@app/nostr/transport/connect-flow"

const req: DuplicateConnectionRequest = {
  clientPubkey: "b".repeat(64),
  metadata: { name: "Damus" },
  existing: [{ clientPubkey: "a".repeat(64), metadata: { name: "Damus" } }],
}

describe("duplicate-prompt store", () => {
  it("resolves with the chosen resolution and clears the active entry", async () => {
    const store = createDuplicatePromptStore()
    const pending = store.prompt(req)
    expect(store.current()).not.toBeNull()
    store.current()?.resolve("replace")
    await expect(pending).resolves.toBe("replace")
    expect(store.current()).toBeNull()
  })

  it("notifies subscribers on show and on resolve", async () => {
    const store = createDuplicatePromptStore()
    const listener = jest.fn()
    store.subscribe(listener)
    const pending = store.prompt(req)
    expect(listener).toHaveBeenCalledTimes(1) // show
    store.current()?.resolve("cancel")
    expect(listener).toHaveBeenCalledTimes(2) // resolve/clear
    await pending
  })

  it("carries the existing records for the screen to display", () => {
    const store = createDuplicatePromptStore()
    store.prompt(req)
    expect(store.current()?.request.existing).toHaveLength(1)
  })
})
