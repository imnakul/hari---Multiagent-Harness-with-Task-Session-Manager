//! Fork (Hari, L-280): the phone's Computer screen, and the phone on the desktop.
//!
//! - **Phone → computer** requests: stats (`pc.stats`), apps with a window
//!   (`pc.apps`) and Close/End/Minimize/Maximize on one (`pc.app`), power
//!   (`pc.power`: monitor off, lock, hibernate), a screenshot offered through
//!   Share (`pc.screenshot`), the chosen apps (`pc.shortcuts`, `pc.shortcut`),
//!   the network cards Wake-on-LAN needs (`pc.wakeInfo`), and the phone's own
//!   stats (`phone.stats`).
//! - **Computer → phone** items on the stream: `stats.want {until}` (send your
//!   stats until then) and `ring {action, at}` (Find my phone).
//!
//! Anything that changes the computer carries `sentAt` and is refused when it
//! is more than [`STALE_MS`] off this clock, as the Telegram bot refuses old
//! commands. Apps are matched by pid and start time, never by pid alone.
//! Nothing here samples in the background: stats are read when asked.
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, Window};

const METHODS: [&str; 9] = [
    "pc.stats",
    "pc.apps",
    "pc.app",
    "pc.power",
    "pc.screenshot",
    "pc.shortcuts",
    "pc.shortcut",
    "pc.wakeInfo",
    "phone.stats",
];
/// How far a command's `sentAt` may be from this clock (either way).
const STALE_MS: u64 = 60_000;
const SHORTCUTS_FILE: &str = "phone-apps.json";
const MAX_SHORTCUTS: usize = 24;
const MAX_NAME_CHARS: usize = 60;
/// Restart waits this long for the app's windows to close.
const RESTART_WAIT: Duration = Duration::from_secs(15);
/// A phone sends its stats this long after the desktop last asked.
const PHONE_STATS_FOR_MS: u64 = 60_000;
const PHONE_STATS_EVENT: &str = "monocode-phone-stats";
/// Screenshots older than this are removed from the app's cache.
const SCREENSHOT_KEEP: Duration = Duration::from_secs(7 * 24 * 60 * 60);
/// Windows' own processes that End refuses (stopping them breaks the session).
const PROTECTED: [&str; 8] = [
    "explorer.exe",
    "dwm.exe",
    "csrss.exe",
    "winlogon.exe",
    "svchost.exe",
    "lsass.exe",
    "services.exe",
    "smss.exe",
];

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Target {
    /// This app (Hari / MonoCode) itself.
    #[serde(rename = "self")]
    Myself,
    /// A Microsoft Store app, found by package name; `exe` is inside it.
    Store { package: String, exe: String },
    /// A program at a fixed path.
    Path { path: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct Shortcut {
    id: String,
    name: String,
    #[serde(flatten)]
    target: Target,
}

#[derive(Default)]
struct Pc {
    path: Option<PathBuf>,
    shortcuts: Vec<Shortcut>,
    /// Store package → its install folder, found once per run.
    packages: HashMap<String, PathBuf>,
    last_cpu: Option<(u64, u64)>,
    last_network: Option<(Instant, u64, u64)>,
    cpu: crate::process_metrics::CpuHistory,
    gpu: crate::process_gpu::GpuSampler,
    /// Latest stats per phone: (received at, stats).
    phones: HashMap<String, (u64, Value)>,
}

static PC: Mutex<Option<Pc>> = Mutex::new(None);

fn with<T>(apply: impl FnOnce(&mut Pc) -> T) -> Result<T, String> {
    let mut guard = PC.lock().map_err(|_| "Computer controls unavailable")?;
    Ok(apply(guard.get_or_insert_with(Pc::default)))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

fn default_shortcuts() -> Vec<Shortcut> {
    let mut list = vec![
        Shortcut {
            id: "hari".into(),
            name: "Hari".into(),
            target: Target::Myself,
        },
        Shortcut {
            id: "claude".into(),
            name: "Claude".into(),
            target: Target::Store {
                package: "Claude".into(),
                exe: "app\\claude.exe".into(),
            },
        },
        Shortcut {
            id: "chatgpt".into(),
            name: "ChatGPT".into(),
            target: Target::Store {
                package: "OpenAI.Codex".into(),
                exe: "app\\ChatGPT.exe".into(),
            },
        },
    ];
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let antigravity = Path::new(&local)
            .join("Programs")
            .join("antigravity")
            .join("Antigravity.exe");
        if antigravity.is_file() {
            list.push(Shortcut {
                id: "antigravity".into(),
                name: "Antigravity".into(),
                target: Target::Path {
                    path: antigravity.to_string_lossy().into(),
                },
            });
        }
    }
    list
}

/// Loads the chosen apps; a missing or unreadable file uses the defaults.
pub fn init(app: &AppHandle) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(SHORTCUTS_FILE);
    let shortcuts = std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Vec<Shortcut>>(&bytes).ok())
        .map(|list| list.into_iter().filter(valid_shortcut).collect())
        .unwrap_or_else(default_shortcuts);
    with(|pc| {
        pc.path = Some(path);
        pc.shortcuts = shortcuts;
    })
}

fn save(pc: &Pc) {
    let Some(path) = pc.path.as_ref() else {
        return;
    };
    let Ok(bytes) = serde_json::to_vec_pretty(&pc.shortcuts) else {
        return;
    };
    let temp = path.with_extension("json.tmp");
    if std::fs::write(&temp, bytes).is_ok() {
        if let Err(error) = std::fs::rename(&temp, path) {
            eprintln!("monocode: couldn't save the phone's apps: {error}");
        }
    }
}

/// A Store package name or a path inside it can't reach outside the app or
/// carry anything a PowerShell string would read as code.
fn valid_shortcut(shortcut: &Shortcut) -> bool {
    if shortcut.id.is_empty() || shortcut.name.trim().is_empty() {
        return false;
    }
    match &shortcut.target {
        Target::Myself => true,
        Target::Store { package, exe } => {
            !package.is_empty()
                && package
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
                && !exe.is_empty()
                && !exe.contains("..")
                && !exe.contains(':')
                && exe.to_ascii_lowercase().ends_with(".exe")
        }
        Target::Path { path } => {
            let path = Path::new(path);
            path.is_absolute()
                && path
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
        }
    }
}

/// Checks a command's `sentAt` against this clock.
fn fresh(params: &Value, now: u64) -> Result<(), String> {
    let sent = params["sentAt"]
        .as_u64()
        .ok_or("This command has no time; update Hari on the phone")?;
    if now.abs_diff(sent) > STALE_MS {
        return Err("This command is too old, so it wasn't run. Try again.".into());
    }
    Ok(())
}

