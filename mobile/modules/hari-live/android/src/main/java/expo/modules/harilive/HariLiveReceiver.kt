package expo.modules.harilive

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Fork (Hari, L-239): a Live Update's Stop, Approve or Deny, or the user
 * swiping the card away, passed to the app, which asks the computer.
 */
class HariLiveReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != HariLive.ACTION) return
    val kind = intent.getStringExtra(HariLive.EXTRA_KIND) ?: return
    val event = mutableMapOf<String, Any?>("action" to kind)
    intent.getStringExtra(HariLive.EXTRA_SESSION)?.let { event["sessionId"] = it }
    intent.getStringArrayExtra(HariLive.EXTRA_SESSIONS)?.let { event["sessionIds"] = it.toList() }
    if (intent.hasExtra(HariLive.EXTRA_REQUEST))
      event["requestId"] = intent.getIntExtra(HariLive.EXTRA_REQUEST, 0)
    HariLive.dispatch(event)
  }
}
