package expo.modules.monocodelink

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class MonocodeLinkModule : Module() {
  companion object { init { System.loadLibrary("monocode_mobile_link") } }
  private external fun nativeCall(input: String): String
  override fun definition() = ModuleDefinition {
    Name("MonocodeLink")
    // Fork (Hari, L-235): off Expo's one shared queue. A watch waits up to 10 s
    // for its next update, and every other module (the photo and file pickers,
    // reading a picked file) queued behind it. The Rust side is thread-safe.
    AsyncFunction("execute") Coroutine { input: String ->
      withContext(Dispatchers.IO) { nativeCall(input) }
    }
  }
}
