package expo.modules.harilive

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.StatFs
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress

/**
 * Fork (Hari, L-280): the phone's side of Computer: its own stats for the
 * desktop, Wake-on-LAN magic packets, and Find my phone (the alarm sound at
 * full alarm volume, looping, with a notification to stop it).
 */
object HariPc {
  private const val RING_CHANNEL = "hari-find-phone"
  private const val RING_NOTIFICATION = 7_280
  const val ACTION_STOP_RING = "expo.modules.harilive.STOP_RING"
  /** The phone stops ringing by itself after this long. */
  private const val RING_FOR_MS = 2 * 60_000L

  private val main = Handler(Looper.getMainLooper())
  private var player: MediaPlayer? = null
  /** The alarm volume before ringing raised it; put back on stop. */
  private var alarmVolume: Int? = null
  private val autoStop = Runnable { appContext?.let { stopRing(it) } }
  private var appContext: Context? = null

  fun stats(context: Context): Map<String, Any?> {
    val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
    val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
    val status = battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
    // Tenths of a degree Celsius; Integer.MIN_VALUE when the phone doesn't say.
    val temperature = battery?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE) ?: Int.MIN_VALUE
    val storage = StatFs(Environment.getDataDirectory().path)
    return mapOf(
      "battery" to if (level >= 0 && scale > 0) level.toDouble() / scale else null,
      "charging" to if (status < 0) null else
        status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL,
      "temperature" to if (temperature == Int.MIN_VALUE) null else temperature / 10.0,
      "storageFree" to storage.availableBytes.toDouble(),
      "storageTotal" to storage.totalBytes.toDouble(),
      "network" to network(context),
    )
  }

  private fun network(context: Context): String {
    val manager = context.getSystemService(ConnectivityManager::class.java) ?: return "other"
    val capabilities = try {
      manager.getNetworkCapabilities(manager.activeNetwork)
    } catch (_: SecurityException) {
      return "other"
    } ?: return "none"
    return when {
      capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
      capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
      capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
      else -> "other"
    }
  }

  /** "AA:BB:CC:DD:EE:FF" (or with dashes) to 6 bytes; null when it isn't a MAC. */
  fun macBytes(mac: String): ByteArray? {
    val parts = mac.trim().split(':', '-')
    if (parts.size != 6) return null
    val bytes = ByteArray(6)
    for ((index, part) in parts.withIndex()) {
      if (part.length != 2) return null
      bytes[index] = (part.toIntOrNull(16) ?: return null).toByte()
    }
    return bytes
  }

  /**
   * Sends the magic packet (6 × 0xFF, then the MAC 16 times) for each card to
   * its broadcast address and to 255.255.255.255, on UDP ports 9 and 7.
   * Returns how many packets went out. Blocking: call off the main thread.
   */
  fun wake(macs: List<String>, broadcasts: List<String>): Int {
    val targets = (broadcasts + "255.255.255.255").distinct().mapNotNull { address ->
      try {
        InetAddress.getByName(address)
      } catch (_: Exception) {
        null
      }
    }
    var sent = 0
    var lastError: Exception? = null
    DatagramSocket().use { socket ->
      socket.broadcast = true
      for (mac in macs) {
        val bytes = macBytes(mac) ?: continue
        val packet = ByteArray(6 + 16 * 6) { index -> if (index < 6) 0xFF.toByte() else bytes[(index - 6) % 6] }
        for (target in targets) {
          for (port in intArrayOf(9, 7)) {
            try {
              socket.send(DatagramPacket(packet, packet.size, target, port))
              sent += 1
            } catch (error: Exception) {
              lastError = error
            }
          }
        }
      }
    }
    if (sent == 0) throw IllegalStateException(lastError?.message ?: "No card to wake")
    return sent
  }

  fun startRing(context: Context) {
    val app = context.applicationContext
    appContext = app
    main.post {
      stopPlayer(app)
      val audio = app.getSystemService(AudioManager::class.java)
      if (audio != null) {
        alarmVolume = audio.getStreamVolume(AudioManager.STREAM_ALARM)
        try {
          audio.setStreamVolume(AudioManager.STREAM_ALARM, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)
        } catch (_: SecurityException) {
          // Do Not Disturb can refuse volume changes; ring at the current volume.
        }
      }
      val uri =
        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
          ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
      try {
        player = MediaPlayer().apply {
          setAudioAttributes(
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_ALARM)
              .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
              .build(),
          )
          setDataSource(app, uri)
          isLooping = true
          prepare()
          start()
        }
      } catch (_: Exception) {
        player?.release()
        player = null
      }
      showRingNotification(app)
      main.removeCallbacks(autoStop)
      main.postDelayed(autoStop, RING_FOR_MS)
    }
  }

  fun stopRing(context: Context) {
    val app = context.applicationContext
    main.post {
      main.removeCallbacks(autoStop)
      stopPlayer(app)
      app.getSystemService(NotificationManager::class.java)?.cancel(RING_NOTIFICATION)
    }
  }

  private fun stopPlayer(context: Context) {
    player?.let {
      try {
        it.stop()
      } catch (_: IllegalStateException) {
      }
      it.release()
    }
    player = null
    val previous = alarmVolume ?: return
    alarmVolume = null
    try {
      context.getSystemService(AudioManager::class.java)?.setStreamVolume(AudioManager.STREAM_ALARM, previous, 0)
    } catch (_: SecurityException) {
    }
  }

  private fun showRingNotification(context: Context) {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(RING_CHANNEL) == null) {
      val channel = NotificationChannel(RING_CHANNEL, "Find my phone", NotificationManager.IMPORTANCE_HIGH)
      channel.description = "When your computer rings this phone"
      channel.setSound(null, null)
      manager.createNotificationChannel(channel)
    }
    val stop = PendingIntent.getBroadcast(
      context,
      RING_NOTIFICATION,
      Intent(context, HariRingReceiver::class.java).setAction(ACTION_STOP_RING),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val builder =
      if (Build.VERSION.SDK_INT >= 26) android.app.Notification.Builder(context, RING_CHANNEL)
      else @Suppress("DEPRECATION") android.app.Notification.Builder(context)
    val notification = builder
      .setSmallIcon(R.drawable.hari_live_icon)
      .setContentTitle("Your computer is ringing this phone")
      .setContentText("Tap to stop")
      .setCategory(android.app.Notification.CATEGORY_ALARM)
      .setOngoing(true)
      .setAutoCancel(true)
      .setContentIntent(stop)
      .setDeleteIntent(stop)
      .addAction(android.app.Notification.Action.Builder(null, "Stop", stop).build())
      .build()
    try {
      manager.notify(RING_NOTIFICATION, notification)
    } catch (_: SecurityException) {
      // Notifications are off for Hari: the sound still plays and stops after 2 minutes.
    }
  }
}

/** Fork (Hari, L-280): the Find my phone notification's Stop (or a tap, or a swipe). */
class HariRingReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == HariPc.ACTION_STOP_RING) HariPc.stopRing(context)
  }
}
