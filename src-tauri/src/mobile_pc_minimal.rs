//! Fork (Hari, L-318): Minimal mode, from the phone's Control tab.
//!
//! On: Windows power mode goes to Best power efficiency, the apps picked in
//! Settings are asked to close (like clicking their X, so they can ask to
//! save), and the monitor turns off. MonoCode, the network and the phone link
//! stay on. Off: the power mode the user had comes back, the closed apps are
//! opened again (unless they are already running), and the monitor turns on.
//!
//! What was on before is saved with the picked apps, so a MonoCode restart in
//! between can still undo it. Power mode uses Windows' overlay calls in
//! `powrprof.dll` (what the Settings slider uses; not in the SDK headers), so
//! a Windows without them, or a power plan that hides the slider, keeps its
//! mode and Minimal says so.
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::Window;

use super::{check_window, is_protected, monitor_off_marked, native, now_ms, MAX_NAME_CHARS};

const FILE: &str = "phone-minimal.json";
const MAX_APPS: usize = 24;
/// Windows 11's "Best power efficiency" power mode.
const EFFICIENCY: &str = "961cc777-2547-4f9d-8174-7d86181b8a7a";
/// "Balanced", the mode Windows starts with; used when the old one is unknown.
const BALANCED: &str = "00000000-0000-0000-0000-000000000000";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct PickedApp {
    name: String,
    /// The program's file name, e.g. `ms-teams.exe`; matched without case.
    exe: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Active {
    /// The power mode before Minimal, as a GUID; None when it couldn't be read.
    previous_mode: Option<String>,
    /// Full paths of the programs Minimal closed, to open again.
    closed: Vec<String>,
    since: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Saved {
    #[serde(default)]
    apps: Vec<PickedApp>,
    #[serde(default)]
    active: Option<Active>,
}

#[derive(Default)]
struct State {
    path: Option<PathBuf>,
    saved: Saved,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);

fn with<T>(apply: impl FnOnce(&mut State) -> T) -> Result<T, String> {
    let mut guard = STATE.lock().map_err(|_| "Minimal mode unavailable")?;
    Ok(apply(guard.get_or_insert_with(State::default)))
}

/// Loads the picked apps and any Minimal still on from last run.
pub(super) fn init(dir: &Path) -> Result<(), String> {
    let path = dir.join(FILE);
    let saved = std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Saved>(&bytes).ok())
        .map(|mut saved| {
            saved.apps.retain(|app| valid_exe(&app.exe));
            saved
        })
        .unwrap_or_default();
    with(|state| {
        state.path = Some(path);
        state.saved = saved;
    })
}

fn save(state: &State) {
    let Some(path) = state.path.as_ref() else {
        return;
    };
    let Ok(bytes) = serde_json::to_vec_pretty(&state.saved) else {
        return;
    };
    let temp = path.with_extension("json.tmp");
    if std::fs::write(&temp, bytes).is_ok() {
        if let Err(error) = std::fs::rename(&temp, path) {
            eprintln!("monocode: couldn't save Minimal mode: {error}");
        }
    }
}

/// A bare program file name: no folders, ends in `.exe`.
fn valid_exe(exe: &str) -> bool {
    !exe.is_empty()
        && exe.chars().count() <= MAX_NAME_CHARS
        && !exe.contains(['\\', '/', ':'])
        && exe.to_ascii_lowercase().ends_with(".exe")
}

/// Whether Minimal mode is on, for the phone's stats.
pub(super) fn is_on() -> bool {
    with(|state| state.saved.active.is_some()).unwrap_or(false)
}

/// The phone's `pc.minimal`: `{on}` turns it on or off; no `on` reads it.
pub(super) fn phone(params: &Value) -> Result<Value, String> {
    let answer = match params["on"].as_bool() {
        Some(true) => turn_on()?,
        Some(false) => turn_off()?,
        None => json!({}),
    };
    let (on, apps) = with(|state| {
        let names: Vec<String> = state
            .saved
            .apps
            .iter()
            .map(|app| app.name.clone())
            .collect();
        (state.saved.active.is_some(), names)
    })?;
    let mut answer = answer;
    answer["active"] = json!(on);
    answer["apps"] = json!(apps);
    Ok(answer)
}

fn turn_on() -> Result<Value, String> {
    if is_on() {
        return Ok(json!({ "done": true, "note": "Minimal mode is already on" }));
    }
    let picked = with(|state| state.saved.apps.clone())?;
    let previous_mode = power_mode::get();
    let mode_set = power_mode::set(EFFICIENCY);
    let closed = close_picked(&picked);
    with(|state| {
        state.saved.active = Some(Active {
            previous_mode,
            closed: closed.clone(),
            since: now_ms(),
        });
        save(state);
    })?;
    // Answer first: the phone should hear "done" before the screen goes dark.
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_millis(500));
        if let Err(error) = monitor_off_marked() {
            eprintln!("monocode: Minimal mode couldn't turn the monitor off: {error}");
        }
    });
    Ok(json!({ "done": true, "note": on_note(closed.len(), mode_set.is_ok()) }))
}