pub(crate) fn handles(method: &str) -> bool {
    METHODS.contains(&method)
}

/// Runs one request from a paired phone, off the async threads.
pub(crate) async fn handle(
    app: &AppHandle,
    peer: &str,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let app = app.clone();
    let peer = peer.to_string();
    let method = method.to_string();
    tauri::async_runtime::spawn_blocking(move || run(&app, &peer, &method, &params))
        .await
        .map_err(|_| "The computer couldn't do that".to_string())?
}

fn run(app: &AppHandle, peer: &str, method: &str, params: &Value) -> Result<Value, String> {
    match method {
        "pc.stats" => stats(),
        "pc.apps" => apps(),
        "pc.app" => {
            fresh(params, now_ms())?;
            app_action(params)
        }
        "pc.power" => {
            fresh(params, now_ms())?;
            power(params["action"].as_str().unwrap_or_default())
        }
        "pc.screenshot" => screenshot(app, peer),
        "pc.shortcuts" => shortcut_list(),
        "pc.shortcut" => {
            fresh(params, now_ms())?;
            shortcut_action(app, params)
        }
        "pc.wakeInfo" => Ok(json!({ "cards": native::wake_cards() })),
        "phone.stats" => phone_stats(app, peer, params),
        _ => Err("Unsupported mobile operation".into()),
    }
}

// ── Stats ────────────────────────────────────────────────────────────────

fn cpus() -> usize {
    std::thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(1)
}

/// CPU % between two (idle, total) readings.
fn cpu_percent(previous: (u64, u64), current: (u64, u64)) -> Option<f64> {
    let idle = current.0.checked_sub(previous.0)?;
    let total = current.1.checked_sub(previous.1)?;
    (total > 0).then(|| ((total - idle.min(total)) as f64 / total as f64 * 100.0).clamp(0.0, 100.0))
}

/// Bytes per second between two network readings.
fn rate(previous: u64, current: u64, seconds: f64) -> Option<f64> {
    (seconds > 0.0 && current >= previous).then(|| (current - previous) as f64 / seconds)
}

fn stats() -> Result<Value, String> {
    // A first request (or one after a long gap) has nothing to compare with:
    // take a reading, wait a moment, and read again.
    let stale = with(|pc| {
        pc.last_network
            .is_none_or(|(at, _, _)| at.elapsed() > Duration::from_secs(30))
    })?;
    if stale {
        let cpu = native::cpu_times();
        let network = native::network_bytes();
        with(|pc| {
            pc.last_cpu = cpu;
            pc.last_network = network.map(|(down, up)| (Instant::now(), down, up));
            let _ = pc.gpu.sample();
        })?;
        std::thread::sleep(Duration::from_millis(400));
    }
    let cpu_now = native::cpu_times();
    let network_now = native::network_bytes();
    let pids: Vec<u32> = crate::process_metrics::snapshot()
        .map(|samples| samples.iter().map(|sample| sample.pid).collect())
        .unwrap_or_default();
    let (cpu, network, gpu) = with(|pc| {
        let cpu = match (pc.last_cpu, cpu_now) {
            (Some(previous), Some(current)) => cpu_percent(previous, current),
            _ => None,
        };
        pc.last_cpu = cpu_now.or(pc.last_cpu);
        let now = Instant::now();
        let network = match (pc.last_network, network_now) {
            (Some((at, down, up)), Some((down_now, up_now))) => {
                let seconds = now.saturating_duration_since(at).as_secs_f64();
                Some(json!({
                    "down": rate(down, down_now, seconds),
                    "up": rate(up, up_now, seconds),
                }))
            }
            _ => None,
        };
        if let Some((down, up)) = network_now {
            pc.last_network = Some((now, down, up));
        }
        let gpu = pc.gpu.sample().map(|by_pid| {
            pids.iter()
                .filter_map(|pid| by_pid.get(pid))
                .sum::<f64>()
                .min(100.0)
        });
        (cpu, network, gpu)
    })?;
    Ok(json!({
        "cpu": cpu,
        "gpu": gpu,
        "memory": native::memory().map(|(used, total)| json!({ "used": used, "total": total })),
        "disks": native::disks()
            .into_iter()
            .map(|(name, free, total)| json!({ "name": name, "free": free, "total": total }))
            .collect::<Vec<_>>(),
        "network": network,
        "uptime": native::uptime_seconds(),
        // Fork (L-288): the phone shows Monitor on in place of Monitor off.
        "monitorOff": monitor_off_now(),
    }))
}

// ── Running apps ─────────────────────────────────────────────────────────

fn apps() -> Result<Value, String> {
    let windows = native::top_windows();
    let mut roots: Vec<u32> = Vec::new();
    let mut titles: HashMap<u32, (String, usize)> = HashMap::new();
    for window in &windows {
        let entry = titles.entry(window.pid).or_insert_with(|| {
            roots.push(window.pid);
            (window.title.clone(), 0)
        });
        entry.1 += 1;
    }
    let samples = crate::process_metrics::owned_snapshot(&roots)?;
    let trees = crate::process_metrics::tree(&roots, &samples);
    let cpu = with(|pc| pc.cpu.sample(&samples, Instant::now(), cpus()))?;
    let own = std::process::id();
    let rows: Vec<Value> = roots
        .iter()
        .filter_map(|pid| {
            let sample = samples.iter().find(|sample| sample.pid == *pid)?;
            let ids = trees.get(pid).cloned().unwrap_or_default();
            let mut cpu_total = None;
            let mut memory = 0u64;
            for id in &ids {
                if let Some(Some(value)) = cpu.get(id) {
                    cpu_total = Some(cpu_total.unwrap_or(0.0) + value);
                }
                if let Some(bytes) = samples
                    .iter()
                    .find(|sample| sample.pid == *id)
                    .and_then(|sample| sample.memory)
                {
                    memory += bytes;
                }
            }
            let (title, count) = titles.get(pid).cloned().unwrap_or_default();
            Some(json!({
                "pid": pid,
                "identity": crate::process_metrics::sample_identity(sample),
                "name": sample.name,
                "title": title,
                "cpu": cpu_total.map(|value: f64| value.min(100.0)),
                "memory": memory,
                "windows": count,
                "self": *pid == own,
                "protected": is_protected(&sample.name),
            }))
        })
        .collect();
    Ok(json!({ "apps": rows }))
}

fn is_protected(name: &str) -> bool {
    PROTECTED
        .iter()
        .any(|protected| protected.eq_ignore_ascii_case(name))
}

