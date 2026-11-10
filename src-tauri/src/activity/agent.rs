//! Always-on activity scribe powered by Google's Antigravity CLI (`agy`).
//!
//! Every recorded prompt or finished agent turn "kicks" one background
//! worker. The worker waits a few seconds so a burst of events becomes one
//! call, then runs `agy -p <prompt> --output-format json` in an empty folder
//! and stores the reply as a note. Calls never overlap, a rate limit backs
//! off instead of hammering the quota, and a missing or logged-out CLI pauses
//! the worker with a reason the Activity view can show.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use super::store::{self, ActivityEvent};
use super::time::{format_clock, format_duration};
use super::{aw, CHANGED_EVENT};
use crate::harness::{prepare_child, resolve_agy, terminate};
use crate::session_store::{now_millis, SessionStore};

pub const STATUS_EVENT: &str = "activity-agent-status";

/// Quiet period after the latest event before a note is written.
const DEBOUNCE: Duration = Duration::from_secs(4);
/// A steady stream of events still gets a note at least this often.
const MAX_BATCH_WAIT: Duration = Duration::from_secs(20);
const RUN_TIMEOUT: Duration = Duration::from_secs(180);
const BACKOFF_BASE: Duration = Duration::from_secs(30);
const BACKOFF_MAX: Duration = Duration::from_secs(15 * 60);
/// Events per `agy` call; anything beyond runs as the next batch.
pub const BATCH_LIMIT: usize = 25;
/// Older un-noted events (recorded while notes were off) are skipped, not replayed.
pub const LOOKBACK_MS: i64 = 12 * 60 * 60 * 1000;
const NOTE_MAX_CHARS: usize = 4_000;
const PROMPT_TEXT_CHARS: usize = 600;
const REPLY_TEXT_CHARS: usize = 600;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    /// Notes are turned off.
    Off,
    /// Caught up; waiting for the next event.
    Idle,
    /// Events arrived; waiting out the debounce.
    Queued,
    /// `agy` is running.
    Writing,
    /// The last call failed (often a rate limit); retrying at `retry_at`.
    Backoff,
    /// Needs the user: CLI missing or not logged in.
    Paused,
}

/// Snapshot for the Activity view's status pill.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub phase: Phase,
    pub enabled: bool,
    pub engine: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_note_at: Option<i64>,
    /// Epoch ms of the next retry while in `Backoff`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_at: Option<i64>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum AgentError {
    Missing,
    Auth(String),
    RateLimited(String),
    Other(String),
}

impl AgentError {
    fn message(&self) -> String {
        match self {
            AgentError::Missing => {
                "Antigravity CLI (agy) was not found. Install it, run `agy` once to sign in, then retry."
                    .into()
            }
            AgentError::Auth(detail) => {
                format!("Antigravity CLI needs you to sign in. Run `agy` once in a terminal, then retry. ({detail})")
            }
            AgentError::RateLimited(detail) => {
                format!("Antigravity quota or rate limit hit; retrying automatically. ({detail})")
            }
            AgentError::Other(detail) => detail.clone(),
        }
    }
}

struct State {
    enabled: bool,
    tz_offset_min: i64,
    first_kick: Option<Instant>,
    last_kick: Option<Instant>,
    phase: Phase,
    last_error: Option<String>,
    last_note_at: Option<i64>,
    retry_after: Option<Instant>,
    retry_at_ms: Option<i64>,
    failures: u32,
    running_pid: Option<u32>,
    usage: DailyUsage,
    shutdown: bool,
}

/// What the notes worker did today, for the Process Monitor.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyUsage {
    /// Local day number (days since epoch in the viewer's zone) the counts belong to.
    #[serde(skip)]
    day: i64,
    pub calls: u32,
    pub notes: u32,
    pub failures: u32,
}

impl DailyUsage {
    fn roll(&mut self, now_ms: i64, tz_offset_min: i64) {
        let day = (now_ms + tz_offset_min * 60_000).div_euclid(86_400_000);
        if day != self.day {
            *self = DailyUsage {
                day,
                ..DailyUsage::default()
            };
        }
    }
}

