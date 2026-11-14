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

const METHODS: [&str; 4] = [
    "share.upload",
    "share.download",
    "share.uploadStatus",
    "share.filesResult",
];
const FILE: &str = "share-history.json";
const MAX_HISTORY: usize = 100;
const MAX_TEXT_CHARS: usize = 30_000;
/// Fork (L-290): up to 1 GB, moved in 1 MB pieces and resumable.
const MAX_FILE_BYTES: u64 = 1024 * 1024 * 1024;
/// Room left over on the disk after a received file.
const SPACE_MARGIN_BYTES: u64 = 64 * 1024 * 1024;
const CHUNK_BYTES: usize = 1024 * 1024;
const MAX_FILES_PER_SEND: usize = 20;
/// How long the phone can still fetch an offered file.
const OFFER_AGE_MS: u64 = 7 * 24 * 60 * 60 * 1000;
/// An upload with no piece for this long is dropped (its part file deleted).
/// (L-290: a day, so a big file can resume after a break.)
const STALE_UPLOAD_MS: u64 = 24 * 60 * 60 * 1000;
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
    /// Fork (L-290): items sent together (files + caption) share one group.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    group_id: Option<String>,
    /// Pinned and saved messages never roll off; both sync with the phone.
    #[serde(default, skip_serializing_if = "is_false")]
    pinned: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    saved: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// An entry with nothing but its identity; callers fill in the rest.
fn entry(id: String, direction: Direction, kind: Kind, status: Status) -> Entry {
    Entry {
        id,
        direction,
        kind,
        text: None,
        name: None,
        size: None,
        mime_type: None,
        path: None,
        device: None,
        at: now_ms(),
        status,
        group_id: None,
        pinned: false,
        saved: false,
    }
}

struct Upload {
    peer: String,
    name: String,
    mime_type: String,
    size: u64,
    received: u64,
    part: PathBuf,
    touched: u64,
    group_id: Option<String>,
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
    trim(&mut entries);
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
    trim(&mut share.entries);
    save(share);
}

