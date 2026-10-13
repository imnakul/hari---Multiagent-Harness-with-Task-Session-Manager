//! Native provider metadata and MonoCode-only visibility/bindings. Never writes provider stores.
use crate::session_store::{now_millis, SessionStore};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Claude,
    Codex,
}

impl Provider {
    fn name(&self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConversation {
    pub key: String,
    pub provider: Provider,
    pub native_id: String,
    pub source_root: String,
    pub provider_account_id: String,
    pub title: String,
    pub cwd: String,
    pub updated_at: u64,
    pub archived: bool,
    pub monocode_session_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationPage {
    pub conversations: Vec<ProviderConversation>,
    pub diagnostics: Vec<String>,
    pub next_offset: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBinding {
    pub key: String,
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudSession {
    pub provider: Provider,
    pub id: String,
    pub url: String,
    pub cwd: String,
    pub provider_account_id: String,
    pub environment_id: Option<String>,
    pub branch: Option<String>,
    pub created_at: i64,
}

pub(crate) fn ensure_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS provider_conversation_state (
        source_key TEXT PRIMARY KEY, archived INTEGER NOT NULL DEFAULT 0,
        monocode_session_id TEXT, source_cwd TEXT, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS provider_cloud_sessions (
        provider TEXT NOT NULL, account_id TEXT NOT NULL, native_id TEXT NOT NULL,
        payload TEXT NOT NULL, PRIMARY KEY(provider, account_id, native_id)
    );",
    )?;
    let has_cwd: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('provider_conversation_state') WHERE name='source_cwd')",
        [], |r| r.get(0),
    )?;
    if !has_cwd {
        conn.execute_batch("ALTER TABLE provider_conversation_state ADD COLUMN source_cwd TEXT")?;
    }
    Ok(())
}

fn validate_key(key: &str) -> Result<(), String> {
    let parts: Vec<String> = serde_json::from_str(key).map_err(|_| "Invalid native source key")?;
    if parts.len() != 3
        || !matches!(parts[0].as_str(), "claude" | "codex")
        || parts[1].is_empty()
        || parts[2].is_empty()
        || key.len() > 8192
        || parts.iter().any(|p| p.contains('\0'))
    {
        return Err("Invalid native source key".into());
    }
    Ok(())
}

pub(crate) fn root_for(
    app: &AppHandle,
    provider: &Provider,
    account: &str,
) -> Result<PathBuf, String> {
    if account != "default" {
        return crate::harness::provider_account_path(app, provider.name(), account);
    }
    let env_key = match provider {
        Provider::Claude => "CLAUDE_CONFIG_DIR",
        Provider::Codex => "CODEX_HOME",
    };
    if let Some(root) = std::env::var_os(env_key).filter(|v| !v.is_empty()) {
        let root = PathBuf::from(root);
        if !root.is_absolute() {
            return Err(format!("{env_key} must be an absolute path"));
        }
        return Ok(root);
    }
    let home = crate::dirs_home()
        .filter(|h| !h.is_empty())
        .ok_or("Cannot locate provider home")?;
    Ok(PathBuf::from(home).join(format!(".{}", provider.name())))
}

fn source_key(provider: &Provider, root: &Path, id: &str) -> String {
    serde_json::to_string(&[provider.name(), root.to_string_lossy().as_ref(), id])
        .expect("strings serialize")
}

fn scan_files(
    provider: &Provider,
    dir: &Path,
    root: &Path,
    account: &str,
    depth: u8,
    rows: &mut BTreeMap<String, ProviderConversation>,
    diagnostics: &mut Vec<String>,
) {
    if depth > 8 {
        diagnostics.push(format!(
            "Provider directory exceeds scan depth: {}",
            dir.display()
        ));
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
        Err(e) => {
            diagnostics.push(format!("Could not read {}: {e}", dir.display()));
            return;
        }
    };
    for entry in entries {
        let entry = match entry {
            Ok(v) => v,
            Err(e) => {
                diagnostics.push(e.to_string());
                continue;
            }
        };
        let path = entry.path();
        let kind = match entry.file_type() {
            Ok(v) => v,
            Err(e) => {
                diagnostics.push(e.to_string());
                continue;
            }
        };
        if kind.is_dir() {
            if *provider == Provider::Claude && entry.file_name() == "subagents" {
                continue;
            }
            scan_files(provider, &path, root, account, depth + 1, rows, diagnostics);
        } else if kind.is_file() && path.extension().is_some_and(|e| e == "jsonl") {
            let parsed = match provider {
                Provider::Claude => {
                    // Sidechain agent files are not independently resumable user conversations.
                    if path
                        .file_name()
                        .is_some_and(|n| n.to_string_lossy().starts_with("agent-"))
                        || path.components().any(|c| c.as_os_str() == "subagents")
                    {
                        continue;
                    }
                    let slug = path
                        .parent()
                        .and_then(Path::file_name)
                        .unwrap_or_default()
                        .to_string_lossy();
                    crate::session_import::parse_claude_file(&path, &slug)
                }
                Provider::Codex => crate::session_import::parse_codex_file(&path),
            };
            if let Some((updated_at, item)) = parsed {
                let key = source_key(provider, root, &item.id);
                let row = ProviderConversation {
                    key: key.clone(),
                    provider: provider.clone(),
                    native_id: item.id,
                    source_root: root.to_string_lossy().into_owned(),
                    provider_account_id: account.into(),
                    title: item.title,
                    cwd: item.cwd,
                    updated_at,
                    archived: false,
                    monocode_session_id: None,
                };
                if rows
                    .get(&key)
                    .is_none_or(|old| old.updated_at <= updated_at)
                {
                    rows.insert(key, row);
                }
            } else if !std::fs::metadata(&path).is_ok_and(|v| v.len() == 0) {
                diagnostics.push(format!(
                    "Skipped unreadable or unsupported transcript: {}",
                    path.display()
                ));
            }
        }
    }
}

fn scan_codex_metadata(
    root: &Path,
    account: &str,
    rows: &mut BTreeMap<String, ProviderConversation>,
    diagnostics: &mut Vec<String>,
) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    let mut databases: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            (name.starts_with("state_") && name.ends_with(".sqlite")).then(|| e.path())
        })
        .collect();
    databases.sort();
    for db in databases {
        let result = (|| -> rusqlite::Result<()> {
            let conn = Connection::open_with_flags(
                &db,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )?;
            let has_millis = conn
                .prepare("PRAGMA table_info(threads)")?
                .query_map([], |r| r.get::<_, String>(1))?
                .collect::<rusqlite::Result<Vec<_>>>()?
                .iter()
                .any(|name| name == "updated_at_ms");
            let sql = if has_millis {
                "SELECT id, title, cwd, COALESCE(updated_at_ms / 1000, updated_at) FROM threads"
            } else {
                "SELECT id, title, cwd, updated_at FROM threads"
            };
            let mut query = conn.prepare(sql)?;
            let found = query.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })?;
            for row in found {
                let (id, title, cwd, updated) = row?;
                if id.is_empty() {
                    continue;
                }
                let key = source_key(&Provider::Codex, root, &id);
                let updated_at = updated.max(0) as u64;
                // Database titles/cwd cover paginated and compressed stores without reading history.
                let metadata = ProviderConversation {
                    key: key.clone(),
                    provider: Provider::Codex,
                    native_id: id,
                    source_root: root.to_string_lossy().into_owned(),
                    provider_account_id: account.into(),
                    title,
                    cwd,
                    updated_at,
                    archived: false,
                    monocode_session_id: None,
                };
                if rows
                    .get(&key)
                    .is_none_or(|old| old.updated_at <= updated_at)
                {
                    rows.insert(key, metadata);
                }
            }
            Ok(())
        })();
        if let Err(e) = result {
            diagnostics.push(format!(
                "Could not read Codex metadata {}: {e}",
                db.display()
            ));
        }
    }
}

