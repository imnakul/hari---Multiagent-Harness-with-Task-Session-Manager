//! Fork (L-274): Aside's "Ask Aside" panel runs on MonoCode's CLIs.
//!
//! A local OpenAI-compatible endpoint that Aside lists as custom providers.
//! This side is only transport: each chat request goes to the attached
//! workspace window, which runs the turn in a session and pushes the reply
//! back as server-sent events. The key stays here and in Aside's models.json;
//! it never reaches the webview or the log.
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State, Window};

const DEFAULT_PORT: u16 = 4518;
/// Aside resends the whole chat each turn, page snapshots included.
const MAX_BODY: u64 = 16 * 1024 * 1024;
const MAX_IN_FLIGHT: usize = 8;
/// A comment line this often keeps Aside waiting and finds a closed chat.
const KEEPALIVE: Duration = Duration::from_secs(5);
/// A turn that sends nothing for this long is given up on.
const IDLE_LIMIT: Duration = Duration::from_secs(20 * 60);
/// Aside's model picker shows the provider key, so it reads "hari-…" (L-283).
const PROVIDER_PREFIX: &str = "hari-";
/// Keys written before L-283; replaced on the next "Add models to Aside".
const LEGACY_PREFIX: &str = "monocode-";
/// Aside names its chat here when a model sets `compat.sendSessionAffinityHeaders`.
const SESSION_HEADER: &str = "x-session-affinity";
const MAX_SESSION_ID: usize = 128;

#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
struct Config {
    enabled: bool,
    port: u16,
    key: String,
}

enum Piece {
    Data(String),
    Done,
}

struct Pending {
    window: String,
    sink: mpsc::Sender<Piece>,
}

struct Inner {
    config: Config,
    /// The workspace window that answers requests; the latest to attach.
    window: Option<String>,
    /// Model IDs the window offers, for `GET /v1/models`.
    models: Vec<String>,
    pending: HashMap<String, Pending>,
    server: Option<Arc<tiny_http::Server>>,
    status: String,
}

#[derive(Clone)]
pub struct AsideLink {
    inner: Arc<Mutex<Inner>>,
    path: PathBuf,
    project: PathBuf,
}

fn new_key() -> String {
    format!(
        "mcl_{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = data.join("aside-link.json");
    let saved: Option<Config> = std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok());
    let config = saved.unwrap_or(Config {
        enabled: false,
        port: DEFAULT_PORT,
        key: new_key(),
    });
    let link = AsideLink {
        inner: Arc::new(Mutex::new(Inner {
            config: config.clone(),
            window: None,
            models: Vec::new(),
            pending: HashMap::new(),
            server: None,
            status: "Off".into(),
        })),
        path,
        project: data.join("aside-link").join("CLI"),
    };
    app.manage(link.clone());
    if config.enabled {
        if let Err(error) = start(app, &link) {
            link.inner.lock().unwrap_or_else(|e| e.into_inner()).status = error;
        }
    }
    Ok(())
}

fn save(link: &AsideLink, config: &Config) -> Result<(), String> {
    write_atomic(
        &link.path,
        &serde_json::to_vec(config).map_err(|e| e.to_string())?,
    )
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid settings path")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temporary = parent.join(format!(".monocode-{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&temporary, path).map_err(|e| {
        let _ = std::fs::remove_file(&temporary);
        e.to_string()
    })
}

