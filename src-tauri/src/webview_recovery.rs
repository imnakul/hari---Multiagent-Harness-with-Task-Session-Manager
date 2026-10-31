//! Fork (L-160): bring a workspace window back after its WebView2 page
//! process dies.
//!
//! On Windows the page (renderer) process can run out of memory and exit.
//! WebView2 then leaves the window blank and nothing reloads it, so the app
//! looks dead even though the Rust side and every chat process keep running.
//! This registers a `ProcessFailed` handler on each workspace window and
//! reloads the page when its renderer exits, at most `MAX_RELOADS` times per
//! `RELOAD_PERIOD` so a page that crashes on load cannot loop. Every failure
//! is appended to `webview-crashes.log` in the app data folder.
//!
//! Fork (L-213): a browser-process exit takes the whole WebView2 with it, so
//! a reload cannot help. Windows that run out of committed memory (error
//! 1455) end that way and the window stayed grey. The dead window is now
//! destroyed and built again under the same label, sharing the reload limit;
//! its chats are not stopped and the app does not quit while it is rebuilt.
//!
//! Other failure kinds are logged only: an unresponsive renderer may still
//! recover, and WebView2 restarts its own GPU process.

use std::collections::{HashMap, HashSet};
#[cfg(windows)]
use tauri::{PhysicalPosition, PhysicalSize};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{State, Window};

const MAX_RELOADS: usize = 3;
const RELOAD_PERIOD: Duration = Duration::from_secs(120);
/// How long after a rebuild a last-window exit request is treated as part of
/// the rebuild rather than a quit.
const REBUILD_GRACE: Duration = Duration::from_secs(15);

/// WebView2's `COREWEBVIEW2_PROCESS_FAILED_KIND`, by its documented values.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FailureKind {
    BrowserExited,
    RenderExited,
    RenderUnresponsive,
    FrameRenderExited,
    GpuExited,
    Other(i32),
}

impl FailureKind {
    pub(crate) fn from_raw(kind: i32) -> Self {
        match kind {
            0 => Self::BrowserExited,
            1 => Self::RenderExited,
            2 => Self::RenderUnresponsive,
            3 => Self::FrameRenderExited,
            6 => Self::GpuExited,
            other => Self::Other(other),
        }
    }

