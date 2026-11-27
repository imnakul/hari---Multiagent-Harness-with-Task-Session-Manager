package expo.modules.harilive

import android.content.Context
import android.content.pm.ShortcutManager
import android.os.Build
import android.util.Log

/**
 * Fork (Hari, L-406): Hari's app shortcuts (Send to computer, Open Share) are
 * declared in the manifest by mobile/plugins/with-hari-shortcuts.js, because
 * shortcut apps read only manifest shortcuts. 0.16.0-local73 published them at
 * run time instead; this removes those so the same shortcuts don't show twice.
 */
internal object HariShortcuts {
  private const val TAG = "HariShortcuts"

  fun clearPublished(context: Context) {
    if (Build.VERSION.SDK_INT < 25) return
    val manager = context.applicationContext.getSystemService(ShortcutManager::class.java) ?: return
    try {
      if (manager.dynamicShortcuts.isNotEmpty()) manager.removeAllDynamicShortcuts()
    } catch (error: Exception) {
      Log.w(TAG, "Could not remove old shortcuts", error)
    }
  }
}