fn app_action(params: &Value) -> Result<Value, String> {
    let pid = params["pid"]
        .as_u64()
        .and_then(|pid| u32::try_from(pid).ok())
        .ok_or("Missing app")?;
    let identity = params["identity"].as_str().ok_or("Missing app")?;
    if pid <= 4 {
        return Err("That's part of Windows".into());
    }
    if crate::process_metrics::identity(pid).as_deref() != Some(identity) {
        return Err("This app closed or changed; refresh the list".into());
    }
    let own = pid == std::process::id();
    match params["action"].as_str() {
        Some("close") => {
            if own {
                return Err("Hari can't close itself from the phone; use Restart".into());
            }
            close_windows(pid)
        }
        Some("end") => {
            if own {
                return Err("Hari can't end itself from the phone; use Restart".into());
            }
            end_tree(pid, identity)
        }
        Some("minimize") => show_windows(&[pid], native::Show::Minimize),
        Some("maximize") => show_windows(&[pid], native::Show::Maximize),
        _ => Err("Unsupported action".into()),
    }
}

fn close_windows(pid: u32) -> Result<Value, String> {
    let windows: Vec<_> = native::top_windows()
        .into_iter()
        .filter(|window| window.pid == pid)
        .collect();
    if windows.is_empty() {
        return Err("It has no window open".into());
    }
    for window in &windows {
        native::close_window(window.handle);
    }
    Ok(json!({ "done": true }))
}

fn show_windows(pids: &[u32], show: native::Show) -> Result<Value, String> {
    let windows: Vec<_> = native::top_windows()
        .into_iter()
        .filter(|window| pids.contains(&window.pid))
        .collect();
    if windows.is_empty() {
        return Err("It has no window open".into());
    }
    for window in &windows {
        native::show_window(window.handle, show);
    }
    Ok(json!({ "done": true }))
}

/// Ends the app and every process it started, children first.
fn end_tree(pid: u32, identity: &str) -> Result<Value, String> {
    let samples = crate::process_metrics::snapshot()?;
    if let Some(sample) = samples.iter().find(|sample| sample.pid == pid) {
        if is_protected(&sample.name) {
            return Err("That's part of Windows; use Close instead".into());
        }
    }
    let own = std::process::id();
    let ids = crate::process_metrics::tree(&[pid], &samples)
        .remove(&pid)
        .unwrap_or_default();
    // Children before the app, each checked by its own start time.
    let mut first_error = None;
    for child in ids.iter().filter(|id| **id != pid && **id != own).rev() {
        if let Some(child_identity) = crate::process_metrics::identity(*child) {
            if let Err(error) = crate::process_stop::signal_verified(*child, &child_identity, true)
            {
                first_error.get_or_insert(error);
            }
        }
    }
    crate::process_stop::signal_verified(pid, identity, true)?;
    match first_error {
        None => Ok(json!({ "done": true })),
        Some(error) => Ok(json!({ "done": true, "note": format!("Some helpers stayed: {error}") })),
    }
}

// ── Power ────────────────────────────────────────────────────────────────

/// Answers first, then acts half a second later, so the phone hears "done"
/// before the screen goes dark or the computer sleeps.
fn power(action: &str) -> Result<Value, String> {
    let act: fn() -> Result<(), String> = match action {
        "monitorOff" => monitor_off_marked,
        "monitorOn" => native::monitor_on,
        "lock" => native::lock,
        "hibernate" => native::hibernate,
        _ => return Err("Unsupported action".into()),
    };
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(500));
        if let Err(error) = act() {
            eprintln!("monocode: phone power action failed: {error}");
        }
    });
    Ok(json!({ "done": true }))
}

/// Fork (L-288): turns the monitor off, then notes the last input at that
/// moment, so stats can tell the phone the monitor is still off until someone
/// touches the mouse or keyboard (or the phone turns it on).
fn monitor_off_marked() -> Result<(), String> {
    native::monitor_off()?;
    std::thread::sleep(Duration::from_millis(300));
    if let Some(tick) = native::last_input_tick() {
        MONITOR_OFF_INPUT.store(u64::from(tick) | MONITOR_OFF_SET, Ordering::Relaxed);
    }
    Ok(())
}

/// The last-input tick when the phone turned the monitor off, with a high bit
/// to say it is set; zero when the monitor isn't known to be off.
static MONITOR_OFF_INPUT: AtomicU64 = AtomicU64::new(0);
const MONITOR_OFF_SET: u64 = 1 << 63;

/// Whether the monitor is off from the phone with no input since.
fn monitor_off_now() -> bool {
    let marked = MONITOR_OFF_INPUT.load(Ordering::Relaxed);
    if marked & MONITOR_OFF_SET == 0 {
        return false;
    }
    let still = native::last_input_tick() == Some((marked & !MONITOR_OFF_SET) as u32);
    if !still {
        MONITOR_OFF_INPUT.store(0, Ordering::Relaxed);
    }
    still
}

// ── Screenshot ───────────────────────────────────────────────────────────

fn screenshot(app: &AppHandle, peer: &str) -> Result<Value, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("phone-screenshots");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't save the screenshot: {e}"))?;
    remove_old_screenshots(&dir);
    let path = dir.join(format!("Screenshot {}.png", native::local_stamp()));
    native::screenshot_png(&path)?;
    crate::mobile_share::offer_file(app, peer, &path)
}

