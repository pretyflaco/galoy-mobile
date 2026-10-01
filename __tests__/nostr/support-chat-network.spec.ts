/**
 * F-M18-7: the F-M12-2 recovery hooks on the vendored network adapter. They were set
 * on the wrong object (`this` inside the returned subscribe()) and never fired; and once
 * live, closes WE cause (unsubscribe, destroy) must not count as a dead subscription.
 */
import { SimplePoolNetwork } from "@blink-support-chat/adapters/network.js"

type Params = {
  onevent: (e: { id: string }) => void
  onclose: (reasons: { url: string; reason: string }[]) => void
}

const fakeNetwork = () => {
  const net = new SimplePoolNetwork({ signer: { signEvent: jest.fn() }, relays: [] })
  const subs: Params[] = []
  net.pool = {
    subscribeMany: (_relays: string[], _filter: unknown, params: Params) => {
      subs.push(params)
      return {
        close: () => params.onclose([{ url: "wss://r", reason: "closed by caller" }]),
      }
    },
    destroy: async () => {
      subs.forEach((p) =>
        p.onclose([{ url: "wss://r", reason: "relay connection closed by us" }]),
      )
    },
  }
  const onSubClosed = jest.fn()
  net.onSubClosed = onSubClosed
  return { net, subs, onSubClosed }
}

describe("support-chat network adapter hooks", () => {
  it("a kind-445 event marks transport activity on the NETWORK", () => {
    const { net, subs } = fakeNetwork()
    const next = jest.fn()
    net.subscription(["wss://r"], { kinds: [445] }).subscribe({ next })
    subs[0].onevent({ id: "e1" })
    expect(next).toHaveBeenCalledTimes(1)
    expect(net.activity445At).toBeGreaterThan(0)
  })

  it("a relay/connection close fires onSubClosed with a readable reason", () => {
    const { net, subs, onSubClosed } = fakeNetwork()
    net.subscription(["wss://r"], { kinds: [445] }).subscribe({})
    subs[0].onclose([{ url: "wss://r", reason: "relay connection closed" }])
    expect(onSubClosed).toHaveBeenCalledWith("wss://r: relay connection closed")
  })

  it("our own unsubscribe is not a dead subscription", () => {
    const { net, onSubClosed } = fakeNetwork()
    net
      .subscription(["wss://r"], { kinds: [445] })
      .subscribe({})
      .unsubscribe()
    expect(onSubClosed).not.toHaveBeenCalled()
  })

  it("closes caused by destroy() are not dead subscriptions either", async () => {
    const { net, onSubClosed } = fakeNetwork()
    net.subscription(["wss://r"], { kinds: [445] }).subscribe({})
    await net.destroy()
    expect(onSubClosed).not.toHaveBeenCalled()
  })
})
