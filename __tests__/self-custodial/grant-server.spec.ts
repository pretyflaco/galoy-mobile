/**
 * A3 — Lightning-address domain → lnurl-server base resolution.
 */
import { grantServerForAddress } from "@app/self-custodial/grants/server"

describe("grantServerForAddress", () => {
  it("maps the retired devbox subdomain to the apex (post-2026-08-25 cutover)", () => {
    expect(grantServerForAddress("lnbitsdev@lnurl.twentyone.ist")).toBe(
      "https://twentyone.ist",
    )
  })

  it("maps the apex domain explicitly", () => {
    expect(grantServerForAddress("lnbitsdev@twentyone.ist")).toBe("https://twentyone.ist")
  })

  it("falls back to https://<domain> for unknown domains", () => {
    expect(grantServerForAddress("user@blink.sv")).toBe("https://blink.sv")
  })

  it("is case- and whitespace-tolerant on the domain", () => {
    expect(grantServerForAddress("user@LNURL.TwentyOne.Ist ")).toBe(
      "https://twentyone.ist",
    )
  })

  it("throws on a non-address", () => {
    expect(() => grantServerForAddress("not-an-address")).toThrow(
      /invalid lightning address/,
    )
  })
})
