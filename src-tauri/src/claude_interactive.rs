//! Local interactive Claude owner. No print/SDK transport and no global config writes.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
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
    submissions: std::collections::HashSet<String>,
}

impl Live {
    fn event(&self, mut value: Value) -> u64 {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
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
}

fn validate_start(input: &StartInput) -> Result<(), String> {
    uuid::Uuid::parse_str(&input.native_id).map_err(|_| "Invalid Claude native session ID")?;
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
        "PostCompact",
        "Notification",
        "PreToolUse",
        "PostToolUse",
        "PostToolUseFailure",
        "PermissionRequest",
    ] {
        hooks.insert(event.into(), json!([{"matcher":"*", "hooks":[{
            "type":"http", "url":url, "timeout": if event == "PermissionRequest" { 600 } else { 10 }
        }]}]));
    }
    json!({"hooks":hooks, "fastMode":fast})
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
    let root = crate::provider_sessions::root_for(
        &app,
        &crate::provider_sessions::Provider::Claude,
        input.account_id.as_deref().unwrap_or("default"),
    )?;
    let account_dir =
        crate::harness::provider_account_dir(&app, "claude", input.account_id.as_deref())?;
    let transcript = if input.resume {
        let conversation = crate::provider_sessions::provider_sessions_resolve(
            app.clone(),
            app.state(),
            crate::provider_sessions::Provider::Claude,
            input.account_id.clone(),
            input.native_id.clone(),
        )?;
        if crate::provider_sessions::cwd_key(&conversation.cwd)
            != crate::provider_sessions::cwd_key(&input.cwd)
        {
            return Err("Native Claude conversation belongs to a different folder".into());
        }
        crate::provider_sessions::find_transcript(
            &crate::provider_sessions::Provider::Claude,
            &root.join("projects"),
            &input.native_id,
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
            transcript,
            offset,
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
        if input.resume {
            "--resume"
        } else {
            "--session-id"
        }
        .into(),
        input.native_id,
        "--model".into(),
        input.model,
        "--permission-mode".into(),
        input.permission_mode,
        "--settings".into(),
        settings,
    ];
    if let Some(effort) = input.effort {
        args.extend(["--effort".into(), effort]);
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
        if value["agent_id"].is_null() {
            match event {
                "SessionStart" | "Stop" | "StopFailure" | "PostCompact" => {
                    state.phase = "ready".into()
                }
                "UserPromptSubmit" => state.phase = "busy".into(),
                "SessionEnd" => state.phase = "ended".into(),
                _ => {}
            }
            if let Some(path) = value["transcript_path"]
                .as_str()
                .and_then(|p| safe_transcript(&live.root, &live.native_id, Path::new(p)))
            {
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
        .and_then(|p| safe_transcript(&live.root, &live.native_id, p))
    {
        let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
        if file.metadata().map_err(|e| e.to_string())?.len() < state.offset {
            return Err("Claude transcript was replaced or truncated; review the terminal".into());
        }
        file.seek(SeekFrom::Start(state.offset))
            .map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        file.take(MAX_BODY + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        more = bytes.len() as u64 > MAX_BODY;
        if let Some(end) = bytes
            .iter()
            .take(MAX_BODY as usize)
            .rposition(|b| *b == b'\n')
        {
            lines = String::from_utf8(bytes[..=end].to_vec())
                .map_err(|e| e.to_string())?
                .lines()
                .map(String::from)
                .collect();
            state.offset += (end + 1) as u64;
        } else if more {
            return Err("Claude transcript record exceeds the interactive read limit".into());
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

#[tauri::command(async)]
pub fn claude_interactive_send(
    app: AppHandle,
    host: State<'_, InteractiveHost>,
    session_id: String,
    submission_id: String,
    text: String,
) -> Result<(), String> {
    if text.is_empty()
        || text.len() > 512 * 1024
        || text
            .chars()
            .any(|c| c.is_control() && c != '\n' && c != '\t')
        || text.trim_start().starts_with('/')
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
        if state.submissions.len() >= 10000 || !state.submissions.insert(submission_id) {
            return Err(
                "Submission already attempted or session delivery ledger full; review the terminal"
                    .into(),
            );
        }
        state.phase = "sending".into();
        state.writing = true;
    }
    // A write error is uncertain: retain the ledger and never retry either part.
    let result = (|| {
        crate::pty::pty_write(
            app.state(),
            pty_id(&session_id),
            format!("\x1b[200~{text}\x1b[201~"),
        )?;
        thread::sleep(Duration::from_millis(120));
        let state = live.state.lock().unwrap_or_else(|e| e.into_inner());
        if state.phase != "sending" || state.terminal_owner || !live.running.load(Ordering::Acquire)
        {
            return Err("Input was pasted but not submitted. Review the native terminal; do not resend automatically.".into());
        }
        crate::pty::pty_write(app.state(), pty_id(&session_id), "\r".into())
    })();
    let mut state = live.state.lock().unwrap_or_else(|e| e.into_inner());
    state.writing = false;
    if result.is_err() && state.phase == "sending" {
        state.phase = "unconfirmed".into();
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
        state.terminal_owner = true;
        drop(state);
        crate::pty::pty_write(app.state(), pty_id(&session_id), data)
    } else {
        if state.phase != "ready" {
            return Err(
                "Wait for the native conversation to finish before returning to chat".into(),
            );
        }
        state.terminal_owner = false;
        Ok(())
    }
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
    fn interactive_settings_use_local_http_hooks_without_headless_flags() {
        let settings = hook_settings("http://127.0.0.1:1234/hook/token", false);
        assert_eq!(
            settings["hooks"]["PermissionRequest"][0]["hooks"][0]["type"],
            "http"
        );
        assert_eq!(settings["fastMode"], false);
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
}
