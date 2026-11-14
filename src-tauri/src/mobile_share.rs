//! Fork (Hari, L-279): Share between the computer and its paired phones.
//!
//! - **Text, links and clipboard** travel as `share` items on the event
//!   stream's outboxes (both ways), so they wait while the other side is away.
//!   A `clipboard` item goes on the receiving clipboard.
//! - **Files to the phone** are offered as a `share` item; the phone fetches
//!   them with `share.download` in 1 MB pieces, read from where the user picked
//!   them (for 7 days).
//! - **Files from the phone** arrive with `share.upload`, 1 MB at a time, in
//!   order, and land in `Downloads\Hari` under a free name.
//!
//! The history (the last 100 items) is kept in `share-history.json`. Removing
//! an entry never deletes a file.
use std::{
    collections::HashMap,
    fs::OpenOptions,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, Window};

const METHODS: [&str; 2] = ["share.upload", "share.download"];
const FILE: &str = "share-history.json";
const MAX_HISTORY: usize = 100;
const MAX_TEXT_CHARS: usize = 30_000;
const MAX_FILE_BYTES: u64 = 100 * 1024 * 1024;
const CHUNK_BYTES: usize = 1024 * 1024;
const MAX_FILES_PER_SEND: usize = 20;
/// How long the phone can still fetch an offered file.
const OFFER_AGE_MS: u64 = 7 * 24 * 60 * 60 * 1000;
/// An upload with no piece for this long is dropped (its part file deleted).
const STALE_UPLOAD_MS: u64 = 60 * 60 * 1000;
const MAX_ID_CHARS: usize = 128;
const MAX_NAME_CHARS: usize = 150;
const FOLDER: &str = "Hari";
const CHANGE_EVENT: &str = "monocode-share-changed";
/// Clicking an arrival toast opens Share (`handle_click` routes it here).
pub(crate) const NOTIFICATION_PREFIX: &str = "hari-share:";
const OPEN_EVENT: &str = "monocode-share-open";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Direction {
    In,
    Out,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Kind {
    Text,
    Link,
    Clipboard,
    File,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Status {
    /// Waiting for the phone (not taken yet, or a file not fetched yet).
    Queued,
    Done,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    /// For a file, also its id on the link.
    id: String,
    direction: Direction,
    kind: Kind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    size: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    mime_type: Option<String>,
    /// Where the file is on this computer: the saved copy, or the original sent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    /// The phone's name, for entries that came from or went to one phone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    device: Option<String>,
    at: u64,
    status: Status,
}

struct Upload {
    peer: String,
    name: String,
    mime_type: String,
    size: u64,
    received: u64,
    part: PathBuf,
    touched: u64,
}

#[derive(Default)]
struct Share {
    path: Option<PathBuf>,
    /// Newest first.
    entries: Vec<Entry>,
    uploads: HashMap<String, Upload>,
}

static SHARE: Mutex<Option<Share>> = Mutex::new(None);

fn with<T>(apply: impl FnOnce(&mut Share) -> T) -> Result<T, String> {
    let mut guard = SHARE.lock().map_err(|_| "Share unavailable")?;
    Ok(apply(guard.get_or_insert_with(Share::default)))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

/// Loads the history. A missing or unreadable file starts empty.
pub fn init(app: &AppHandle) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(FILE);
    let mut entries: Vec<Entry> = std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    entries.truncate(MAX_HISTORY);
    with(|share| {
        share.path = Some(path);
        share.entries = entries;
    })
}

fn save(share: &Share) {
    let Some(path) = share.path.as_ref() else {
        return;
    };
    let Ok(bytes) = serde_json::to_vec(&share.entries) else {
        return;
    };
    let temp = path.with_extension("json.tmp");
    if std::fs::write(&temp, bytes).is_ok() {
        if let Err(error) = std::fs::rename(&temp, path) {
            eprintln!("monocode: couldn't save the Share history: {error}");
        }
    }
}

fn record(share: &mut Share, entry: Entry) {
    share.entries.retain(|old| old.id != entry.id);
    share.entries.insert(0, entry);
    share.entries.truncate(MAX_HISTORY);
    save(share);
}

fn changed(app: &AppHandle) {
    let _ = app.emit(CHANGE_EVENT, ());
}

/// Text that is one web address is a link; anything else is text.
fn kind_for_text(text: &str) -> Kind {
    let trimmed = text.trim();
    let is_url = (trimmed.starts_with("https://") || trimmed.starts_with("http://"))
        && !trimmed.chars().any(char::is_whitespace);
    if is_url {
        Kind::Link
    } else {
        Kind::Text
    }
}

fn checked_text(text: &str) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err("Nothing to send".into());
    }
    if text.chars().count() > MAX_TEXT_CHARS {
        return Err("That text is too long to send (30,000 characters at most)".into());
    }
    Ok(text.to_string())
}

