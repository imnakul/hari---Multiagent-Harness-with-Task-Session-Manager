//! Local interactive Claude owner. No print/SDK transport and no global config writes.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

const MAX_BODY: u64 = 1024 * 1024;
const MAX_EVENTS: usize = 4096;

#[derive(Default)]
pub struct InteractiveHost(Mutex<HashMap<String, Arc<Live>>>, Mutex<()>);

struct Live {
    native_id: String,
    root: PathBuf,
    running: AtomicBool,
    state: Mutex<LiveState>,
    changed: Condvar,
}

#[derive(Default)]
struct LiveState {
    phase: String,
    writing: bool,
    terminal_owner: bool,
    sequence: u64,
    events: VecDeque<(u64, Value)>,
    replies: HashMap<u64, Option<Value>>,
    transcript: Option<PathBuf>,
    offset: u64,
    submissions: HashSet<String>,
    activity: Option<Instant>,
    background: HashSet<String>,
    uncertain_background: bool,
    skip_fork_history: bool,
    background_coverage: bool,
    untracked_work: bool,
    paste: Option<PendingPaste>,
}

/// A paste written by `claude_interactive_send` that has no Enter yet. The GUI
/// confirms on screen that Claude shows it before `claude_interactive_submit`.
struct PendingPaste {
    submission_id: String,
    /// The second try: pasted parts only, never the typed letter (L-187).
    repaste: String,
    repasted: bool,
    enters: u8,
}

/// Enter presses allowed per paste: the first plus two retries while Claude
/// still shows the paste unsubmitted (Enter on an emptied prompt is a no-op).
const MAX_ENTERS: u8 = 3;

impl Live {
    fn event(&self, mut value: Value) -> u64 {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.activity = Some(Instant::now());
        state.sequence += 1;
        let sequence = state.sequence;
        if is_interaction(&value) {
            state.replies.insert(sequence, None);
        }
        value["bridgeId"] = json!(sequence);
        state.events.push_back((sequence, value));
        while state.events.len() > MAX_EVENTS {
            state.events.pop_front();
        }
        sequence
    }

    fn stop(&self) {
        self.running.store(false, Ordering::Release);
        self.changed.notify_all();
    }
}

impl Drop for InteractiveHost {
    fn drop(&mut self) {
        for live in self.0.get_mut().unwrap_or_else(|e| e.into_inner()).values() {
            live.stop();
        }
    }
}

impl InteractiveHost {
    fn get(&self, id: &str) -> Result<Arc<Live>, String> {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .cloned()
            .ok_or_else(|| "Claude Interactive is not running".into())
    }
}

