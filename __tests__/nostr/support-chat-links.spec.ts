/**
 * Tappable links in support messages (app/support-chat/links.ts, M20 2026-10-06):
 * exact host allowlist (+ the GitHub org path rule), blink:// screens without payment
 * pre-fill, lookalikes stay text.
 */
import {
  SUPPORT_APP_LINKS,
  allowedAppLink,
  allowedWebUrl,
  splitLinks,
} from "@app/support-chat/links"

describe("support-chat links", () => {
  it("allows exactly the support web hosts over https", () => {
    for (const u of [
      "https://faq.blink.sv/using-blink/what-are-blinks-account-limits",
      "https://faq.blink.sv/espanol/blink-payment-methods/on-chain",
      "https://blink.sv/",
      "https://www.blink.sv/en/blog/some-post",
      "https://dev.blink.sv/api/auth",
      "https://blink.statuspage.io/",
      "https://github.com/blinkbitcoin/blink-mobile/releases",
      "https://FAQ.Blink.SV/x",
    ])
      expect(allowedWebUrl(u)).not.toBeNull()
  })

  it("refuses lookalikes, userinfo, ports, http, other GitHub orgs", () => {
    for (const u of [
      "http://faq.blink.sv/x",
      "https://faq.blink.sv.evil.example/x",
      "https://blink.sv@evil.example/x",
      "https://user:pw@faq.blink.sv/x",
      "https://faq.blink.sv:8443/x",
      "https://evilblink.sv/x",
      "https://github.com/blinkbitcoin-support/scam",
      "https://github.com/someone/blinkbitcoin/x",
      "https://www.github.com/blinkbitcoin/blink",
      "https://gist.github.com/blinkbitcoin/x",
      // eslint-disable-next-line no-script-url
      "javascript:alert(1)",
      "not a url",
    ])
      expect(allowedWebUrl(u)).toBeNull()
  })

  it("app links: only listed screens, never payment routes", () => {
    expect(allowedAppLink("blink://settings/security")?.target.screen).toBe("security")
    expect(allowedAppLink("blink://settings/security/")?.path).toBe("settings/security")
    expect(allowedAppLink("blink://circles")?.target.params).toEqual({
      screen: "People",
      params: { screen: "circlesDashboard" },
    })
    for (const u of [
      "blink://send",
      "blink://settings/delete-account",
      "blink://pay/attacker",
      "bitcoin://bc1qxyz",
      "lightning://lnbc1",
      "blink://settings/security?amount=1",
      "blink://../settings",
    ])
      expect(allowedAppLink(u)).toBeNull()
    // nothing in the support list can pre-fill a payment
    for (const path of Object.keys(SUPPORT_APP_LINKS))
      expect(path).not.toMatch(/send|pay|scan|convert|lnurl|invoice/)
  })

  it("splits prose into text / web / app segments, punctuation stays prose", () => {
    const s = splitLinks(
      "See https://faq.blink.sv/using-blink/what-are-blinks-account-limits. Or open blink://settings/tx-limits, thanks!",
    )
    expect(s.map((x) => x.kind)).toEqual(["text", "web", "text", "app", "text"])
    expect(s[1]).toMatchObject({
      url: "https://faq.blink.sv/using-blink/what-are-blinks-account-limits",
    })
    expect(s[2].text).toBe(". Or open ")
    expect(s[4].text).toBe(", thanks!")
  })

  it("a link in parentheses keeps its own closing parenthesis out", () => {
    const s = splitLinks("(more: https://faq.blink.sv/blink-circles)")
    expect(s.map((x) => x.kind)).toEqual(["text", "web", "text"])
    expect(s[1]).toMatchObject({ url: "https://faq.blink.sv/blink-circles" })
    expect(s[2].text).toBe(")")
  })

  it("markdown [label](url): label linked when allowed, else shown with the URL", () => {
    const ok = splitLinks(
      "Read [the limits page](https://faq.blink.sv/using-blink/what-are-blinks-account-limits) please",
    )
    expect(ok[1]).toMatchObject({ kind: "web", text: "the limits page" })
    const bad = splitLinks("Read [the limits page](https://blink-help.example/x)")
    expect(bad).toEqual([
      { kind: "text", text: "Read the limits page (https://blink-help.example/x)" },
    ])
  })

  it("unknown links and plain text stay text, unchanged", () => {
    const t = "Visit https://claim-blink.example/verify or blink://send now"
    expect(splitLinks(t)).toEqual([{ kind: "text", text: t }])
    expect(splitLinks("no links here")).toEqual([{ kind: "text", text: "no links here" }])
    expect(splitLinks("")).toEqual([])
  })
})
