package expo.modules.harilive

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Fork (Hari, L-239): the app's side of the Live Update.
class HariLiveModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("HariLive")
    Events("onAction")

    // A new run: drop cards a killed run left behind (they would never end).
    OnCreate { appContext.reactContext?.let { HariLive.clearStale(it) } }

    OnStartObserving { HariLive.listen { event -> sendEvent("onAction", event) } }
    OnStopObserving { HariLive.listen(null) }
    OnDestroy { HariLive.listen(null) }

    /** Shows these cards (JSON) in place of the last ones; none stops the Live Update. */
    Function("update") { cards: String ->
      HariLive.update(context, HariLive.parse(cards))
    }

    /**
     * Fork (L-275): keeps the service running with no card, so the app can
     * check the computer for notifications while it's out of view.
     */
    Function("setWatching") { on: Boolean ->
      HariLive.setWatching(context, on)
    }

    /** Fork (L-277): the event stream is open, so the service ticks rarely. */
    Function("setStreamLive") { on: Boolean ->
      HariLive.setStreamLive(on)
    }

    /** Fork (L-279): what the share sheet and the tile left for the app (JSON); emptied. */
    Function("takeShared") { HariShare.take(context) }

    /** Fork (L-279): moves a file from Hari's cache into Download/Hari; its content URI. */
    AsyncFunction("saveToDownloads") { source: String, name: String, mimeType: String ->
      HariShare.saveToDownloads(context, source, name, mimeType)
    }

    /** Fork (L-290): deletes files Hari saved to Download/Hari; how many went. */
    Function("deleteSaved") { uris: List<String> -> HariFiles.deleteSaved(context, uris) }

    /** Fork (L-290): keeps the screen on while a big file moves. */
    Function("keepAwake") { on: Boolean -> HariFiles.keepAwake(appContext.currentActivity, on) }

    /** Fork (L-297): the phone's storage for the computer's Phone files browser. */
    Function("hasAllFiles") { HariFiles.hasAllFiles() }
    Function("openAllFilesSettings") { HariFiles.openAllFilesSettings(context) }
    Function("listFiles") { path: String, offset: Int -> HariFiles.list(path, offset) }
    Function("describeFile") { path: String -> HariFiles.describe(path) }

    /** Fork (L-279): opens a saved file in the app the user picks. */
    Function("openFile") { uri: String, mimeType: String -> HariShare.open(context, uri, mimeType) }

    /** Fork (L-280): battery, charging, temperature, storage and network type, for the computer. */
    Function("phoneStats") { HariPc.stats(context) }

    /** Fork (L-280): Wake-on-LAN magic packets to these cards; how many packets went out. */
    AsyncFunction("wake") { macs: List<String>, broadcasts: List<String> -> HariPc.wake(macs, broadcasts) }

    /** Fork (L-280): Find my phone. Rings at full alarm volume until stopped (2 minutes at most). */
    Function("ring") { start: Boolean ->
      if (start) HariPc.startRing(context) else HariPc.stopRing(context)
    }

    /** Whether this Android draws Live Updates at all (Android 16 and later). */
    Function("supported") { Build.VERSION.SDK_INT >= 36 }

    /** Whether Live Updates are on for the app in system settings. */
    Function("canPostPromoted") {
      if (Build.VERSION.SDK_INT < 36) return@Function false
      context.getSystemService(NotificationManager::class.java)?.canPostPromotedNotifications() ?: false
    }

    /** The system page that turns Live Updates on or off for the app. */
    Function("openPromotedSettings") {
      val intent =
        if (Build.VERSION.SDK_INT >= 36)
          Intent(Settings.ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        else
          Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
      open(intent)
    }

    /** The app's own page, where battery use and (on HyperOS) Autostart are set. */
    Function("openBatterySettings") {
      open(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
          .setData(Uri.fromParts("package", context.packageName, null)),
      )
    }
  }

  private fun open(intent: Intent): Boolean =
    try {
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    } catch (_: Exception) {
      try {
        context.startActivity(
          Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.fromParts("package", context.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        true
      } catch (_: Exception) {
        false
      }
    }
}