/// Process Monitor view of the tracker: state, today's counts, and the live
/// `agy` process (its CPU and memory are read by `process_stats`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUsage {
    pub phase: Phase,
    pub enabled: bool,
    pub today: DailyUsage,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub running_pid: Option<u32>,
}

struct Shared {
    state: Mutex<State>,
    wake: Condvar,
}

/// Tauri-managed handle to the notes worker.
pub struct NotesAgent {
    shared: Arc<Shared>,
}

impl NotesAgent {
    pub fn new() -> Self {
        Self {
            shared: Arc::new(Shared {
                state: Mutex::new(State {
                    enabled: false,
                    tz_offset_min: 0,
                    first_kick: None,
                    last_kick: None,
                    phase: Phase::Off,
                    last_error: None,
                    last_note_at: None,
                    retry_after: None,
                    retry_at_ms: None,
                    failures: 0,
                    running_pid: None,
                    usage: DailyUsage::default(),
                    shutdown: false,
                }),
                wake: Condvar::new(),
            }),
        }
    }

    /// Start the background worker. Call once from app setup.
    pub fn start(&self, app: AppHandle) {
        let shared = Arc::clone(&self.shared);
        let spawned = thread::Builder::new()
            .name("activity-notes".into())
            .spawn(move || worker(app, shared));
        if let Err(err) = spawned {
            eprintln!("monocode: activity: notes worker failed to start: {err}");
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        lock_state(&self.shared)
    }

    pub fn status(&self) -> AgentStatus {
        snapshot(&self.lock())
    }

    /// Today's counts and the running `agy` pid, for the Process Monitor.
    pub fn usage(&self) -> AgentUsage {
        let mut state = self.lock();
        let tz = state.tz_offset_min;
        state.usage.roll(now_millis(), tz);
        AgentUsage {
            phase: state.phase,
            enabled: state.enabled,
            today: state.usage,
            running_pid: state.running_pid,
        }
    }

    /// Turn notes on/off and record the viewer's UTC offset for note times.
    /// Enabling also kicks once so events missed while off get picked up.
    pub fn configure(&self, enabled: bool, tz_offset_min: i64) -> AgentStatus {
        let mut state = self.lock();
        state.tz_offset_min = tz_offset_min.clamp(-14 * 60, 14 * 60);
        let was_enabled = state.enabled;
        state.enabled = enabled;
        if !enabled {
            state.phase = Phase::Off;
            state.first_kick = None;
            state.last_kick = None;
        } else if !was_enabled {
            state.phase = Phase::Idle;
            state.failures = 0;
            state.retry_after = None;
            state.retry_at_ms = None;
            kick_locked(&mut state);
        }
        let status = snapshot(&state);
        drop(state);
        self.shared.wake.notify_all();
        status
    }

    /// A new event was stored; schedule a note.
    pub fn kick(&self, tz_offset_min: Option<i64>) {
        let mut state = self.lock();
        if let Some(offset) = tz_offset_min {
            state.tz_offset_min = offset.clamp(-14 * 60, 14 * 60);
        }
        if !state.enabled {
            return;
        }
        kick_locked(&mut state);
        drop(state);
        self.shared.wake.notify_all();
    }

    /// Clear a pause or backoff and try again now.
    pub fn retry(&self) -> AgentStatus {
        let mut state = self.lock();
        if state.enabled {
            state.failures = 0;
            state.retry_after = None;
            state.retry_at_ms = None;
            state.last_error = None;
            state.phase = Phase::Idle;
            kick_locked(&mut state);
            // Skip the debounce: the user asked for it.
            state.first_kick = Some(Instant::now() - MAX_BATCH_WAIT);
        }
        let status = snapshot(&state);
        drop(state);
        self.shared.wake.notify_all();
        status
    }

    /// Stop the worker and kill a running `agy` (app quit).
    pub fn shutdown(&self) {
        let mut state = self.lock();
        state.shutdown = true;
        let pid = state.running_pid.take();
        drop(state);
        self.shared.wake.notify_all();
        if let Some(pid) = pid {
            terminate(pid);
        }
    }
}

impl Default for NotesAgent {
    fn default() -> Self {
        Self::new()
    }
}

fn lock_state(shared: &Shared) -> MutexGuard<'_, State> {
    // A panic while holding the lock only leaves plain data behind; keep going.
    shared
        .state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn kick_locked(state: &mut State) {
    let now = Instant::now();
    state.first_kick.get_or_insert(now);
    state.last_kick = Some(now);
    if matches!(state.phase, Phase::Idle | Phase::Off) {
        state.phase = Phase::Queued;
    }
}

fn snapshot(state: &State) -> AgentStatus {
    AgentStatus {
        phase: state.phase,
        enabled: state.enabled,
        engine: "agy",
        binary: resolve_agy().map(|path| path.to_string_lossy().into_owned()),
        last_error: state.last_error.clone(),
        last_note_at: state.last_note_at,
        retry_at: state.retry_at_ms,
    }
}

fn emit_status(app: &AppHandle, shared: &Shared) {
    let status = snapshot(&lock_state(shared));
    let _ = app.emit(STATUS_EVENT, status);
}

/// When the pending batch may run, or `None` if there is nothing to do.
fn due_at(state: &State) -> Option<Instant> {
    if !state.enabled || state.phase == Phase::Paused {
        return None;
    }
    let last = state.last_kick?;
    let first = state.first_kick.unwrap_or(last);
    let mut due = (last + DEBOUNCE).min(first + MAX_BATCH_WAIT);
    if let Some(retry) = state.retry_after {
        due = due.max(retry);
    }
    Some(due)
}

fn worker(app: AppHandle, shared: Arc<Shared>) {
    loop {
        {
            let mut state = lock_state(&shared);
            loop {
                if state.shutdown {
                    return;
                }
                match due_at(&state) {
                    Some(due) => {
                        let now = Instant::now();
                        if now >= due {
                            break;
                        }
                        state = shared
                            .wake
                            .wait_timeout(state, due - now)
                            .map(|(guard, _)| guard)
                            .unwrap_or_else(|poisoned| poisoned.into_inner().0);
                    }
                    None => {
                        state = shared
                            .wake
                            .wait(state)
                            .unwrap_or_else(|poisoned| poisoned.into_inner());
                    }
                }
            }
            state.first_kick = None;
            state.last_kick = None;
            state.phase = Phase::Writing;
        }
        emit_status(&app, &shared);

        let outcome = run_batch(&app, &shared);

        {
            let mut state = lock_state(&shared);
            if state.shutdown {
                return;
            }
            let tz = state.tz_offset_min;
            state.usage.roll(now_millis(), tz);
            match &outcome {
                Ok(BatchOutcome::Wrote { .. }) => state.usage.notes += 1,
                Ok(BatchOutcome::Nothing) => {}
                Err(_) => state.usage.failures = state.usage.failures.saturating_add(1),
            }
            match outcome {
                Ok(BatchOutcome::Wrote { more }) => {
                    state.failures = 0;
                    state.retry_after = None;
                    state.retry_at_ms = None;
                    state.last_error = None;
                    state.last_note_at = Some(now_millis());
                    state.phase = if state.enabled {
                        Phase::Idle
                    } else {
                        Phase::Off
                    };
                    if more && state.enabled {
                        kick_locked(&mut state);
                        state.first_kick = Some(Instant::now() - MAX_BATCH_WAIT);
                    }
                }
                Ok(BatchOutcome::Nothing) => {
                    state.phase = if state.enabled {
                        Phase::Idle
                    } else {
                        Phase::Off
                    };
                }
                Err(err @ (AgentError::Missing | AgentError::Auth(_))) => {
                    state.last_error = Some(err.message());
                    state.phase = Phase::Paused;
                }
                Err(err) => {
                    state.failures = state.failures.saturating_add(1);
                    let wait = backoff(state.failures);
                    state.retry_after = Some(Instant::now() + wait);
                    state.retry_at_ms = Some(now_millis() + wait.as_millis() as i64);
                    state.last_error = Some(err.message());
                    state.phase = Phase::Backoff;
                    // Keep the events pending; they run once the backoff ends.
                    kick_locked(&mut state);
                }
            }
            // If the user turned notes off mid-run, honour that.
            if !state.enabled {
                state.phase = Phase::Off;
            }
        }
        emit_status(&app, &shared);
        let _ = app.emit(CHANGED_EVENT, ());
    }
}

/// 30 s, 60 s, 2 min, … capped at 15 min.
pub fn backoff(failures: u32) -> Duration {
    let exp = failures.saturating_sub(1).min(10);
    let wait = BACKOFF_BASE.saturating_mul(1u32 << exp);
    wait.min(BACKOFF_MAX)
}

enum BatchOutcome {
    Wrote { more: bool },
    Nothing,
}

fn run_batch(app: &AppHandle, shared: &Arc<Shared>) -> Result<BatchOutcome, AgentError> {
    let store = app.state::<SessionStore>();
    let now = now_millis();
    let (events, more, previous) = {
        let conn = store.lock_conn().map_err(AgentError::Other)?;
        let after =
            store::last_noted_event_id(&conn).map_err(|e| AgentError::Other(e.to_string()))?;
        let mut events = store::unnoted_events(&conn, after, now - LOOKBACK_MS, BATCH_LIMIT + 1)
            .map_err(|e| AgentError::Other(e.to_string()))?;
        let more = events.len() > BATCH_LIMIT;
        events.truncate(BATCH_LIMIT);
        let previous = store::latest_note(&conn).map_err(|e| AgentError::Other(e.to_string()))?;
        (events, more, previous)
    };
    let (Some(first), Some(last)) = (events.first(), events.last()) else {
        return Ok(BatchOutcome::Nothing);
    };
    let first_id = first.id;
    let last_id = last.id;

    let binary = resolve_agy().ok_or(AgentError::Missing)?;

    // App and meeting context since the previous note (or the first event).
    let context_start = previous
        .as_ref()
        .map(|note| note.ts)
        .unwrap_or(first.ts - 5 * 60_000)
        .max(now - 3 * 60 * 60_000);
    let aw_summary = aw::summary(context_start, now);
    let tz = lock_state(shared).tz_offset_min;
    let prompt = build_prompt(
        &events,
        previous.as_ref().map(|note| note.body.as_str()),
        aw_summary.available.then_some(&aw_summary),
        tz,
    );

    let workdir = scratch_dir(app)?;
    let body = run_agy(&binary, &prompt, &workdir, shared)?;

    let conn = store.lock_conn().map_err(AgentError::Other)?;
    store::insert_note(&conn, now_millis(), first_id, last_id, &body)
        .map_err(|e| AgentError::Other(e.to_string()))?;
    Ok(BatchOutcome::Wrote { more })
}

/// An empty folder for `agy` to run in, so a stray tool call cannot touch a repo.
fn scratch_dir(app: &AppHandle) -> Result<PathBuf, AgentError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AgentError::Other(e.to_string()))?
        .join("activity-agent");
    std::fs::create_dir_all(&dir).map_err(|e| AgentError::Other(e.to_string()))?;
    Ok(dir)
}

