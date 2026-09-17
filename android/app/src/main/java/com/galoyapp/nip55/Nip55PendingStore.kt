package com.galoyapp.nip55

import android.app.Activity
import android.content.Intent
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.UiThreadUtil
import org.json.JSONObject
import java.util.UUID

/**
 * Process-wide holder for the ONE pending NIP-55 request.
 *
 * vezir (and every NIP-55 client observed in the wild) drives the protocol strictly
 * sequentially: `get_public_key`, then `sign_event` — so a single slot (last-wins, previous
 * holder finished with RESULT_CANCELED) is sufficient; a queued store would be speculative.
 *
 * All protocol parsing (permissions JSON, event JSON, npub/hex) happens on the JS side, which
 * already owns nostr tooling; the native side only extracts raw strings, delivers the final
 * result extras, and enforces a watchdog so a caller is never left hanging if JS never
 * answers (flag off, process death, crashed intake).
 *
 * Result-extra contract (mirrors Amber, verified against vezir's Nip55Signer.kt):
 *  - login ok:    `result`/`signature`/`event` = hex pubkey, `package` = our packageName
 *  - login reject: no setResult + finish()  ⇒ RESULT_CANCELED (Amber's get_public_key reject)
 *  - sign ok:     `event` = signed event JSON, `signature`/`result` = 128-hex sig
 *  - sign reject: RESULT_OK + `rejected` extra (vezir presence-checks it)
 */
internal object Nip55PendingStore {

    /** Backstop if JS never answers (the coordinator's own 120s auto-reject normally fires first). */
    private const val WATCHDOG_MS = 5 * 60_000L

    private var activity: Nip55SignerActivity? = null
    private var requestJson: String? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    /**
     * Current-activity provider (bound by Nip55Module from its ReactContext) — used to drop
     * Blink's task after an answer so the CALLER resumes immediately.
     */
    @Volatile
    var currentActivityProvider: (() -> Activity?)? = null

    @Synchronized
    fun put(activity: Nip55SignerActivity, intent: Intent) {
        val previous = this.activity
        if (previous != null && previous !== activity) {
            // A superseded holder finishes with RESULT_CANCELED — its caller is not left hanging.
            previous.finish()
        }
        this.activity = activity
        this.requestJson = serialize(activity, intent)
        mainHandler.removeCallbacksAndMessages(null)
        mainHandler.postDelayed({ activity.finish() }, WATCHDOG_MS)
    }

    /** One-shot: returns the pending request JSON (null when none/unconsumed) and clears it. */
    @Synchronized
    fun takeRequest(): String? {
        val json = requestJson
        requestJson = null
        return json
    }

    @Synchronized
    fun activityDestroyed(activity: Nip55SignerActivity) {
        if (this.activity === activity) {
            this.activity = null
            requestJson = null
        }
        mainHandler.removeCallbacksAndMessages(null)
    }

    /**
     * Deliver [resultJson] (built by the JS handler) to the caller and close the holder
     * activity. Safe to call from the RN module thread; hops to the UI thread for the
     * activity Result APIs.
     */
    @Synchronized
    fun complete(resultJson: String) {
        val target = activity ?: return
        UiThreadUtil.runOnUiThread {
            try {
                applyResult(target, JSONObject(resultJson))
            } catch (_: Exception) {
                // Malformed result ⇒ treat as a cancel (finish without a result).
            }
            target.finish()
            returnToCaller()
            clear(target)
        }
    }

    /**
     * After answering, move Blink's OWN task to the back so the caller's task (directly
     * below) resumes and processes the result immediately — otherwise the caller stays
     * paused, its follow-up request never fires, and the user must switch apps manually
     * (observed on-device: the vezir sign_event approval only appeared mid-switch).
     *
     * STRICTLY guarded to MainActivity: in other lifecycle states the "current activity"
     * can be the holder itself, which lives in the CALLER's task — moving THAT back would
     * background the caller mid-flow.
     */
    private fun returnToCaller() {
        val current = currentActivityProvider?.invoke()
        if (current is com.galoyapp.MainActivity && !current.isFinishing) {
            current.moveTaskToBack(true)
        }
    }

    private fun applyResult(target: Nip55SignerActivity, res: JSONObject) {
        val kind = res.optString("kind")
        val id = res.optString("id", "")
        when (kind) {
            "login_ok" -> {
                val pubkey = res.getString("pubkeyHex")
                val data = Intent()
                    .putExtra("result", pubkey)
                    .putExtra("signature", pubkey)
                    .putExtra("event", pubkey)
                    // Runtime package id (honors the debug applicationIdSuffix) — the client
                    // records this and pins the follow-up sign_event intent to it.
                    .putExtra("package", target.packageName)
                if (id.isNotEmpty()) data.putExtra("id", id)
                target.setResult(Activity.RESULT_OK, data)
            }
            "sign_ok" -> {
                val eventJson = res.getString("eventJson")
                val sig = res.getString("sig")
                val data = Intent()
                    .putExtra("event", eventJson)
                    .putExtra("signature", sig)
                    .putExtra("result", sig)
                if (id.isNotEmpty()) data.putExtra("id", id)
                target.setResult(Activity.RESULT_OK, data)
            }
            "sign_reject" -> {
                val data = Intent().putExtra("rejected", true)
                if (id.isNotEmpty()) data.putExtra("id", id)
                target.setResult(Activity.RESULT_OK, data)
            }
            else -> {
                // login_reject (+ unknown kinds): plain finish ⇒ RESULT_CANCELED, matching
                // Amber's get_public_key rejection exactly.
            }
        }
    }

    @Synchronized
    private fun clear(activity: Nip55SignerActivity) {
        if (this.activity === activity) {
            this.activity = null
            requestJson = null
        }
        mainHandler.removeCallbacksAndMessages(null)
    }

    /** Extract the raw request fields into the JSON the JS intake parses (no protocol logic). */
    private fun serialize(activity: Nip55SignerActivity, intent: Intent): String {
        val obj = JSONObject()
        val type = intent.extras?.getString("type") ?: ""
        obj.put("type", type)
        val id = intent.extras?.getString("id")
        obj.put("id", id ?: UUID.randomUUID().toString())
        intent.dataString?.let { obj.put("data", it) }
        intent.extras?.getString("current_user")?.let { obj.put("currentUser", it) }
        intent.extras?.getString("permissions")?.let { obj.put("permissions", it) }
        activity.callingPackage?.let { obj.put("callerPackage", it) }
        activity.referrer?.toString()?.let { obj.put("referrer", it) }
        return obj.toString()
    }
}
