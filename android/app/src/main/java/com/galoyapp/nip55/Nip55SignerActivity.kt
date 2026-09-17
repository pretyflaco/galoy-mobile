package com.galoyapp.nip55

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * NIP-55 (Android Nostr signer intents) entry point — makes Blink answerable from the Android
 * system chooser for `nostrsigner://` VIEW intents (the protocol vezir-android's
 * "Sign in with Nostr" uses, and what Amber implements).
 *
 * Shape (deliberately mirrors Amber's SignerActivity task semantics):
 *  - `taskAffinity=""` + `singleTask` + translucent theme, so this activity is hosted INSIDE
 *    the CALLER's task and a later `setResult` + `finish()` returns cleanly to it. NEVER call
 *    `finishAndRemoveTask()` here — that would remove the CALLER's task.
 *  - This activity renders NOTHING. It extracts the raw request into [Nip55PendingStore] and
 *    forwards to `MainActivity`, which brings the RN app (approval coordinator UI) forward.
 *    The JS side consumes the request via `Nip55Module.consumePending()` and answers with
 *    `Nip55Module.complete()`, which delivers the result on the activity held here.
 *
 * Manifest-gated like every signer entry point: the component ships `enabled="false"` and the
 * RN provider mirrors the `nostrSignerEnabled` remote flag onto it via
 * `PackageManager.setComponentEnabledSetting` (AD-13 runtime gating — flag-off builds never
 * appear in a client's signer chooser at all).
 */
class Nip55SignerActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handle(getIntent())
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent?) {
        if (intent == null) {
            finish()
            return
        }
        // Recents ghost guard (Amber parity): a relaunch from Recents replays the stale intent
        // flag — never re-serve an old request from history.
        if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) {
            finish()
            return
        }
        Nip55PendingStore.put(this, intent)
        // Bring the main app forward so the JS intake can raise the approval surface. This
        // activity stays alive (invisible) holding the result slot until JS answers.
        val forward = Intent(this, com.galoyapp.MainActivity::class.java)
            .addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP,
            )
        startActivity(forward)
    }

    override fun onDestroy() {
        Nip55PendingStore.activityDestroyed(this)
        super.onDestroy()
    }
}
