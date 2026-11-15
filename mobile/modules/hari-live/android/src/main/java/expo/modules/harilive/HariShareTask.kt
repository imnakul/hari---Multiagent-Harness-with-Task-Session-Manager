package expo.modules.harilive

import android.content.Context
import android.content.Intent
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

// Fork (Hari, L-303): runs the app's code with no window (Headless JS) to send
// what the share sheet left, so Hari never comes to the front. The JS task
// ("HariShareSend", registered in index.ts) sends and ends; this service then
// stops by itself.

class HariShareTask : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    // Up to 10 minutes: a big file takes a while. Allowed while Hari is in view, too.
    HeadlessJsTaskConfig(TASK, Arguments.createMap(), 10 * 60_000L, true)

  companion object {
    private const val TASK = "HariShareSend"

    /** Starts the task; false when Android refuses (the caller opens Hari instead). */
    fun start(context: Context): Boolean =
      try {
        HeadlessJsTaskService.acquireWakeLockNow(context)
        context.startService(Intent(context, HariShareTask::class.java))
        true
      } catch (error: Exception) {
        Log.w("HariShare", "Could not start the background send", error)
        false
      }
  }
}
