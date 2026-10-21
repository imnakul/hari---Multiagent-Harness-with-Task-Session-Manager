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
//! Other failure kinds are logged only: a browser-process exit takes the
//! whole WebView2 with it (a reload cannot help), an unresponsive renderer
//! may still recover, and WebView2 restarts its own GPU process.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{State, WebviewWindow};

const MAX_RELOADS: usize = 3;
const RELOAD_PERIOD: Duration = Duration::from_secs(120);

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
        _ => Response::LogOnly,
    }
}

/// Reload history per window label, and the windows whose page should say it
/// was reloaded.
#[derive(Default)]
pub struct WebviewRecovery {
    reloads: Mutex<HashMap<String, Vec<Instant>>>,
    recovered: Mutex<HashSet<String>>,
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

    fn take_recovered(&self, label: &str) -> bool {
        let mut recovered = self.recovered.lock().unwrap_or_else(|e| e.into_inner());
        recovered.remove(label)
    }
}

/// True once after this window's page was reloaded by crash recovery, so the
/// page can tell the user why it just restarted.
#[tauri::command]
pub fn take_webview_recovery(window: WebviewWindow, state: State<'_, WebviewRecovery>) -> bool {
    state.take_recovered(window.label())
}

#[cfg(windows)]
pub(crate) use platform::install;

#[cfg(windows)]
mod platform {
    use std::io::Write;
    use std::time::{Instant, SystemTime, UNIX_EPOCH};

    use tauri::{AppHandle, Manager, WebviewWindow};
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PROCESS_FAILED_KIND;
    use webview2_com::ProcessFailedEventHandler;

    use super::{decide, FailureKind, Response, WebviewRecovery};

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
            Response::Reload => match app.get_webview_window(label).map(|w| w.reload()) {
                Some(Ok(())) => {
                    state.note_reload(label, now);
                    "reloaded the page"
                }
                Some(Err(_)) | None => "reload failed",
            },
            Response::GiveUp => "not reloaded: too many crashes in two minutes",
            Response::LogOnly => "logged only",
        };
        let line = format!("window {label}: {}; {action}", kind.label());
        eprintln!("monocode: webview crash: {line}");
        append_log(app, &line);
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
    fn reloads_only_when_the_page_process_exits() {
        assert_eq!(decide(FailureKind::RenderExited, 0), Response::Reload);
        for kind in [
            FailureKind::BrowserExited,
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
