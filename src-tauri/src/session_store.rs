use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

const MIGRATION_V1: &str = r#"
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  cwd TEXT NOT NULL,
  harness TEXT NOT NULL,
  model TEXT NOT NULL,
  model_settings TEXT NOT NULL DEFAULT '{}',
  runtime_mode TEXT NOT NULL,
  title TEXT NOT NULL,
  provider_session_id TEXT,
  blocks_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_cwd_updated_idx
  ON sessions (cwd, updated_at DESC);
"#;

pub struct SessionStore {
    conn: Mutex<Connection>,
    read_conn: Mutex<Option<Connection>>,
}

impl SessionStore {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(&path).map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
            .map_err(|e| e.to_string())?;
        migrate(&conn).map_err(|e| e.to_string())?;
        crate::worktrees::reconcile_removals(&conn)?;
        let read_conn = Connection::open(&path).map_err(|e| e.to_string())?;
        read_conn
            .execute_batch("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;")
            .map_err(|e| e.to_string())?;
        Ok(Self {
            conn: Mutex::new(conn),
            read_conn: Mutex::new(Some(read_conn)),
        })
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|e| e.to_string())?;
        migrate(&conn).map_err(|e| e.to_string())?;
        Ok(Self {
            conn: Mutex::new(conn),
            read_conn: Mutex::new(None),
        })
    }

    pub(crate) fn lock_conn(&self) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        self.conn
            .lock()
            .map_err(|_| "Session store is locked".into())
    }
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    init_with(
        || app.path().app_data_dir().map_err(|e| e.to_string()),
        SessionStore::open,
        |store| {
            app.manage(store);
        },
    )
}