fn run_agy(
    binary: &Path,
    prompt: &str,
    workdir: &Path,
    shared: &Arc<Shared>,
) -> Result<String, AgentError> {
    let command = binary.to_string_lossy().into_owned();
    let prompt = shim_safe_prompt(binary, prompt);
    let mut cmd = Command::new(binary);
    cmd.args(["-p", prompt.as_str(), "--output-format", "json"])
        .current_dir(workdir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    prepare_child(&mut cmd, &command).map_err(AgentError::Other)?;

    let child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AgentError::Missing
        } else {
            AgentError::Other(format!("Could not start agy: {e}"))
        }
    })?;
    let pid = child.id();
    {
        let mut state = lock_state(shared);
        state.running_pid = Some(pid);
        let tz = state.tz_offset_min;
        state.usage.roll(now_millis(), tz);
        state.usage.calls = state.usage.calls.saturating_add(1);
    }

    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    let result = rx.recv_timeout(RUN_TIMEOUT);
    lock_state(shared).running_pid = None;

    match result {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            parse_agy_output(&stdout, &stderr, output.status.success())
        }
        Ok(Err(e)) => Err(AgentError::Other(format!("agy failed: {e}"))),
        Err(_) => {
            terminate(pid);
            Err(AgentError::Other(
                "agy took too long and was stopped.".into(),
            ))
        }
    }
}

