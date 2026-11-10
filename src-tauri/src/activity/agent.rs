//! Always-on activity scribe powered by Google's Antigravity CLI (`agy`).
//!
//! Every recorded prompt or finished agent turn "kicks" one background
//! worker. The worker waits a few seconds so a burst of events becomes one
//! call, then runs `agy -p <prompt> --output-format json` in an empty folder
//! and stores the reply as a note. Calls never overlap, a rate limit backs
//! off instead of hammering the quota, and a missing or logged-out CLI pauses
//! the worker with a reason the Activity view can show.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use super::store::{self, ActivityDb, ActivityEvent};
use super::time::{format_clock, format_duration};
use super::{aw, CHANGED_EVENT};
use crate::harness::{prepare_child, resolve_agy, terminate};
use crate::session_store::now_millis;

pub const STATUS_EVENT: &str = "activity-agent-status";

/// Quiet period after the latest event before a note is written.
const DEBOUNCE: Duration = Duration::from_secs(4);
/// A steady stream of events still gets a note at least this often.
const MAX_BATCH_WAIT: Duration = Duration::from_secs(20);
const RUN_TIMEOUT: Duration = Duration::from_secs(180);
/// agy's own limit for one turn, a little under ours.
const PRINT_TIMEOUT: &str = "170s";
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
    /// Today's calls, notes and failures.
    pub today: DailyUsage,
    /// What the most recent `agy` run returned, for the pill menu.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run: Option<LastRun>,
}

/// Evidence from the latest `agy` run: whether it produced a note, why not,
/// and the head of its raw output so a user can copy it into a bug report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastRun {
    pub at: i64,
    pub ok: bool,
    /// One plain line: "Wrote a note (120 characters)" or the error.
    pub summary: String,
    /// Exit code, then the start of stdout and stderr.
    pub output: String,
}

const OUTPUT_HEAD_CHARS: usize = 2_000;

fn head(text: &str, max: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max {
        return trimmed.to_string();
    }
    let mut cut: String = trimmed.chars().take(max).collect();
    cut.push('…');
    cut
}