    fn label(self) -> String {
        match self {
            Self::BrowserExited => "browser process exited".into(),
            Self::RenderExited => "page process exited".into(),
            Self::RenderUnresponsive => "page process unresponsive".into(),
            Self::FrameRenderExited => "frame process exited".into(),
            Self::GpuExited => "GPU process exited".into(),
            Self::Other(kind) => format!("process failure kind {kind}"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Response {
    Reload,
    /// The WebView2 browser process exited: build the window again.
    Rebuild,
    /// The page crashed, but it already reloaded `MAX_RELOADS` times lately.
    GiveUp,
    LogOnly,
}

/// What to do about a failure, given how many reloads this window had in the
/// last `RELOAD_PERIOD`.
pub(crate) fn decide(kind: FailureKind, recent_reloads: usize) -> Response {
    match kind {
        FailureKind::RenderExited if recent_reloads < MAX_RELOADS => Response::Reload,
        FailureKind::RenderExited => Response::GiveUp,
        FailureKind::BrowserExited if recent_reloads < MAX_RELOADS => Response::Rebuild,
        FailureKind::BrowserExited => Response::GiveUp,
        _ => Response::LogOnly,
    }
}

/// Reload history per window label, and the windows whose page should say it
/// was reloaded.
#[derive(Default)]
pub struct WebviewRecovery {
    reloads: Mutex<HashMap<String, Vec<Instant>>>,
    recovered: Mutex<HashSet<String>>,
    #[cfg(windows)]
    rebuilding: Mutex<HashMap<String, Restore>>,
    last_rebuild: Mutex<Option<Instant>>,
}

/// Where the dead window was, so its replacement opens in the same place.
#[cfg(windows)]
#[derive(Debug, Clone, Copy)]
pub(crate) struct Restore {
    visible: bool,
    maximized: bool,
    position: Option<PhysicalPosition<i32>>,
    size: Option<PhysicalSize<u32>>,
}

impl WebviewRecovery {
    /// Counts reloads still inside `RELOAD_PERIOD`, forgetting older ones.
    fn recent_reloads(&self, label: &str, now: Instant) -> usize {
        let mut reloads = self.reloads.lock().unwrap_or_else(|e| e.into_inner());
        let times = reloads.entry(label.to_string()).or_default();
        times.retain(|at| now.duration_since(*at) < RELOAD_PERIOD);
        times.len()
    }

    fn note_reload(&self, label: &str, now: Instant) {
        let mut reloads = self.reloads.lock().unwrap_or_else(|e| e.into_inner());
        reloads.entry(label.to_string()).or_default().push(now);
        drop(reloads);
        let mut recovered = self.recovered.lock().unwrap_or_else(|e| e.into_inner());
        recovered.insert(label.to_string());
    }

    fn note_rebuild(&self, now: Instant) {
        *self.last_rebuild.lock().unwrap_or_else(|e| e.into_inner()) = Some(now);
    }

    fn rebuilt_since(&self, now: Instant) -> bool {
        self.last_rebuild
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_some_and(|at| now.duration_since(at) < REBUILD_GRACE)
    }

    fn take_recovered(&self, label: &str) -> bool {
        let mut recovered = self.recovered.lock().unwrap_or_else(|e| e.into_inner());
        recovered.remove(label)
    }
}

/// True once after this window's page was reloaded by crash recovery, so the
/// page can tell the user why it just restarted.
#[tauri::command]
pub fn take_webview_recovery(window: Window, state: State<'_, WebviewRecovery>) -> bool {
    state.take_recovered(window.label())
}

/// True for a short while after a window was rebuilt, so the exit request
/// Tauri sends when the dead window was the last one does not quit the app.
pub(crate) fn rebuilding_recently(app: &tauri::AppHandle) -> bool {
    use tauri::Manager;
    app.try_state::<WebviewRecovery>()
        .is_some_and(|state| state.rebuilt_since(Instant::now()))
}

#[cfg(windows)]
pub(crate) use platform::{install, take_rebuild};

#[cfg(windows)]
mod platform {
    use std::io::Write;
    use std::time::{Instant, SystemTime, UNIX_EPOCH};

    use tauri::{AppHandle, Manager, WebviewWindow};
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PROCESS_FAILED_KIND;
    use webview2_com::ProcessFailedEventHandler;

    use super::{decide, FailureKind, Response, Restore, WebviewRecovery};

    /// Registers the crash handler on `window`'s WebView2. Failure to
    /// register is logged; the window works as before without recovery.
    pub(crate) fn install(window: &WebviewWindow) {
        let app = window.app_handle().clone();
        let label = window.label().to_string();
        let result = window.with_webview(move |webview| {
            let controller = webview.controller();
            let handler = ProcessFailedEventHandler::create(Box::new(move |_sender, args| {
                let mut raw = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
                if let Some(args) = args {
                    // SAFETY: `raw` is a valid out-pointer for the call's duration.
                    let _ = unsafe { args.ProcessFailedKind(&mut raw) };
                }
                on_failure(&app, &label, FailureKind::from_raw(raw.0));
                Ok(())
            }));
            let mut token = 0i64;
            // SAFETY: WebView2 COM calls made on the window's UI thread, where
            // `with_webview` runs; `token` outlives the call.
            let registered = unsafe {
                controller
                    .CoreWebView2()
                    .and_then(|core| core.add_ProcessFailed(&handler, &mut token))
            };
            if let Err(error) = registered {
                eprintln!("monocode: webview crash recovery not installed: {error}");
            }
        });
        if let Err(error) = result {
            eprintln!("monocode: webview crash recovery not installed: {error}");
        }
    }

    fn on_failure(app: &AppHandle, label: &str, kind: FailureKind) {
        let state = app.state::<WebviewRecovery>();
        let now = Instant::now();
        let response = decide(kind, state.recent_reloads(label, now));
        let action = match response {
            Response::Reload => match app.get_webview(label).map(|w| w.reload()) {
                Some(Ok(())) => {
                    state.note_reload(label, now);
                    "reloaded the page"
                }
                Some(Err(_)) | None => "reload failed",
            },
            Response::Rebuild => match app.get_window(label) {
                Some(window) => {
                    let restore = Restore {
                        visible: window.is_visible().unwrap_or(true),
                        maximized: window.is_maximized().unwrap_or(false),
                        position: window.outer_position().ok(),
                        size: window.inner_size().ok(),
                    };
                    state
                        .rebuilding
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .insert(label.to_string(), restore);
                    state.note_reload(label, now);
                    state.note_rebuild(now);
                    // Not from inside the WebView2 callback itself.
                    let target = window.clone();
                    match app.run_on_main_thread(move || {
                        let _ = target.destroy();
                    }) {
                        Ok(()) => "rebuilding the window",
                        Err(_) => "rebuild failed",
                    }
                }
                None => "rebuild failed: window gone",
            },
            Response::GiveUp => "not recovered: too many crashes in two minutes",
            Response::LogOnly => "logged only",
        };
        let line = format!("window {label}: {}; {action}", kind.label());
        eprintln!("monocode: webview crash: {line}");
        append_log(app, &line);
    }

    /// Called when a window is destroyed. If crash recovery destroyed it,
    /// starts building its replacement and returns true, so the caller skips
    /// what a real close does (stopping its chats, quitting on the last one).
    pub(crate) fn take_rebuild(app: &AppHandle, label: &str) -> bool {
        let state = app.state::<WebviewRecovery>();
        let Some(restore) = state
            .rebuilding
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(label)
        else {
            return false;
        };
        state.note_rebuild(Instant::now());
        let app = app.clone();
        let label = label.to_string();
        // Building waits on the event loop, so not on the loop thread itself.
        std::thread::spawn(move || {
            let line = match crate::window::reopen_session_window(&app, &label, restore.visible) {
                Ok(window) => {
                    if let Some(size) = restore.size {
                        let _ = window.set_size(size);
                    }
                    if let Some(position) = restore.position {
                        let _ = window.set_position(position);
                    }
                    if restore.maximized {
                        let _ = window.maximize();
                    }
                    format!("window {label}: rebuilt after the browser process exited")
                }
                Err(error) => format!("window {label}: rebuild failed: {error}"),
            };
            eprintln!("monocode: webview crash: {line}");
            append_log(&app, &line);
        });
        true
    }

    fn append_log(app: &AppHandle, line: &str) {
        let Ok(dir) = app.path().app_data_dir() else {
            return;
        };
        let seconds = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let stamp = i64::try_from(seconds)
            .ok()
            .and_then(|s| time::OffsetDateTime::from_unix_timestamp(s).ok())
            .map(|t| {
                format!(
                    "{:04}-{:02}-{:02} {:02}:{:02}:{:02} UTC",
                    t.year(),
                    u8::from(t.month()),
                    t.day(),
                    t.hour(),
                    t.minute(),
                    t.second()
                )
            })
            .unwrap_or_else(|| seconds.to_string());
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("webview-crashes.log"))
        {
            let _ = writeln!(file, "{stamp} {line}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reloads_when_the_page_process_exits_and_rebuilds_when_webview2_does() {
        assert_eq!(decide(FailureKind::RenderExited, 0), Response::Reload);
        assert_eq!(decide(FailureKind::BrowserExited, 0), Response::Rebuild);
        for kind in [
            FailureKind::RenderUnresponsive,
            FailureKind::FrameRenderExited,
            FailureKind::GpuExited,
            FailureKind::Other(9),
        ] {
            assert_eq!(decide(kind, 0), Response::LogOnly, "{kind:?}");
        }
    }

    #[test]
    fn stops_reloading_after_three_recent_reloads() {
        assert_eq!(decide(FailureKind::RenderExited, 2), Response::Reload);
        assert_eq!(decide(FailureKind::RenderExited, 3), Response::GiveUp);
        assert_eq!(decide(FailureKind::BrowserExited, 2), Response::Rebuild);
        assert_eq!(decide(FailureKind::BrowserExited, 3), Response::GiveUp);
    }

    #[test]
    fn treats_exit_requests_shortly_after_a_rebuild_as_part_of_it() {
        let state = WebviewRecovery::default();
        let start = Instant::now();
        assert!(!state.rebuilt_since(start));
        state.note_rebuild(start);
        assert!(state.rebuilt_since(start + Duration::from_secs(1)));
        assert!(!state.rebuilt_since(start + REBUILD_GRACE));
    }

    #[test]
    fn maps_documented_failure_kinds() {
        assert_eq!(FailureKind::from_raw(0), FailureKind::BrowserExited);
        assert_eq!(FailureKind::from_raw(1), FailureKind::RenderExited);
        assert_eq!(FailureKind::from_raw(3), FailureKind::FrameRenderExited);
        assert_eq!(FailureKind::from_raw(6), FailureKind::GpuExited);
        assert_eq!(FailureKind::from_raw(42), FailureKind::Other(42));
    }

    #[test]
    fn forgets_reloads_older_than_the_period_and_flags_recovery_once() {
        let state = WebviewRecovery::default();
        let start = Instant::now();
        state.note_reload("main", start);
        state.note_reload("main", start);
        assert_eq!(state.recent_reloads("main", start), 2);
        assert_eq!(state.recent_reloads("other", start), 0);
        assert_eq!(state.recent_reloads("main", start + RELOAD_PERIOD), 0);
        assert!(state.take_recovered("main"));
        assert!(!state.take_recovered("main"));
    }
}