/// A file name that is safe on Windows: no folders, reserved names or
/// characters, at most 150 characters with the extension kept.
fn safe_name(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim().trim_end_matches(['.', ' ']).to_string();
    let mut name = if cleaned.trim_start_matches('.').is_empty() {
        "file".to_string()
    } else {
        cleaned
    };
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && stem.as_bytes()[3].is_ascii_digit());
    if reserved {
        name.insert(0, '_');
    }
    if name.chars().count() > MAX_NAME_CHARS {
        let (stem, ext) = split_extension(&name);
        let keep = MAX_NAME_CHARS.saturating_sub(ext.chars().count());
        name = stem.chars().take(keep).collect::<String>() + ext;
    }
    name
}

/// ("report", ".pdf"); a name with no dot, or only a leading one, has none.
fn split_extension(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(dot) if dot > 0 && name.len() - dot <= 16 => name.split_at(dot),
        _ => (name, ""),
    }
}

/// `dir\name`, or `name (2)`, `name (3)`… when taken.
fn free_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = split_extension(name);
    (2..10_000)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|path| !path.exists())
        .unwrap_or_else(|| dir.join(format!("{stem} ({}){ext}", uuid::Uuid::new_v4())))
}

fn received_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .download_dir()
        .map_err(|_| "Couldn't find the Downloads folder")?
        .join(FOLDER);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_ID_CHARS
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn toast(app: &AppHandle, id: &str, title: String, body: String) {
    let app = app.clone();
    let identifier = format!("{NOTIFICATION_PREFIX}{id}");
    tauri::async_runtime::spawn(async move {
        if let Err(error) = crate::notifications::show_notification(
            app,
            identifier,
            title,
            String::new(),
            body,
            false,
        )
        .await
        {
            eprintln!("monocode: couldn't show the Share toast: {error}");
        }
    });
}

/// Clicked arrival toast: the windows open Share.
pub(crate) fn open_from_notification(app: &AppHandle) {
    let _ = app.emit(OPEN_EVENT, ());
}

fn preview(text: &str) -> String {
    let single: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if single.chars().count() > 200 {
        single.chars().take(199).collect::<String>() + "…"
    } else {
        single
    }
}

fn phone_name(app: &AppHandle, peer: &str) -> Option<String> {
    crate::mobile_access::paired_phones(app)
        .into_iter()
        .find(|(fingerprint, _)| fingerprint == peer)
        .map(|(_, name)| name)
}

/// A `share` item from a phone (text, link or clipboard).
pub(crate) fn receive(app: &AppHandle, peer: &str, payload: &Value) -> Result<(), String> {
    let text = checked_text(payload["text"].as_str().ok_or("Missing text")?)?;
    let kind = match payload["type"].as_str() {
        Some("clipboard") => Kind::Clipboard,
        Some("text") | Some("link") => kind_for_text(&text),
        _ => return Err("Unsupported share".into()),
    };
    if kind == Kind::Clipboard {
        arboard::Clipboard::new()
            .and_then(|mut clipboard| clipboard.set_text(text.clone()))
            .map_err(|_| "Couldn't set the computer's clipboard")?;
    }
    // Fork (Hari, L-286): "Open on computer" from a chat's link. Only a web
    // link (`kind_for_text` checked the scheme), in the default browser.
    let opened = wants_open(payload, kind);
    if opened {
        open::that_detached(text.trim())
            .map_err(|_| "Couldn't open the link in the computer's browser")?;
    }
    let device = phone_name(app, peer);
    let id = uuid::Uuid::new_v4().to_string();
    with(|share| {
        record(
            share,
            Entry {
                id: id.clone(),
                direction: Direction::In,
                kind,
                text: Some(text.clone()),
                name: None,
                size: None,
                mime_type: None,
                path: None,
                device: device.clone(),
                at: now_ms(),
                status: Status::Done,
            },
        )
    })?;
    changed(app);
    let from = device.unwrap_or_else(|| "your phone".into());
    let title = match kind {
        Kind::Clipboard => format!("Clipboard from {from}"),
        Kind::Link if opened => format!("Opened a link from {from}"),
        Kind::Link => format!("Link from {from}"),
        _ => format!("Text from {from}"),
    };
    toast(app, &id, title, preview(&text));
    Ok(())
}

