//! Fork (Hari, L-320): the Share bar. A small always-on-top window that only
//! holds Share's composer, so text, links, pictures and files can go to the
//! paired phone from over any app. A global shortcut (Ctrl+Alt+H by default)
//! shows and hides it; it stays open after sending and closes only with its ×
//! or the shortcut. Where it was moved and how big it was are kept in
//! `share-bar.json`, and put back on a screen that still exists.
//!
//! It reuses the quick composer's window recipe (transparent, Acrylic, no
//! frame) and its global-shortcut handler, which hands this window's chord
//! here. Windows only: the fork does not build macOS.

use std::path::PathBuf;
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::window::{Effect, EffectsBuilder};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Window, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut};

use crate::window::SHARE_BAR_LABEL;

const DEFAULT_SHORTCUT: &str = "Control+Option+KeyH";
const FILE: &str = "share-bar.json";
/// Logical size the first time it opens.
const WIDTH: f64 = 440.0;
const HEIGHT: f64 = 176.0;
const MIN_WIDTH: f64 = 320.0;
const MIN_HEIGHT: f64 = 136.0;
/// Gap from the screen edge the first time it opens (bottom right).
const MARGIN: f64 = 24.0;
/// The page refreshes pairing and focuses the box on every show.
const SHOWN: &str = "share_bar_shown";
/// Moves and resizes come in bursts; save once they stop.
const SAVE_AFTER: Duration = Duration::from_millis(600);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct Frame {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Default, Serialize, Deserialize)]
struct Saved {
    #[serde(default)]
    frame: Option<Frame>,
}

#[derive(Default)]
pub struct ShareBarState {
    shortcut: Mutex<Option<Shortcut>>,
    /// Bumped on every move or resize; a save only runs if no newer one came.
    moves: AtomicU64,
}

pub fn init(app: &AppHandle) {
    app.manage(ShareBarState::default());
}

/// True when `shortcut` is the Share bar's, so the shared global-shortcut
/// handler sends it here instead of to the quick composer.
pub fn owns(app: &AppHandle, shortcut: &Shortcut) -> bool {
    app.try_state::<ShareBarState>()
        .and_then(|state| state.shortcut.lock().ok().map(|current| *current))
        .flatten()
        .is_some_and(|current| current == *shortcut)
}

fn parse_shortcut(value: &str) -> Result<Shortcut, String> {
    let shortcut = Shortcut::from_str(value).map_err(|err| err.to_string())?;
    if !shortcut
        .mods
        .intersects(Modifiers::SUPER | Modifiers::CONTROL | Modifiers::ALT)
    {
        return Err("Use Ctrl, Win or Alt with another key.".into());
    }
    Ok(shortcut)
}

/// Workspace windows own the setting and report it on boot, like the quick
/// composer's. Idempotent. A chord another app (or MonoCode) holds is
/// refused with "Shortcut taken" and the old one stays.
#[tauri::command]
pub fn share_bar_set_enabled(
    app: AppHandle,
    enabled: bool,
    shortcut: Option<String>,
) -> Result<(), String> {
    let next = parse_shortcut(shortcut.as_deref().unwrap_or(DEFAULT_SHORTCUT))?;
    let shortcuts = app.global_shortcut();
    let state = app.state::<ShareBarState>();
    let mut current = state.shortcut.lock().map_err(|err| err.to_string())?;
    if enabled {
        if *current == Some(next) {
            return Ok(());
        }
        shortcuts
            .register(next)
            .map_err(|_| "Shortcut taken: another app or MonoCode already uses it.".to_string())?;
        if let Some(previous) = *current {
            if let Err(err) = shortcuts.unregister(previous) {
                let _ = shortcuts.unregister(next);
                return Err(format!("Could not release {previous}: {err}"));
            }
        }
        *current = Some(next);
    } else if let Some(previous) = *current {
        shortcuts
            .unregister(previous)
            .map_err(|err| err.to_string())?;
        *current = None;
        if let Some(bar) = app.get_webview_window(SHARE_BAR_LABEL) {
            let _ = bar.hide();
        }
    }
    Ok(())
}

