use std::collections::HashMap;
#[cfg(unix)]
use std::io::Read;
use std::io::Write;
#[cfg(unix)]
use std::os::unix::io::AsRawFd;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use std::time::Instant;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::dirs_home;
use crate::fs::expand_home;

#[cfg(any(windows, test))]
#[path = "pty_output.rs"]
mod blocking_output;

const DATA_EVENT: &str = "pty-data";
const EXIT_EVENT: &str = "pty-exit";
const READ_CHUNK: usize = 32 * 1024;
/// Cap how often a busy PTY hops the webview. Each `emit` is a JS eval; a
/// flood of small reads was thousands per second and froze input.
const PTY_COALESCE: Duration = Duration::from_millis(8);
#[cfg(unix)]
const KILL_ESCALATE: Duration = Duration::from_secs(1);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PtyData {
    id: String,
    data: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PtyExit {
    id: String,
    code: Option<i32>,
}

struct LivePty {
    identity: Option<String>,
    activity: Mutex<Instant>,
    cwd: std::path::PathBuf,
    writer: Mutex<Box<dyn Write + Send>>,
    #[cfg(unix)]
    master_fd: i32,
    /// Retained for `pty_resize`. `MasterPty: Send`, so `Mutex` is enough to
    /// share it between the Tauri thread pool and the reader/waiter threads.
    #[cfg(windows)]
    master: Mutex<Box<dyn portable_pty::MasterPty + Send>>,
    /// Direct kill handle. `terminate_all` (taskkill tree-kill) is the primary
    /// path; this covers the interim before the pid is known or reachable.
    #[cfg(windows)]
    killer: Mutex<Box<dyn portable_pty::ChildKiller + Send + Sync>>,
    pid: u32,
}

/// Tail of everything a PTY has produced, for catching a webview up after
/// WebView2 stalls or drops event delivery (observed on Windows when the
/// window sits behind others: the shell runs and the backend emits, but the
/// page receives nothing until the window is activated again).
/// `total` counts every byte ever emitted; `bytes` keeps only the last
/// [`REPLAY_CAP`] so offsets stay stable while memory stays bounded.
#[derive(Default)]
struct ReplayBuf {
    bytes: Vec<u8>,
    total: u64,
}

const REPLAY_CAP: usize = 128 * 1024;

impl ReplayBuf {
    fn push(&mut self, chunk: &[u8]) {
        self.bytes.extend_from_slice(chunk);
        self.total += chunk.len() as u64;
        if self.bytes.len() > REPLAY_CAP {
            let drop = self.bytes.len() - REPLAY_CAP;
            self.bytes.drain(..drop);
        }
    }

    /// Bytes from `offset` (clamped to what the buffer still holds).
    fn from(&self, offset: u64) -> (u64, &[u8]) {
        let buffered_start = self.total - self.bytes.len() as u64;
        let start = offset.max(buffered_start).min(self.total);
        (start, &self.bytes[(start - buffered_start) as usize..])
    }
}

pub struct PtyHost {
    sessions: Mutex<HashMap<String, Arc<LivePty>>>,
    replay: Mutex<HashMap<String, ReplayBuf>>,
}

impl PtyHost {
    pub(crate) fn paste_output(&self, id: &str) -> Result<(u64, Duration), String> {
        let live = self
            .get(id)
            .ok_or("Native terminal exited before submission")?;
        let activity = live.activity.lock().unwrap_or_else(|e| e.into_inner());
        let total = self
            .replay
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .map_or(0, |replay| replay.total);
        Ok((total, activity.elapsed()))
    }

    pub(crate) fn process_roots(&self) -> Vec<crate::process_stats::ProcessRoot> {
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .map(|(id, live)| crate::process_stats::ProcessRoot {
                id: id.clone(),
                pid: live.pid,
                identity: live.identity.clone(),
                cwd: live.cwd.to_string_lossy().into_owned(),
                kind: if id.starts_with("claude-interactive:") {
                    "interactive"
                } else {
                    "terminal"
                }
                .into(),
                idle_ms: live
                    .activity
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .elapsed()
                    .as_millis() as u64,
            })
            .collect()
    }

    pub(crate) fn has_working_dir(&self, path: &std::path::Path) -> bool {
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .any(|live| crate::worktrees::contains_working_dir(path, &live.cwd))
    }

    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            replay: Mutex::new(HashMap::new()),
        }
    }

    fn insert(&self, id: String, live: Arc<LivePty>) -> Option<Arc<LivePty>> {
        self.replay
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&id);
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, live)
    }

    fn get(&self, id: &str) -> Option<Arc<LivePty>> {
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .cloned()
    }

    fn remove(&self, id: &str) -> Option<Arc<LivePty>> {
        self.replay
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(id);
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(id)
    }

    fn remove_if_pid(&self, id: &str, pid: u32) -> Option<Arc<LivePty>> {
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        if sessions.get(id).map(|live| live.pid) != Some(pid) {
            return None;
        }
        self.replay
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(id);
        sessions.remove(id)
    }

    pub(crate) fn kill_all(&self) {
        self.replay
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        let kids: Vec<Arc<LivePty>> = {
            let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
            map.drain().map(|(_, live)| live).collect()
        };
        let pids: Vec<u32> = kids.iter().map(|live| live.pid).collect();
        for live in kids {
            #[cfg(unix)]
            #[cfg(unix)]
            {
                hangup(live.pid);
                close_fd(live.master_fd);
            }
            // Draining the map already drops writer + master on this thread;
            // poke the child directly first so a wedged console does not wait
            // for the taskkill escalation below.
            #[cfg(windows)]
            windows_pty_teardown(&live);
        }
        // Quit and `Drop` both exit the process, so the SIGKILL has to land
        // before this returns. `terminate`'s detached escalate thread never gets
        // to run, and every shell is its own `setsid` session that outlives us.
        crate::harness::terminate_all(&pids);
    }
}

