//! Fork (L-273): Settings → Storage. Lists the files MonoCode saved for chat
//! attachments and deletes the ones the user picks.
//!
//! Two folders hold them:
//! - pasted files, `<temp>/monocode-attachments/<pid>-<nanos>-<name>`
//!   (`fs::write_attachment`). Chats keep only these paths, so an old chat
//!   shows its images from here; deleting one removes it from that chat.
//! - Interactive Claude copies, `<app data>/interactive-attachments/<Claude
//!   session uuid>/<uuid>.<ext>` (`claude_interactive::claude_interactive_attachments`).
//!
//! Delete never trusts the paths it is given: each one must resolve to a plain
//! file directly inside one of those folders (a uuid folder for the copies).

use crate::session_store::SessionStore;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager};

const PASTED_DIR: &str = "monocode-attachments";
const INTERACTIVE_DIR: &str = "interactive-attachments";
const MAX_DELETE: usize = 20_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AttachmentStore {
    Pasted,
    Interactive,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAttachment {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified_ms: i64,
    pub store: AttachmentStore,
    pub session_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSession {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub harness: String,
    pub updated_at: i64,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentStorageScan {
    pub pasted_root: String,
    pub interactive_root: String,
    pub files: Vec<StoredAttachment>,
    pub sessions: Vec<StorageSession>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteFailure {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentDeleteResult {
    pub deleted: Vec<String>,
    pub freed_bytes: u64,
    pub failed: Vec<DeleteFailure>,
}

struct Roots {
    pasted: PathBuf,
    interactive: PathBuf,
}

fn roots(app: &AppHandle) -> Result<Roots, String> {
    Ok(Roots {
        pasted: std::env::temp_dir().join(PASTED_DIR),
        interactive: app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join(INTERACTIVE_DIR),
    })
}

/// One session row, with its transcript only when it mentions a pasted file.
struct SessionRow {
    session: StorageSession,
    provider_session_id: Option<String>,
    blocks_json: Option<String>,
}

#[tauri::command]
pub async fn attachment_storage_scan(app: AppHandle) -> Result<AttachmentStorageScan, String> {
    crate::background_work::store(app, |app| {
        let roots = roots(app)?;
        let store = app.state::<SessionStore>();
        let rows = store.read(read_session_rows)?;
        Ok(scan(&roots, rows))
    })
    .await
}

#[tauri::command]
pub async fn attachment_storage_delete(
    app: AppHandle,
    paths: Vec<String>,
) -> Result<AttachmentDeleteResult, String> {
    if paths.len() > MAX_DELETE {
        return Err(format!("Too many files at once (maximum {MAX_DELETE})."));
    }
    let roots = roots(&app)?;
    tauri::async_runtime::spawn_blocking(move || Ok(delete(&roots, &paths)))
        .await
        .map_err(|e| e.to_string())?
}

fn read_session_rows(conn: &rusqlite::Connection) -> Result<Vec<SessionRow>, String> {
    let mut statement = conn
        .prepare(
            "SELECT id, title, cwd, harness, updated_at, archived, provider_session_id,
                    CASE WHEN blocks_json LIKE '%monocode-attachments%' THEN blocks_json END
             FROM sessions",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(SessionRow {
                session: StorageSession {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    cwd: row.get(2)?,
                    harness: row.get(3)?,
                    updated_at: row.get(4)?,
                    archived: row.get::<_, i64>(5)? != 0,
                },
                provider_session_id: row.get(6)?,
                blocks_json: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn modified_ms(metadata: &std::fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|age| age.as_millis() as i64)
        .unwrap_or(0)
}

/// Plain files directly in `dir`, skipping links and folders. A missing
/// folder means nothing was saved yet.
fn files_in(dir: &Path) -> Vec<(PathBuf, std::fs::Metadata)> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let metadata = std::fs::symlink_metadata(entry.path()).ok()?;
            metadata.is_file().then(|| (entry.path(), metadata))
        })
        .collect()
}

fn uuid_dirs(root: &Path) -> Vec<(String, PathBuf)> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let metadata = std::fs::symlink_metadata(entry.path()).ok()?;
            let name = entry.file_name().to_str()?.to_string();
            (metadata.is_dir() && uuid::Uuid::parse_str(&name).is_ok())
                .then(|| (name, entry.path()))
        })
        .collect()
}

/// Lower-cased names of the pasted files a transcript points at. Only `path`
/// values whose folder is `monocode-attachments` count.
fn pasted_names_in(blocks_json: &str) -> HashSet<String> {
    fn walk(value: &serde_json::Value, names: &mut HashSet<String>) {
        match value {
            serde_json::Value::Object(map) => {
                for (key, child) in map {
                    if key == "path" {
                        if let Some(name) = child.as_str().and_then(pasted_name) {
                            names.insert(name);
                        }
                    } else {
                        walk(child, names);
                    }
                }
            }
            serde_json::Value::Array(items) => items.iter().for_each(|item| walk(item, names)),
            _ => {}
        }
    }
    let mut names = HashSet::new();
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(blocks_json) {
        walk(&value, &mut names);
    }
    names
}