fn start(app: &AppHandle, link: &AsideLink) -> Result<(), String> {
    stop(link);
    let port = link
        .inner
        .lock()
        .map_err(|_| "Aside link unavailable")?
        .config
        .port;
    let server = Arc::new(
        tiny_http::Server::http(("127.0.0.1", port))
            .map_err(|e| format!("Port {port} is not available: {e}"))?,
    );
    {
        let mut inner = link.inner.lock().map_err(|_| "Aside link unavailable")?;
        inner.server = Some(server.clone());
        inner.status = format!("Listening on 127.0.0.1:{port}");
    }
    let app = app.clone();
    let link = link.clone();
    std::thread::Builder::new()
        .name("aside-link".into())
        .spawn(move || {
            for request in server.incoming_requests() {
                let app = app.clone();
                let link = link.clone();
                let _ = std::thread::Builder::new()
                    .name("aside-link-request".into())
                    .spawn(move || handle(&app, &link, request));
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn stop(link: &AsideLink) {
    let mut inner = link.inner.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(server) = inner.server.take() {
        server.unblock();
    }
    // Dropping the sinks ends every open reply.
    inner.pending.clear();
    inner.status = "Off".into();
}

/// Equal-time comparison, so the key cannot be guessed a byte at a time.
fn same_secret(given: &[u8], expected: &[u8]) -> bool {
    given.len() == expected.len()
        && given
            .iter()
            .zip(expected)
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}

fn authorized(request: &tiny_http::Request, key: &str) -> bool {
    request.headers().iter().any(|header| {
        header.field.equiv("Authorization")
            && header
                .value
                .as_str()
                .strip_prefix("Bearer ")
                .is_some_and(|given| same_secret(given.trim().as_bytes(), key.as_bytes()))
    })
}

/// Aside's chat ID, when it sent a plain short one; anything else is ignored.
fn aside_session(request: &tiny_http::Request) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|header| header.field.equiv(SESSION_HEADER))
        .map(|header| header.value.as_str().trim().to_string())
        .filter(|value| plain_session_id(value))
}

fn plain_session_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_SESSION_ID
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '.'))
}

fn json_response(status: u16, body: &Value) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    tiny_http::Response::from_data(body.to_string().into_bytes())
        .with_status_code(status)
        .with_header(
            tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
                .expect("static header"),
        )
}

fn error_body(message: &str) -> Value {
    json!({ "error": { "message": message, "type": "monocode_error" } })
}

#[derive(Debug, PartialEq)]
enum Route {
    Models,
    Chat,
    Other,
}

fn route(method: &tiny_http::Method, url: &str) -> Route {
    let path = url.split('?').next().unwrap_or("").trim_end_matches('/');
    match (method, path) {
        (tiny_http::Method::Get, "/v1/models") => Route::Models,
        (tiny_http::Method::Post, "/v1/chat/completions") => Route::Chat,
        _ => Route::Other,
    }
}

fn handle(app: &AppHandle, link: &AsideLink, mut request: tiny_http::Request) {
    let (key, models) = {
        let inner = link.inner.lock().unwrap_or_else(|e| e.into_inner());
        (inner.config.key.clone(), inner.models.clone())
    };
    let respond = |request: tiny_http::Request, status: u16, body: Value| {
        let _ = request.respond(json_response(status, &body));
    };
    if !authorized(&request, &key) {
        return respond(request, 401, error_body("Invalid MonoCode key"));
    }
    match route(request.method(), request.url()) {
        Route::Models => {
            let data: Vec<Value> = models
                .iter()
                .map(|id| json!({ "id": id, "object": "model", "owned_by": "monocode" }))
                .collect();
            respond(request, 200, json!({ "object": "list", "data": data }))
        }
        Route::Other => respond(request, 404, error_body("Not found")),
        Route::Chat => {
            let mut raw = Vec::new();
            if request
                .as_reader()
                .take(MAX_BODY + 1)
                .read_to_end(&mut raw)
                .is_err()
            {
                return respond(request, 400, error_body("Could not read the request"));
            }
            if raw.len() as u64 > MAX_BODY {
                return respond(request, 413, error_body("The chat is too large"));
            }
            let body: Value = match serde_json::from_slice(&raw) {
                Ok(value @ Value::Object(_)) => value,
                _ => return respond(request, 400, error_body("Expected a JSON object")),
            };
            let stream = body["stream"] == true;
            let session = aside_session(&request);
            let (id, window, receiver) = match open(app, link, body, stream, session) {
                Ok(opened) => opened,
                Err((status, message)) => return respond(request, status, error_body(&message)),
            };
            if stream {
                stream_reply(app, link, request, &id, &window, receiver);
            } else {
                let reply = collect_reply(&receiver);
                link.inner
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .pending
                    .remove(&id);
                match reply.and_then(|text| serde_json::from_str::<Value>(&text).ok()) {
                    Some(value) => respond(request, 200, value),
                    None => respond(request, 502, error_body("MonoCode did not answer")),
                }
            }
        }
    }
}