/// Whether a phone's share asks to open its link here (`open: true`, a web link).
fn wants_open(payload: &Value, kind: Kind) -> bool {
    kind == Kind::Link && payload["open"].as_bool() == Some(true)
}

/// The phone took these `share` items from its outbox: text arrived.
pub(crate) fn acked(app: &AppHandle, payloads: &[Value]) {
    let ids: Vec<&str> = payloads
        .iter()
        .filter(|payload| payload["type"] != "file")
        .filter_map(|payload| payload["entryId"].as_str())
        .collect();
    if ids.is_empty() {
        return;
    }
    let updated = with(|share| {
        let mut updated = false;
        for entry in share.entries.iter_mut() {
            if entry.status == Status::Queued && ids.contains(&entry.id.as_str()) {
                entry.status = Status::Done;
                updated = true;
            }
        }
        if updated {
            save(share);
        }
        updated
    });
    if updated == Ok(true) {
        changed(app);
    }
}

fn push_to_phones(app: &AppHandle, payload: Value) -> Result<(), String> {
    let phones = crate::mobile_access::paired_phones(app);
    if phones.is_empty() {
        return Err("Pair a phone first".into());
    }
    let mut last_error = None;
    let mut sent = 0;
    for (peer, _) in &phones {
        match crate::mobile_events::push(peer, "share", payload.clone()) {
            Ok(_) => sent += 1,
            Err(error) => last_error = Some(error),
        }
    }
    if sent == 0 {
        return Err(last_error.unwrap_or_else(|| "Couldn't send".into()));
    }
    Ok(())
}

fn only_one_phone_name(app: &AppHandle) -> Option<String> {
    let phones = crate::mobile_access::paired_phones(app);
    match phones.as_slice() {
        [(_, name)] => Some(name.clone()),
        _ => None,
    }
}

fn check_window(window: &Window) -> Result<(), String> {
    if crate::window::is_workspace_window(window.label()) {
        Ok(())
    } else {
        Err("Only workspace windows can use Share".into())
    }
}

#[tauri::command]
pub fn mobile_share_list(app: AppHandle) -> Result<Value, String> {
    let phones = crate::mobile_access::paired_phones(&app).len();
    let entries = with(|share| share.entries.clone())?;
    Ok(json!({ "items": entries, "phones": phones }))
}

/// Sends text to every paired phone: as text (a link when it is one address)
/// or onto the phone's clipboard. `open` (L-287) asks the phone to open a
/// web link as well; it is refused for anything that isn't one.
#[tauri::command]
pub fn mobile_share_send_text(
    window: Window,
    app: AppHandle,
    text: String,
    clipboard: bool,
    open: Option<bool>,
) -> Result<(), String> {
    check_window(&window)?;
    let text = checked_text(&text)?;
    let open = open == Some(true);
    if open && (clipboard || kind_for_text(&text) != Kind::Link) {
        return Err("Only web links open on the phone".into());
    }
    send_text(&app, text, clipboard, open)
}

/// Sends the computer's clipboard text onto the phone's clipboard.
#[tauri::command]
pub fn mobile_share_send_clipboard(window: Window, app: AppHandle) -> Result<(), String> {
    check_window(&window)?;
    let text = arboard::Clipboard::new()
        .and_then(|mut clipboard| clipboard.get_text())
        .map_err(|_| "The clipboard has no text")?;
    send_text(&app, checked_text(&text)?, true, false)
}