fn discover_at(
    provider: Provider,
    root: &Path,
    account: &str,
) -> (BTreeMap<String, ProviderConversation>, Vec<String>) {
    let root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let mut rows = BTreeMap::new();
    let mut diagnostics = Vec::new();
    let dirs = match provider {
        Provider::Claude => vec!["projects"],
        Provider::Codex => vec!["sessions", "archived_sessions"],
    };
    for dir in dirs {
        scan_files(
            &provider,
            &root.join(dir),
            &root,
            account,
            0,
            &mut rows,
            &mut diagnostics,
        );
    }
    if provider == Provider::Codex {
        scan_codex_metadata(&root, account, &mut rows, &mut diagnostics);
    }
    (rows, diagnostics)
}

/// Match the frontend's project identity without changing launch/display paths.
/// Windows drive/UNC paths accept either slash and case; Unix stays case-sensitive.
fn cwd_key(cwd: &str) -> String {
    let bytes = cwd.as_bytes();
    let windows = (bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\'))
        || cwd.starts_with("\\\\")
        || cwd.starts_with("//");
    let slashed = if windows {
        cwd.replace('\\', "/")
    } else {
        cwd.to_string()
    };
    let trimmed = slashed.trim_end_matches('/');
    let trimmed = if trimmed.is_empty() { "/" } else { trimmed };
    if windows
        || (trimmed.len() == 2
            && trimmed.as_bytes()[0].is_ascii_alphabetic()
            && trimmed.as_bytes()[1] == b':')
    {
        trimmed.to_lowercase()
    } else {
        trimmed.to_string()
    }
}

fn page_with_state(
    conn: &Connection,
    mut rows: BTreeMap<String, ProviderConversation>,
    mut diagnostics: Vec<String>,
    include_archived: bool,
    limit: u32,
    offset: usize,
) -> Result<ConversationPage, String> {
    // Existing MonoCode chats also appear in provider stores. Reuse metadata, never replay blocks.
    if has_session_table(conn).map_err(|e| e.to_string())? {
        let mut query = conn.prepare("SELECT id, harness, provider_session_id, cwd, COALESCE(provider_account_id, 'default'), archived FROM sessions WHERE provider_session_id IS NOT NULL ORDER BY updated_at DESC, id").map_err(|e| e.to_string())?;
        let existing = query
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, bool>(5)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut identities = BTreeMap::new();
        for session in existing {
            let (id, provider, native_id, cwd, account, archived) =
                session.map_err(|e| e.to_string())?;
            identities
                .entry((provider, native_id, cwd_key(&cwd), account))
                .or_insert((id, archived));
        }
        for row in rows.values_mut() {
            let identity = (
                row.provider.name().to_string(),
                row.native_id.clone(),
                cwd_key(&row.cwd),
                row.provider_account_id.clone(),
            );
            if let Some((id, archived)) = identities.get(&identity) {
                row.monocode_session_id = Some(id.clone());
                row.archived = *archived;
            }
        }
    }
    let mut query = conn
        .prepare(
            "SELECT source_key, archived, monocode_session_id FROM provider_conversation_state",
        )
        .map_err(|e| e.to_string())?;
    let saved = query
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, bool>(1)?,
                r.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    for row in saved {
        let (key, archived, id) = row.map_err(|e| e.to_string())?;
        if let Some(item) = rows.get_mut(&key) {
            item.archived = archived;
            if id.is_some() {
                item.monocode_session_id = id;
            }
        }
    }
    let mut rows: Vec<_> = rows
        .into_values()
        .filter(|r| include_archived || !r.archived)
        .collect();
    rows.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then(a.key.cmp(&b.key)));
    let limit = limit.clamp(1, 500) as usize;
    let total = rows.len();
    let next = offset.saturating_add(limit);
    diagnostics.truncate(100);
    Ok(ConversationPage {
        conversations: rows.into_iter().skip(offset).take(limit).collect(),
        diagnostics,
        next_offset: (next < total).then_some(next),
    })
}