/// Hands a chat to the attached window and returns where its reply arrives.
fn open(
    app: &AppHandle,
    link: &AsideLink,
    body: Value,
    stream: bool,
    session: Option<String>,
) -> Result<(String, String, mpsc::Receiver<Piece>), (u16, String)> {
    let mut inner = link
        .inner
        .lock()
        .map_err(|_| (503, "Aside link unavailable".to_string()))?;
    let window = inner
        .window
        .clone()
        .ok_or((503, "Open MonoCode to use its models".to_string()))?;
    if inner.pending.len() >= MAX_IN_FLIGHT {
        return Err((429, "MonoCode is busy; try again".into()));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let (sink, receiver) = mpsc::channel();
    inner.pending.insert(
        id.clone(),
        Pending {
            window: window.clone(),
            sink,
        },
    );
    if app
        .emit_to(
            window.as_str(),
            "monocode-aside-request",
            json!({ "id": id, "stream": stream, "body": body, "session": session }),
        )
        .is_err()
    {
        inner.pending.remove(&id);
        return Err((503, "MonoCode window is unavailable".into()));
    }
    Ok((id, window, receiver))
}

fn collect_reply(receiver: &mpsc::Receiver<Piece>) -> Option<String> {
    let mut text = String::new();
    loop {
        match receiver.recv_timeout(IDLE_LIMIT) {
            Ok(Piece::Data(data)) => text.push_str(&data),
            Ok(Piece::Done) => return Some(text),
            Err(_) => return None,
        }
    }
}

/// One HTTP chunk. Written by hand: tiny_http's own encoder holds 8 KB before
/// it sends anything, which would stall a streamed reply.
fn chunk(data: &str) -> Vec<u8> {
    format!("{:x}\r\n{data}\r\n", data.len()).into_bytes()
}

fn stream_reply(
    app: &AppHandle,
    link: &AsideLink,
    request: tiny_http::Request,
    id: &str,
    window: &str,
    receiver: mpsc::Receiver<Piece>,
) {
    let mut writer = request.into_writer();
    let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nTransfer-Encoding: chunked\r\n\r\n";
    let mut send = |bytes: &[u8]| writer.write_all(bytes).and_then(|_| writer.flush()).is_ok();
    let mut connected = send(head.as_bytes());
    let mut idle = Duration::ZERO;
    while connected {
        let (data, last) = match receiver.recv_timeout(KEEPALIVE) {
            Ok(Piece::Data(data)) => {
                idle = Duration::ZERO;
                (format!("data: {data}\n\n"), false)
            }
            Ok(Piece::Done) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                ("data: [DONE]\n\n".to_string(), true)
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                idle += KEEPALIVE;
                if idle >= IDLE_LIMIT {
                    ("data: [DONE]\n\n".to_string(), true)
                } else {
                    (": keepalive\n\n".to_string(), false)
                }
            }
        };
        connected = send(&chunk(&data));
        if last {
            if connected {
                let _ = send(b"0\r\n\r\n");
            }
            break;
        }
    }
    let was_open = link
        .inner
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .pending
        .remove(id)
        .is_some();
    // Aside stopped or closed the chat while the turn ran.
    if !connected && was_open {
        let _ = app.emit_to(window, "monocode-aside-cancel", json!({ "id": id }));
    }
}

fn status_value(link: &AsideLink, inner: &Inner) -> Value {
    json!({
        "enabled": inner.config.enabled,
        "port": inner.config.port,
        "listening": inner.server.is_some(),
        "status": inner.status,
        "attached": inner.window.is_some(),
        "projectPath": crate::fs::path_to_js(&link.project),
    })
}

#[tauri::command]
pub fn aside_link_status(link: State<'_, AsideLink>) -> Result<Value, String> {
    let inner = link.inner.lock().map_err(|_| "Aside link unavailable")?;
    Ok(status_value(&link, &inner))
}