/// The file name of a path inside a `monocode-attachments` folder, split by
/// hand so a Windows path parses the same on any host.
fn pasted_name(path: &str) -> Option<String> {
    let mut parts = path.rsplit(['/', '\\']).filter(|part| !part.is_empty());
    let name = parts.next()?;
    let folder = parts.next()?;
    folder
        .eq_ignore_ascii_case(PASTED_DIR)
        .then(|| name.to_lowercase())
}

fn scan(roots: &Roots, rows: Vec<SessionRow>) -> AttachmentStorageScan {
    let mut by_name: HashMap<String, Vec<String>> = HashMap::new();
    let mut by_native: HashMap<String, Vec<String>> = HashMap::new();
    let mut sessions: HashMap<String, StorageSession> = HashMap::new();
    for row in rows {
        let id = row.session.id.clone();
        if let Some(blocks) = row.blocks_json.as_deref() {
            for name in pasted_names_in(blocks) {
                by_name.entry(name).or_default().push(id.clone());
            }
        }
        if let Some(native) = row.provider_session_id.filter(|n| !n.is_empty()) {
            by_native
                .entry(native.to_lowercase())
                .or_default()
                .push(id.clone());
        }
        sessions.insert(id, row.session);
    }

    let mut files = Vec::new();
    for (path, metadata) in files_in(&roots.pasted) {
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();
        let session_ids = by_name
            .get(&name.to_lowercase())
            .cloned()
            .unwrap_or_default();
        files.push(StoredAttachment {
            path: path.to_string_lossy().into_owned(),
            name,
            size: metadata.len(),
            modified_ms: modified_ms(&metadata),
            store: AttachmentStore::Pasted,
            session_ids,
        });
    }
    for (native, dir) in uuid_dirs(&roots.interactive) {
        let session_ids = by_native
            .get(&native.to_lowercase())
            .cloned()
            .unwrap_or_default();
        for (path, metadata) in files_in(&dir) {
            files.push(StoredAttachment {
                name: path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or_default()
                    .to_string(),
                path: path.to_string_lossy().into_owned(),
                size: metadata.len(),
                modified_ms: modified_ms(&metadata),
                store: AttachmentStore::Interactive,
                session_ids: session_ids.clone(),
            });
        }
    }
    files.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));

    let linked: HashSet<&String> = files.iter().flat_map(|f| &f.session_ids).collect();
    let mut sessions: Vec<StorageSession> = sessions
        .into_values()
        .filter(|session| linked.contains(&session.id))
        .collect();
    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    AttachmentStorageScan {
        pasted_root: roots.pasted.to_string_lossy().into_owned(),
        interactive_root: roots.interactive.to_string_lossy().into_owned(),
        files,
        sessions,
    }
}

/// Where a path may be deleted from: directly in the pasted folder, or in a
/// uuid folder directly under the interactive folder. Compared after resolving
/// the real path, so `..` and links cannot reach outside.
fn deletable(roots: &Roots, path: &Path) -> Result<(PathBuf, u64), String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|_| "File not found".to_string())?;
    if !metadata.is_file() {
        return Err("Not a saved attachment file".into());
    }
    let real = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
    let parent = real.parent().ok_or("Not a saved attachment file")?;
    if let Ok(pasted) = std::fs::canonicalize(&roots.pasted) {
        if parent == pasted {
            return Ok((real, metadata.len()));
        }
    }
    if let Ok(interactive) = std::fs::canonicalize(&roots.interactive) {
        let is_session_dir = parent.parent() == Some(interactive.as_path())
            && parent
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| uuid::Uuid::parse_str(n).is_ok());
        if is_session_dir {
            return Ok((real, metadata.len()));
        }
    }
    Err("Not a saved attachment file".into())
}