impl Drop for PtyHost {
    fn drop(&mut self) {
        self.kill_all();
    }
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    host: State<PtyHost>,
    id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    spawn_with_program(app, host, id, cwd, cols, rows, None)
}

/// Internal only: providers pass an executable and argv, never shell text.
pub(crate) struct PtyProgram {
    pub binary: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub remove_env: Vec<String>,
}

pub(crate) fn spawn_with_program(
    app: AppHandle,
    host: State<PtyHost>,
    id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    program: Option<PtyProgram>,
) -> Result<(), String> {
    let workdir = working_dir(&cwd);
    let _reservation = crate::worktree_lifecycle::reserve_spawn(&workdir)?;
    if let Some(prev) = host.remove(&id) {
        #[cfg(windows)]
        windows_pty_teardown(&prev);
        terminate(prev.pid);
        #[cfg(unix)]
        close_fd(prev.master_fd);
    }

    #[cfg(unix)]
    {
        spawn_unix(app, host, id, workdir, cols.max(2), rows.max(2), program)
    }

    #[cfg(windows)]
    {
        spawn_windows(
            app,
            host,
            id,
            workdir.to_string_lossy().into_owned(),
            cols.max(2),
            rows.max(2),
            program,
        )
    }

    #[cfg(not(any(unix, windows)))]
    {
        let _ = (app, cwd, cols, rows);
        Err("Terminals are not supported on this platform.".into())
    }
}