/// Windows runs `.cmd`/`.bat` shims through `cmd.exe`, and Rust refuses to
/// pass an argument containing a newline to one (it cannot be escaped safely).
/// Flatten the prompt for shims only; real executables keep the line breaks.
fn shim_safe_prompt(binary: &Path, prompt: &str) -> String {
    let is_shim = binary
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("cmd") || ext.eq_ignore_ascii_case("bat"));
    if is_shim {
        prompt
            .lines()
            .map(str::trim_end)
            .collect::<Vec<_>>()
            .join(" | ")
    } else {
        prompt.to_string()
    }
}

/// Pull the note text out of `agy --output-format json`.
///
/// The documented envelope has the answer in a top-level `response`; stream
/// output nests it as `result.response`. Plain text is accepted as a fallback
/// so a CLI update that changes the format degrades instead of failing.
pub fn parse_agy_output(stdout: &str, stderr: &str, success: bool) -> Result<String, AgentError> {
    let trimmed = stdout.trim();
    let envelope = serde_json::from_str::<Value>(trimmed).ok().or_else(|| {
        trimmed
            .lines()
            .rev()
            .find_map(|line| serde_json::from_str::<Value>(line.trim()).ok())
    });

    if let Some(value) = envelope.as_ref().filter(|v| v.is_object()) {
        let status = value
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_ascii_uppercase();
        let response = value
            .get("response")
            .and_then(Value::as_str)
            .or_else(|| value.pointer("/result/response").and_then(Value::as_str));
        if status == "ERROR" || response.is_none() {
            let detail = value
                .get("error")
                .map(|err| match err {
                    Value::String(s) => s.clone(),
                    other => other
                        .get("message")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .unwrap_or_else(|| other.to_string()),
                })
                .unwrap_or_else(|| format!("{} {}", status, stderr.trim()).trim().to_string());
            if status == "WAITING" {
                return Err(AgentError::Other(
                    "agy stopped to ask for approval; notes never need tools.".into(),
                ));
            }
            return Err(classify(&detail));
        }
        let text = sanitize_note(response.unwrap_or(""));
        if text.is_empty() {
            return Err(AgentError::Other("agy returned an empty note.".into()));
        }
        return Ok(text);
    }

    if success && !trimmed.is_empty() {
        return Ok(sanitize_note(trimmed));
    }
    let detail = if stderr.trim().is_empty() {
        trimmed
    } else {
        stderr.trim()
    };
    Err(classify(if detail.is_empty() {
        "agy exited without output"
    } else {
        detail
    }))
}

