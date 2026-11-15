package expo.modules.harilive

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.app.Service
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.text.TextUtils
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import kotlin.math.abs
import kotlin.math.roundToInt

// Fork (Hari, L-321): the Share bubble. A small floating button over other
// apps (Android's "Display over other apps"); one tap sends the phone's
// clipboard (text, a link or a picture) to the paired computer through the
// same background send as the share sheet (L-303). It hides while Hari
// itself is open and is off until turned on in Hari's Settings.

/** What a tap found on the clipboard. */
internal sealed class ClipContent {
  data class Text(val text: String) : ClipContent()

  data class Item(val uri: Uri) : ClipContent()
}

internal object HariBubble {
  private const val TAG = "HariBubble"
  private const val PREFS = "hari_bubble"
  private const val KEY_ON = "on"
  private const val KEY_COLOR = "color"
  private const val KEY_SIDE = "right"
  private const val KEY_Y = "y"
  private const val KEY_LAST = "last"
  const val EXTRA_FROM_BUBBLE = "expo.modules.harilive.FROM_BUBBLE"
  const val EXTRA_FORCE = "expo.modules.harilive.FORCE"

  /** Hari's own window is in front: the bubble steps aside. Main thread only. */
  var appInFront = false
    private set

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun permitted(context: Context): Boolean = Settings.canDrawOverlays(context)

  fun state(context: Context): Map<String, Boolean> =
    mapOf("enabled" to prefs(context).getBoolean(KEY_ON, false), "permitted" to permitted(context))

  fun accent(context: Context): Int =
    try {
      Color.parseColor(prefs(context).getString(KEY_COLOR, null) ?: "#4c9ef5")
    } catch (_: IllegalArgumentException) {
      Color.parseColor("#4c9ef5")
    }

  /**
   * Turns the bubble on or off and remembers it. Turning on needs "Display
   * over other apps"; without it the choice is kept and this returns false
   * (the app then opens that system page).
   */
  fun setEnabled(context: Context, on: Boolean, color: String?): Boolean {
    val edit = prefs(context).edit().putBoolean(KEY_ON, on)
    if (color != null) edit.putString(KEY_COLOR, color)
    edit.apply()
    if (!on) {
      context.stopService(Intent(context, HariBubbleService::class.java))
      return true
    }
    if (!permitted(context)) return false
    start(context)
    HariBubbleService.instance?.applyAccent()
    return true
  }

  /** Brings the bubble back when Hari starts, if it was on. */
  fun restore(context: Context) {
    if (prefs(context).getBoolean(KEY_ON, false) && permitted(context)) start(context)
  }

  private fun start(context: Context) {
    try {
      context.startService(Intent(context, HariBubbleService::class.java))
    } catch (error: Exception) {
      // Android refuses services started from the background (a headless task).
      Log.w(TAG, "Could not show the bubble", error)
    }
  }

  fun setAppInFront(front: Boolean) {
    appInFront = front
    HariBubbleService.instance?.setHidden(front)
  }