#[cfg(test)]
fn list_at(
    conn: &Connection,
    provider: Provider,
    root: &Path,
    account: &str,
    include_archived: bool,
    limit: u32,
    offset: usize,
) -> Result<ConversationPage, String> {
    let (rows, diagnostics) = discover_at(provider, root, account);
    page_with_state(conn, rows, diagnostics, include_archived, limit, offset)
}

/// Filter the full discovery result before pagination; older matches stay findable.
fn filter_conversations(
    rows: BTreeMap<String, ProviderConversation>,
    query: Option<&str>,
    project_cwd: Option<&str>,
) -> BTreeMap<String, ProviderConversation> {
    let query = query.unwrap_or_default().trim().to_lowercase();
    let project = project_cwd
        .filter(|cwd| !cwd.trim().is_empty())
        .map(cwd_key);
    rows.into_iter()
        .filter(|(_, row)| {
            project.as_ref().is_none_or(|cwd| *cwd == cwd_key(&row.cwd))
                && (query.is_empty()
                    || [&row.title, &row.cwd, &row.native_id]
                        .iter()
                        .any(|text| text.to_lowercase().contains(&query)))
        })
        .collect()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationFindRequest {
    pub include_archived: bool,
    pub limit: u32,
    pub offset: usize,
    pub query: Option<String>,
    pub project_cwd: Option<String>,
}

#[tauri::command(async)]
pub fn provider_sessions_list(
    app: AppHandle,
    store: State<'_, SessionStore>,
    provider: Provider,
    account_id: Option<String>,
    include_archived: bool,
    limit: u32,
    offset: usize,
) -> Result<ConversationPage, String> {
    provider_sessions_find(
        app,
        store,
        provider,
        account_id,
        ConversationFindRequest {
            include_archived,
            limit,
            offset,
            query: None,
            project_cwd: None,
        },
    )
}

#[tauri::command(async)]
pub fn provider_sessions_find(
    app: AppHandle,
    store: State<'_, SessionStore>,
    provider: Provider,
    account_id: Option<String>,
    request: ConversationFindRequest,
) -> Result<ConversationPage, String> {
    let account = account_id.as_deref().unwrap_or("default");
    let root = root_for(&app, &provider, account)?;
    // Slow provider scans must not block unrelated MonoCode storage writes.
    let (rows, diagnostics) = discover_at(provider, &root, account);
    let rows = filter_conversations(
        rows,
        request.query.as_deref(),
        request.project_cwd.as_deref(),
    );
    let conn = store.lock_conn()?;
    page_with_state(
        &conn,
        rows,
        diagnostics,
        request.include_archived,
        request.limit,
        request.offset,
    )
}

fn validate_native_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 200
        || id.starts_with('-')
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
    {
        return Err("Paste a local session ID or a supported resume command".into());
    }
    Ok(())
}

