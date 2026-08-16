/**
 * Story 1.7 — backup screen UI + i18n (Tasks 1,3,4,5). Encrypted-by-default; the
 * plaintext path requires the {consent-danger} acknowledgment (destructive control off
 * default focus); "Not now" never blocks. Verbatim copy + SR label from i18n.
 */
import React from "react"
import { render, fireEvent, waitFor } from "@testing-library/react-native"
import { readFileSync } from "fs"
import { join } from "path"

import { NostrBackupScreen } from "@app/screens/nostr/backup"

import { ContextForScreen } from "../screens/helper"
import { flushEffects } from "../helpers/flush-effects"

const renderScreen = (
  props: Partial<React.ComponentProps<typeof NostrBackupScreen>> = {},
) =>
  render(
    <ContextForScreen>
      <NostrBackupScreen
        onEncryptedBackup={jest.fn()}
        onPlaintextAcknowledged={jest.fn()}
        onNotNow={jest.fn()}
        {...props}
      />
    </ContextForScreen>,
  )

describe("backup screen (AC-1/AC-3/AC-4)", () => {
  it("encrypted backup requires a password (CTA disabled until entered)", async () => {
    const onEncryptedBackup = jest.fn()
    const { getByTestId } = renderScreen({ onEncryptedBackup })
    await flushEffects()
    fireEvent.press(getByTestId("nostr-backup-encrypt")) // disabled, no password
    expect(onEncryptedBackup).not.toHaveBeenCalled()
    fireEvent.changeText(getByTestId("nostr-backup-password"), "s3cret")
    fireEvent.press(getByTestId("nostr-backup-encrypt"))
    expect(onEncryptedBackup).toHaveBeenCalledWith("s3cret")
  })

  it("plaintext path requires the consent-danger acknowledgment (two deliberate steps)", async () => {
    const onPlaintextAcknowledged = jest.fn()
    const { getByTestId } = renderScreen({ onPlaintextAcknowledged })
    await flushEffects()
    // step 1: choosing "without a password" only OPENS the ack surface, does not back up
    fireEvent.press(getByTestId("nostr-backup-without-password"))
    await waitFor(() =>
      expect(getByTestId("nostr-backup-plaintext-confirm")).toBeTruthy(),
    )
    expect(onPlaintextAcknowledged).not.toHaveBeenCalled()
    // cancel returns to the safe default path
    expect(getByTestId("nostr-backup-plaintext-cancel")).toBeTruthy()
    // step 2: the deliberate confirm acknowledges plaintext
    fireEvent.press(getByTestId("nostr-backup-plaintext-confirm"))
    expect(onPlaintextAcknowledged).toHaveBeenCalledTimes(1)
  })

  it("'Not now' declines without blocking", async () => {
    const onNotNow = jest.fn()
    const { getByTestId } = renderScreen({ onNotNow })
    await flushEffects()
    fireEvent.press(getByTestId("nostr-backup-not-now"))
    expect(onNotNow).toHaveBeenCalledTimes(1)
  })
})

describe("backup copy is i18n-sourced (AC-5)", () => {
  const screen = join(process.cwd(), "app/screens/nostr/backup/nostr-backup-screen.tsx")

  it("no hardcoded JSX text / literal button titles", () => {
    const src = readFileSync(screen, "utf8")
    const jsxText = [...src.matchAll(/>\s*([A-Za-z][A-Za-z ,.'"!?]{3,})\s*</g)]
      .map((m) => m[1].trim())
      .filter((t) => !/^(string|number|boolean|View|Text|Svg|Input)$/.test(t))
    expect(jsxText).toEqual([])
    const literalTitles = [...src.matchAll(/title=\s*"([^"]+)"/g)].map((m) => m[1])
    expect(literalTitles).toEqual([])
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
    expect(ns.passwordPrompt).toContain("Blink never sees it")
  })
})