/// Transport changes wait for the previous process tree before starting an owner.
pub(crate) fn stop_program(host: &PtyHost, id: &str) -> Result<(), String> {
    if let Some(live) = host.get(id) {
        crate::harness::terminate_all(&[live.pid]);
        if crate::harness::tree_alive(live.pid) {
            return Err(
                "Previous terminal process has not exited; a replacement was not started".into(),
            );
        }
        if let Some(live) = host.remove_if_pid(id, live.pid) {
            #[cfg(windows)]
            windows_pty_teardown(&live);
            #[cfg(unix)]
            close_fd(live.master_fd);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn pty_write(host: State<PtyHost>, id: String, data: String) -> Result<(), String> {
    let live = host
        .get(&id)
        .ok_or_else(|| "Terminal is not running".to_string())?;
    *live.activity.lock().unwrap_or_else(|e| e.into_inner()) = Instant::now();
    let mut writer = live.writer.lock().unwrap_or_else(|e| e.into_inner());
    writer
        .write_all(data.as_bytes())
        .and_then(|_| writer.flush())
        .map_err(|e| format!("Failed to write to terminal: {e}"))
}

#[tauri::command]
pub fn pty_resize(host: State<PtyHost>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let live = host
        .get(&id)
        .ok_or_else(|| "Terminal is not running".to_string())?;
    #[cfg(unix)]
    {
        resize_fd(live.master_fd, cols.max(2), rows.max(2))
    }
    #[cfg(windows)]
    {
        let master = live.master.lock().unwrap_or_else(|e| e.into_inner());
        master
            .resize(portable_pty::PtySize {
                rows: rows.max(2),
                cols: cols.max(2),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|err| format!("Failed to resize terminal: {err}"))
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (live, cols, rows);
        Err("Terminals are not supported on this platform.".into())
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PtyStatus {
    foreground: Option<String>,
}

/// Off the main thread: outside Linux a running command costs a `ps` fork,
/// and the title poll calls it once a second for every open terminal.
#[tauri::command(async)]
pub fn pty_status(host: State<'_, PtyHost>, id: String) -> Result<PtyStatus, String> {
    let live = host
        .get(&id)
        .ok_or_else(|| "Terminal is not running".to_string())?;
    #[cfg(unix)]
    {
        let foreground = foreground_label(live.master_fd, live.pid);
        Ok(PtyStatus { foreground })
    }
    #[cfg(not(unix))]
    {
        let _ = live;
        Ok(PtyStatus { foreground: None })
    }
}

/// Removing the session first silences its wait thread (`remove_if_pid` then
/// finds nothing), so this reports the exit itself. A view that is closing
/// has already dropped its handlers; one that stays open, such as a tab whose
/// shell the process monitor stopped, shows the exit and offers Restart.
#[tauri::command]
pub fn pty_kill(app: AppHandle, host: State<PtyHost>, id: String) -> Result<(), String> {
    if let Some(live) = host.remove(&id) {
        #[cfg(windows)]
        windows_pty_teardown(&live);
        terminate(live.pid);
        #[cfg(unix)]
        close_fd(live.master_fd);
        let _ = app.emit(EXIT_EVENT, PtyExit { id, code: None });
    }
    Ok(())
}

/// Off the main thread: `kill_all` waits for the shells to die before it
/// returns, and a window close calls this while the app keeps running.
#[tauri::command(async)]
pub fn pty_kill_all(host: State<'_, PtyHost>) -> Result<(), String> {
    host.kill_all();
    Ok(())
}

// ---------------------------------------------------------------------------
// Windows (ConPTY via portable-pty)
// ---------------------------------------------------------------------------

/// ConPTY read poll interval. The pipe read blocks, so this only bounds how
/// fast a dead child is noticed — not input latency.
#[cfg(windows)]
const WIN_WAIT_POLL: Duration = Duration::from_millis(50);

/// Answer ConPTY emits to cursor-position queries on session start.
/// microsoft/terminal#1810: ConPTY blocks the child until something answers
/// `ESC[6n`; portable-pty never does, so shells hang forever at startup.
/// Write `ESC[1;1R` (cursor at 1,1) to the input pipe right after spawn.
/// Windows-only: on Unix this would corrupt stdin for interactive readers.
#[cfg(windows)]
const CONPTY_DSR_REPLY: &[u8] = b"\x1b[1;1R";

/// Shell search order on Windows: PowerShell 7, Windows PowerShell, cmd.
/// Mirrors the T3 reference. Never route through `cmd /c` — ConPTY needs the
/// interactive shell itself, not a one-shot wrapper.
#[cfg(windows)]
fn windows_shell_search_order() -> [&'static str; 3] {
    ["pwsh", "powershell", "cmd"]
}

/// Flags per shell, matched on the resolved file name (case-insensitive).
/// PowerShell prints its banner on every tab without `-NoLogo`.
#[cfg(windows)]
fn windows_shell_args(file_name: &str) -> &'static [&'static str] {
    let lower = file_name.to_ascii_lowercase();
    let base = lower.rsplit(['/', '\\']).next().unwrap_or(&lower);
    match base {
        "pwsh.exe" | "pwsh" | "powershell.exe" | "powershell" => &["-NoLogo"],
        _ => &[],
    }
}

/// First shell from the search order that resolves on the GUI PATH, plus
/// `%ComSpec%` as a last resort (usually cmd.exe).
#[cfg(windows)]
fn resolve_windows_shell() -> Option<(String, Vec<String>)> {
    for name in windows_shell_search_order() {
        if let Some(path) = crate::harness::resolve_gui_binary(name) {
            let text = path.to_string_lossy().into_owned();
            let args = windows_shell_args(&text)
                .iter()
                .map(|arg| (*arg).to_string())
                .collect();
            return Some((text, args));
        }
    }
    let comspec = std::env::var("ComSpec")
        .ok()
        .filter(|v| !v.trim().is_empty())?;
    if !std::path::Path::new(&comspec).is_file() {
        return None;
    }
    let args = windows_shell_args(&comspec)
        .iter()
        .map(|arg| (*arg).to_string())
        .collect();
    Some((comspec, args))
}

/// Best-effort direct kill. The taskkill tree-kill in `kill_all`/`pty_kill`
/// is the primary path; this shortens the window where a wedged console
/// outlives its tab.
#[cfg(windows)]
fn windows_pty_teardown(live: &LivePty) {
    if let Ok(mut killer) = live.killer.lock() {
        let _ = killer.kill();
    }
    if live.pid > 1 {
        crate::harness::terminate_all(&[live.pid]);
    }
}

#[cfg(windows)]
fn spawn_windows(
    app: AppHandle,
    host: State<PtyHost>,
    id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    program: Option<PtyProgram>,
) -> Result<(), String> {
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};

    let workdir = working_dir(&cwd);
    let (shell, args, extra_env, remove_env) = if let Some(program) = program {
        (
            program.binary,
            program.args,
            program.env,
            program.remove_env,
        )
    } else {
        let (shell, args) = resolve_windows_shell().ok_or_else(|| {
            "No Windows shell found (looked for pwsh, powershell, cmd)".to_string()
        })?;
        (shell, args, Vec::new(), Vec::new())
    };
    let size = PtySize {
        rows: rows.max(2),
        cols: cols.max(2),
        ..Default::default()
    };
    let pair = native_pty_system()
        .openpty(size)
        .map_err(|e| format!("Failed to open terminal: {e:#}"))?;

    let mut cmd = CommandBuilder::new(&shell);
    cmd.args(args);
    cmd.cwd(&workdir);
    // CommandBuilder starts with an empty environment (unlike
    // std::process::Command), so inherit the GUI process env first. Profile
    // scripts repair PATH interactively from here.
    for (key, value) in std::env::vars() {
        cmd.env(&key, &value);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "MonoCode");
    for (key, value) in extra_env {
        cmd.env(key, value);
    }
    for key in remove_env {
        cmd.env_remove(key);
    }

    let mut child = crate::windows::spawn_pty(pair.slave.as_ref(), cmd)
        .map_err(|e| format!("Failed to start {shell}: {e:#}"))?;
    let pid = child.process_id().unwrap_or(0);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to read terminal: {e:#}"))?;
    let mut writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to write terminal: {e:#}"))?;
    writer
        .write_all(CONPTY_DSR_REPLY)
        .and_then(|_| writer.flush())
        .map_err(|e| format!("Failed to start terminal: {e}"))?;
    let killer = child.clone_killer();

    let live = Arc::new(LivePty {
        identity: crate::process_metrics::identity(pid),
        activity: Mutex::new(Instant::now()),
        cwd: std::path::PathBuf::from(&cwd),
        writer: Mutex::new(writer),
        master: Mutex::new(pair.master),
        killer: Mutex::new(killer),
        pid,
    });
    host.insert(id.clone(), live);

    // A blocking ConPTY read cannot drive an idle flush timer itself.
    let data_app = app.clone();
    let data_id = id.clone();
    thread::spawn(move || {
        blocking_output::pump(reader, |chunk| emit_pty_data(&data_app, &data_id, chunk));
    });

    // Never block on `wait()`: with ConPTY torn down it can hang forever
    // (ClosePseudoConsole flushes into a full pipe). Poll instead, then drop
    // the child on this background thread so the pseudo-console closes here
    // rather than on a Tauri pool thread. `remove_if_pid` keeps a respawned
    // session from inheriting this exit, mirroring the Unix waiter.
    let wait_app = app;
    let wait_id = id;
    thread::spawn(move || {
        let code: Option<i32> = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Some(status.exit_code() as i32),
                Ok(None) => thread::sleep(WIN_WAIT_POLL),
                Err(_) => break None,
            }
        };
        drop(child);
        if let Some(host) = wait_app.try_state::<PtyHost>() {
            if host.remove_if_pid(&wait_id, pid).is_some() {
                let _ = wait_app.emit(EXIT_EVENT, PtyExit { id: wait_id, code });
            }
        }
    });

    Ok(())
}

#[cfg(all(test, windows))]
mod windows_pty_tests {
    use super::*;

    #[test]
    fn shell_search_prefers_pwsh_over_cmd() {
        assert_eq!(windows_shell_search_order(), ["pwsh", "powershell", "cmd"]);
    }

    #[test]
    fn shell_args_add_nologo_for_powershell() {
        assert_eq!(windows_shell_args("pwsh.exe"), &["-NoLogo"]);
        assert_eq!(windows_shell_args("POWERSHELL.EXE"), &["-NoLogo"]);
        assert_eq!(
            windows_shell_args("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"),
            &["-NoLogo"]
        );
        assert_eq!(windows_shell_args("cmd.exe"), &[] as &[&str]);
        assert_eq!(
            windows_shell_args("C:\\Windows\\System32\\cmd.exe"),
            &[] as &[&str]
        );
        assert_eq!(windows_shell_args("nu.exe"), &[] as &[&str]);
    }

    #[test]
    fn conpty_dsr_reply_is_a_cursor_position_answer() {
        // `ESC[1;1R` — cursor at row 1, col 1. Must stay a single DSR answer:
        // anything else lands in the shell as stray typed input.
        assert_eq!(CONPTY_DSR_REPLY, b"\x1b[1;1R");
    }

    #[test]
    fn remove_if_pid_ignores_a_replaced_session() {
        let Some((shell, args)) = resolve_windows_shell() else {
            eprintln!("skipping: no Windows shell found");
            return;
        };
        let pair = portable_pty::native_pty_system()
            .openpty(portable_pty::PtySize {
                rows: 24,
                cols: 80,
                ..Default::default()
            })
            .expect("openpty for test double");
        let mut cmd = portable_pty::CommandBuilder::new(&shell);
        cmd.args(args);
        let killer = pair
            .slave
            .spawn_command(cmd)
            .expect("spawn for test double")
            .clone_killer();
        let host = PtyHost::new();
        let live = Arc::new(LivePty {
            identity: None,
            activity: Mutex::new(Instant::now()),
            cwd: std::path::PathBuf::new(),
            writer: Mutex::new(Box::new(std::io::sink())),
            master: Mutex::new(pair.master),
            killer: Mutex::new(killer),
            pid: 4242,
        });
        host.insert("term".into(), live.clone());
        assert!(host.remove_if_pid("term", 7).is_none());
        assert!(host.get("term").is_some());
        assert!(host.remove_if_pid("term", 4242).is_some());
        assert!(host.get("term").is_none());
        // Precise kill via the stored handle (pid 4242 is a stand-in — never
        // taskkill it). Dropping master tears down ConPTY behind it.
        live.killer.lock().unwrap().kill().ok();
    }

    /// Live ConPTY smoke: spawn the resolved shell, prove the DSR startup
    /// fix works (bytes flow instead of hanging), then kill. Skips when no
    /// shell resolves. Mirrors the manual `pwsh echo` verification.
    #[test]
    fn conpty_spawns_shell_and_echoes() {
        use portable_pty::{native_pty_system, CommandBuilder, PtySize};
        use std::io::Read;
        use std::sync::mpsc;

        let Some((shell, args)) = resolve_windows_shell() else {
            eprintln!("skipping ConPTY smoke test: no Windows shell found");
            return;
        };
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                ..Default::default()
            })
            .expect("openpty");
        let mut cmd = CommandBuilder::new(&shell);
        cmd.args(args);
        for (key, value) in std::env::vars() {
            cmd.env(&key, &value);
        }
        cmd.env("TERM", "xterm-256color");
        let mut child = pair.slave.spawn_command(cmd).expect("spawn shell");
        let reader = pair.master.try_clone_reader().expect("reader");
        let mut writer = pair.master.take_writer().expect("writer");
        writer
            .write_all(CONPTY_DSR_REPLY)
            .and_then(|_| writer.flush())
            .expect("DSR reply");
        // `\r` submits the line in both cmd and PowerShell.
        writer
            .write_all(b"echo monocode-pty-probe-42\r")
            .and_then(|_| writer.flush())
            .expect("write echo");

        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut reader = reader;
            let mut buf = vec![0u8; 4096];
            let mut acc = Vec::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        acc.extend_from_slice(&buf[..n]);
                        if tx.send(acc.clone()).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        let deadline = Instant::now() + Duration::from_secs(15);
        let mut output = String::new();
        let mut found = false;
        while Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(chunk) => {
                    output = String::from_utf8_lossy(&chunk).into_owned();
                    if output.contains("monocode-pty-probe-42") {
                        found = true;
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        child.kill().ok();
        assert!(
            found,
            "no echo marker in PTY output (shell: {shell}): {}",
            output.chars().take(500).collect::<String>()
        );
    }
}

#[cfg(unix)]
fn spawn_unix(
    app: AppHandle,
    host: State<PtyHost>,
    id: String,
    workdir: std::path::PathBuf,
    cols: u16,
    rows: u16,
    program: Option<PtyProgram>,
) -> Result<(), String> {
    use std::fs::File;
    use std::os::unix::io::FromRawFd;
    use std::os::unix::process::CommandExt;
    use std::process::Command;

    let (shell, args, extra_env, remove_env) = if let Some(program) = program {
        (
            program.binary,
            program.args,
            program.env,
            program.remove_env,
        )
    } else {
        let (shell, args) = default_shell();
        (shell, args, Vec::new(), Vec::new())
    };
    let (master, slave) = open_pty(cols, rows)?;

    let mut cmd = Command::new(&shell);
    cmd.args(&args)
        .current_dir(&workdir)
        .stdin(dup_stdio(slave)?)
        .stdout(dup_stdio(slave)?)
        .stderr(dup_stdio(slave)?)
        .env("TERM", "xterm-256color")
        .env("COLORTERM", "truecolor")
        .env("COLORFGBG", "15;0")
        .env("TERM_PROGRAM", "MonoCode")
        .env("PATH", crate::harness::gui_search_path());
    if let Some(home) = dirs_home() {
        cmd.env("HOME", &home);
    }
    cmd.env("PWD", &workdir);
    cmd.envs(extra_env);
    for key in remove_env {
        cmd.env_remove(key);
    }

    // setsid() already creates a new session and process group. Calling
    // process_group(0) first makes the child a group leader, so setsid()
    // fails with EPERM ("Operation not permitted").
    let slave_fd = slave;
    unsafe {
        cmd.pre_exec(move || {
            if libc::setsid() < 0 {
                return Err(std::io::Error::last_os_error());
            }
            // Controlling tty is best-effort; the shell still runs without it.
            let _ = libc::ioctl(0, libc::TIOCSCTTY as _, 0);
            if slave_fd > 2 {
                libc::close(slave_fd);
            }
            Ok(())
        });
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start {shell}: {e}"))?;
    close_fd(slave);
    let pid = child.id();

    set_cloexec(master);
    let reader = unsafe { File::from_raw_fd(dup_fd(master)?) };
    let writer = unsafe { File::from_raw_fd(dup_fd(master)?) };

    let live = Arc::new(LivePty {
        identity: crate::process_metrics::identity(pid),
        activity: Mutex::new(Instant::now()),
        cwd: workdir.clone(),
        writer: Mutex::new(Box::new(writer)),
        master_fd: master,
        pid,
    });
    host.insert(id.clone(), live);

    let data_app = app.clone();
    let data_id = id.clone();
    thread::spawn(move || {
        let mut file = reader;
        let fd = file.as_raw_fd();
        let mut buf = vec![0_u8; READ_CHUNK];
        let mut acc = Vec::with_capacity(READ_CHUNK);
        let mut last_emit = Instant::now();
        loop {
            if acc.is_empty() {
                match file.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        acc.extend_from_slice(&buf[..n]);
                        last_emit = Instant::now();
                    }
                    Err(_) => break,
                }
            } else if pty_should_flush(acc.len(), last_emit.elapsed())
                || !wait_readable(fd, PTY_COALESCE.saturating_sub(last_emit.elapsed()))
            {
                emit_pty_data(&data_app, &data_id, &acc);
                acc.clear();
                last_emit = Instant::now();
            } else {
                match file.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => acc.extend_from_slice(&buf[..n]),
                    Err(_) => break,
                }
            }
        }
        emit_pty_data(&data_app, &data_id, &acc);
    });

    let wait_app = app;
    let wait_id = id;
    thread::spawn(move || {
        let code = child.wait().ok().and_then(|status| status.code());
        // Only announce this child. A remount/respawn reuses the id, and the
        // previous wait thread must not paint "[process exited]" on the new PTY
        // or yank the replacement out of the host map.
        let emit = if let Some(host) = wait_app.try_state::<PtyHost>() {
            if let Some(live) = host.remove_if_pid(&wait_id, pid) {
                close_fd(live.master_fd);
                true
            } else {
                false
            }
        } else {
            false
        };
        if emit {
            let _ = wait_app.emit(EXIT_EVENT, PtyExit { id: wait_id, code });
        }
    });

    Ok(())
}

/// Home fallback for a missing project dir. Identical on every platform —
/// only the callers are cfg-gated.
fn working_dir(cwd: &str) -> std::path::PathBuf {
    let path = expand_home(cwd);
    if path.is_dir() {
        return path;
    }
    dirs_home().map(std::path::PathBuf::from).unwrap_or(path)
}

#[cfg(unix)]
fn default_shell() -> (String, Vec<String>) {
    #[cfg(windows)]
    {
        if let Ok(comspec) = std::env::var("COMSPEC") {
            if !comspec.is_empty() {
                return (comspec, Vec::new());
            }
        }
        ("powershell.exe".into(), vec!["-NoLogo".into()])
    }
    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|shell| !shell.is_empty())
            .unwrap_or_else(|| {
                if cfg!(target_os = "macos") {
                    "/bin/zsh".into()
                } else {
                    "/bin/bash".into()
                }
            });
        let args = login_args(&shell)
            .iter()
            .map(|arg| (*arg).to_string())
            .collect();
        (shell, args)
    }
}