fn turn_off() -> Result<Value, String> {
    let Some(active) = with(|state| state.saved.active.clone())? else {
        return Ok(json!({ "done": true, "note": "Minimal mode is already off" }));
    };
    let mode = active.previous_mode.as_deref().unwrap_or(BALANCED);
    let mode_set = power_mode::set(mode);
    let running = running_paths();
    let mut reopened = 0;
    let mut failed: Vec<String> = Vec::new();
    for path in reopen_list(&active.closed, &running) {
        match native::launch(Path::new(&path)) {
            Ok(()) => reopened += 1,
            Err(_) => failed.push(program_name(&path)),
        }
    }
    with(|state| {
        state.saved.active = None;
        save(state);
    })?;
    if let Err(error) = native::monitor_on() {
        eprintln!("monocode: Minimal mode couldn't turn the monitor on: {error}");
    }
    Ok(json!({ "done": true, "note": off_note(reopened, &failed, mode_set.is_ok()) }))
}

fn on_note(closed: usize, mode_set: bool) -> String {
    let apps = match closed {
        0 => "no picked apps were open".to_string(),
        1 => "closed 1 app".to_string(),
        n => format!("closed {n} apps"),
    };
    let mode = if mode_set {
        ""
    } else {
        ". Power mode stayed as it was"
    };
    format!("Minimal mode on: {apps}{mode}")
}

fn off_note(reopened: usize, failed: &[String], mode_set: bool) -> String {
    let mut note = match reopened {
        0 => "Minimal mode off".to_string(),
        1 => "Minimal mode off: reopened 1 app".to_string(),
        n => format!("Minimal mode off: reopened {n} apps"),
    };
    if !failed.is_empty() {
        note.push_str(&format!(". Couldn't reopen {}", failed.join(", ")));
    }
    if !mode_set {
        note.push_str(". Power mode stayed as it was");
    }
    note
}