fn remove_old_screenshots(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age > SCREENSHOT_KEEP);
        if old {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

// ── Chosen apps ──────────────────────────────────────────────────────────

/// Where a Store package is installed, found once per run with PowerShell's
/// `Get-AppxPackage` (the name is checked to letters, digits, `.` and `-`).
fn package_dir(package: &str) -> Option<PathBuf> {
    if let Ok(Some(dir)) = with(|pc| pc.packages.get(package).cloned()) {
        if dir.is_dir() {
            return Some(dir);
        }
    }
    let dir = native::appx_install_location(package)?;
    let _ = with(|pc| pc.packages.insert(package.into(), dir.clone()));
    Some(dir)
}

fn exe_path(target: &Target) -> Option<PathBuf> {
    match target {
        Target::Myself => std::env::current_exe().ok(),
        Target::Store { package, exe } => Some(package_dir(package)?.join(exe)),
        Target::Path { path } => Some(PathBuf::from(path)),
    }
}

fn same_path(a: &Path, b: &Path) -> bool {
    a.to_string_lossy()
        .eq_ignore_ascii_case(&b.to_string_lossy())
}

/// Pids of this program that have a window open.
fn window_pids(exe: &Path) -> Vec<u32> {
    let mut pids: Vec<u32> = native::top_windows()
        .into_iter()
        .map(|window| window.pid)
        .collect();
    pids.sort_unstable();
    pids.dedup();
    pids.into_iter()
        .filter(|pid| native::image_path(*pid).is_some_and(|path| same_path(&path, exe)))
        .collect()
}

fn shortcut_list() -> Result<Value, String> {
    let shortcuts = with(|pc| pc.shortcuts.clone())?;
    let rows: Vec<Value> = shortcuts
        .iter()
        .map(|shortcut| {
            let exe = exe_path(&shortcut.target);
            let found = exe.as_ref().is_some_and(|exe| exe.is_file());
            let running = exe.as_ref().is_some_and(|exe| !window_pids(exe).is_empty());
            json!({
                "id": shortcut.id,
                "name": shortcut.name,
                "self": shortcut.target == Target::Myself,
                "found": found,
                "running": running,
            })
        })
        .collect();
    Ok(json!({ "apps": rows }))
}

fn shortcut_action(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let id = params["id"].as_str().ok_or("Missing app")?;
    let shortcut = with(|pc| pc.shortcuts.iter().find(|s| s.id == id).cloned())?
        .ok_or("That app was removed from the list on the computer")?;
    let action = params["action"].as_str().unwrap_or_default();
    if shortcut.target == Target::Myself {
        return self_action(app, action);
    }
    let exe = exe_path(&shortcut.target)
        .filter(|exe| exe.is_file())
        .ok_or_else(|| format!("{} isn't installed where it was", shortcut.name))?;
    let pids = window_pids(&exe);
    match action {
        "open" => open(&exe, &pids),
        "close" => {
            if pids.is_empty() {
                return Err(format!("{} isn't open", shortcut.name));
            }
            for pid in &pids {
                close_windows(*pid)?;
            }
            Ok(json!({ "done": true }))
        }
        "minimize" => show_windows(&pids, native::Show::Minimize),
        "maximize" => show_windows(&pids, native::Show::Maximize),
        "restart" => {
            // Answer now; closing can take up to 15 s.
            std::thread::spawn(move || {
                for pid in &pids {
                    let _ = close_windows(*pid);
                }
                let started = Instant::now();
                while started.elapsed() < RESTART_WAIT && !window_pids(&exe).is_empty() {
                    std::thread::sleep(Duration::from_millis(500));
                }
                if let Err(error) = native::launch(&exe) {
                    eprintln!("monocode: couldn't reopen {}: {error}", exe.display());
                }
            });
            Ok(json!({ "done": true, "note": "Restarting" }))
        }
        _ => Err("Unsupported action".into()),
    }
}

fn open(exe: &Path, pids: &[u32]) -> Result<Value, String> {
    if pids.is_empty() {
        native::launch(exe)?;
        return Ok(json!({ "done": true, "note": "Opening" }));
    }
    for window in native::top_windows()
        .into_iter()
        .filter(|window| pids.contains(&window.pid))
    {
        native::show_window(window.handle, native::Show::Restore);
        native::focus(window.handle);
    }
    Ok(json!({ "done": true }))
}

/// Hari itself: Open shows it, Restart restarts it (after answering).
fn self_action(app: &AppHandle, action: &str) -> Result<Value, String> {
    let window = app
        .get_window("main")
        .or_else(|| app.windows().into_values().next());
    match action {
        "open" => {
            let window = window.ok_or("Hari has no window open")?;
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
            Ok(json!({ "done": true }))
        }
        "minimize" => {
            window
                .ok_or("Hari has no window open")?
                .minimize()
                .map_err(|e| e.to_string())?;
            Ok(json!({ "done": true }))
        }
        "maximize" => {
            window
                .ok_or("Hari has no window open")?
                .maximize()
                .map_err(|e| e.to_string())?;
            Ok(json!({ "done": true }))
        }
        "restart" => {
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(700));
                app.restart();
            });
            Ok(json!({ "done": true, "note": "Restarting" }))
        }
        "close" => Err("Hari can't close itself from the phone; use Restart".into()),
        _ => Err("Unsupported action".into()),
    }
}

// ── Phone stats, ring ────────────────────────────────────────────────────

fn finite(value: &Value, min: f64, max: f64) -> Option<f64> {
    value
        .as_f64()
        .filter(|v| v.is_finite() && *v >= min && *v <= max)
}

/// Keeps only the fields the desktop shows, in range.
fn clean_phone_stats(params: &Value) -> Value {
    let network = match params["network"].as_str() {
        Some(kind @ ("wifi" | "cellular" | "ethernet" | "none" | "other")) => Some(kind),
        _ => None,
    };
    json!({
        "battery": finite(&params["battery"], 0.0, 1.0),
        "charging": params["charging"].as_bool(),
        "temperature": finite(&params["temperature"], -40.0, 150.0),
        "storageFree": params["storageFree"].as_u64(),
        "storageTotal": params["storageTotal"].as_u64(),
        "network": network,
    })
}

fn phone_stats(app: &AppHandle, peer: &str, params: &Value) -> Result<Value, String> {
    let stats = clean_phone_stats(params);
    let at = now_ms();
    with(|pc| pc.phones.insert(peer.into(), (at, stats.clone())))?;
    let name = crate::mobile_access::paired_phones(app)
        .into_iter()
        .find(|(fingerprint, _)| fingerprint == peer)
        .map(|(_, name)| name);
    let _ = app.emit(
        PHONE_STATS_EVENT,
        json!({ "peer": peer, "name": name, "at": at, "stats": stats }),
    );
    Ok(json!({ "ok": true }))
}

fn check_window(window: &Window) -> Result<(), String> {
    if crate::window::is_workspace_window(window.label()) {
        Ok(())
    } else {
        Err("Only workspace windows can do this".into())
    }
}

fn push_to_phones(app: &AppHandle, kind: &str, payload: Value) -> Result<(), String> {
    let phones = crate::mobile_access::paired_phones(app);
    if phones.is_empty() {
        return Err("Pair a phone first".into());
    }
    let mut sent = false;
    let mut last_error = None;
    for (peer, _) in phones {
        match crate::mobile_events::push(&peer, kind, payload.clone()) {
            Ok(_) => sent = true,
            Err(error) => last_error = Some(error),
        }
    }
    if sent {
        Ok(())
    } else {
        Err(last_error.unwrap_or_else(|| "Couldn't reach the phone".into()))
    }
}

