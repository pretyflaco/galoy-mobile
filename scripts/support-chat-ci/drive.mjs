// CI smoke drive (node-only, adb-driven): onboard the app, create the nostr
// identity, start a support chat, send a message, and assert the peer's reply in
// logcat. Exit 0 only on a completed round trip (req 10: a green bundle proves
// nothing — the smoke must START a conversation on Hermes).
// Usage: node ci-smoke-drive.mjs [apk-path]
import { execSync, spawn } from "node:child_process"

const APK = process.argv[2] ?? "android/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk"
const adb = (cmd) => execSync(`adb ${cmd}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
const ok = (name, cond) => { console.log(`${cond ? "OK  " : "FAIL"} ${name}`); if (!cond) failed++ }

async function dump() {
  try {
    return await adb("exec-out uiautomator dump /dev/tty")
  } catch {
    return ""
  }
}
async function tapLabel(label, waitMs = 2500, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const xml = await dump()
    const m = xml.match(new RegExp(`text="${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`))
    if (m) {
      adb(`shell input tap ${(+m[1] + +m[3]) >> 1} ${(+m[2] + +m[4]) >> 1}`)
      await sleep(waitMs)
      return true
    }
    await sleep(1500)
  }
  return false
}
async function waitFor(pattern, timeoutMs) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if ((await dump()).includes(pattern)) return true
    await sleep(1500)
  }
  return false
}
async function openChatScreen() {
  adb("shell am start -n com.galoyapp.supportchat/com.galoyapp.MainActivity")
  if (!(await waitFor('content-desc="home-settings-button"', 40000))) return "home-timeout"
  adb("shell input tap 976 185")
  await sleep(2000)
  adb("shell input swipe 540 1900 540 700 400")
  await sleep(1500)
  if (!(await tapLabel("Support chat", 16000, 4))) return "row-not-found"
  return (await waitFor('text="Send"', 25000)) ? null : "screen-timeout"
}

adb(`install -r ${APK}`)
adb("logcat -c")
adb("shell pm clear com.galoyapp.supportchat")

// onboarding (self-custodial, no backend needed)
ok("onboard: create account", await tapLabel("Create new account", 4000))
ok("onboard: non-custodial", await tapLabel("Non-custodial", 1500))
ok("onboard: continue", await tapLabel("Continue", 6000))
ok("onboard: enhanced mode", await tapLabel("Enhanced&#10;Mode", 1500))
ok("onboard: continue 2", await tapLabel("Continue", 7000))
ok("onboard: accept", await tapLabel("Accept", 9000))
adb("shell input keyevent 111")
await sleep(1500)

// nostr identity + the chat screen
adb("shell input tap 976 185")
await sleep(2000)
adb("shell input swipe 540 1900 540 700 400")
await sleep(1500)
ok("nostr identity row", await tapLabel("Nostr identity", 6000))
ok("create identity", await tapLabel("Create new", 7000))
adb("shell input keyevent 4")
await sleep(2000)
const navErr = await openChatScreen()
ok(`chat screen open${navErr ? ` (${navErr})` : ""}`, navErr === null)
if (navErr) process.exit(1)

// start the conversation (roster gate → bot discovery → create + invite)
ok("start chat", await tapLabel("Start a support chat", 12000))
await sleep(6000)
let logcat = () => { try { return adb("logcat -d -s ReactNativeJS") } catch { return "" } }
ok("group created + bot invited", /group .* created, bot .* invited/.test(logcat()))
ok("greeting received (live)", /recv .* len=2\d\d/.test(logcat()))

// send + assert the reply
adb("shell input tap 463 2212")
await sleep(1200)
adb(`shell input text "ci${"%s"}smoke${"%s"}roundtrip"`)
await sleep(1200)
adb("shell input keyevent 111")
await sleep(1200)
adb("shell input tap 979 2212")
const t0 = Date.now()
let sent = false, reply = false
while (Date.now() - t0 < 30000 && !(sent && reply)) {
  const log = logcat()
  if (/support-chat\] sent/.test(log)) sent = true
  if (/recv .* len=/.test(log.split("support-chat] sent").slice(-1)[0] ?? "")) reply = true
  await sleep(1500)
}
ok("message sent", sent)
ok("peer reply received (E2EE round trip on Hermes)", reply)

console.log(failed === 0 ? "\nSUPPORT-CHAT SMOKE PASS" : `\nSUPPORT-CHAT SMOKE FAIL (${failed})`)
process.exit(failed === 0 ? 0 : 1)
