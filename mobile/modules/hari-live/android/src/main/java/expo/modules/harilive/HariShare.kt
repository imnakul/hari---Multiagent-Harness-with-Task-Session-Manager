package expo.modules.harilive

import android.app.Activity
import android.app.PendingIntent
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.util.Log
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

// Fork (Hari, L-279): Share between the phone and the paired computer. What
// other apps share to Hari (the share sheet) and the clipboard (the Quick
// Settings tile) waits here until the app's code takes it and sends it; files
// the computer sends are saved to Download/Hari.

internal object HariShare {
  private const val TAG = "HariShare"
  private const val PREFS = "hari_share"
  private const val KEY = "pending"
  const val ACTION_CLIPBOARD = "expo.modules.harilive.SHARE_CLIPBOARD"
  private const val SHARE_URL = "monocode://share"
  private const val MAX_PENDING = 40
  private const val MAX_FILES = 20
  private const val MAX_FILE_BYTES = 1024L * 1024 * 1024
  private const val MAX_TEXT = 30_000
  private const val FOLDER = "Download/Hari"
  private val lock = Any()

  /** Keeps these for the app and tells it, if its code is running. */
  fun add(context: Context, items: List<JSONObject>) {
    if (items.isEmpty()) return
    synchronized(lock) {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val list = try {
        JSONArray(prefs.getString(KEY, "[]"))
      } catch (_: Exception) {
        JSONArray()
      }
      items.forEach { list.put(it) }
      val kept = JSONArray()
      for (index in maxOf(0, list.length() - MAX_PENDING) until list.length()) kept.put(list.get(index))
      prefs.edit().putString(KEY, kept.toString()).apply()
    }
    HariLive.dispatch(mapOf("action" to "shared"))
  }

  /** Everything waiting, as JSON; the list is emptied. */
  fun take(context: Context): String =
    synchronized(lock) {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val value = prefs.getString(KEY, "[]") ?: "[]"
      prefs.edit().remove(KEY).apply()
      value
    }

  fun text(type: String, text: String): JSONObject =
    JSONObject().put("type", type).put("text", text.take(MAX_TEXT))

