/**
 * Story 3.4 — ApprovalCoordinator core (AC #1/#2/#3, AD-9/AD-16).
 *
 * A single coordinator owns ALL approval surfacing, strictly serialized FIFO, exposing queue
 * depth. Exactly one surface presented at a time; entry N+1 only after N resolves. Every
 * request raises its own approval EXCEPT requests covered by the per-connection connect-time
 * grant (v1: sign_event:22242). Identity-mutation is an exclusive section: the coordinator
 * PAUSES presentation and the executor re-checks the identity epoch (approved-against-N never
 * executes against N+1).
 *
 * Framework-agnostic (approval/, AD-1): no React/UI; the "surface" is an injected present port.
 */
import {
  createApprovalCoordinator,
  getApprovalCoordinator,
  __resetApprovalCoordinatorForTest,
  type RequestApprovalEntry,
} from "../../app/nostr/approval/coordinator"

const requestEntry = (
  id: string,
  over: Partial<RequestApprovalEntry> = {},
): RequestApprovalEntry => ({
  id,
  kind: "request",
  clientPubkey: "client-" + id,
  method: "sign_event",
  eventKind: 1,
  humanAction: "sign an event",
  ...over,
})

describe("serialized FIFO + exposed depth (AC #1)", () => {
  it("presents entries strictly FIFO — N+1 only after N resolves", async () => {
    const presented: string[] = []
    const coord = createApprovalCoordinator({
      present: async (entry) => {
        presented.push(entry.id)
      },
    })
    const p1 = coord.enqueue(requestEntry("a"))
    const p2 = coord.enqueue(requestEntry("b"))
    // only the first is presented until it resolves
    await Promise.resolve()
    expect(presented).toEqual(["a"])

    coord.resolveActive({ approved: true })
    await p1
    await Promise.resolve()
    expect(presented).toEqual(["a", "b"])
    coord.resolveActive({ approved: true })
    await p2
  })

  it("exposes queueDepth, decrementing by exactly one per resolved entry", async () => {
    const coord = createApprovalCoordinator({ present: async () => undefined })
    coord.enqueue(requestEntry("a"))
    coord.enqueue(requestEntry("b"))
    coord.enqueue(requestEntry("c"))
    expect(coord.queueDepth()).toBe(3)
    coord.resolveActive({ approved: true })
    await Promise.resolve()
    expect(coord.queueDepth()).toBe(2)
    coord.resolveActive({ approved: false })
    await Promise.resolve()
    expect(coord.queueDepth()).toBe(1)
  })

  it("presents only ONE surface at a time under a same-tick burst", async () => {
    // A surface stays "open" until resolveActive; track how many are open concurrently.
    let open = 0
    let maxOpen = 0
    const coord = createApprovalCoordinator({
      present: async () => {
        open += 1
        maxOpen = Math.max(maxOpen, open)
      },
    })
    coord.enqueue(requestEntry("a"))
    coord.enqueue(requestEntry("b"))
    coord.enqueue(requestEntry("c"))
    await Promise.resolve()
    // Close each surface (open→closed) as its decision resolves; the next opens only then.
    const depthsSeen: number[] = []
    const resolveOne = async () => {
      depthsSeen.push(coord.queueDepth())
      open -= 1 // the presented surface closes on decision
      coord.resolveActive({ approved: true })
      await Promise.resolve()
    }
    await resolveOne()
    await resolveOne()
    await resolveOne()
    expect(depthsSeen).toEqual([3, 2, 1])
    expect(maxOpen).toBe(1) // never more than one surface open at once
  })
})

