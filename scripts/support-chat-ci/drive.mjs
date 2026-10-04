// CI smoke drive (node-only, adb-driven). M19: the chat has its own device key, so the
// smoke STARTS the support chat before any account exists (Get started → Contact
// support), then onboards, finds the SAME conversation under Settings → Support (after
// a cold start), sends a message, asserts the peer's reply ON SCREEN, and opens the
// Conversations screen (header clock). Exit 0 only on a completed round trip (req 10: a green bundle proves
// nothing — the smoke must START a conversation on Hermes).
// Taps go by accessibility id (testProps → content-desc) or visible text, never by
// coordinates (the A56-measured taps did not transfer to the pixel_8 AVD). On every
// FAIL the screen + UI tree land in smoke-artifacts/ for the workflow artifact.
// Usage: node drive.mjs [apk-path]
import { execSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"

const APK = process.argv[2] ?? "android/app/build/outputs/apk/debug/app-x86_64-debug.apk"
const PKG = "com.blinkbtc.alpha"
const OUT = "smoke-artifacts"
mkdirSync(OUT, { recursive: true })

const adb = (cmd, opts = {}) =>
  execSync(`adb ${cmd}`, {
    encoding: opts.encoding ?? "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: opts.timeout ?? 60000,
    maxBuffer: 32 * 1024 * 1024,
  })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

function dump() {
  try {
    const xml = adb("exec-out uiautomator dump /dev/tty")
    if (xml.includes("<hierarchy")) return xml
  } catch {}
  try {
    adb("shell uiautomator dump /sdcard/ui.xml")
    return adb("exec-out cat /sdcard/ui.xml")
  } catch {
    return ""
  }
}

let failed = 0
let shot = 0
function evidence(tag) {
  shot++
  const name = `${OUT}/step-${String(shot).padStart(2, "0")}-${tag.replace(/[^a-z0-9]+/gi, "-")}`
  try { writeFileSync(`${name}.xml`, dump()) } catch {}
  try { writeFileSync(`${name}.png`, adb("exec-out screencap -p", { encoding: "buffer" })) } catch {}
}
const ok = (name, cond) => {
  console.log(`${cond ? "OK  " : "FAIL"} ${name}`)
  if (!cond) { failed++; evidence(name) }
  return cond
}

// first node whose `attr` equals `value` → its center
function find(xml, attr, value) {
  const m = xml.match(new RegExp(`${attr}="${esc(value)}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`))
  return m ? [(+m[1] + +m[3]) >> 1, (+m[2] + +m[4]) >> 1] : null
}
async function tap(attr, value, { waitMs = 2500, tries = 8 } = {}) {
  for (let i = 0; i < tries; i++) {
    const at = find(dump(), attr, value)
    if (at) {
      adb(`shell input tap ${at[0]} ${at[1]}`)
      await sleep(waitMs)
      return true
    }
    await sleep(1500)
  }
  return false
}
const tapText = (t, o) => tap("text", t, o)
// testProps ids land in content-desc; plain testID ids in resource-id
const tapId = async (id, o) =>
  (await tap("content-desc", id, { ...o, tries: 2 })) || tap("resource-id", id, o)
async function waitFor(pattern, timeoutMs) {
  const t0 = Date.now()
  const hit = (xml) => (pattern instanceof RegExp ? pattern.test(xml) : xml.includes(pattern))
  while (Date.now() - t0 < timeoutMs) {
    if (hit(dump())) return true
    await sleep(1500)
  }
  return false
}

const [W, H] = (adb("shell wm size").match(/(\d+)x(\d+)/) ?? [0, 1080, 2400]).slice(1).map(Number)
// scroll the current list until a row with this text is on screen, then tap it
async function scrollToText(text, waitMs = 6000) {
  for (let i = 0; i < 6; i++) {
    if (find(dump(), "text", text)) return tapText(text, { waitMs, tries: 1 })
    adb(`shell input swipe ${W >> 1} ${Math.round(H * 0.8)} ${W >> 1} ${Math.round(H * 0.3)} 400`)
    await sleep(1200)
  }
  return false
}
// same, by accessibility id (testProps → content-desc), e.g. a settings row's title
async function scrollToId(id, waitMs = 6000) {
  for (let i = 0; i < 6; i++) {
    if (find(dump(), "content-desc", id)) return tap("content-desc", id, { waitMs, tries: 1 })
    adb(`shell input swipe ${W >> 1} ${Math.round(H * 0.8)} ${W >> 1} ${Math.round(H * 0.3)} 400`)
    await sleep(1200)
  }
  return false
}
async function openSettings() {
  if (!(await waitFor('content-desc="home-settings-button"', 120000))) return false
  return tapId("home-settings-button", { waitMs: 2000 })
}
const logcat = () => { try { return adb("logcat -d -s ReactNativeJS") } catch { return "" } }
const peerLog = () => {
  try {
    return readFileSync(process.env.PEER_LOG ?? "/tmp/smoke-peer.log", "utf8")
  } catch {
    return ""
  }
}
const waitForPeer = async (marker, timeoutMs) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (peerLog().includes(marker)) return true
    await sleep(2000)
  }
  return false
}