/// The phones' latest stats, and asks them to keep sending for a minute.
#[tauri::command]
pub fn mobile_pc_phone_stats(window: Window, app: AppHandle) -> Result<Value, String> {
    check_window(&window)?;
    let phones = crate::mobile_access::paired_phones(&app);
    if !phones.is_empty() {
        push_to_phones(
            &app,
            "stats.want",
            json!({ "until": now_ms() + PHONE_STATS_FOR_MS }),
        )?;
    }
    let stored = with(|pc| pc.phones.clone())?;
    let rows: Vec<Value> = phones
        .into_iter()
        .map(|(peer, name)| {
            let (at, stats) = stored.get(&peer).cloned().unzip();
            json!({ "peer": peer, "name": name, "at": at, "stats": stats })
        })
        .collect();
    Ok(json!({ "phones": rows }))
}

/// Find my phone: rings (or stops ringing) every paired phone.
#[tauri::command]
pub fn mobile_pc_ring(window: Window, app: AppHandle, start: bool) -> Result<(), String> {
    check_window(&window)?;
    push_to_phones(
        &app,
        "ring",
        json!({ "action": if start { "start" } else { "stop" }, "at": now_ms() }),
    )
}

// ── Chosen apps in Settings ──────────────────────────────────────────────

fn shortcut_rows(pc: &Pc) -> Value {
    let rows: Vec<Value> = pc
        .shortcuts
        .iter()
        .map(|shortcut| {
            let detail = match &shortcut.target {
                Target::Myself => "This app".to_string(),
                Target::Store { package, .. } => format!("Microsoft Store app ({package})"),
                Target::Path { path } => path.clone(),
            };
            json!({ "id": shortcut.id, "name": shortcut.name, "detail": detail })
        })
        .collect();
    json!({ "apps": rows })
}

#[tauri::command]
pub fn mobile_pc_apps_list(window: Window) -> Result<Value, String> {
    check_window(&window)?;
    with(|pc| shortcut_rows(pc))
}

/// Adds a program (an .exe the user picked) to the phone's apps.
#[tauri::command]
pub fn mobile_pc_apps_add(window: Window, path: String) -> Result<Value, String> {
    check_window(&window)?;
    let exe = PathBuf::from(&path);
    if !exe.is_file() {
        return Err("Choose a program (.exe) that exists".into());
    }
    let name: String = exe
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default()
        .chars()
        .take(MAX_NAME_CHARS)
        .collect();
    let shortcut = Shortcut {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        target: Target::Path { path },
    };
    if !valid_shortcut(&shortcut) {
        return Err("Choose a program (.exe)".into());
    }
    with(|pc| {
        if pc.shortcuts.len() >= MAX_SHORTCUTS {
            return Err(format!("The phone shows at most {MAX_SHORTCUTS} apps"));
        }
        if pc.shortcuts.iter().any(|old| old.target == shortcut.target) {
            return Err("That app is already in the list".into());
        }
        pc.shortcuts.push(shortcut);
        save(pc);
        Ok(shortcut_rows(pc))
    })?
}

#[tauri::command]
pub fn mobile_pc_apps_remove(window: Window, id: String) -> Result<Value, String> {
    check_window(&window)?;
    with(|pc| {
        pc.shortcuts.retain(|shortcut| shortcut.id != id);
        save(pc);
        shortcut_rows(pc)
    })
}

#[tauri::command]
pub fn mobile_pc_apps_reset(window: Window) -> Result<Value, String> {
    check_window(&window)?;
    with(|pc| {
        pc.shortcuts = default_shortcuts();
        save(pc);
        shortcut_rows(pc)
    })
}

// ── Windows ──────────────────────────────────────────────────────────────

#[cfg(windows)]
mod native {
    use std::{
        ffi::c_void,
        os::windows::process::CommandExt,
        path::{Path, PathBuf},
        process::Command,
    };