fn send_text(app: &AppHandle, text: String, clipboard: bool, open: bool) -> Result<(), String> {
    let kind = if clipboard {
        Kind::Clipboard
    } else {
        kind_for_text(&text)
    };
    let id = uuid::Uuid::new_v4().to_string();
    let type_name = match kind {
        Kind::Clipboard => "clipboard",
        Kind::Link => "link",
        _ => "text",
    };
    let mut payload = json!({ "type": type_name, "text": text, "entryId": id });
    if open {
        payload["open"] = json!(true);
    }
    push_to_phones(app, payload)?;
    with(|share| {
        record(
            share,
            Entry {
                id,
                direction: Direction::Out,
                kind,
                text: Some(text),
                name: None,
                size: None,
                mime_type: None,
                path: None,
                device: only_one_phone_name(app),
                at: now_ms(),
                status: Status::Queued,
            },
        )
    })?;
    changed(app);
    Ok(())
}

/// Offers these files to every paired phone (each fetches them itself).
#[tauri::command]
pub fn mobile_share_send_files(
    window: Window,
    app: AppHandle,
    paths: Vec<String>,
) -> Result<(), String> {
    check_window(&window)?;
    if paths.is_empty() {
        return Err("Choose a file first".into());
    }
    if paths.len() > MAX_FILES_PER_SEND {
        return Err(format!("Send at most {MAX_FILES_PER_SEND} files at once"));
    }
    let mut files = Vec::new();
    for raw in &paths {
        let path = PathBuf::from(raw);
        let meta = std::fs::metadata(&path).map_err(|_| format!("Couldn't read {raw}"))?;
        if !meta.is_file() {
            return Err(format!("{raw} is not a file (folders can't be sent)"));
        }
        if meta.len() > MAX_FILE_BYTES {
            return Err(format!(
                "{} is over 100 MB",
                path.file_name()
                    .map_or(raw.clone(), |n| n.to_string_lossy().into())
            ));
        }
        let name = safe_name(
            &path
                .file_name()
                .map_or(String::new(), |n| n.to_string_lossy().into()),
        );
        files.push((path, name, meta.len()));
    }
    let device = only_one_phone_name(&app);
    for (path, name, size) in files {
        let id = uuid::Uuid::new_v4().to_string();
        let mime_type = mime_for(&name);
        push_to_phones(
            &app,
            json!({ "type": "file", "fileId": id, "name": name, "mimeType": mime_type, "size": size }),
        )?;
        with(|share| {
            record(
                share,
                Entry {
                    id,
                    direction: Direction::Out,
                    kind: Kind::File,
                    text: None,
                    name: Some(name),
                    size: Some(size),
                    mime_type: Some(mime_type.into()),
                    path: Some(path.to_string_lossy().into()),
                    device: device.clone(),
                    at: now_ms(),
                    status: Status::Queued,
                },
            )
        })?;
    }
    changed(&app);
    Ok(())
}

/// Fork (Hari, L-280): offers a file the computer made (a screenshot) to the
/// one phone that asked for it; it lands in that phone's Share like any file.
pub(crate) fn offer_file(app: &AppHandle, peer: &str, path: &Path) -> Result<Value, String> {
    let size = std::fs::metadata(path)
        .map_err(|_| "Couldn't read the file")?
        .len();
    if size > MAX_FILE_BYTES {
        return Err("The file is over 100 MB".into());
    }
    let name = safe_name(
        &path
            .file_name()
            .map_or(String::new(), |n| n.to_string_lossy().into()),
    );
    let id = uuid::Uuid::new_v4().to_string();
    let mime_type = mime_for(&name);
    crate::mobile_events::push(
        peer,
        "share",
        json!({ "type": "file", "fileId": id, "name": name, "mimeType": mime_type, "size": size }),
    )?;
    with(|share| {
        record(
            share,
            Entry {
                id: id.clone(),
                direction: Direction::Out,
                kind: Kind::File,
                text: None,
                name: Some(name.clone()),
                size: Some(size),
                mime_type: Some(mime_type.into()),
                path: Some(path.to_string_lossy().into()),
                device: phone_name(app, peer),
                at: now_ms(),
                status: Status::Queued,
            },
        )
    })?;
    changed(app);
    Ok(json!({ "fileId": id, "name": name, "size": size }))
}