fn program_name(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

/// Closed programs to open again: once each, skipping ones running again.
fn reopen_list(closed: &[String], running: &[String]) -> Vec<String> {
    let mut list: Vec<String> = Vec::new();
    for path in closed {
        let lower = path.to_lowercase();
        if running.iter().any(|run| run.to_lowercase() == lower)
            || list.iter().any(|seen| seen.to_lowercase() == lower)
        {
            continue;
        }
        list.push(path.clone());
    }
    list
}

fn picked_matches(picked: &[PickedApp], name: &str) -> bool {
    picked.iter().any(|app| app.exe.eq_ignore_ascii_case(name))
}

/// Asks every window of a picked app to close; returns their program paths.
fn close_picked(picked: &[PickedApp]) -> Vec<String> {
    if picked.is_empty() {
        return Vec::new();
    }
    let Ok(samples) = crate::process_metrics::snapshot() else {
        return Vec::new();
    };
    let own = std::process::id();
    let mut closed: Vec<String> = Vec::new();
    for window in native::top_windows() {
        if window.pid == own {
            continue;
        }
        let Some(sample) = samples.iter().find(|sample| sample.pid == window.pid) else {
            continue;
        };
        if is_protected(&sample.name) || !picked_matches(picked, &sample.name) {
            continue;
        }
        native::close_window(window.handle);
        if let Some(path) = native::image_path(window.pid) {
            let path = path.to_string_lossy().into_owned();
            if !closed.contains(&path) {
                closed.push(path);
            }
        }
    }
    closed
}

/// Program paths of the apps with a window open now.
fn running_paths() -> Vec<String> {
    let mut paths: Vec<String> = Vec::new();
    for window in native::top_windows() {
        if let Some(path) = native::image_path(window.pid) {
            let path = path.to_string_lossy().into_owned();
            if !paths.contains(&path) {
                paths.push(path);
            }
        }
    }
    paths
}

// ── Settings ─────────────────────────────────────────────────────────────

fn rows(state: &State) -> Value {
    let picked: Vec<Value> = state
        .saved
        .apps
        .iter()
        .map(|app| json!({ "name": app.name, "exe": app.exe }))
        .collect();
    json!({ "apps": picked, "active": state.saved.active.is_some() })
}

/// Apps with a window open that could be picked (not MonoCode, not Windows).
fn running_choices(picked: &[PickedApp]) -> Vec<Value> {
    let Ok(samples) = crate::process_metrics::snapshot() else {
        return Vec::new();
    };
    let own = std::process::id();
    let mut seen: Vec<String> = Vec::new();
    let mut choices = Vec::new();
    for window in native::top_windows() {
        if window.pid == own {
            continue;
        }
        let Some(sample) = samples.iter().find(|sample| sample.pid == window.pid) else {
            continue;
        };
        let exe = sample.name.clone();
        let lower = exe.to_lowercase();
        if !valid_exe(&exe)
            || is_protected(&exe)
            || picked_matches(picked, &exe)
            || seen.contains(&lower)
        {
            continue;
        }
        seen.push(lower);
        choices.push(json!({ "name": program_name(&exe), "exe": exe, "title": window.title }));
    }
    choices
}

#[tauri::command]
pub fn mobile_pc_minimal_list(window: Window) -> Result<Value, String> {
    check_window(&window)?;
    let (mut answer, picked) = with(|state| (rows(state), state.saved.apps.clone()))?;
    answer["running"] = json!(running_choices(&picked));
    Ok(answer)
}

#[tauri::command]
pub fn mobile_pc_minimal_add(window: Window, exe: String, name: String) -> Result<Value, String> {
    check_window(&window)?;
    if !valid_exe(&exe) || exe.eq_ignore_ascii_case("monocode.exe") {
        return Err("Choose an app with a window open".into());
    }
    let name: String = name.trim().chars().take(MAX_NAME_CHARS).collect();
    let name = if name.is_empty() {
        program_name(&exe)
    } else {
        name
    };
    with(|state| {
        if state.saved.apps.len() >= MAX_APPS {
            return Err(format!("Minimal mode closes at most {MAX_APPS} apps"));
        }
        if picked_matches(&state.saved.apps, &exe) {
            return Err("That app is already in the list".into());
        }
        state.saved.apps.push(PickedApp { name, exe });
        save(state);
        Ok(rows(state))
    })?
}

#[tauri::command]
pub fn mobile_pc_minimal_remove(window: Window, exe: String) -> Result<Value, String> {
    check_window(&window)?;
    with(|state| {
        state
            .saved
            .apps
            .retain(|app| !app.exe.eq_ignore_ascii_case(&exe));
        save(state);
        rows(state)
    })
}

// ── Power mode ───────────────────────────────────────────────────────────

/// A GUID's four fields, as Windows lays them out.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
#[repr(C)]
struct Guid {
    data1: u32,
    data2: u16,
    data3: u16,
    data4: [u8; 8],
}

fn parse_guid(text: &str) -> Option<Guid> {
    let parts: Vec<&str> = text.trim().trim_matches(['{', '}']).split('-').collect();
    let [a, b, c, d, e] = parts.as_slice() else {
        return None;
    };
    if a.len() != 8 || b.len() != 4 || c.len() != 4 || d.len() != 4 || e.len() != 12 {
        return None;
    }
    let tail = format!("{d}{e}");
    let mut data4 = [0u8; 8];
    for (index, byte) in data4.iter_mut().enumerate() {
        *byte = u8::from_str_radix(tail.get(index * 2..index * 2 + 2)?, 16).ok()?;
    }
    Some(Guid {
        data1: u32::from_str_radix(a, 16).ok()?,
        data2: u16::from_str_radix(b, 16).ok()?,
        data3: u16::from_str_radix(c, 16).ok()?,
        data4,
    })
}

fn format_guid(guid: &Guid) -> String {
    let d = guid.data4;
    format!(
        "{:08x}-{:04x}-{:04x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        guid.data1, guid.data2, guid.data3, d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7]
    )
}

#[cfg(windows)]
mod power_mode {
    use super::{format_guid, parse_guid, Guid};
    use windows_sys::Win32::System::LibraryLoader::{
        GetProcAddress, LoadLibraryExW, LOAD_LIBRARY_SEARCH_SYSTEM32,
    };

    type GetOverlay = unsafe extern "system" fn(*mut Guid) -> u32;
    type SetOverlay = unsafe extern "system" fn(Guid) -> u32;

    /// Looks `name` up in System32's powrprof.dll (never a copy elsewhere).
    fn function(name: &[u8]) -> Option<unsafe extern "system" fn() -> isize> {
        let library: Vec<u16> = "powrprof.dll\0".encode_utf16().collect();
        // SAFETY: both strings are NUL-terminated; the module stays loaded
        // for the process (powrprof is a system DLL; never freed here).
        unsafe {
            let module = LoadLibraryExW(
                library.as_ptr(),
                std::ptr::null_mut(),
                LOAD_LIBRARY_SEARCH_SYSTEM32,
            );
            if module.is_null() {
                return None;
            }
            GetProcAddress(module, name.as_ptr())
        }
    }

    /// The power mode the user chose (Settings → Power), as a GUID.
    pub fn get() -> Option<String> {
        let found = function(b"PowerGetActualOverlayScheme\0")?;
        // SAFETY: PowerGetActualOverlayScheme(GUID*) -> DWORD is the
        // documented-by-use signature of this export.
        let get: GetOverlay = unsafe { std::mem::transmute(found) };
        let mut guid = Guid::default();
        // SAFETY: `guid` is a valid, writable GUID for the call.
        (unsafe { get(&mut guid) } == 0).then(|| format_guid(&guid))
    }

    pub fn set(mode: &str) -> Result<(), String> {
        let guid = parse_guid(mode).ok_or("Unknown power mode")?;
        let found =
            function(b"PowerSetActiveOverlayScheme\0").ok_or("This Windows has no power modes")?;
        // SAFETY: PowerSetActiveOverlayScheme(GUID) -> DWORD, GUID by value.
        let set: SetOverlay = unsafe { std::mem::transmute(found) };
        // SAFETY: plain value argument.
        match unsafe { set(guid) } {
            0 => Ok(()),
            code => Err(format!("Windows refused the power mode ({code})")),
        }
    }
}

#[cfg(not(windows))]
mod power_mode {
    pub fn get() -> Option<String> {
        None
    }
    pub fn set(_mode: &str) -> Result<(), String> {
        Err("This works on Windows only".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guids_round_trip() {
        let guid = parse_guid(EFFICIENCY).expect("parses");
        assert_eq!(guid.data1, 0x961cc777);
        assert_eq!(guid.data4, [0x81, 0x74, 0x7d, 0x86, 0x18, 0x1b, 0x8a, 0x7a]);
        assert_eq!(format_guid(&guid), EFFICIENCY);
        assert_eq!(
            parse_guid(&format!("{{{}}}", BALANCED.to_uppercase())),
            Some(Guid::default())
        );
        assert_eq!(parse_guid("961cc777-2547-4f9d-8174"), None);
        assert_eq!(parse_guid("zzzzzzzz-2547-4f9d-8174-7d86181b8a7a"), None);
    }

    /// Reads (never sets) this computer's power mode: `--ignored` to run.
    #[test]
    #[ignore]
    #[cfg(windows)]
    fn reads_the_power_mode_here() {
        let mode = power_mode::get().expect("powrprof answers");
        assert!(parse_guid(&mode).is_some(), "{mode}");
    }

    #[test]
    fn picks_only_bare_programs() {
        assert!(valid_exe("ms-teams.exe"));
        assert!(valid_exe("Spotify.EXE"));
        assert!(!valid_exe("C:\\Apps\\x.exe"));
        assert!(!valid_exe("notes.txt"));
        assert!(!valid_exe(""));
    }

    #[test]
    fn reopens_each_closed_app_once_and_not_running_ones() {
        let closed = vec![
            "C:\\A\\Teams.exe".to_string(),
            "C:\\a\\teams.exe".to_string(),
            "C:\\B\\Spotify.exe".to_string(),
        ];
        let running = vec!["c:\\b\\spotify.exe".to_string()];
        assert_eq!(
            reopen_list(&closed, &running),
            vec!["C:\\A\\Teams.exe".to_string()]
        );
    }

    #[test]
    fn saved_state_survives_a_restart() {
        let saved = Saved {
            apps: vec![PickedApp {
                name: "Teams".into(),
                exe: "ms-teams.exe".into(),
            }],
            active: Some(Active {
                previous_mode: Some(BALANCED.into()),
                closed: vec!["C:\\Teams\\ms-teams.exe".into()],
                since: 5,
            }),
        };
        let text = serde_json::to_string(&saved).expect("serializes");
        assert!(text.contains("previousMode"));
        assert_eq!(serde_json::from_str::<Saved>(&text).expect("parses"), saved);
        assert_eq!(
            serde_json::from_str::<Saved>("{}").expect("parses"),
            Saved::default()
        );
    }

    #[test]
    fn notes_say_what_happened() {
        assert_eq!(on_note(2, true), "Minimal mode on: closed 2 apps");
        assert_eq!(
            on_note(0, false),
            "Minimal mode on: no picked apps were open. Power mode stayed as it was"
        );
        assert_eq!(
            off_note(1, &["Teams".into()], true),
            "Minimal mode off: reopened 1 app. Couldn't reopen Teams"
        );
    }
}