pub(crate) fn pty_id(id: &str) -> String {
    format!("claude-interactive:{id}")
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForkInput {
    source_provider_session_id: String,
    fork_point: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartInput {
    session_id: String,
    native_id: String,
    resume: bool,
    cwd: String,
    binary: String,
    account_id: Option<String>,
    model: String,
    effort: Option<String>,
    permission_mode: String,
    fast: bool,
    fork: Option<ForkInput>,
    /// The send that started this launch, passed as Claude's prompt argument
    /// so it is submitted by Claude itself once its input is ready.
    prompt: Option<LaunchPrompt>,
    /// Record the folder as trusted in Claude's config before launch (L-115).
    #[serde(default)]
    trust_folder: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchPrompt {
    submission_id: String,
    text: String,
}

/// Longest launch prompt, in UTF-16 units: the whole Windows command line is capped at 32,767.
const MAX_LAUNCH_PROMPT: usize = 16 * 1024;

/// A prompt argument must not be read as anything else. A leading "-" is an
/// option and "/" a slash command; a single word can name a subcommand (such as
/// `purge`, which deletes project state), so those stay on the paste path.
fn validate_launch_prompt(text: &str) -> Result<(), String> {
    let trimmed = text.trim();
    if trimmed.is_empty()
        || text.encode_utf16().count() > MAX_LAUNCH_PROMPT
        || trimmed.starts_with(['-', '/'])
        || !trimmed.contains(char::is_whitespace)
        || text.chars().any(|c| c.is_control() && c != '\n')
    {
        return Err("This message cannot be passed to Claude at launch".into());
    }
    Ok(())
}

fn validate_start(input: &StartInput) -> Result<(), String> {
    uuid::Uuid::parse_str(&input.native_id).map_err(|_| "Invalid Claude native session ID")?;
    if let Some(fork) = &input.fork {
        uuid::Uuid::parse_str(&fork.source_provider_session_id)
            .map_err(|_| "Invalid fork source")?;
        if fork.source_provider_session_id == input.native_id || input.resume {
            return Err("Fork must create a new native owner".into());
        }
        if fork.fork_point.is_some() {
            return Err("Interactive Claude forks the full native history; a selected historical turn needs copied context".into());
        }
    }
    if let Some(prompt) = &input.prompt {
        validate_launch_prompt(&prompt.text)?;
        if prompt.submission_id.is_empty() {
            return Err("Launch prompt needs a submission ID".into());
        }
    }
    if input.session_id.is_empty() || !Path::new(&input.cwd).is_dir() {
        return Err("Claude Interactive requires an existing project folder".into());
    }
    if input.model.is_empty()
        || input.model.starts_with('-')
        || input.model.contains(['\n', '\r', '\0'])
    {
        return Err("Invalid Claude model".into());
    }
    if !matches!(
        input.permission_mode.as_str(),
        "default" | "acceptEdits" | "plan" | "bypassPermissions" | "auto"
    ) {
        return Err("Unsupported Claude permission mode".into());
    }
    if input
        .effort
        .as_deref()
        .is_some_and(|e| !matches!(e, "low" | "medium" | "high" | "xhigh" | "max"))
    {
        return Err(
            "Unsupported interactive effort; use the native terminal to configure this setting"
                .into(),
        );
    }
    Ok(())
}

fn hook_settings(url: &str, fast: bool) -> Value {
    let mut hooks = serde_json::Map::new();
    for event in [
        "SessionStart",
        "SessionEnd",
        "UserPromptSubmit",
        "Stop",
        "StopFailure",
        "PreCompact",
        "PostCompact",
        "SubagentStart",
        "SubagentStop",
        "TaskCreated",
        "TaskCompleted",
        "Notification",
        "PreToolUse",
        "PostToolUse",
        "PostToolUseFailure",
        "PermissionRequest",
    ] {
        hooks.insert(event.into(), json!([{"matcher":"*", "hooks":[{
            "type":"http", "url":url, "timeout": if matches!(event, "PermissionRequest" | "PreToolUse") { 600 } else { 10 }
        }]}]));
    }
    // The GUI owns composing. Native suggested follow-ups otherwise occupy
    // the hidden prompt and cannot safely be distinguished from a real draft
    // in ConPTY. Keep this override local to the launched CLI, not user config.
    json!({"hooks":hooks, "fastMode":fast, "promptSuggestionEnabled":false})
}

#[tauri::command(async)]
pub fn claude_interactive_start(
    app: AppHandle,
    host: State<'_, InteractiveHost>,
    input: StartInput,
) -> Result<(), String> {
    // Stop waits for any in-progress spawn, then kills the installed owner.
    let _lifecycle = host.1.lock().unwrap_or_else(|e| e.into_inner());
    validate_start(&input)?;
    let binary = crate::harness::harness_resolve_claude(Some(input.binary.clone()))?.path;
    #[cfg(windows)]
    if Path::new(&binary)
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"))
    {
        return Err("Interactive mode requires the native Claude executable on Windows. Select claude.exe in Settings → Providers.".into());
    }
    // Version coverage is explicit. Unknown CLI releases keep working as chat,
    // but are never auto-stopped until their background hooks are verified.
    let background_coverage =
        crate::harness::harness_probe_provider("claude".into(), Some(binary.clone()))
            .ok()
            .and_then(|p| p.version)
            .is_some_and(|v| matches!(v.split_whitespace().next(), Some("2.1.301" | "2.1.302")));
    let root = crate::provider_sessions::root_for(
        &app,
        &crate::provider_sessions::Provider::Claude,
        input.account_id.as_deref().unwrap_or("default"),
    )?;
    let account_dir =
        crate::harness::provider_account_dir(&app, "claude", input.account_id.as_deref())?;
    // The GUI cannot answer Claude's folder trust dialog, so answer it in
    // Claude's own config first, as Orca does. Any miss means Claude asks.
    if input.trust_folder {
        crate::claude_folder_trust::grant_for_launch(account_dir.as_deref(), Path::new(&input.cwd));
    }
    let source_id = input
        .fork
        .as_ref()
        .map(|f| f.source_provider_session_id.as_str())
        .unwrap_or(&input.native_id);
    let transcript = if input.resume || input.fork.is_some() {
        let conversation = crate::provider_sessions::provider_sessions_resolve_blocking(
            app.clone(),
            app.state(),
            crate::provider_sessions::Provider::Claude,
            input.account_id.clone(),
            source_id.to_owned(),
        )?;
        if crate::provider_sessions::cwd_key(&conversation.cwd)
            != crate::provider_sessions::cwd_key(&input.cwd)
        {
            return Err("Native Claude conversation belongs to a different folder".into());
        }
        crate::provider_sessions::find_transcript(
            &crate::provider_sessions::Provider::Claude,
            &root.join("projects"),
            source_id,
            0,
        )
    } else {
        None
    };
    let offset = transcript
        .as_ref()
        .and_then(|p| p.metadata().ok())
        .map(|m| m.len())
        .unwrap_or(0);
    let server = tiny_http::Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let token = uuid::Uuid::new_v4().to_string();
    let hook_path = format!("/hook/{token}");
    let url = format!(
        "http://127.0.0.1:{}{hook_path}",
        server
            .server_addr()
            .to_ip()
            .ok_or("No hook listener")?
            .port()
    );
    let live = Arc::new(Live {
        native_id: input.native_id.clone(),
        root,
        running: AtomicBool::new(true),
        changed: Condvar::new(),
        state: Mutex::new(LiveState {
            phase: "starting".into(),
            transcript: if input.fork.is_some() {
                None
            } else {
                transcript
            },
            offset: if input.fork.is_some() { 0 } else { offset },
            activity: Some(Instant::now()),
            skip_fork_history: input.fork.is_some(),
            background_coverage,
            ..Default::default()
        }),
    });
    {
        let mut sessions = host.0.lock().unwrap_or_else(|e| e.into_inner());
        if sessions.contains_key(&input.session_id)
            || sessions.values().any(|s| s.native_id == input.native_id)
        {
            return Err("This Claude conversation already has an interactive owner".into());
        }
        sessions.insert(input.session_id.clone(), live.clone());
    }
    let settings = hook_settings(&url, input.fast).to_string();
    let mut args = vec![
        if input.resume || input.fork.is_some() {
            "--resume"
        } else {
            "--session-id"
        }
        .into(),
        source_id.to_owned(),
        "--model".into(),
        input.model,
        "--permission-mode".into(),
        input.permission_mode,
        "--settings".into(),
        settings,
    ];
    if input.fork.is_some() {
        args.extend([
            "--fork-session".into(),
            "--session-id".into(),
            input.native_id.clone(),
        ]);
    }
    if let Some(effort) = input.effort {
        args.extend(["--effort".into(), effort]);
    }
    if let Some(prompt) = &input.prompt {
        args.push(prompt.text.clone());
    }
    let mut env = vec![("PATH".into(), crate::harness::gui_search_path())];
    let mut remove_env = vec!["CLAUDECODE".into()];
    if let Some(dir) = account_dir {
        env.push((
            "CLAUDE_CONFIG_DIR".into(),
            dir.to_string_lossy().into_owned(),
        ));
        env.push((
            "CLAUDE_SECURESTORAGE_CONFIG_DIR".into(),
            dir.to_string_lossy().into_owned(),
        ));
        remove_env.extend(
            [
                "ANTHROPIC_API_KEY",
                "ANTHROPIC_AUTH_TOKEN",
                "CLAUDE_CODE_OAUTH_TOKEN",
            ]
            .map(String::from),
        );
    }
    let result = crate::pty::spawn_with_program(
        app.clone(),
        app.state(),
        pty_id(&input.session_id),
        input.cwd,
        120,
        40,
        Some(crate::pty::PtyProgram {
            binary,
            args,
            env,
            remove_env,
        }),
    );
    if let Err(error) = result {
        live.stop();
        host.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&input.session_id);
        return Err(error);
    }
    // HTTP SessionStart is not emitted by all supported CLI versions. Process
    // launch authorizes the backend gate; the frontend must additionally verify
    // the framed, empty native prompt before sending any input. A launch prompt
    // is already on its way: Claude submits it, so the send is in flight.
    {
        let mut state = live.state.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(prompt) = input.prompt {
            state.submissions.insert(prompt.submission_id);
            state.phase = "sending".into();
        } else {
            state.phase = "ready".into();
        }
    }
    thread::spawn(move || {
        while live.running.load(Ordering::Acquire) {
            if let Ok(Some(request)) = server.recv_timeout(Duration::from_millis(100)) {
                // Limit outstanding permission requests and never spawn for unauthenticated input.
                if request.url() != hook_path || request.method() != &tiny_http::Method::Post {
                    let _ = request.respond(tiny_http::Response::empty(403));
                    continue;
                }
                if live
                    .state
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .replies
                    .len()
                    >= 32
                {
                    let _ = request.respond(tiny_http::Response::empty(503));
                    continue;
                }
                let live = live.clone();
                thread::spawn(move || handle_hook(live, request));
            }
        }
    });
    Ok(())
}

fn handle_hook(live: Arc<Live>, mut request: tiny_http::Request) {
    let mut bytes = Vec::new();
    if request
        .as_reader()
        .take(MAX_BODY + 1)
        .read_to_end(&mut bytes)
        .is_err()
        || bytes.len() as u64 > MAX_BODY
    {
        let _ = request.respond(tiny_http::Response::empty(413));
        return;
    }
    let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
        let _ = request.respond(tiny_http::Response::empty(400));
        return;
    };
    if value["session_id"].as_str() != Some(&live.native_id)
        || !live.running.load(Ordering::Acquire)
    {
        let _ = request.respond(tiny_http::Response::empty(409));
        return;
    }
    let event = value["hook_event_name"].as_str().unwrap_or("");
    let permission = is_interaction(&value);
    {
        let mut state = live.state.lock().unwrap_or_else(|e| e.into_inner());
        if !live.running.load(Ordering::Acquire) {
            let _ = request.respond(tiny_http::Response::empty(409));
            return;
        }
        state.activity = Some(Instant::now());
        observe_background(&mut state, &value);
        if value["agent_id"].is_null() {
            if let Some(phase) = root_hook_phase(&state.phase, event) {
                state.phase = phase.into();
            }
            if let Some(path) = value["transcript_path"]
                .as_str()
                .and_then(|p| safe_transcript(&live.root, &live.native_id, Path::new(p)))
            {
                if state.skip_fork_history && event == "UserPromptSubmit" {
                    state.offset = path.metadata().map(|m| m.len()).unwrap_or(0);
                    state.skip_fork_history = false;
                }
                state.transcript = Some(path);
            }
        }
        if permission {
            state.phase = "permission".into();
        }
    }
    let id = live.event(value.clone());
    let response = if permission {
        let deadline = Instant::now() + Duration::from_secs(590);
        let mut state = live.state.lock().unwrap_or_else(|e| e.into_inner());
        loop {
            if let Some(Some(reply)) = state.replies.remove(&id) {
                break reply;
            }
            state.replies.entry(id).or_insert(None);
            if !live.running.load(Ordering::Acquire) || Instant::now() >= deadline {
                state.replies.remove(&id);
                break permission_reply("deny", None);
            }
            let (next, _) = live
                .changed
                .wait_timeout(state, Duration::from_millis(250))
                .unwrap_or_else(|e| e.into_inner());
            state = next;
        }
    } else {
        json!({})
    };
    if permission {
        live.event(json!({"hook_event_name":"BridgePermissionResolved", "request_id":id}));
    }
    let response = interaction_response(event, response);
    let _ = request.respond(
        tiny_http::Response::from_string(response.to_string()).with_header(
            tiny_http::Header::from_bytes("Content-Type", "application/json")
                .expect("static header"),
        ),
    );
}

// Full Stop snapshots are verified on the supported CLI versions. Missing
// coverage, scheduled jobs and unreported detached work veto automatic shutdown.
/// Phase after a root (non-subagent) hook. A Stop-like hook during a composer
/// send belongs to an earlier turn: the new prompt has no Enter yet, so it
/// cannot have stopped, and marking the session ready would abort the paste.
fn root_hook_phase(current: &str, event: &str) -> Option<&'static str> {
    match event {
        "SessionStart" | "Stop" | "StopFailure" | "PostCompact" if current == "sending" => None,
        "SessionStart" | "Stop" | "StopFailure" | "PostCompact" => Some("ready"),
        "UserPromptSubmit" | "PreCompact" | "PreToolUse" => Some("busy"),
        "SessionEnd" => Some("ended"),
        _ => None,
    }
}

