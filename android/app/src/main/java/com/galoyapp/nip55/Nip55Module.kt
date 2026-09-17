package com.galoyapp.nip55

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * RN bridge for the NIP-55 signer surface (see [Nip55SignerActivity]).
 *
 * Three methods:
 *  - `consumePending()` — one-shot read of the pending request JSON (null when none);
 *  - `complete(resultJson)` — deliver the JS-built result to the calling app;
 *  - `setEnabled(enabled)` — mirror `nostrSignerEnabled` onto the manifest component so the
 *    system chooser only lists Blink while the signer is actually live (AD-13). The component
 *    ships `enabled="false"`; this flips it without a reinstall and survives reboots.
 */
class Nip55Module(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  init {
    // The store needs the RN-tracked current activity to auto-return to the caller after
    // an answer (see Nip55PendingStore.returnToCaller).
    Nip55PendingStore.currentActivityProvider = { reactContext.currentActivity }
  }

  override fun getName() = "Nip55Signer"

    @ReactMethod
    fun consumePending(promise: Promise) {
        promise.resolve(Nip55PendingStore.takeRequest())
    }

    @ReactMethod
    fun complete(resultJson: String) {
        Nip55PendingStore.complete(resultJson)
    }

    @ReactMethod
    fun setEnabled(enabled: Boolean) {
        val state = if (enabled) {
            android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED
        } else {
            android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        }
        reactContext.packageManager.setComponentEnabledSetting(
            android.content.ComponentName(reactContext, Nip55SignerActivity::class.java),
            state,
            android.content.pm.PackageManager.DONT_KILL_APP,
        )
    }
}
