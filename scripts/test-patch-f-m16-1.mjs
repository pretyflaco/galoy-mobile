// F-M16-1 guard unit test: extracts the injected helper from a PATCHED
// node_modules/@internet-privacy/marmot-ts/dist/engine/ingest.js and drives its three
// branches with a fake processMessage. Run after install:
//   node scripts/test-patch-f-m16-1.mjs [path/to/ingest.js]
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const path =
  process.argv[2] ??
  new URL("../node_modules/@internet-privacy/marmot-ts/dist/engine/ingest.js", import.meta.url).pathname
const src = readFileSync(path, "utf8")
const start = src.indexOf("function describeResult(")
const end = src.indexOf("function isPermanentDecryptFailure(")
assert.ok(start > 0 && end > start, "guard helper not found — is ingest.js patched?")
const helper = src.slice(start, end)

const anomalies = []
globalThis.__marmotIngestAnomaly = (a) => anomalies.push(a)
const load = (processMessage) =>
  new Function("processMessage", "bytesToHex", `${helper}; return processMessageGuarded;`)(
    processMessage,
    () => "00",
  )
const params = (callback) => ({ state: { groupContext: { groupId: new Uint8Array(1), epoch: 1n } }, callback })
const logs = []
const log = (...a) => logs.push(a)
let captures = 0
const makeCapture = () => ({ id: ++captures, callback: () => "accept" })

// 1. normal: an object passes straight through
{
  const g = load(async () => ({ kind: "newState" }))
  const { result, capture } = await g(makeCapture, params, log, "e1")
  assert.equal(result.kind, "newState")
  assert.equal(anomalies.length, 0)
  assert.equal(capture.id, captures)
}
// 2. the await path yields 0 while the promise itself resolved an object → promise value
{
  const obj = { kind: "newState" }
  let calls = 0
  const thenable = { then: (ok) => ok(++calls === 1 ? obj : 0) } // 1st .then = probe, 2nd = await
  const g = load(() => thenable)
  const before = captures
  const { result, capture } = await g(makeCapture, params, log, "e2")
  assert.equal(result, obj)
  assert.equal(capture.id, before + 1, "same attempt's capture is kept")
  assert.equal(anomalies.at(-1).recovered, "promise-value")
  assert.equal(anomalies.at(-1).awaited, "number(0)")
}
// 3. first computation genuinely 0, recompute succeeds with a FRESH capture
{
  let n = 0
  const g = load(async () => (++n === 1 ? 0 : { kind: "newState" }))
  const before = captures
  const { result, capture } = await g(makeCapture, params, log, "e3")
  assert.equal(result.kind, "newState")
  assert.equal(capture.id, before + 2, "recompute uses a fresh capture")
  assert.equal(anomalies.at(-1).promise, "number(0)")
}
// 4. both attempts 0 → throws (the engine's queued-for-retry path), gave-up reported
{
  const g = load(async () => 0)
  await assert.rejects(g(makeCapture, params, log, "e4"), /F-M16-1: processMessage returned a non-object twice/)
  assert.equal(anomalies.at(-1).kind, "processMessage-gave-up")
}
console.log("F-M16-1 guard: 4/4 pass")