/// Removes entries from the history; files on disk stay. No ids: clears it.
#[tauri::command]
pub fn mobile_share_remove(
    window: Window,
    app: AppHandle,
    ids: Option<Vec<String>>,
) -> Result<(), String> {
    check_window(&window)?;
    with(|share| {
        match ids {
            Some(ids) => share.entries.retain(|entry| !ids.contains(&entry.id)),
            None => share.entries.clear(),
        }
        save(share);
    })?;
    changed(&app);
    Ok(())
}

/// A common type for a file name, so the phone can open it; else a generic one.
fn mime_for(name: &str) -> &'static str {
    let ext = split_extension(name).1.to_ascii_lowercase();
    match ext.as_str() {
        ".png" => "image/png",
        ".jpg" | ".jpeg" => "image/jpeg",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        ".heic" => "image/heic",
        ".svg" => "image/svg+xml",
        ".mp4" => "video/mp4",
        ".mov" => "video/quicktime",
        ".webm" => "video/webm",
        ".mp3" => "audio/mpeg",
        ".m4a" => "audio/mp4",
        ".wav" => "audio/wav",
        ".pdf" => "application/pdf",
        ".zip" => "application/zip",
        ".txt" | ".log" => "text/plain",
        ".md" => "text/markdown",
        ".csv" => "text/csv",
        ".json" => "application/json",
        ".html" | ".htm" => "text/html",
        ".apk" => "application/vnd.android.package-archive",
        ".doc" => "application/msword",
        ".docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        _ => "application/octet-stream",
    }
}

pub(crate) fn handles(method: &str) -> bool {
    METHODS.contains(&method)
}

/// `share.upload` and `share.download`, from a paired phone. File work runs
/// off the async threads.
pub(crate) async fn handle(
    app: &AppHandle,
    peer: &str,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let app = app.clone();
    let peer = peer.to_string();
    let method = method.to_string();
    tauri::async_runtime::spawn_blocking(move || match method.as_str() {
        "share.upload" => upload(&app, &peer, &params),
        "share.download" => download(&app, &params),
        _ => Err("Unsupported mobile operation".into()),
    })
    .await
    .map_err(|_| "Share failed".to_string())?
}

fn download(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let file_id = params["fileId"].as_str().ok_or("Missing file")?;
    let offset = params["offset"].as_u64().ok_or("Missing offset")?;
    let path = with(|share| {
        share
            .entries
            .iter()
            .find(|entry| {
                entry.id == file_id && entry.direction == Direction::Out && entry.kind == Kind::File
            })
            .and_then(|entry| {
                (now_ms().saturating_sub(entry.at) <= OFFER_AGE_MS)
                    .then(|| entry.path.clone())
                    .flatten()
            })
    })?
    .ok_or("That file is no longer offered")?;
    let mut file =
        std::fs::File::open(&path).map_err(|_| "That file is no longer on the computer")?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    if size > MAX_FILE_BYTES {
        return Err("That file is now over 100 MB".into());
    }
    if offset > size {
        return Err("Past the end of the file".into());
    }
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| e.to_string())?;
    let mut buffer = Vec::with_capacity(CHUNK_BYTES);
    file.take(CHUNK_BYTES as u64)
        .read_to_end(&mut buffer)
        .map_err(|e| e.to_string())?;
    if offset + buffer.len() as u64 >= size {
        let updated = with(|share| {
            let entry = share
                .entries
                .iter_mut()
                .find(|entry| entry.id == file_id && entry.status == Status::Queued);
            let found = entry.is_some();
            if let Some(entry) = entry {
                entry.status = Status::Done;
                save(share);
            }
            found
        })?;
        if updated {
            changed(app);
        }
    }
    Ok(json!({ "data": STANDARD.encode(&buffer), "size": size }))
}