fn resolve_from_rows(
    conn: &Connection,
    rows: BTreeMap<String, ProviderConversation>,
    diagnostics: Vec<String>,
    native_id: &str,
) -> Result<ProviderConversation, String> {
    validate_native_id(native_id)?;
    let matches = rows
        .into_iter()
        .filter(|(_, row)| row.native_id == native_id)
        .collect();
    // Include archived chats and retain the existing MonoCode identity. Explicit
    // lookup is independent of list pagination and never writes a provider store.
    let mut page = page_with_state(conn, matches, diagnostics, true, 2, 0)?;
    match page.conversations.len() {
        1 => Ok(page.conversations.remove(0)),
        0 => Err(format!(
            "Session {native_id} was not found in this local provider account. Check the provider and account; cloud and public share links cannot be resumed here.{}",
            if page.diagnostics.is_empty() { String::new() } else { format!(" Discovery: {}", page.diagnostics.join("; ")) }
        )),
        _ => Err("More than one local conversation has this ID; resolve the duplicate in the provider store first".into()),
    }
}

#[tauri::command(async)]
pub fn provider_sessions_resolve(
    app: AppHandle,
    store: State<'_, SessionStore>,
    provider: Provider,
    account_id: Option<String>,
    native_id: String,
) -> Result<ProviderConversation, String> {
    validate_native_id(&native_id)?;
    let account = account_id.as_deref().unwrap_or("default");
    let root = root_for(&app, &provider, account)?;
    let (rows, diagnostics) = discover_at(provider, &root, account);
    let conn = store.lock_conn()?;
    resolve_from_rows(&conn, rows, diagnostics, &native_id)
}