#[cfg(not(windows))]
fn login_args(shell: &str) -> &'static [&'static str] {
    match std::path::Path::new(shell)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or(shell)
    {
        "zsh" | "bash" | "sh" | "fish" => &["-l"],
        _ => &[],
    }
}

/// The hangup a closing shell expects, without `terminate`'s escalation.
#[cfg(unix)]
fn hangup(pid: u32) {
    if pid == 0 || pid == 1 {
        return;
    }
    let ipid = pid as i32;
    unsafe {
        libc::kill(ipid, libc::SIGHUP);
        libc::kill(-ipid, libc::SIGHUP);
    }
}

fn terminate(pid: u32) {
    if pid == 0 || pid == 1 {
        return;
    }
    #[cfg(unix)]
    {
        let ipid = pid as i32;
        unsafe {
            libc::kill(ipid, libc::SIGHUP);
            libc::kill(-ipid, libc::SIGHUP);
            libc::kill(ipid, libc::SIGTERM);
            libc::kill(-ipid, libc::SIGTERM);
        }
        thread::spawn(move || {
            thread::sleep(KILL_ESCALATE);
            unsafe {
                libc::kill(ipid, libc::SIGKILL);
                libc::kill(-ipid, libc::SIGKILL);
            }
        });
    }
    #[cfg(windows)]
    {
        let mut cmd = std::process::Command::new("taskkill");
        crate::hide_window_console(&mut cmd);
        let _ = cmd
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
    }
}

