//! Zen mode's window (fork, L-230): the workspace window narrows to a panel
//! docked on the right of its screen, and goes back to its exact size and
//! place on exit. The move animates with a fast start and a soft landing.
//!
//! Every command takes `tauri::Window`, never `WebviewWindow`: a window that
//! holds a Browser page is no longer a `WebviewWindow` (L-218).

use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{LogicalSize, Manager, PhysicalPosition, PhysicalSize, Window};

/// How long the window takes to move between its normal and Zen bounds.
const DURATION: Duration = Duration::from_millis(240);
/// About one frame of a 60 Hz screen.
const FRAME: Duration = Duration::from_millis(16);
/// Share of the screen's width the docked panel takes the first time.
const DOCK_SHARE: f64 = 0.25;
/// The panel's smallest size while in Zen, in logical px.
const ZEN_MIN_WIDTH: f64 = 360.0;
const ZEN_MIN_HEIGHT: f64 = 420.0;
/// The normal minimum when the app config has none (`tauri.conf.json`).
const NORMAL_MIN_WIDTH: f64 = 800.0;
const NORMAL_MIN_HEIGHT: f64 = 520.0;

/// A window's outer box on the desktop, in physical px.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZenBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// What leaving Zen puts back: the bounds before Zen and whether the window
/// was maximized.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZenRestore {
    pub bounds: ZenBounds,
    pub maximized: bool,
}

/// The first-time panel: the right edge of the work area, full height.
pub fn dock_bounds(area: ZenBounds, scale: f64) -> ZenBounds {
    let min = (ZEN_MIN_WIDTH * scale).round() as u32;
    let wanted = (f64::from(area.width) * DOCK_SHARE).round() as u32;
    let width = wanted.max(min).min(area.width);
    ZenBounds {
        x: area.x + area.width as i32 - width as i32,
        y: area.y,
        width,
        height: area.height,
    }
}

/// Fast start, soft landing (cubic ease-out), for `t` in 0..=1.
pub fn ease_out(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    1.0 - (1.0 - t).powi(3)
}

/// The box `progress` of the way from `from` to `to`.
pub fn frame_bounds(from: ZenBounds, to: ZenBounds, progress: f64) -> ZenBounds {
    let mix = |a: f64, b: f64| a + (b - a) * progress;
    ZenBounds {
        x: mix(f64::from(from.x), f64::from(to.x)).round() as i32,
        y: mix(f64::from(from.y), f64::from(to.y)).round() as i32,
        width: mix(f64::from(from.width), f64::from(to.width)).round() as u32,
        height: mix(f64::from(from.height), f64::from(to.height)).round() as u32,
    }
}

fn overlap(a: ZenBounds, b: ZenBounds) -> u64 {
    let left = a.x.max(b.x);
    let top = a.y.max(b.y);
    let right = (a.x + a.width as i32).min(b.x + b.width as i32);
    let bottom = (a.y + a.height as i32).min(b.y + b.height as i32);
    if right <= left || bottom <= top {
        return 0;
    }
    (right - left) as u64 * (bottom - top) as u64
}

/// True when at least half of `bounds` is on one of the screens, so a box
/// saved on a monitor that is gone (or rearranged) is not reused.
pub fn fits_work_area(bounds: ZenBounds, areas: &[ZenBounds]) -> bool {
    let size = u64::from(bounds.width) * u64::from(bounds.height);
    size > 0 && areas.iter().any(|area| overlap(bounds, *area) * 2 >= size)
}

/// `bounds` when it is still on a screen; else its size (capped) centred on
/// `fallback`, the screen the window is on now.
pub fn placed_on_screen(bounds: ZenBounds, areas: &[ZenBounds], fallback: ZenBounds) -> ZenBounds {
    if fits_work_area(bounds, areas) {
        return bounds;
    }
    let width = bounds.width.min(fallback.width);
    let height = bounds.height.min(fallback.height);
    ZenBounds {
        x: fallback.x + (fallback.width - width) as i32 / 2,
        y: fallback.y + (fallback.height - height) as i32 / 2,
        width,
        height,
    }
}

/// `current` resized to `width` with its right edge kept, moved only as far
/// as it takes to stay inside `area` (and no wider than it).
pub fn with_width(current: ZenBounds, area: ZenBounds, width: u32) -> ZenBounds {
    let width = width.min(area.width);
    let right = current.x + current.width as i32;
    let area_right = area.x + area.width as i32;
    let x = (right - width as i32).clamp(area.x, area_right - width as i32);
    ZenBounds {
        x,
        width,
        ..current
    }
}

/// True when the panel is still the width it was widened to (give or take
/// rounding), so the user has not resized it since.
pub fn still_width(current: u32, expect: u32) -> bool {
    current.abs_diff(expect) <= 2
}

/// A widened panel's width before and after, in physical px.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZenWiden {
    pub before: u32,
    pub after: u32,
}