fn set_archive(conn: &Connection, key: &str, archived: bool) -> Result<(), String> {
    validate_key(key)?;
    conn.execute("INSERT INTO provider_conversation_state(source_key, archived, updated_at) VALUES (?1, ?2, ?3)
        ON CONFLICT(source_key) DO UPDATE SET archived=excluded.archived, updated_at=excluded.updated_at",
        params![key, archived, now_millis()]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn provider_sessions_set_archived(
    store: State<'_, SessionStore>,
    key: String,
    archived: bool,
) -> Result<(), String> {
    let conn = store.lock_conn()?;
    set_archive(&conn, &key, archived)
}

#[tauri::command]
pub fn provider_sessions_bind(
    store: State<'_, SessionStore>,
    key: String,
    session_id: String,
    cwd: String,
    account_id: Option<String>,
) -> Result<String, String> {
    let conn = store.lock_conn()?;
    bind(
        &conn,
        &key,
        &session_id,
        &cwd,
        account_id.as_deref().unwrap_or("default"),
    )
}

fn has_session_table(conn: &Connection) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='sessions')",
        [],
        |r| r.get(0),
    )
}

fn bind(
    conn: &Connection,
    key: &str,
    session_id: &str,
    cwd: &str,
    account: &str,
) -> Result<String, String> {
    validate_key(key)?;
    if session_id.is_empty() || session_id.len() > 200 || session_id.contains('\0') {
        return Err("Invalid MonoCode session id".into());
    }
    if cwd.trim().is_empty() || cwd.contains('\0') {
        return Err("Invalid native conversation folder".into());
    }
    let parts: Vec<String> = serde_json::from_str(key).map_err(|e| e.to_string())?;
    let existing: Option<(String, bool)> = if has_session_table(conn).map_err(|e| e.to_string())? {
        let mut query = conn.prepare("SELECT id, archived, cwd FROM sessions WHERE harness=?1 AND provider_session_id=?2 AND COALESCE(provider_account_id,'default')=?3 ORDER BY updated_at DESC, id").map_err(|e| e.to_string())?;
        let candidates = query
            .query_map(params![parts[0], parts[2], account], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, bool>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let expected_cwd = cwd_key(cwd);
        let mut matched = None;
        for candidate in candidates {
            let (id, archived, saved_cwd) = candidate.map_err(|e| e.to_string())?;
            if cwd_key(&saved_cwd) == expected_cwd {
                matched = Some((id, archived));
                break;
            }
        }
        matched
    } else {
        None
    };
    let session_id = existing
        .as_ref()
        .map(|(id, _)| id.as_str())
        .unwrap_or(session_id);
    let archived = existing.as_ref().is_some_and(|(_, archived)| *archived);
    conn.execute("INSERT INTO provider_conversation_state(source_key, monocode_session_id, source_cwd, updated_at, archived) VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(source_key) DO UPDATE SET monocode_session_id=COALESCE(provider_conversation_state.monocode_session_id, excluded.monocode_session_id), source_cwd=COALESCE(provider_conversation_state.source_cwd, excluded.source_cwd), updated_at=excluded.updated_at",
        params![key, session_id, cwd, now_millis(), archived]).map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT monocode_session_id FROM provider_conversation_state WHERE source_key=?1",
        [key],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn provider_sessions_for_session(
    store: State<'_, SessionStore>,
    session_id: String,
) -> Result<Option<NativeBinding>, String> {
    store
        .lock_conn()?
        .query_row(
            "SELECT source_key, source_cwd FROM provider_conversation_state WHERE monocode_session_id=?1",
            [session_id],
            |r| Ok(NativeBinding { key: r.get(0)?, cwd: r.get::<_, Option<String>>(1)?.unwrap_or_default() }),
        )
        .optional()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn provider_sessions_unbind(
    store: State<'_, SessionStore>,
    session_id: String,
) -> Result<(), String> {
    store.lock_conn()?.execute("UPDATE provider_conversation_state SET monocode_session_id=NULL WHERE monocode_session_id=?1", [session_id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn provider_sessions_validate_source(
    app: AppHandle,
    key: String,
    provider: Provider,
    account_id: Option<String>,
) -> Result<String, String> {
    validate_key(&key)?;
    let parts: Vec<String> = serde_json::from_str(&key).map_err(|e| e.to_string())?;
    let root = root_for(&app, &provider, account_id.as_deref().unwrap_or("default"))?;
    let root = std::fs::canonicalize(&root).unwrap_or(root);
    if parts[0] != provider.name() || Path::new(&parts[1]) != root {
        return Err("The native conversation belongs to a different provider profile".into());
    }
    Ok(parts[2].clone())
}

fn validate_cloud(value: &CloudSession) -> Result<(), String> {
    if value.id.is_empty()
        || value.id.starts_with('-')
        || value.id.len() > 200
        || !value
            .id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
        || value.cwd.is_empty()
        || value.provider_account_id.is_empty()
    {
        return Err("Invalid cloud session metadata".into());
    }
    let url = url::Url::parse(&value.url).map_err(|_| "Invalid cloud URL")?;
    let hosts: HashSet<&str> = match value.provider {
        Provider::Claude => ["claude.ai"].into(),
        Provider::Codex => ["chatgpt.com"].into(),
    };
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || !url.host_str().is_some_and(|h| hosts.contains(h))
        || url.port().is_some()
    {
        return Err("Cloud URL must use the provider's HTTPS host".into());
    }
    Ok(())
}

#[tauri::command]
pub fn provider_cloud_save(
    store: State<'_, SessionStore>,
    session: CloudSession,
) -> Result<CloudSession, String> {
    let conn = store.lock_conn()?;
    save_cloud(&conn, session)
}

fn save_cloud(conn: &Connection, mut session: CloudSession) -> Result<CloudSession, String> {
    validate_cloud(&session)?;
    let old: Option<String> = conn.query_row("SELECT payload FROM provider_cloud_sessions WHERE provider=?1 AND account_id=?2 AND native_id=?3",
        params![session.provider.name(), session.provider_account_id, session.id], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
    if let Some(old) = old {
        return serde_json::from_str(&old).map_err(|e| e.to_string());
    }
    session.created_at = now_millis();
    let payload = serde_json::to_string(&session).map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO provider_cloud_sessions(provider, account_id, native_id, payload) VALUES (?1, ?2, ?3, ?4)",
        params![session.provider.name(), session.provider_account_id, session.id, payload]).map_err(|e| e.to_string())?;
    Ok(session)
}

#[tauri::command]
pub fn provider_cloud_list(
    store: State<'_, SessionStore>,
    provider: Provider,
    account_id: Option<String>,
) -> Result<Vec<CloudSession>, String> {
    let conn = store.lock_conn()?;
    let mut query = conn.prepare("SELECT payload FROM provider_cloud_sessions WHERE provider=?1 AND account_id=?2 ORDER BY rowid DESC").map_err(|e| e.to_string())?;
    let rows = query
        .query_map(
            params![
                provider.name(),
                account_id.unwrap_or_else(|| "default".into())
            ],
            |r| r.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())?;
    rows.map(|r| serde_json::from_str(&r.map_err(|e| e.to_string())?).map_err(|e| e.to_string()))
        .collect()
}

/// Bytes of transcript returned per history request; older chunks are paged on demand.
const HISTORY_CHUNK_BYTES: u64 = 6 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryChunk {
    /// Complete JSONL lines only, oldest first.
    pub text: String,
    /// Byte offset where `text` starts; pass it as `end` to read the earlier chunk.
    pub start: u64,
    pub has_earlier: bool,
}

fn find_transcript(provider: &Provider, dir: &Path, id: &str, depth: u8) -> Option<PathBuf> {
    if depth > 6 {
        return None;
    }
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        let kind = entry.file_type().ok()?;
        if kind.is_dir() {
            if *provider == Provider::Claude && entry.file_name() == "subagents" {
                continue;
            }
            if let Some(found) = find_transcript(provider, &path, id, depth + 1) {
                return Some(found);
            }
        } else if kind.is_file() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let matches = match provider {
                Provider::Claude => name == format!("{id}.jsonl"),
                Provider::Codex => name.ends_with(&format!("{id}.jsonl")),
            };
            if matches {
                return Some(path);
            }
        }
    }
    None
}

/// Read-only tail/page of a native transcript. Never writes provider files.
fn read_history_at(
    root: &Path,
    provider: &Provider,
    id: &str,
    end: Option<u64>,
    chunk: u64,
) -> Result<HistoryChunk, String> {
    use std::io::{Read, Seek, SeekFrom};
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Invalid native conversation ID.".into());
    }
    let roots: Vec<PathBuf> = match provider {
        Provider::Claude => vec![root.join("projects")],
        Provider::Codex => vec![root.join("sessions"), root.join("archived_sessions")],
    };
    let path = roots
        .iter()
        .find_map(|dir| find_transcript(provider, dir, id, 0))
        .ok_or_else(|| {
            "No transcript file was found for this conversation. Its provider store may use a layout MonoCode cannot read yet.".to_string()
        })?;
    let mut file = std::fs::File::open(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    let end = end.unwrap_or(len).min(len);
    let start = end.saturating_sub(chunk);
    file.seek(SeekFrom::Start(start))
        .map_err(|e| e.to_string())?;
    let mut bytes = vec![0u8; (end - start) as usize];
    file.read_exact(&mut bytes)
        .map_err(|e| format!("{}: {e}", path.display()))?;
    let mut aligned = start;
    if start > 0 {
        // Drop the partial first line; a newline byte never occurs inside a UTF-8 sequence.
        match bytes.iter().position(|b| *b == b'\n') {
            Some(index) => {
                bytes.drain(..=index);
                aligned = start + index as u64 + 1;
            }
            None => {
                bytes.clear();
                aligned = end;
            }
        }
    }
    Ok(HistoryChunk {
        text: String::from_utf8_lossy(&bytes).into_owned(),
        start: aligned,
        has_earlier: aligned > 0,
    })
}

/// Display-only history for an opened native conversation, read from the provider's own store.
#[tauri::command(async)]
pub fn provider_sessions_history(
    app: AppHandle,
    key: String,
    provider: Provider,
    account_id: Option<String>,
    end: Option<u64>,
) -> Result<HistoryChunk, String> {
    validate_key(&key)?;
    let parts: Vec<String> = serde_json::from_str(&key).map_err(|e| e.to_string())?;
    let root = root_for(&app, &provider, account_id.as_deref().unwrap_or("default"))?;
    let root = std::fs::canonicalize(&root).unwrap_or(root);
    if parts[0] != provider.name() || Path::new(&parts[1]) != root {
        return Err("The native conversation belongs to a different provider profile".into());
    }
    read_history_at(&root, &provider, &parts[2], end, HISTORY_CHUNK_BYTES)
}

#[cfg(test)]
mod tests;