/// Past the limit the oldest go first, but never a pinned or saved one.
fn trim(entries: &mut Vec<Entry>) {
    while entries.len() > MAX_HISTORY {
        match entries
            .iter()
            .rposition(|entry| !entry.pinned && !entry.saved)
        {
            Some(index) => {
                entries.remove(index);
            }
            None => break,
        }
    }
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
    if payload["type"] == "meta" {
        return apply_meta(app, payload);
    }
    // Fork (L-290): the phone's own id for the message, so pins and saves
    // name the same message on both sides. Older phones send none.
    let given_id = payload["entryId"]
        .as_str()
        .filter(|id| valid_id(id))
        .map(str::to_string);
    if let Some(id) = &given_id {
        if with(|share| share.entries.iter().any(|entry| &entry.id == id))? {
            return Ok(());
        }
    }
    let group_id = payload["groupId"]
        .as_str()
        .filter(|id| valid_id(id))
        .map(str::to_string);
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
    let id = given_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    with(|share| {
        record(
            share,
            Entry {
                text: Some(text.clone()),
                device: device.clone(),
                group_id: group_id.clone(),
                ..entry(id.clone(), Direction::In, kind, Status::Done)
            },
        )
    })?;
    changed(app);
    // A caption under files sent together: the files already told the user.
    if group_id.is_some() {
        return Ok(());
    }
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

/// Fork (L-290): a pin, save or Delete all made on the phone. Never shown.
fn apply_meta(app: &AppHandle, payload: &Value) -> Result<(), String> {
    let action = payload["action"].as_str().ok_or("Missing action")?;
    if action == "clear" {
        clear_local(app)?;
        changed(app);
        return Ok(());
    }
    let ids: Vec<String> = payload["ids"]
        .as_array()
        .map(|ids| {
            ids.iter()
                .filter_map(Value::as_str)
                .filter(|id| valid_id(id))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let (pinned, saved) = meta_flags(action).ok_or("Unsupported share")?;
    mark_local(&ids, pinned, saved)?;
    changed(app);
    Ok(())
}

/// "pin" → (Some(true), None), and so on.
fn meta_flags(action: &str) -> Option<(Option<bool>, Option<bool>)> {
    match action {
        "pin" => Some((Some(true), None)),
        "unpin" => Some((Some(false), None)),
        "save" => Some((None, Some(true))),
        "unsave" => Some((None, Some(false))),
        _ => None,
    }
}

fn mark_local(ids: &[String], pinned: Option<bool>, saved: Option<bool>) -> Result<(), String> {
    with(|share| {
        for entry in share
            .entries
            .iter_mut()
            .filter(|entry| ids.contains(&entry.id))
        {
            if let Some(pinned) = pinned {
                entry.pinned = pinned;
            }
            if let Some(saved) = saved {
                entry.saved = saved;
            }
        }
        trim(&mut share.entries);
        save(share);
    })
}

/// Whether `path` is inside `dir` (a received file this device may delete).
fn inside(dir: &Path, path: &str) -> bool {
    Path::new(path).parent() == Some(dir)
}

/// Delete all on this computer: every message that isn't pinned or saved
/// goes, with the files it saved into Downloads\Hari. Files sent from
/// elsewhere on the computer are the user's own and stay.
fn clear_local(app: &AppHandle) -> Result<u64, String> {
    let dir = received_dir(app).ok();
    with(|share| {
        let mut freed = 0;
        let (keep, gone): (Vec<Entry>, Vec<Entry>) = std::mem::take(&mut share.entries)
            .into_iter()
            .partition(|entry| entry.pinned || entry.saved);
        share.entries = keep;
        for entry in gone {
            let (Some(dir), Some(path)) = (dir.as_deref(), entry.path.as_deref()) else {
                continue;
            };
            if entry.direction == Direction::In && entry.kind == Kind::File && inside(dir, path) {
                let size = std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
                if std::fs::remove_file(path).is_ok() {
                    freed += size;
                }
            }
        }
        save(share);
        freed
    })
}

/// Tells the paired phones about a pin, save or Delete all. Best effort: the
/// outbox keeps it while a phone is away; no phone paired is fine.
fn push_meta(app: &AppHandle, payload: Value) {
    for (peer, _) in crate::mobile_access::paired_phones(app) {
        if let Err(error) = crate::mobile_events::push(&peer, "share", payload.clone()) {
            eprintln!("monocode: couldn't tell the phone about a Share change: {error}");
        }
    }
}

/// Fork (L-290): pins or saves messages here and on the phone.
#[tauri::command]
pub fn mobile_share_mark(
    window: Window,
    app: AppHandle,
    ids: Vec<String>,
    pinned: Option<bool>,
    saved: Option<bool>,
) -> Result<(), String> {
    check_window(&window)?;
    let ids: Vec<String> = ids.into_iter().filter(|id| valid_id(id)).collect();
    if ids.is_empty() {
        return Ok(());
    }
    mark_local(&ids, pinned, saved)?;
    changed(&app);
    if let Some(pinned) = pinned {
        push_meta(
            &app,
            json!({ "type": "meta", "action": if pinned { "pin" } else { "unpin" }, "ids": ids }),
        );
    }
    if let Some(saved) = saved {
        push_meta(
            &app,
            json!({ "type": "meta", "action": if saved { "save" } else { "unsave" }, "ids": ids }),
        );
    }
    Ok(())
}

/// Fork (L-290): Delete all, here and on the phone. Pinned and saved stay.
#[tauri::command]
pub fn mobile_share_clear(window: Window, app: AppHandle) -> Result<Value, String> {
    check_window(&window)?;
    let freed = clear_local(&app)?;
    changed(&app);
    push_meta(&app, json!({ "type": "meta", "action": "clear" }));
    Ok(json!({ "freed": freed }))
}

/// Fork (L-290): what Share takes on this computer: its history plus the
/// files it saved into Downloads\Hari (not files sent from elsewhere).
#[tauri::command]
pub fn mobile_share_storage(app: AppHandle) -> Result<Value, String> {
    let dir = received_dir(&app).ok();
    let (history, files, count) = with(|share| {
        let history = share
            .path
            .as_ref()
            .and_then(|path| std::fs::metadata(path).ok())
            .map_or(0, |meta| meta.len());
        let mut files = 0;
        let mut count = 0;
        for entry in &share.entries {
            let (Some(dir), Some(path)) = (dir.as_deref(), entry.path.as_deref()) else {
                continue;
            };
            if entry.direction == Direction::In && entry.kind == Kind::File && inside(dir, path) {
                if let Ok(meta) = std::fs::metadata(path) {
                    files += meta.len();
                    count += 1;
                }
            }
        }
        (history, files, count)
    })?;
    Ok(json!({ "historyBytes": history, "filesBytes": files, "files": count }))
}

/// Free bytes on the disk holding `dir`; None when it can't be told.
#[cfg(windows)]
fn free_space(dir: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let wide: Vec<u16> = dir.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut free = 0u64;
    // SAFETY: `wide` is NUL-terminated and outlives the call; the other
    // out-pointers may be null.
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    (ok != 0).then_some(free)
}

#[cfg(not(windows))]
fn free_space(_dir: &Path) -> Option<u64> {
    None
}

fn format_mb(bytes: u64) -> String {
    format!("{:.0} MB", bytes as f64 / (1024.0 * 1024.0))
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
    send_text(&app, text, clipboard, open, None)
}

/// Sends the computer's clipboard text onto the phone's clipboard.
#[tauri::command]
pub fn mobile_share_send_clipboard(window: Window, app: AppHandle) -> Result<(), String> {
    check_window(&window)?;
    let text = arboard::Clipboard::new()
        .and_then(|mut clipboard| clipboard.get_text())
        .map_err(|_| "The clipboard has no text")?;
    send_text(&app, checked_text(&text)?, true, false, None)
}

fn send_text(
    app: &AppHandle,
    text: String,
    clipboard: bool,
    open: bool,
    group_id: Option<String>,
) -> Result<(), String> {
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
    if let Some(group_id) = &group_id {
        payload["groupId"] = json!(group_id);
    }
    push_to_phones(app, payload)?;
    with(|share| {
        record(
            share,
            Entry {
                text: Some(text),
                device: only_one_phone_name(app),
                group_id,
                ..entry(id, Direction::Out, kind, Status::Queued)
            },
        )
    })?;
    changed(app);
    Ok(())
}

/// Offers these files to every paired phone (each fetches them itself).
/// Fork (L-290): several files, or files with a caption, go as one group;
/// the caption arrives as the group's text.
#[tauri::command]
pub fn mobile_share_send_files(
    window: Window,
    app: AppHandle,
    paths: Vec<String>,
    caption: Option<String>,
) -> Result<(), String> {
    check_window(&window)?;
    if paths.is_empty() {
        return Err("Choose a file first".into());
    }
    if paths.len() > MAX_FILES_PER_SEND {
        return Err(format!("Send at most {MAX_FILES_PER_SEND} files at once"));
    }
    let caption = caption
        .filter(|text| !text.trim().is_empty())
        .map(|text| checked_text(&text))
        .transpose()?;
    let mut files = Vec::new();
    for raw in &paths {
        let path = PathBuf::from(raw);
        let meta = std::fs::metadata(&path).map_err(|_| format!("Couldn't read {raw}"))?;
        if !meta.is_file() {
            return Err(format!("{raw} is not a file (folders can't be sent)"));
        }
        if meta.len() > MAX_FILE_BYTES {
            return Err(format!(
                "{} is over 1 GB",
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
    let group_id = (files.len() > 1 || caption.is_some()).then(|| uuid::Uuid::new_v4().to_string());
    let device = only_one_phone_name(&app);
    for (path, name, size) in files {
        let id = uuid::Uuid::new_v4().to_string();
        let mime_type = mime_for(&name);
        let mut payload = json!({ "type": "file", "fileId": id, "name": name, "mimeType": mime_type, "size": size });
        if let Some(group_id) = &group_id {
            payload["groupId"] = json!(group_id);
        }
        push_to_phones(&app, payload)?;
        with(|share| {
            record(
                share,
                Entry {
                    name: Some(name),
                    size: Some(size),
                    mime_type: Some(mime_type.into()),
                    path: Some(path.to_string_lossy().into()),
                    device: device.clone(),
                    group_id: group_id.clone(),
                    ..entry(id, Direction::Out, Kind::File, Status::Queued)
                },
            )
        })?;
    }
    if let Some(caption) = caption {
        send_text(&app, caption, false, false, group_id)?;
    }
    changed(&app);
    Ok(())
}

/// Fork (Hari, L-280): offers a file the computer made (a screenshot) to the
/// one phone that asked for it; it lands in that phone's Share like any file.
/// Fork (L-296): also a file the phone picked while browsing the drives.
pub(crate) fn offer_file(app: &AppHandle, peer: &str, path: &Path) -> Result<Value, String> {
    let size = std::fs::metadata(path)
        .map_err(|_| "Couldn't read the file")?
        .len();
    if size > MAX_FILE_BYTES {
        return Err("The file is over 1 GB".into());
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
                name: Some(name.clone()),
                size: Some(size),
                mime_type: Some(mime_type.into()),
                path: Some(path.to_string_lossy().into()),
                device: phone_name(app, peer),
                ..entry(id.clone(), Direction::Out, Kind::File, Status::Queued)
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
        "share.uploadStatus" => upload_status(&peer, &params),
        "share.filesResult" => files_result(&params),
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
        return Err("That file is now over 1 GB".into());
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

/// Fork (L-290): how much of a file the computer already has, so a phone
/// that lost the connection continues instead of starting again.
fn upload_status(peer: &str, params: &Value) -> Result<Value, String> {
    let file_id = params["fileId"]
        .as_str()
        .filter(|id| valid_id(id))
        .ok_or("Missing file")?;
    let size = params["size"].as_u64().ok_or("Missing size")?;
    with(|share| {
        if share
            .entries
            .iter()
            .any(|entry| entry.id == file_id && entry.direction == Direction::In)
        {
            return json!({ "received": size, "done": true });
        }
        let received = share
            .uploads
            .get(file_id)
            .filter(|upload| upload.peer == peer && upload.size == size)
            .filter(|upload| {
                std::fs::metadata(&upload.part).map(|meta| meta.len()).ok() == Some(upload.received)
            })
            .map_or(0, |upload| upload.received);
        json!({ "received": received, "done": false })
    })
}

fn upload(app: &AppHandle, peer: &str, params: &Value) -> Result<Value, String> {
    let file_id = params["fileId"]
        .as_str()
        .filter(|id| valid_id(id))
        .ok_or("Missing file")?;
    let offset = params["offset"].as_u64().ok_or("Missing offset")?;
    let size = params["size"].as_u64().ok_or("Missing size")?;
    if size > MAX_FILE_BYTES {
        return Err("Files over 1 GB can't be sent".into());
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
        // Fork (L-290): refuse up front rather than fail near the end.
        if let Some(free) = free_space(&dir) {
            if free < size.saturating_add(SPACE_MARGIN_BYTES) {
                return Err(format!(
                    "Not enough space on the computer: {} free, the file needs {}",
                    format_mb(free),
                    format_mb(size)
                ));
            }
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
                group_id: params["groupId"]
                    .as_str()
                    .filter(|id| valid_id(id))
                    .map(str::to_string),
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
            name: Some(saved_name.clone()),
            size: Some(size),
            mime_type: Some(done.mime_type),
            path: Some(target.to_string_lossy().into()),
            device: device.clone(),
            group_id: done.group_id,
            at: now,
            ..entry(file_id.to_string(), Direction::In, Kind::File, Status::Done)
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
                    text: Some("x".into()),
                    at: n as u64,
                    ..entry(n.to_string(), Direction::In, Kind::Text, Status::Done)
                },
            );
        }
        assert_eq!(share.entries.len(), MAX_HISTORY);
        assert_eq!(share.entries[0].id, (MAX_HISTORY + 2).to_string());
    }

    #[test]
    fn pinned_and_saved_never_roll_off() {
        let mut share = Share::default();
        for n in 0..MAX_HISTORY + 5 {
            let mut item = entry(n.to_string(), Direction::In, Kind::Text, Status::Done);
            item.text = Some("x".into());
            item.pinned = n == 0;
            item.saved = n == 1;
            record(&mut share, item);
        }
        assert_eq!(share.entries.len(), MAX_HISTORY);
        assert!(share.entries.iter().any(|entry| entry.id == "0"));
        assert!(share.entries.iter().any(|entry| entry.id == "1"));
        assert!(!share.entries.iter().any(|entry| entry.id == "2"));
    }

    #[test]
    fn meta_actions_map_to_flags() {
        assert_eq!(meta_flags("pin"), Some((Some(true), None)));
        assert_eq!(meta_flags("unsave"), Some((None, Some(false))));
        assert_eq!(meta_flags("explode"), None);
    }

    #[test]
    fn known_types_open_on_the_phone() {
        assert_eq!(mime_for("a.PDF"), "application/pdf");
        assert_eq!(mime_for("photo.jpeg"), "image/jpeg");
        assert_eq!(mime_for("noext"), "application/octet-stream");
    }
}

// Fork (L-297): the computer's "Phone files" browser. The computer asks on
// the event stream; the phone answers with `share.filesResult`.

static FILE_REQUESTS: Mutex<Option<HashMap<String, std::sync::mpsc::Sender<Value>>>> =
    Mutex::new(None);
const FILES_WAIT: std::time::Duration = std::time::Duration::from_secs(20);

fn first_phone(app: &AppHandle) -> Result<String, String> {
    crate::mobile_access::paired_phones(app)
        .into_iter()
        .next()
        .map(|(peer, _)| peer)
        .ok_or_else(|| "Pair Hari on your phone first".to_string())
}

/// Lists one folder of the phone's storage (the top when `path` is empty).
#[tauri::command]
pub async fn mobile_phone_files_list(
    window: Window,
    app: AppHandle,
    path: Option<String>,
    offset: Option<u32>,
) -> Result<Value, String> {
    check_window(&window)?;
    let peer = first_phone(&app)?;
    let request = uuid::Uuid::new_v4().to_string();
    let (sender, receiver) = std::sync::mpsc::channel();
    FILE_REQUESTS
        .lock()
        .map_err(|_| "Share is unavailable")?
        .get_or_insert_with(HashMap::new)
        .insert(request.clone(), sender);
    let sent = crate::mobile_events::push(
        &peer,
        "share",
        json!({
            "type": "files.list",
            "requestId": request,
            "path": path.unwrap_or_default(),
            "offset": offset.unwrap_or(0),
        }),
    );
    let forget = |request: &str| {
        if let Ok(mut pending) = FILE_REQUESTS.lock() {
            if let Some(pending) = pending.as_mut() {
                pending.remove(request);
            }
        }
    };
    if let Err(error) = sent {
        forget(&request);
        return Err(error.to_string());
    }
    let answer = tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(FILES_WAIT))
        .await
        .map_err(|_| "Phone files failed".to_string())?;
    forget(&request);
    let answer =
        answer.map_err(|_| "The phone didn't answer. Open Hari on the phone and try again.")?;
    if let Some(error) = answer["error"].as_str() {
        return Err(error.to_string());
    }
    Ok(answer["result"].clone())
}

/// Asks the phone to send these files to the computer (they arrive in Share).
#[tauri::command]
pub fn mobile_phone_files_send(
    window: Window,
    app: AppHandle,
    paths: Vec<String>,
) -> Result<(), String> {
    check_window(&window)?;
    if paths.is_empty() || paths.len() > 50 {
        return Err("Choose up to 50 files".into());
    }
    let peer = first_phone(&app)?;
    crate::mobile_events::push(
        &peer,
        "share",
        json!({ "type": "files.send", "paths": paths }),
    )
    .map(|_| ())
}

fn files_result(params: &Value) -> Result<Value, String> {
    let request = params["requestId"].as_str().ok_or("Missing request")?;
    let sender = FILE_REQUESTS
        .lock()
        .map_err(|_| "Share is unavailable")?
        .as_mut()
        .and_then(|pending| pending.remove(request));
    if let Some(sender) = sender {
        let _ = sender.send(params.clone());
    }
    Ok(json!({}))
}
