package expo.modules.harilive

import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.util.Log

/**
 * Fork (Hari, L-406): Hari's app shortcuts. They show on a long press of
 * Hari's icon and in apps that run shortcuts (edge-swipe launchers like
 * Hinata list them under "Shortcuts").
 *
 * They are dynamic, not static: static ones need the app's package and
 * MainActivity written into the generated manifest. So they appear once Hari
 * has run once after an install or update.
 */
internal object HariShortcuts {
  private const val TAG = "HariShortcuts"

  fun publish(context: Context) {
    if (Build.VERSION.SDK_INT < 25) return
    val app = context.applicationContext
    val manager = app.getSystemService(ShortcutManager::class.java) ?: return
    val icon = Icon.createWithResource(app, app.applicationInfo.icon)
    // A Share bubble tap: the clipboard's text, link or picture goes to the
    // computer. Always sends, even what was sent last: a shortcut has no
    // "Send again", so it must not be refused as a repeat.
    val send = ShortcutInfo.Builder(app, "send-clipboard")
      .setShortLabel("Send to computer")
      .setLongLabel("Send the clipboard to your computer")
      .setIcon(icon)
      .setIntent(
        Intent(app, HariShareActivity::class.java)
          .setAction(HariShare.ACTION_CLIPBOARD)
          .putExtra(HariBubble.EXTRA_FROM_BUBBLE, true)
          .putExtra(HariBubble.EXTRA_FORCE, true),
      )
      .build()
    val share = ShortcutInfo.Builder(app, "open-share")
      .setShortLabel("Open Share")
      .setLongLabel("Open Share with your computer")
      .setIcon(icon)
      .setIntent(Intent(Intent.ACTION_VIEW, Uri.parse("monocode://share")).setPackage(app.packageName))
      .build()
    try {
      manager.dynamicShortcuts = listOf(send, share)
    } catch (error: Exception) {
      // Android limits how often a background app may change them; the next run tries again.
      Log.w(TAG, "Could not publish shortcuts", error)
    }
  }
}