  fun openOverlaySettings(context: Context): Boolean =
    try {
      context.startActivity(
        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
      true
    } catch (error: Exception) {
      Log.w(TAG, "Could not open Display over other apps", error)
      false
    }

  fun savedPlace(context: Context): Pair<Boolean, Float> =
    prefs(context).let { it.getBoolean(KEY_SIDE, true) to it.getFloat(KEY_Y, 0.42f) }

  fun savePlace(context: Context, right: Boolean, y: Float) {
    prefs(context).edit().putBoolean(KEY_SIDE, right).putFloat(KEY_Y, y).apply()
  }

  /**
   * Reads the clipboard. Android lets only the app with focus read it, so
   * this runs in HariShareActivity's invisible window (as the Quick Settings
   * tile does). Null when it's empty or Android said no.
   */
  fun readClip(context: Context): ClipContent? {
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

  private fun keyFor(clip: ClipContent): String =
    when (clip) {
      is ClipContent.Text -> "t:${clip.text.length}:${clip.text.hashCode()}"
      is ClipContent.Item -> "u:${clip.uri}"
    }

  /**
   * Sends what the tap found, unless it is what the bubble sent last
   * ([force]: Send again). Feedback shows on the bubble.
   */
  fun send(context: Context, clip: ClipContent?, force: Boolean) {
    val app = context.applicationContext
    val bubble = HariBubbleService.instance
    if (clip == null) {
      bubble?.showNote("The clipboard is empty", null, null) ?: toast(app, "The clipboard is empty")
      return
    }
    val key = keyFor(clip)
    if (!force && prefs(app).getString(KEY_LAST, null) == key) {
      bubble?.alreadySent() ?: toast(app, "Already sent")
      return
    }
    val id = UUID.randomUUID().toString()
    when (clip) {
      is ClipContent.Text -> {
        HariShare.add(app, listOf(HariShare.text("clipboard", clip.text).put("id", id)))
        hand(app, key, id, "Sent: ${clip.text.trim().replace(Regex("\\s+"), " ")}", null)
      }
      is ClipContent.Item ->
        // Copied now: the right to read it lasts only while it's on the clipboard.
        Thread {
          val copied = HariShare.copyIn(app, clip.uri)
          val thumbnail = copied?.let { thumbnail(it) }
          Handler(Looper.getMainLooper()).post {
            if (copied == null) {
              HariBubbleService.instance?.showNote("Hari can't read that", null, null)
                ?: toast(app, "Hari can't read that")
            } else {
              HariShare.add(app, listOf(copied.put("id", id)))
              val picture = copied.optString("mimeType").startsWith("image/")
              hand(app, key, id, if (picture) "Sent: picture" else "Sent: ${copied.optString("name")}", thumbnail)
            }
          }
        }.start()
    }
  }

  private fun hand(context: Context, key: String, id: String, label: String, thumbnail: Bitmap?) {
    if (HariLive.emit == null && !HariShareTask.start(context)) {
      HariBubbleService.instance?.showNote("Open Hari to send it", null, null) ?: toast(context, "Open Hari to send it")
      return
    }
    prefs(context).edit().putString(KEY_LAST, key).apply()
    HariBubbleService.instance?.sent(id, label, thumbnail) ?: toast(context, label)
  }

  /**
   * Undo: still waiting on the phone, it's dropped; already taken, it's
   * removed from Share on both sides (L-317), as Remove does.
   */
  fun undo(context: Context, id: String) {
    prefs(context).edit().remove(KEY_LAST).apply()
    if (HariShare.removePending(context, id)) return
    HariShare.add(context, listOf(JSONObject().put("type", "undo").put("ids", JSONArray().put(id))))
    if (HariLive.emit == null) HariShareTask.start(context)
  }

  /** Opens the invisible reader that takes the clipboard and sends it. */
  fun requestSend(context: Context, force: Boolean) {
    try {
      context.startActivity(
        Intent(context, HariShareActivity::class.java)
          .setAction(HariShare.ACTION_CLIPBOARD)
          .putExtra(EXTRA_FROM_BUBBLE, true)
          .putExtra(EXTRA_FORCE, force)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    } catch (error: Exception) {
      Log.w(TAG, "Could not read the clipboard", error)
      HariBubbleService.instance?.showNote("Android didn't let Hari read the clipboard", null, null)
    }
  }

  fun openShare(context: Context) {
    try {
      context.startActivity(
        Intent(Intent.ACTION_VIEW, Uri.parse("monocode://share"))
          .setPackage(context.packageName)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    } catch (error: Exception) {
      Log.w(TAG, "Could not open Share", error)
    }
  }

  private fun thumbnail(item: JSONObject): Bitmap? {
    if (!item.optString("mimeType").startsWith("image/")) return null
    val path = Uri.parse(item.optString("uri")).path ?: return null
    return try {
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(path, bounds)
      var sample = 1
      while (bounds.outWidth / (sample * 2) >= 96 && bounds.outHeight / (sample * 2) >= 96) sample *= 2
      BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
    } catch (error: Exception) {
      Log.w(TAG, "Could not draw the thumbnail", error)
      null
    }
  }

  private fun toast(context: Context, text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
}

/**
 * Draws the bubble and its note and menu over other apps. A plain service:
 * while its window shows, Android counts Hari as in use and keeps it.
 */
class HariBubbleService : Service() {
  private val main = Handler(Looper.getMainLooper())
  private lateinit var windows: WindowManager
  private lateinit var bubble: FrameLayout
  private lateinit var icon: ImageView
  private lateinit var bubbleParams: WindowManager.LayoutParams
  private var shown = false
  private var note: View? = null
  private var menu: View? = null
  private var snapping: ValueAnimator? = null
  private val hideNote = Runnable { closeNote() }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    windows = getSystemService(WindowManager::class.java)
    buildBubble()
    setHidden(HariBubble.appInFront)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

  override fun onDestroy() {
    instance = null
    main.removeCallbacksAndMessages(null)
    snapping?.cancel()
    closeNote()
    closeMenu()
    if (shown) remove(bubble)
    shown = false
    super.onDestroy()
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    // Turned or resized: back to its side, at the same height.
    closeMenu()
    closeNote()
    place()
    if (shown) update(bubble, bubbleParams)
  }

  fun setHidden(hidden: Boolean) {
    if (hidden) {
      closeMenu()
      closeNote()
      if (shown) remove(bubble)
      shown = false
    } else if (!shown) {
      place()
      shown = add(bubble, bubbleParams)
    }
  }

  fun applyAccent() {
    icon.setColorFilter(HariBubble.accent(this))
  }

  private fun dp(value: Int): Int =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).roundToInt()

  private fun screen(): Pair<Int, Int> =
    if (Build.VERSION.SDK_INT >= 30) {
      windows.currentWindowMetrics.bounds.let { it.width() to it.height() }
    } else {
      resources.displayMetrics.let { it.widthPixels to it.heightPixels }
    }

  private fun overlayParams(width: Int, height: Int, extraFlags: Int = 0): WindowManager.LayoutParams {
    @Suppress("DEPRECATION")
    val type =
      if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      else WindowManager.LayoutParams.TYPE_PHONE
    return WindowManager.LayoutParams(
      width,
      height,
      type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or extraFlags,
      PixelFormat.TRANSLUCENT,
    ).apply { gravity = Gravity.TOP or Gravity.START }
  }

  private fun glass(radius: Int): GradientDrawable =
    GradientDrawable().apply {
      cornerRadius = radius.toFloat()
      setColor(Color.argb(232, 28, 28, 31))
      setStroke(maxOf(1, dp(1) / 2), Color.argb(36, 255, 255, 255))
    }

  private fun add(view: View, params: WindowManager.LayoutParams): Boolean =
    try {
      windows.addView(view, params)
      true
    } catch (error: Exception) {
      // "Display over other apps" was turned off in system settings.
      Log.w("HariBubble", "Could not show the bubble", error)
      false
    }

  private fun remove(view: View) {
    try {
      windows.removeViewImmediate(view)
    } catch (_: Exception) {
      // Already gone.
    }
  }

  private fun update(view: View, params: WindowManager.LayoutParams) {
    try {
      windows.updateViewLayout(view, params)
    } catch (_: Exception) {
      // Not attached (hidden).
    }
  }

  @SuppressLint("ClickableViewAccessibility")
  private fun buildBubble() {
    val size = dp(BUBBLE_DP)
    icon = ImageView(this).apply {
      setImageResource(R.drawable.hari_bubble_icon)
      setColorFilter(HariBubble.accent(this@HariBubbleService))
      scaleType = ImageView.ScaleType.CENTER_INSIDE
      setPadding(dp(14), dp(14), dp(14), dp(14))
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    bubble = FrameLayout(this).apply {
      background = glass(size / 2)
      contentDescription = "Send clipboard to your computer"
      isClickable = true
      isLongClickable = true
      addView(icon, FrameLayout.LayoutParams(size, size))
      // TalkBack: double-tap sends, double-tap and hold opens the menu.
      setOnClickListener { HariBubble.requestSend(this@HariBubbleService, false) }
      setOnLongClickListener {
        openMenu()
        true
      }
    }
    bubbleParams = overlayParams(size, size)
    val slop = ViewConfiguration.get(this).scaledTouchSlop
    var downX = 0f
    var downY = 0f
    var startX = 0
    var startY = 0
    var dragging = false
    var held = false
    val hold = Runnable {
      held = true
      // Buzzes as a long press does.
      bubble.performLongClick()
    }
    bubble.setOnTouchListener { view, event ->
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          snapping?.cancel()
          downX = event.rawX
          downY = event.rawY
          startX = bubbleParams.x
          startY = bubbleParams.y
          dragging = false
          held = false
          view.animate().scaleX(PRESSED).scaleY(PRESSED).setDuration(PRESS_MS).start()
          main.postDelayed(hold, ViewConfiguration.getLongPressTimeout().toLong())
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = event.rawX - downX
          val dy = event.rawY - downY
          if (!dragging && !held && (abs(dx) > slop || abs(dy) > slop)) {
            dragging = true
            main.removeCallbacks(hold)
            closeNote()
          }
          if (dragging) {
            bubbleParams.x = startX + dx.roundToInt()
            bubbleParams.y = startY + dy.roundToInt()
            update(bubble, bubbleParams)
          }
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          main.removeCallbacks(hold)
          view.animate().scaleX(1f).scaleY(1f).setDuration(PRESS_MS).start()
          // A drag never sends.
          if (dragging) snapToSide()
          else if (!held && event.actionMasked == MotionEvent.ACTION_UP) view.performClick()
        }
      }
      true
    }
  }

  /** At its saved side and height, kept on screen. */
  private fun place() {
    val (width, height) = screen()
    val (right, fraction) = HariBubble.savedPlace(this)
    val size = dp(BUBBLE_DP)
    bubbleParams.x = if (right) width - size - dp(EDGE_DP) else dp(EDGE_DP)
    bubbleParams.y = (fraction * (height - size)).roundToInt().coerceIn(dp(48), maxOf(dp(48), height - size - dp(48)))
  }

  private fun snapToSide() {
    val (width, height) = screen()
    val size = dp(BUBBLE_DP)
    val right = bubbleParams.x + size / 2 > width / 2
    val targetX = if (right) width - size - dp(EDGE_DP) else dp(EDGE_DP)
    bubbleParams.y = bubbleParams.y.coerceIn(dp(48), maxOf(dp(48), height - size - dp(48)))
    HariBubble.savePlace(this, right, bubbleParams.y.toFloat() / maxOf(1, height - size))
    snapping = ValueAnimator.ofInt(bubbleParams.x, targetX).apply {
      duration = SNAP_MS
      interpolator = DecelerateInterpolator(2f)
      addUpdateListener {
        bubbleParams.x = it.animatedValue as Int
        update(bubble, bubbleParams)
      }
      start()
    }
  }

  private fun onRight(): Boolean = bubbleParams.x + dp(BUBBLE_DP) / 2 > screen().first / 2

  /** Places a panel beside the bubble, toward the middle of the screen. */
  private fun besideBubble(view: View, extraFlags: Int): WindowManager.LayoutParams {
    val (width, height) = screen()
    view.measure(
      View.MeasureSpec.makeMeasureSpec(width - dp(BUBBLE_DP) - dp(32), View.MeasureSpec.AT_MOST),
      View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.AT_MOST),
    )
    val params = overlayParams(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT, extraFlags)
    val size = dp(BUBBLE_DP)
    params.x =
      if (onRight()) bubbleParams.x - dp(8) - view.measuredWidth
      else bubbleParams.x + size + dp(8)
    params.y = (bubbleParams.y + size / 2 - view.measuredHeight / 2).coerceIn(dp(24), maxOf(dp(24), height - view.measuredHeight - dp(24)))
    return params
  }

  private fun label(text: String, color: Int, size: Float, bold: Boolean = false): TextView =
    TextView(this).apply {
      this.text = text
      setTextColor(color)
      textSize = size
      if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
      maxLines = 1
      ellipsize = TextUtils.TruncateAt.END
    }

  /** ✓ (or the picture) and what went, with Undo when [undoId] is set. */
  fun showNote(text: String, thumbnail: Bitmap?, undoId: String?, check: Boolean = false) {
    if (!shown) return
    closeMenu()
    closeNote()
    val row = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      background = glass(dp(20))
      setPadding(dp(10), dp(6), dp(if (undoId != null) 4 else 14), dp(6))
      minimumHeight = dp(40)
      // TalkBack reads it as it appears.
      accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
    }
    if (thumbnail != null) {
      row.addView(
        ImageView(this).apply {
          setImageBitmap(thumbnail)
          scaleType = ImageView.ScaleType.CENTER_CROP
          clipToOutline = true
          outlineProvider = android.view.ViewOutlineProvider.BACKGROUND
          background = GradientDrawable().apply { cornerRadius = dp(6).toFloat() }
          importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        },
        LinearLayout.LayoutParams(dp(28), dp(28)).apply { marginEnd = dp(8) },
      )
    } else if (check) {
      row.addView(
        ImageView(this).apply {
          setImageResource(R.drawable.hari_bubble_check)
          setColorFilter(HariBubble.accent(this@HariBubbleService))
          importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        },
        LinearLayout.LayoutParams(dp(18), dp(18)).apply { marginEnd = dp(6) },
      )
    }
    row.addView(
      label(text, Color.argb(235, 255, 255, 255), 14f).apply { maxWidth = dp(200) },
      LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT),
    )
    if (undoId != null) {
      row.addView(
        label("Undo", HariBubble.accent(this), 14f, bold = true).apply {
          gravity = Gravity.CENTER
          setPadding(dp(12), 0, dp(12), 0)
          minHeight = dp(40)
          isClickable = true
          contentDescription = "Undo the send"
          setOnClickListener {
            HariBubble.undo(this@HariBubbleService, undoId)
            showNote("Undone", null, null)
          }
        },
      )
    }
    row.alpha = 0f
    row.translationX = dp(if (onRight()) 8 else -8).toFloat()
    val params = besideBubble(row, 0)
    if (!add(row, params)) return
    note = row
    row.animate().alpha(1f).translationX(0f).setDuration(NOTE_IN_MS).setInterpolator(DecelerateInterpolator(2f)).start()
    main.postDelayed(hideNote, if (undoId != null) UNDO_MS else NOTE_MS)
  }