console.log(`screen ${W}x${H}, apk ${APK}`)
adb(`install -r ${APK}`, { timeout: 180000 })
adb("logcat -c")
adb(`shell pm clear ${PKG}`)
adb(`shell am start -n ${PKG}/com.galoyapp.MainActivity`)

// M19: support BEFORE an account exists (kngako) — the device's own support key
ok("app started (get-started screen)", await waitFor('text="Create new account"', 180000))
ok("get started: contact support", await tapId("get-started-contact-support", { waitMs: 3000 }))
if (!ok("chat screen open without an account", await waitFor("support-chat-start", 30000))) process.exit(1)
evidence("pre-account-chat")
// M20 (Hermes F): the peer's PHASE-0 attack lands here — before any conversation.
// A broken gate would make the phish group THE chat: "start chat" and the greeting
// below would fail. The marker proves the attack actually ran (no vacuous pass).
ok("phase-0 attack sent (pre-conversation)", await waitForPeer("attack sent (phase 0", 90000))
// start the conversation (roster gate → bot discovery → create + invite → peer Welcome)
ok("start chat (phase-0 attack was refused)", await tapId("support-chat-start", { waitMs: 3000, tries: 10 }))
ok("composer shown (group created)", await waitFor('"support-chat-input"', 60000))
ok("peer joined + greeting shown (live E2EE)", await waitFor("CI Smoke Bot joined", 60000))
adb("shell input keyevent 4") // back to Get started
await sleep(2000)

// onboarding (self-custodial, no backend needed)
ok("back on get-started", await waitFor('text="Create new account"', 30000))
ok("onboard: create account", await tapText("Create new account", { waitMs: 4000 }))
ok("onboard: non-custodial", await tapText("Non-custodial", { waitMs: 1500 }))
ok("onboard: continue", await tapText("Continue", { waitMs: 6000 }))
ok("onboard: enhanced mode", await tapText("Enhanced&#10;Mode", { waitMs: 1500 }))
ok("onboard: continue 2", await tapText("Continue", { waitMs: 7000 }))
ok("onboard: accept", await tapText("Accept", { waitMs: 9000 }))
adb("shell input keyevent 111")
await sleep(1500)

// the same conversation under Settings → Support, after a cold start (no Nostr identity
// was ever created: the chat does not need one)
adb(`shell am force-stop ${PKG}`)
adb(`shell am start -n ${PKG}/com.galoyapp.MainActivity`)
ok("settings (chat)", await openSettings())
ok("support row", await scrollToId("Support", 8000))
if (!ok("same conversation after onboarding (composer, no start)", await waitFor('"support-chat-input"', 60000))) process.exit(1)
ok("greeting still on screen", await waitFor("CI Smoke Bot joined", 30000))

// send + assert the reply
ok("focus composer", await tapId("support-chat-input", { waitMs: 1200 }))
adb(`shell input text "ci%ssmoke%sroundtrip"`)
await sleep(1200)
adb("shell input keyevent 111")
await sleep(1200)
ok("send", await tapId("support-chat-send", { waitMs: 1500 }))
ok(
  "peer reply shown (E2EE round trip on Hermes)",
  // uiautomator single-quotes an attribute whose text holds `"` (run 36837196029: the
  // reply WAS on screen, the &quot; pattern missed it)
  await waitFor(/copy (&quot;|")ci smoke roundtrip(&quot;|")/, 45000),
)
evidence("final")

// M20: the CI peer also ran an unsolicited-invite ATTACK (ephemeral attacker key,
// attacker-admined group, "Support (CI Smoke Bot): ci-smoke-phish …" phishing text)
// while this conversation was active. The fixed app refuses the invite — the phish
// never renders, and the round-trip above already proved the ticket was not replaced.
ok("attack never rendered (M20 invite gate)", !/ci-smoke-phish/.test(dump()))

// M19 (Andrej): header clock → Conversations (the current one checked) → back
ok("conversations (header clock)", await tapId("support-chat-conversations", { waitMs: 2500 }))
ok("conversations screen", await waitFor("support-conversations-screen", 15000))
ok("current conversation checked", await waitFor("support-conversation-current", 5000))
ok("title = the first message", await waitFor("ci smoke roundtrip", 5000))
// M20 (Hermes F): exactly ONE conversation — a broken gate would have parked the
// phase-1 attacker's group as a second row.
ok(
  "exactly one conversation (phase-1 attack not parked either)",
  (dump().match(/support-conversation-row/g) ?? []).length === 1,
)
evidence("conversations")
adb("shell input keyevent 4")

// diagnostics only (P7 removes the TEMP recv logs — the UI is the assertion)
const log = logcat()
console.log(`logcat: created=${/group .* created/.test(log)} sent=${/support-chat\] sent/.test(log)}`)
ok(
  "logcat: BOTH attacks refused (phase 0 + phase 1)",
  (log.match(/invite from \S+ refused/g) ?? []).length >= 2,
)
console.log(failed === 0 ? "\nSUPPORT-CHAT SMOKE PASS" : `\nSUPPORT-CHAT SMOKE FAIL (${failed})`)
process.exit(failed === 0 ? 0 : 1)
