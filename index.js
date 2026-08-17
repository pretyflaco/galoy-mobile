// This is the first file that ReactNative will run when it starts up.
//
// We jump out of here immediately and into our main entry point instead.
//
// It is possible to have React Native load our main module first, but we'd have to
// change that in both AppDelegate.m and MainApplication.java.  This would have the
// side effect of breaking other tooling like mobile-center and react-native-rename.
//
// It's easier just to leave it here.

// FIRST: install the Hermes TextEncoder/TextDecoder polyfill before ANY other import. The
// nostr-signer + its crypto deps reference these globals at module-load time; on Hermes they
// don't exist, so this import must run ahead of firebase/App. (ES imports are evaluated in
// order, so importing this side-effect module first guarantees the globals are ready.)
import "./app/polyfills/text-encoding"
// SECOND (still before any nostr-tools/@noble consumer): install crypto.getRandomValues on
// Hermes. nostr-tools finalizeEvent → @noble schnorr signing reads global crypto.getRandomValues
// for aux randomness; without it every signed NIP-46 event throws and the connect-ack never
// publishes (BTCPay plugin then times out).
import "./app/polyfills/crypto-get-random-values"

import "@react-native-firebase/app"
import * as React from "react"

// Silence modular API deprecation warnings for now
globalThis.RNFB_SILENCE_MODULAR_DEPRECATION_WARNINGS = true
// Enable strict mode to catch any missed deprecations
// globalThis.RNFB_MODULAR_DEPRECATION_STRICT_MODE = true
import { AppRegistry, LogBox } from "react-native"

import { App } from "./app/app.tsx"

// Disables showing errors and warnings on UI - they still get shown on console
// Ensures elements are visible deterministically during tests
LogBox.ignoreAllLogs(true)

/**
 * This needs to match what's found in your app_delegate.m and MainActivity.java.
 */
const APP_NAME = "GaloyApp"

const RootComponent = () => <App />

AppRegistry.registerComponent(APP_NAME, () => RootComponent)