    use windows_sys::Win32::{
        Foundation::{CloseHandle, ERROR_BUFFER_OVERFLOW, FILETIME, HWND, LPARAM, SYSTEMTIME},
        Graphics::{
            Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED},
            Gdi::{
                BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
                GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
                CAPTUREBLT, DIB_RGB_COLORS, SRCCOPY,
            },
        },
        NetworkManagement::{
            IpHelper::{
                FreeMibTable, GetAdaptersAddresses, GetIfTable2, GAA_FLAG_SKIP_ANYCAST,
                GAA_FLAG_SKIP_DNS_SERVER, GAA_FLAG_SKIP_MULTICAST, IP_ADAPTER_ADDRESSES_LH,
                MIB_IF_TABLE2,
            },
            Ndis::IfOperStatusUp,
        },
        Networking::WinSock::AF_INET,
        Storage::FileSystem::{GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives},
        System::{
            Shutdown::LockWorkStation,
            SystemInformation::{
                GetLocalTime, GetTickCount64, GlobalMemoryStatusEx, MEMORYSTATUSEX,
            },
            Threading::{
                GetSystemTimes, OpenProcess, QueryFullProcessImageNameW, CREATE_NO_WINDOW,
                PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
            },
        },
        UI::Input::KeyboardAndMouse::{
            GetLastInputInfo, SendInput, INPUT, INPUT_0, INPUT_MOUSE, LASTINPUTINFO,
            MOUSEEVENTF_MOVE, MOUSEINPUT,
        },
        UI::WindowsAndMessaging::{
            EnumWindows, GetSystemMetrics, GetWindow, GetWindowLongPtrW, GetWindowTextW,
            GetWindowThreadProcessId, IsWindowVisible, PostMessageW, SetForegroundWindow,
            ShowWindowAsync, GWL_EXSTYLE, GW_OWNER, HWND_BROADCAST, SC_MONITORPOWER,
            SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
            SW_MAXIMIZE, SW_MINIMIZE, SW_RESTORE, WM_CLOSE, WM_SYSCOMMAND, WS_EX_TOOLWINDOW,
        },
    };

    const DRIVE_FIXED: u32 = 3;
    const IF_TYPE_ETHERNET: u32 = 6;
    const IF_TYPE_WIFI: u32 = 71;
    const IF_TYPE_LOOPBACK: u32 = 24;

    fn ticks(time: FILETIME) -> u64 {
        ((time.dwHighDateTime as u64) << 32) | time.dwLowDateTime as u64
    }

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// (idle, kernel + user) in 100 ns ticks; kernel time includes idle.
    pub fn cpu_times() -> Option<(u64, u64)> {
        let mut idle = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        // SAFETY: three valid out-pointers.
        let ok = unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) };
        (ok != 0).then(|| (ticks(idle), ticks(kernel) + ticks(user)))
    }

    /// (used, total) physical memory in bytes.
    pub fn memory() -> Option<(u64, u64)> {
        // SAFETY: the struct is plain data; its size is set as the API needs.
        unsafe {
            let mut status: MEMORYSTATUSEX = std::mem::zeroed();
            status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
            (GlobalMemoryStatusEx(&mut status) != 0).then(|| {
                (
                    status.ullTotalPhys.saturating_sub(status.ullAvailPhys),
                    status.ullTotalPhys,
                )
            })
        }
    }

    pub fn uptime_seconds() -> u64 {
        // SAFETY: no arguments.
        unsafe { GetTickCount64() / 1000 }
    }

    /// Fixed drives as (name, free, total).
    pub fn disks() -> Vec<(String, u64, u64)> {
        // SAFETY: plain calls with valid, nul-terminated paths and out-pointers.
        unsafe {
            let mask = GetLogicalDrives();
            (0..26u8)
                .filter(|bit| mask & (1 << bit) != 0)
                .filter_map(|bit| {
                    let letter = (b'A' + bit) as char;
                    let root = wide(&format!("{letter}:\\"));
                    if GetDriveTypeW(root.as_ptr()) != DRIVE_FIXED {
                        return None;
                    }
                    let (mut free, mut total, mut total_free) = (0u64, 0u64, 0u64);
                    (GetDiskFreeSpaceExW(root.as_ptr(), &mut free, &mut total, &mut total_free)
                        != 0)
                        .then(|| (format!("{letter}:"), free, total))
                })
                .collect()
        }
    }

    /// Bytes received and sent so far by the computer's hardware network cards.
    pub fn network_bytes() -> Option<(u64, u64)> {
        // SAFETY: the table comes from GetIfTable2 and is freed with FreeMibTable;
        // rows are read within NumEntries.
        unsafe {
            let mut table: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
            if GetIfTable2(&mut table) != 0 || table.is_null() {
                return None;
            }
            let count = (*table).NumEntries as usize;
            let rows = std::slice::from_raw_parts((*table).Table.as_ptr(), count);
            let (mut down, mut up) = (0u64, 0u64);
            for row in rows {
                let hardware = row.InterfaceAndOperStatusFlags._bitfield & 1 != 0;
                if hardware && row.OperStatus == IfOperStatusUp && row.Type != IF_TYPE_LOOPBACK {
                    down = down.saturating_add(row.InOctets);
                    up = up.saturating_add(row.OutOctets);
                }
            }
            FreeMibTable(table.cast());
            Some((down, up))
        }
    }

    #[derive(Clone)]
    pub struct TopWindow {
        /// The window handle as a number, so lists can cross threads.
        pub handle: isize,
        pub pid: u32,
        pub title: String,
    }

    unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> i32 {
        // SAFETY: lparam is the &mut Vec passed to EnumWindows below, alive for the call.
        let list = &mut *(lparam as *mut Vec<TopWindow>);
        if IsWindowVisible(hwnd) == 0 || !GetWindow(hwnd, GW_OWNER).is_null() {
            return 1;
        }
        if GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW != 0 {
            return 1;
        }
        // Hidden Store apps and other virtual desktops' windows are "cloaked".
        let mut cloaked: u32 = 0;
        if DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED as u32,
            (&mut cloaked as *mut u32).cast::<c_void>(),
            4,
        ) == 0
            && cloaked != 0
        {
            return 1;
        }
        let mut buffer = [0u16; 256];
        let length = GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32);
        if length <= 0 {
            return 1;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            return 1;
        }
        list.push(TopWindow {
            handle: hwnd as isize,
            pid,
            title: String::from_utf16_lossy(&buffer[..length as usize]),
        });
        1
    }

    /// Windows that show in the taskbar: visible, titled, not owned, not tool windows.
    pub fn top_windows() -> Vec<TopWindow> {
        let mut list: Vec<TopWindow> = Vec::new();
        // SAFETY: the callback only uses lparam as this Vec during the call.
        unsafe {
            EnumWindows(Some(collect), &mut list as *mut Vec<TopWindow> as LPARAM);
        }
        list
    }

    pub fn image_path(pid: u32) -> Option<PathBuf> {
        // SAFETY: the handle is closed on every path; the buffer size is passed in.
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return None;
            }
            let mut buffer = [0u16; 1024];
            let mut size = buffer.len() as u32;
            let ok = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                buffer.as_mut_ptr(),
                &mut size,
            );
            CloseHandle(handle);
            (ok != 0).then(|| PathBuf::from(String::from_utf16_lossy(&buffer[..size as usize])))
        }
    }

    #[derive(Clone, Copy)]
    pub enum Show {
        Minimize,
        Maximize,
        Restore,
    }

    pub fn show_window(handle: isize, show: Show) {
        let command = match show {
            Show::Minimize => SW_MINIMIZE,
            Show::Maximize => SW_MAXIMIZE,
            Show::Restore => SW_RESTORE,
        };
        // SAFETY: a stale handle only makes the call fail.
        unsafe {
            ShowWindowAsync(handle as HWND, command);
        }
    }

    pub fn focus(handle: isize) {
        // SAFETY: as above; Windows may refuse focus, which is fine.
        unsafe {
            SetForegroundWindow(handle as HWND);
        }
    }

    /// Like clicking the window's X: the app may ask to save first.
    pub fn close_window(handle: isize) {
        // SAFETY: as above.
        unsafe {
            PostMessageW(handle as HWND, WM_CLOSE, 0, 0);
        }
    }

    pub fn monitor_off() -> Result<(), String> {
        // SAFETY: the broadcast the Telegram bot uses; 2 = power off.
        let ok =
            unsafe { PostMessageW(HWND_BROADCAST, WM_SYSCOMMAND, SC_MONITORPOWER as usize, 2) };
        if ok == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(())
    }

    /// Fork (L-288): a one-pixel mouse nudge there and back wakes the
    /// monitor (most systems ignore SC_MONITORPOWER "on").
    pub fn monitor_on() -> Result<(), String> {
        let nudge = |dx: i32| INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx,
                    dy: 0,
                    mouseData: 0,
                    dwFlags: MOUSEEVENTF_MOVE,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        let inputs = [nudge(1), nudge(-1)];
        // SAFETY: two filled INPUT structs and their size.
        let sent = unsafe {
            SendInput(
                inputs.len() as u32,
                inputs.as_ptr(),
                std::mem::size_of::<INPUT>() as i32,
            )
        };
        if sent == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(())
    }

    /// The tick count of the last keyboard or mouse input.
    pub fn last_input_tick() -> Option<u32> {
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        // SAFETY: a valid out-pointer with its size set.
        (unsafe { GetLastInputInfo(&mut info) } != 0).then_some(info.dwTime)
    }

    pub fn lock() -> Result<(), String> {
        // SAFETY: no arguments.
        if unsafe { LockWorkStation() } == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(())
    }

    fn system32(program: &str) -> PathBuf {
        let root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
        Path::new(&root).join("System32").join(program)
    }

    /// `shutdown /h`, as the Telegram bot does (it holds the shutdown right).
    pub fn hibernate() -> Result<(), String> {
        Command::new(system32("shutdown.exe"))
            .arg("/h")
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn launch(exe: &Path) -> Result<(), String> {
        let mut command = Command::new(exe);
        if let Some(dir) = exe.parent() {
            command.current_dir(dir);
        }
        command
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Couldn't open it: {e}"))
    }

    pub fn appx_install_location(package: &str) -> Option<PathBuf> {
        let output = Command::new(system32("WindowsPowerShell\\v1.0\\powershell.exe"))
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &format!(
                    "(Get-AppxPackage -Name '{package}' | Select-Object -First 1).InstallLocation"
                ),
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let dir = PathBuf::from(text);
        (dir.is_absolute() && dir.is_dir()).then_some(dir)
    }

    /// Local date and time for a file name, like `2026-11-14 18-05-03`.
    pub fn local_stamp() -> String {
        // SAFETY: a valid out-pointer.
        let time: SYSTEMTIME = unsafe {
            let mut time = std::mem::zeroed();
            GetLocalTime(&mut time);
            time
        };
        format!(
            "{:04}-{:02}-{:02} {:02}-{:02}-{:02}",
            time.wYear, time.wMonth, time.wDay, time.wHour, time.wMinute, time.wSecond
        )
    }

    /// Captures every screen (the virtual desktop) into a PNG file.
    pub fn screenshot_png(path: &Path) -> Result<(), String> {
        // SAFETY: every GDI object made here is released before returning; the
        // pixel buffer is sized for the bitmap GetDIBits fills.
        let (width, height, pixels) = unsafe {
            let x = GetSystemMetrics(SM_XVIRTUALSCREEN);
            let y = GetSystemMetrics(SM_YVIRTUALSCREEN);
            let width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
            let height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
            if width <= 0 || height <= 0 {
                return Err("No screen to capture".into());
            }
            let screen = GetDC(std::ptr::null_mut());
            if screen.is_null() {
                return Err("Couldn't read the screen".into());
            }
            let memory = CreateCompatibleDC(screen);
            let bitmap = CreateCompatibleBitmap(screen, width, height);
            let previous = SelectObject(memory, bitmap);
            let copied = BitBlt(
                memory,
                0,
                0,
                width,
                height,
                screen,
                x,
                y,
                SRCCOPY | CAPTUREBLT,
            );
            let mut info: BITMAPINFO = std::mem::zeroed();
            info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
            info.bmiHeader.biWidth = width;
            info.bmiHeader.biHeight = -height; // top-down rows
            info.bmiHeader.biPlanes = 1;
            info.bmiHeader.biBitCount = 32;
            info.bmiHeader.biCompression = BI_RGB;
            let mut pixels = vec![0u8; width as usize * height as usize * 4];
            let lines = GetDIBits(
                memory,
                bitmap,
                0,
                height as u32,
                pixels.as_mut_ptr().cast(),
                &mut info,
                DIB_RGB_COLORS,
            );
            SelectObject(memory, previous);
            DeleteObject(bitmap);
            DeleteDC(memory);
            ReleaseDC(std::ptr::null_mut(), screen);
            if copied == 0 || lines == 0 {
                return Err("Couldn't read the screen (is it locked?)".into());
            }
            (width as u32, height as u32, pixels)
        };
        let rgb: Vec<u8> = pixels
            .chunks_exact(4)
            .flat_map(|bgra| [bgra[2], bgra[1], bgra[0]])
            .collect();
        let file = std::fs::File::create(path).map_err(|e| format!("Couldn't save it: {e}"))?;
        let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), width, height);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .and_then(|mut writer| writer.write_image_data(&rgb))
            .map_err(|e| format!("Couldn't save it: {e}"))
    }

    /// Wired and Wi-Fi cards that are up, with an IPv4 address: what a magic
    /// packet needs (the card's MAC and its network's broadcast address).
    pub fn wake_cards() -> Vec<serde_json::Value> {
        let flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER;
        // u64 words keep the buffer aligned for the structures inside it.
        let mut buffer: Vec<u64> = vec![0; 2048];
        let mut cards = Vec::new();
        // SAFETY: the buffer is sized as GetAdaptersAddresses asks; every pointer
        // read comes from the list it wrote and is used while the buffer lives.
        unsafe {
            let mut size = (buffer.len() * 8) as u32;
            let mut result = GetAdaptersAddresses(
                AF_INET as u32,
                flags,
                std::ptr::null(),
                buffer.as_mut_ptr().cast(),
                &mut size,
            );
            if result == ERROR_BUFFER_OVERFLOW {
                buffer = vec![0; (size as usize).div_ceil(8)];
                result = GetAdaptersAddresses(
                    AF_INET as u32,
                    flags,
                    std::ptr::null(),
                    buffer.as_mut_ptr().cast(),
                    &mut size,
                );
            }
            if result != 0 {
                return cards;
            }
            let mut adapter = buffer.as_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>();
            while !adapter.is_null() {
                let card = &*adapter;
                adapter = card.Next;
                if card.OperStatus != IfOperStatusUp
                    || !matches!(card.IfType, IF_TYPE_ETHERNET | IF_TYPE_WIFI)
                    || card.PhysicalAddressLength != 6
                {
                    continue;
                }
                let mac = card.PhysicalAddress[..6]
                    .iter()
                    .map(|byte| format!("{byte:02X}"))
                    .collect::<Vec<_>>()
                    .join(":");
                let mut broadcast = None;
                let mut unicast = card.FirstUnicastAddress;
                while !unicast.is_null() {
                    let address = &*unicast;
                    unicast = address.Next;
                    let socket = address.Address.lpSockaddr.cast::<u8>();
                    if socket.is_null() || address.Address.iSockaddrLength < 8 {
                        continue;
                    }
                    // SOCKADDR_IN: family (2 bytes), port (2), then the address.
                    let family = u16::from_ne_bytes([*socket, *socket.add(1)]);
                    if family != AF_INET {
                        continue;
                    }
                    let ip = [
                        *socket.add(4),
                        *socket.add(5),
                        *socket.add(6),
                        *socket.add(7),
                    ];
                    if ip[0] == 169 && ip[1] == 254 {
                        continue;
                    }
                    broadcast = super::broadcast_address(ip, address.OnLinkPrefixLength);
                    break;
                }
                let Some(broadcast) = broadcast else {
                    continue;
                };
                let name = if card.FriendlyName.is_null() {
                    String::new()
                } else {
                    let mut length = 0;
                    while *card.FriendlyName.add(length) != 0 {
                        length += 1;
                    }
                    String::from_utf16_lossy(std::slice::from_raw_parts(card.FriendlyName, length))
                };
                cards.push(serde_json::json!({
                    "name": name,
                    "mac": mac,
                    "broadcast": broadcast,
                    "wifi": card.IfType == IF_TYPE_WIFI,
                }));
            }
        }
        cards
    }
}