#[tauri::command]
pub fn aside_link_configure(
    app: AppHandle,
    link: State<'_, AsideLink>,
    enabled: bool,
    port: Option<u16>,
) -> Result<Value, String> {
    let config = {
        let mut inner = link.inner.lock().map_err(|_| "Aside link unavailable")?;
        let mut config = inner.config.clone();
        config.enabled = enabled;
        if let Some(port) = port {
            if port < 1024 {
                return Err("Choose a port from 1024 to 65535".into());
            }
            config.port = port;
        }
        save(&link, &config)?;
        inner.config = config.clone();
        config
    };
    if config.enabled {
        if let Err(error) = start(&app, &link) {
            link.inner
                .lock()
                .map_err(|_| "Aside link unavailable")?
                .status = error;
        }
    } else {
        stop(&link);
    }
    aside_link_status(link)
}

/// The calling workspace window answers Aside from now on.
#[tauri::command]
pub fn aside_link_attach(
    window: Window,
    link: State<'_, AsideLink>,
    models: Vec<String>,
) -> Result<(), String> {
    if !crate::window::is_workspace_window(window.label()) {
        return Err("Only workspace windows can answer Aside".into());
    }
    let mut inner = link.inner.lock().map_err(|_| "Aside link unavailable")?;
    inner.window = Some(window.label().into());
    inner.models = models
        .into_iter()
        .filter(|id| id.len() <= 256)
        .take(512)
        .collect();
    Ok(())
}

#[tauri::command]
pub fn aside_link_detach(window: Window, link: State<'_, AsideLink>) {
    let mut inner = link.inner.lock().unwrap_or_else(|e| e.into_inner());
    if inner.window.as_deref() == Some(window.label()) {
        inner.window = None;
        inner
            .pending
            .retain(|_, pending| pending.window != window.label());
    }
}

fn send_piece(window: &Window, link: &AsideLink, id: &str, piece: Piece) -> Result<(), String> {
    let mut inner = link.inner.lock().map_err(|_| "Aside link unavailable")?;
    let pending = inner
        .pending
        .get(id)
        .filter(|pending| pending.window == window.label())
        .ok_or("gone")?;
    if pending.sink.send(piece).is_err() {
        inner.pending.remove(id);
        return Err("gone".into());
    }
    Ok(())
}

/// The next part of a reply: one SSE event's JSON, or a whole JSON reply for a
/// request that did not stream. "gone" means Aside is no longer listening.
#[tauri::command]
pub fn aside_link_push(
    window: Window,
    link: State<'_, AsideLink>,
    id: String,
    data: String,
) -> Result<(), String> {
    if data.contains("\n\n") {
        return Err("A reply part cannot hold a blank line".into());
    }
    send_piece(&window, &link, &id, Piece::Data(data))
}

#[tauri::command]
pub fn aside_link_finish(
    window: Window,
    link: State<'_, AsideLink>,
    id: String,
) -> Result<(), String> {
    send_piece(&window, &link, &id, Piece::Done)
}

/// Aside's models.json with MonoCode's providers replacing any older ones.
/// Other providers and fields are kept as they are.
fn merge_providers(
    existing: Value,
    providers: &Map<String, Value>,
    base_url: &str,
    key: &str,
) -> Result<Value, String> {
    let mut root = match existing {
        Value::Object(map) => map,
        Value::Null => Map::new(),
        _ => return Err("Aside's models.json is not an object".into()),
    };
    let entry = root
        .entry("providers")
        .or_insert_with(|| Value::Object(Map::new()));
    let target = entry
        .as_object_mut()
        .ok_or("Aside's models.json has no providers object")?;
    target.retain(|name, _| !name.starts_with(PROVIDER_PREFIX) && !name.starts_with(LEGACY_PREFIX));
    for (name, provider) in providers {
        let valid_name = name.starts_with(PROVIDER_PREFIX)
            && name.len() <= 64
            && name
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
        let mut provider = match provider {
            Value::Object(map) if valid_name && map.get("models").is_some_and(Value::is_array) => {
                map.clone()
            }
            _ => return Err(format!("Invalid provider {name}")),
        };
        provider.insert("baseUrl".into(), json!(base_url));
        provider.insert("apiKey".into(), json!(key));
        provider.insert("api".into(), json!("openai-completions"));
        target.insert(name.clone(), Value::Object(provider));
    }
    Ok(Value::Object(root))
}

/// The Aside accounts to write: those with a models.json, else the first one.
fn aside_model_files(home: &Path) -> Vec<PathBuf> {
    let root = home.join(".aside").join("u");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&root)
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| entry.path().join("models.json"))
                .filter(|path| path.is_file())
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    if files.is_empty() && root.join("0").is_dir() {
        files.push(root.join("0").join("models.json"));
    }
    files
}

