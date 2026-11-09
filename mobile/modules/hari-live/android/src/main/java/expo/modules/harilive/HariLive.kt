package expo.modules.harilive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

// Fork (Hari, L-239): running sessions as an Android 16 Live Update (a promoted
// ongoing notification): the status bar chip, HyperOS's Super Island, the top
// of the shade and the lock screen. The app decides what each card says; this
// draws the cards, keeps the service that lets the app refresh them while the
// phone is locked, and passes the cards' buttons back to the app.

internal data class LiveAction(
  val kind: String,
  val label: String,
  val sessionId: String,
  val requestId: Int?,
  val url: String?,
)

internal data class LiveCard(
  val key: String,
  val title: String,
  val text: String,
  val publicTitle: String,
  val publicText: String,
  val chip: String?,
  val startedAt: Long?,
  val url: String,
  val sessionIds: List<String>,
  val actions: List<LiveAction>,
)

internal object HariLive {
  private const val TAG = "HariLive"
  const val CHANNEL = "hari-live"
  const val EXTRA_KIND = "expo.modules.harilive.KIND"
  const val EXTRA_SESSION = "expo.modules.harilive.SESSION"
  const val EXTRA_SESSIONS = "expo.modules.harilive.SESSIONS"
  const val EXTRA_REQUEST = "expo.modules.harilive.REQUEST"
  const val ACTION = "expo.modules.harilive.ACTION"
  // On Android 16 QPR2 this is Notification.EXTRA_REQUEST_PROMOTED_ONGOING;
  // Android 16 itself reads the same key, before the builder had a setter.
  private const val REQUEST_PROMOTED = "android.requestPromotedOngoing"

  private val main = Handler(Looper.getMainLooper())

  // Only touched on the main thread.
  var cards: List<LiveCard> = emptyList()
    private set
  private var posted: Set<Int> = emptySet()
  var service: HariLiveService? = null
  private var starting = false

  // Set while the app listens; button presses wait here until it does.
  var emit: ((Map<String, Any?>) -> Unit)? = null
  private val pending = mutableListOf<Map<String, Any?>>()

  fun update(context: Context, next: List<LiveCard>) {
    main.post {
      cards = next
      render(context.applicationContext)
    }
  }

  fun dispatch(event: Map<String, Any?>) {
    main.post {
      val send = emit
      if (send != null) send(event)
      // A tick is only worth anything to an app that's listening.
      else if (event["action"] != "tick") pending.add(event)
    }
  }

  fun listen(send: ((Map<String, Any?>) -> Unit)?) {
    main.post {
      emit = send
      if (send != null) {
        val waiting = pending.toList()
        pending.clear()
        waiting.forEach(send)
      }
    }
  }

  fun id(key: String): Int =
    if (key == "all") 7300 else 7301 + Math.floorMod(key.hashCode(), 100_000)

  /** Posts the cards, with the first as the service's own, and drops the rest. */
  fun render(context: Context) {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    ensureChannel(context, manager)
    val shown = cards.map { id(it.key) to build(context, it) }
    val running = service
    if (shown.isEmpty()) {
      running?.finish()
      posted.forEach { manager.cancel(it) }
      posted = emptySet()
      return
    }
    if (running != null) running.foreground(shown[0].first, shown[0].second)
    shown.forEach { (id, notification) ->
      if (running == null || id != shown[0].first) manager.notify(id, notification)
    }
    val ids = shown.map { it.first }.toSet()
    (posted - ids).forEach { manager.cancel(it) }
    posted = ids
    if (running == null && !starting) start(context)
  }

  fun serviceStarted(started: HariLiveService) {
    service = started
    starting = false
  }

  fun serviceStopped(stopped: HariLiveService) {
    if (service === stopped) service = null
    starting = false
  }

