/**
 * A3 — Lightning-address domain → lnurl-server base resolution.
 */
import { grantServerForAddress } from "@app/self-custodial/grants/server"

describe("grantServerForAddress", () => {
  it("maps the devbox POC domain to its explicit base", () => {
    expect(grantServerForAddress("lnbitsdev@lnurl.twentyone.ist")).toBe(
      "https://lnurl.twentyone.ist",
    )
  })

  it("falls back to https://<domain> for unknown domains", () => {
    expect(grantServerForAddress("user@blink.sv")).toBe("https://blink.sv")
  })

  it("is case- and whitespace-tolerant on the domain", () => {
    expect(grantServerForAddress("user@LNURL.TwentyOne.Ist ")).toBe(
      "https://lnurl.twentyone.ist",
    )
  })

  it("throws on a non-address", () => {
    expect(() => grantServerForAddress("not-an-address")).toThrow(
      /invalid lightning address/,
    )
  })
})
