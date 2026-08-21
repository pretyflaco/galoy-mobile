/**
 * Nostr backup flow (2026-08-21 rework) — method chooser (Drive / Password Manager / Manual)
 * with Spark-flow parity, cloud screen with encrypt-by-default (AD-7), the two-step plaintext
 * acknowledgment, and i18n sourcing checks.
 */
import React from "react"
import { Platform } from "react-native"
import { render, fireEvent, waitFor } from "@testing-library/react-native"
import { readFileSync } from "fs"
import { join } from "path"

import { NostrBackupMethodScreen } from "@app/screens/nostr/backup/backup-method-screen"
import { NostrCloudBackupScreen } from "@app/screens/nostr/backup/cloud-backup-screen"

import { ContextForScreen } from "../screens/helper"
import { flushEffects } from "../helpers/flush-effects"

const renderMethod = (
  props: Partial<React.ComponentProps<typeof NostrBackupMethodScreen>> = {},
) =>
  render(
    <ContextForScreen>
      <NostrBackupMethodScreen
        busy={false}
        onCloud={jest.fn()}
        onPasswordManager={jest.fn()}
        onManual={jest.fn()}
        onNotNow={jest.fn()}
        {...props}
      />
    </ContextForScreen>,
  )

const renderCloud = (
  props: Partial<React.ComponentProps<typeof NostrCloudBackupScreen>> = {},
) =>
  render(
    <ContextForScreen>
      <NostrCloudBackupScreen
        busy={false}
        onUpload={jest.fn()}
        onCancel={jest.fn()}
        {...props}
      />
    </ContextForScreen>,
  )

describe("backup method screen", () => {
  it("offers cloud, password manager, and manual; every callback fires", async () => {
    // Password Manager is Android-only for the POC; jest defaults Platform.OS to ios.
    jest.replaceProperty(Platform, "OS", "android")
    const onCloud = jest.fn()
    const onPasswordManager = jest.fn()
    const onManual = jest.fn()
    const onNotNow = jest.fn()
    const { getByTestId } = renderMethod({
      onCloud,
      onPasswordManager,
      onManual,
      onNotNow,
    })
    await flushEffects()
    fireEvent.press(getByTestId("nostr-backup-cloud"))
    expect(onCloud).toHaveBeenCalledTimes(1)
    fireEvent.press(getByTestId("nostr-backup-password-manager"))
    expect(onPasswordManager).toHaveBeenCalledTimes(1)
    fireEvent.press(getByTestId("nostr-backup-manual"))
    expect(onManual).toHaveBeenCalledTimes(1)
    fireEvent.press(getByTestId("nostr-backup-not-now"))
    expect(onNotNow).toHaveBeenCalledTimes(1)
    jest.replaceProperty(Platform, "OS", "ios")
  })
})

describe("cloud backup screen (AD-7)", () => {
  it("encrypts by default: password fields shown, CTA gated until a valid pair", async () => {
    const onUpload = jest.fn()
    const { getByTestId, queryByTestId } = renderCloud({ onUpload })
    await flushEffects()
    // encrypted by default → password inputs visible, continue disabled until valid
    expect(getByTestId("nostr-cloud-password-input")).toBeTruthy()
    fireEvent.press(getByTestId("nostr-cloud-backup-continue"))
    expect(onUpload).not.toHaveBeenCalled()
    fireEvent.changeText(getByTestId("nostr-cloud-password-input"), "s3cret-s3cret")
    fireEvent.changeText(
      getByTestId("nostr-cloud-confirm-password-input"),
      "s3cret-s3cret",
    )
    fireEvent.press(getByTestId("nostr-cloud-backup-continue"))
    await waitFor(() =>
      expect(onUpload).toHaveBeenCalledWith({ password: "s3cret-s3cret" }),
    )
    // plaintext ack surface is NOT shown on the encrypted path
    expect(queryByTestId("nostr-backup-plaintext-confirm")).toBeNull()
  })

  it("plaintext path requires the two-step acknowledgment before any upload", async () => {
    const onUpload = jest.fn()
    const { getByTestId } = renderCloud({ onUpload })
    await flushEffects()
    // step 0: uncheck encryption → password fields disappear
    fireEvent.press(getByTestId("nostr-cloud-encrypt-checkbox"))
    // step 1: continue only OPENS the ack surface, does not upload
    fireEvent.press(getByTestId("nostr-cloud-backup-continue"))
    await waitFor(() =>
      expect(getByTestId("nostr-backup-plaintext-confirm")).toBeTruthy(),
    )
    expect(onUpload).not.toHaveBeenCalled()
    // cancel returns to the form
    fireEvent.press(getByTestId("nostr-backup-plaintext-cancel"))
    await waitFor(() => expect(getByTestId("nostr-cloud-backup-continue")).toBeTruthy())
    // step 2: reopen + the deliberate confirm acknowledges plaintext
    fireEvent.press(getByTestId("nostr-cloud-backup-continue"))
    await waitFor(() =>
      expect(getByTestId("nostr-backup-plaintext-confirm")).toBeTruthy(),
    )
    fireEvent.press(getByTestId("nostr-backup-plaintext-confirm"))
    expect(onUpload).toHaveBeenCalledWith({ acknowledgePlaintext: true })
  })
})

describe("backup copy is i18n-sourced", () => {
  const files = [
    "app/screens/nostr/backup/backup-method-screen.tsx",
    "app/screens/nostr/backup/cloud-backup-screen.tsx",
    "app/screens/nostr/backup/manual-backup-screen.tsx",
  ]

  it("no hardcoded JSX text / literal button titles", () => {
    for (const file of files) {
      const src = readFileSync(join(process.cwd(), file), "utf8")
      const jsxText = [...src.matchAll(/>\s*([A-Za-z][A-Za-z ,.'"!?]{3,})\s*</g)]
        .map((m) => m[1].trim())
        .filter((t) => !/^(string|number|boolean|View|Text|Svg|Input|Promise)$/.test(t))
      expect(jsxText).toEqual([])
      const literalTitles = [...src.matchAll(/title=\s*"([^"]+)"/g)].map((m) => m[1])
      expect(literalTitles).toEqual([])
    }
  })

  it("verbatim plaintext consequence + SR label match the spec", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const en = require("@app/i18n/en").default
    const ns = en.NostrBackupScreen
    expect(ns.plaintextConsequence).toBe(
      "Without a password, your key is stored unprotected in your cloud drive. " +
        "Anyone with access to that drive can use your identity. Continue without a password?",
    )
    expect(ns.plaintextSrLabel).toBe(
      "Back up without a password. Your key is stored unprotected. Continue or cancel.",
    )
  })
})