#[cfg(unix)]
fn open_pty(cols: u16, rows: u16) -> Result<(i32, i32), String> {
    let master = unsafe { libc::posix_openpt(libc::O_RDWR | libc::O_NOCTTY) };
    if master < 0 {
        return Err(os_err("Failed to open terminal"));
    }
    if unsafe { libc::grantpt(master) } != 0 || unsafe { libc::unlockpt(master) } != 0 {
        close_fd(master);
        return Err(os_err("Failed to unlock terminal"));
    }
    let name = slave_name(master).inspect_err(|_| {
        close_fd(master);
    })?;
    let slave = unsafe { libc::open(name.as_ptr(), libc::O_RDWR | libc::O_NOCTTY) };
    if slave < 0 {
        close_fd(master);
        return Err(os_err("Failed to open terminal slave"));
    }
    if let Err(err) = resize_fd(master, cols, rows) {
        close_fd(master);
        close_fd(slave);
        return Err(err);
    }
    Ok((master, slave))
}

#[cfg(unix)]
fn slave_name(master: i32) -> Result<std::ffi::CString, String> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        let mut buf = vec![0 as libc::c_char; 64];
        let ret = unsafe { libc::ptsname_r(master, buf.as_mut_ptr(), buf.len()) };
        if ret != 0 {
            return Err(os_err("Failed to resolve terminal name"));
        }
        let last = buf.len() - 1;
        buf[last] = 0;
        Ok(unsafe { std::ffi::CStr::from_ptr(buf.as_ptr()) }.to_owned())
    }

    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        let ptr = unsafe { libc::ptsname(master) };
        if ptr.is_null() {
            return Err(os_err("Failed to resolve terminal name"));
        }
        Ok(unsafe { std::ffi::CStr::from_ptr(ptr) }.to_owned())
    }
}

