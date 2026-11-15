//! Fork (Hari, L-307): extra dimming of the computer's screens from the
//! phone's Control tab (`pc.dim`), on top of the monitors' own brightness.
//!
//! A black window covers each monitor above other windows; how see-through it
//! is sets the dimming. Clicks go through it, it never takes focus, and it is
//! left out of screenshots and screen sharing. Nothing is saved: the screens
//! are back to normal when MonoCode quits. Capped at [`MAX_LEVEL`] so the
//! screen stays readable if the phone goes away.

use serde_json::{json, Value};

/// The most the screens can be dimmed, in percent.
pub const MAX_LEVEL: u8 = 80;

/// `pc.dim`: `{level}` (0 to [`MAX_LEVEL`]) sets the dimming; `{}` reads it.
pub(crate) fn dim(params: &Value) -> Result<Value, String> {
    if let Some(level) = params["level"].as_f64() {
        if !level.is_finite() {
            return Err("Dimming needs a number".into());
        }
        native::set(level.round().clamp(0.0, f64::from(MAX_LEVEL)) as u8)?;
    }
    Ok(json!({ "level": native::level(), "max": MAX_LEVEL }))
}

#[cfg(windows)]
mod native {
    use std::ptr::{null, null_mut};
    use std::sync::atomic::{AtomicU8, Ordering};
    use std::sync::{mpsc, Mutex};