fn observe_background(state: &mut LiveState, value: &Value) {
    let event = value["hook_event_name"].as_str().unwrap_or("");
    let agent = value["agent_id"].as_str();
    let task = value["task_id"].as_str();
    match (event, agent.or(task)) {
        ("SubagentStart" | "TaskCreated", Some(id)) => {
            let prefix = if event == "SubagentStart" {
                "agent"
            } else {
                "task"
            };
            state.background.insert(format!("{prefix}:{id}"));
        }
        ("SubagentStop" | "TaskCompleted", Some(id)) => {
            let prefix = if event == "SubagentStop" {
                "agent"
            } else {
                "task"
            };
            state.background.remove(&format!("{prefix}:{id}"));
        }
        ("SubagentStart" | "TaskCreated", None) => state.uncertain_background = true,
        _ => {}
    }
    if event == "PreToolUse" {
        let name = value["tool_name"].as_str().unwrap_or("");
        let command = value["tool_input"]["command"]
            .as_str()
            .unwrap_or("")
            .to_ascii_lowercase();
        if name.starts_with("mcp__")
            || (name == "Bash"
                && (command.contains('&')
                    || command.contains("nohup")
                    || command.contains("start-process")
                    || command.contains("disown")))
        {
            state.untracked_work = true;
        }
        if value["tool_input"]["run_in_background"] == true {
            state.uncertain_background = true;
        }
    }
    if event == "PostToolUse" {
        if let Some(id) = value["tool_response"]["backgroundTaskId"].as_str() {
            state.background.insert(format!("task:{id}"));
        }
    }
    if event == "Stop" && agent.is_none() {
        if let (Some(tasks), Some(crons)) = (
            value["background_tasks"].as_array(),
            value["session_crons"].as_array(),
        ) {
            state.background.retain(|key| !key.starts_with("task:"));
            state.uncertain_background = !crons.is_empty();
            for task in tasks {
                match (task["id"].as_str(), task["status"].as_str()) {
                    (Some(id), Some(status)) => {
                        if !matches!(status, "completed" | "failed" | "killed" | "stopped") {
                            state.background.insert(format!("task:{id}"));
                        }
                    }
                    _ => state.uncertain_background = true,
                }
            }
        } else {
            state.uncertain_background = true;
        }
    }
}

fn idle_eligible(state: &LiveState, after: u64, minutes: u64, tail_settled: bool) -> bool {
    state.sequence == after
        && state.phase == "ready"
        && !state.writing
        && !state.terminal_owner
        && state.replies.is_empty()
        && state.background.is_empty()
        && state.background_coverage
        && !state.untracked_work
        && !state.uncertain_background
        && !state.skip_fork_history
        && tail_settled
        && state
            .activity
            .is_some_and(|t| t.elapsed() >= Duration::from_secs(minutes * 60))
}

