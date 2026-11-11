package expo.modules.harilive

import android.app.ForegroundServiceStartNotAllowedException
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
    // Started plainly (see HariLive.start), so Android expects nothing of it:
    // with no card left, or none it may show, it just stops.
    if (HariLive.cards.isEmpty()) {
      finish()
      return START_NOT_STICKY
    }
    try {
      HariLive.render(this)
    } catch (error: Exception) {
      if (Build.VERSION.SDK_INT >= 31 && error is ForegroundServiceStartNotAllowedException) {
        // Hari left the screen before this ran. The cards stay and refresh
        // while the app is open; the next open starts this again.
        Log.w(TAG, "Live Update service may not run now", error)
        finish()
      } else {
        // A rejected card must not close the app: Live Updates turn off
        // and the app says why.
        Log.e(TAG, "Live Update service could not show its card", error)
        HariLive.fail(applicationContext, error)
        finish()
      }
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