#[cfg(unix)]
fn resize_fd(fd: i32, cols: u16, rows: u16) -> Result<(), String> {
    let size = libc::winsize {
        ws_row: rows,
        ws_col: cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    if unsafe { libc::ioctl(fd, libc::TIOCSWINSZ, &size) } != 0 {
        return Err(os_err("Failed to resize terminal"));
    }
    Ok(())
}

#[cfg(unix)]
fn dup_fd(fd: i32) -> Result<i32, String> {
    let next = unsafe { libc::dup(fd) };
    if next < 0 {
        return Err(os_err("Failed to duplicate terminal"));
    }
    Ok(next)
}

#[cfg(unix)]
fn dup_stdio(fd: i32) -> Result<std::process::Stdio, String> {
    use std::os::unix::io::FromRawFd;
    let next = dup_fd(fd)?;
    Ok(unsafe { std::process::Stdio::from_raw_fd(next) })
}

#[cfg(unix)]
fn set_cloexec(fd: i32) {
    unsafe {
        let flags = libc::fcntl(fd, libc::F_GETFD);
        if flags >= 0 {
            libc::fcntl(fd, libc::F_SETFD, flags | libc::FD_CLOEXEC);
        }
    }
}

#[cfg(unix)]
fn close_fd(fd: i32) {
    if fd >= 0 {
        unsafe {
            libc::close(fd);
        }
    }
}

#[cfg(unix)]
fn os_err(ctx: &str) -> String {
    format!("{ctx}: {}", std::io::Error::last_os_error())
}

fn emit_pty_data(app: &AppHandle, id: &str, bytes: &[u8]) {
    if bytes.is_empty() {
        return;
    }
    if let Some(host) = app.try_state::<PtyHost>() {
        if let Some(live) = host.get(id) {
            *live.activity.lock().unwrap_or_else(|e| e.into_inner()) = Instant::now();
        }
        host.replay
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entry(id.to_string())
            .or_default()
            .push(bytes);
    }
    let data = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes);
    let _ = app.emit(
        DATA_EVENT,
        PtyData {
            id: id.to_string(),
            data,
        },
    );
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PtyReplay {
    /// Absolute offset of `data` within the session's full output stream.
    start: u64,
    /// Total bytes the session has ever produced.
    total: u64,
    data: String,
}

/// Catch a webview up after stalled event delivery: everything the session
/// produced past the caller's `offset`, base64-encoded. Empty when the caller
/// is already current.
#[tauri::command]
pub fn pty_replay(host: State<PtyHost>, id: String, offset: u64) -> Result<PtyReplay, String> {
    let replay = host.replay.lock().unwrap_or_else(|e| e.into_inner());
    let Some(buf) = replay.get(&id) else {
        return Ok(PtyReplay {
            start: offset,
            total: offset,
            data: String::new(),
        });
    };
    let (start, bytes) = buf.from(offset);
    Ok(PtyReplay {
        start,
        total: buf.total,
        data: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes),
    })
}

