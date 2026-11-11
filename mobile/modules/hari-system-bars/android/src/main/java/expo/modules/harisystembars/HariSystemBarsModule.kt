package expo.modules.harisystembars

import android.os.Build
import android.view.View
import android.view.WindowInsetsController
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Fork (Hari, L-245): the navigation bar draws no scrim of its own (see
// plugins/with-system-bars.js), so the app shows under it; its buttons follow
// the app's scheme, which can differ from the phone's.
class HariSystemBarsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HariSystemBars")

    /** Dark buttons (for a light app) or light ones (for a dark app). */
    Function("setNavigationButtonsDark") { dark: Boolean ->
      val activity = appContext.currentActivity ?: return@Function
      activity.runOnUiThread {
        val window = activity.window
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          val mask = WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
          window.insetsController?.setSystemBarsAppearance(if (dark) mask else 0, mask)
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          @Suppress("DEPRECATION")
          val flags = window.decorView.systemUiVisibility
          @Suppress("DEPRECATION")
          window.decorView.systemUiVisibility =
            if (dark) flags or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
            else flags and View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR.inv()
        }
      }
    }
  }
}