/// Sort a failure into something the worker can act on.
pub fn classify(detail: &str) -> AgentError {
    let short: String = detail.trim().chars().take(240).collect();
    let lower = short.to_ascii_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|needle| lower.contains(needle));
    if has(&[
        "429",
        "rate limit",
        "rate-limit",
        "quota",
        "resource_exhausted",
        "too many requests",
    ]) {
        AgentError::RateLimited(short)
    } else if has(&[
        "authentication required",
        "unauthenticated",
        "not logged in",
        "login required",
        "please log in",
        "please sign in",
        "status 401",
    ]) {
        AgentError::Auth(short)
    } else {
        AgentError::Other(if short.is_empty() {
            "agy failed".into()
        } else {
            short
        })
    }
}

fn sanitize_note(text: &str) -> String {
    let text = text.replace("\r\n", "\n");
    let text = text.trim();
    if text.chars().count() <= NOTE_MAX_CHARS {
        return text.to_string();
    }
    let mut cut: String = text.chars().take(NOTE_MAX_CHARS).collect();
    cut.push('…');
    cut
}

fn clip(text: &str, max: usize) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max {
        return flat;
    }
    let mut cut: String = flat.chars().take(max).collect();
    cut.push('…');
    cut
}

fn project_name(cwd: &str) -> &str {
    let trimmed = cwd.trim_end_matches(['/', '\\']);
    trimmed
        .rsplit(['/', '\\'])
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or(trimmed)
}

