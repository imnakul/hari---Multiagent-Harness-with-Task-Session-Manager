package expo.modules.harilive

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.util.Log
import android.view.WindowManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

// Fork (Hari, L-290, L-297): Share's storage and Delete all, keeping the
// screen on while a big file moves, and the phone's storage for the computer's
// "Phone files" browser (needs Android's "All files access").

internal object HariFiles {
  private const val TAG = "HariFiles"
  private const val PAGE = 200

  /** Deletes files Hari saved to Download/Hari (its own MediaStore entries); how many went. */
  fun deleteSaved(context: Context, uris: List<String>): Int {
    var deleted = 0
    for (uri in uris) {
      try {
        val parsed = Uri.parse(uri)
        if (parsed.scheme == "content") {
          deleted += context.contentResolver.delete(parsed, null, null)
        } else if (parsed.scheme == "file") {
          val file = File(parsed.path ?: continue)
          val own = listOf(context.cacheDir, context.filesDir)
            .any { file.canonicalPath.startsWith(it.canonicalPath + File.separator) }
          if (own && file.delete()) deleted += 1
        }
      } catch (error: Exception) {
        Log.w(TAG, "Could not delete a saved file", error)
      }
    }
    return deleted
  }

  /** Keeps the screen on (while a big file moves) or lets it sleep again. */
  fun keepAwake(activity: Activity?, on: Boolean) {
    activity ?: return
    activity.runOnUiThread {
      if (on) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
  }

  /** Whether Hari may read the phone's storage ("All files access"). */
  fun hasAllFiles(): Boolean =
    Build.VERSION.SDK_INT >= 30 && Environment.isExternalStorageManager()

  /** Opens Android's "All files access" page for Hari. */
  fun openAllFilesSettings(context: Context): Boolean =
    try {
      val intent = if (Build.VERSION.SDK_INT >= 30) {
        Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:${context.packageName}"))
      } else {
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
      }
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    } catch (error: Exception) {
      Log.w(TAG, "Could not open All files access", error)
      false
    }

  private fun root(): File = Environment.getExternalStorageDirectory()

  /** A path inside the phone's shared storage, or null for anything outside it. */
  private fun inside(path: String): File? {
    val base = root().canonicalFile
    val file = (if (path.isBlank()) base else File(path)).canonicalFile
    return if (file == base || file.path.startsWith(base.path + File.separator)) file else null
  }

  /**
   * One page of a folder in the phone's shared storage, as JSON: folders
   * first, then files, by name; hidden ones skipped.
   */
  fun list(path: String, offset: Int): String {
    if (!hasAllFiles()) throw IllegalStateException("Allow All files access for Hari on the phone")
    val dir = inside(path) ?: throw IllegalArgumentException("Outside the phone's storage")
    if (!dir.isDirectory) throw IllegalArgumentException("Not a folder")
    val all = (dir.listFiles() ?: emptyArray())
      .filter { !it.name.startsWith(".") }
      .sortedWith(compareBy<File>({ !it.isDirectory }, { it.name.lowercase() }))
    val start = offset.coerceIn(0, all.size)
    val items = JSONArray()
    for (file in all.subList(start, minOf(all.size, start + PAGE))) {
      items.put(
        JSONObject()
          .put("name", file.name)
          .put("path", file.path)
          .put("dir", file.isDirectory)
          .put("size", if (file.isDirectory) 0 else file.length())
          .put("modified", file.lastModified()),
      )
    }
    val base = root().canonicalFile
    return JSONObject()
      .put("path", dir.path)
      .put("parent", if (dir == base) JSONObject.NULL else dir.parentFile?.path)
      .put("root", base.path)
      .put("total", all.size)
      .put("items", items)
      .toString()
  }

  /** A file in shared storage to send, as JSON `{ uri, name, size }`. */
  fun describe(path: String): String {
    if (!hasAllFiles()) throw IllegalStateException("Allow All files access for Hari on the phone")
    val file = inside(path) ?: throw IllegalArgumentException("Outside the phone's storage")
    if (!file.isFile) throw IllegalArgumentException("Not a file")
    return JSONObject()
      .put("uri", Uri.fromFile(file).toString())
      .put("name", file.name)
      .put("size", file.length())
      .toString()
  }
}