#[tauri::command(async)]
pub fn claude_interactive_park(
    app: AppHandle,
    host: State<'_, InteractiveHost>,
    session_id: String,
    after: u64,
    minutes: u64,
    explicit_idle_stop: Option<bool>,
) -> Result<bool, String> {
    if !(5..=60).contains(&minutes) && !(minutes == 0 && explicit_idle_stop == Some(true)) {
        return Err("Idle timeout must be 5–60 minutes".into());
    }
    let _lifecycle = host.1.lock().unwrap_or_else(|e| e.into_inner());
    let live = host.get(&session_id)?;
    {
        let state = live.state.lock().unwrap_or_else(|e| e.into_inner());
        if !live.running.load(Ordering::Acquire) || !idle_eligible(&state, after, minutes, true) {
            return Ok(false);
        }
    }
    // Enumerate only at a possible shutdown. Unknown or still-live descendants
    // (including unreported tools/MCP workers) conservatively veto parking.
    let roots = app.state::<crate::pty::PtyHost>().process_roots();
    let Some(root) = roots.iter().find(|r| r.id == pty_id(&session_id)) else {
        return Ok(false);
    };
    if crate::process_stats::has_descendants(root.pid)? {
        return Ok(false);
    }
    {
        let state = live.state.lock().unwrap_or_else(|e| e.into_inner());
        let tail_settled = state
            .transcript
            .as_ref()
            .and_then(|p| p.metadata().ok())
            .is_some_and(|m| m.len() == state.offset);
        if !live.running.load(Ordering::Acquire)
            || !idle_eligible(&state, after, minutes, tail_settled)
        {
            return Ok(false);
        }
        live.stop(); // Fence new hooks while holding the same state lock.
    }
    crate::pty::stop_program(&app.state::<crate::pty::PtyHost>(), &pty_id(&session_id))?;
    host.0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&session_id);
    Ok(true)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractiveAttachment {
    name: String,
    mime_type: String,
    kind: String,
    data: Option<String>,
    path: Option<String>,
    copy_from_path: Option<String>,
}