fn upload(app: &AppHandle, peer: &str, params: &Value) -> Result<Value, String> {
    let file_id = params["fileId"]
        .as_str()
        .filter(|id| valid_id(id))
        .ok_or("Missing file")?;
    let offset = params["offset"].as_u64().ok_or("Missing offset")?;
    let size = params["size"].as_u64().ok_or("Missing size")?;
    if size > MAX_FILE_BYTES {
        return Err("Files over 100 MB can't be sent".into());
    }
    let data = STANDARD
        .decode(params["data"].as_str().ok_or("Missing data")?)
        .map_err(|_| "Invalid data")?;
    if data.len() > CHUNK_BYTES {
        return Err("Piece too large".into());
    }
    let name = safe_name(params["name"].as_str().unwrap_or("file"));
    let mime_type = params["mimeType"]
        .as_str()
        .filter(|mime| mime.len() <= 128 && mime.contains('/'))
        .unwrap_or("application/octet-stream")
        .to_string();
    let dir = received_dir(app)?;
    let now = now_ms();

    let mut guard = SHARE.lock().map_err(|_| "Share unavailable")?;
    let share = guard.get_or_insert_with(Share::default);
    // Sent before and saved: the phone's answer was lost, don't save twice.
    if offset == 0
        && share
            .entries
            .iter()
            .any(|entry| entry.id == file_id && entry.direction == Direction::In)
    {
        return Ok(json!({ "received": size, "done": true }));
    }
    let stale: Vec<String> = share
        .uploads
        .iter()
        .filter(|(_, upload)| now.saturating_sub(upload.touched) > STALE_UPLOAD_MS)
        .map(|(id, _)| id.clone())
        .collect();
    for id in stale {
        if let Some(upload) = share.uploads.remove(&id) {
            let _ = std::fs::remove_file(upload.part);
        }
    }
    if offset == 0 {
        if let Some(old) = share.uploads.remove(file_id) {
            let _ = std::fs::remove_file(old.part);
        }
        share.uploads.insert(
            file_id.to_string(),
            Upload {
                peer: peer.to_string(),
                name,
                mime_type,
                size,
                received: 0,
                part: dir.join(format!(".hari-{file_id}.part")),
                touched: now,
            },
        );
    }
    let upload = share
        .uploads
        .get_mut(file_id)
        .filter(|upload| upload.peer == peer && upload.size == size)
        .ok_or("Upload out of step; send it again")?;
    if upload.received != offset {
        return Err("Upload out of step; send it again".into());
    }
    if upload.received + data.len() as u64 > size {
        let part = upload.part.clone();
        share.uploads.remove(file_id);
        let _ = std::fs::remove_file(part);
        return Err("More data than the file's size".into());
    }
    let written = OpenOptions::new()
        .create(true)
        .append(offset != 0)
        .write(true)
        .truncate(offset == 0)
        .open(&upload.part)
        .and_then(|mut file| file.write_all(&data));
    if let Err(error) = written {
        let part = upload.part.clone();
        share.uploads.remove(file_id);
        let _ = std::fs::remove_file(part);
        return Err(format!("Couldn't save the file: {error}"));
    }
    upload.received += data.len() as u64;
    upload.touched = now;
    if upload.received < size {
        return Ok(json!({ "received": upload.received, "done": false }));
    }
    let Some(done) = share.uploads.remove(file_id) else {
        return Err("Upload lost".into());
    };
    let target = free_path(&dir, &done.name);
    std::fs::rename(&done.part, &target).map_err(|error| {
        let _ = std::fs::remove_file(&done.part);
        format!("Couldn't save the file: {error}")
    })?;
    let saved_name = target
        .file_name()
        .map_or(done.name.clone(), |n| n.to_string_lossy().into());
    let device = phone_name(app, peer);
    record(
        share,
        Entry {
            id: file_id.to_string(),
            direction: Direction::In,
            kind: Kind::File,
            text: None,
            name: Some(saved_name.clone()),
            size: Some(size),
            mime_type: Some(done.mime_type),
            path: Some(target.to_string_lossy().into()),
            device: device.clone(),
            at: now,
            status: Status::Done,
        },
    );
    drop(guard);
    changed(app);
    toast(
        app,
        file_id,
        format!(
            "File from {}",
            device.unwrap_or_else(|| "your phone".into())
        ),
        format!("{saved_name} · saved to Downloads\\{FOLDER}"),
    );
    Ok(json!({ "received": size, "done": true }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_only_web_links_that_ask() {
        let asks = json!({ "type": "link", "text": "http://localhost:3000", "open": true });
        assert!(wants_open(&asks, kind_for_text("http://localhost:3000")));
        let plain = json!({ "type": "link", "text": "https://example.com" });
        assert!(!wants_open(&plain, kind_for_text("https://example.com")));
        let not_web = json!({ "type": "link", "text": "file:///C:/x", "open": true });
        assert!(!wants_open(&not_web, kind_for_text("file:///C:/x")));
        let clipboard = json!({ "type": "clipboard", "text": "https://example.com", "open": true });
        assert!(!wants_open(&clipboard, Kind::Clipboard));
    }

    #[test]
    fn one_web_address_is_a_link_and_anything_else_is_text() {
        assert_eq!(kind_for_text(" https://example.com/a?b=c "), Kind::Link);
        assert_eq!(kind_for_text("http://x.dev"), Kind::Link);
        assert_eq!(kind_for_text("see https://example.com"), Kind::Text);
        assert_eq!(kind_for_text("ftp://x"), Kind::Text);
    }

    #[test]
    fn empty_and_overlong_text_is_refused() {
        assert!(checked_text("  \n").is_err());
        assert!(checked_text(&"x".repeat(MAX_TEXT_CHARS + 1)).is_err());
        assert_eq!(checked_text("hi").as_deref(), Ok("hi"));
    }

    #[test]
    fn file_names_are_safe_on_windows() {
        assert_eq!(safe_name("..\\..\\evil.exe"), "evil.exe");
        assert_eq!(safe_name("a/b/photo.jpg"), "photo.jpg");
        assert_eq!(safe_name("what?.txt"), "what_.txt");
        assert_eq!(safe_name("con.txt"), "_con.txt");
        assert_eq!(safe_name("COM1"), "_COM1");
        assert_eq!(safe_name("COMET.txt"), "COMET.txt");
        assert_eq!(safe_name("notes. "), "notes");
        assert_eq!(safe_name(".."), "file");
        assert_eq!(safe_name(""), "file");
        let long = format!("{}.pdf", "x".repeat(300));
        let name = safe_name(&long);
        assert_eq!(name.chars().count(), MAX_NAME_CHARS);
        assert!(name.ends_with(".pdf"));
    }

    #[test]
    fn a_taken_name_gets_a_number() {
        let dir = std::env::temp_dir().join(format!("hari-share-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(free_path(&dir, "a.txt"), dir.join("a.txt"));
        std::fs::write(dir.join("a.txt"), b"1").unwrap();
        assert_eq!(free_path(&dir, "a.txt"), dir.join("a (2).txt"));
        std::fs::write(dir.join("a (2).txt"), b"2").unwrap();
        assert_eq!(free_path(&dir, "a.txt"), dir.join("a (3).txt"));
        std::fs::write(dir.join(".env"), b"3").unwrap();
        assert_eq!(free_path(&dir, ".env"), dir.join(".env (2)"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn link_ids_are_plain() {
        assert!(valid_id("3f2a-b_9"));
        assert!(!valid_id("../x"));
        assert!(!valid_id(""));
        assert!(!valid_id(&"a".repeat(MAX_ID_CHARS + 1)));
    }

    #[test]
    fn the_history_keeps_the_newest_hundred() {
        let mut share = Share::default();
        for n in 0..MAX_HISTORY + 3 {
            record(
                &mut share,
                Entry {
                    id: n.to_string(),
                    direction: Direction::In,
                    kind: Kind::Text,
                    text: Some("x".into()),
                    name: None,
                    size: None,
                    mime_type: None,
                    path: None,
                    device: None,
                    at: n as u64,
                    status: Status::Done,
                },
            );
        }
        assert_eq!(share.entries.len(), MAX_HISTORY);
        assert_eq!(share.entries[0].id, (MAX_HISTORY + 2).to_string());
    }

    #[test]
    fn known_types_open_on_the_phone() {
        assert_eq!(mime_for("a.PDF"), "application/pdf");
        assert_eq!(mime_for("photo.jpeg"), "image/jpeg");
        assert_eq!(mime_for("noext"), "application/octet-stream");
    }
}