/// Adds MonoCode's models to every Aside account on this computer. The first
/// write keeps a backup beside the file.
#[tauri::command]
pub fn aside_link_write_models(
    link: State<'_, AsideLink>,
    providers: Map<String, Value>,
) -> Result<Value, String> {
    let (port, key) = {
        let inner = link.inner.lock().map_err(|_| "Aside link unavailable")?;
        (inner.config.port, inner.config.key.clone())
    };
    let home = crate::dirs_home().ok_or("No home folder")?;
    let files = aside_model_files(Path::new(&home));
    if files.is_empty() {
        return Err("Aside is not set up on this computer".into());
    }
    let base_url = format!("http://127.0.0.1:{port}/v1");
    for file in &files {
        let existing = match std::fs::read(file) {
            Ok(bytes) if !bytes.is_empty() => serde_json::from_slice(&bytes)
                .map_err(|_| format!("{} is not valid JSON", file.display()))?,
            _ => Value::Null,
        };
        let merged = merge_providers(existing, &providers, &base_url, &key)?;
        let backup = file.with_extension("json.monocode-backup");
        if file.is_file() && !backup.exists() {
            std::fs::copy(file, &backup).map_err(|e| e.to_string())?;
        }
        write_atomic(
            file,
            &serde_json::to_vec_pretty(&merged).map_err(|e| e.to_string())?,
        )?;
    }
    Ok(json!({ "accounts": files.len() }))
}

const PROJECT_GUIDE: &str = "# Aside chats\n\n\
This folder holds chats started from the Ask Aside panel in the user's Aside browser.\n\
Each message names the page the user has open.\n\n\
- To read or act on that page, use the `aside` MCP server's `repl` tool.\n\
- To operate other apps on this computer, use the `aside-cu` MCP server's `repl` tool when it is available.\n\
- Never use the `aside` MCP server's `exec` tool: it would ask this same chat to answer itself.\n\
- Never run `aside exec` or `aside task` in a shell without `-m` naming one of Aside's own models: \
without it Aside uses its default model, which may be this same Hari chat, and the request loops back here.\n";
/// Every guide MonoCode wrote starts with this; such a file is kept current.
const GUIDE_HEADING: &str = "# Aside chats\n";

/// The folder Aside's chats run in, set up on first use.
#[tauri::command]
pub fn aside_link_project(link: State<'_, AsideLink>) -> Result<String, String> {
    let project = &link.project;
    std::fs::create_dir_all(project.join(".claude")).map_err(|e| e.to_string())?;
    let files = [
        (project.join("AGENTS.md"), PROJECT_GUIDE.to_string()),
        (project.join("CLAUDE.md"), "@AGENTS.md\n".to_string()),
        (
            project.join(".claude").join("settings.json"),
            json!({ "permissions": { "deny": ["mcp__aside__exec"] } }).to_string(),
        ),
    ];
    for (path, contents) in files {
        let current = std::fs::read_to_string(&path).ok();
        if needs_write(current.as_deref(), &contents) {
            std::fs::write(&path, contents).map_err(|e| e.to_string())?;
        }
    }
    Ok(crate::fs::path_to_js(project))
}

