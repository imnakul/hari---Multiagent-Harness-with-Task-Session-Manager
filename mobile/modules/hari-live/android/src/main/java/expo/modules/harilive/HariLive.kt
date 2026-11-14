package expo.modules.harilive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
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
  /** The app's accent, as an ARGB colour; null for the system's. */
  val color: Int? = null,
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
  // A card closes itself this long after it was last posted. The service
  // posts the cards again on every tick, so they stay while it runs; if the
  // app dies, they go within this time instead of staying for good.
  private const val CARD_TIMEOUT_MS = 2 * 60_000L
  // Fork (Hari, L-275): the quiet notification the service shows while it
  // only watches for the computer's notifications (no session card).
  const val WATCH_CHANNEL = "hari-watch"
  private const val STREAM_TICK_MS = 120_000L
  private const val WATCH_ID = 7299
  private const val WATCH_URL = "monocode://notifications"

  private val main = Handler(Looper.getMainLooper())

  // Only touched on the main thread.
  var cards: List<LiveCard> = emptyList()
    private set
  /** Keep the service running with no card, so the app can check the computer. */
  var watching = false
    private set
  /**
   * Fork (L-277): the app holds the event stream to the computer open, which
   * brings news at once; the tick is then only a fallback and runs rarely.
   */
  var streamLive = false
    private set

  /** How long until the service's next tick. */
  fun tickMs(): Long =
    if (streamLive && cards.isEmpty()) STREAM_TICK_MS else HariLiveService.TICK_MS

  fun setStreamLive(on: Boolean) {
    main.post {
      if (streamLive == on) return@post
      streamLive = on
      service?.reschedule()
    }
  }
  private var posted: Set<Int> = emptySet()
  var service: HariLiveService? = null
  private var starting = false
  // Set once a card fails; this run shows no more cards.
  private var failed = false

  // Set while the app listens; button presses wait here until it does.
  var emit: ((Map<String, Any?>) -> Unit)? = null
  private val pending = mutableListOf<Map<String, Any?>>()

  fun update(context: Context, next: List<LiveCard>) {
    val app = context.applicationContext
    main.post {
      // Runs outside React Native: anything thrown here would close the app,
      // and it would close again on every launch while a session runs. A card
      // Android or the phone maker rejects turns Live Updates off instead.
      try {
        if (failed && next.isNotEmpty()) return@post
        cards = next
        render(app)
      } catch (error: Exception) {
        fail(app, error)
      }
    }
  }

  /** Fork (L-275): keeps the service running with no card (on), or lets it stop (off). */
  fun setWatching(context: Context, on: Boolean) {
    val app = context.applicationContext
    main.post {
      // Run even when unchanged: the app calls this as it opens, which
      // starts the service again if Android stopped it.
      watching = on
      try {
        render(app)
      } catch (error: Exception) {
        Log.w(TAG, "Could not change background watching", error)
        if (cards.isEmpty()) service?.finish()
      }
    }
  }

  /** Posts the same cards again, which renews their timeout (each service tick). */
  fun renew(context: Context) {
    val app = context.applicationContext
    main.post {
      if (cards.isEmpty()) return@post
      try {
        render(app)
      } catch (error: Exception) {
        fail(app, error)
      }
    }
  }

  /** Closes every card after an error and tells the app, which stops sending them. */
  fun fail(context: Context, error: Exception) {
    Log.e(TAG, "Live Update failed; turning it off for this run", error)
    failed = true
    cards = emptyList()
    clearAll(context)
    try {
      // Fork (L-275): watching goes on without the cards.
      if (watching) render(context) else service?.finish()
    } catch (stop: Exception) {
      Log.w(TAG, "Could not stop the Live Update service", stop)
      try {
        service?.finish()
      } catch (_: Exception) {}
    }
    dispatch(mapOf("action" to "failed", "message" to (error.message ?: error.javaClass.simpleName)))
  }

  /**
   * Cards outlive the app when Android kills it, and a new launch knows
   * nothing of them, so they would stay on screen with no end. A new run
   * clears any it finds before showing its own.
   */
  fun clearStale(context: Context) {
    main.post {
      if (service != null || starting || posted.isNotEmpty()) return@post
      clearAll(context.applicationContext)
    }
  }

  private fun clearAll(context: Context) {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    try {
      posted.forEach { manager.cancel(it) }
      if (Build.VERSION.SDK_INT >= 26)
        manager.activeNotifications
          .filter { it.notification.channelId == CHANNEL }
          .forEach { manager.cancel(it.tag, it.id) }
    } catch (error: Exception) {
      Log.w(TAG, "Could not clear Live Update cards", error)
    }
    posted = emptySet()
  }

  fun dispatch(event: Map<String, Any?>) {
    main.post {
      val send = emit
      if (send != null) deliver(send, event)
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
        waiting.forEach { deliver(send, it) }
      }
    }
  }

  // The app's side may be gone (a reload); a lost event must not close the app.
  private fun deliver(send: (Map<String, Any?>) -> Unit, event: Map<String, Any?>) {
    try {
      send(event)
    } catch (error: Exception) {
      Log.w(TAG, "Could not pass a Live Update event to the app", error)
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
      if (!watching) {
        running?.finish()
        manager.cancel(WATCH_ID)
      } else if (running != null) {
        // Fork (L-275): no session runs, but the app still checks the
        // computer. Swapped first: Android won't cancel the service's own
        // notification, so the last card goes once it no longer is.
        running.foreground(WATCH_ID, watchNotification(context, manager))
      } else if (!starting) {
        start(context)
      }
      // Every card on the channel, including any a killed run left behind.
      clearAll(context)
      return
    }
    if (running != null) running.foreground(shown[0].first, shown[0].second)
    // A card is the service's notification now; the quiet one goes.
    manager.cancel(WATCH_ID)
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
      // Fork (Hari, L-247): a plain start, not startForegroundService. That
      // one promises Android the service goes to the foreground within
      // seconds, and if it doesn't (startForeground refused, or the service
      // not run in time), Android closes the whole app with
      // ForegroundServiceDidNotStartInTimeException: a throw no try/catch here
      // can stop, so the app closed on every launch while a session ran. The
      // app is open whenever this is called, so a plain start is allowed, and
      // the service goes to the foreground itself, or stops if it can't.
      context.startService(Intent(context, HariLiveService::class.java))
    } catch (error: Exception) {
      // Android won't start one from the background (Android 8 and later).
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

  /**
   * Fork (L-275): the service's notification while it only watches. Lowest
   * importance (folded at the bottom of the shade, no icon, sound or badge);
   * tapping it opens the Notifications screen.
   */
  private fun watchNotification(context: Context, manager: NotificationManager): Notification {
    if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(WATCH_CHANNEL) == null) {
      val channel = NotificationChannel(WATCH_CHANNEL, "Background watching", NotificationManager.IMPORTANCE_MIN)
      channel.description = "Shown while Hari checks your computer for new notifications"
      channel.setSound(null, null)
      channel.enableVibration(false)
      channel.setShowBadge(false)
      manager.createNotificationChannel(channel)
    }
    val builder =
      if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, WATCH_CHANNEL)
      else @Suppress("DEPRECATION") Notification.Builder(context).setPriority(Notification.PRIORITY_MIN)
    return builder
      .setSmallIcon(R.drawable.hari_live_icon)
      .setContentTitle("Watching your computer")
      .setContentText("New notifications from your computer show here")
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setCategory(Notification.CATEGORY_SERVICE)
      .setContentIntent(openIntent(context, WATCH_URL, "watch"))
      .build()
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
    card.color?.let { builder.setColor(it) }
    if (Build.VERSION.SDK_INT >= 26) builder.setTimeoutAfter(CARD_TIMEOUT_MS)
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
        color = card.optStringOrNull("color")?.let { runCatching { Color.parseColor(it) }.getOrNull() },
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