/// The bar's × button.
#[tauri::command]
pub fn share_bar_hide(window: Window) -> Result<(), String> {
    if window.label() != SHARE_BAR_LABEL {
        return Err("Only the Share bar can close itself.".into());
    }
    window.hide().map_err(|err| err.to_string())
}

/// Shows the bar, or hides it when it is already showing.
pub fn toggle(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(bar) = handle.get_webview_window(SHARE_BAR_LABEL) {
            if bar.is_visible().unwrap_or(false) {
                let _ = bar.hide();
                return;
            }
            show(&handle, &bar);
            return;
        }
        match build(&handle) {
            Ok(bar) => show(&handle, &bar),
            Err(err) => eprintln!("monocode: share bar: {err}"),
        }
    });
}

fn build(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let bar = WebviewWindowBuilder::new(
        app,
        SHARE_BAR_LABEL,
        WebviewUrl::App("share-bar.html".into()),
    )
    .title("Share to phone")
    .inner_size(WIDTH, HEIGHT)
    .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
    .resizable(true)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(true)
    .effects(EffectsBuilder::new().effect(Effect::Acrylic).build())
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .focused(false)
    .build()?;
    let _ = bar.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
    // Placed before the first save can run, so a fresh bar never writes the
    // builder's default spot over the saved one.
    place(app, &bar);
    let handle = app.clone();
    bar.on_window_event(move |event| {
        if matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
            save_soon(&handle);
        }
    });
    Ok(bar)
}

fn show(app: &AppHandle, bar: &WebviewWindow) {
    place(app, bar);
    let _ = bar.unminimize();
    let _ = bar.show();
    let _ = bar.set_focus();
    let _ = bar.emit(SHOWN, ());
}

/// Back where it was if that spot is still on a screen (monitors can change
/// between runs), else the bottom right of the screen under the pointer.
fn place(app: &AppHandle, bar: &WebviewWindow) {
    let areas: Vec<Frame> = app
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|monitor| {
            let area = monitor.work_area();
            Frame {
                x: area.position.x,
                y: area.position.y,
                width: area.size.width,
                height: area.size.height,
            }
        })
        .collect();
    if let Some(frame) = load(app).frame.and_then(|frame| fit(frame, &areas)) {
        let _ = bar.set_size(PhysicalSize::new(frame.width, frame.height));
        let _ = bar.set_position(PhysicalPosition::new(frame.x, frame.y));
        return;
    }
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|point| app.monitor_from_point(point.x, point.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        let _ = bar.center();
        return;
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let width = (WIDTH * scale).round() as i32;
    let height = (HEIGHT * scale).round() as i32;
    let margin = (MARGIN * scale).round() as i32;
    let _ = bar.set_size(PhysicalSize::new(width as u32, height as u32));
    let x = area.position.x + area.size.width as i32 - width - margin;
    let y = area.position.y + area.size.height as i32 - height - margin;
    let _ = bar.set_position(PhysicalPosition::new(
        x.max(area.position.x),
        y.max(area.position.y),
    ));
}

/// The saved frame moved fully onto the screen holding most of it, shrunk to
/// fit if that screen is now smaller. `None` when it touches no screen.
fn fit(frame: Frame, areas: &[Frame]) -> Option<Frame> {
    let overlap = |area: &Frame| -> i64 {
        let left = frame.x.max(area.x);
        let top = frame.y.max(area.y);
        let right = (frame.x + frame.width as i32).min(area.x + area.width as i32);
        let bottom = (frame.y + frame.height as i32).min(area.y + area.height as i32);
        i64::from((right - left).max(0)) * i64::from((bottom - top).max(0))
    };
    let area = areas
        .iter()
        .filter(|area| overlap(area) > 0)
        .max_by_key(|area| overlap(area))?;
    let width = frame.width.min(area.width);
    let height = frame.height.min(area.height);
    let x = frame.x.clamp(area.x, area.x + (area.width - width) as i32);
    let y = frame
        .y
        .clamp(area.y, area.y + (area.height - height) as i32);
    Some(Frame {
        x,
        y,
        width,
        height,
    })
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join(FILE))
}

