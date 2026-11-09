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

    OnStartObserving { HariLive.listen { event -> sendEvent("onAction", event) } }
    OnStopObserving { HariLive.listen(null) }
    OnDestroy { HariLive.listen(null) }

    /** Shows these cards (JSON) in place of the last ones; none stops the Live Update. */
    Function("update") { cards: String ->
      HariLive.update(context, HariLive.parse(cards))
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