/// The text sent to `agy`. Only prompt text, a short reply excerpt, repo,
/// branch, harness, app names, website domains, and meeting times — never
/// window or tab titles, full URLs, file contents, or tool output.
pub fn build_prompt(
    events: &[ActivityEvent],
    previous_note: Option<&str>,
    aw_summary: Option<&aw::AwSummary>,
    tz_offset_min: i64,
) -> String {
    let mut out = String::new();
    out.push_str(
        "You are Hari's activity scribe. Hari is a desktop app where a developer drives AI coding agents.\n\
         Write a short work-log entry for the new events below.\n\
         Rules:\n\
         - 1 to 3 bullet points, each starting with \"- \", past tense, at most 25 words each.\n\
         - Say which project and what was worked on; mention meetings if listed.\n\
         - Use only the information below. Do not run tools, open files, browse, or ask questions.\n\
         - Reply with the bullet points only.\n",
    );
    if let Some(previous) = previous_note.map(str::trim).filter(|p| !p.is_empty()) {
        out.push_str("\nPrevious entry (for continuity; do not repeat it):\n");
        out.push_str(&clip(previous, 800));
        out.push('\n');
    }
    if let Some(summary) = aw_summary {
        let apps: Vec<String> = summary
            .apps
            .iter()
            .take(5)
            .map(|app| format!("{} {}", app.app, format_duration(app.ms)))
            .collect();
        let meetings: Vec<String> = summary
            .meetings
            .iter()
            .map(|m| {
                format!(
                    "{} {}–{}",
                    m.label,
                    format_clock(m.start, tz_offset_min),
                    format_clock(m.end, tz_offset_min)
                )
            })
            .collect();
        let sites: Vec<String> = summary
            .sites
            .iter()
            .take(5)
            .map(|site| format!("{} {}", site.domain, format_duration(site.ms)))
            .collect();
        if !apps.is_empty() || !meetings.is_empty() || !sites.is_empty() {
            out.push_str("\nDesktop context (app names and website domains only):\n");
            if !apps.is_empty() {
                out.push_str(&format!("- Top apps: {}\n", apps.join(", ")));
            }
            if !sites.is_empty() {
                out.push_str(&format!("- Top sites: {}\n", sites.join(", ")));
            }
            if !meetings.is_empty() {
                out.push_str(&format!("- Meetings: {}\n", meetings.join(", ")));
            }
        }
    }
    out.push_str("\nEvents:\n");
    for event in events {
        let when = format_clock(event.ts, tz_offset_min);
        let project = project_name(&event.cwd);
        let branch = event
            .branch
            .as_deref()
            .map(|b| format!(" (branch {b})"))
            .unwrap_or_default();
        match event.kind.as_str() {
            "turn" => {
                let took = event
                    .duration_ms
                    .map(|ms| format!(" after {}", format_duration(ms)))
                    .unwrap_or_default();
                let reply = clip(&event.text, REPLY_TEXT_CHARS);
                if reply.is_empty() {
                    out.push_str(&format!(
                        "[{when}] {} agent finished in {project}{branch}{took}\n",
                        event.harness
                    ));
                } else {
                    out.push_str(&format!(
                        "[{when}] {} agent finished in {project}{branch}{took}. Reply excerpt: \"{reply}\"\n",
                        event.harness
                    ));
                }
            }
            _ => {
                out.push_str(&format!(
                    "[{when}] Prompt to {} in {project}{branch}: \"{}\"\n",
                    event.harness,
                    clip(&event.text, PROMPT_TEXT_CHARS)
                ));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(id: i64, kind: &str, text: &str) -> ActivityEvent {
        ActivityEvent {
            id,
            ts: 1_794_312_896_789,
            kind: kind.into(),
            session_id: "s1".into(),
            harness: "claude".into(),
            model: "opus".into(),
            cwd: "/home/me/code/hari/".into(),
            branch: Some("main".into()),
            title: "Fix tabs".into(),
            text: text.into(),
            duration_ms: (kind == "turn").then_some(190_000),
        }
    }

    #[test]
    fn reads_documented_json_envelope() {
        let out = r#"{"status":"SUCCESS","response":"- Fixed tabs in hari."}"#;
        assert_eq!(
            parse_agy_output(out, "", true),
            Ok("- Fixed tabs in hari.".into())
        );
    }

    #[test]
    fn reads_stream_result_and_plain_text() {
        let stream =
            "{\"type\":\"progress\"}\n{\"type\":\"result\",\"result\":{\"response\":\"- Done\"}}\n";
        assert_eq!(parse_agy_output(stream, "", true), Ok("- Done".into()));
        assert_eq!(
            parse_agy_output("  - Plain  \n", "", true),
            Ok("- Plain".into())
        );
    }

    #[test]
    fn classifies_failures() {
        assert!(matches!(
            parse_agy_output(
                r#"{"status":"ERROR","error":{"message":"429 RESOURCE_EXHAUSTED"}}"#,
                "",
                false
            ),
            Err(AgentError::RateLimited(_))
        ));
        assert!(matches!(
            parse_agy_output("", "Error: authentication required", false),
            Err(AgentError::Auth(_))
        ));
        assert!(matches!(
            parse_agy_output(r#"{"status":"WAITING"}"#, "", true),
            Err(AgentError::Other(_))
        ));
        assert!(matches!(
            parse_agy_output("", "", false),
            Err(AgentError::Other(_))
        ));
    }

    #[test]
    fn daily_usage_resets_at_local_midnight() {
        let mut usage = DailyUsage::default();
        let day_ms = 86_400_000_i64;
        // 23:00 UTC is 04:30 next day in IST (+330).
        let late = 20_000 * day_ms + 23 * 3_600_000;
        usage.roll(late, 0);
        usage.calls = 3;
        usage.roll(late + 10 * 60_000, 0);
        assert_eq!(usage.calls, 3);
        usage.roll(late + 2 * 3_600_000, 0);
        assert_eq!(usage.calls, 0);
        usage.calls = 1;
        usage.roll(late + 2 * 3_600_000, 330);
        assert_eq!(usage.calls, 1, "same IST day as the previous roll");
    }

    #[test]
    fn flattens_prompts_only_for_windows_shims() {
        let prompt = "a\nb\n";
        assert_eq!(shim_safe_prompt(Path::new("C:/x/agy.cmd"), prompt), "a | b");
        assert_eq!(shim_safe_prompt(Path::new("C:/x/agy.BAT"), prompt), "a | b");
        assert_eq!(shim_safe_prompt(Path::new("/usr/bin/agy"), prompt), prompt);
    }

    #[test]
    fn backoff_grows_and_caps() {
        assert_eq!(backoff(1), Duration::from_secs(30));
        assert_eq!(backoff(2), Duration::from_secs(60));
        assert_eq!(backoff(4), Duration::from_secs(240));
        assert_eq!(backoff(30), BACKOFF_MAX);
    }

    #[test]
    fn prompt_lists_events_without_leaking_titles() {
        let summary = aw::AwSummary {
            available: true,
            apps: vec![aw::AppUsage {
                app: "Code".into(),
                ms: 25 * 60_000,
            }],
            sites: vec![aw::SiteUsage {
                domain: "github.com".into(),
                ms: 40 * 60_000,
                titles: vec!["Secret PR title".into()],
            }],
            meetings: vec![aw::Meeting {
                start: 1_794_312_000_000,
                end: 1_794_313_800_000,
                label: "Zoom".into(),
            }],
            ..aw::AwSummary::default()
        };
        let prompt = build_prompt(
            &[
                event(1, "prompt", "add   a\nretry button"),
                event(2, "turn", "Added it."),
            ],
            Some("- Earlier work"),
            Some(&summary),
            330,
        );
        assert!(prompt
            .contains("[17:44] Prompt to claude in hari (branch main): \"add a retry button\""));
        assert!(prompt.contains(
            "claude agent finished in hari (branch main) after 3m. Reply excerpt: \"Added it.\""
        ));
        assert!(prompt.contains("- Top apps: Code 25m"));
        assert!(prompt.contains("- Meetings: Zoom 17:30–18:00"));
        assert!(prompt.contains("- Top sites: github.com 40m"));
        assert!(!prompt.contains("Secret PR title"), "tab titles stay local");
        assert!(prompt.contains("Previous entry"));
        // Session titles are not part of the prompt.
        assert!(!prompt.contains("Fix tabs"));
    }

    #[test]
    fn clips_long_text() {
        let long = "word ".repeat(400);
        assert!(clip(&long, 50).chars().count() <= 51);
        assert_eq!(project_name("/a/b/repo"), "repo");
        assert_eq!(project_name("C:\\code\\repo\\"), "repo");
    }
}
