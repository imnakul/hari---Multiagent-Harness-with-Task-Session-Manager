package expo.modules.harilive

import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.Toast

// Fork (Hari, L-321, L-408): one tap sends the phone's clipboard (text, a link
// or a picture) to the paired computer through the background send the share
// sheet uses (L-303). The Quick Settings tile and the Send to computer
// shortcut use it. L-411: success says "Sent to Hari (desktop)" (Android's
// own "Hari pasted from your clipboard" may show too; Hari can't hide it).

/** What a tap found on the clipboard. */
internal sealed class ClipContent {
  data class Text(val text: String) : ClipContent()

  data class Item(val uri: Uri) : ClipContent()
}

internal object HariClip {
  private const val TAG = "HariClip"

  /**
   * Reads the clipboard. Android lets only the app with focus read it, so
   * this runs in HariShareActivity's invisible window. Null when it's empty
   * or Android said no.
   */
  fun read(context: Context): ClipContent? {
    val clip = try {
      context.getSystemService(ClipboardManager::class.java)?.primaryClip
    } catch (error: Exception) {
      Log.w(TAG, "Could not read the clipboard", error)
      null
    }
    val item = clip?.takeIf { it.itemCount > 0 }?.getItemAt(0) ?: return null
    item.uri?.takeIf { it.scheme == "content" }?.let { return ClipContent.Item(it) }
    val text = try {
      item.coerceToText(context)?.toString()
    } catch (_: Exception) {
      null
    }
    return text?.takeIf { it.isNotBlank() }?.let { ClipContent.Text(it) }
  }

  /** Sends what was read, every time (a repeat too). */
  fun send(context: Context, clip: ClipContent?) {
    val app = context.applicationContext
    when (clip) {
      null -> toast(app, "The clipboard is empty")
      is ClipContent.Text -> {
        HariShare.add(app, listOf(HariShare.text("clipboard", clip.text)))
        handOver(app)
      }
      is ClipContent.Item ->
        // Copied now: the right to read it lasts only while it's on the clipboard.
        Thread {
          val copied = HariShare.copyIn(app, clip.uri)
          Handler(Looper.getMainLooper()).post {
            if (copied == null) {
              toast(app, "Hari can't read that")
            } else {
              HariShare.add(app, listOf(copied))
              handOver(app)
            }
          }
        }.start()
    }
  }

  private fun handOver(context: Context) {
    if (HariLive.emit == null && !HariShareTask.start(context)) toast(context, "Open Hari to send it")
    else toast(context, SENT)
  }

  private const val SENT = "Sent to Hari (desktop)"

  private fun toast(context: Context, text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
}
