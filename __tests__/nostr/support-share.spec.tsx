/**
 * M19 "Share details": the message format (readable text + structured tags), the
 * transaction fields (self-custodial: the real hash/txid replace the Breez payment id),
 * support's request recognition, and the share screen (every value shown, deselectable,
 * exactly the previewed text sent).
 */
import React from "react"
import { fireEvent, render } from "@testing-library/react-native"

/* eslint-disable @typescript-eslint/no-explicit-any */
let mockedClient: any = null
let mockedFields: any[] = []
const navigate = jest.fn()
jest.mock("@app/support-chat/use-support-chat", () => ({
  useSupportChat: () => ({ client: mockedClient, error: null }),
}))
jest.mock("@app/support-chat/use-share-details", () => ({
  useAccountDetailFields: () => ({ fields: mockedFields, loading: false }),
}))
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate, goBack: jest.fn(), setOptions: jest.fn() }),
}))

import {
  detailsTags,
  detailsText,
  isDetailsMessage,
  requestOf,
  transactionFields,
} from "@app/support-chat/details"
import { SupportShareDetailsScreen } from "@app/screens/support-chat/support-share-details-screen"
import { allowedBlobUrl, imageExt } from "@app/support-chat/media"
import { loadLocale } from "@app/i18n/i18n-util.sync"

import { ContextForScreen } from "../screens/helper"
import { flushEffects } from "../helpers/flush-effects"

loadLocale("en")

const fields = [
  { key: "app_version", label: "App", value: "Blink 2.2.328 (Android 36)" },
  { key: "account_type", label: "Account", value: "non-custodial (Enhanced)" },
  { key: "wallet_id", label: "Wallet identifier", value: "02abc" },
]

describe("share details: format", () => {
  it("readable text and structured tags carry the same values", () => {
    expect(detailsText("account", fields)).toBe(
      "My app & account details:\n• App: Blink 2.2.328 (Android 36)\n• Account: non-custodial (Enhanced)\n• Wallet identifier: 02abc",
    )
    const tags = detailsTags("account", fields)
    expect(tags[0]).toEqual(["blink-details", "account"])
    expect(tags).toContainEqual(["detail", "wallet_id", "02abc"])
    expect(isDetailsMessage(tags)).toBe(true)
    expect(isDetailsMessage([["p", "x"]])).toBe(false)
  })

  it("recognises only known requests", () => {
    expect(requestOf([["blink-request", "tx"]])).toBe("tx")
    expect(requestOf([["blink-request", "details"]])).toBe("details")
    expect(requestOf([["blink-request", "seed"]])).toBeNull()
    expect(requestOf(undefined)).toBeNull()
  })

  const ln: any = {
    id: "tx1",
    createdAt: 1790900000,
    direction: "SEND",
    status: "FAILURE",
    settlementAmount: -2100,
    settlementCurrency: "BTC",
    initiationVia: {
      __typename: "InitiationViaLn",
      paymentHash: "aa11",
      paymentRequest: "",
    },
    settlementVia: { __typename: "SettlementViaLn", preImage: null },
  }

  it("custodial lightning: payment hash + Blink transaction ID", () => {
    const f = transactionFields(ln)
    expect(f.find((x) => x.key === "payment_hash")?.value).toBe("aa11")
    expect(f.find((x) => x.key === "transaction_id")?.value).toBe("tx1")
    expect(f.find((x) => x.key === "amount")?.value).toBe("2100 sats")
    expect(f.find((x) => x.key === "status")?.value).toBe("failure")
  })

  it("self-custodial: never the Breez payment id as a hash; the SDK's real ids instead", () => {
    const sc = {
      ...ln,
      initiationVia: {
        __typename: "InitiationViaLn",
        paymentHash: "breez-id",
        paymentRequest: "",
      },
    }
    const withoutSdk = transactionFields(sc, { paymentId: "breez-id" })
    expect(withoutSdk.find((x) => x.key === "payment_hash")).toBeUndefined()
    expect(withoutSdk.find((x) => x.key === "payment_id")?.value).toBe("breez-id")
    const withSdk = transactionFields(sc, { paymentId: "breez-id", paymentHash: "real" })
    expect(withSdk.find((x) => x.key === "payment_hash")?.value).toBe("real")
  })

  it("on-chain: the txid", () => {
    const oc = {
      ...ln,
      initiationVia: { __typename: "InitiationViaOnChain", address: "bc1q" },
      settlementVia: { __typename: "SettlementViaOnChain", transactionHash: "dead" },
    }
    expect(transactionFields(oc).find((x) => x.key === "txid")?.value).toBe("dead")
  })
})

describe("pictures from support (M19 phase 2)", () => {
  const sha = "b".repeat(64)
  it("downloads only https blobs on Blink's Blossom", () => {
    expect(allowedBlobUrl(`https://blossom.twentyone.ist/${sha}`)).toBe(true)
    expect(allowedBlobUrl(`http://blossom.twentyone.ist/${sha}`)).toBe(false)
    expect(allowedBlobUrl(`https://evil.example/${sha}`)).toBe(false)
    expect(allowedBlobUrl(`https://blossom.twentyone.ist.evil.example/${sha}`)).toBe(
      false,
    )
    expect(allowedBlobUrl(`https://blossom.twentyone.ist/${sha}?x=1`)).toBe(false)
    expect(allowedBlobUrl("https://blossom.twentyone.ist/../x")).toBe(false)
  })
  it("shows only real JPEG / PNG / WebP", () => {
    expect(imageExt(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg")
    expect(imageExt(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0]))).toBe(
      "png",
    )
    expect(imageExt(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull()
  })
})

describe("share details: screen", () => {
  const renderScreen = () =>
    render(
      <ContextForScreen>
        <SupportShareDetailsScreen />
      </ContextForScreen>,
    )

  it("shows every value, lets the customer drop one, and sends exactly the preview", async () => {
    mockedFields = fields
    mockedClient = { ensureConversation: jest.fn(async () => undefined), send: jest.fn() }
    const { getByTestId } = renderScreen()
    await flushEffects()
    expect(String(getByTestId("support-share-preview").props.children)).toContain("02abc")
    fireEvent.press(getByTestId("support-share-field-wallet_id")) // deselect
    expect(String(getByTestId("support-share-preview").props.children)).not.toContain(
      "02abc",
    )
    fireEvent.press(getByTestId("support-share-send"))
    await flushEffects()
    expect(mockedClient.ensureConversation).toHaveBeenCalled()
    const [text, tags] = mockedClient.send.mock.calls[0]
    expect(text).not.toContain("02abc")
    expect(text).toContain("Blink 2.2.328")
    expect(tags).not.toContainEqual(["detail", "wallet_id", "02abc"])
    expect(navigate).toHaveBeenCalledWith("supportChat")
  })
})