    use windows_sys::core::BOOL;
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows_sys::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, GetStockObject, BLACK_BRUSH, HDC, HMONITOR,
        MONITORINFO,
    };
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
        PeekMessageW, PostThreadMessageW, RegisterClassW, SetLayeredWindowAttributes, SetTimer,
        SetWindowDisplayAffinity, SetWindowPos, ShowWindow, TranslateMessage, HTTRANSPARENT,
        HWND_TOPMOST, LWA_ALPHA, MA_NOACTIVATE, MSG, PM_NOREMOVE, SWP_NOACTIVATE, SWP_NOMOVE,
        SWP_NOOWNERZORDER, SWP_NOSIZE, SW_SHOWNOACTIVATE, WDA_EXCLUDEFROMCAPTURE, WM_APP,
        WM_DISPLAYCHANGE, WM_MOUSEACTIVATE, WM_NCHITTEST, WM_TIMER, WM_USER, WNDCLASSW,
        WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT,
        WS_POPUP,
    };

    static LEVEL: AtomicU8 = AtomicU8::new(0);
    /// The dimming thread's id once it runs; 0 before.
    static THREAD: Mutex<u32> = Mutex::new(0);
    /// Apply [`LEVEL`].
    const WM_DIM: u32 = WM_APP + 1;
    /// The monitors changed: cover them again.
    const WM_REBUILD: u32 = WM_APP + 2;
    /// The taskbar and other always-on-top windows can come above the cover
    /// when clicked; it goes back on top this often.
    const ON_TOP_EVERY_MS: u32 = 2_000;

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn level() -> u8 {
        LEVEL.load(Ordering::SeqCst)
    }

    pub fn set(level: u8) -> Result<(), String> {
        LEVEL.store(level, Ordering::SeqCst);
        let mut thread = THREAD.lock().map_err(|_| "Dimming isn't available")?;
        if *thread == 0 {
            if level == 0 {
                return Ok(());
            }
            let (ready, started) = mpsc::channel();
            std::thread::Builder::new()
                .name("screen-dim".into())
                .spawn(move || run(ready))
                .map_err(|error| format!("Couldn't start dimming: {error}"))?;
            *thread = started
                .recv()
                .map_err(|_| "Couldn't start dimming".to_string())?;
        }
        // SAFETY: the thread has a message queue (made before it said ready).
        let posted = unsafe { PostThreadMessageW(*thread, WM_DIM, 0, 0) };
        if posted == 0 {
            return Err("Couldn't change the dimming".into());
        }
        Ok(())
    }

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match message {
            WM_DISPLAYCHANGE => {
                // SAFETY: posting to this thread's own queue.
                unsafe { PostThreadMessageW(GetCurrentThreadId(), WM_REBUILD, 0, 0) };
                0
            }
            WM_NCHITTEST => HTTRANSPARENT as LRESULT,
            WM_MOUSEACTIVATE => MA_NOACTIVATE as LRESULT,
            // SAFETY: the default handling for this window's own message.
            _ => unsafe { DefWindowProcW(hwnd, message, wparam, lparam) },
        }
    }

    unsafe extern "system" fn add_monitor(
        monitor: HMONITOR,
        _dc: HDC,
        _clip: *mut RECT,
        data: LPARAM,
    ) -> BOOL {
        // SAFETY: `data` is the `Vec<RECT>` `monitors` passed in.
        let rects = unsafe { &mut *(data as *mut Vec<RECT>) };
        // SAFETY: MONITORINFO is plain data; zero is a valid start.
        let mut info: MONITORINFO = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        // SAFETY: a monitor handle from the enumeration and a sized struct.
        if unsafe { GetMonitorInfoW(monitor, &mut info) } != 0 {
            rects.push(info.rcMonitor);
        }
        1
    }

    fn monitors() -> Vec<RECT> {
        let mut rects: Vec<RECT> = Vec::new();
        // SAFETY: the callback only runs during this call, while `rects` lives.
        unsafe {
            EnumDisplayMonitors(
                null_mut(),
                null(),
                Some(add_monitor),
                &mut rects as *mut Vec<RECT> as LPARAM,
            )
        };
        rects
    }

    struct Covers {
        class: Vec<u16>,
        windows: Vec<HWND>,
    }

    impl Covers {
        fn alpha() -> u8 {
            (u32::from(level()) * 255 / 100) as u8
        }

        fn clear(&mut self) {
            for hwnd in self.windows.drain(..) {
                // SAFETY: windows this thread made.
                unsafe { DestroyWindow(hwnd) };
            }
        }

        fn cover(&mut self) {
            // SAFETY: plain Win32 calls with this thread's own class and windows.
            unsafe {
                let instance = GetModuleHandleW(null());
                for rect in monitors() {
                    let hwnd = CreateWindowExW(
                        WS_EX_LAYERED
                            | WS_EX_TRANSPARENT
                            | WS_EX_TOPMOST
                            | WS_EX_TOOLWINDOW
                            | WS_EX_NOACTIVATE,
                        self.class.as_ptr(),
                        self.class.as_ptr(),
                        WS_POPUP,
                        rect.left,
                        rect.top,
                        rect.right - rect.left,
                        rect.bottom - rect.top,
                        null_mut(),
                        null_mut(),
                        instance,
                        null(),
                    );
                    if hwnd.is_null() {
                        continue;
                    }
                    // Screenshots and screen sharing see the screen undimmed.
                    SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
                    SetLayeredWindowAttributes(hwnd, 0, Self::alpha(), LWA_ALPHA);
                    ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                    self.windows.push(hwnd);
                }
            }
        }

        fn apply(&mut self) {
            if level() == 0 {
                self.clear();
                return;
            }
            if self.windows.is_empty() {
                self.cover();
                return;
            }
            for hwnd in &self.windows {
                // SAFETY: a layered window this thread made.
                unsafe { SetLayeredWindowAttributes(*hwnd, 0, Self::alpha(), LWA_ALPHA) };
            }
        }

        fn rebuild(&mut self) {
            self.clear();
            self.apply();
        }

        fn on_top(&self) {
            for hwnd in &self.windows {
                // SAFETY: a window this thread made; no move, size or focus.
                unsafe {
                    SetWindowPos(
                        *hwnd,
                        HWND_TOPMOST,
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
                    )
                };
            }
        }
    }

    fn run(ready: mpsc::Sender<u32>) {
        // SAFETY: Win32 calls on this thread with valid pointers; the class
        // name outlives every window made with it.
        unsafe {
            let mut message: MSG = std::mem::zeroed();
            // Make this thread's message queue before anyone posts to it.
            PeekMessageW(&mut message, null_mut(), WM_USER, WM_USER, PM_NOREMOVE);
            let class = wide("MonoCodeScreenDim");
            let window_class = WNDCLASSW {
                style: 0,
                lpfnWndProc: Some(window_proc),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: GetModuleHandleW(null()),
                hIcon: null_mut(),
                hCursor: null_mut(),
                hbrBackground: GetStockObject(BLACK_BRUSH),
                lpszMenuName: null(),
                lpszClassName: class.as_ptr(),
            };
            RegisterClassW(&window_class);
            SetTimer(null_mut(), 0, ON_TOP_EVERY_MS, None);
            let mut covers = Covers {
                class,
                windows: Vec::new(),
            };
            let _ = ready.send(GetCurrentThreadId());
            while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {
                if message.hwnd.is_null() {
                    match message.message {
                        WM_DIM => covers.apply(),
                        WM_REBUILD => covers.rebuild(),
                        WM_TIMER => covers.on_top(),
                        _ => {}
                    }
                    continue;
                }
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
    }
}

#[cfg(not(windows))]
mod native {
    pub fn level() -> u8 {
        0
    }
    pub fn set(_level: u8) -> Result<(), String> {
        Err("Only on Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reading_changes_nothing() {
        let answer = dim(&json!({})).unwrap();
        assert_eq!(answer["max"], MAX_LEVEL);
    }

    #[test]
    fn a_level_that_is_not_a_number_is_ignored() {
        assert!(dim(&json!({ "level": "dark" })).is_ok());
    }
}