fn load(app: &AppHandle) -> Saved {
    path(app)
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn save_soon(app: &AppHandle) {
    let Some(state) = app.try_state::<ShareBarState>() else {
        return;
    };
    let ticket = state.moves.fetch_add(1, Ordering::SeqCst) + 1;
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(SAVE_AFTER);
        let Some(state) = handle.try_state::<ShareBarState>() else {
            return;
        };
        if state.moves.load(Ordering::SeqCst) != ticket {
            return;
        }
        save_frame(&handle);
    });
}

fn save_frame(app: &AppHandle) {
    let Some(bar) = app.get_webview_window(SHARE_BAR_LABEL) else {
        return;
    };
    // A minimised or hidden window reports a bogus spot; keep the last one.
    if bar.is_minimized().unwrap_or(false) || !bar.is_visible().unwrap_or(false) {
        return;
    }
    let (Ok(position), Ok(size)) = (bar.outer_position(), bar.inner_size()) else {
        return;
    };
    if size.width == 0 || size.height == 0 {
        return;
    }
    let Some(path) = path(app) else {
        return;
    };
    let saved = Saved {
        frame: Some(Frame {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        }),
    };
    let Ok(bytes) = serde_json::to_vec_pretty(&saved) else {
        return;
    };
    let temp = path.with_extension("json.tmp");
    if std::fs::write(&temp, bytes).is_ok() {
        if let Err(err) = std::fs::rename(&temp, &path) {
            eprintln!("monocode: couldn't save the Share bar's place: {err}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{fit, parse_shortcut, Frame, DEFAULT_SHORTCUT};
    use tauri_plugin_global_shortcut::{Code, Modifiers};

    const SCREEN: Frame = Frame {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040,
    };
    const RIGHT: Frame = Frame {
        x: 1920,
        y: 0,
        width: 1280,
        height: 680,
    };

    #[test]
    fn default_shortcut_is_ctrl_alt_h() {
        let shortcut = parse_shortcut(DEFAULT_SHORTCUT).unwrap();
        assert_eq!(shortcut.key, Code::KeyH);
        assert_eq!(shortcut.mods, Modifiers::CONTROL | Modifiers::ALT);
        assert!(parse_shortcut("Shift+KeyH").is_err());
        assert!(parse_shortcut("Option+KeyH").is_ok());
    }

    #[test]
    fn a_frame_on_screen_stays_where_it_was() {
        let frame = Frame {
            x: 1400,
            y: 800,
            width: 440,
            height: 176,
        };
        assert_eq!(fit(frame, &[SCREEN, RIGHT]), Some(frame));
    }

    #[test]
    fn a_frame_half_off_screen_is_pulled_back_on() {
        let frame = Frame {
            x: 1700,
            y: 950,
            width: 440,
            height: 176,
        };
        let fitted = fit(frame, &[SCREEN]).unwrap();
        assert_eq!((fitted.x, fitted.y), (1480, 864));
        assert_eq!((fitted.width, fitted.height), (440, 176));
    }

    #[test]
    fn a_frame_on_an_unplugged_screen_is_not_used() {
        let frame = Frame {
            x: 2500,
            y: 300,
            width: 440,
            height: 176,
        };
        assert_eq!(fit(frame, &[SCREEN]), None);
        assert_eq!(fit(frame, &[]), None);
    }

    #[test]
    fn a_frame_bigger_than_a_smaller_screen_shrinks_to_it() {
        let frame = Frame {
            x: 1900,
            y: 100,
            width: 1600,
            height: 900,
        };
        let fitted = fit(frame, &[SCREEN, RIGHT]).unwrap();
        assert_eq!(fitted, RIGHT);
    }
}