#[cfg(unix)]
fn pty_should_flush(buffered: usize, since: Duration) -> bool {
    buffered >= READ_CHUNK || since >= PTY_COALESCE
}

#[cfg(unix)]
fn wait_readable(fd: i32, timeout: Duration) -> bool {
    if timeout.is_zero() {
        return false;
    }
    let mut pollfd = libc::pollfd {
        fd,
        events: libc::POLLIN,
        revents: 0,
    };
    let ms = timeout.as_millis().min(i32::MAX as u128) as i32;
    unsafe { libc::poll(&mut pollfd, 1, ms) > 0 }
}

#[cfg(unix)]
fn foreground_label(master_fd: i32, shell_pid: u32) -> Option<String> {
    let mut pgrp: libc::pid_t = 0;
    if unsafe { libc::ioctl(master_fd, libc::TIOCGPGRP, &mut pgrp) } != 0 {
        return None;
    }
    let pid = pgrp;
    // An idle shell owns the foreground; settle that before any lookup.
    if pid <= 0 || pid == shell_pid as i32 {
        return None;
    }
    let label = process_label(pid)?;
    if is_shell_name(&label) {
        return None;
    }
    Some(label)
}

#[cfg(unix)]
fn process_label(pid: i32) -> Option<String> {
    #[cfg(target_os = "linux")]
    if let Some(label) = proc_cmdline_label(pid) {
        return Some(label);
    }
    ps_label(pid)
}

