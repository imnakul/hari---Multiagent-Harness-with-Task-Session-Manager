package expo.modules.harilive

import android.app.Notification
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log

/**
 * Fork (Hari, L-239): keeps the app running while a session runs, so it can
 * ask the computer how the sessions are doing every 15 seconds with the phone
 * locked, and at once when the screen comes on. Its notification is the first
 * Live Update card. It stops when no card is left.
 */
class HariLiveService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private var listening = false

  private val tick = object : Runnable {
    override fun run() {
      HariLive.renew(this@HariLiveService)
      HariLive.dispatch(mapOf("action" to "tick"))
      handler.postDelayed(this, TICK_MS)
    }
  }

  private val screen = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      HariLive.dispatch(mapOf("action" to "tick"))
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_SCREEN_ON)
      addAction(Intent.ACTION_USER_PRESENT)
    }
    if (Build.VERSION.SDK_INT >= 33) registerReceiver(screen, filter, Context.RECEIVER_NOT_EXPORTED)
    else registerReceiver(screen, filter)
    listening = true
    handler.postDelayed(tick, TICK_MS)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    HariLive.serviceStarted(this)
    try {
      val first = HariLive.cards.firstOrNull()
      if (first == null) {
        // The last session ended while this was starting; Android still needs
        // it to show a notification before it may stop.
        foreground(HariLive.id("all"), placeholder())
        finish()
      } else {
        HariLive.render(this)
      }
    } catch (error: Exception) {
      // A rejected card must not close the app. Android still expects this
      // service in the foreground, so show the plain placeholder, then stop.
      Log.e(TAG, "Live Update service could not show its card", error)
      try {
        foreground(HariLive.id("all"), placeholder())
      } catch (placeholderError: Exception) {
        Log.e(TAG, "Live Update placeholder failed too", placeholderError)
      }
      HariLive.fail(applicationContext, error)
      finish()
    }
    return START_NOT_STICKY
  }

  fun foreground(id: Int, notification: Notification) {
    if (Build.VERSION.SDK_INT >= 34)
      startForeground(id, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    else startForeground(id, notification)
  }

  fun finish() {
    HariLive.serviceStopped(this)
    if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE)
    else @Suppress("DEPRECATION") stopForeground(true)
    stopSelf()
  }

  private fun placeholder(): Notification {
    val builder =
      if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, HariLive.CHANNEL)
      else @Suppress("DEPRECATION") Notification.Builder(this)
    return builder
      .setSmallIcon(R.drawable.hari_live_icon)
      .setContentTitle("Hari")
      .setContentText("Sessions finished")
      .build()
  }

  override fun onDestroy() {
    handler.removeCallbacks(tick)
    if (listening) unregisterReceiver(screen)
    listening = false
    HariLive.serviceStopped(this)
    super.onDestroy()
  }

  private companion object {
    const val TAG = "HariLiveService"
    const val TICK_MS = 15_000L
  }
}