#[cfg(not(windows))]
mod native {
    use std::path::{Path, PathBuf};

    const ONLY_WINDOWS: &str = "This works on Windows only";

    pub fn cpu_times() -> Option<(u64, u64)> {
        None
    }
    pub fn memory() -> Option<(u64, u64)> {
        None
    }
    pub fn uptime_seconds() -> u64 {
        0
    }
    pub fn disks() -> Vec<(String, u64, u64)> {
        Vec::new()
    }
    pub fn network_bytes() -> Option<(u64, u64)> {
        None
    }
    #[derive(Clone)]
    pub struct TopWindow {
        pub handle: isize,
        pub pid: u32,
        pub title: String,
    }
    pub fn top_windows() -> Vec<TopWindow> {
        Vec::new()
    }
    pub fn image_path(_pid: u32) -> Option<PathBuf> {
        None
    }
    #[derive(Clone, Copy)]
    pub enum Show {
        Minimize,
        Maximize,
        Restore,
    }
    pub fn show_window(_handle: isize, _show: Show) {}
    pub fn focus(_handle: isize) {}
    pub fn close_window(_handle: isize) {}
    pub fn monitor_off() -> Result<(), String> {
        Err(ONLY_WINDOWS.into())
    }
    pub fn monitor_on() -> Result<(), String> {
        Err(ONLY_WINDOWS.into())
    }
    pub fn last_input_tick() -> Option<u32> {
        None
    }
    pub fn lock() -> Result<(), String> {
        Err(ONLY_WINDOWS.into())
    }
    pub fn hibernate() -> Result<(), String> {
        Err(ONLY_WINDOWS.into())
    }
    pub fn launch(_exe: &Path) -> Result<(), String> {
        Err(ONLY_WINDOWS.into())
    }
    pub fn appx_install_location(_package: &str) -> Option<PathBuf> {
        None
    }
    pub fn local_stamp() -> String {
        super::now_ms().to_string()
    }
    pub fn screenshot_png(_path: &Path) -> Result<(), String> {
        Err(ONLY_WINDOWS.into())
    }
    pub fn wake_cards() -> Vec<serde_json::Value> {
        Vec::new()
    }
}