  /**
   * Copies a shared file into the app's cache: the sending app's permission
   * to read it ends with the share activity. Null when it can't be read or
   * is over 1 GB.
   */
  fun copyIn(context: Context, uri: Uri): JSONObject? {
    val resolver = context.contentResolver
    var name: String? = null
    var size: Long? = null
    try {
      resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
          val nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          val sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE)
          if (nameColumn >= 0) name = cursor.getString(nameColumn)
          if (sizeColumn >= 0 && !cursor.isNull(sizeColumn)) size = cursor.getLong(sizeColumn)
        }
      }
    } catch (error: Exception) {
      Log.w(TAG, "Could not read a shared file's name", error)
    }
    if ((size ?: 0) > MAX_FILE_BYTES) return null
    val safe = (name ?: uri.lastPathSegment ?: "file")
      .substringAfterLast('/')
      .replace(Regex("[\\\\<>:\"|?*\\u0000-\\u001f]"), "_")
      .trimStart('.')
      .ifBlank { "file" }
      .take(150)
    val dir = File(context.cacheDir, "hari-share/${UUID.randomUUID()}")
    if (!dir.mkdirs()) return null
    val target = File(dir, safe)
    return try {
      var copied = 0L
      resolver.openInputStream(uri)?.use { input ->
        target.outputStream().use { output ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            copied += read
            if (copied > MAX_FILE_BYTES) throw IllegalStateException("Over 1 GB")
            output.write(buffer, 0, read)
          }
        }
      } ?: return null
      JSONObject()
        .put("type", "file")
        .put("uri", Uri.fromFile(target).toString())
        .put("name", safe)
        .put("mimeType", resolver.getType(uri) ?: "application/octet-stream")
        .put("size", copied)
    } catch (error: Exception) {
      Log.w(TAG, "Could not copy a shared file", error)
      dir.deleteRecursively()
      null
    }
  }

  /**
   * Copies a file from the app's storage into Download/Hari; Android picks a
   * free name if one is taken. Returns the saved file's content URI.
   */
  fun saveToDownloads(context: Context, source: String, name: String, mimeType: String): String {
    if (Build.VERSION.SDK_INT < 29) throw IllegalStateException("Saving to Downloads needs Android 10 or later")
    val path = Uri.parse(source).path ?: throw IllegalArgumentException("Not a file")
    val file = File(path)
    val own = listOf(context.cacheDir, context.filesDir).any { file.canonicalPath.startsWith(it.canonicalPath + File.separator) }
    if (!own || !file.isFile) throw IllegalArgumentException("Not one of Hari's files")
    val resolver = context.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, name)
      put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
      put(MediaStore.MediaColumns.RELATIVE_PATH, FOLDER)
      put(MediaStore.MediaColumns.IS_PENDING, 1)
    }
    val target = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
      ?: throw IllegalStateException("Android didn't make the file")
    try {
      resolver.openOutputStream(target)?.use { output -> file.inputStream().use { it.copyTo(output) } }
        ?: throw IllegalStateException("Android didn't open the file")
      resolver.update(target, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
    } catch (error: Exception) {
      resolver.delete(target, null, null)
      throw error
    }
    file.delete()
    return target.toString()
  }

  /** Opens a saved file in the app the user picks for its type. */
  fun open(context: Context, uri: String, mimeType: String): Boolean =
    try {
      val view = Intent(Intent.ACTION_VIEW)
        .setDataAndType(Uri.parse(uri), mimeType)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      context.startActivity(Intent.createChooser(view, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    } catch (error: Exception) {
      Log.w(TAG, "Could not open a saved file", error)
      false
    }

  /**
   * After something was shared: with the app's code running it sends it at
   * once (a toast says so); otherwise Hari opens on its Share screen.
   */
  fun handOver(activity: Activity, toast: String) {
    if (HariLive.emit != null) {
      Toast.makeText(activity, toast, Toast.LENGTH_SHORT).show()
    } else {
      try {
        activity.startActivity(
          Intent(Intent.ACTION_VIEW, Uri.parse(SHARE_URL))
            .setPackage(activity.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
      } catch (error: Exception) {
        Log.w(TAG, "Could not open Hari", error)
      }
    }
  }

  fun filesFrom(intent: Intent): List<Uri> {
    val uris = mutableListOf<Uri>()
    if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
      val list =
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else @Suppress("DEPRECATION") intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
      list?.let { uris.addAll(it) }
    } else {
      val single =
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else @Suppress("DEPRECATION") intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
      single?.let { uris.add(it) }
    }
    // Only other apps' files: never Hari's own private storage.
    return uris.filter { it.scheme == "content" }.take(MAX_FILES)
  }
}

/**
 * The share sheet's "Hari" target, and what the Quick Settings tile opens to
 * read the clipboard (Android lets only the app in front read it). Shows
 * nothing; finishes as soon as it has taken what was shared.
 */
class HariShareActivity : Activity() {
  private var clipboardRead = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    when (intent?.action) {
      Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE -> receive(intent)
      HariShare.ACTION_CLIPBOARD -> Unit // Read once the window has focus.
      else -> finish()
    }
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (!hasFocus || clipboardRead || intent?.action != HariShare.ACTION_CLIPBOARD) return
    clipboardRead = true
    val clipboard = getSystemService(ClipboardManager::class.java)
    val text = try {
      clipboard?.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(this)?.toString()
    } catch (_: Exception) {
      null
    }
    if (text.isNullOrBlank()) {
      Toast.makeText(this, "The clipboard has no text", Toast.LENGTH_SHORT).show()
    } else {
      HariShare.add(this, listOf(HariShare.text("clipboard", text)))
      HariShare.handOver(this, "Sending the clipboard to your computer")
    }
    finish()
  }

  private fun receive(intent: Intent) {
    val files = HariShare.filesFrom(intent)
    val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.takeIf { it.isNotBlank() }
    if (files.isEmpty() && text == null) {
      Toast.makeText(this, "Hari can't send that", Toast.LENGTH_SHORT).show()
      finish()
      return
    }
    val context = applicationContext
    Thread {
      val items = mutableListOf<org.json.JSONObject>()
      var skipped = 0
      files.forEach { uri ->
        val copied = HariShare.copyIn(context, uri)
        if (copied != null) items.add(copied) else skipped += 1
      }
      // A caption or link shared with files goes as its own item.
      if (text != null) items.add(HariShare.text("text", text))
      runOnUiThread {
        HariShare.add(context, items)
        if (skipped > 0) Toast.makeText(this, "Hari couldn't read $skipped file(s) (100 MB at most)", Toast.LENGTH_LONG).show()
        if (items.isNotEmpty()) HariShare.handOver(this, "Sending to your computer")
        finish()
      }
    }.start()
  }
}

/** Quick Settings tile: sends the phone's clipboard to the paired computer. */
class HariClipboardTile : TileService() {
  override fun onStartListening() {
    super.onStartListening()
    qsTile?.apply {
      state = Tile.STATE_INACTIVE
      label = "Send clipboard"
      icon = Icon.createWithResource(this@HariClipboardTile, R.drawable.hari_live_icon)
      updateTile()
    }
  }

  override fun onClick() {
    super.onClick()
    val intent = Intent(this, HariShareActivity::class.java)
      .setAction(HariShare.ACTION_CLIPBOARD)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (Build.VERSION.SDK_INT >= 34) {
      startActivityAndCollapse(
        PendingIntent.getActivity(this, 7310, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT),
      )
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(intent)
    }
  }
}