/// A missing file is written; an older guide MonoCode wrote is brought up to
/// date; anything the user wrote instead is left alone.
fn needs_write(current: Option<&str>, contents: &str) -> bool {
    match current {
        None => true,
        Some(text) => {
            text != contents
                && text.starts_with(GUIDE_HEADING)
                && contents.starts_with(GUIDE_HEADING)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn providers() -> Map<String, Value> {
        json!({ "hari-claude-interactive": { "name": "Hari · Claude", "models": [{ "id": "opus" }] } })
            .as_object()
            .unwrap()
            .clone()
    }

    #[test]
    fn merging_replaces_older_hari_and_monocode_providers_and_keeps_the_rest() {
        let existing = json!({
            "providers": {
                "openrouter": { "baseUrl": "https://openrouter.ai/api/v1", "models": [] },
                "monocode-claude": { "models": [] },
                "hari-old": { "models": [] }
            },
            "other": 1
        });
        let merged =
            merge_providers(existing, &providers(), "http://127.0.0.1:4518/v1", "k").unwrap();
        let list = merged["providers"].as_object().unwrap();
        assert!(list.contains_key("openrouter"));
        assert!(!list.contains_key("monocode-claude"));
        assert!(!list.contains_key("hari-old"));
        let claude = &list["hari-claude-interactive"];
        assert_eq!(claude["baseUrl"], "http://127.0.0.1:4518/v1");
        assert_eq!(claude["apiKey"], "k");
        assert_eq!(claude["api"], "openai-completions");
        assert_eq!(merged["other"], 1);
    }

    #[test]
    fn merging_refuses_names_outside_hari_and_providers_without_models() {
        let foreign = json!({ "openrouter": { "models": [] } });
        assert!(merge_providers(Value::Null, foreign.as_object().unwrap(), "u", "k").is_err());
        let legacy = json!({ "monocode-claude": { "models": [] } });
        assert!(merge_providers(Value::Null, legacy.as_object().unwrap(), "u", "k").is_err());
        let bare = json!({ "hari-x": { "name": "x" } });
        assert!(merge_providers(Value::Null, bare.as_object().unwrap(), "u", "k").is_err());
        assert!(merge_providers(json!([]), &providers(), "u", "k").is_err());
    }

    #[test]
    fn merging_an_empty_file_creates_the_providers_object() {
        let merged = merge_providers(Value::Null, &providers(), "u", "k").unwrap();
        assert!(merged["providers"]["hari-claude-interactive"].is_object());
    }

    #[test]
    fn the_guide_is_kept_current_but_a_users_file_is_not_replaced() {
        assert!(needs_write(None, PROJECT_GUIDE));
        assert!(!needs_write(Some(PROJECT_GUIDE), PROJECT_GUIDE));
        assert!(needs_write(
            Some("# Aside chats\n\nolder words\n"),
            PROJECT_GUIDE
        ));
        assert!(!needs_write(Some("# My own notes\n"), PROJECT_GUIDE));
        assert!(!needs_write(Some("{}"), "@AGENTS.md\n"));
    }

    #[test]
    fn session_ids_are_plain_and_short() {
        assert!(plain_session_id("aside:aux:memory-dream"));
        assert!(plain_session_id("0b6d3c1e-5f9a-4c1e-9d2b-7a3f1c2e4d5f"));
        assert!(!plain_session_id(""));
        assert!(!plain_session_id("a b"));
        assert!(!plain_session_id("<script>"));
        assert!(!plain_session_id(&"a".repeat(MAX_SESSION_ID + 1)));
    }

    #[test]
    fn secrets_compare_whole() {
        assert!(same_secret(b"abc", b"abc"));
        assert!(!same_secret(b"abd", b"abc"));
        assert!(!same_secret(b"ab", b"abc"));
    }

    #[test]
    fn routes_match_the_openai_paths_only() {
        use tiny_http::Method;
        assert_eq!(route(&Method::Get, "/v1/models"), Route::Models);
        assert_eq!(
            route(&Method::Post, "/v1/chat/completions?x=1"),
            Route::Chat
        );
        assert_eq!(route(&Method::Get, "/v1/chat/completions"), Route::Other);
        assert_eq!(route(&Method::Post, "/v1/completions"), Route::Other);
    }

    #[test]
    fn chunks_carry_their_hex_length() {
        assert_eq!(chunk("hello"), b"5\r\nhello\r\n".to_vec());
        assert_eq!(chunk(&"a".repeat(26))[..4], *b"1a\r\n");
    }

    #[test]
    fn model_files_fall_back_to_the_first_account() {
        let home = std::env::temp_dir().join(format!("aside-link-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(home.join(".aside/u/0")).unwrap();
        std::fs::create_dir_all(home.join(".aside/u/1")).unwrap();
        assert_eq!(
            aside_model_files(&home),
            vec![home.join(".aside/u/0/models.json")]
        );
        std::fs::write(home.join(".aside/u/1/models.json"), "{}").unwrap();
        assert_eq!(
            aside_model_files(&home),
            vec![home.join(".aside/u/1/models.json")]
        );
        let _ = std::fs::remove_dir_all(home);
    }
}