/// Build the [`LastRun`] record for one finished (or failed) process.
pub fn last_run_record(
    at: i64,
    result: &Result<String, AgentError>,
    exit: Option<i32>,
    stdout: &str,
    stderr: &str,
) -> LastRun {
    let summary = match result {
        Ok(note) => format!("Wrote a note ({} characters)", note.chars().count()),
        Err(err) => err.message(),
    };
    let exit = exit.map_or_else(|| "none".to_string(), |code| code.to_string());
    LastRun {
        at,
        ok: result.is_ok(),
        summary,
        output: format!(
            "exit code: {exit}\n--- stdout ---\n{}\n--- stderr ---\n{}",
            head(stdout, OUTPUT_HEAD_CHARS),
            head(stderr, OUTPUT_HEAD_CHARS / 2)
        ),
    }
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
    last_run: Option<LastRun>,
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
                    last_run: None,
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

    /// Run one `agy` prompt now (period summaries). Waits for any note in
    /// progress, counts toward today's usage, and shows in the Process Monitor.
    pub fn run_once(&self, app: &AppHandle, prompt: &str) -> Result<String, String> {
        let binary = resolve_agy().ok_or_else(|| AgentError::Missing.message())?;
        let workdir = scratch_dir(app).map_err(|e| e.message())?;
        let result = run_agy(&binary, prompt, &workdir, &self.shared);
        let mut state = self.lock();
        let tz = state.tz_offset_min;
        state.usage.roll(now_millis(), tz);
        if result.is_err() {
            state.usage.failures = state.usage.failures.saturating_add(1);
        }
        drop(state);
        result.map_err(|e| e.message())
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
    let mut today = state.usage;
    today.roll(now_millis(), state.tz_offset_min);
    AgentStatus {
        phase: state.phase,
        enabled: state.enabled,
        engine: "agy",
        binary: resolve_agy().map(|path| path.to_string_lossy().into_owned()),
        last_error: state.last_error.clone(),
        last_note_at: state.last_note_at,
        retry_at: state.retry_at_ms,
        today,
        last_run: state.last_run.clone(),
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
    let db = app.state::<ActivityDb>();
    let now = now_millis();
    let (mut events, previous) = db
        .with(|conn| {
            let after = store::last_noted_event_id(conn)?;
            let events = store::unnoted_events(conn, after, now - LOOKBACK_MS, BATCH_LIMIT + 1)?;
            Ok((events, store::latest_note(conn)?))
        })
        .map_err(AgentError::Other)?;
    let more = events.len() > BATCH_LIMIT;
    events.truncate(BATCH_LIMIT);
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

    db.with(|conn| store::insert_note(conn, now_millis(), first_id, last_id, &body))
        .map_err(AgentError::Other)?;
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

/// One `agy` at a time across the notes worker and on-demand summaries, so
/// "calls never overlap" holds for the user's quota whatever asks.
static AGY_GATE: Mutex<()> = Mutex::new(());

fn run_agy(
    binary: &Path,
    prompt: &str,
    workdir: &Path,
    shared: &Arc<Shared>,
) -> Result<String, AgentError> {
    let _turn = AGY_GATE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let command = binary.to_string_lossy().into_owned();
    // Same headless protocol as the Antigravity CLI provider and AI helpers
    // (L-208): the prompt goes in on stdin as one stream-json user message,
    // so its size and line breaks never touch the command line.
    let mut cmd = Command::new(binary);
    cmd.args([
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--print-timeout",
        PRINT_TIMEOUT,
    ])
    .current_dir(workdir)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    prepare_child(&mut cmd, &command).map_err(AgentError::Other)?;

    let mut child = cmd.spawn().map_err(|e| {
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

    let (tx, rx) = mpsc::channel::<String>();
    if let Some(stdout) = child.stdout.take() {
        let tx = tx.clone();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
    }
    drop(tx);
    let stderr_text = Arc::new(Mutex::new(String::new()));
    if let Some(mut stderr) = child.stderr.take() {
        let sink = Arc::clone(&stderr_text);
        thread::spawn(move || {
            let mut text = String::new();
            let _ = stderr.read_to_string(&mut text);
            *sink.lock().unwrap_or_else(|p| p.into_inner()) = text;
        });
    }
    // Keep stdin open until the result arrives: closing it can end the session early.
    let mut stdin = child.stdin.take();
    let written = stdin.as_mut().map(|pipe| {
        pipe.write_all(user_message(prompt).as_bytes())
            .and_then(|()| pipe.flush())
    });

    let deadline = Instant::now() + RUN_TIMEOUT;
    let mut stream = StreamText::default();
    let mut raw = String::new();
    let mut outcome: Option<Result<String, AgentError>> = match written {
        Some(Ok(())) => None,
        Some(Err(e)) => Some(Err(AgentError::Other(format!(
            "Could not send the prompt to agy: {e}"
        )))),
        None => Some(Err(AgentError::Other("agy has no input pipe.".into()))),
    };
    while outcome.is_none() {
        let left = deadline.saturating_duration_since(Instant::now());
        match rx.recv_timeout(left) {
            Ok(line) => {
                if raw.chars().count() < OUTPUT_HEAD_CHARS {
                    raw.push_str(&line);
                    raw.push('\n');
                }
                outcome = stream.feed(&line);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                outcome = Some(Err(AgentError::Other(
                    "agy took too long and was stopped.".into(),
                )));
            }
            // stdout closed: agy exited without a result event.
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                thread::sleep(Duration::from_millis(100)); // let stderr finish reading
                let stderr = stderr_text
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .clone();
                let detail = if stderr.trim().is_empty() {
                    "agy exited without a reply."
                } else {
                    stderr.trim()
                };
                outcome = Some(Err(classify(detail)));
            }
        }
    }
    drop(stdin.take());
    // One-shot: stop agy (and anything it started) as soon as the reply is in.
    terminate(pid);
    let exit = wait_briefly(&mut child);
    lock_state(shared).running_pid = None;

    let parsed =
        outcome.unwrap_or_else(|| Err(AgentError::Other("agy produced no outcome.".into())));
    let stderr = stderr_text
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone();
    let record = last_run_record(now_millis(), &parsed, exit, &raw, &stderr);
    lock_state(shared).last_run = Some(record);
    parsed
}

/// Reap the stopped child without hanging the worker if it lingers.
fn wait_briefly(child: &mut std::process::Child) -> Option<i32> {
    let until = Instant::now() + Duration::from_secs(3);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.code(),
            Ok(None) if Instant::now() < until => thread::sleep(Duration::from_millis(50)),
            _ => return None,
        }
    }
}

/// One stream-json user message, as agy reads it on stdin.
pub fn user_message(text: &str) -> String {
    let mut line =
        serde_json::json!({ "event": "user", "message": { "content": text } }).to_string();
    line.push('\n');
    line
}

/// Collects agy's stream-json events for one turn.
#[derive(Debug, Default)]
pub struct StreamText {
    text: String,
}

impl StreamText {
    /// Feed one stdout line. Returns the outcome once the turn ends:
    /// `result` with `SUCCESS` gives the note; a failed result or any tool
    /// step is an error (notes never need tools). Non-JSON lines are ignored.
    pub fn feed(&mut self, line: &str) -> Option<Result<String, AgentError>> {
        let event: Value = serde_json::from_str(line.trim()).ok()?;
        match event.get("event").and_then(Value::as_str)? {
            "step_update" => {
                let step = event.get("step_update")?;
                match step.get("step_type").and_then(Value::as_str) {
                    Some("agent_response") => {
                        if let Some(delta) = step.get("text_delta").and_then(Value::as_str) {
                            self.text.push_str(delta);
                        }
                        None
                    }
                    Some("tool") => Some(Err(AgentError::Other(
                        "agy tried to use a tool; notes never need tools.".into(),
                    ))),
                    _ => None,
                }
            }
            "result" => {
                let result = event.get("result")?;
                let status = result.get("status").and_then(Value::as_str).unwrap_or("");
                if status.eq_ignore_ascii_case("SUCCESS") {
                    let response = result.get("response").and_then(Value::as_str).unwrap_or("");
                    let text = sanitize_note(if response.trim().is_empty() {
                        &self.text
                    } else {
                        response
                    });
                    if text.is_empty() {
                        return Some(Err(AgentError::Other("agy returned an empty note.".into())));
                    }
                    return Some(Ok(text));
                }
                let error = result
                    .get("error")
                    .map(|err| match err {
                        Value::String(text) => text.clone(),
                        other => other
                            .get("message")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                            .unwrap_or_else(|| other.to_string()),
                    })
                    .unwrap_or_else(|| format!("agy finished with status {status}"));
                Some(Err(classify(&error)))
            }
            _ => None,
        }
    }
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

    fn feed_all(lines: &[&str]) -> Option<Result<String, AgentError>> {
        let mut stream = StreamText::default();
        lines.iter().find_map(|line| stream.feed(line))
    }

    #[test]
    fn writes_one_stream_json_user_message() {
        let line = user_message("say \"hi\"\nthen stop");
        assert!(line.ends_with('\n'));
        let value: Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(value["event"], "user");
        assert_eq!(value["message"]["content"], "say \"hi\"\nthen stop");
    }

    #[test]
    fn reads_the_note_from_stream_events() {
        let init = r#"{"event":"init","conversation_id":"c1"}"#;
        let delta_a = r#"{"event":"step_update","step_update":{"step_index":1,"step_type":"agent_response","text_delta":"- Fixed "}}"#;
        let delta_b = r#"{"event":"step_update","step_update":{"step_index":1,"step_type":"agent_response","text_delta":"tabs."}}"#;
        let thought = r#"{"event":"step_update","step_update":{"step_index":0,"step_type":"agent_thought","text_delta":"hmm"}}"#;
        let done = r#"{"event":"result","result":{"status":"SUCCESS","response":""}}"#;
        // Empty `response` falls back to the streamed text; noise lines are ignored.
        assert_eq!(
            feed_all(&["Loading…", init, thought, delta_a, delta_b, done]),
            Some(Ok("- Fixed tabs.".into()))
        );
        let full = r#"{"event":"result","result":{"status":"SUCCESS","response":"- Whole reply"}}"#;
        assert_eq!(feed_all(&[delta_a, full]), Some(Ok("- Whole reply".into())));
        assert_eq!(feed_all(&[init, delta_a]), None, "no result yet");
    }

    #[test]
    fn classifies_stream_failures() {
        let limited =
            r#"{"event":"result","result":{"status":"ERROR","error":"429 RESOURCE_EXHAUSTED"}}"#;
        assert!(matches!(
            feed_all(&[limited]),
            Some(Err(AgentError::RateLimited(_)))
        ));
        let auth = r#"{"event":"result","result":{"status":"ERROR","error":{"message":"authentication required"}}}"#;
        assert!(matches!(feed_all(&[auth]), Some(Err(AgentError::Auth(_)))));
        let tool = r#"{"event":"step_update","step_update":{"step_index":2,"step_type":"tool","tool_name":"read_file"}}"#;
        assert!(matches!(feed_all(&[tool]), Some(Err(AgentError::Other(_)))));
        let empty = r#"{"event":"result","result":{"status":"SUCCESS","response":"  "}}"#;
        assert!(matches!(
            feed_all(&[empty]),
            Some(Err(AgentError::Other(_)))
        ));
    }

    /// A stand-in `agy` that checks its flags, reads one stdin message, and
    /// replies with stream-json, then waits (like the real one) until stopped.
    #[cfg(unix)]
    fn fake_agy(name: &str, body: &str) -> (PathBuf, PathBuf) {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!(
            "hari-fake-agy-{name}-{}-{}",
            std::process::id(),
            now_millis()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("agy");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        (dir, path)
    }

    #[cfg(unix)]
    #[test]
    fn runs_agy_over_stdin_and_stops_it_after_the_result() {
        let (dir, agy) = fake_agy(
            "ok",
            r#"[ "$1 $2 $3 $4" = "--input-format stream-json --output-format stream-json" ] || { echo "bad args: $*" >&2; exit 2; }
read line
case "$line" in *'"event":"user"'*'notes please'*) ;; *) echo "bad input: $line" >&2; exit 3;; esac
echo '{"event":"init","conversation_id":"c1"}'
echo '{"event":"step_update","step_update":{"step_index":1,"step_type":"agent_response","text_delta":"- Wrote "}}'
echo '{"event":"result","result":{"status":"SUCCESS","response":"- Wrote the note."}}'
sleep 30"#,
        );
        let agent = NotesAgent::new();
        let started = Instant::now();
        let note = run_agy(&agy, "notes please\nline two", &dir, &agent.shared);
        assert_eq!(note, Ok("- Wrote the note.".into()));
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "stopped after the result"
        );
        let status = agent.status();
        assert_eq!(status.today.calls, 1);
        let last = status.last_run.expect("last run recorded");
        assert!(last.ok, "{}", last.output);
        assert!(last.output.contains("\"event\":\"result\""));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn reports_agy_exiting_without_a_result() {
        let (dir, agy) = fake_agy(
            "fail",
            "read line\necho 'Error: authentication required' >&2\nexit 1",
        );
        let agent = NotesAgent::new();
        let result = run_agy(&agy, "x", &dir, &agent.shared);
        assert!(matches!(result, Err(AgentError::Auth(_))), "{result:?}");
        let last = agent.status().last_run.expect("last run recorded");
        assert!(!last.ok);
        assert!(last.output.contains("authentication required"));
        let _ = std::fs::remove_dir_all(&dir);
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
    fn records_the_last_run_for_the_pill_menu() {
        let ok = last_run_record(
            5,
            &Ok("- note".into()),
            Some(0),
            "{\"response\":\"- note\"}",
            "",
        );
        assert!(ok.ok);
        assert_eq!(ok.summary, "Wrote a note (6 characters)");
        assert!(ok.output.starts_with("exit code: 0\n--- stdout ---\n{"));
        let failed = last_run_record(
            6,
            &Err(AgentError::Auth("login".into())),
            Some(1),
            "",
            &"x".repeat(5_000),
        );
        assert!(!failed.ok);
        assert!(failed.summary.contains("sign in"));
        assert!(failed.output.contains("exit code: 1"));
        assert!(failed.output.chars().count() < 1_200, "stderr is clipped");
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
