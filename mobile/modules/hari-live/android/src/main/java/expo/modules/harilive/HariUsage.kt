package expo.modules.harilive

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import android.provider.Settings
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

// Fork (Hari, L-398): which apps were in front on this phone and for how long,
// for the computer's Activity page. Needs "Usage access" for Hari (a system
// page the user turns on). Only package names, labels and times leave here:
// nothing from inside an app.
internal object HariUsage {
  private const val TAG = "HariUsage"
  private const val MIN_MS = 5_000L
  private const val MAX_MS = 24L * 60 * 60 * 1000
  private const val MERGE_GAP_MS = 2_000L
  private const val MAX_INTERVALS = 5_000

  // UsageEvents.Event.ACTIVITY_RESUMED / ACTIVITY_PAUSED (the same numbers as
  // MOVE_TO_FOREGROUND / MOVE_TO_BACKGROUND, which older Android names them).
  private const val RESUMED = 1
  private const val PAUSED = 2

  /** Whether the user turned on Usage access for Hari. */
  fun allowed(context: Context): Boolean {
    val ops = context.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager ?: return false
    val mode =
      if (Build.VERSION.SDK_INT >= 29) {
        ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
      } else {
        @Suppress("DEPRECATION")
        ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
      }
    return mode == AppOpsManager.MODE_ALLOWED
  }

  /** The system page where Usage access is turned on. */
  fun openSettings(context: Context): Boolean =
    try {
      context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    } catch (error: Exception) {
      Log.w(TAG, "Could not open Usage access settings", error)
      false
    }

  private fun launcherPackage(context: Context): String? =
    context.packageManager
      .resolveActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), PackageManager.MATCH_DEFAULT_ONLY)
      ?.activityInfo
      ?.packageName

  private fun label(context: Context, name: String): String =
    try {
      val manager = context.packageManager
      manager.getApplicationLabel(manager.getApplicationInfo(name, 0)).toString().take(120)
    } catch (_: Exception) {
      name
    }

  private class Open(val start: Long)

  /**
   * Closed foreground intervals between `since` and `until` (epoch ms) as JSON
   * `[{ package, label, start, end }]`: a resume paired with the next pause
   * (or with another app coming to the front). Intervals under 5 seconds, Hari
   * itself and the home screen are left out. Empty without Usage access.
   */
  fun intervals(context: Context, since: Long, until: Long): String {
    if (!allowed(context) || until <= since) return "[]"
    val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return "[]"
    val skip = setOf(context.packageName, launcherPackage(context))
    val raw = ArrayList<Triple<String, Long, Long>>()
    val open = HashMap<String, Open>()

    fun close(pkg: String, end: Long) {
      val started = open.remove(pkg) ?: return
      if (end - started.start in MIN_MS..MAX_MS && pkg !in skip) raw.add(Triple(pkg, started.start, end))
    }

    try {
      val events = manager.queryEvents(since, until)
      val event = UsageEvents.Event()
      while (events.hasNextEvent()) {
        events.getNextEvent(event)
        val pkg = event.packageName ?: continue
        when (event.eventType) {
          RESUMED -> {
            // Only one app is in front: another one coming up ends the others.
            for (other in open.keys.toList()) if (other != pkg) close(other, event.timeStamp)
            open.getOrPut(pkg) { Open(event.timeStamp) }
          }
          PAUSED -> close(pkg, event.timeStamp)
        }
      }
    } catch (error: Exception) {
      Log.w(TAG, "Could not read usage events", error)
      return "[]"
    }
    // Apps still in front at `until` are not closed yet: they come with the next sync.

    raw.sortBy { it.second }
    val merged = ArrayList<Triple<String, Long, Long>>()
    for (item in raw) {
      val last = merged.lastOrNull()
      if (last != null && last.first == item.first && item.second - last.third <= MERGE_GAP_MS) {
        merged[merged.size - 1] = Triple(last.first, last.second, item.third)
      } else {
        merged.add(item)
      }
    }

    val labels = HashMap<String, String>()
    val out = JSONArray()
    for ((pkg, start, end) in merged.takeLast(MAX_INTERVALS)) {
      if (end - start > MAX_MS) continue
      out.put(
        JSONObject()
          .put("package", pkg)
          .put("label", labels.getOrPut(pkg) { label(context, pkg) })
          .put("start", start)
          .put("end", end),
      )
    }
    return out.toString()
  }
}