describe("approve-every-request except the connect-time grant (AC #2/#3)", () => {
  it("a request covered by the connect-time grant is NOT presented (pre-approved)", async () => {
    const presented: string[] = []
    const coord = createApprovalCoordinator({
      present: async (e) => {
        presented.push(e.id)
      },
      isCoveredByGrant: async (entry) =>
        entry.kind === "request" &&
        entry.method === "sign_event" &&
        entry.eventKind === 22242, // the fixed grant
    })
    const decision = await coord.enqueue(requestEntry("auth", { eventKind: 22242 }))
    expect(decision).toMatchObject({ approved: true }) // pre-approved, no surface
    expect(presented).toEqual([])
  })

  it("approving N does NOT auto-resolve N+1 (each awaits its own decision)", async () => {
    const coord = createApprovalCoordinator({ present: async () => undefined })
    const pa = coord.enqueue(requestEntry("a"))
    const pb = coord.enqueue(requestEntry("b"))
    coord.resolveActive({ approved: true })
    const a = await pa
    expect(a).toMatchObject({ approved: true })
    // b is still pending until its own resolve
    let bResolved = false
    pb.then(() => {
      bResolved = true
    })
    await Promise.resolve()
    expect(bResolved).toBe(false)
    coord.resolveActive({ approved: false })
    expect(await pb).toMatchObject({ approved: false })
  })

  it("a sign_event:22242 request on a connection WITHOUT the grant still presents", async () => {
    const presented: string[] = []
    const coord = createApprovalCoordinator({
      present: async (e) => {
        presented.push(e.id)
      },
      isCoveredByGrant: async () => false, // this connection did not grant it
    })
    const p = coord.enqueue(requestEntry("auth", { eventKind: 22242 }))
    await Promise.resolve()
    expect(presented).toEqual(["auth"]) // still raises
    coord.resolveActive({ approved: true })
    await p
  })
})

describe("process-wide singleton (AD-9 single owner)", () => {
  afterEach(() => __resetApprovalCoordinatorForTest())

  it("returns the same coordinator instance across calls", () => {
    const a = getApprovalCoordinator()
    const b = getApprovalCoordinator()
    expect(a).toBe(b)
  })

  it("its runExclusive commits and returns the epoch (identity-mutation seam)", async () => {
    const coord = getApprovalCoordinator()
    const epoch = await coord.runExclusive(async () => 42)
    expect(epoch).toBe(42)
  })
})

describe("UI subscription (AC #1 exposed depth)", () => {
  it("notifies subscribers on enqueue and on resolve so the UI can re-render", async () => {
    const coord = createApprovalCoordinator({ present: async () => undefined })
    const seen: number[] = []
    const unsub = coord.subscribe(() => seen.push(coord.queueDepth()))
    coord.enqueue(requestEntry("a"))
    coord.enqueue(requestEntry("b"))
    coord.resolveActive({ approved: true })
    await Promise.resolve()
    expect(seen).toContain(1) // enqueue → depth 1
    expect(seen).toContain(2) // enqueue → depth 2
    expect(seen[seen.length - 1]).toBe(1) // after one resolve → depth 1
    unsub()
    coord.enqueue(requestEntry("c"))
    // no further notifications after unsubscribe
    expect(seen[seen.length - 1]).toBe(1)
  })
})

describe("identity-mutation exclusive section + epoch (AC #1 substrate, AD-9)", () => {
  it("PAUSES presentation during an exclusive section and resumes after commit", async () => {
    const presented: string[] = []
    const coord = createApprovalCoordinator({
      present: async (e) => {
        presented.push(e.id)
      },
    })

    const commit = coord.runExclusive(async () => {
      // during the exclusive section, a newly enqueued request must NOT be presented
      coord.enqueue(requestEntry("held"))
      await Promise.resolve()
      expect(presented).toEqual([]) // held while paused
      return 7 // the new epoch
    })
    const epoch = await commit
    expect(epoch).toBe(7)

    await Promise.resolve()
    expect(presented).toEqual(["held"]) // presented once the section committed
  })

  it("stamps the identity epoch at approval; executor rejects an epoch mismatch", async () => {
    const coord = createApprovalCoordinator({
      present: async () => undefined,
      currentEpoch: () => 1,
    })
    const p = coord.enqueue(requestEntry("a"))
    coord.resolveActive({ approved: true })
    const decision = await p
    expect(decision).toMatchObject({ approved: true, epoch: 1 })

    // a request approved against epoch 1 must NOT be valid against epoch 2
    expect(coord.isEpochValid(decision, 2)).toBe(false)
    expect(coord.isEpochValid(decision, 1)).toBe(true)
  })
})
