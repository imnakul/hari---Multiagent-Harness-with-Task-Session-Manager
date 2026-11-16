package expo.modules.harilive

import android.app.Notification
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Build
import android.os.Parcelable
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Base64
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

// Fork (Hari, L-325): the phone's notifications for the computer's Share
// panel. Android binds the listener once the user turns on Notification access
// for Hari; the app reads the list from here, and asks to clear one when the
// computer dismisses it. Nothing is stored: the list is what Android shows now.

class HariNotificationListener : NotificationListenerService() {
  override fun onListenerConnected() {
    HariNotifications.listener = this
    HariNotifications.changed()
  }

  override fun onListenerDisconnected() {
    if (HariNotifications.listener === this) HariNotifications.listener = null
  }

  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    if (sbn != null && HariNotifications.shown(sbn, packageName)) HariNotifications.changed()
  }

  override fun onNotificationRemoved(sbn: StatusBarNotification?) {
    if (sbn != null && HariNotifications.shown(sbn, packageName)) HariNotifications.changed()
  }
}

internal object HariNotifications {
  private const val TAG = "HariNotifications"
  private const val MAX_ITEMS = 150
  private const val MAX_TITLE = 300
  private const val MAX_TEXT = 2000
  private const val ICON_PX = 64
  private const val MAX_PACKAGES = 80

  @Volatile
  var listener: HariNotificationListener? = null

  private fun component(context: Context) = ComponentName(context, HariNotificationListener::class.java)

  /** Whether the user turned on Notification access for Hari. */
  fun allowed(context: Context): Boolean {
    if (Build.VERSION.SDK_INT >= 27) {
      val manager = context.getSystemService(NotificationManager::class.java) ?: return false
      return manager.isNotificationListenerAccessGranted(component(context))
    }
    val enabled = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: return false
    return enabled.split(':').any { ComponentName.unflattenFromString(it) == component(context) }
  }

  /** The system page for Hari's Notification access; the list of apps on older Android. */
  fun openSettings(context: Context): Boolean {
    val intents = buildList {
      if (Build.VERSION.SDK_INT >= 30) {
        add(
          Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
            .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, component(context).flattenToString()),
        )
      }
      add(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
    }
    for (intent in intents) {
      try {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return true
      } catch (_: Exception) {
        // The next page, or none.
      }
    }
    return false
  }

  /** A notification the user would see and could clear, from another app. */
  fun shown(sbn: StatusBarNotification, own: String): Boolean {
    val flags = sbn.notification.flags
    return sbn.packageName != own &&
      sbn.isClearable &&
      flags and Notification.FLAG_ONGOING_EVENT == 0 &&
      flags and Notification.FLAG_FOREGROUND_SERVICE == 0 &&
      flags and Notification.FLAG_GROUP_SUMMARY == 0
  }

  fun changed() {
    HariLive.dispatch(mapOf("action" to "notifications"))
  }

  /**
   * What the phone shows now, newest first, as JSON:
   * `{ listening, items: [{ key, package, app, title, text, postedAt }] }`.
   * Not listening (access off, or Android hasn't bound the listener yet): no items.
   */
  fun active(context: Context): String {
    val service = listener
    if (service == null) {
      if (allowed(context)) rebind(context)
      return JSONObject().put("listening", false).put("items", JSONArray()).toString()
    }
    val items = JSONArray()
    val labels = HashMap<String, String>()
    val list =
      try {
        service.activeNotifications ?: emptyArray()
      } catch (error: Exception) {
        Log.w(TAG, "Could not read the phone's notifications", error)
        emptyArray()
      }
    list
      .filter { shown(it, context.packageName) }
      .sortedByDescending { it.postTime }
      .take(MAX_ITEMS)
      .forEach { sbn ->
        val extras = sbn.notification.extras
        val title = (
          extras.getCharSequence(Notification.EXTRA_TITLE_BIG)
            ?: extras.getCharSequence(Notification.EXTRA_TITLE)
            ?: extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)
          )?.toString()?.trim().orEmpty()
        val text = body(sbn.notification).trim()
        if (title.isEmpty() && text.isEmpty()) return@forEach
        val app = labels.getOrPut(sbn.packageName) { label(context, sbn.packageName) ?: sbn.packageName }
        items.put(
          JSONObject()
            .put("key", sbn.key)
            .put("package", sbn.packageName)
            .put("app", app)
            .put("title", title.take(MAX_TITLE))
            .put("text", text.take(MAX_TEXT))
            .put("postedAt", sbn.postTime),
        )
      }
    return JSONObject().put("listening", true).put("items", items).toString()
  }

  /** The newest message of a chat, the long text, or the plain text. */
  private fun body(notification: Notification): String {
    val extras = notification.extras
    val messages = messageTexts(extras.getParcelableArray(Notification.EXTRA_MESSAGES))
    if (messages != null) return messages
    extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.let { return it.toString() }
    extras.getCharSequence(Notification.EXTRA_TEXT)?.let { return it.toString() }
    val lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
    return lines?.joinToString("\n").orEmpty()
  }

  private fun messageTexts(raw: Array<Parcelable>?): String? {
    if (raw.isNullOrEmpty()) return null
    val last = raw.last() as? android.os.Bundle ?: return null
    return last.getCharSequence("text")?.toString()
  }

  /** Clears one of the phone's notifications; false when Hari can't. */
  fun dismiss(key: String): Boolean {
    val service = listener ?: return false
    return try {
      service.cancelNotification(key)
      true
    } catch (error: Exception) {
      Log.w(TAG, "Could not clear a notification", error)
      false
    }
  }

  /** App icons as base64 PNGs by package, for installed apps. */
  fun icons(context: Context, packages: List<String>): Map<String, String> {
    val out = HashMap<String, String>()
    for (name in packages.distinct().take(MAX_PACKAGES)) {
      try {
        val drawable = context.packageManager.getApplicationIcon(name)
        val bitmap = Bitmap.createBitmap(ICON_PX, ICON_PX, Bitmap.Config.ARGB_8888)
        drawable.setBounds(0, 0, ICON_PX, ICON_PX)
        drawable.draw(Canvas(bitmap))
        val bytes = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes)
        bitmap.recycle()
        out[name] = Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)
      } catch (_: Exception) {
        // Not installed, or hidden from Hari: the computer shows a letter.
      }
    }
    return out
  }

  /** App names by package, for installed apps only. */
  fun labels(context: Context, packages: List<String>): Map<String, String> {
    val out = HashMap<String, String>()
    for (name in packages.distinct().take(MAX_PACKAGES)) label(context, name)?.let { out[name] = it }
    return out
  }

  private fun label(context: Context, name: String): String? =
    try {
      val manager = context.packageManager
      manager.getApplicationLabel(manager.getApplicationInfo(name, 0)).toString()
    } catch (_: Exception) {
      null
    }

  // After an app update Android may leave the listener unbound until asked.
  private fun rebind(context: Context) {
    try {
      NotificationListenerService.requestRebind(component(context))
    } catch (error: Exception) {
      Log.w(TAG, "Could not ask Android to start the notification listener", error)
    }
  }
}