fn delete(roots: &Roots, paths: &[String]) -> AttachmentDeleteResult {
    let mut result = AttachmentDeleteResult {
        deleted: Vec::new(),
        freed_bytes: 0,
        failed: Vec::new(),
    };
    let mut emptied: HashSet<PathBuf> = HashSet::new();
    for path in paths {
        match deletable(roots, Path::new(path)).and_then(|(real, size)| {
            std::fs::remove_file(&real).map_err(|e| e.to_string())?;
            Ok((real, size))
        }) {
            Ok((real, size)) => {
                result.freed_bytes += size;
                result.deleted.push(path.clone());
                if let Some(parent) = real.parent() {
                    emptied.insert(parent.to_path_buf());
                }
            }
            Err(message) => result.failed.push(DeleteFailure {
                path: path.clone(),
                message,
            }),
        }
    }
    // Drop uuid folders that are now empty; `remove_dir` refuses a folder that
    // still has files, and the pasted folder itself is kept.
    let pasted = std::fs::canonicalize(&roots.pasted).ok();
    for dir in emptied {
        if Some(&dir) != pasted.as_ref() {
            let _ = std::fs::remove_dir(&dir);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        base: PathBuf,
        roots: Roots,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.base);
        }
    }

    fn fixture() -> Fixture {
        let base = std::env::temp_dir().join(format!("monocode-storage-{}", uuid::Uuid::new_v4()));
        let roots = Roots {
            pasted: base.join(PASTED_DIR),
            interactive: base.join("data").join(INTERACTIVE_DIR),
        };
        std::fs::create_dir_all(&roots.pasted).unwrap();
        std::fs::create_dir_all(&roots.interactive).unwrap();
        Fixture { base, roots }
    }

    fn row(id: &str, native: Option<&str>, blocks: Option<&str>) -> SessionRow {
        SessionRow {
            session: StorageSession {
                id: id.into(),
                title: format!("Chat {id}"),
                cwd: "/repo".into(),
                harness: "claude".into(),
                updated_at: 1,
                archived: false,
            },
            provider_session_id: native.map(String::from),
            blocks_json: blocks.map(String::from),
        }
    }

    #[test]
    fn pasted_name_reads_windows_and_unix_paths() {
        assert_eq!(
            pasted_name(r"C:\Users\me\AppData\Local\Temp\monocode-attachments\1-2-Shot.png"),
            Some("1-2-shot.png".into())
        );
        assert_eq!(
            pasted_name("/tmp/monocode-attachments/1-2-a.png"),
            Some("1-2-a.png".into())
        );
        assert_eq!(pasted_name("/repo/src/a.png"), None);
    }

    #[test]
    fn scan_links_pasted_files_and_interactive_copies_to_chats() {
        let fx = fixture();
        let pasted = fx.roots.pasted.join("1-2-shot.png");
        std::fs::write(&pasted, b"png").unwrap();
        std::fs::write(fx.roots.pasted.join("1-3-loose.png"), b"x").unwrap();
        let native = uuid::Uuid::new_v4().to_string();
        let copies = fx.roots.interactive.join(&native);
        std::fs::create_dir_all(&copies).unwrap();
        std::fs::write(copies.join("c.png"), b"copy").unwrap();
        std::fs::create_dir_all(fx.roots.interactive.join("not-a-uuid")).unwrap();
        std::fs::write(fx.roots.interactive.join("not-a-uuid").join("x.png"), b"x").unwrap();

        let blocks = serde_json::json!([{
            "role": "user",
            "attachments": [{ "kind": "image", "name": "shot.png", "path": pasted.to_string_lossy() }]
        }])
        .to_string();
        let result = scan(
            &fx.roots,
            vec![
                row("a", None, Some(&blocks)),
                row("b", Some(&native), None),
                row("unused", None, None),
            ],
        );
        let by_name: HashMap<_, _> = result.files.iter().map(|f| (f.name.as_str(), f)).collect();
        assert_eq!(result.files.len(), 3);
        assert_eq!(by_name["1-2-shot.png"].session_ids, vec!["a"]);
        assert!(by_name["1-3-loose.png"].session_ids.is_empty());
        assert_eq!(by_name["c.png"].session_ids, vec!["b"]);
        assert_eq!(by_name["c.png"].store, AttachmentStore::Interactive);
        let mut ids: Vec<_> = result.sessions.iter().map(|s| s.id.as_str()).collect();
        ids.sort();
        assert_eq!(ids, vec!["a", "b"]);
    }

    #[test]
    fn delete_removes_only_saved_attachment_files() {
        let fx = fixture();
        let pasted = fx.roots.pasted.join("1-2-a.png");
        std::fs::write(&pasted, b"12345").unwrap();
        let native = uuid::Uuid::new_v4().to_string();
        let copies = fx.roots.interactive.join(&native);
        std::fs::create_dir_all(&copies).unwrap();
        let copy = copies.join("c.png");
        std::fs::write(&copy, b"123").unwrap();
        let outside = fx.base.join("keep.txt");
        std::fs::write(&outside, b"keep").unwrap();
        let escape = fx.roots.pasted.join("..").join("keep.txt");
        let stray = fx.roots.interactive.join("stray.png");
        std::fs::write(&stray, b"x").unwrap();

        let paths: Vec<String> = [&pasted, &copy, &outside, &escape, &stray, &fx.roots.pasted]
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .chain(std::iter::once(
                fx.roots
                    .pasted
                    .join("missing.png")
                    .to_string_lossy()
                    .into_owned(),
            ))
            .collect();
        let result = delete(&fx.roots, &paths);

        assert_eq!(result.deleted.len(), 2);
        assert_eq!(result.freed_bytes, 8);
        assert_eq!(result.failed.len(), 5);
        assert!(!pasted.exists() && !copy.exists());
        assert!(!copies.exists(), "emptied uuid folder is removed");
        assert!(fx.roots.pasted.exists(), "pasted folder is kept");
        assert!(outside.exists() && stray.exists());
    }
}