#[tauri::command(async)]
pub fn claude_interactive_attachments(
    app: AppHandle,
    native_id: String,
    attachments: Vec<InteractiveAttachment>,
) -> Result<Vec<String>, String> {
    uuid::Uuid::parse_str(&native_id).map_err(|_| "Invalid native attachment session")?;
    if attachments.len() > 20 {
        return Err("Too many attachments (maximum 20)".into());
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("interactive-attachments")
        .join(native_id);
    save_attachments(&dir, attachments)
}

fn save_attachments(
    dir: &Path,
    attachments: Vec<InteractiveAttachment>,
) -> Result<Vec<String>, String> {
    use base64::Engine;
    use std::io::Write;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    let mut total = 0usize;
    for file in attachments {
        let extension = Path::new(&file.name)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let image = file.kind == "image"
            && matches!(
                file.mime_type.as_str(),
                "image/png" | "image/jpeg" | "image/gif" | "image/webp"
            );
        let text = file.kind == "file"
            && (file.mime_type.starts_with("text/")
                || matches!(
                    extension.as_str(),
                    "txt"
                        | "md"
                        | "json"
                        | "yaml"
                        | "yml"
                        | "csv"
                        | "log"
                        | "ts"
                        | "tsx"
                        | "js"
                        | "py"
                        | "rs"
                        | "toml"
                        | "xml"
                        | "html"
                        | "css"
                ));
        if !image && !text {
            return Err("Interactive attachments support images and text files".into());
        }
        let bytes = if let Some(data) = file.data {
            if data.len() > 45 * 1024 * 1024 {
                return Err("Attachment too large".into());
            }
            base64::engine::general_purpose::STANDARD
                .decode(data)
                .map_err(|e| e.to_string())?
        } else if let Some(path) = file.copy_from_path.or(file.path) {
            let mut bytes = Vec::new();
            std::fs::File::open(path)
                .map_err(|e| e.to_string())?
                .take(32 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            bytes
        } else {
            return Err("Attachment has no file data".into());
        };
        total = total.saturating_add(bytes.len());
        if total > 32 * 1024 * 1024 {
            return Err("Attachments exceed 32 MiB".into());
        }
        if text && std::str::from_utf8(&bytes).is_err() {
            return Err("Text attachments must be UTF-8".into());
        }
        let ext = if image {
            match file.mime_type.as_str() {
                "image/png" => "png",
                "image/jpeg" => "jpg",
                "image/gif" => "gif",
                _ => "webp",
            }
        } else {
            "txt"
        };
        let target = dir.join(format!("{}.{}", uuid::Uuid::new_v4(), ext));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options
            .open(&target)
            .and_then(|mut file| file.write_all(&bytes))
            .map_err(|e| e.to_string())?;
        result.push(target.to_string_lossy().into_owned());
    }
    Ok(result)
}

fn safe_transcript(root: &Path, id: &str, path: &Path) -> Option<PathBuf> {
    let root = root.join("projects").canonicalize().ok()?;
    let path = path.canonicalize().ok()?;
    (path.starts_with(root) && path.file_name()?.to_str()? == format!("{id}.jsonl")).then_some(path)
}

fn permission_reply(behavior: &str, updated_input: Option<Value>) -> Value {
    let mut decision = json!({"behavior":behavior});
    if let Some(input) = updated_input {
        decision["updatedInput"] = input;
    }
    json!({"hookSpecificOutput":{"hookEventName":"PermissionRequest", "decision":decision}})
}

fn is_interaction(value: &Value) -> bool {
    value["hook_event_name"] == "PermissionRequest"
        || (value["hook_event_name"] == "PreToolUse" && value["tool_name"] == "AskUserQuestion")
}

fn interaction_response(event: &str, response: Value) -> Value {
    if event != "PreToolUse" || response["hookSpecificOutput"]["decision"].is_null() {
        return response;
    }
    let decision = &response["hookSpecificOutput"]["decision"];
    let mut output =
        json!({"hookEventName":"PreToolUse", "permissionDecision":decision["behavior"]});
    if !decision["updatedInput"].is_null() {
        output["updatedInput"] = decision["updatedInput"].clone();
    }
    json!({"hookSpecificOutput":output})
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Poll {
    phase: String,
    terminal_owner: bool,
    sequence: u64,
    events: Vec<Value>,
    lines: Vec<String>,
    more: bool,
}

#[tauri::command(async)]
pub fn claude_interactive_poll(
    host: State<'_, InteractiveHost>,
    session_id: String,
    after: u64,
) -> Result<Poll, String> {
    let live = host.get(&session_id)?;
    let mut state = live.state.lock().unwrap_or_else(|e| e.into_inner());
    if state.events.front().is_some_and(|(id, _)| after + 1 < *id) {
        return Err(
            "Interactive event coverage was lost. Review the native terminal before continuing."
                .into(),
        );
    }
    let mut lines = Vec::new();
    let mut more = false;
    if let Some(path) = state
        .transcript
        .as_ref()
        .filter(|_| !state.skip_fork_history)
        .and_then(|p| safe_transcript(&live.root, &live.native_id, p))
    {
        let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
        if file.metadata().map_err(|e| e.to_string())?.len() < state.offset {
            return Err("Claude transcript was replaced or truncated; review the terminal".into());
        }
        file.seek(SeekFrom::Start(state.offset))
            .map_err(|e| e.to_string())?;
        let (read, consumed, rest) = read_records(file)?;
        lines = read;
        more = rest;
        if consumed > 0 {
            state.offset += consumed;
            state.activity = Some(Instant::now());
        }
    }
    Ok(Poll {
        phase: state.phase.clone(),
        terminal_owner: state.terminal_owner,
        sequence: state.sequence,
        events: state
            .events
            .iter()
            .filter(|(id, _)| *id > after)
            .map(|(_, v)| v.clone())
            .collect(),
        lines,
        more,
    })
}

/// Largest single transcript record kept for parsing. Pasted images make Claude
/// write multi-megabyte JSONL records; larger records are skipped whole.
const MAX_RECORD: u64 = 64 * 1024 * 1024;
/// Strings above this size (base64 image data, huge tool output) are replaced
/// before the record crosses IPC; the GUI never renders them from the transcript.
const MAX_RECORD_STRING: usize = 64 * 1024;

/// Reads whole JSONL records from the reader's position.
///
/// Returns the complete lines, the bytes consumed and whether more data follows.
/// A trailing record without its newline is left for the next poll, because
/// Claude may still be writing it.
fn read_records(reader: impl Read) -> Result<(Vec<String>, u64, bool), String> {
    let mut reader = reader;
    let mut bytes = Vec::new();
    (&mut reader)
        .take(MAX_BODY + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let more = bytes.len() as u64 > MAX_BODY;
    if let Some(end) = bytes
        .iter()
        .take(MAX_BODY as usize)
        .rposition(|b| *b == b'\n')
    {
        let lines = String::from_utf8(bytes[..=end].to_vec())
            .map_err(|e| e.to_string())?
            .lines()
            .map(String::from)
            .collect();
        return Ok((lines, (end + 1) as u64, more));
    }
    if !more {
        return Ok((Vec::new(), 0, false));
    }
    // One record is larger than a normal page: read on to its newline.
    let mut chunk = vec![0u8; 64 * 1024];
    let mut total = bytes.len() as u64;
    loop {
        if let Some(at) = bytes.iter().position(|b| *b == b'\n') {
            let consumed = total - (bytes.len() - at - 1) as u64;
            if consumed > MAX_RECORD {
                return Ok((Vec::new(), consumed, true));
            }
            return Ok((vec![shrink_record(&bytes[..at])?], consumed, true));
        }
        let read = reader.read(&mut chunk).map_err(|e| e.to_string())?;
        if read == 0 {
            return Ok((Vec::new(), 0, false));
        }
        total += read as u64;
        if total - read as u64 > MAX_RECORD {
            // Past the cap: keep only the scanned chunk to find the newline.
            bytes.clear();
        }
        bytes.extend_from_slice(&chunk[..read]);
    }
}

fn shrink_record(record: &[u8]) -> Result<String, String> {
    fn shrink(value: &mut Value) {
        match value {
            Value::String(text) if text.len() > MAX_RECORD_STRING => {
                *text = format!("[omitted {} bytes]", text.len());
            }
            Value::Array(items) => items.iter_mut().for_each(shrink),
            Value::Object(map) => map.values_mut().for_each(shrink),
            _ => {}
        }
    }
    let text = std::str::from_utf8(record).map_err(|e| e.to_string())?;
    let Ok(mut value) = serde_json::from_str::<Value>(text.trim_end_matches('\r')) else {
        // The frontend parser reports malformed records itself.
        return Ok(text.to_string());
    };
    shrink(&mut value);
    Ok(value.to_string())
}

#[tauri::command(async)]
pub fn claude_interactive_send(
    app: AppHandle,
    host: State<'_, InteractiveHost>,
    session_id: String,
    submission_id: String,
    text: String,
) -> Result<crate::interactive_delivery::PasteSettle, String> {
    if text.is_empty()
        || text.len() > 512 * 1024
        || text
            .chars()
            .any(|c| c.is_control() && c != '\n' && c != '\t')
        || (text.trim_start().starts_with('/') && text.trim() != "/compact")
    {
        return Err(
            "Use the native terminal for slash commands or terminal control characters".into(),
        );
    }
    let live = host.get(&session_id)?;
    {
        let mut state = live.state.lock().unwrap_or_else(|e| e.into_inner());
        if state.phase != "ready" || state.terminal_owner || !live.running.load(Ordering::Acquire) {
            return Err(
                "The native CLI is not at an available chat prompt. Review its terminal.".into(),
            );
        }
        if state.submissions.len() >= 10000 || !state.submissions.insert(submission_id.clone()) {
            return Err(
                "Submission already attempted or session delivery ledger full; review the terminal"
                    .into(),
            );
        }
        state.activity = Some(Instant::now());
        state.phase = "sending".into();
        state.writing = true;
        state.paste = None;
    }
    let payload = crate::interactive_delivery::paste_payload(&text);
    // A write error is uncertain: retain the ledger and never retry either part.
    let result = write_paste(&app, &live, &session_id, &payload);
    let mut state = live.state.lock().unwrap_or_else(|e| e.into_inner());
    state.writing = false;
    if result.is_err() && state.phase == "sending" {
        state.phase = "unconfirmed".into();
    } else if result.is_ok() {
        state.paste = Some(PendingPaste {
            submission_id,
            repaste: crate::interactive_delivery::repaste_payload(&text),
            repasted: false,
            enters: 0,
        });
    }
    result
}

/// Paste and wait for the native output to settle (or stay noisy). No Enter:
/// output alone does not prove Claude kept the paste (ConPTY echoes bytes at
/// once, and Claude 2.1.303 discards input that arrives while its startup
/// screen takes over).
fn write_paste(
    app: &AppHandle,
    live: &Live,
    session_id: &str,
    payload: &str,
) -> Result<crate::interactive_delivery::PasteSettle, String> {
    let pty_host = app.state::<crate::pty::PtyHost>();
    let id = pty_id(session_id);
    let baseline = pty_host.paste_output(&id)?.0;
    crate::pty::pty_write(app.state(), id.clone(), payload.into())?;
    crate::interactive_delivery::wait_for_paste(payload.len(), baseline, || {
        let state = live.state.lock().unwrap_or_else(|e| e.into_inner());
        if state.phase != "sending" || state.terminal_owner || !live.running.load(Ordering::Acquire)
        {
            return Err("Native input ownership changed after paste; no Enter was sent".into());
        }
        drop(state);
        pty_host.paste_output(&id)
    })
}

/// The follow-up the GUI chose after reading Claude's prompt on screen.
#[derive(Debug, PartialEq)]
enum SubmitStep {
    /// Write these bytes: Enter, or the paste again.
    Write(String),
    /// The prompt is still empty: nothing reached Claude, so it is idle again.
    Abandoned,
}

/// Decide a paste follow-up from backend state alone. "enter" may repeat while
/// Claude shows the paste unsubmitted; "repaste" and "abort" are only for a
/// prompt the GUI saw empty, so neither is allowed once Enter was pressed.
fn submit_step(
    state: &mut LiveState,
    submission_id: &str,
    action: &str,
) -> Result<SubmitStep, String> {
    let sending = state.phase == "sending" && !state.terminal_owner && !state.writing;
    let paste = state
        .paste
        .as_mut()
        .filter(|paste| sending && paste.submission_id == submission_id)
        .ok_or("This prompt is no longer waiting to be submitted")?;
    match action {
        "enter" if paste.enters < MAX_ENTERS => {
            paste.enters += 1;
            Ok(SubmitStep::Write("\r".into()))
        }
        "repaste" if paste.enters == 0 && !paste.repasted => {
            paste.repasted = true;
            Ok(SubmitStep::Write(paste.repaste.clone()))
        }
        "abort" if paste.enters == 0 => {
            state.paste = None;
            state.phase = "ready".into();
            Ok(SubmitStep::Abandoned)
        }
        _ => Err("That submit step is not allowed for this prompt".into()),
    }
}

#[tauri::command(async)]
pub fn claude_interactive_submit(
    app: AppHandle,
    host: State<'_, InteractiveHost>,
    session_id: String,
    submission_id: String,
    action: String,
) -> Result<Option<crate::interactive_delivery::PasteSettle>, String> {
    let live = host.get(&session_id)?;
    let step = {
        let mut state = live.state.lock().unwrap_or_else(|e| e.into_inner());
        if !live.running.load(Ordering::Acquire) {
            return Err("Interactive Claude is not running".into());
        }
        let step = submit_step(&mut state, &submission_id, &action)?;
        state.activity = Some(Instant::now());
        if action == "repaste" {
            state.writing = true;
        }
        step
    };
    let SubmitStep::Write(data) = step else {
        return Ok(None);
    };
    if action != "repaste" {
        return crate::pty::pty_write(app.state(), pty_id(&session_id), data).map(|()| None);
    }
    let result = write_paste(&app, &live, &session_id, &data).map(Some);
    let mut state = live.state.lock().unwrap_or_else(|e| e.into_inner());
    state.writing = false;
    if result.is_err() && state.phase == "sending" {
        state.phase = "unconfirmed".into();
        state.paste = None;
    }
    result
}

#[tauri::command(async)]
pub fn claude_interactive_reply(
    host: State<'_, InteractiveHost>,
    session_id: String,
    request_id: u64,
    behavior: String,
    updated_input: Option<Value>,
) -> Result<(), String> {
    if !matches!(behavior.as_str(), "allow" | "deny" | "terminal") {
        return Err("Invalid approval decision".into());
    }
    let live = host.get(&session_id)?;
    let mut state = live.state.lock().unwrap_or_else(|e| e.into_inner());
    let reply = state
        .replies
        .get_mut(&request_id)
        .ok_or("This approval is no longer pending")?;
    if reply.is_some() {
        return Err("This approval already has a reply".into());
    }
    *reply = Some(if behavior == "terminal" {
        json!({})
    } else {
        permission_reply(&behavior, updated_input)
    });
    state.phase = "busy".into();
    live.changed.notify_all();
    Ok(())
}

#[tauri::command(async)]
pub fn claude_interactive_terminal(
    app: AppHandle,
    host: State<'_, InteractiveHost>,
    session_id: String,
    data: Option<String>,
) -> Result<(), String> {
    let live = host.get(&session_id)?;
    let mut state = live.state.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(data) = data {
        if state.writing {
            return Err("Composer submission is in progress".into());
        }
        if state.replies.values().any(Option::is_none) {
            return Err(
                "Choose Use terminal to release the GUI question or approval before typing".into(),
            );
        }
        state.activity = Some(Instant::now());
        state.terminal_owner = true;
        drop(state);
        crate::pty::pty_write(app.state(), pty_id(&session_id), data)
    } else {
        hand_back_to_chat(&mut state)
    }
}

/// Seconds the GUI waits for UserPromptSubmit before it reports a send as
/// unconfirmed; matches the timer in `sendInteractiveClaude`.
const PROMPT_ACK_TIMEOUT: Duration = Duration::from_secs(15);

/// Return to chat. Besides an idle "ready" prompt, this recovers a send that
/// Claude never acknowledged: "unconfirmed" (the write failed) or "sending"
/// with no write in progress and no hook for the acknowledgement timeout. Only
/// the user's explicit action reaches this, after the frontend has confirmed an
/// empty prompt on screen, so nothing is resent; a pending approval still blocks.
fn hand_back_to_chat(state: &mut LiveState) -> Result<(), String> {
    let quiet = state
        .activity
        .map_or(true, |at| at.elapsed() >= PROMPT_ACK_TIMEOUT);
    let stuck = !state.writing
        && !state.replies.values().any(Option::is_none)
        && (state.phase == "unconfirmed" || (state.phase == "sending" && quiet));
    if state.phase != "ready" && !stuck {
        return Err("Wait for the native conversation to finish before returning to chat".into());
    }
    state.phase = "ready".into();
    state.terminal_owner = false;
    state.paste = None;
    Ok(())
}

#[tauri::command(async)]
pub fn claude_interactive_stop(
    app: AppHandle,
    host: State<'_, InteractiveHost>,
    session_id: String,
) -> Result<(), String> {
    let _lifecycle = host.1.lock().unwrap_or_else(|e| e.into_inner());
    if let Ok(live) = host.get(&session_id) {
        live.stop();
    }
    crate::pty::stop_program(&app.state::<crate::pty::PtyHost>(), &pty_id(&session_id))?;
    host.0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&session_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_prompt_rejects_text_claude_could_read_as_an_option_or_command() {
        assert!(validate_launch_prompt("first line\nsecond line").is_ok());
        assert!(validate_launch_prompt("Fix the \"login\" bug, please").is_ok());
        for text in [
            "",
            "   ",
            "purge",
            "-p say hi",
            "  --help me",
            "/clear the screen",
            "tab\there",
            "escape \u{1b}[2J now",
            "carriage\r\nreturn",
        ] {
            assert!(validate_launch_prompt(text).is_err(), "{text:?}");
        }
        let long = "word ".repeat(MAX_LAUNCH_PROMPT / 5 + 1);
        assert!(validate_launch_prompt(&long).is_err());
    }

    #[test]
    fn attachments_persist_decoded_text_and_reject_unsupported_or_binary_files() {
        let dir =
            std::env::temp_dir().join(format!("monocode-attachments-{}", uuid::Uuid::new_v4()));
        let file = || InteractiveAttachment {
            name: "../../notes.md".into(),
            mime_type: "text/markdown".into(),
            kind: "file".into(),
            data: Some("aGVsbG8=".into()),
            path: None,
            copy_from_path: None,
        };
        let paths = save_attachments(&dir, vec![file()]).unwrap();
        assert_eq!(std::fs::read_to_string(&paths[0]).unwrap(), "hello");
        assert!(Path::new(&paths[0]).starts_with(&dir));
        let mut bad = file();
        bad.data = Some("/w==".into());
        assert!(save_attachments(&dir, vec![bad]).is_err());
        let mut audio = file();
        audio.kind = "audio".into();
        assert!(save_attachments(&dir, vec![audio]).is_err());
        let mut missing = file();
        missing.data = None;
        assert!(save_attachments(&dir, vec![missing]).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn transcript_reads_oversized_records_whole_and_waits_for_partial_ones() {
        let image = "A".repeat(3 * 1024 * 1024);
        let big = json!({"type": "user", "message": {"content": [
            {"type": "image", "source": {"type": "base64", "data": image}},
            {"type": "text", "text": "what is this?"}
        ]}})
        .to_string();
        let file = format!("{{\"a\":1}}\n{big}\n{{\"b\":2}}\n");
        let mut offset = 0usize;
        let mut read = Vec::new();
        loop {
            let (lines, consumed, more) = read_records(&file.as_bytes()[offset..]).unwrap();
            read.extend(lines);
            offset += consumed as usize;
            if !more {
                break;
            }
        }
        assert_eq!(offset, file.len());
        assert_eq!(read.len(), 3);
        assert!(read[1].len() < MAX_BODY as usize);
        assert!(read[1].contains("what is this?") && read[1].contains("[omitted"));
        // A large record still being written is left for the next poll.
        let (lines, consumed, more) = read_records(&big.as_bytes()[..]).unwrap();
        assert_eq!((lines.len(), consumed, more), (0, 0, false));
    }

    #[test]
    fn return_to_chat_recovers_an_unacknowledged_send_but_not_live_work() {
        let stale = Some(Instant::now() - Duration::from_secs(16));
        let mut state = LiveState {
            phase: "sending".into(),
            terminal_owner: true,
            activity: stale,
            ..Default::default()
        };
        hand_back_to_chat(&mut state).unwrap();
        assert_eq!(
            (state.phase.as_str(), state.terminal_owner),
            ("ready", false)
        );
        for phase in ["busy", "ended"] {
            state.phase = phase.into();
            assert!(hand_back_to_chat(&mut state).is_err());
        }
        state.phase = "sending".into();
        state.activity = Some(Instant::now());
        assert!(
            hand_back_to_chat(&mut state).is_err(),
            "acknowledgement may still arrive"
        );
        state.activity = stale;
        state.writing = true;
        assert!(hand_back_to_chat(&mut state).is_err(), "paste in progress");
        state.writing = false;
        state.phase = "unconfirmed".into();
        state.activity = Some(Instant::now());
        state.replies.insert(1, None);
        assert!(hand_back_to_chat(&mut state).is_err(), "approval pending");
        state.replies.clear();
        hand_back_to_chat(&mut state).unwrap();
        assert_eq!(state.phase, "ready");
    }

    #[test]
    fn submit_steps_follow_the_screen_but_never_repaste_after_enter() {
        let paste = || PendingPaste {
            submission_id: "a".into(),
            repaste: "\x1b[200~eply\x1b[201~".into(),
            repasted: false,
            enters: 0,
        };
        let mut state = LiveState {
            phase: "sending".into(),
            paste: Some(paste()),
            ..Default::default()
        };
        assert!(
            submit_step(&mut state, "b", "enter").is_err(),
            "other prompt"
        );
        assert_eq!(
            submit_step(&mut state, "a", "repaste"),
            Ok(SubmitStep::Write("\x1b[200~eply\x1b[201~".into()))
        );
        assert!(
            submit_step(&mut state, "a", "repaste").is_err(),
            "only once"
        );
        for _ in 0..MAX_ENTERS {
            assert_eq!(
                submit_step(&mut state, "a", "enter"),
                Ok(SubmitStep::Write("\r".into()))
            );
        }
        assert!(submit_step(&mut state, "a", "enter").is_err(), "bounded");
        assert!(submit_step(&mut state, "a", "abort").is_err(), "Enter sent");
        state.paste = Some(paste());
        state.terminal_owner = true;
        assert!(
            submit_step(&mut state, "a", "enter").is_err(),
            "user typing"
        );
        state.terminal_owner = false;
        state.phase = "busy".into();
        assert!(submit_step(&mut state, "a", "enter").is_err(), "submitted");
        state.phase = "sending".into();
        assert_eq!(
            submit_step(&mut state, "a", "abort"),
            Ok(SubmitStep::Abandoned)
        );
        assert_eq!(state.phase, "ready");
        assert!(state.paste.is_none());
    }

    #[test]
    fn idle_shutdown_requires_full_observation_and_every_safety_gate() {
        let mut state = LiveState {
            phase: "ready".into(),
            sequence: 8,
            activity: Some(Instant::now() - Duration::from_secs(901)),
            background_coverage: true,
            ..Default::default()
        };
        assert!(idle_eligible(&state, 8, 15, true));
        assert!(!idle_eligible(&state, 7, 15, true));
        assert!(!idle_eligible(&state, 8, 15, false));
        state.background.insert("agent:x".into());
        assert!(!idle_eligible(&state, 8, 15, true));
        state.background.clear();
        state.uncertain_background = true;
        assert!(!idle_eligible(&state, 8, 15, true));
        state.uncertain_background = false;
        state.untracked_work = true;
        assert!(!idle_eligible(&state, 8, 15, true));
        state.untracked_work = false;
        state.terminal_owner = true;
        assert!(!idle_eligible(&state, 8, 15, true));
        state.terminal_owner = false;
        state.replies.insert(1, None);
        assert!(!idle_eligible(&state, 8, 15, true));
        state.replies.clear();
        state.background_coverage = false;
        assert!(!idle_eligible(&state, 8, 15, true));
        state.background_coverage = true;
        state.activity = Some(Instant::now());
        assert!(!idle_eligible(&state, 8, 15, true));
    }

    #[test]
    fn background_hooks_snapshot_completion_crons_and_unknown_coverage() {
        let mut state = LiveState::default();
        observe_background(
            &mut state,
            &json!({"hook_event_name":"SubagentStart", "agent_id":"a"}),
        );
        observe_background(
            &mut state,
            &json!({"hook_event_name":"PreToolUse", "tool_input":{"run_in_background":true}}),
        );
        assert!(state.uncertain_background);
        observe_background(
            &mut state,
            &json!({"hook_event_name":"Stop", "background_tasks":[{"id":"b", "status":"running"}], "session_crons":[]}),
        );
        assert_eq!(
            state.background,
            HashSet::from(["agent:a".into(), "task:b".into()])
        );
        observe_background(
            &mut state,
            &json!({"hook_event_name":"SubagentStop", "agent_id":"a"}),
        );
        observe_background(
            &mut state,
            &json!({"hook_event_name":"Stop", "background_tasks":[], "session_crons":[]}),
        );
        assert!(state.background.is_empty());
        assert!(!state.uncertain_background);
        observe_background(
            &mut state,
            &json!({"hook_event_name":"Stop", "background_tasks":[], "session_crons":[{}]}),
        );
        assert!(state.uncertain_background);
        observe_background(&mut state, &json!({"hook_event_name":"Stop"}));
        assert!(state.uncertain_background);
    }

    #[test]
    fn interactive_settings_use_local_http_hooks_without_headless_flags() {
        let settings = hook_settings("http://127.0.0.1:1234/hook/token", false);
        assert_eq!(
            settings["hooks"]["PermissionRequest"][0]["hooks"][0]["type"],
            "http"
        );
        // AskUserQuestion uses PreToolUse and can wait up to 590s for a human.
        assert!(
            settings["hooks"]["PreToolUse"][0]["hooks"][0]["timeout"]
                .as_u64()
                .unwrap()
                > 590
        );
        assert_eq!(settings["fastMode"], false);
        assert_eq!(settings["promptSuggestionEnabled"], false);
        assert!(settings.get("permissionMode").is_none());
    }

    #[test]
    fn permission_decisions_do_not_grant_session_rules() {
        let reply = permission_reply("allow", None);
        assert_eq!(
            reply["hookSpecificOutput"]["decision"],
            json!({"behavior":"allow"})
        );
        assert_eq!(
            permission_reply("deny", None)["hookSpecificOutput"]["hookEventName"],
            "PermissionRequest"
        );
    }

    fn fixture() -> Arc<Live> {
        Arc::new(Live {
            native_id: "native-test".into(),
            root: PathBuf::new(),
            running: AtomicBool::new(true),
            state: Mutex::new(LiveState::default()),
            changed: Condvar::new(),
        })
    }

    #[test]
    fn question_hook_reply_uses_the_correct_pretool_contract() {
        let value = json!({"hook_event_name":"PreToolUse", "tool_name":"AskUserQuestion"});
        assert!(is_interaction(&value));
        let answer = json!({"answers":{"Which color?":"Blue"}});
        let response = interaction_response(
            "PreToolUse",
            permission_reply("allow", Some(answer.clone())),
        );
        assert_eq!(
            response["hookSpecificOutput"]["hookEventName"],
            "PreToolUse"
        );
        assert_eq!(
            response["hookSpecificOutput"]["permissionDecision"],
            "allow"
        );
        assert_eq!(response["hookSpecificOutput"]["updatedInput"], answer);
        assert_eq!(interaction_response("PreToolUse", json!({})), json!({}));
    }

    #[test]
    fn concurrent_hook_ids_and_pending_reply_registration_are_atomic_and_bounded() {
        let live = fixture();
        let workers: Vec<_> = (0..8)
            .map(|_| {
                let live = live.clone();
                thread::spawn(move || live.event(json!({"hook_event_name":"PermissionRequest"})))
            })
            .collect();
        let ids: std::collections::HashSet<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        let state = live.state.lock().unwrap();
        assert_eq!(ids.len(), 8);
        assert!(ids.iter().all(|id| state.replies.contains_key(id)));
        drop(state);
        for _ in 0..MAX_EVENTS {
            live.event(json!({"hook_event_name":"Stop"}));
        }
        let state = live.state.lock().unwrap();
        assert_eq!(state.events.len(), MAX_EVENTS);
        assert_eq!(state.sequence, MAX_EVENTS as u64 + 8);
    }

    #[test]
    fn permission_http_waits_for_the_matching_reply() {
        use std::io::Write;
        let live = fixture();
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let address = server.server_addr().to_ip().unwrap();
        let worker_live = live.clone();
        let worker = thread::spawn(move || handle_hook(worker_live, server.recv().unwrap()));
        let mut stream = std::net::TcpStream::connect(address).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let body = json!({"session_id":"native-test", "hook_event_name":"PermissionRequest", "tool_name":"Bash"}).to_string();
        write!(stream, "POST /hook/test HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}", body.len(), body).unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let mut state = live.state.lock().unwrap();
            if let Some(reply) = state.replies.get_mut(&1) {
                assert!(reply.is_none());
                *reply = Some(permission_reply("allow", None));
                live.changed.notify_all();
                break;
            }
            drop(state);
            assert!(Instant::now() < deadline, "hook was not registered");
            thread::sleep(Duration::from_millis(5));
        }
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        assert!(response.contains("\"behavior\":\"allow\""));
        worker.join().unwrap();
        assert!(live.state.lock().unwrap().replies.is_empty());
    }

    #[test]
    fn transcript_paths_cannot_escape_the_selected_account() {
        let temp = std::env::temp_dir().join(format!(
            "monocode-interactive-test-{}",
            uuid::Uuid::new_v4()
        ));
        let project = temp.join("projects").join("project");
        std::fs::create_dir_all(&project).unwrap();
        let valid = project.join("native-test.jsonl");
        std::fs::write(&valid, b"{}\n").unwrap();
        let outside = temp.join("native-test.jsonl");
        std::fs::write(&outside, b"{}\n").unwrap();
        assert!(safe_transcript(&temp, "native-test", &valid).is_some());
        assert!(safe_transcript(&temp, "native-test", &outside).is_none());
        assert!(safe_transcript(&temp, "another-id", &valid).is_none());
        #[cfg(unix)]
        {
            let link = project.join("escape");
            std::os::unix::fs::symlink(&temp, &link).unwrap();
            assert!(
                safe_transcript(&temp, "native-test", &link.join("native-test.jsonl")).is_none()
            );
        }
        std::fs::remove_dir_all(temp).unwrap();
    }

    #[test]
    fn an_earlier_stop_during_a_composer_send_does_not_abort_the_paste() {
        for event in ["Stop", "StopFailure", "PostCompact", "SessionStart"] {
            assert_eq!(root_hook_phase("sending", event), None);
            assert_eq!(root_hook_phase("busy", event), Some("ready"));
            assert_eq!(root_hook_phase("unconfirmed", event), Some("ready"));
        }
        assert_eq!(root_hook_phase("sending", "UserPromptSubmit"), Some("busy"));
        assert_eq!(root_hook_phase("sending", "SessionEnd"), Some("ended"));
        assert_eq!(root_hook_phase("ready", "Notification"), None);
    }
}