fn rect(position: PhysicalPosition<i32>, size: PhysicalSize<u32>) -> ZenBounds {
    ZenBounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    }
}

fn outer_bounds(window: &Window) -> Result<ZenBounds, String> {
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    Ok(rect(position, size))
}

fn work_areas(window: &Window) -> Vec<ZenBounds> {
    window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|monitor| {
            let area = monitor.work_area();
            rect(area.position, area.size)
        })
        .collect()
}

/// The work area and scale of the screen the window is on, else the primary.
fn current_area(window: &Window) -> Result<(ZenBounds, f64), String> {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or("No screen found for the window.")?;
    let area = monitor.work_area();
    Ok((rect(area.position, area.size), monitor.scale_factor()))
}

/// Moves and sizes the window in one step on Windows, so the left edge never
/// jumps ahead of the width (two calls would show one frame in between).
#[cfg(windows)]
fn place(window: &Window, bounds: ZenBounds) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOZORDER,
    };
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    // SAFETY: the handle belongs to this live window; SetWindowPos only reads it.
    let ok = unsafe {
        SetWindowPos(
            hwnd.0 as _,
            std::ptr::null_mut(),
            bounds.x,
            bounds.y,
            bounds.width as i32,
            bounds.height as i32,
            SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
        )
    };
    if ok == 0 {
        return Err("Could not move the window.".into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn place(window: &Window, bounds: ZenBounds) -> Result<(), String> {
    window
        .set_position(PhysicalPosition::new(bounds.x, bounds.y))
        .map_err(|e| e.to_string())?;
    window
        .set_size(PhysicalSize::new(bounds.width, bounds.height))
        .map_err(|e| e.to_string())
}

/// Moves the window from `from` to `to`, frame by frame, off the main thread.
async fn animate(
    window: &Window,
    from: ZenBounds,
    to: ZenBounds,
    smooth: bool,
) -> Result<(), String> {
    if !smooth || from == to {
        return place(window, to);
    }
    let window = window.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let start = Instant::now();
        loop {
            let t = start.elapsed().as_secs_f64() / DURATION.as_secs_f64();
            if t >= 1.0 {
                return place(&window, to);
            }
            place(&window, frame_bounds(from, to, ease_out(t)))?;
            std::thread::sleep(FRAME);
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn normal_min_size(window: &Window) -> LogicalSize<f64> {
    let config = window.app_handle().config();
    let main = config.app.windows.first();
    LogicalSize::new(
        main.and_then(|w| w.min_width).unwrap_or(NORMAL_MIN_WIDTH),
        main.and_then(|w| w.min_height).unwrap_or(NORMAL_MIN_HEIGHT),
    )
}

/// Narrows the window into the Zen panel: `remembered` when it is still on a
/// screen, else docked right. Returns what leaving Zen restores.
#[tauri::command]
pub async fn zen_window_enter(
    window: Window,
    remembered: Option<ZenBounds>,
    smooth: bool,
) -> Result<ZenRestore, String> {
    let maximized = window.is_maximized().unwrap_or(false);
    let start = outer_bounds(&window)?;
    let (area, scale) = current_area(&window)?;
    let mut restore = ZenRestore {
        bounds: start,
        maximized,
    };
    if maximized {
        window.unmaximize().map_err(|e| e.to_string())?;
        // The size it restores down to is what leaving Zen brings back if it
        // is not maximized again; the animation starts from the full screen.
        if let Ok(normal) = outer_bounds(&window) {
            restore.bounds = normal;
        }
        place(&window, start)?;
    }
    let target = remembered
        .filter(|bounds| fits_work_area(*bounds, &work_areas(&window)))
        .unwrap_or_else(|| dock_bounds(area, scale));
    window
        .set_min_size(Some(LogicalSize::new(ZEN_MIN_WIDTH, ZEN_MIN_HEIGHT)))
        .map_err(|e| e.to_string())?;
    animate(&window, start, target, smooth).await?;
    Ok(restore)
}

/// Puts the window back as `restore` says (re-maximized when it was) and
/// returns the Zen panel's bounds, for the next time.
#[tauri::command]
pub async fn zen_window_exit(
    window: Window,
    restore: ZenRestore,
    smooth: bool,
) -> Result<ZenBounds, String> {
    let zen = outer_bounds(&window)?;
    let _ = window.set_always_on_top(false);
    let (area, _) = current_area(&window)?;
    let areas = work_areas(&window);
    let target = if restore.maximized {
        area
    } else {
        placed_on_screen(restore.bounds, &areas, area)
    };
    animate(&window, zen, target, smooth).await?;
    window
        .set_min_size(Some(normal_min_size(&window)))
        .map_err(|e| e.to_string())?;
    if restore.maximized {
        window.maximize().map_err(|e| e.to_string())?;
    }
    Ok(zen)
}

/// Keeps the Zen panel above other apps, or lets it go behind them again.
#[tauri::command]
pub fn zen_window_pin(window: Window, on: bool) -> Result<(), String> {
    window.set_always_on_top(on).map_err(|e| e.to_string())
}

/// Widens the Zen panel to at least `min_width` (CSS px) for chats side by
/// side, keeping its right edge. Returns the widths when it grew, so it can
/// narrow back; none when it was wide enough.
#[tauri::command]
pub async fn zen_window_widen(
    window: Window,
    min_width: f64,
    smooth: bool,
) -> Result<Option<ZenWiden>, String> {
    let start = outer_bounds(&window)?;
    let (area, scale) = current_area(&window)?;
    let wanted = (min_width * scale).round() as u32;
    if start.width >= wanted {
        return Ok(None);
    }
    let target = with_width(start, area, wanted);
    if target.width <= start.width {
        return Ok(None);
    }
    animate(&window, start, target, smooth).await?;
    Ok(Some(ZenWiden {
        before: start.width,
        after: target.width,
    }))
}

/// Narrows the panel back after `zen_window_widen`, keeping its right edge,
/// unless the user resized it since. Returns whether it changed.
#[tauri::command]
pub async fn zen_window_narrow(
    window: Window,
    widen: ZenWiden,
    smooth: bool,
) -> Result<bool, String> {
    let start = outer_bounds(&window)?;
    if !still_width(start.width, widen.after) {
        return Ok(false);
    }
    let (area, _) = current_area(&window)?;
    animate(
        &window,
        start,
        with_width(start, area, widen.before),
        smooth,
    )
    .await?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: ZenBounds = ZenBounds {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040,
    };

    #[test]
    fn docks_a_quarter_of_the_screen_on_the_right() {
        assert_eq!(
            dock_bounds(SCREEN, 1.0),
            ZenBounds {
                x: 1440,
                y: 0,
                width: 480,
                height: 1040
            }
        );
    }

    #[test]
    fn docking_never_goes_below_the_minimum_width() {
        let small = ZenBounds {
            x: -1280,
            y: 0,
            width: 1280,
            height: 720,
        };
        let docked = dock_bounds(small, 1.5);
        assert_eq!(docked.width, 540);
        assert_eq!(docked.x, -540);
    }

    #[test]
    fn ease_out_starts_fast_and_lands_on_the_target() {
        assert_eq!(ease_out(0.0), 0.0);
        assert_eq!(ease_out(1.0), 1.0);
        assert!(ease_out(0.25) > 0.5);
        assert_eq!(ease_out(2.0), 1.0);
    }

    #[test]
    fn frames_move_between_the_two_boxes() {
        let to = dock_bounds(SCREEN, 1.0);
        assert_eq!(frame_bounds(SCREEN, to, 0.0), SCREEN);
        assert_eq!(frame_bounds(SCREEN, to, 1.0), to);
        let half = frame_bounds(SCREEN, to, 0.5);
        assert_eq!(half.x, 720);
        assert_eq!(half.width, 1200);
    }

    #[test]
    fn a_box_off_every_screen_does_not_fit() {
        let gone = ZenBounds {
            x: 2400,
            y: 0,
            width: 480,
            height: 1040,
        };
        assert!(!fits_work_area(gone, &[SCREEN]));
        assert!(fits_work_area(dock_bounds(SCREEN, 1.0), &[SCREEN]));
        let half_off = ZenBounds { x: 1700, ..gone };
        assert!(!fits_work_area(half_off, &[SCREEN]));
    }

    #[test]
    fn a_lost_box_is_centred_on_the_current_screen() {
        let gone = ZenBounds {
            x: 4000,
            y: 0,
            width: 2560,
            height: 800,
        };
        assert_eq!(
            placed_on_screen(gone, &[SCREEN], SCREEN),
            ZenBounds {
                x: 0,
                y: 120,
                width: 1920,
                height: 800
            }
        );
        let kept = dock_bounds(SCREEN, 1.0);
        assert_eq!(placed_on_screen(kept, &[SCREEN], SCREEN), kept);
    }

    #[test]
    fn widening_keeps_the_right_edge() {
        let panel = dock_bounds(SCREEN, 1.0);
        assert_eq!(
            with_width(panel, SCREEN, 720),
            ZenBounds {
                x: 1200,
                width: 720,
                ..panel
            }
        );
    }

    #[test]
    fn widening_stays_on_the_screen() {
        let left = ZenBounds {
            x: 100,
            y: 0,
            width: 480,
            height: 1040,
        };
        assert_eq!(with_width(left, SCREEN, 720).x, 0);
        assert_eq!(with_width(left, SCREEN, 4000).width, 1920);
    }

    #[test]
    fn a_resized_panel_is_not_narrowed_back() {
        assert!(still_width(720, 720));
        assert!(still_width(721, 720));
        assert!(!still_width(900, 720));
    }
}