  private fun closeNote() {
    main.removeCallbacks(hideNote)
    note?.let { remove(it) }
    note = null
  }

  fun sent(id: String, label: String, thumbnail: Bitmap?) {
    haptic(if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY)
    showNote(label, thumbnail, id, check = thumbnail == null)
  }

  fun alreadySent() {
    haptic(if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS)
    ObjectAnimator.ofFloat(icon, View.ROTATION, 0f, -14f, 11f, -7f, 3f, 0f).setDuration(WIGGLE_MS).start()
    showNote("Already sent · hold for Send again", null, null)
  }

  private fun haptic(kind: Int) {
    if (shown) bubble.performHapticFeedback(kind)
  }

  @SuppressLint("ClickableViewAccessibility")
  private fun openMenu() {
    if (!shown) return
    closeNote()
    closeMenu()
    val list = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      background = glass(dp(16))
      setPadding(0, dp(6), 0, dp(6))
    }
    fun row(text: String, action: () -> Unit) {
      list.addView(
        label(text, Color.argb(235, 255, 255, 255), 15f).apply {
          gravity = Gravity.CENTER_VERTICAL
          minHeight = dp(48)
          minWidth = dp(168)
          setPadding(dp(18), 0, dp(18), 0)
          isClickable = true
          isFocusable = true
          setOnClickListener {
            closeMenu()
            action()
          }
        },
      )
    }
    row("Send again") { HariBubble.requestSend(this, true) }
    row("Open Share") { HariBubble.openShare(this) }
    row("Hide bubble") {
      HariBubble.setEnabled(this, false, null)
      Toast.makeText(this, "Bubble off. Turn it on again in Hari's Settings.", Toast.LENGTH_LONG).show()
    }
    // A touch anywhere else closes it.
    list.setOnTouchListener { _, event ->
      if (event.actionMasked == MotionEvent.ACTION_OUTSIDE) closeMenu()
      false
    }
    list.alpha = 0f
    list.scaleX = MENU_FROM
    list.scaleY = MENU_FROM
    val params = besideBubble(list, WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH)
    list.pivotX = if (onRight()) list.measuredWidth.toFloat() else 0f
    list.pivotY = list.measuredHeight / 2f
    if (!add(list, params)) return
    menu = list
    list.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(NOTE_IN_MS).setInterpolator(DecelerateInterpolator(2f)).start()
  }

  private fun closeMenu() {
    menu?.let { remove(it) }
    menu = null
  }

  companion object {
    /** The running bubble; main thread only. */
    @Volatile
    internal var instance: HariBubbleService? = null
      private set

    private const val BUBBLE_DP = 52
    private const val EDGE_DP = 6
    private const val PRESSED = 0.96f
    private const val PRESS_MS = 120L
    private const val SNAP_MS = 220L
    private const val NOTE_IN_MS = 180L
    private const val NOTE_MS = 1800L
    private const val UNDO_MS = 4000L
    private const val WIGGLE_MS = 360L
    private const val MENU_FROM = 0.95f
  }
}