/// The same argv `ps -o args=` prints, read without forking a process.
#[cfg(target_os = "linux")]
fn proc_cmdline_label(pid: i32) -> Option<String> {
    let raw = std::fs::read(format!("/proc/{pid}/cmdline")).ok()?;
    let args = String::from_utf8_lossy(&raw).replace('\0', " ");
    command_label(args.trim())
}

#[cfg(unix)]
fn ps_label(pid: i32) -> Option<String> {
    use std::process::Command;
    let output = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "args="])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    let args = raw.trim();
    if args.is_empty() {
        return None;
    }
    command_label(args)
}

#[cfg(unix)]
fn command_label(args: &str) -> Option<String> {
    let parts: Vec<&str> = args.split_whitespace().collect();
    if parts.is_empty() {
        return None;
    }
    let exe = parts[0];
    let base = std::path::Path::new(exe)
        .file_name()
        .and_then(|name| name.to_str())?;
    if is_interpreter(base) {
        for part in parts.iter().skip(1) {
            if part.starts_with('-') {
                continue;
            }
            let name = std::path::Path::new(part)
                .file_name()
                .and_then(|name| name.to_str())?;
            if !name.starts_with('-') {
                return Some(name.to_string());
            }
        }
    }
    Some(base.to_string())
}

#[cfg(unix)]
fn is_interpreter(name: &str) -> bool {
    matches!(
        name,
        "node" | "nodejs" | "python" | "python3" | "ruby" | "deno" | "bun"
    )
}

#[cfg(unix)]
fn is_shell_name(name: &str) -> bool {
    matches!(
        name,
        "zsh" | "bash" | "sh" | "fish" | "nu" | "dash" | "ksh" | "tcsh" | "zsh5"
    )
}

#[cfg(all(test, unix))]
mod label_tests {
    use super::*;

    #[test]
    fn command_label_prefers_cli_over_interpreter() {
        assert_eq!(
            command_label("node /usr/local/bin/npm run build"),
            Some("npm".into())
        );
        assert_eq!(command_label("cargo build"), Some("cargo".into()));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn proc_cmdline_labels_a_live_process() {
        assert!(proc_cmdline_label(std::process::id() as i32).is_some());
    }

    #[test]
    fn shell_names_are_ignored() {
        assert!(is_shell_name("zsh"));
        assert!(!is_shell_name("npm"));
    }
}

#[cfg(test)]
mod replay_tests {
    use super::*;

    #[test]
    fn replay_returns_bytes_past_offset() {
        let mut buf = ReplayBuf::default();
        buf.push(b"hello ");
        buf.push(b"world");
        let (start, bytes) = buf.from(6);
        assert_eq!(start, 6);
        assert_eq!(bytes, b"world");
        // Already-current and future offsets yield nothing.
        assert_eq!(buf.from(11).1, b"");
        assert_eq!(buf.from(99).1, b"");
    }

    #[test]
    fn replay_clamps_to_what_the_buffer_still_holds() {
        let mut buf = ReplayBuf::default();
        buf.push(&b"x".repeat(REPLAY_CAP + 500));
        // Front was truncated; the oldest still-buffered byte is 500.
        let (start, bytes) = buf.from(0);
        assert_eq!(start, 500);
        assert_eq!(bytes.len(), REPLAY_CAP);
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn login_args_for_common_shells() {
        assert_eq!(login_args("/bin/zsh"), &["-l"]);
        assert_eq!(login_args("/bin/bash"), &["-l"]);
        assert_eq!(login_args("/usr/bin/fish"), &["-l"]);
        assert_eq!(login_args("/usr/local/bin/nu"), &[] as &[&str]);
    }

    #[test]
    fn pty_flush_waits_for_a_full_chunk_or_the_coalesce_window() {
        assert!(!pty_should_flush(1, Duration::from_millis(1)));
        assert!(pty_should_flush(READ_CHUNK, Duration::from_millis(1)));
        assert!(pty_should_flush(1, PTY_COALESCE));
    }

    #[test]
    fn remove_if_pid_ignores_a_replaced_session() {
        let host = PtyHost::new();
        host.insert(
            "term".into(),
            Arc::new(LivePty {
                identity: None,
                activity: Mutex::new(Instant::now()),
                cwd: std::path::PathBuf::from("/test"),
                writer: Mutex::new(Box::new(std::io::sink())),
                master_fd: -1,
                pid: 42,
            }),
        );
        assert!(host.remove_if_pid("term", 7).is_none());
        assert!(host.get("term").is_some());
        assert!(host.remove_if_pid("term", 42).is_some());
        assert!(host.get("term").is_none());
    }
}