// Keep the complete startup path here so the transcript-read test covers it.
fn init_with(
    data_dir: impl FnOnce() -> Result<PathBuf, String>,
    open: impl FnOnce(PathBuf) -> Result<SessionStore, String>,
    manage: impl FnOnce(SessionStore),
) -> Result<(), String> {
    let store = open(data_dir()?.join("monocode.db"))?;
    manage(store);
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUpsert {
    #[serde(default)]
    pub sidebar_hidden: bool,
    pub id: String,
    pub cwd: String,
    pub harness: String,
    pub model: String,
    pub model_settings: Value,
    pub runtime_mode: String,
    pub title: String,
    #[serde(default)]
    pub provider_session_id: Option<String>,
    #[serde(default)]
    pub provider_account_id: Option<String>,
    pub blocks: Value,
    /// Last context-window reading reported by the harness, if any.
    #[serde(default)]
    pub context_used: Option<i64>,
    #[serde(default)]
    pub context_window: Option<i64>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub worktree_cwd: Option<String>,
    #[serde(default)]
    pub worktree_removed: bool,
    #[serde(default)]
    pub linked_work_item: Option<Value>,
    /// Queued follow-ups not yet sent. JSON array; absent when the queue is empty.
    #[serde(default)]
    pub queued_messages: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub queue_status: Option<String>,
    #[serde(default)]
    pub automation_id: Option<String>,
    #[serde(default)]
    pub sidechat: Option<SidechatMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SidechatMeta {
    pub source_session_id: String,
    pub source_title: String,
    #[serde(default)]
    pub source_context: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    #[serde(default)]
    pub sidebar_hidden: bool,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orchestration_lead_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orchestration: Option<Value>,
    pub cwd: String,
    pub harness: String,
    pub model: String,
    pub runtime_mode: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_cwd: Option<String>,
    #[serde(default)]
    pub worktree_removed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    pub additions: i64,
    pub deletions: i64,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub draft: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_work_item: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub automation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sidechat: Option<SidechatMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    #[serde(default)]
    pub sidebar_hidden: bool,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orchestration_lead_id: Option<String>,
    pub cwd: String,
    pub harness: String,
    pub model: String,
    pub model_settings: Value,
    pub runtime_mode: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_account_id: Option<String>,
    pub blocks: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_used: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_cwd: Option<String>,
    #[serde(default)]
    pub worktree_removed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_work_item: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queued_messages: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub queue_status: Option<String>,
    #[serde(default)]
    pub draft: bool,
    pub automation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sidechat: Option<SidechatMeta>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[tauri::command(async)]
pub fn session_upsert(
    store: State<'_, SessionStore>,
    session: SessionUpsert,
) -> Result<SessionSummary, String> {
    validate_id(&session.id, "session")?;
    if session.cwd.trim().is_empty() {
        return Err("cwd is required".into());
    }
    if let Some(provider_session_id) = &session.provider_session_id {
        if !provider_session_id.is_empty() {
            validate_id(provider_session_id, "provider session")?;
        }
    }
    if let Some(provider_account_id) = &session.provider_account_id {
        if !provider_account_id.is_empty() {
            validate_id(provider_account_id, "provider account")?;
        }
    }
    if let Some(automation_id) = &session.automation_id {
        if !automation_id.is_empty() {
            validate_id(automation_id, "automation")?;
        }
    }
    if let Some(sidechat) = &session.sidechat {
        validate_id(&sidechat.source_session_id, "sidechat source session")?;
        if sidechat.source_title.trim().is_empty() || sidechat.source_title.len() > 512 {
            return Err("Sidechat source title is required".into());
        }
        if sidechat
            .source_context
            .as_ref()
            .is_some_and(|context| context.len() > 512_000)
        {
            return Err("Sidechat source context exceeds the size limit".into());
        }
    }
    if !session.model_settings.is_object() {
        return Err("modelSettings must be an object".into());
    }
    if !session.blocks.is_array() {
        return Err("blocks must be an array".into());
    }

    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    let summary = upsert_session(&conn, &session).map_err(|e| e.to_string())?;
    Ok(summary)
}

fn generated_image_paths(blocks: &Value) -> Vec<String> {
    blocks
        .as_array()
        .into_iter()
        .flatten()
        .filter(|block| block.get("role").and_then(Value::as_str) == Some("image"))
        .filter_map(|block| {
            block
                .get("image")
                .and_then(|image| image.get("path"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect()
}

#[tauri::command(async)]
pub fn session_list_by_project(
    store: State<'_, SessionStore>,
    cwd: String,
) -> Result<Vec<SessionSummary>, String> {
    if cwd.trim().is_empty() {
        return Err("cwd is required".into());
    }
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    list_by_project(&conn, &cwd).map_err(|e| e.to_string())
}

/// Projectless chats live one per directory, so no single project query can
/// reach them. One prefix scan over both separators instead — the Chat panel
/// needs every scratch session ever persisted, not one folder's.
#[tauri::command(async)]
pub fn session_list_scratch(store: State<'_, SessionStore>) -> Result<Vec<SessionSummary>, String> {
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    list_scratch(&conn).map_err(|e| e.to_string())
}

/// Saved sidechats retain their project cwd, so Chats uses a separate list.
#[tauri::command(async)]
pub fn session_list_sidechats(
    store: State<'_, SessionStore>,
) -> Result<Vec<SessionSummary>, String> {
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    list_sidechats(&conn).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn session_rebase_project(
    store: State<'_, SessionStore>,
    from_cwd: String,
    to_cwd: String,
) -> Result<(), String> {
    if from_cwd.trim().is_empty() || to_cwd.trim().is_empty() {
        return Err("project paths are required".into());
    }
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    rebase_project(&conn, &from_cwd, &to_cwd).map_err(|error| error.to_string())
}

fn rebase_project(conn: &Connection, from_cwd: &str, to_cwd: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE sessions SET cwd = ?2 WHERE cwd = ?1",
        params![from_cwd, to_cwd],
    )?;
    Ok(())
}

#[tauri::command(async)]
pub fn session_list_linked(store: State<'_, SessionStore>) -> Result<Vec<SessionSummary>, String> {
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    list_linked(&conn).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn session_get(
    store: State<'_, SessionStore>,
    session_id: String,
) -> Result<Option<SessionRecord>, String> {
    validate_id(&session_id, "session")?;
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    get_session(&conn, &session_id).map_err(|e| e.to_string())
}

const MAX_SEARCH_SCAN: usize = 400;
const MAX_CONVERSATION_HITS: usize = 40;
const MAX_MESSAGE_HITS: usize = 40;
const SNIPPET_RADIUS: usize = 42;
const SEARCH_PROGRESS_INTERVAL: usize = 1_000;
const MAX_SEARCH_BUFFER_BYTES: usize = 8 * 1024 * 1024;
static SESSION_SEARCH_TOKENS: Mutex<Option<HashMap<String, Arc<AtomicU64>>>> = Mutex::new(None);

#[derive(Clone)]
struct SessionSearchToken {
    owner: String,
    counter: Arc<AtomicU64>,
    generation: u64,
}

impl SessionSearchToken {
    fn is_current(&self) -> bool {
        self.counter.load(Ordering::Acquire) == self.generation
    }
}

fn begin_session_search(owner: &str) -> Option<SessionSearchToken> {
    if owner.is_empty() {
        return None;
    }
    let mut tokens = SESSION_SEARCH_TOKENS.lock().ok()?;
    let tokens = tokens.get_or_insert_with(HashMap::new);
    let counter = tokens
        .entry(owner.to_string())
        .or_insert_with(|| Arc::new(AtomicU64::new(0)))
        .clone();
    let generation = counter.fetch_add(1, Ordering::AcqRel).wrapping_add(1);
    Some(SessionSearchToken {
        owner: owner.to_string(),
        counter,
        generation,
    })
}

/// Release the entry a finished search was holding, on every exit path.
///
/// Every search runs under a fresh `searchOwner` (`SearchView` mints a UUID per
/// keystroke), so an entry left behind is never reused or overwritten — it just
/// accumulates for the life of the process. A plain call after the search would
/// not do: the search returns through `?` on any SQLite error, and `SearchView`
/// swallows the rejection, so the error path is the common case, not the rare
/// one. `Drop` covers the early return and the unwind both.
struct SessionSearchRelease(Option<SessionSearchToken>);

impl Drop for SessionSearchRelease {
    fn drop(&mut self) {
        end_session_search(self.0.as_ref());
    }
}

/// The generation check happens under the map lock, not before it.
///
/// `begin_session_search` bumps the counter while holding that same lock, so
/// checking `is_current` outside the critical section leaves a window: a newer
/// search can register in between, and since both tokens share one `Arc`, the
/// `ptr_eq` test cannot tell them apart. Removing the entry then would strip
/// the live search of its registration, leaving it running and impossible to
/// cancel. The superseded search must leave the newer counter alone, so the
/// whole decision has to be atomic with respect to registration.
fn end_session_search(token: Option<&SessionSearchToken>) {
    let Some(token) = token else {
        return;
    };
    let Ok(mut tokens) = SESSION_SEARCH_TOKENS.lock() else {
        return;
    };
    let ours = tokens
        .as_ref()
        .and_then(|tokens| tokens.get(&token.owner))
        .is_some_and(|registered| Arc::ptr_eq(registered, &token.counter) && token.is_current());
    if ours {
        if let Some(tokens) = tokens.as_mut() {
            tokens.remove(&token.owner);
        }
    }
}

#[cfg(test)]
fn session_search_token_registered(owner: &str) -> bool {
    SESSION_SEARCH_TOKENS
        .lock()
        .ok()
        .and_then(|tokens| tokens.as_ref().map(|tokens| tokens.contains_key(owner)))
        .unwrap_or(false)
}

fn cancel_owned_session_search(owner: &str) {
    if owner.is_empty() {
        return;
    }
    if let Ok(mut tokens) = SESSION_SEARCH_TOKENS.lock() {
        if let Some(counter) = tokens.as_mut().and_then(|tokens| tokens.remove(owner)) {
            counter.fetch_add(1, Ordering::AcqRel);
        }
    }
}

fn session_search_is_current(token: Option<&SessionSearchToken>) -> bool {
    token.is_none_or(SessionSearchToken::is_current)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSearchOptions {
    pub query: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub include_archived: bool,
    #[serde(default)]
    pub search_owner: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSearchHit {
    pub kind: String,
    pub session_id: String,
    pub cwd: String,
    pub harness: String,
    pub title: String,
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSearchResult {
    pub hits: Vec<SessionSearchHit>,
    pub truncated: bool,
}

#[tauri::command(async)]
pub fn session_search(
    store: State<'_, SessionStore>,
    options: SessionSearchOptions,
) -> Result<SessionSearchResult, String> {
    search_store(&store, &options)
}

fn search_store(
    store: &SessionStore,
    options: &SessionSearchOptions,
) -> Result<SessionSearchResult, String> {
    let token = begin_session_search(&options.search_owner);
    let release = SessionSearchRelease(token.clone());
    let result = {
        let read_conn = store
            .read_conn
            .lock()
            .map_err(|_| "Session read store is locked")?;
        if let Some(conn) = read_conn.as_ref() {
            search_sessions_with_connection(conn, options, token.as_ref())?
        } else {
            let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
            search_sessions_with_connection(&conn, options, token.as_ref())?
        }
    };
    drop(release);
    if session_search_is_current(token.as_ref()) {
        Ok(result)
    } else {
        Ok(SessionSearchResult {
            hits: Vec::new(),
            truncated: false,
        })
    }
}

#[tauri::command(async)]
pub fn cancel_session_search(search_owner: String) {
    cancel_owned_session_search(&search_owner);
}

#[tauri::command(async)]
pub fn session_delete(
    app: AppHandle,
    store: State<'_, SessionStore>,
    session_id: String,
    mut image_paths: Vec<String>,
) -> Result<(), String> {
    validate_id(&session_id, "session")?;
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    let persisted_paths = get_session(&conn, &session_id)
        .ok()
        .flatten()
        .map(|record| generated_image_paths(&record.blocks))
        .unwrap_or_default();
    image_paths.extend(persisted_paths);
    image_paths.extend(
        crate::mono_transcript::generated_image_paths(&conn, &session_id)
            .map_err(|e| e.to_string())?,
    );
    delete_session(&conn, &session_id).map_err(|e| e.to_string())?;
    drop(conn);
    if !image_paths.is_empty() {
        if let Err(error) = crate::fs::delete_generated_images_sync(&app, &image_paths) {
            eprintln!("Generated image cleanup will need a retry: {error}");
        }
    }
    let _ = app.emit(crate::reminders::CHANGED, ());
    Ok(())
}

#[tauri::command(async)]
pub fn session_set_archived(
    store: State<'_, SessionStore>,
    session_id: String,
    archived: bool,
) -> Result<(), String> {
    validate_id(&session_id, "session")?;
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    set_archived(&conn, &session_id, archived).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn session_set_pinned(
    store: State<'_, SessionStore>,
    session_id: String,
    pinned: bool,
) -> Result<(), String> {
    validate_id(&session_id, "session")?;
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    set_pinned(&conn, &session_id, pinned).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn session_set_linked_work_item(
    store: State<'_, SessionStore>,
    session_id: String,
    linked_work_item: Option<Value>,
) -> Result<(), String> {
    validate_id(&session_id, "session")?;
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    set_linked_work_item(&conn, &session_id, linked_work_item.as_ref()).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InFlightSession {
    pub session_id: String,
    pub cwd: String,
}

#[tauri::command(async)]
pub fn session_set_in_flight(
    store: State<'_, SessionStore>,
    sessions: Vec<InFlightSession>,
) -> Result<(), String> {
    for session in &sessions {
        validate_id(&session.session_id, "session")?;
        if session.cwd.trim().is_empty() {
            return Err("cwd is required".into());
        }
    }
    let mut conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    replace_in_flight(&mut conn, &sessions).map_err(|e| e.to_string())
}

/// Read the quit snapshot without clearing it. Vite/dev reloads must not
/// consume the only copy.
#[tauri::command(async)]
pub fn session_list_in_flight(
    store: State<'_, SessionStore>,
) -> Result<Vec<InFlightSession>, String> {
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    list_in_flight(&conn).map_err(|e| e.to_string())
}

/// Read and clear the quit snapshot so a restored window cannot take it twice.
#[tauri::command(async)]
pub fn session_take_in_flight(
    store: State<'_, SessionStore>,
) -> Result<Vec<InFlightSession>, String> {
    let mut conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    take_in_flight(&mut conn).map_err(|e| e.to_string())
}

const WORKSPACE_SNAPSHOT_MAX_BYTES: usize = 2_000_000;

#[tauri::command(async)]
pub fn workspace_set_snapshot(
    store: State<'_, SessionStore>,
    snapshot: Value,
) -> Result<(), String> {
    if !snapshot.is_object() {
        return Err("workspace snapshot must be an object".into());
    }
    let json = serde_json::to_string(&snapshot).map_err(|e| e.to_string())?;
    if json.len() > WORKSPACE_SNAPSHOT_MAX_BYTES {
        return Err("workspace snapshot is too large".into());
    }
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    set_workspace_snapshot(&conn, &json).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn workspace_get_snapshot(store: State<'_, SessionStore>) -> Result<Option<Value>, String> {
    let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
    let json = get_workspace_snapshot(&conn).map_err(|e| e.to_string())?;
    match json {
        None => Ok(None),
        Some(raw) => serde_json::from_str(&raw).map_err(|e| e.to_string()),
    }
}

/// Add a `sessions` column when it is absent, so a half-applied history cannot
/// leave the schema short of what the queries select.
fn ensure_session_column(conn: &Connection, column: &str, decl: &str) -> rusqlite::Result<()> {
    let present: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = ?1",
        params![column],
        |row| row.get(0),
    )?;
    if present == 0 {
        conn.execute(
            &format!("ALTER TABLE sessions ADD COLUMN {column} {decl}"),
            [],
        )?;
    }
    Ok(())
}

/// Add a `sessions` column when it is missing, tolerating the case where a
/// recorded migration version has no matching column.
fn ensure_column(conn: &Connection, name: &str, decl: &str) -> rusqlite::Result<()> {
    let present: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = ?1",
        params![name],
        |row| row.get(0),
    )?;
    if present > 0 {
        return Ok(());
    }
    conn.execute(
        &format!("ALTER TABLE sessions ADD COLUMN {name} {decl}"),
        [],
    )?;
    Ok(())
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
           version INTEGER PRIMARY KEY,
           applied_at INTEGER NOT NULL
         )",
        [],
    )?;
    let current: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )?;
    if current < 1 {
        conn.execute_batch(MIGRATION_V1)?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 2 {
        conn.execute("ALTER TABLE sessions ADD COLUMN branch TEXT", [])?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 3 {
        conn.execute("ALTER TABLE sessions ADD COLUMN context_used INTEGER", [])?;
        conn.execute("ALTER TABLE sessions ADD COLUMN context_window INTEGER", [])?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (3, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 4 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS in_flight_sessions (
               session_id TEXT PRIMARY KEY,
               cwd TEXT NOT NULL,
               sort_index INTEGER NOT NULL
             );",
        )?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (4, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 5 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS workspace_snapshot (
               id INTEGER PRIMARY KEY CHECK (id = 1),
               snapshot_json TEXT NOT NULL,
               updated_at INTEGER NOT NULL
             );",
        )?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (5, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 6 {
        conn.execute(
            "ALTER TABLE sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (6, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 7 {
        conn.execute("ALTER TABLE sessions ADD COLUMN worktree_cwd TEXT", [])?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (7, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 8 {
        // `list_by_project` used to filter with
        // `blocks_json LIKE '%"role":"user"%'`, which reads and substring-scans
        // every transcript in the project on each switch. Materialize the
        // predicate so the covering index can answer it instead.
        ensure_column(conn, "has_user_message", "INTEGER NOT NULL DEFAULT 0")?;
        conn.execute(
            "UPDATE sessions SET has_user_message =
               CASE WHEN blocks_json != '[]' AND blocks_json LIKE '%\"role\":\"user\"%'
                    THEN 1 ELSE 0 END",
            [],
        )?;
        conn.execute_batch(
            "DROP INDEX IF EXISTS sessions_cwd_updated_idx;
             CREATE INDEX IF NOT EXISTS sessions_cwd_listed_idx
               ON sessions (cwd, has_user_message, updated_at DESC);",
        )?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (8, ?1)",
            params![now_millis()],
        )?;
    }
    // A recorded version row can outlive the schema it describes when another
    // build reuses the same numbers, leaving columns that every listing query
    // (and the covering index below) depends on missing. Repair before use.
    for (column, decl) in [
        ("branch", "TEXT"),
        ("context_used", "INTEGER"),
        ("context_window", "INTEGER"),
        ("archived", "INTEGER NOT NULL DEFAULT 0"),
        ("worktree_cwd", "TEXT"),
        ("has_user_message", "INTEGER NOT NULL DEFAULT 0"),
        ("pinned", "INTEGER NOT NULL DEFAULT 0"),
        ("linked_work_item_json", "TEXT"),
        ("queued_messages_json", "TEXT"),
        ("queue_status", "TEXT"),
        ("provider_account_id", "TEXT"),
        ("worktree_removed", "INTEGER NOT NULL DEFAULT 0"),
        ("is_draft", "INTEGER NOT NULL DEFAULT 0"),
        ("automation_id", "TEXT"),
        ("sidebar_hidden", "INTEGER NOT NULL DEFAULT 0"),
        ("sidechat_json", "TEXT"),
        ("is_sidechat", "INTEGER NOT NULL DEFAULT 0"),
    ] {
        ensure_session_column(conn, column, decl)?;
    }
    if current < 9 {
        // v8 stopped the blob scan but still cost a table seek per row, and
        // every summary column (`created_at`, `updated_at`, `branch`,
        // `archived`) is stored *after* `blocks_json` in the record — so
        // reaching them meant walking past a ~180 KB transcript's overflow
        // pages, 120 times over, on each project switch. Widening the index to
        // cover the whole projection keeps the query inside the index and off
        // the table entirely: measured 7.3 ms -> 0.24 ms for 120 sessions.
        // Version rows are not proof the columns landed: a DB can carry a
        // recorded version from another build without the ALTER that went with
        // it, and indexing a missing column aborts the whole migration.
        ensure_column(conn, "branch", "TEXT")?;
        ensure_column(conn, "archived", "INTEGER NOT NULL DEFAULT 0")?;
        ensure_column(conn, "has_user_message", "INTEGER NOT NULL DEFAULT 0")?;
        conn.execute_batch(
            "DROP INDEX IF EXISTS sessions_cwd_listed_idx;
             CREATE INDEX IF NOT EXISTS sessions_cwd_cover_idx
               ON sessions (cwd, has_user_message, updated_at DESC, id, harness,
                            model, runtime_mode, title, provider_session_id,
                            created_at, branch, archived);",
        )?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (9, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 10 {
        crate::notes::ensure_notes_table(conn)?;
        crate::tasks::ensure_tasks_table(conn)?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (10, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 11 {
        // Pinning is a listing column, so it has to live in the covering
        // index with `archived`. Selecting it off the table would walk past
        // `blocks_json` on every project switch.
        ensure_column(conn, "pinned", "INTEGER NOT NULL DEFAULT 0")?;
        conn.execute_batch(
            "DROP INDEX IF EXISTS sessions_cwd_cover_idx;
             CREATE INDEX IF NOT EXISTS sessions_cwd_cover_idx
               ON sessions (cwd, has_user_message, updated_at DESC, id, harness,
                            model, runtime_mode, title, provider_session_id,
                            created_at, branch, archived, pinned);",
        )?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (11, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 12 {
        // The sidebar renders this metadata for every row, so keep it in the
        // same covering index as the rest of the session-card projection.
        ensure_column(conn, "linked_work_item_json", "TEXT")?;
        conn.execute_batch(
            "DROP INDEX IF EXISTS sessions_cwd_cover_idx;
             CREATE INDEX IF NOT EXISTS sessions_cwd_cover_idx
               ON sessions (cwd, has_user_message, updated_at DESC, id, harness,
                            model, runtime_mode, title, provider_session_id,
                            created_at, branch, archived, pinned,
                            linked_work_item_json);",
        )?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (12, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 13 {
        crate::notes::ensure_notes_table(conn)?;
        crate::tasks::ensure_tasks_table(conn)?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (13, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 14 {
        // Migration 14 reconciles Local6 compatibility and queue durability across all
        // database lineages (fresh, upstream 0.1.44, and Local5 v12).
        ensure_column(conn, "linked_work_item_json", "TEXT")?;
        ensure_column(conn, "queued_messages_json", "TEXT")?;
        ensure_column(conn, "queue_status", "TEXT")?;
        ensure_session_column(conn, "provider_account_id", "TEXT")?;
        conn.execute_batch(
            "DROP INDEX IF EXISTS sessions_cwd_cover_idx;
             CREATE INDEX IF NOT EXISTS sessions_cwd_cover_idx
               ON sessions (cwd, has_user_message, updated_at DESC, id, harness,
                            model, runtime_mode, title, provider_session_id,
                            created_at, branch, archived, pinned,
                            linked_work_item_json);",
        )?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (14, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 15 {
        ensure_session_column(conn, "worktree_removed", "INTEGER NOT NULL DEFAULT 0")?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (15, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 16 {
        conn.execute_batch(
            "DROP INDEX IF EXISTS sessions_cwd_cover_idx;
             CREATE INDEX sessions_cwd_cover_idx
               ON sessions (cwd, has_user_message, updated_at DESC, id, harness,
                            model, runtime_mode, title, provider_session_id,
                            created_at, branch, archived, pinned,
                            linked_work_item_json, worktree_cwd, worktree_removed);",
        )?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (16, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 17 {
        // Draft is rendered on every session card. Materialize it alongside
        // `has_user_message` so listing never has to read transcript blobs.
        ensure_session_column(conn, "is_draft", "INTEGER NOT NULL DEFAULT 0")?;
        conn.execute(
            "UPDATE sessions SET is_draft =
               CASE WHEN blocks_json LIKE '%\"role\":\"user\"%'
                          AND blocks_json LIKE '%\"draft\":true%'
                    THEN 1 ELSE 0 END",
            [],
        )?;
        conn.execute_batch(
            "DROP INDEX IF EXISTS sessions_cwd_cover_idx;
             CREATE INDEX sessions_cwd_cover_idx
               ON sessions (cwd, has_user_message, updated_at DESC, id, harness,
                            model, runtime_mode, title, provider_session_id,
                            created_at, branch, archived, pinned,
                            linked_work_item_json, worktree_cwd, worktree_removed,
                            is_draft);",
        )?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (17, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 18 {
        // Sidebar cards show whether a session came from an automation.
        ensure_session_column(conn, "automation_id", "TEXT")?;
        conn.execute_batch(
            "DROP INDEX IF EXISTS sessions_cwd_cover_idx;
             CREATE INDEX sessions_cwd_cover_idx
               ON sessions (cwd, has_user_message, updated_at DESC, id, harness,
                            model, runtime_mode, title, provider_session_id,
                            created_at, branch, archived, pinned,
                            linked_work_item_json, worktree_cwd, worktree_removed,
                            is_draft, automation_id);",
        )?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (18, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 19 {
        // Keep sidebar visibility in the projection without reading transcripts.
        conn.execute_batch(
            "DROP INDEX IF EXISTS sessions_cwd_cover_idx;
             CREATE INDEX sessions_cwd_cover_idx
               ON sessions (cwd, has_user_message, updated_at DESC, id, harness,
                            model, runtime_mode, title, provider_session_id,
                            created_at, branch, archived, pinned,
                            linked_work_item_json, worktree_cwd, worktree_removed,
                            is_draft, automation_id, sidebar_hidden);",
        )?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (19, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 20 {
        ensure_session_column(conn, "sidechat_json", "TEXT")?;
        ensure_session_column(conn, "is_sidechat", "INTEGER NOT NULL DEFAULT 0")?;
        conn.execute(
            "UPDATE sessions SET is_sidechat = CASE WHEN sidechat_json IS NULL THEN 0 ELSE 1 END",
            [],
        )?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (20, ?1)",
            params![now_millis()],
        )?;
    }
    if current < 21 {
        // Keep the large source-context JSON out of the hot project-listing
        // index. A compact marker handles both project filtering and the
        // separate saved-sidechat listing.
        ensure_session_column(conn, "sidechat_json", "TEXT")?;
        ensure_session_column(conn, "is_sidechat", "INTEGER NOT NULL DEFAULT 0")?;
        conn.execute(
            "UPDATE sessions SET is_sidechat = CASE WHEN sidechat_json IS NULL THEN 0 ELSE 1 END",
            [],
        )?;
        conn.execute_batch(
            "DROP INDEX IF EXISTS sessions_cwd_cover_idx;
             CREATE INDEX sessions_cwd_cover_idx
               ON sessions (cwd, has_user_message, updated_at DESC, id, harness,
                            model, runtime_mode, title, provider_session_id,
                            created_at, branch, archived, pinned,
                            linked_work_item_json, worktree_cwd, worktree_removed,
                            is_draft, automation_id, sidebar_hidden, is_sidechat);
             DROP INDEX IF EXISTS sessions_sidechat_list_idx;
             CREATE INDEX sessions_sidechat_list_idx
               ON sessions (updated_at DESC, id) WHERE is_sidechat = 1;",
        )?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (21, ?1)",
            params![now_millis()],
        )?;
    }
    // Create even when a version row already exists (another build may have
    // used the same numbers, or a previous run recorded the version without
    // the table). Restore writes into these; missing tables look like a
    // blank homepage.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS in_flight_sessions (
           session_id TEXT PRIMARY KEY,
           cwd TEXT NOT NULL,
           sort_index INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS workspace_snapshot (
           id INTEGER PRIMARY KEY CHECK (id = 1),
           snapshot_json TEXT NOT NULL,
           updated_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS worktree_removals (
           path TEXT PRIMARY KEY,
           sessions_json TEXT NOT NULL
         );",
    )?;
    // Compatibility only: earlier Inbox Ask builds saved temporary chats here.
    // Keep those records off normal surfaces without deleting their transcripts.
    ensure_session_column(conn, "inbox_ask", "TEXT")?;
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS sessions_legacy_inbox
         ON sessions (id) WHERE inbox_ask IS NOT NULL;",
    )?;
    // Unscoped session search pins this index with `INDEXED BY`, and SQLite
    // rejects that statement outright when the index is missing instead of
    // falling back to another plan. The versioned blocks above are the normal
    // path, but a recorded version can outlive the schema it describes, so
    // restore the index here for the same reason the tables above are
    // restored: a missing index would fail every search without a `cwd`.
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS sessions_cwd_cover_idx
           ON sessions (cwd, has_user_message, updated_at DESC, id, harness,
                        model, runtime_mode, title, provider_session_id,
                        created_at, branch, archived, pinned,
                        linked_work_item_json, worktree_cwd, worktree_removed,
                        is_draft, automation_id, sidebar_hidden, is_sidechat);
         CREATE INDEX IF NOT EXISTS sessions_sidechat_list_idx
           ON sessions (updated_at DESC, id) WHERE is_sidechat = 1;",
    )?;
    crate::notes::ensure_notes_table(conn)?;
    crate::tasks::ensure_tasks_table(conn)?;
    crate::session_board::ensure_session_board_table(conn)?;
    crate::reminders::ensure_table(conn)?;
    crate::automations::ensure_tables(conn)?;
    crate::prompts::ensure_table(conn)?;
    crate::provider_sessions::ensure_table(conn)?;
    ensure_orchestration_history(conn)?;
    crate::mono_transcript::ensure_tables(conn)?;
    Ok(())
}

fn ensure_orchestration_history(conn: &Connection) -> rusqlite::Result<()> {
    let indexed: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = 'orchestration_sidebar')",
        [],
        |row| row.get(0),
    )?;
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS orchestration_runs (lead_id TEXT PRIMARY KEY, state TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS orchestration_sidebar (lead_id TEXT PRIMARY KEY, summary TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS orchestration_workers (session_id TEXT PRIMARY KEY, lead_id TEXT NOT NULL);",
    )?;
    if !indexed {
        // One-time compatibility pass for the preview that listed workers as
        // separate chats. Normal sidebar reads never scan transcripts/run blobs.
        let runs = tx
            .prepare("SELECT lead_id, state FROM orchestration_runs")?
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (lead, state) in runs {
            if let Ok(run) = serde_json::from_str::<Value>(&state) {
                index_orchestration(&tx, &lead, &run)?;
            }
        }
        let workers = tx.prepare("SELECT id, blocks_json FROM sessions WHERE blocks_json LIKE '%orchestrationLeadId%'")?
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (id, blocks) in workers {
            if let Ok(blocks) = serde_json::from_str::<Value>(&blocks) {
                remember_worker_from_blocks(&tx, &id, &blocks)?;
            }
        }
    }
    tx.commit()
}

fn remember_worker(conn: &Connection, id: &str, lead: &str) -> rusqlite::Result<()> {
    if id != lead && validate_id(id, "Worker").is_ok() && validate_id(lead, "Lead").is_ok() {
        // Keep earlier workers indexed when a lead starts a subsequent run.
        conn.execute(
            "INSERT OR IGNORE INTO orchestration_workers(session_id, lead_id) VALUES (?1, ?2)",
            params![id, lead],
        )?;
    }
    Ok(())
}

fn remember_worker_from_blocks(
    conn: &Connection,
    id: &str,
    blocks: &Value,
) -> rusqlite::Result<()> {
    if let Some(blocks) = blocks.as_array() {
        for block in blocks {
            if block["role"] == "user" {
                if let Some(lead) = block["orchestrationLeadId"].as_str() {
                    remember_worker(conn, id, lead)?;
                    break;
                }
            }
        }
    }
    Ok(())
}

fn index_orchestration(conn: &Connection, lead: &str, run: &Value) -> rusqlite::Result<()> {
    let Some(tasks) = run["tasks"].as_array() else {
        return Ok(());
    };
    let mut summaries = Vec::new();
    for task in tasks {
        let Some(id) = task["sessionId"].as_str() else {
            continue;
        };
        remember_worker(conn, id, lead)?;
        summaries.push(serde_json::json!({
            "sessionId": id, "title": task["title"], "harness": task["harness"],
            "model": task["model"], "status": task["status"],
        }));
    }
    let summary = serde_json::json!({ "status": run["status"], "tasks": summaries });
    conn.execute("INSERT INTO orchestration_sidebar(lead_id, summary) VALUES (?1, ?2) ON CONFLICT(lead_id) DO UPDATE SET summary = excluded.summary", params![lead, summary.to_string()])?;
    Ok(())
}

pub(crate) fn save_orchestration(
    conn: &Connection,
    lead: &str,
    run: &Value,
) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("INSERT INTO orchestration_runs(lead_id, state) VALUES (?1, ?2) ON CONFLICT(lead_id) DO UPDATE SET state = excluded.state", params![lead, run.to_string()])?;
    index_orchestration(&tx, lead, run)?;
    tx.commit()
}

fn worker_parent(conn: &Connection, id: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT lead_id FROM orchestration_workers WHERE session_id = ?1",
        [id],
        |row| row.get(0),
    )
    .optional()
}

fn orchestration_summary(conn: &Connection, id: &str) -> rusqlite::Result<Option<Value>> {
    Ok(optional_json(
        conn.query_row(
            "SELECT summary FROM orchestration_sidebar WHERE lead_id = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()?,
    ))
}

pub(crate) fn upsert_session(
    conn: &Connection,
    session: &SessionUpsert,
) -> rusqlite::Result<SessionSummary> {
    let now = now_millis();
    let model_settings = serde_json::to_string(&session.model_settings)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let blocks = crate::artifacts::retain_existing_cards(conn, &session.blocks)?;
    let blocks_json = serde_json::to_string(blocks.as_ref())
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let linked_work_item_json = session
        .linked_work_item
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let automation_id = session
        .automation_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let provider_session_id = session
        .provider_session_id
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());
    let provider_account_id = session
        .provider_account_id
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());
    let sidechat_json = session
        .sidechat
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let git = crate::fs::git_info_for(&crate::fs::expand_home(
        session
            .worktree_cwd
            .as_deref()
            .filter(|cwd| !cwd.is_empty())
            .unwrap_or(&session.cwd),
    ));
    let branch = if session.worktree_removed {
        None
    } else {
        git.branch
            .as_deref()
            .filter(|value| !value.is_empty())
            .or_else(|| {
                session
                    .branch
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
            })
    };
    let worktree_cwd = session
        .worktree_cwd
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    // Upstream 0.8 databases may declare this column NOT NULL DEFAULT '[]'.
    // Store an empty array on both schemas and normalize it back to no queue on read.
    let has_queued_messages = session
        .queued_messages
        .as_ref()
        .and_then(serde_json::Value::as_array)
        .is_some_and(|items| !items.is_empty());
    let queued_messages_json = session
        .queued_messages
        .as_ref()
        .filter(|value| value.as_array().is_some_and(|items| !items.is_empty()))
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?
        .or_else(|| Some("[]".to_owned()));

    let queue_status = session
        .queue_status
        .as_deref()
        .filter(|status| has_queued_messages && matches!(*status, "paused" | "held" | "active"));
    let has_user_message = has_user_block(&session.blocks);
    let is_draft = has_draft_block(&session.blocks);

    type PreviousSession = (i64, i64, String, i64, i64, Option<String>, Option<String>);
    let existing: Option<PreviousSession> = conn
        .query_row(
            "SELECT created_at, updated_at, blocks_json, archived, pinned, queued_messages_json, queue_status FROM sessions WHERE id = ?1",
            params![session.id],
            |row| Ok((
                row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?,
                row.get(5)?, row.get(6)?,
            )),
        )
        .optional()?;
    let created_at = existing
        .as_ref()
        .map(|(value, _, _, _, _, _, _)| *value)
        .unwrap_or(now);
    let updated_at = match &existing {
        Some((_, prev_updated, prev_blocks, _, _, prev_queue, prev_status))
            if json_eq(prev_blocks, blocks.as_ref())
                && prev_queue == &queued_messages_json
                && prev_status.as_deref() == queue_status =>
        {
            *prev_updated
        }
        _ => now,
    };
    let archived = existing
        .as_ref()
        .map(|(_, _, _, value, _, _, _)| *value != 0)
        .unwrap_or(false);
    let pinned = existing
        .as_ref()
        .map(|(_, _, _, _, value, _, _)| *value != 0)
        .unwrap_or(false);

    conn.execute(
        "INSERT INTO sessions (
           id, cwd, harness, model, model_settings, runtime_mode, title,
           provider_session_id, blocks_json, created_at, updated_at, branch,
           context_used, context_window, worktree_cwd, has_user_message,
           linked_work_item_json, queued_messages_json, queue_status,
           provider_account_id, worktree_removed, is_draft, automation_id,
           sidebar_hidden, sidechat_json, is_sidechat
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26)
         ON CONFLICT(id) DO UPDATE SET
           cwd = excluded.cwd,
           harness = excluded.harness,
           model = excluded.model,
           model_settings = excluded.model_settings,
           runtime_mode = excluded.runtime_mode,
           title = excluded.title,
           provider_session_id = excluded.provider_session_id,
           blocks_json = excluded.blocks_json,
           updated_at = excluded.updated_at,
           branch = excluded.branch,
           context_used = excluded.context_used,
           context_window = excluded.context_window,
           worktree_cwd = excluded.worktree_cwd,
           has_user_message = excluded.has_user_message,
           linked_work_item_json = excluded.linked_work_item_json,
           queued_messages_json = excluded.queued_messages_json,
           queue_status = excluded.queue_status,
           provider_account_id = excluded.provider_account_id,
           worktree_removed = excluded.worktree_removed,
           is_draft = excluded.is_draft,
           automation_id = excluded.automation_id,
           sidebar_hidden = excluded.sidebar_hidden,
           sidechat_json = excluded.sidechat_json,
           is_sidechat = excluded.is_sidechat",
        params![
            session.id,
            session.cwd,
            session.harness,
            session.model,
            model_settings,
            session.runtime_mode,
            session.title,
            provider_session_id,
            blocks_json,
            created_at,
            updated_at,
            branch,
            session.context_used,
            session.context_window,
            worktree_cwd,
            i64::from(has_user_message),
            linked_work_item_json,
            queued_messages_json,
            queue_status,
            provider_account_id,
            i64::from(session.worktree_removed),
            i64::from(is_draft),
            automation_id,
            i64::from(session.sidebar_hidden),
            sidechat_json,
            i64::from(session.sidechat.is_some()),
        ],
    )?;

    remember_worker_from_blocks(conn, &session.id, &session.blocks)?;
    Ok(SessionSummary {
        sidebar_hidden: session.sidebar_hidden,
        id: session.id.clone(),
        orchestration_lead_id: worker_parent(conn, &session.id)?,
        orchestration: orchestration_summary(conn, &session.id)?,
        cwd: session.cwd.clone(),
        harness: session.harness.clone(),
        model: session.model.clone(),
        runtime_mode: session.runtime_mode.clone(),
        title: session.title.clone(),
        provider_session_id: provider_session_id.map(str::to_owned),
        branch: branch.map(str::to_owned),
        worktree_cwd: worktree_cwd.map(str::to_owned),
        worktree_removed: session.worktree_removed,
        repo: git.repo,
        additions: 0,
        deletions: 0,
        created_at,
        updated_at,
        archived,
        pinned,
        draft: is_draft,
        linked_work_item: session.linked_work_item.clone(),
        automation_id: automation_id.map(str::to_owned),
        sidechat: session.sidechat.as_ref().map(|sidechat| SidechatMeta {
            source_session_id: sidechat.source_session_id.clone(),
            source_title: sidechat.source_title.clone(),
            source_context: None,
        }),
    })
}

struct SearchProgressGuard<'a>(&'a Connection);

impl Drop for SearchProgressGuard<'_> {
    fn drop(&mut self) {
        let _ = self.0.progress_handler(1, None::<fn() -> bool>);
    }
}

#[cfg(test)]
fn search_sessions(
    conn: &Connection,
    options: &SessionSearchOptions,
) -> Result<SessionSearchResult, String> {
    let token = begin_session_search(&options.search_owner);
    let _release = SessionSearchRelease(token.clone());
    search_sessions_with_connection(conn, options, token.as_ref())
}

fn search_sessions_sql(include_archived: bool, cwd_scoped: bool) -> String {
    let mut sql = String::from(
        "SELECT id, cwd, harness, title, updated_at, archived,
                CASE WHEN octet_length(blocks_json) <= ?2
                     THEN blocks_json ELSE NULL END
         FROM sessions",
    );
    if !cwd_scoped {
        // Without a `cwd` equality to anchor the leading index column, the
        // planner answers this from a table scan, and every column it reads
        // (`inbox_ask`, `archived`, `has_user_message`, `updated_at`) sits after
        // `blocks_json` in the record, so it walks each transcript's overflow
        // pages before the size guard can reject the row. The partial inbox
        // index answers the same filter without the table, and pinning the
        // covering index keeps the rest of the predicate and the projection
        // inside it: the table is then reached only for `blocks_json` rows that
        // are already known to fit the budget.
        sql.push_str(" INDEXED BY sessions_cwd_cover_idx");
    }
    sql.push_str(
        " WHERE id NOT IN (SELECT id FROM sessions WHERE inbox_ask IS NOT NULL)
            AND has_user_message = 1
            AND (LOWER(title) LIKE LOWER(?1) ESCAPE '\\'
                 OR CASE WHEN octet_length(blocks_json) <= ?2
                         THEN LOWER(blocks_json) LIKE LOWER(?1) ESCAPE '\\'
                         ELSE 0 END
                 OR EXISTS(SELECT 1 FROM mono_blocks
                           WHERE mono_blocks.session_id = sessions.id
                             AND search_text LIKE LOWER(?1) ESCAPE '\\'))",
    );
    if !include_archived {
        sql.push_str(" AND archived = 0");
    }
    if cwd_scoped {
        sql.push_str(" AND cwd = ?3");
        sql.push_str(" ORDER BY updated_at DESC, id ASC LIMIT ?4");
    } else {
        sql.push_str(" ORDER BY updated_at DESC, id ASC LIMIT ?3");
    }
    sql
}

fn search_sessions_with_connection(
    conn: &Connection,
    options: &SessionSearchOptions,
    token: Option<&SessionSearchToken>,
) -> Result<SessionSearchResult, String> {
    search_sessions_with_connection_for_platform(conn, options, token, cfg!(windows), false)
}

fn search_sessions_with_connection_for_platform(
    conn: &Connection,
    options: &SessionSearchOptions,
    token: Option<&SessionSearchToken>,
    is_windows: bool,
    case_insensitive_fallback: bool,
) -> Result<SessionSearchResult, String> {
    let query = options.query.trim();
    if query.is_empty() {
        return Ok(SessionSearchResult {
            hits: Vec::new(),
            truncated: false,
        });
    }
    let needle = query.to_lowercase();
    let pattern = like_pattern(query);
    let cwd = options
        .cwd
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let budget = MAX_SEARCH_BUFFER_BYTES as i64;
    let candidates = cwd.map(|cwd| project_cwd_candidates_platform(cwd, is_windows));
    let fallback_cwd = candidates
        .as_ref()
        .and_then(|values| values.first())
        .map(|cwd| cwd.to_lowercase());
    let mut sql = search_sessions_sql(options.include_archived, cwd.is_some());
    let limit = (MAX_SEARCH_SCAN as i64) + 1;
    let mut query_params: Vec<&dyn rusqlite::ToSql> = vec![&pattern, &budget];
    if let Some(candidates) = &candidates {
        if case_insensitive_fallback {
            sql = sql.replace(" AND cwd = ?3", " AND REPLACE(LOWER(cwd), '\\', '/') = ?3");
            query_params.push(fallback_cwd.as_ref().expect("nonempty cwd candidates"));
        } else {
            let placeholders = (3..3 + candidates.len())
                .map(|index| format!("?{index}"))
                .collect::<Vec<_>>()
                .join(", ");
            sql = sql
                .replace(" AND cwd = ?3", &format!(" AND cwd IN ({placeholders})"))
                .replace("LIMIT ?4", &format!("LIMIT ?{}", 3 + candidates.len()));
            for candidate in candidates {
                query_params.push(candidate);
            }
        }
    }
    query_params.push(&limit);
    let mut statement = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut rows = statement
        .query(rusqlite::params_from_iter(query_params))
        .map_err(|e| e.to_string())?;

    let progress_token = token.cloned();
    conn.progress_handler(
        SEARCH_PROGRESS_INTERVAL as i32,
        Some(move || !session_search_is_current(progress_token.as_ref())),
    )
    .map_err(|e| e.to_string())?;
    let _progress_guard = SearchProgressGuard(conn);
    let mut conversations = Vec::new();
    let mut messages = Vec::new();
    let mut scanned = 0usize;
    let mut truncated = false;
    loop {
        if !session_search_is_current(token) {
            return Ok(SessionSearchResult {
                hits: Vec::new(),
                truncated: false,
            });
        }
        let row = match rows.next() {
            Ok(None) => break,
            Ok(Some(row)) => row,
            Err(_) if !session_search_is_current(token) => {
                return Ok(SessionSearchResult {
                    hits: Vec::new(),
                    truncated: false,
                });
            }
            Err(error) => return Err(error.to_string()),
        };
        scanned += 1;
        if scanned > MAX_SEARCH_SCAN {
            truncated = true;
            break;
        }

        let id: String = row.get(0).map_err(|e| e.to_string())?;
        let cwd: String = row.get(1).map_err(|e| e.to_string())?;
        let harness: String = row.get(2).map_err(|e| e.to_string())?;
        let title: String = row.get(3).map_err(|e| e.to_string())?;
        let updated_at: i64 = row.get(4).map_err(|e| e.to_string())?;
        let title_hit = title.to_lowercase().contains(&needle);
        if title_hit && conversations.len() < MAX_CONVERSATION_HITS {
            conversations.push(SessionSearchHit {
                kind: "conversation".into(),
                session_id: id.clone(),
                cwd: cwd.clone(),
                harness: harness.clone(),
                title: title.clone(),
                updated_at,
                block_id: None,
                role: None,
                preview: String::new(),
            });
        }

        if messages.len() >= MAX_MESSAGE_HITS {
            if title_hit {
                continue;
            }
            if conversations.len() >= MAX_CONVERSATION_HITS {
                truncated = true;
                break;
            }
            continue;
        }

        let blocks_raw = match row.get_ref(6).map_err(|e| e.to_string())? {
            rusqlite::types::ValueRef::Null => {
                truncated = true;
                continue;
            }
            value => {
                String::from_utf8_lossy(value.as_bytes().map_err(|e| e.to_string())?).into_owned()
            }
        };
        let blocks = if crate::mono_transcript::is_indexed(conn, &id).map_err(|e| e.to_string())? {
            crate::mono_transcript::matching_blocks(
                conn,
                &id,
                &needle,
                MAX_MESSAGE_HITS - messages.len(),
            )
            .map_err(|e| e.to_string())?
        } else {
            let Ok(blocks) = serde_json::from_str::<Value>(&blocks_raw) else {
                continue;
            };
            blocks
        };
        for hit in block_hits(&blocks, &needle) {
            messages.push(SessionSearchHit {
                kind: "message".into(),
                session_id: id.clone(),
                cwd: cwd.clone(),
                harness: harness.clone(),
                title: title.clone(),
                updated_at,
                block_id: Some(hit.0),
                role: Some(hit.1),
                preview: hit.2,
            });
            if messages.len() >= MAX_MESSAGE_HITS {
                truncated = true;
                break;
            }
        }
    }

    // Keep the legacy Windows case-insensitive fallback, but stream both passes
    // through upstream's bounded transcript projection and cancellation checks.
    if scanned == 0 && is_windows && !case_insensitive_fallback && cwd.is_some() {
        drop(rows);
        drop(statement);
        drop(_progress_guard);
        return search_sessions_with_connection_for_platform(conn, options, token, true, true);
    }
    if conversations.len() >= MAX_CONVERSATION_HITS {
        truncated = true;
    }
    let mut hits = conversations;
    hits.extend(messages);
    Ok(SessionSearchResult { hits, truncated })
}

fn like_pattern(query: &str) -> String {
    let mut out = String::from("%");
    for ch in query.chars().take(200) {
        match ch {
            '%' | '_' | '\\' => {
                out.push('\\');
                out.push(ch);
            }
            _ => out.push(ch),
        }
    }
    out.push('%');
    out
}

fn block_hits(blocks: &Value, needle: &str) -> Vec<(String, String, String)> {
    let Some(items) = blocks.as_array() else {
        return Vec::new();
    };
    let mut hits = Vec::new();
    for block in items {
        let role = block
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !matches!(
            role,
            "user" | "assistant" | "tool" | "tasks" | "plan" | "image"
        ) {
            continue;
        }
        let id = block
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if id.is_empty() {
            continue;
        }
        for text in block_texts(block) {
            if !text.to_lowercase().contains(needle) {
                continue;
            }
            hits.push((id.clone(), role.to_string(), snippet_around(&text, needle)));
            break;
        }
    }
    hits
}

fn block_texts(block: &Value) -> Vec<String> {
    let mut texts = Vec::new();
    push_text(&mut texts, block.get("text"));
    if let Some(image) = block.get("image") {
        push_text(&mut texts, image.get("name"));
        push_text(&mut texts, image.get("alt"));
    }
    if let Some(tool) = block.get("tool") {
        push_text(&mut texts, tool.get("title"));
        push_text(&mut texts, tool.get("detail"));
        if let Some(preview) = tool.get("preview") {
            push_text(&mut texts, preview.get("query"));
            push_text(&mut texts, preview.get("path"));
            push_text(&mut texts, preview.get("output"));
            push_text(&mut texts, preview.get("title"));
        }
    }
    texts
}

fn push_text(texts: &mut Vec<String>, value: Option<&Value>) {
    if let Some(text) = value.and_then(Value::as_str) {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            texts.push(trimmed.to_string());
        }
    }
}

fn snippet_around(text: &str, needle: &str) -> String {
    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let lower = compact.to_lowercase();
    let Some(index) = lower.find(needle) else {
        if compact.chars().count() <= SNIPPET_RADIUS * 2 {
            return compact;
        }
        return format!(
            "{}…",
            compact.chars().take(SNIPPET_RADIUS * 2).collect::<String>()
        );
    };
    let start = floor_char_boundary(&compact, index.saturating_sub(SNIPPET_RADIUS));
    let end = ceil_char_boundary(
        &compact,
        (index + needle.len() + SNIPPET_RADIUS).min(compact.len()),
    );
    let mut snippet = compact[start..end].trim().to_string();
    if start > 0 {
        snippet = format!("…{snippet}");
    }
    if end < compact.len() {
        snippet = format!("{snippet}…");
    }
    snippet
}

fn floor_char_boundary(text: &str, mut index: usize) -> usize {
    if index >= text.len() {
        return text.len();
    }
    while index > 0 && !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

fn ceil_char_boundary(text: &str, mut index: usize) -> usize {
    if index >= text.len() {
        return text.len();
    }
    while index < text.len() && !text.is_char_boundary(index) {
        index += 1;
    }
    index
}

pub(crate) fn project_cwd_candidates(cwd: &str) -> Vec<String> {
    project_cwd_candidates_platform(cwd, cfg!(windows))
}

pub(crate) fn project_cwd_candidates_platform(cwd: &str, is_windows: bool) -> Vec<String> {
    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    if !is_windows {
        return vec![trimmed.to_string()];
    }

    let mut candidates = Vec::with_capacity(4);

    let is_drive_root = trimmed.len() >= 2
        && trimmed.as_bytes()[0].is_ascii_alphabetic()
        && trimmed.as_bytes()[1] == b':'
        && (trimmed.len() == 2
            || (trimmed.len() == 3 && (trimmed.ends_with('/') || trimmed.ends_with('\\'))));

    let base = if is_drive_root {
        trimmed
    } else {
        trimmed.trim_end_matches(['/', '\\'])
    };

    let forward = base.replace('\\', "/");
    let backslash = base.replace('/', "\\");

    candidates.push(forward.clone());
    if backslash != forward {
        candidates.push(backslash.clone());
    }

    let bytes = base.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        let drive_char = bytes[0] as char;
        let alt_drive_char = if drive_char.is_ascii_uppercase() {
            drive_char.to_ascii_lowercase()
        } else {
            drive_char.to_ascii_uppercase()
        };

        let alt_forward = format!("{}{}", alt_drive_char, &forward[1..]);
        let alt_backslash = format!("{}{}", alt_drive_char, &backslash[1..]);

        if !candidates.contains(&alt_forward) {
            candidates.push(alt_forward);
        }
        if !candidates.contains(&alt_backslash) {
            candidates.push(alt_backslash);
        }
    }

    candidates
}

fn list_by_project(conn: &Connection, cwd: &str) -> rusqlite::Result<Vec<SessionSummary>> {
    let git = crate::fs::git_info_for(&crate::fs::expand_home(cwd));
    let candidates = project_cwd_candidates(cwd);
    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    let map_summary = |row: &rusqlite::Row| {
        let stored_branch: Option<String> = row.get(9)?;
        let archived: i64 = row.get(10)?;
        let pinned: i64 = row.get(11)?;
        let linked_work_item = optional_json(row.get(12)?);
        Ok(SessionSummary {
            sidebar_hidden: row.get::<_, i64>(18)? != 0,
            id: row.get(0)?,
            orchestration_lead_id: None,
            orchestration: optional_json(row.get(13)?),
            cwd: row.get(1)?,
            harness: row.get(2)?,
            model: row.get(3)?,
            runtime_mode: row.get(4)?,
            title: row.get(5)?,
            provider_session_id: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
            branch: if row.get::<_, i64>(15)? != 0 {
                None
            } else {
                nonempty(stored_branch).or_else(|| git.branch.clone())
            },
            worktree_cwd: row.get(14)?,
            worktree_removed: row.get::<_, i64>(15)? != 0,
            repo: git.repo.clone(),
            additions: 0,
            deletions: 0,
            archived: archived != 0,
            pinned: pinned != 0,
            draft: row.get::<_, i64>(16)? != 0,
            linked_work_item,
            automation_id: nonempty(row.get(17)?),
            sidechat: None,
        })
    };

    let mut rows_vec = if candidates.len() == 1 {
        let mut statement = conn.prepare(
            "SELECT id, cwd, harness, model, runtime_mode, title, provider_session_id,
                    created_at, updated_at, branch, archived, pinned,
                    linked_work_item_json,
                    (SELECT summary FROM orchestration_sidebar WHERE lead_id = sessions.id), worktree_cwd,
                    worktree_removed, is_draft, automation_id, sidebar_hidden
             FROM sessions
             WHERE cwd = ?1
               AND has_user_message = 1
               AND is_sidechat = 0
               AND id NOT IN (SELECT id FROM sessions WHERE inbox_ask IS NOT NULL)
               AND id NOT IN (SELECT session_id FROM orchestration_workers)
             ORDER BY updated_at DESC, id ASC",
        )?;
        let rows = statement.query_map(params![&candidates[0]], map_summary)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    } else {
        let placeholders = (1..=candidates.len())
            .map(|i| format!("?{i}"))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT id, cwd, harness, model, runtime_mode, title, provider_session_id,
                    created_at, updated_at, branch, archived, pinned,
                    linked_work_item_json,
                    (SELECT summary FROM orchestration_sidebar WHERE lead_id = sessions.id), worktree_cwd,
                    worktree_removed, is_draft, automation_id, sidebar_hidden
             FROM sessions
             WHERE cwd IN ({placeholders})
               AND has_user_message = 1
               AND is_sidechat = 0
               AND id NOT IN (SELECT id FROM sessions WHERE inbox_ask IS NOT NULL)
               AND id NOT IN (SELECT session_id FROM orchestration_workers)
             ORDER BY updated_at DESC, id ASC"
        );
        let mut statement = conn.prepare(&sql)?;
        let rows =
            statement.query_map(rusqlite::params_from_iter(candidates.iter()), map_summary)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };

    // Bounded case-insensitive fallback on Windows if exact candidates yielded no sessions
    if cfg!(windows) && rows_vec.is_empty() {
        let canonical_lower = candidates[0].to_lowercase();
        let mut fallback_statement = conn.prepare(
            "SELECT id, cwd, harness, model, runtime_mode, title, provider_session_id,
                    created_at, updated_at, branch, archived, pinned,
                    linked_work_item_json,
                    (SELECT summary FROM orchestration_sidebar WHERE lead_id = sessions.id), worktree_cwd,
                    worktree_removed, is_draft, automation_id, sidebar_hidden
             FROM sessions
             WHERE has_user_message = 1
               AND is_sidechat = 0
               AND id NOT IN (SELECT id FROM sessions WHERE inbox_ask IS NOT NULL)
               AND id NOT IN (SELECT session_id FROM orchestration_workers)
               AND REPLACE(LOWER(cwd), '\\', '/') = ?1
             ORDER BY updated_at DESC, id ASC
             LIMIT 1000",
        )?;
        let fallback_rows = fallback_statement.query_map(params![canonical_lower], map_summary)?;
        rows_vec = fallback_rows.collect::<rusqlite::Result<Vec<_>>>()?;
    }

    // Deduplicate by session ID while preserving ordering
    let mut seen = std::collections::HashSet::new();
    let mut deduplicated = Vec::with_capacity(rows_vec.len());
    for summary in rows_vec {
        if seen.insert(summary.id.clone()) {
            deduplicated.push(summary);
        }
    }

    Ok(deduplicated)
}

fn list_sidechats(conn: &Connection) -> rusqlite::Result<Vec<SessionSummary>> {
    let mut statement = conn.prepare(
        "SELECT id, cwd, harness, model, runtime_mode, title, provider_session_id,
                created_at, updated_at, branch, worktree_cwd, worktree_removed,
                linked_work_item_json, archived, pinned, is_draft,
                automation_id, sidebar_hidden, sidechat_json
         FROM sessions
         WHERE is_sidechat = 1 AND archived = 0
           AND inbox_ask IS NULL
           AND id NOT IN (SELECT session_id FROM orchestration_workers)
         ORDER BY updated_at DESC, id ASC",
    )?;
    let rows = statement.query_map([], |row| {
        let sidechat: Option<SidechatMeta> =
            optional_json(row.get(18)?).and_then(|value| serde_json::from_value(value).ok());
        Ok(SessionSummary {
            id: row.get(0)?,
            cwd: row.get(1)?,
            harness: row.get(2)?,
            model: row.get(3)?,
            runtime_mode: row.get(4)?,
            title: row.get(5)?,
            provider_session_id: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
            branch: nonempty(row.get(9)?),
            orchestration_lead_id: None,
            orchestration: None,
            repo: None,
            additions: 0,
            deletions: 0,
            archived: row.get::<_, i64>(13)? != 0,
            pinned: row.get::<_, i64>(14)? != 0,
            draft: row.get::<_, i64>(15)? != 0,
            automation_id: nonempty(row.get(16)?),
            sidebar_hidden: row.get::<_, i64>(17)? != 0,
            worktree_cwd: row.get(10)?,
            worktree_removed: row.get::<_, i64>(11)? != 0,
            linked_work_item: optional_json(row.get(12)?),
            sidechat: sidechat.map(|source| SidechatMeta {
                source_session_id: source.source_session_id,
                source_title: source.source_title,
                source_context: None,
            }),
        })
    })?;
    rows.collect()
}

fn list_linked(conn: &Connection) -> rusqlite::Result<Vec<SessionSummary>> {
    let mut statement = conn.prepare(
        "SELECT id, cwd, harness, model, runtime_mode, title, provider_session_id,
                created_at, updated_at, branch, archived, pinned,
                linked_work_item_json,
                (SELECT summary FROM orchestration_sidebar WHERE lead_id = sessions.id), worktree_cwd,
                worktree_removed, is_draft, automation_id, sidebar_hidden
         FROM sessions
         WHERE has_user_message = 1
           AND linked_work_item_json IS NOT NULL
           AND is_sidechat = 0
           AND id NOT IN (SELECT id FROM sessions WHERE inbox_ask IS NOT NULL)
           AND id NOT IN (SELECT session_id FROM orchestration_workers)
         ORDER BY updated_at DESC, id ASC",
    )?;
    let rows = statement.query_map([], |row| {
        let archived: i64 = row.get(10)?;
        let pinned: i64 = row.get(11)?;
        Ok(SessionSummary {
            sidebar_hidden: row.get::<_, i64>(18)? != 0,
            id: row.get(0)?,
            orchestration_lead_id: None,
            orchestration: optional_json(row.get(13)?),
            cwd: row.get(1)?,
            harness: row.get(2)?,
            model: row.get(3)?,
            runtime_mode: row.get(4)?,
            title: row.get(5)?,
            provider_session_id: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
            branch: nonempty(row.get(9)?),
            worktree_cwd: row.get(14)?,
            worktree_removed: row.get::<_, i64>(15)? != 0,
            repo: None,
            additions: 0,
            deletions: 0,
            archived: archived != 0,
            pinned: pinned != 0,
            draft: row.get::<_, i64>(16)? != 0,
            linked_work_item: optional_json(row.get(12)?),
            automation_id: nonempty(row.get(17)?),
            sidechat: None,
        })
    })?;
    rows.collect()
}

/// Mirrors `list_by_project` for scratch chats. Stored cwds keep native
/// separators, so both `/` and `\` spellings are matched.
fn list_scratch(conn: &Connection) -> rusqlite::Result<Vec<SessionSummary>> {
    let mut statement = conn.prepare(
        "SELECT id, cwd, harness, model, runtime_mode, title, provider_session_id,
                created_at, updated_at, branch, archived, pinned, is_draft, automation_id,
                sidebar_hidden
         FROM sessions
         WHERE has_user_message = 1
           AND is_sidechat = 0
           AND (cwd LIKE '%.monocode/scratch/%'
             OR cwd LIKE '%.monocode\\scratch\\%')
         ORDER BY updated_at DESC, id ASC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(SessionSummary {
            id: row.get(0)?,
            cwd: row.get(1)?,
            harness: row.get(2)?,
            model: row.get(3)?,
            runtime_mode: row.get(4)?,
            title: row.get(5)?,
            provider_session_id: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
            branch: nonempty(row.get(9)?),
            orchestration_lead_id: None,
            orchestration: None,
            worktree_cwd: None,
            worktree_removed: false,
            linked_work_item: None,
            repo: None,
            additions: 0,
            deletions: 0,
            archived: row.get::<_, i64>(10)? != 0,
            pinned: row.get::<_, i64>(11)? != 0,
            draft: row.get::<_, i64>(12)? != 0,
            automation_id: nonempty(row.get(13)?),
            sidebar_hidden: row.get::<_, i64>(14)? != 0,
            sidechat: None,
        })
    })?;
    rows.collect()
}

/// Mirrors the sidebar's notion of a listable session: a transcript that the
/// user has actually said something in.
fn has_user_block(blocks: &Value) -> bool {
    blocks.as_array().is_some_and(|blocks| {
        blocks
            .iter()
            .any(|block| block.get("role").and_then(Value::as_str) == Some("user"))
    })
}

fn has_draft_block(blocks: &Value) -> bool {
    blocks.as_array().is_some_and(|blocks| {
        blocks.iter().any(|block| {
            block.get("role").and_then(Value::as_str) == Some("user")
                && block.get("draft").and_then(Value::as_bool) == Some(true)
        })
    })
}

fn nonempty(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.is_empty())
}

fn json_eq(raw: &str, incoming: &Value) -> bool {
    match serde_json::from_str::<Value>(raw) {
        Ok(previous) => previous == *incoming,
        Err(_) => false,
    }
}

fn optional_json(raw: Option<String>) -> Option<Value> {
    raw.and_then(|value| serde_json::from_str(&value).ok())
}

fn delete_session(conn: &Connection, session_id: &str) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    let parent = worker_parent(&tx, session_id)?;
    // Ownership is also carried in transcripts for older clients. Release
    // that metadata along with the index so reopening a worker stays detached.
    let workers = tx.prepare("SELECT id, blocks_json FROM sessions WHERE id IN (SELECT session_id FROM orchestration_workers WHERE lead_id = ?1)")?
        .query_map([session_id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (id, raw) in workers {
        let mut blocks: Value = serde_json::from_str(&raw).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
        })?;
        if let Some(blocks) = blocks.as_array_mut() {
            for block in blocks {
                if block["orchestrationLeadId"] == session_id {
                    if let Some(block) = block.as_object_mut() {
                        block.remove("orchestrationLeadId");
                    }
                }
            }
        }
        tx.execute(
            "UPDATE sessions SET blocks_json = ?1 WHERE id = ?2",
            params![blocks.to_string(), id],
        )?;
    }
    tx.execute(
        "DELETE FROM orchestration_runs WHERE lead_id = ?1",
        [session_id],
    )?;
    tx.execute(
        "DELETE FROM orchestration_sidebar WHERE lead_id = ?1",
        [session_id],
    )?;
    if let Some(parent) = parent.filter(|id| id != session_id) {
        let raw: Option<String> = tx
            .query_row(
                "SELECT state FROM orchestration_runs WHERE lead_id = ?1",
                [&parent],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(raw) = raw {
            let mut run: Value = serde_json::from_str(&raw).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Text,
                    Box::new(e),
                )
            })?;
            let mut removed = false;
            if let Some(tasks) = run["tasks"].as_array_mut() {
                let ids: Vec<String> = tasks
                    .iter()
                    .filter(|task| task["sessionId"] == session_id)
                    .filter_map(|task| task["id"].as_str().map(str::to_string))
                    .collect();
                let before = tasks.len();
                tasks.retain(|task| task["sessionId"] != session_id);
                removed = before != tasks.len();
                if removed {
                    for task in tasks {
                        if let Some(deps) = task["dependsOn"].as_array_mut() {
                            deps.retain(|dep| !ids.iter().any(|id| dep == id));
                        }
                        // Removing a prerequisite must not release queued work.
                        // The app stops the run before deleting any current member.
                        if matches!(
                            task["status"].as_str(),
                            Some("queued" | "running" | "cancelling")
                        ) {
                            task["status"] = json!("cancelled");
                            task["accepted"] = json!(false);
                            task["delivered"] = json!(true);
                        }
                    }
                }
            }
            if removed {
                if matches!(run["status"].as_str(), Some("active" | "paused")) {
                    run["status"] = json!("stopped");
                    run["error"] =
                        json!("A worker conversation was deleted. Start a new run to continue.");
                }
                run["requests"] = json!({});
                tx.execute(
                    "UPDATE orchestration_runs SET state = ?1 WHERE lead_id = ?2",
                    params![run.to_string(), parent],
                )?;
                index_orchestration(&tx, &parent, &run)?;
            }
        }
        // Also handle summaries left by an older client without a run record.
        if let Some(mut summary) = orchestration_summary(&tx, &parent)? {
            if let Some(tasks) = summary["tasks"].as_array_mut() {
                tasks.retain(|task| task["sessionId"] != session_id);
            }
            tx.execute(
                "UPDATE orchestration_sidebar SET summary = ?1 WHERE lead_id = ?2",
                params![summary.to_string(), parent],
            )?;
        }
    }
    tx.execute(
        "DELETE FROM orchestration_workers WHERE session_id = ?1 OR lead_id = ?1",
        [session_id],
    )?;
    tx.execute("DELETE FROM sessions WHERE id = ?1", [session_id])?;
    tx.commit()
}

fn set_archived(conn: &Connection, session_id: &str, archived: bool) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE sessions SET archived = ?1 WHERE id = ?2",
        params![if archived { 1 } else { 0 }, session_id],
    )?;
    Ok(())
}

fn set_pinned(conn: &Connection, session_id: &str, pinned: bool) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE sessions SET pinned = ?1 WHERE id = ?2",
        params![if pinned { 1 } else { 0 }, session_id],
    )?;
    Ok(())
}

fn set_linked_work_item(
    conn: &Connection,
    session_id: &str,
    linked_work_item: Option<&Value>,
) -> rusqlite::Result<()> {
    let linked_work_item_json = linked_work_item
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    conn.execute(
        "UPDATE sessions SET linked_work_item_json = ?1 WHERE id = ?2",
        params![linked_work_item_json, session_id],
    )?;
    Ok(())
}

pub(crate) fn get_session(
    conn: &Connection,
    session_id: &str,
) -> rusqlite::Result<Option<SessionRecord>> {
    get_session_record(conn, session_id, true)
}

pub(crate) fn get_session_metadata(
    conn: &Connection,
    session_id: &str,
) -> rusqlite::Result<Option<SessionRecord>> {
    get_session_record(conn, session_id, false)
}

fn get_session_record(
    conn: &Connection,
    session_id: &str,
    with_blocks: bool,
) -> rusqlite::Result<Option<SessionRecord>> {
    let blocks = if with_blocks { "blocks_json" } else { "'[]'" };
    conn.query_row(
        &format!(
            "SELECT id, cwd, harness, model, model_settings, runtime_mode, title,
                provider_session_id, {blocks}, created_at, updated_at,
                context_used, context_window, branch, worktree_cwd,
                linked_work_item_json, queued_messages_json, queue_status, provider_account_id, worktree_removed, is_draft,
                automation_id, sidebar_hidden, sidechat_json
         FROM sessions
         WHERE id = ?1 AND inbox_ask IS NULL"
        ),
        params![session_id],
        |row| {
            let model_settings_raw: String = row.get(4)?;
            let blocks_raw: String = row.get(8)?;
            let model_settings = serde_json::from_str(&model_settings_raw).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    4,
                    rusqlite::types::Type::Text,
                    Box::new(e),
                )
            })?;
            let blocks = serde_json::from_str(&blocks_raw).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    8,
                    rusqlite::types::Type::Text,
                    Box::new(e),
                )
            })?;
            let queued_raw: Option<String> = row.get(16)?;
            let queued_messages: Option<serde_json::Value> = queued_raw
                .and_then(|raw| serde_json::from_str(&raw).ok())
                .filter(|value: &serde_json::Value| {
                    value.as_array().is_some_and(|items| !items.is_empty())
                });
            let raw_queue_status: Option<String> = row.get(17)?;
            let queue_status = if queued_messages.is_some() {
                raw_queue_status
            } else {
                None
            };
            Ok(SessionRecord {
                sidebar_hidden: row.get::<_, i64>(22)? != 0,
                id: row.get(0)?,
                orchestration_lead_id: worker_parent(conn, session_id)?,
                cwd: row.get(1)?,
                harness: row.get(2)?,
                model: row.get(3)?,
                model_settings,
                runtime_mode: row.get(5)?,
                title: row.get(6)?,
                provider_session_id: row.get(7)?,
                blocks,
                context_used: row.get(11)?,
                context_window: row.get(12)?,
                branch: row.get(13)?,
                worktree_cwd: row.get(14)?,
                worktree_removed: row.get::<_, i64>(19)? != 0,
                linked_work_item: optional_json(row.get(15)?),
                queued_messages,
                queue_status,
                provider_account_id: row.get(18)?,
                draft: row.get::<_, i64>(20)? != 0,
                automation_id: nonempty(row.get(21)?),
                sidechat: optional_json(row.get(23)?)
                    .and_then(|value| serde_json::from_value(value).ok()),
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        },
    )
    .optional()
}

fn list_in_flight(conn: &Connection) -> rusqlite::Result<Vec<InFlightSession>> {
    let mut statement = conn.prepare(
        "SELECT session_id, cwd FROM in_flight_sessions ORDER BY sort_index ASC, session_id ASC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(InFlightSession {
            session_id: row.get(0)?,
            cwd: row.get(1)?,
        })
    })?;
    rows.collect()
}

fn replace_in_flight(conn: &mut Connection, sessions: &[InFlightSession]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM in_flight_sessions", [])?;
    {
        let mut insert = tx.prepare(
            "INSERT INTO in_flight_sessions (session_id, cwd, sort_index)
             VALUES (?1, ?2, ?3)",
        )?;
        for (index, session) in sessions.iter().enumerate() {
            insert.execute(params![session.session_id, session.cwd, index as i64])?;
        }
    }
    tx.commit()?;
    Ok(())
}

fn take_in_flight(conn: &mut Connection) -> rusqlite::Result<Vec<InFlightSession>> {
    let tx = conn.transaction()?;
    let sessions = {
        let mut statement = tx.prepare(
            "SELECT session_id, cwd FROM in_flight_sessions ORDER BY sort_index ASC, session_id ASC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(InFlightSession {
                session_id: row.get(0)?,
                cwd: row.get(1)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    tx.execute("DELETE FROM in_flight_sessions", [])?;
    tx.commit()?;
    Ok(sessions)
}

fn set_workspace_snapshot(conn: &Connection, json: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO workspace_snapshot (id, snapshot_json, updated_at)
         VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET
           snapshot_json = excluded.snapshot_json,
           updated_at = excluded.updated_at",
        params![json, now_millis()],
    )?;
    Ok(())
}

fn get_workspace_snapshot(conn: &Connection) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT snapshot_json FROM workspace_snapshot WHERE id = 1",
        [],
        |row| row.get(0),
    )
    .optional()
}

pub(crate) fn validate_id(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(format!("Invalid {label} id"));
    }
    Ok(())
}

pub(crate) fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::hooks::{AuthAction, Authorization};
    use serde_json::json;
    use std::sync::atomic::AtomicUsize;

    #[test]
    fn search_keeps_older_mono_messages_available_after_conversion() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let mut mono = sample("mono", "/tmp/a", "Mono");
        mono.blocks = json!([{ "id":"old", "role":"user", "text":"Archived needle" }, { "id":"answer", "role":"assistant", "text":"Done" }]);
        upsert_session(&conn, &mono).unwrap();
        crate::mono_transcript::migrate_transcript(&conn, "mono").unwrap();
        let result = search_sessions(
            &conn,
            &SessionSearchOptions {
                query: "Archived needle".into(),
                cwd: None,
                include_archived: false,
                search_owner: "mono-search".into(),
            },
        )
        .unwrap();
        assert_eq!(result.hits.len(), 1);
        assert_eq!(result.hits[0].block_id.as_deref(), Some("old"));
    }

    #[test]
    fn startup_does_not_read_saved_transcripts() {
        let data_dir = std::env::temp_dir().join(format!(
            "monocode-startup-transcripts-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path = data_dir.join("monocode.db");
        {
            let store = SessionStore::open(path.clone()).unwrap();
            let conn = store.lock_conn().unwrap();
            conn.execute(
                "INSERT INTO sessions (
                   id, cwd, harness, model, runtime_mode, title,
                   blocks_json, created_at, updated_at
                 ) VALUES ('large', '/tmp', 'codex', 'test', 'supervised', 'Large', ?1, 1, 1)",
                ["x".repeat(8_000_000)],
            )
            .unwrap();
        }

        let transcript_reads = Arc::new(AtomicUsize::new(0));
        let reads = Arc::clone(&transcript_reads);
        let mut managed = None;
        init_with(
            || Ok(data_dir.clone()),
            |requested_path| {
                assert_eq!(requested_path, path);
                let store = SessionStore::open(requested_path)?;
                store
                    .lock_conn()?
                    .authorizer(Some(move |context: rusqlite::hooks::AuthContext<'_>| {
                        if matches!(
                            context.action,
                            AuthAction::Read {
                                table_name: "sessions",
                                column_name: "blocks_json"
                            }
                        ) {
                            reads.fetch_add(1, Ordering::Relaxed);
                            Authorization::Deny
                        } else {
                            Authorization::Allow
                        }
                    }))
                    .map_err(|error| error.to_string())?;
                Ok(store)
            },
            |store| managed = Some(store),
        )
        .unwrap();
        assert_eq!(transcript_reads.load(Ordering::Relaxed), 0);
        drop(managed);
        let _ = std::fs::remove_dir_all(data_dir);
    }

    fn sample(id: &str, cwd: &str, title: &str) -> SessionUpsert {
        SessionUpsert {
            sidebar_hidden: false,
            id: id.into(),
            cwd: cwd.into(),
            harness: "cursor".into(),
            model: "gpt-5".into(),
            model_settings: json!({ "thinking": "high" }),
            runtime_mode: "supervised".into(),
            title: title.into(),
            provider_session_id: Some("acp-session-1".into()),
            provider_account_id: None,
            blocks: json!([{ "id": "b1", "role": "user", "text": "hello" }]),
            context_used: None,
            context_window: None,
            branch: None,
            worktree_cwd: None,
            worktree_removed: false,
            linked_work_item: None,
            queued_messages: None,
            queue_status: None,
            automation_id: None,
            sidechat: None,
        }
    }

    #[test]
    fn legacy_inbox_chats_are_not_normal_sessions() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        upsert_session(&conn, &sample("project", "/tmp/project", "Login")).unwrap();
        upsert_session(&conn, &sample("ask", "/tmp/project", "Login")).unwrap();
        conn.execute("UPDATE sessions SET inbox_ask = '{}' WHERE id = 'ask'", [])
            .unwrap();
        migrate(&conn).unwrap();
        let rows = list_by_project(&conn, "/tmp/project").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "project");
        assert!(get_session(&conn, "ask").unwrap().is_none());
        let search = search_sessions(
            &conn,
            &SessionSearchOptions {
                query: "Login".into(),
                cwd: None,
                include_archived: true,
                search_owner: String::new(),
            },
        )
        .unwrap();
        assert!(search.hits.iter().all(|hit| hit.session_id == "project"));
        // Hiding the old implementation's records does not delete their data.
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn orchestration_history_groups_workers_and_keeps_their_transcripts() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        for id in ["lead", "worker-a", "worker-b", "unrelated"] {
            upsert_session(&conn, &sample(id, "/tmp/a", id)).unwrap();
        }
        let run = json!({"status": "active", "tasks": [
            {"sessionId": "worker-a", "title": "UI", "harness": "codex", "model": "one", "status": "running", "prompt": "private instructions", "result": "large result"},
            {"sessionId": "worker-b", "title": "Tests", "harness": "claude", "model": "two", "status": "queued"}
        ]});
        save_orchestration(&conn, "lead", &run).unwrap();
        // Reopening/migration must not hydrate, pause or otherwise mutate runs.
        migrate(&conn).unwrap();
        let rows = list_by_project(&conn, "/tmp/a").unwrap();
        assert_eq!(rows.len(), 2);
        let lead = rows.iter().find(|row| row.id == "lead").unwrap();
        let summary = lead.orchestration.as_ref().unwrap();
        assert_eq!(summary["tasks"].as_array().unwrap().len(), 2);
        assert_eq!(summary["status"], "active");
        assert!(summary["tasks"][0].get("prompt").is_none());
        assert!(summary["tasks"][0].get("result").is_none());
        let worker = get_session(&conn, "worker-a").unwrap().unwrap();
        assert_eq!(worker.orchestration_lead_id.as_deref(), Some("lead"));
        assert!(has_user_block(&worker.blocks));
        // A later run replaces the card's agents without resurfacing old chats.
        save_orchestration(&conn, "lead", &json!({"status": "active", "tasks": []})).unwrap();
        assert_eq!(list_by_project(&conn, "/tmp/a").unwrap().len(), 2);
    }

    #[test]
    fn worker_upserts_carry_ownership_before_the_run_is_saved() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut worker = sample("worker", "/tmp/a", "Worker");
        worker.blocks =
            json!([{"id": "u", "role": "user", "text": "Task", "orchestrationLeadId": "lead"}]);
        worker.linked_work_item = Some(json!({"kind": "pr", "number": 1}));
        let summary = upsert_session(&conn, &worker).unwrap();
        assert_eq!(summary.orchestration_lead_id.as_deref(), Some("lead"));
        assert!(list_by_project(&conn, "/tmp/a").unwrap().is_empty());
        assert!(list_linked(&conn).unwrap().is_empty());
        // An older renderer's next write cannot accidentally detach a worker.
        worker.blocks = json!([{"id": "u", "role": "user", "text": "Task"}]);
        upsert_session(&conn, &worker).unwrap();
        assert!(list_by_project(&conn, "/tmp/a").unwrap().is_empty());
    }

    #[test]
    fn migration_groups_workers_from_the_earlier_preview() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        for id in ["lead", "old-worker", "current-worker"] {
            upsert_session(&conn, &sample(id, "/tmp/a", id)).unwrap();
        }
        conn.execute(
            "UPDATE sessions SET blocks_json = ?1 WHERE id = 'old-worker'",
            [
                json!([{"role": "user", "orchestrationLeadId": "lead", "text": "Old task"}])
                    .to_string(),
            ],
        )
        .unwrap();
        conn.execute("INSERT INTO orchestration_runs(lead_id, state) VALUES ('lead', ?1)", [json!({"status": "paused", "tasks": [{"sessionId": "current-worker", "title": "Task", "harness": "codex", "model": "one", "status": "completed"}]}).to_string()]).unwrap();
        conn.execute_batch("DROP TABLE orchestration_sidebar; DROP TABLE orchestration_workers;")
            .unwrap();
        migrate(&conn).unwrap();
        let rows = list_by_project(&conn, "/tmp/a").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "lead");
        assert_eq!(
            rows[0].orchestration.as_ref().unwrap()["tasks"][0]["title"],
            "Task"
        );
        assert_eq!(
            worker_parent(&conn, "old-worker").unwrap().as_deref(),
            Some("lead")
        );
        assert_eq!(
            worker_parent(&conn, "current-worker").unwrap().as_deref(),
            Some("lead")
        );
    }

    /// The sidebar query must stay answerable from the index alone. Selecting a
    /// column the index does not carry silently reintroduces a table seek per
    /// row, and every summary column sits behind a ~180 KB `blocks_json` blob
    /// in the record, so that regression is worth ~30x on a real project.
    #[test]
    fn list_by_project_is_served_by_a_covering_index() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "A1")).unwrap();
        for upgraded in [false, true] {
            if upgraded {
                // Exercise an existing v15 database with the old projection.
                conn.execute_batch(
                    "DROP INDEX sessions_cwd_cover_idx;
                     CREATE INDEX sessions_cwd_cover_idx
                       ON sessions (cwd, has_user_message, updated_at DESC, id, harness,
                                    model, runtime_mode, title, provider_session_id,
                                    created_at, branch, archived, pinned, linked_work_item_json);
                     DELETE FROM schema_migrations WHERE version IN (16, 17, 18, 19, 20, 21);",
                )
                .unwrap();
                migrate(&conn).unwrap();
            }
            let plan: String = conn
                .query_row(
                    "EXPLAIN QUERY PLAN
                 SELECT id, cwd, harness, model, runtime_mode, title, provider_session_id,
                        created_at, updated_at, branch, archived, pinned,
                        linked_work_item_json, worktree_cwd, worktree_removed, is_draft,
                        automation_id, sidebar_hidden,
                        (SELECT summary FROM orchestration_sidebar WHERE lead_id = sessions.id)
                 FROM sessions
                 WHERE cwd = ?1
                   AND has_user_message = 1
                   AND id NOT IN (SELECT id FROM sessions WHERE inbox_ask IS NOT NULL)
                   AND id NOT IN (SELECT session_id FROM orchestration_workers)
                 ORDER BY updated_at DESC, id ASC",
                    params!["/tmp/a"],
                    |row| row.get(3),
                )
                .unwrap();
            assert!(
                plan.contains("COVERING INDEX"),
                "sidebar listing fell back to table seeks: {plan}"
            );
        }
    }
    #[test]
    fn upsert_tracks_whether_a_user_has_spoken() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut quiet = sample("s1", "/tmp/a", "Quiet");
        quiet.blocks = json!([{ "id": "b1", "role": "assistant", "text": "hi" }]);
        upsert_session(&conn, &quiet).unwrap();
        assert!(list_by_project(&conn, "/tmp/a").unwrap().is_empty());

        // The flag has to follow the transcript, not just the first write.
        quiet.blocks = json!([
            { "id": "b1", "role": "assistant", "text": "hi" },
            { "id": "b2", "role": "user", "text": "hello" }
        ]);
        upsert_session(&conn, &quiet).unwrap();
        assert_eq!(list_by_project(&conn, "/tmp/a").unwrap().len(), 1);
    }

    #[test]
    fn list_scratch_finds_both_separator_spellings() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "Project")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        upsert_session(
            &conn,
            &sample("s2", "/home/u/.monocode/scratch/abc", "Scratch posix"),
        )
        .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        upsert_session(
            &conn,
            &sample("s3", "C:\\Users\\u\\.monocode\\scratch\\def", "Scratch win"),
        )
        .unwrap();
        let mut quiet = sample("s4", "/home/u/.monocode/scratch/quiet", "Quiet");
        quiet.blocks = json!([{ "id": "b1", "role": "assistant", "text": "hi" }]);
        upsert_session(&conn, &quiet).unwrap();

        let ids: Vec<String> = list_scratch(&conn)
            .unwrap()
            .into_iter()
            .map(|summary| summary.id)
            .collect();
        // Newest first; the quiet scratch chat has no user message.
        assert_eq!(ids, vec!["s3".to_string(), "s2".to_string()]);
    }

    #[test]
    fn list_scratch_carries_draft_and_automation_id() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut session = sample("s1", "/home/u/.monocode/scratch/abc", "Scratch");
        session.automation_id = Some("automation-id".into());
        session.sidebar_hidden = true;
        session.blocks = json!([{ "id": "b1", "role": "user", "text": "hello", "draft": true }]);
        upsert_session(&conn, &session).unwrap();

        let rows = list_scratch(&conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].draft);
        assert_eq!(rows[0].automation_id.as_deref(), Some("automation-id"));
        assert!(rows[0].sidebar_hidden);
    }

    #[test]
    fn draft_marker_round_trips_through_session_summaries() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut session = sample("s1", "/tmp/a", "Draft");
        session.blocks = json!([
            { "id": "b1", "role": "user", "text": "start" },
            { "id": "b2", "role": "assistant", "text": "done" },
            { "id": "b3", "role": "user", "text": "hello", "draft": true }
        ]);

        let saved = upsert_session(&conn, &session).unwrap();
        assert!(saved.draft);
        assert!(list_by_project(&conn, "/tmp/a").unwrap()[0].draft);

        session.blocks = json!([
            { "id": "b1", "role": "user", "text": "start" },
            { "id": "b2", "role": "assistant", "text": "done" },
            { "id": "b3", "role": "user", "text": "hello" }
        ]);
        let sent = upsert_session(&conn, &session).unwrap();
        assert!(!sent.draft);
        assert!(!list_by_project(&conn, "/tmp/a").unwrap()[0].draft);
    }

    #[test]
    fn migrate_creates_sessions_table() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 2",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let table: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'sessions'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(table, 1);
        let branch: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'branch'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(branch, 1);
    }

    #[test]
    fn upsert_preserves_created_at_and_updates_fields() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let first = upsert_session(&conn, &sample("s1", "/tmp/a", "First")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let mut next = sample("s1", "/tmp/a", "Updated");
        next.provider_session_id = Some("acp-session-2".into());
        next.blocks = json!([
            { "id": "b1", "role": "user", "text": "hello" },
            { "id": "b2", "role": "assistant", "text": "world" }
        ]);
        let second = upsert_session(&conn, &next).unwrap();
        assert_eq!(second.created_at, first.created_at);
        assert!(second.updated_at > first.updated_at);
        assert_eq!(second.title, "Updated");
        assert_eq!(second.provider_session_id.as_deref(), Some("acp-session-2"));
    }

    #[test]
    fn context_usage_round_trips() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut row = sample("s1", "/tmp/a", "First");
        row.context_used = Some(29_821);
        row.context_window = Some(1_000_000);
        upsert_session(&conn, &row).unwrap();
        let stored = get_session(&conn, "s1").unwrap().unwrap();
        assert_eq!(stored.context_used, Some(29_821));
        assert_eq!(stored.context_window, Some(1_000_000));
    }

    #[test]
    fn queued_messages_round_trip_and_clear_without_changing_the_transcript() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut row = sample("queued", "/tmp/a", "Conversation");
        row.queued_messages = Some(json!([
            json!({"id":"first", "text":"One", "attachments":[]}),
            json!({"id":"second", "text":"", "attachments":[{"id":"image", "kind":"image", "data":"bytes"}], "error":"Offline"}),
        ]));
        row.queue_status = Some("paused".into());
        upsert_session(&conn, &row).unwrap();
        let stored = get_session(&conn, "queued").unwrap().unwrap();
        assert_eq!(stored.queued_messages, row.queued_messages);
        assert_eq!(stored.queue_status.as_deref(), Some("paused"));
        assert_eq!(stored.blocks, row.blocks);

        row.queued_messages = None;
        row.queue_status = None;
        upsert_session(&conn, &row).unwrap();
        let stored = get_session(&conn, "queued").unwrap().unwrap();
        assert_eq!(stored.queued_messages, None);
        assert_eq!(stored.queue_status, None);
        assert_eq!(stored.blocks, row.blocks);
    }

    #[test]
    fn sidebar_visibility_round_trips_without_hiding_session_access() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let mut row = sample("hidden", "/tmp/a", "Review");
        row.sidebar_hidden = true;
        row.linked_work_item = Some(json!({"kind": "pr", "repo": "a/b", "number": 1}));
        assert!(upsert_session(&conn, &row).unwrap().sidebar_hidden);
        assert!(list_by_project(&conn, &row.cwd).unwrap()[0].sidebar_hidden);
        assert!(list_linked(&conn).unwrap()[0].sidebar_hidden);
        let stored = get_session(&conn, &row.id).unwrap().unwrap();
        assert!(stored.sidebar_hidden);
        assert_eq!(stored.blocks, row.blocks);
        row.title = "Review complete".into();
        upsert_session(&conn, &row).unwrap();
        assert!(get_session(&conn, &row.id).unwrap().unwrap().sidebar_hidden);
    }

    #[test]
    fn saved_sidechats_keep_project_identity_and_list_separately_from_project_chats() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        upsert_session(&conn, &sample("source", "/tmp/project", "Source")).unwrap();
        let mut sidechat = sample("sidechat", "/tmp/project", "Sidechat — Source");
        sidechat.sidechat = Some(SidechatMeta {
            source_session_id: "source".into(),
            source_title: "Source".into(),
            source_context: Some("bounded source snapshot".into()),
        });
        upsert_session(&conn, &sidechat).unwrap();

        let project = list_by_project(&conn, "/tmp/project").unwrap();
        assert_eq!(
            project
                .iter()
                .map(|row| row.id.as_str())
                .collect::<Vec<_>>(),
            ["source"]
        );
        let chats = list_sidechats(&conn).unwrap();
        assert_eq!(chats.len(), 1);
        assert_eq!(chats[0].id, "sidechat");
        assert_eq!(chats[0].cwd, "/tmp/project");
        assert_eq!(
            chats[0].sidechat.as_ref().unwrap().source_session_id,
            "source"
        );
        assert_eq!(chats[0].sidechat.as_ref().unwrap().source_context, None);

        let restored = get_session(&conn, "sidechat").unwrap().unwrap();
        assert_eq!(restored.cwd, "/tmp/project");
        assert_eq!(restored.sidechat, sidechat.sidechat);
        assert_eq!(
            restored.provider_session_id.as_deref(),
            Some("acp-session-1")
        );
    }

    #[test]
    fn empty_saved_sidechats_are_listed_until_archived() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let mut sidechat = sample("sidechat", "/tmp/project", "Sidechat — Source");
        sidechat.blocks = json!([]);
        sidechat.sidechat = Some(SidechatMeta {
            source_session_id: "source".into(),
            source_title: "Source".into(),
            source_context: None,
        });
        upsert_session(&conn, &sidechat).unwrap();
        let chats = list_sidechats(&conn).unwrap();
        assert_eq!(chats.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(), ["sidechat"]);
        // Empty project chats still stay out of the project list.
        assert!(list_by_project(&conn, "/tmp/project").unwrap().is_empty());
    }

    #[test]
    fn malformed_sidechat_metadata_does_not_break_session_reads_or_chats_listing() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let mut sidechat = sample("sidechat", "/tmp/project", "Sidechat");
        sidechat.sidechat = Some(SidechatMeta {
            source_session_id: "source".into(),
            source_title: "Source".into(),
            source_context: None,
        });
        upsert_session(&conn, &sidechat).unwrap();
        conn.execute(
            "UPDATE sessions SET sidechat_json = ?1 WHERE id = ?2",
            params![r#"{"sourceSessionId":17,"sourceTitle":false}"#, sidechat.id],
        )
        .unwrap();

        assert!(get_session(&conn, &sidechat.id)
            .unwrap()
            .unwrap()
            .sidechat
            .is_none());
        let chats = list_sidechats(&conn).unwrap();
        assert_eq!(chats.len(), 1);
        assert!(chats[0].sidechat.is_none());
    }

    #[test]
    fn sidebar_visibility_migration_keeps_existing_sessions_visible() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        upsert_session(&conn, &sample("existing", "/tmp/a", "Existing")).unwrap();
        conn.execute_batch(
            "DROP INDEX sessions_cwd_cover_idx;
             ALTER TABLE sessions DROP COLUMN sidebar_hidden;
             DELETE FROM schema_migrations WHERE version IN (19, 20, 21);",
        )
        .unwrap();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();
        assert!(!list_by_project(&conn, "/tmp/a").unwrap()[0].sidebar_hidden);
        assert!(
            !get_session(&conn, "existing")
                .unwrap()
                .unwrap()
                .sidebar_hidden
        );
    }

    #[test]
    fn linked_work_item_round_trips() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut row = sample("s1", "/tmp/a", "Fix PR");
        row.linked_work_item = Some(json!({
            "kind": "pr",
            "repo": "openai/codex",
            "number": 42,
            "url": "https://github.com/openai/codex/pull/42"
        }));

        let summary = upsert_session(&conn, &row).unwrap();
        assert_eq!(summary.linked_work_item, row.linked_work_item);
        let listed = list_by_project(&conn, "/tmp/a").unwrap();
        assert_eq!(listed[0].linked_work_item, row.linked_work_item);
        let stored = get_session(&conn, "s1").unwrap().unwrap();
        assert_eq!(stored.linked_work_item, row.linked_work_item);
    }

    #[test]
    fn linked_work_item_can_be_set_and_removed_without_rewriting_the_session() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "Fix PR")).unwrap();
        let linked = json!({
            "kind": "pr",
            "repo": "openai/codex",
            "number": 42,
            "url": "https://github.com/openai/codex/pull/42"
        });

        set_linked_work_item(&conn, "s1", Some(&linked)).unwrap();
        assert_eq!(
            get_session(&conn, "s1").unwrap().unwrap().linked_work_item,
            Some(linked)
        );

        set_linked_work_item(&conn, "s1", None).unwrap();
        assert_eq!(
            get_session(&conn, "s1").unwrap().unwrap().linked_work_item,
            None
        );
    }

    #[test]
    fn automation_id_round_trips() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut row = sample("s1", "/tmp/a", "Nightly review");
        row.automation_id = Some("automation-id".into());

        let summary = upsert_session(&conn, &row).unwrap();
        assert_eq!(summary.automation_id.as_deref(), Some("automation-id"));
        let listed = list_by_project(&conn, "/tmp/a").unwrap();
        assert_eq!(listed[0].automation_id.as_deref(), Some("automation-id"));
        let stored = get_session(&conn, "s1").unwrap().unwrap();
        assert_eq!(stored.automation_id.as_deref(), Some("automation-id"));
    }

    #[test]
    fn list_linked_finds_threads_across_projects() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let linked = json!({
            "kind": "pr",
            "repo": "openai/codex",
            "number": 42,
            "url": "https://github.com/openai/codex/pull/42"
        });
        let mut first = sample("s1", "/tmp/a", "First");
        first.linked_work_item = Some(linked.clone());
        let mut second = sample("s2", "/tmp/b", "Second");
        second.linked_work_item = Some(linked);
        upsert_session(&conn, &first).unwrap();
        upsert_session(&conn, &second).unwrap();
        upsert_session(&conn, &sample("s3", "/tmp/a", "Unlinked")).unwrap();

        let rows = list_linked(&conn).unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().any(|row| row.id == "s1"));
        assert!(rows.iter().any(|row| row.id == "s2"));
        assert!(rows.iter().all(|row| row.linked_work_item.is_some()));
    }

    #[test]
    fn context_usage_is_absent_until_a_harness_reports() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "First")).unwrap();
        let stored = get_session(&conn, "s1").unwrap().unwrap();
        assert_eq!(stored.context_used, None);
        assert_eq!(stored.context_window, None);
    }

    #[test]
    fn migration_v3_adds_context_columns() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 3",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn upsert_same_blocks_keeps_updated_at() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let first = upsert_session(&conn, &sample("s1", "/tmp/a", "First")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let mut next = sample("s1", "/tmp/a", "First");
        next.model = "gpt-5.4".into();
        let second = upsert_session(&conn, &next).unwrap();
        assert_eq!(second.updated_at, first.updated_at);
        assert_eq!(second.model, "gpt-5.4");
    }

    #[test]
    fn list_does_not_sum_write_preview_diffs() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut session = sample("s1", "/tmp/a", "Diffs");
        session.blocks = json!([
            { "id": "b1", "role": "user", "text": "edit it" },
            {
                "id": "b2",
                "role": "tool",
                "text": "",
                "tool": {
                    "preview": {
                        "kind": "write",
                        "path": "src/a.ts",
                        "additions": 12,
                        "deletions": 3
                    }
                }
            }
        ]);
        let summary = upsert_session(&conn, &session).unwrap();
        assert_eq!(summary.additions, 0);
        assert_eq!(summary.deletions, 0);
        let listed = list_by_project(&conn, "/tmp/a").unwrap();
        assert_eq!(listed[0].additions, 0);
        assert_eq!(listed[0].deletions, 0);
    }

    #[test]
    fn list_by_project_filters_and_orders() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "A1")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        upsert_session(&conn, &sample("s2", "/tmp/a", "A2")).unwrap();
        upsert_session(&conn, &sample("s3", "/tmp/b", "B1")).unwrap();
        let mut empty = sample("s4", "/tmp/a", "Empty");
        empty.blocks = json!([]);
        upsert_session(&conn, &empty).unwrap();
        let listed = list_by_project(&conn, "/tmp/a").unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].id, "s2");
        assert_eq!(listed[1].id, "s1");
    }

    #[test]
    fn delete_removes_session() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "First")).unwrap();
        delete_session(&conn, "s1").unwrap();
        assert!(get_session(&conn, "s1").unwrap().is_none());
        assert!(list_by_project(&conn, "/tmp/a").unwrap().is_empty());
    }

    #[test]
    fn deleting_a_lead_releases_current_and_earlier_workers() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        for id in ["lead", "earlier", "current", "other-lead", "other-worker"] {
            let mut session = sample(id, "/tmp/a", id);
            session.linked_work_item = Some(json!({"kind": "pr", "number": 1}));
            if ["earlier", "current"].contains(&id) {
                session.blocks = json!([{"id":"u","role":"user","text":"Keep this transcript","orchestrationLeadId":"lead"}]);
            }
            upsert_session(&conn, &session).unwrap();
        }
        save_orchestration(
            &conn,
            "lead",
            &json!({"status":"stopped","tasks":[{"id":"task","sessionId":"current"}]}),
        )
        .unwrap();
        let other =
            json!({"status":"active","tasks":[{"id":"other-task","sessionId":"other-worker"}]});
        save_orchestration(&conn, "other-lead", &other).unwrap();
        delete_session(&conn, "lead").unwrap();

        for id in ["earlier", "current"] {
            let worker = get_session(&conn, id).unwrap().unwrap();
            assert!(worker.orchestration_lead_id.is_none());
            assert!(worker.blocks[0].get("orchestrationLeadId").is_none());
            assert_eq!(worker.blocks[0]["text"], "Keep this transcript");
            assert!(list_by_project(&conn, "/tmp/a")
                .unwrap()
                .iter()
                .any(|row| row.id == id));
            assert!(list_linked(&conn).unwrap().iter().any(|row| row.id == id));
        }
        assert!(orchestration_summary(&conn, "lead").unwrap().is_none());
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM orchestration_runs WHERE lead_id = 'lead'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
        assert_eq!(
            worker_parent(&conn, "other-worker").unwrap().as_deref(),
            Some("other-lead")
        );
        let raw: String = conn
            .query_row(
                "SELECT state FROM orchestration_runs WHERE lead_id = 'other-lead'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(serde_json::from_str::<Value>(&raw).unwrap(), other);
        migrate(&conn).unwrap();
        assert!(worker_parent(&conn, "current").unwrap().is_none());
    }

    #[test]
    fn deleting_a_worker_prunes_parent_state_and_does_not_release_dependencies() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        for id in ["lead", "worker", "dependent", "earlier"] {
            upsert_session(&conn, &sample(id, "/tmp/a", id)).unwrap();
        }
        remember_worker(&conn, "earlier", "lead").unwrap();
        save_orchestration(
            &conn,
            "lead",
            &json!({"status":"active", "requests":{"old":{"result":"worker"}}, "tasks":[
                {"id":"task", "sessionId":"worker", "status":"running", "dependsOn":[]},
                {"id":"next", "sessionId":"dependent", "status":"queued", "dependsOn":["task"]}
            ]}),
        )
        .unwrap();
        delete_session(&conn, "worker").unwrap();
        assert!(get_session(&conn, "worker").unwrap().is_none());
        assert!(worker_parent(&conn, "worker").unwrap().is_none());
        assert_eq!(
            worker_parent(&conn, "earlier").unwrap().as_deref(),
            Some("lead")
        );
        let raw: String = conn
            .query_row(
                "SELECT state FROM orchestration_runs WHERE lead_id = 'lead'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let run: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(run["status"], "stopped");
        assert_eq!(run["requests"], json!({}));
        assert_eq!(run["tasks"].as_array().unwrap().len(), 1);
        assert_eq!(run["tasks"][0]["sessionId"], "dependent");
        assert_eq!(run["tasks"][0]["status"], "cancelled");
        assert_eq!(run["tasks"][0]["dependsOn"], json!([]));
        let summary = orchestration_summary(&conn, "lead").unwrap().unwrap();
        assert_eq!(summary["tasks"].as_array().unwrap().len(), 1);
        assert_eq!(summary["tasks"][0]["sessionId"], "dependent");
        assert_eq!(summary["tasks"][0]["status"], "cancelled");
    }

    #[test]
    fn failed_session_deletion_rolls_back_orchestration_cleanup() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        for id in ["lead", "worker"] {
            upsert_session(&conn, &sample(id, "/tmp/a", id)).unwrap();
        }
        save_orchestration(
            &conn,
            "lead",
            &json!({"status":"stopped", "tasks":[{"id":"task", "sessionId":"worker"}]}),
        )
        .unwrap();
        conn.execute_batch("CREATE TRIGGER reject_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'test failure'); END;").unwrap();
        for id in ["lead", "worker"] {
            assert!(delete_session(&conn, id).is_err());
            assert!(get_session(&conn, id).unwrap().is_some());
            assert_eq!(
                worker_parent(&conn, "worker").unwrap().as_deref(),
                Some("lead")
            );
            assert_eq!(
                orchestration_summary(&conn, "lead").unwrap().unwrap()["tasks"][0]["sessionId"],
                "worker"
            );
        }
    }

    #[test]
    fn migration_v6_adds_archived_column() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 6",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let archived: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'archived'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(archived, 1);
    }

    #[test]
    fn migration_v7_adds_worktree_cwd_column() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 7",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let column: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'worktree_cwd'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(column, 1);
    }

    #[test]
    fn removed_worktree_state_round_trips_and_can_be_reselected() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut session = sample("s1", "/tmp/a", "First");
        session.worktree_cwd = Some("/tmp/a-worktrees/feature".into());
        session.worktree_removed = true;
        session.branch = Some("stale-branch".into());
        let summary = upsert_session(&conn, &session).unwrap();
        assert!(summary.worktree_removed);
        assert!(summary.branch.is_none());
        let listed = list_by_project(&conn, "/tmp/a").unwrap();
        assert!(listed[0].worktree_removed);
        assert!(listed[0].branch.is_none());
        let restored = get_session(&conn, "s1").unwrap().unwrap();
        assert!(restored.worktree_removed);
        assert_eq!(restored.blocks, session.blocks);
        session.worktree_removed = false;
        session.worktree_cwd = None;
        session.branch = Some("main".into());
        upsert_session(&conn, &session).unwrap();
        let restored = get_session(&conn, "s1").unwrap().unwrap();
        assert!(!restored.worktree_removed);
        assert_eq!(restored.branch.as_deref(), Some("main"));
    }

    #[test]
    fn archive_round_trips_and_survives_upsert() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "First")).unwrap();
        set_archived(&conn, "s1", true).unwrap();
        let listed = list_by_project(&conn, "/tmp/a").unwrap();
        assert!(listed[0].archived);
        let mut next = sample("s1", "/tmp/a", "Updated");
        next.blocks = json!([
            { "id": "b1", "role": "user", "text": "hello" },
            { "id": "b2", "role": "assistant", "text": "world" }
        ]);
        let summary = upsert_session(&conn, &next).unwrap();
        assert!(summary.archived);
        assert_eq!(summary.title, "Updated");
        set_archived(&conn, "s1", false).unwrap();
        let listed = list_by_project(&conn, "/tmp/a").unwrap();
        assert!(!listed[0].archived);
    }

    #[test]
    fn migration_v11_adds_pinned_column() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 11",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let pinned: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'pinned'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(pinned, 1);
    }

    #[test]
    fn pin_round_trips_and_survives_upsert() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "First")).unwrap();
        set_pinned(&conn, "s1", true).unwrap();
        let listed = list_by_project(&conn, "/tmp/a").unwrap();
        assert!(listed[0].pinned);
        let mut next = sample("s1", "/tmp/a", "Updated");
        next.blocks = json!([
            { "id": "b1", "role": "user", "text": "hello" },
            { "id": "b2", "role": "assistant", "text": "world" }
        ]);
        let summary = upsert_session(&conn, &next).unwrap();
        assert!(summary.pinned);
        assert_eq!(summary.title, "Updated");
        set_pinned(&conn, "s1", false).unwrap();
        let listed = list_by_project(&conn, "/tmp/a").unwrap();
        assert!(!listed[0].pinned);
    }

    #[test]
    fn get_round_trips_blocks_provider_session_and_account() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut session = sample("s1", "/tmp/a", "First");
        session.provider_account_id = Some("account-work".into());
        upsert_session(&conn, &session).unwrap();
        let record = get_session(&conn, "s1").unwrap().unwrap();
        assert_eq!(record.id, "s1");
        assert_eq!(record.provider_session_id.as_deref(), Some("acp-session-1"));
        assert_eq!(record.provider_account_id.as_deref(), Some("account-work"));
        assert_eq!(record.model_settings["thinking"], "high");
        assert_eq!(record.blocks.as_array().unwrap().len(), 1);
        assert_eq!(record.blocks[0]["text"], "hello");
    }

    #[test]
    fn upsert_snapshots_git_branch() {
        let dir = std::env::temp_dir().join(format!(
            "monocode-session-git-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let init = std::process::Command::new("git")
            .args(["init"])
            .current_dir(&dir)
            .output();
        let Ok(init) = init else {
            let _ = std::fs::remove_dir_all(&dir);
            return;
        };
        if !init.status.success() {
            let _ = std::fs::remove_dir_all(&dir);
            return;
        }
        let head = std::process::Command::new("git")
            .args(["symbolic-ref", "HEAD", "refs/heads/fix-sidebar"])
            .current_dir(&dir)
            .status();
        if head.map(|status| !status.success()).unwrap_or(true) {
            let _ = std::fs::remove_dir_all(&dir);
            return;
        }
        let origin = std::process::Command::new("git")
            .args([
                "remote",
                "add",
                "origin",
                "https://github.com/acme/widget.git",
            ])
            .current_dir(&dir)
            .status();
        if origin.map(|status| !status.success()).unwrap_or(true) {
            let _ = std::fs::remove_dir_all(&dir);
            return;
        }

        let cwd = dir.to_string_lossy().into_owned();
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let summary = upsert_session(&conn, &sample("s1", &cwd, "First")).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(summary.branch.as_deref(), Some("fix-sidebar"));
        assert_eq!(summary.repo.as_deref(), Some("widget"));
    }

    #[test]
    fn upsert_keeps_session_branch_and_worktree() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut session = sample("s1", "/tmp/a", "First");
        session.branch = Some("feat/picker".into());
        session.worktree_cwd = Some("/tmp/a-feat".into());
        let summary = upsert_session(&conn, &session).unwrap();
        assert_eq!(summary.branch.as_deref(), Some("feat/picker"));
        assert_eq!(summary.worktree_cwd.as_deref(), Some("/tmp/a-feat"));
        let record = get_session(&conn, "s1").unwrap().unwrap();
        assert_eq!(record.branch.as_deref(), Some("feat/picker"));
        assert_eq!(record.worktree_cwd.as_deref(), Some("/tmp/a-feat"));
        let listed = list_by_project(&conn, "/tmp/a").unwrap();
        assert_eq!(listed[0].branch.as_deref(), Some("feat/picker"));
        assert_eq!(listed[0].worktree_cwd.as_deref(), Some("/tmp/a-feat"));
    }

    #[test]
    fn rebase_project_moves_saved_sessions_to_the_renamed_path() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("moved", "/tmp/old", "Moved")).unwrap();
        upsert_session(&conn, &sample("other", "/tmp/other", "Other")).unwrap();

        rebase_project(&conn, "/tmp/old", "/tmp/new").unwrap();

        assert!(list_by_project(&conn, "/tmp/old").unwrap().is_empty());
        assert_eq!(list_by_project(&conn, "/tmp/new").unwrap()[0].id, "moved");
        assert_eq!(list_by_project(&conn, "/tmp/other").unwrap()[0].id, "other");
    }

    #[test]
    fn migration_v4_creates_in_flight_table() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 4",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let table: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'in_flight_sessions'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(table, 1);
    }

    #[test]
    fn in_flight_set_take_is_ordered_and_destructive() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.conn.lock().unwrap();
        replace_in_flight(
            &mut conn,
            &[
                InFlightSession {
                    session_id: "s2".into(),
                    cwd: "/tmp/b".into(),
                },
                InFlightSession {
                    session_id: "s1".into(),
                    cwd: "/tmp/a".into(),
                },
            ],
        )
        .unwrap();
        let first = take_in_flight(&mut conn).unwrap();
        assert_eq!(first.len(), 2);
        assert_eq!(first[0].session_id, "s2");
        assert_eq!(first[0].cwd, "/tmp/b");
        assert_eq!(first[1].session_id, "s1");
        let second = take_in_flight(&mut conn).unwrap();
        assert!(second.is_empty());
    }

    #[test]
    fn in_flight_list_does_not_clear() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.conn.lock().unwrap();
        replace_in_flight(
            &mut conn,
            &[InFlightSession {
                session_id: "s1".into(),
                cwd: "/tmp/a".into(),
            }],
        )
        .unwrap();
        let listed = list_in_flight(&conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].session_id, "s1");
        let listed_again = list_in_flight(&conn).unwrap();
        assert_eq!(listed_again.len(), 1);
    }

    #[test]
    fn in_flight_replace_clears_previous() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.conn.lock().unwrap();
        replace_in_flight(
            &mut conn,
            &[InFlightSession {
                session_id: "old".into(),
                cwd: "/tmp/old".into(),
            }],
        )
        .unwrap();
        replace_in_flight(&mut conn, &[]).unwrap();
        assert!(take_in_flight(&mut conn).unwrap().is_empty());
    }

    #[test]
    fn migration_v5_creates_workspace_snapshot_table() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 5",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let table: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'workspace_snapshot'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(table, 1);
    }

    #[test]
    fn workspace_snapshot_round_trips_and_replaces() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        set_workspace_snapshot(&conn, r#"{"tabs":[{"id":"t1"}]}"#).unwrap();
        let first = get_workspace_snapshot(&conn).unwrap().unwrap();
        assert!(first.contains("t1"));
        set_workspace_snapshot(&conn, r#"{"tabs":[{"id":"t2"}]}"#).unwrap();
        let second = get_workspace_snapshot(&conn).unwrap().unwrap();
        assert!(second.contains("t2"));
        assert!(!second.contains("t1"));
    }

    #[test]
    fn migrate_creates_workspace_tables_when_versions_already_recorded() {
        let path = std::env::temp_dir().join(format!(
            "monocode-stale-migrations-{}-{}.db",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE schema_migrations (
                   version INTEGER PRIMARY KEY,
                   applied_at INTEGER NOT NULL
                 );
                 CREATE TABLE sessions (
                   id TEXT PRIMARY KEY,
                   cwd TEXT NOT NULL,
                   harness TEXT NOT NULL,
                   model TEXT NOT NULL,
                   model_settings TEXT NOT NULL DEFAULT '{}',
                   runtime_mode TEXT NOT NULL,
                   title TEXT NOT NULL,
                   provider_session_id TEXT,
                   blocks_json TEXT NOT NULL DEFAULT '[]',
                   created_at INTEGER NOT NULL,
                   updated_at INTEGER NOT NULL
                 );
                 INSERT INTO schema_migrations (version, applied_at)
                   VALUES (1, 1), (2, 1), (3, 1), (4, 1), (5, 1);",
            )
            .unwrap();
        }
        let store = SessionStore::open(path.clone()).unwrap();
        let conn = store.conn.lock().unwrap();
        let inflight: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'in_flight_sessions'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let snapshot: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'workspace_snapshot'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        drop(conn);
        drop(store);
        let _ = std::fs::remove_file(&path);
        assert_eq!(inflight, 1);
        assert_eq!(snapshot, 1);
    }

    #[test]
    fn migrate_restores_the_covering_index_when_versions_already_recorded() {
        let path = std::env::temp_dir().join(format!(
            "monocode-stale-index-{}-{}.db",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            // A database that claims every version but carries none of the
            // columns or indexes those versions describe.
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE schema_migrations (
                   version INTEGER PRIMARY KEY,
                   applied_at INTEGER NOT NULL
                 );
                 CREATE TABLE sessions (
                   id TEXT PRIMARY KEY,
                   cwd TEXT NOT NULL,
                   harness TEXT NOT NULL,
                   model TEXT NOT NULL,
                   model_settings TEXT NOT NULL DEFAULT '{}',
                   runtime_mode TEXT NOT NULL,
                   title TEXT NOT NULL,
                   provider_session_id TEXT,
                   blocks_json TEXT NOT NULL DEFAULT '[]',
                   created_at INTEGER NOT NULL,
                   updated_at INTEGER NOT NULL
                 );
                 INSERT INTO schema_migrations (version, applied_at)
                   VALUES (1, 1), (2, 1), (3, 1), (4, 1), (5, 1), (6, 1), (7, 1),
                          (8, 1), (9, 1), (10, 1), (11, 1), (12, 1), (13, 1),
                          (14, 1), (15, 1), (16, 1), (17, 1), (18, 1);",
            )
            .unwrap();
        }
        let store = SessionStore::open(path.clone()).unwrap();
        let conn = store.conn.lock().unwrap();
        let index: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index'
                   AND name = 'sessions_cwd_cover_idx'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(index, 1);
        upsert_session(&conn, &sample("s1", "/tmp/a", "Restored index")).unwrap();
        let result = search_sessions(
            &conn,
            &SessionSearchOptions {
                query: "Restored".into(),
                cwd: None,
                include_archived: false,
                search_owner: String::new(),
            },
        )
        .expect("unscoped search must not fail when the index was restored");
        assert!(result
            .hits
            .iter()
            .any(|hit| hit.session_id == "s1" && hit.kind == "conversation"));
        drop(conn);
        drop(store);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn session_search_uses_a_query_only_read_connection() {
        let path = std::env::temp_dir().join(format!(
            "monocode-session-read-conn-{}-{}.db",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let store = SessionStore::open(path.clone()).unwrap();
        upsert_session(
            &store.conn.lock().unwrap(),
            &sample("s1", "/tmp/a", "Searchable title"),
        )
        .unwrap();

        let read_conn = store.read_conn.lock().unwrap();
        let conn = read_conn.as_ref().unwrap();
        let result = search_sessions_with_connection(
            conn,
            &SessionSearchOptions {
                query: "Searchable".into(),
                cwd: None,
                include_archived: false,
                search_owner: String::new(),
            },
            None,
        )
        .unwrap();

        assert!(result.hits.iter().any(|hit| hit.session_id == "s1"));
        assert!(conn
            .execute("UPDATE sessions SET title = 'nope' WHERE id = 's1'", [])
            .is_err());
        drop(read_conn);
        drop(store);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn oversized_transcript_keeps_title_hit_without_hiding_older_messages() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut small = sample("small", "/tmp/a", "Needle title");
        small.blocks = json!([{ "id": "small", "role": "user", "text": "needle" }]);
        upsert_session(&conn, &small).unwrap();
        let mut huge = sample("huge", "/tmp/a", "Needle title");
        huge.blocks = json!([{
            "id": "huge",
            "role": "user",
            "text": "needle ".repeat(1_500_000),
        }]);
        upsert_session(&conn, &huge).unwrap();
        conn.execute("UPDATE sessions SET updated_at = 1 WHERE id = 'small'", [])
            .unwrap();
        conn.execute("UPDATE sessions SET updated_at = 2 WHERE id = 'huge'", [])
            .unwrap();

        let result = search_sessions(
            &conn,
            &SessionSearchOptions {
                query: "needle".into(),
                cwd: None,
                include_archived: false,
                search_owner: String::new(),
            },
        )
        .unwrap();

        assert!(result.truncated);
        assert!(result
            .hits
            .iter()
            .any(|hit| hit.session_id == "huge" && hit.kind == "conversation"));
        assert!(!result
            .hits
            .iter()
            .any(|hit| hit.session_id == "huge" && hit.kind == "message"));
        assert!(result
            .hits
            .iter()
            .any(|hit| hit.session_id == "small" && hit.kind == "message"));
    }

    #[test]
    fn session_search_without_a_cwd_avoids_the_sessions_table() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let sql = format!("EXPLAIN QUERY PLAN {}", search_sessions_sql(false, false));
        let mut statement = conn.prepare(&sql).unwrap();
        let plan: Vec<String> = statement
            .query_map(
                params!["%needle%", MAX_SEARCH_BUFFER_BYTES as i64, 401i64],
                |row| row.get::<_, String>(3),
            )
            .unwrap()
            .map(|row| row.unwrap())
            .collect();
        assert!(plan
            .iter()
            .any(|step| step.contains("USING INDEX sessions_cwd_cover_idx")));
        for step in &plan {
            if step.contains("sessions") {
                assert!(step.contains("USING INDEX"), "table access: {step}");
            }
        }
    }

    #[test]
    fn a_new_session_search_supersedes_the_same_owner() {
        let owner = "session-search-owner-test";
        let first = begin_session_search(owner).unwrap();
        assert!(first.is_current());
        let second = begin_session_search(owner).unwrap();
        assert!(!first.is_current());
        assert!(second.is_current());
        cancel_owned_session_search(owner);
        assert!(!second.is_current());
    }

    #[test]
    fn a_completed_session_search_releases_its_token() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "Needle title")).unwrap();
        drop(conn);
        let owner = "completed-session-search-owner";

        let result = search_store(
            &store,
            &SessionSearchOptions {
                query: "Needle".into(),
                cwd: None,
                include_archived: false,
                search_owner: owner.into(),
            },
        )
        .unwrap();

        assert!(result
            .hits
            .iter()
            .any(|hit| hit.session_id == "s1" && hit.kind == "conversation"));
        assert!(!session_search_token_registered(owner));
    }

    #[test]
    fn a_superseded_session_search_does_not_release_the_newer_token() {
        let owner = "superseded-release-owner";
        let first = begin_session_search(owner).unwrap();
        let second = begin_session_search(owner).unwrap();

        end_session_search(Some(&first));

        assert!(session_search_token_registered(owner));
        assert!(!first.is_current());
        assert!(second.is_current());
        cancel_owned_session_search(owner);
    }

    #[test]
    fn cancelling_one_session_search_does_not_cancel_another() {
        let first = begin_session_search("first-session-owner").unwrap();
        let second = begin_session_search("second-session-owner").unwrap();

        cancel_owned_session_search("first-session-owner");

        assert!(!first.is_current());
        assert!(second.is_current());
    }

    #[test]
    fn a_superseded_session_search_returns_no_hits() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "Searchable title")).unwrap();
        let owner = "superseded-session-search-test";
        let stale = begin_session_search(owner).unwrap();
        begin_session_search(owner);
        let options = SessionSearchOptions {
            query: "Searchable".into(),
            cwd: None,
            include_archived: false,
            search_owner: owner.into(),
        };

        let result = search_sessions_with_connection(&conn, &options, Some(&stale)).unwrap();

        assert!(result.hits.is_empty());
        assert!(!result.truncated);
        // The progress handler belongs to the search, not the shared connection.
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
        cancel_owned_session_search(owner);
    }

    #[test]
    fn a_failed_session_search_releases_its_token() {
        let store = SessionStore::open_in_memory().unwrap();
        // Point the read connection at a database with no schema, so the search
        // fails inside SQLite. That error return is the path that used to skip
        // the release, and `SearchView` swallows the rejection.
        *store.read_conn.lock().unwrap() = Some(Connection::open_in_memory().unwrap());
        let owner = "failed-session-search-owner";

        let error = search_store(
            &store,
            &SessionSearchOptions {
                query: "Needle".into(),
                cwd: None,
                include_archived: false,
                search_owner: owner.into(),
            },
        );

        assert!(error.is_err(), "a search with no schema must fail");
        assert!(!session_search_token_registered(owner));
    }

    #[test]
    fn a_test_helper_session_search_releases_its_token() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "Needle title")).unwrap();
        let owner = "helper-session-search-owner";

        let result = search_sessions(
            &conn,
            &SessionSearchOptions {
                query: "Needle".into(),
                cwd: None,
                include_archived: false,
                search_owner: owner.into(),
            },
        )
        .unwrap();

        assert!(result
            .hits
            .iter()
            .any(|hit| hit.session_id == "s1" && hit.kind == "conversation"));
        assert!(!session_search_token_registered(owner));
    }

    #[test]
    fn search_uses_top_level_user_blocks_for_the_materialized_filter() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut session = sample("s1", "/tmp/a", "Unrelated title");
        session.blocks = json!([
            { "id": "t1", "role": "tool", "text": "wrapper", "tool": {
                "preview": { "output": "nested role: user needle" }
            } }
        ]);
        upsert_session(&conn, &session).unwrap();

        let result = search_sessions(
            &conn,
            &SessionSearchOptions {
                query: "needle".into(),
                cwd: None,
                include_archived: false,
                search_owner: String::new(),
            },
        )
        .unwrap();

        assert!(result.hits.is_empty());
    }

    #[test]
    fn search_finds_title_and_message_hits() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut session = sample("s1", "/tmp/a", "Fix sidebar search");
        session.blocks = json!([
            { "id": "u1", "role": "user", "text": "Please search the sidebar filter chips" },
            { "id": "a1", "role": "assistant", "text": "I will look through the explorer next." }
        ]);
        upsert_session(&conn, &session).unwrap();
        upsert_session(&conn, &sample("s2", "/tmp/b", "Unrelated title")).unwrap();

        let result = search_sessions(
            &conn,
            &SessionSearchOptions {
                query: "sidebar".into(),
                cwd: None,
                include_archived: false,
                search_owner: String::new(),
            },
        )
        .unwrap();
        let kinds: Vec<_> = result
            .hits
            .iter()
            .map(|hit| {
                (
                    hit.kind.as_str(),
                    hit.session_id.as_str(),
                    hit.block_id.as_deref(),
                )
            })
            .collect();
        assert!(kinds.contains(&("conversation", "s1", None)));
        assert!(kinds.contains(&("message", "s1", Some("u1"))));
        assert!(!result.hits.iter().any(|hit| hit.session_id == "s2"));
    }

    #[test]
    fn search_skips_inbox_ask_sessions_when_scoped_and_unscoped() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("ask", "/tmp/a", "Needle ask")).unwrap();
        upsert_session(&conn, &sample("chat", "/tmp/a", "Needle chat")).unwrap();
        conn.execute("UPDATE sessions SET inbox_ask = '{}' WHERE id = 'ask'", [])
            .unwrap();

        for cwd in [None, Some("/tmp/a".to_string())] {
            let result = search_sessions(
                &conn,
                &SessionSearchOptions {
                    query: "Needle".into(),
                    cwd,
                    include_archived: false,
                    search_owner: String::new(),
                },
            )
            .unwrap();
            assert!(result.hits.iter().all(|hit| hit.session_id == "chat"));
        }
    }

    #[test]
    fn search_respects_cwd_and_skips_archived() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "Search project a")).unwrap();
        upsert_session(&conn, &sample("s2", "/tmp/b", "Search project b")).unwrap();
        set_archived(&conn, "s1", true).unwrap();

        let scoped = search_sessions(
            &conn,
            &SessionSearchOptions {
                query: "Search project".into(),
                cwd: Some("/tmp/a".into()),
                include_archived: false,
                search_owner: String::new(),
            },
        )
        .unwrap();
        assert!(scoped.hits.is_empty());

        let with_archived = search_sessions(
            &conn,
            &SessionSearchOptions {
                query: "Search project".into(),
                cwd: Some("/tmp/a".into()),
                include_archived: true,
                search_owner: String::new(),
            },
        )
        .unwrap();
        assert!(with_archived
            .hits
            .iter()
            .any(|hit| hit.session_id == "s1" && hit.kind == "conversation"));

        let other = search_sessions(
            &conn,
            &SessionSearchOptions {
                query: "Search project".into(),
                cwd: Some("/tmp/b".into()),
                include_archived: false,
                search_owner: String::new(),
            },
        )
        .unwrap();
        assert!(other.hits.iter().any(|hit| hit.session_id == "s2"));
    }

    #[test]
    fn search_empty_query_is_empty() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s1", "/tmp/a", "Anything")).unwrap();
        let result = search_sessions(
            &conn,
            &SessionSearchOptions {
                query: "   ".into(),
                cwd: None,
                include_archived: false,
                search_owner: String::new(),
            },
        )
        .unwrap();
        assert!(result.hits.is_empty());
        assert!(!result.truncated);
    }

    #[test]
    fn windows_search_keeps_legacy_paths_and_bounded_transcripts() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        for (id, cwd) in [
            ("legacy", r"E:\Projects\MonoCode"),
            ("current", "E:/Projects/MonoCode"),
            ("lower-drive", "e:/Projects/MonoCode"),
            ("other", "E:/Projects/Other"),
        ] {
            upsert_session(&conn, &sample(id, cwd, "Needle title")).unwrap();
        }
        let mut huge = sample("huge", r"E:\Projects\MonoCode", "Needle title");
        huge.blocks = json!([{
            "id": "huge-block", "role": "user", "text": "needle ".repeat(1_500_000)
        }]);
        upsert_session(&conn, &huge).unwrap();
        let result = search_sessions_with_connection_for_platform(
            &conn,
            &SessionSearchOptions {
                query: "needle".into(),
                cwd: Some("E:/Projects/MonoCode/".into()),
                include_archived: false,
                search_owner: String::new(),
            },
            None,
            true,
            false,
        )
        .unwrap();
        let ids: Vec<_> = result
            .hits
            .iter()
            .filter(|hit| hit.kind == "conversation")
            .map(|hit| hit.session_id.as_str())
            .collect();
        assert_eq!(ids.len(), 4);
        for id in ["legacy", "current", "lower-drive", "huge"] {
            assert!(ids.contains(&id), "missing session {id}");
        }
        assert!(result.truncated);
        assert!(!result
            .hits
            .iter()
            .any(|hit| { hit.session_id == "huge" && hit.kind == "message" }));
    }

    #[test]
    fn windows_search_falls_back_to_case_insensitive_paths() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(
            &conn,
            &sample("legacy-case", r"e:\projects\MONOCODE", "Needle title"),
        )
        .unwrap();
        let options = SessionSearchOptions {
            query: "needle".into(),
            cwd: Some("E:/Projects/MonoCode".into()),
            include_archived: false,
            search_owner: String::new(),
        };
        let windows =
            search_sessions_with_connection_for_platform(&conn, &options, None, true, false)
                .unwrap();
        assert!(windows
            .hits
            .iter()
            .any(|hit| hit.session_id == "legacy-case"));
        let unix =
            search_sessions_with_connection_for_platform(&conn, &options, None, false, false)
                .unwrap();
        assert!(unix.hits.is_empty());
    }

    #[test]
    fn recorded_upstream_v18_repairs_queue_fields_without_losing_sessions() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut original = sample("existing", "/tmp/project", "Keep this session");
        original.automation_id = Some("automation-1".into());
        upsert_session(&conn, &original).unwrap();
        // Upstream v18 has the same version number but no local queue columns.
        conn.execute_batch(
            "ALTER TABLE sessions DROP COLUMN queued_messages_json;
             ALTER TABLE sessions DROP COLUMN queue_status;",
        )
        .unwrap();
        migrate(&conn).unwrap();
        let restored = get_session(&conn, "existing").unwrap().unwrap();
        assert_eq!(restored.title, "Keep this session");
        assert_eq!(restored.automation_id.as_deref(), Some("automation-1"));
        original.queued_messages = Some(json!([{"id": "q1", "text": "next task"}]));
        original.queue_status = Some("held".into());
        upsert_session(&conn, &original).unwrap();
        migrate(&conn).unwrap();
        let saved = get_session(&conn, "existing").unwrap().unwrap();
        assert_eq!(saved.queued_messages, original.queued_messages);
        assert_eq!(saved.queue_status.as_deref(), Some("held"));
        assert_eq!(saved.automation_id.as_deref(), Some("automation-1"));
    }

    #[test]
    fn migration_v12_adds_queued_messages_column() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 12",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let column: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'queued_messages_json'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(column, 1);
        let status_column: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'queue_status'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status_column, 1);
    }

    #[test]
    fn queued_messages_round_trip_and_clear() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut row = sample("s1", "/tmp/a", "First");
        row.queue_status = Some("held".into());
        row.queued_messages = Some(json!([
            { "id": "q1", "text": "follow up", "attachments": [] },
            { "id": "q2", "text": "another", "attachments": [] },
        ]));
        upsert_session(&conn, &row).unwrap();
        let stored = get_session(&conn, "s1").unwrap().unwrap();
        assert_eq!(
            stored.queued_messages,
            Some(json!([
                { "id": "q1", "text": "follow up", "attachments": [] },
                { "id": "q2", "text": "another", "attachments": [] },
            ]))
        );
        assert_eq!(stored.queue_status.as_deref(), Some("held"));
        // An empty queue clears the column instead of storing `[]`.
        let mut cleared = sample("s1", "/tmp/a", "First");
        cleared.blocks = row.blocks.clone();
        upsert_session(&conn, &cleared).unwrap();
        let stored = get_session(&conn, "s1").unwrap().unwrap();
        assert_eq!(stored.queued_messages, None);
        assert_eq!(stored.queue_status, None);
    }

    #[test]
    fn queued_messages_corrupt_json_degrades_gracefully() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut row = sample("s1", "/tmp/a", "First");
        row.queue_status = Some("held".into());
        row.queued_messages = Some(json!([
            { "id": "q1", "text": "follow up", "attachments": [] },
        ]));
        upsert_session(&conn, &row).unwrap();

        conn.execute(
            "UPDATE sessions SET queued_messages_json = 'not-valid-json{{{' WHERE id = 's1'",
            [],
        )
        .unwrap();

        let stored = get_session(&conn, "s1").unwrap().unwrap();
        assert_eq!(stored.title, "First");
        assert_eq!(stored.blocks, row.blocks);
        assert_eq!(stored.queued_messages, None);
        assert_eq!(stored.queue_status, None);
    }

    #[test]
    fn queued_messages_reject_unknown_status() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        let mut row = sample("s1", "/tmp/a", "First");
        row.queue_status = Some("steering".into());
        row.queued_messages = Some(json!([
            { "id": "q1", "text": "follow up", "attachments": [] },
        ]));

        upsert_session(&conn, &row).unwrap();

        let stored = get_session(&conn, "s1").unwrap().unwrap();
        assert_eq!(stored.queue_status, None);
    }

    #[test]
    fn fresh_schema_reaches_version_21_and_has_all_columns_and_index() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();

        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 21);

        for column in [
            "linked_work_item_json",
            "queued_messages_json",
            "queue_status",
            "sidechat_json",
            "is_sidechat",
        ] {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = ?1",
                    params![column],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "Missing expected session column: {column}");
        }

        let index_sql: String = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'sessions_cwd_cover_idx'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(index_sql.contains("linked_work_item_json"));
        assert!(index_sql.contains("is_sidechat"));
        assert!(!index_sql.contains("sidechat_json"));
        assert!(!index_sql.contains("queued_messages_json"));
        assert!(!index_sql.contains("queue_status"));
    }

    #[test]
    fn upstream_v13_database_upgrades_to_v21_and_gains_queue_columns() {
        let path = std::env::temp_dir().join(format!(
            "monocode-upgrade-v13-to-v14-{}-{}.db",
            std::process::id(),
            now_millis()
        ));
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                r#"CREATE TABLE schema_migrations (
                   version INTEGER PRIMARY KEY,
                   applied_at INTEGER NOT NULL
                 );
                 CREATE TABLE sessions (
                   id TEXT PRIMARY KEY,
                   cwd TEXT NOT NULL,
                   harness TEXT NOT NULL,
                   model TEXT NOT NULL,
                   model_settings TEXT NOT NULL DEFAULT '{}',
                   runtime_mode TEXT NOT NULL,
                   title TEXT NOT NULL,
                   provider_session_id TEXT,
                   blocks_json TEXT NOT NULL DEFAULT '[]',
                   created_at INTEGER NOT NULL,
                   updated_at INTEGER NOT NULL,
                   context_used INTEGER,
                   context_window INTEGER,
                   branch TEXT,
                   worktree_cwd TEXT,
                   has_user_message INTEGER NOT NULL DEFAULT 0,
                   pinned INTEGER NOT NULL DEFAULT 0,
                   archived INTEGER NOT NULL DEFAULT 0,
                   inbox_ask TEXT,
                   linked_work_item_json TEXT
                 );
                 CREATE INDEX sessions_cwd_cover_idx
                   ON sessions (cwd, has_user_message, updated_at DESC, id, harness,
                                model, runtime_mode, title, provider_session_id,
                                created_at, branch, archived, pinned,
                                linked_work_item_json);
                 INSERT INTO schema_migrations (version, applied_at)
                   VALUES (1, 1), (2, 1), (3, 1), (4, 1), (5, 1), (6, 1),
                          (7, 1), (8, 1), (9, 1), (10, 1), (11, 1), (12, 1), (13, 1);
                 INSERT INTO sessions (
                   id, cwd, harness, model, runtime_mode, title, created_at, updated_at,
                   has_user_message, linked_work_item_json
                 ) VALUES (
                   'upstream-s1', '/tmp/proj', 'cursor', 'gpt-5', 'supervised', 'Upstream task',
                   100, 200, 1, '{"kind":"pr","number":42}'
                 );"#,
            )
            .unwrap();
        }

        let store = SessionStore::open(path.clone()).unwrap();
        let conn = store.conn.lock().unwrap();

        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 21);

        let stored = get_session(&conn, "upstream-s1").unwrap().unwrap();
        assert_eq!(stored.id, "upstream-s1");
        assert_eq!(stored.linked_work_item.unwrap()["number"], 42);
        assert_eq!(stored.queued_messages, None);
        assert_eq!(stored.queue_status, None);

        let mut update = sample("upstream-s1", "/tmp/proj", "Upstream task");
        update.linked_work_item = Some(json!({"kind": "pr", "number": 42}));
        update.queue_status = Some("held".into());
        update.queued_messages = Some(json!([{"id": "q1", "text": "queued"}]));
        upsert_session(&conn, &update).unwrap();

        let updated = get_session(&conn, "upstream-s1").unwrap().unwrap();
        assert_eq!(updated.queue_status.as_deref(), Some("held"));
        assert_eq!(updated.queued_messages.unwrap()[0]["id"], "q1");

        drop(conn);
        drop(store);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn local5_v12_database_upgrades_to_v20_and_preserves_queued_data() {
        let path = std::env::temp_dir().join(format!(
            "monocode-upgrade-local5-to-v14-{}-{}.db",
            std::process::id(),
            now_millis()
        ));
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                r#"CREATE TABLE schema_migrations (
                   version INTEGER PRIMARY KEY,
                   applied_at INTEGER NOT NULL
                 );
                 CREATE TABLE sessions (
                   id TEXT PRIMARY KEY,
                   cwd TEXT NOT NULL,
                   harness TEXT NOT NULL,
                   model TEXT NOT NULL,
                   model_settings TEXT NOT NULL DEFAULT '{}',
                   runtime_mode TEXT NOT NULL,
                   title TEXT NOT NULL,
                   provider_session_id TEXT,
                   blocks_json TEXT NOT NULL DEFAULT '[]',
                   created_at INTEGER NOT NULL,
                   updated_at INTEGER NOT NULL,
                   context_used INTEGER,
                   context_window INTEGER,
                   branch TEXT,
                   worktree_cwd TEXT,
                   has_user_message INTEGER NOT NULL DEFAULT 0,
                   pinned INTEGER NOT NULL DEFAULT 0,
                   archived INTEGER NOT NULL DEFAULT 0,
                   queued_messages_json TEXT,
                   queue_status TEXT
                 );
                 INSERT INTO schema_migrations (version, applied_at)
                   VALUES (1, 1), (2, 1), (3, 1), (4, 1), (5, 1), (6, 1),
                          (7, 1), (8, 1), (9, 1), (10, 1), (11, 1), (12, 1);
                 INSERT INTO sessions (
                   id, cwd, harness, model, runtime_mode, title, created_at, updated_at,
                   has_user_message, queued_messages_json, queue_status
                 ) VALUES (
                   'local5-s1', '/tmp/proj', 'codex', 'gpt-5', 'supervised', 'Local5 task',
                   100, 200, 1, '[{"id":"q1","text":"durable message"}]', 'held'
                 );"#,
            )
            .unwrap();
        }

        let store = SessionStore::open(path.clone()).unwrap();
        let conn = store.conn.lock().unwrap();

        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 21);

        let stored = get_session(&conn, "local5-s1").unwrap().unwrap();
        assert_eq!(stored.id, "local5-s1");
        assert_eq!(stored.queue_status.as_deref(), Some("held"));
        assert_eq!(
            stored.queued_messages.unwrap()[0]["text"],
            "durable message"
        );
        assert_eq!(stored.linked_work_item, None);

        let notes_table: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'notes'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(notes_table, 1);

        drop(conn);
        drop(store);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn migration_is_idempotent_and_can_run_twice() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        assert!(migrate(&conn).is_ok());
        assert!(migrate(&conn).is_ok());
        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 21);
    }

    #[test]
    fn migration_restores_tasks_table_even_when_existing_versions_are_recorded() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        conn.execute_batch("DROP TABLE tasks;").unwrap();

        migrate(&conn).unwrap();

        let tasks_table: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'tasks'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tasks_table, 1);
        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 21);
    }

    #[test]
    fn migration_restores_session_board_table_without_changing_current_version() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        conn.execute_batch(
            "INSERT INTO sessions (id,cwd,harness,model,runtime_mode,title,blocks_json,created_at,updated_at)
             VALUES ('session-preserve','/work','claude','model','default','Keep session','[]',1,1);
             INSERT INTO notes (id,slug,title,body,created_at,updated_at)
             VALUES ('note-preserve','note-preserve','Keep note','Body',1,1);
             INSERT INTO tasks (id,title,body,status,created_at,updated_at)
             VALUES ('task-preserve','Keep task','Body','todo',1,1);
             DROP TABLE session_board_cards;",
        )
        .unwrap();

        migrate(&conn).unwrap();

        let board_table: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'session_board_cards'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(board_table, 1);
        assert_eq!(
            conn.query_row(
                "SELECT title FROM sessions WHERE id='session-preserve'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
            "Keep session"
        );
        assert_eq!(
            conn.query_row(
                "SELECT title FROM notes WHERE id='note-preserve'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
            "Keep note"
        );
        assert_eq!(
            conn.query_row(
                "SELECT title FROM tasks WHERE id='task-preserve'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
            "Keep task"
        );
        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 21);
    }

    #[cfg(windows)]
    #[test]
    fn windows_project_history_and_search_path_compatibility() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();

        // 1. Store one legacy Windows session with backslashes
        upsert_session(
            &conn,
            &sample(
                "s_legacy",
                r"E:\Developing\OpenSource\mono-clone",
                "Legacy session",
            ),
        )
        .unwrap();
        set_archived(&conn, "s_legacy", true).unwrap();
        conn.execute(
            "UPDATE sessions SET updated_at = 1000 WHERE id = 's_legacy'",
            [],
        )
        .unwrap();

        // 2. Store one current Windows session with forward slashes
        upsert_session(
            &conn,
            &sample(
                "s_current",
                "E:/Developing/OpenSource/mono-clone",
                "Current session",
            ),
        )
        .unwrap();
        set_pinned(&conn, "s_current", true).unwrap();
        conn.execute(
            "UPDATE sessions SET updated_at = 2000 WHERE id = 's_current'",
            [],
        )
        .unwrap();

        // Store session for another project (must NOT be returned)
        upsert_session(
            &conn,
            &sample(
                "s_other",
                "E:/Developing/OpenSource/other-project",
                "Other session",
            ),
        )
        .unwrap();

        // Store legacy Inbox Ask row (must remain excluded)
        upsert_session(
            &conn,
            &sample(
                "s_inbox",
                r"E:\Developing\OpenSource\mono-clone",
                "Inbox chat",
            ),
        )
        .unwrap();
        conn.execute(
            "UPDATE sessions SET inbox_ask = '{}' WHERE id = 's_inbox'",
            [],
        )
        .unwrap();

        // 3. Query using the current forward-slash project path
        let rows = list_by_project(&conn, "E:/Developing/OpenSource/mono-clone").unwrap();

        // 4. Confirm both sessions are returned
        assert_eq!(
            rows.len(),
            2,
            "Both forward-slash and legacy backslash sessions must be returned"
        );

        // 5. Confirm they appear exactly once
        let ids: Vec<&str> = rows.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, vec!["s_current", "s_legacy"]);

        // 6. Confirm ordering remains correct (updated_at DESC, id ASC)
        assert_eq!(rows[0].id, "s_current");
        assert_eq!(rows[1].id, "s_legacy");

        // 7. Confirm archived and pinned metadata survive
        assert!(rows[0].pinned);
        assert!(!rows[0].archived);
        assert!(!rows[1].pinned);
        assert!(rows[1].archived);

        // 8. Confirm legacy Inbox Ask rows remain excluded
        assert!(!rows.iter().any(|r| r.id == "s_inbox"));

        // 10. Confirm querying one project does not return another project's sessions
        assert!(!rows.iter().any(|r| r.id == "s_other"));

        // 9. Confirm project-scoped search finds both path spellings
        let search = search_sessions(
            &conn,
            &SessionSearchOptions {
                query: "session".into(),
                cwd: Some("E:/Developing/OpenSource/mono-clone".into()),
                include_archived: true,
                search_owner: String::new(),
            },
        )
        .unwrap();
        let search_ids: Vec<&str> = search.hits.iter().map(|h| h.session_id.as_str()).collect();
        assert!(
            search_ids.contains(&"s_legacy"),
            "Search must find legacy backslash session"
        );
        assert!(
            search_ids.contains(&"s_current"),
            "Search must find current forward-slash session"
        );
        assert!(
            !search_ids.contains(&"s_other"),
            "Search must not find other project session"
        );
        assert!(
            !search_ids.contains(&"s_inbox"),
            "Search must not find inbox ask session"
        );
    }

    #[test]
    fn unix_literal_backslashes_not_conflated() {
        // Requirement 11: Unix paths and literal backslashes are not incorrectly conflated on non-Windows targets
        let unix_candidates =
            project_cwd_candidates_platform(r"/tmp/project\with\backslash", false);
        assert_eq!(unix_candidates, vec![r"/tmp/project\with\backslash"]);

        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(&conn, &sample("s_bs", r"/tmp/project\with\backslash", "BS")).unwrap();
        upsert_session(
            &conn,
            &sample("s_slash", "/tmp/project/with/backslash", "Slash"),
        )
        .unwrap();

        // On non-Windows, querying "/tmp/project/with/backslash" only matches that exact path
        let candidates = project_cwd_candidates_platform("/tmp/project/with/backslash", false);
        assert_eq!(candidates, vec!["/tmp/project/with/backslash"]);
        let mut slash = sample("s_slash", "/tmp/project/with/backslash", "Slash");
        slash.sidebar_hidden = true;
        upsert_session(&conn, &slash).unwrap();

        let rows: Vec<SessionSummary> = conn
            .prepare("SELECT id, cwd, harness, model, runtime_mode, title, provider_session_id, created_at, updated_at, branch, archived, pinned, linked_work_item_json, sidebar_hidden FROM sessions WHERE cwd = ?1 AND has_user_message = 1")
            .unwrap()
            .query_map(params![&candidates[0]], |row| Ok(SessionSummary {
                id: row.get(0)?,
                cwd: row.get(1)?,
                harness: row.get(2)?,
                model: row.get(3)?,
                runtime_mode: row.get(4)?,
                title: row.get(5)?,
                provider_session_id: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                branch: None,
                orchestration_lead_id: None,
                orchestration: None,
                worktree_cwd: None,
                worktree_removed: false,
                repo: None,
                additions: 0,
                deletions: 0,
                archived: false,
                pinned: false,
                sidebar_hidden: row.get::<_, i64>(13)? != 0,
                linked_work_item: None,
                draft: false,
                automation_id: None,
                sidechat: None,
            }))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert_eq!(rows.len(), 1);
        assert!(rows[0].sidebar_hidden);
        assert_eq!(rows[0].id, "s_slash");
    }

    #[test]
    fn project_history_candidates_served_by_covering_index() {
        // Requirement 12: Confirm the project-history query is served through the intended index
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.conn.lock().unwrap();
        upsert_session(
            &conn,
            &sample("s1", "E:/Developing/OpenSource/mono-clone", "A1"),
        )
        .unwrap();

        // Verify multi-candidate IN query plan uses covering index
        let plan: String = conn
            .query_row(
                "EXPLAIN QUERY PLAN
                 SELECT id, cwd, harness, model, runtime_mode, title, provider_session_id,
                        created_at, updated_at, branch, archived, pinned,
                        linked_work_item_json
                 FROM sessions
                 WHERE cwd IN (?1, ?2, ?3, ?4)
                   AND has_user_message = 1
                   AND id NOT IN (SELECT id FROM sessions WHERE inbox_ask IS NOT NULL)
                 ORDER BY updated_at DESC, id ASC",
                params![
                    "E:/Developing/OpenSource/mono-clone",
                    r"E:\Developing\OpenSource\mono-clone",
                    "e:/Developing/OpenSource/mono-clone",
                    r"e:\Developing\OpenSource\mono-clone",
                ],
                |row| row.get(3),
            )
            .unwrap();
        assert!(
            plan.contains("USING COVERING INDEX sessions_cwd_cover_idx"),
            "Query plan must use covering index: {plan}"
        );
    }

    #[test]
    fn project_cwd_candidates_platform_generates_expected_variants() {
        // Windows drive letters and separators
        let win_candidates =
            project_cwd_candidates_platform("E:/Developing/OpenSource/mono-clone", true);
        assert_eq!(
            win_candidates,
            vec![
                "E:/Developing/OpenSource/mono-clone",
                r"E:\Developing\OpenSource\mono-clone",
                "e:/Developing/OpenSource/mono-clone",
                r"e:\Developing\OpenSource\mono-clone",
            ]
        );

        let win_candidates_bs =
            project_cwd_candidates_platform(r"E:\Developing\OpenSource\mono-clone", true);
        assert_eq!(
            win_candidates_bs,
            vec![
                "E:/Developing/OpenSource/mono-clone",
                r"E:\Developing\OpenSource\mono-clone",
                "e:/Developing/OpenSource/mono-clone",
                r"e:\Developing\OpenSource\mono-clone",
            ]
        );

        // Windows UNC paths
        let unc_candidates = project_cwd_candidates_platform(r"\\server\share\project", true);
        assert_eq!(
            unc_candidates,
            vec!["//server/share/project", r"\\server\share\project"]
        );

        // Non-Windows preserves exact input without slash conversion
        let unix_candidates =
            project_cwd_candidates_platform(r"/home/user/project\with\backslash", false);
        assert_eq!(unix_candidates, vec![r"/home/user/project\with\backslash"]);
    }
}