  private fun start(context: Context) {
    starting = true
    try {
      val intent = Intent(context, HariLiveService::class.java)
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent)
      else context.startService(intent)
    } catch (error: Exception) {
      // Android won't start one from the background (Android 12 and later).
      // The cards still show; they refresh once the app is open again.
      starting = false
      Log.w(TAG, "Could not start the Live Update service", error)
    }
  }

  private fun ensureChannel(context: Context, manager: NotificationManager) {
    if (Build.VERSION.SDK_INT < 26 || manager.getNotificationChannel(CHANNEL) != null) return
    val channel = NotificationChannel(CHANNEL, "Live Updates", NotificationManager.IMPORTANCE_DEFAULT)
    channel.description = "Running sessions, in the status bar and on the lock screen"
    channel.setSound(null, null)
    channel.enableVibration(false)
    channel.setShowBadge(false)
    manager.createNotificationChannel(channel)
  }

  fun build(context: Context, card: LiveCard): Notification {
    val notification = builder(context, card, card.title, card.text)
    notification.setPublicVersion(
      builder(context, card, card.publicTitle, card.publicText).build(),
    )
    notification.setVisibility(Notification.VISIBILITY_PRIVATE)
    notification.setContentIntent(openIntent(context, card.url, "content:${card.key}"))
    notification.setDeleteIntent(
      broadcast(context, "dismiss:${card.key}", Intent().apply {
        putExtra(EXTRA_KIND, "dismiss")
        putExtra(EXTRA_SESSIONS, card.sessionIds.toTypedArray())
      }),
    )
    for (action in card.actions) notification.addAction(action(context, action))
    return notification.build()
  }

  private fun builder(context: Context, card: LiveCard, title: String, text: String): Notification.Builder {
    val builder =
      if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, CHANNEL)
      else @Suppress("DEPRECATION") Notification.Builder(context)
    builder
      .setSmallIcon(R.drawable.hari_live_icon)
      .setContentTitle(title)
      .setContentText(text)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_PROGRESS)
    if (card.startedAt != null) {
      builder.setWhen(card.startedAt).setShowWhen(true).setUsesChronometer(true)
    } else {
      builder.setShowWhen(false)
    }
    if (Build.VERSION.SDK_INT >= 36) {
      builder.setStyle(Notification.ProgressStyle().setProgressIndeterminate(true))
      builder.addExtras(Bundle().apply { putBoolean(REQUEST_PROMOTED, true) })
      card.chip?.let { builder.setShortCriticalText(it) }
    } else {
      builder.setStyle(Notification.BigTextStyle().bigText(text))
      builder.setProgress(0, 0, true)
    }
    return builder
  }

  private fun action(context: Context, action: LiveAction): Notification.Action {
    val intent =
      if (action.kind == "open") openIntent(context, action.url ?: "", "open:${action.sessionId}")
      else broadcast(context, "${action.kind}:${action.sessionId}:${action.requestId}", Intent().apply {
        putExtra(EXTRA_KIND, action.kind)
        putExtra(EXTRA_SESSION, action.sessionId)
        action.requestId?.let { putExtra(EXTRA_REQUEST, it) }
      })
    val icon = Icon.createWithResource(context, R.drawable.hari_live_icon)
    val builder = Notification.Action.Builder(icon, action.label, intent)
    // Stop, Approve and Deny change work on the computer: unlock first.
    if (Build.VERSION.SDK_INT >= 31 && action.kind != "open") builder.setAuthenticationRequired(true)
    return builder.build()
  }

  private fun openIntent(context: Context, url: String, key: String): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context,
      key.hashCode(),
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  private fun broadcast(context: Context, key: String, extras: Intent): PendingIntent {
    val intent = Intent(context, HariLiveReceiver::class.java).setAction(ACTION).putExtras(extras)
    return PendingIntent.getBroadcast(
      context,
      key.hashCode(),
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  fun parse(json: String): List<LiveCard> {
    val list = JSONArray(json)
    return (0 until list.length()).map { index ->
      val card = list.getJSONObject(index)
      LiveCard(
        key = card.getString("key"),
        title = card.getString("title"),
        text = card.getString("text"),
        publicTitle = card.optString("publicTitle", "Hari"),
        publicText = card.optString("publicText", ""),
        chip = card.optStringOrNull("chip"),
        startedAt = if (card.isNull("startedAt") || !card.has("startedAt")) null else card.getLong("startedAt"),
        url = card.getString("url"),
        sessionIds = card.optJSONArray("sessionIds").strings(),
        actions = card.optJSONArray("actions").objects().map { action ->
          LiveAction(
            kind = action.getString("kind"),
            label = action.getString("label"),
            sessionId = action.optString("sessionId", ""),
            requestId = if (action.has("requestId") && !action.isNull("requestId")) action.getInt("requestId") else null,
            url = action.optStringOrNull("url"),
          )
        },
      )
    }
  }

  private fun JSONObject.optStringOrNull(name: String): String? =
    if (has(name) && !isNull(name)) getString(name) else null

  private fun JSONArray?.strings(): List<String> =
    if (this == null) emptyList() else (0 until length()).map { getString(it) }

  private fun JSONArray?.objects(): List<JSONObject> =
    if (this == null) emptyList() else (0 until length()).map { getJSONObject(it) }
}