/// The broadcast address of `ip`'s network (`prefix` bits of network part).
fn broadcast_address(ip: [u8; 4], prefix: u8) -> Option<String> {
    if prefix > 32 {
        return None;
    }
    let host_mask = u32::MAX.checked_shr(u32::from(prefix)).unwrap_or(0);
    let broadcast = (u32::from_be_bytes(ip) | host_mask).to_be_bytes();
    Some(format!(
        "{}.{}.{}.{}",
        broadcast[0], broadcast[1], broadcast[2], broadcast[3]
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mobile_pc_broadcast_address() {
        assert_eq!(
            broadcast_address([192, 168, 1, 23], 24).as_deref(),
            Some("192.168.1.255")
        );
        assert_eq!(
            broadcast_address([10, 0, 5, 9], 16).as_deref(),
            Some("10.0.255.255")
        );
        assert_eq!(
            broadcast_address([10, 0, 5, 9], 32).as_deref(),
            Some("10.0.5.9")
        );
        assert_eq!(broadcast_address([1, 2, 3, 4], 33), None);
    }

    #[test]
    fn mobile_pc_refuses_stale_or_untimed_commands() {
        let now = 1_000_000;
        assert!(fresh(&json!({ "sentAt": now - 5_000 }), now).is_ok());
        assert!(fresh(&json!({ "sentAt": now + 5_000 }), now).is_ok());
        assert!(fresh(&json!({ "sentAt": now - STALE_MS - 1 }), now).is_err());
        assert!(fresh(&json!({ "sentAt": now + STALE_MS + 1 }), now).is_err());
        assert!(fresh(&json!({}), now).is_err());
    }

    #[test]
    fn mobile_pc_cpu_and_rates() {
        assert_eq!(cpu_percent((100, 1000), (150, 1100)), Some(50.0));
        assert_eq!(cpu_percent((100, 1000), (100, 1000)), None);
        assert_eq!(cpu_percent((200, 1000), (100, 1100)), None);
        assert_eq!(rate(1000, 3000, 2.0), Some(1000.0));
        assert_eq!(rate(3000, 1000, 2.0), None);
    }

    #[test]
    fn mobile_pc_shortcuts_validate() {
        let store = |package: &str, exe: &str| Shortcut {
            id: "a".into(),
            name: "A".into(),
            target: Target::Store {
                package: package.into(),
                exe: exe.into(),
            },
        };
        assert!(valid_shortcut(&store("OpenAI.Codex", "app\\ChatGPT.exe")));
        assert!(!valid_shortcut(&store("Claude'; rm", "app\\claude.exe")));
        assert!(!valid_shortcut(&store("Claude", "..\\..\\evil.exe")));
        assert!(!valid_shortcut(&store("Claude", "app\\claude.bat")));
        for shortcut in default_shortcuts() {
            assert!(valid_shortcut(&shortcut), "{}", shortcut.id);
        }
        let saved = serde_json::to_value(default_shortcuts()).unwrap();
        assert_eq!(saved[0]["kind"], "self");
        assert_eq!(saved[1]["kind"], "store");
        let back: Vec<Shortcut> = serde_json::from_value(saved).unwrap();
        assert_eq!(back, default_shortcuts());
    }

    #[test]
    fn mobile_pc_phone_stats_are_cleaned() {
        let cleaned = clean_phone_stats(&json!({
            "battery": 0.42,
            "charging": true,
            "temperature": 900,
            "storageFree": 10,
            "storageTotal": 20,
            "network": "wifi",
            "extra": "dropped",
        }));
        assert_eq!(cleaned["battery"], 0.42);
        assert_eq!(cleaned["temperature"], Value::Null);
        assert_eq!(cleaned["network"], "wifi");
        assert!(cleaned.get("extra").is_none());
        assert_eq!(
            clean_phone_stats(&json!({ "network": "<script>" }))["network"],
            Value::Null
        );
    }

    #[test]
    fn mobile_pc_protects_windows_shell() {
        assert!(is_protected("Explorer.EXE"));
        assert!(!is_protected("Code.exe"));
    }
}
