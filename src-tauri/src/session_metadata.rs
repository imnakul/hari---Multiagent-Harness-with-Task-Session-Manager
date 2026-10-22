//! Session metadata (L-181): a short label and markdown notes the user keeps
//! for any chat. Fork-only, so it lives in its own table instead of new
//! columns on upstream's `sessions`. No foreign key: upstream rewrites
//! `sessions` rows with `INSERT OR REPLACE`, which would cascade a delete;
//! `session_store::delete_session` removes the row in its transaction instead.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::session_store::{now_millis, validate_id, SessionStore};

/// Every window refreshes its labels on this event.
pub(crate) const CHANGED: &str = "monocode:session-metadata-changed";
const LABEL_MAX: usize = 120;
const NOTES_MAX: usize = 100_000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMetadata {
    pub session_id: String,
    pub label: String,
    pub notes: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMetadataUpsert {
    pub session_id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub notes: String,
}

pub(crate) fn ensure_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS session_metadata (
           session_id TEXT PRIMARY KEY,
           label TEXT NOT NULL DEFAULT '',
           notes TEXT NOT NULL DEFAULT '',
           updated_at INTEGER NOT NULL
         );",
    )
}

const SELECT: &str = "SELECT session_id, label, notes, updated_at FROM session_metadata";

fn row_to_metadata(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionMetadata> {
    Ok(SessionMetadata {
        session_id: row.get(0)?,
        label: row.get(1)?,
        notes: row.get(2)?,
        updated_at: row.get(3)?,
    })
}

fn list(conn: &Connection) -> rusqlite::Result<Vec<SessionMetadata>> {
    let mut statement = conn.prepare(&format!("{SELECT} ORDER BY session_id"))?;
    let rows = statement.query_map([], row_to_metadata)?;
    rows.collect()
}

fn get(conn: &Connection, session_id: &str) -> rusqlite::Result<Option<SessionMetadata>> {
    conn.query_row(
        &format!("{SELECT} WHERE session_id = ?1"),
        [session_id],
        row_to_metadata,
    )
    .optional()
}

/// One line: newlines and runs of whitespace become single spaces.
fn clean_label(label: &str) -> String {
    label.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn validate(metadata: &SessionMetadataUpsert) -> Result<(), String> {
    validate_id(&metadata.session_id, "session")?;
    if clean_label(&metadata.label).chars().count() > LABEL_MAX {
        return Err(format!("The label is longer than {LABEL_MAX} characters"));
    }
    if metadata.notes.len() > NOTES_MAX {
        return Err("The notes are too long".into());
    }
    Ok(())
}

/// Saves the label and notes. Both empty removes the row, so a cleared chat
/// shows its normal title again. Returns the saved row, or None when cleared.
fn upsert(
    conn: &Connection,
    metadata: &SessionMetadataUpsert,
    now: i64,
) -> rusqlite::Result<Option<SessionMetadata>> {
    let label = clean_label(&metadata.label);
    if label.is_empty() && metadata.notes.trim().is_empty() {
        delete(conn, &metadata.session_id)?;
        return Ok(None);
    }
    conn.execute(
        "INSERT INTO session_metadata (session_id, label, notes, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(session_id) DO UPDATE SET
           label = excluded.label,
           notes = excluded.notes,
           updated_at = excluded.updated_at",
        params![metadata.session_id, label, metadata.notes, now],
    )?;
    get(conn, &metadata.session_id)
}

pub(crate) fn delete(conn: &Connection, session_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM session_metadata WHERE session_id = ?1",
        [session_id],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn session_metadata_list(app: tauri::AppHandle) -> Result<Vec<SessionMetadata>, String> {
    crate::background_work::store(app, move |app| {
        session_metadata_list_blocking(tauri::Manager::state(app))
    })
    .await
}

pub(crate) fn session_metadata_list_blocking(
    store: State<'_, SessionStore>,
) -> Result<Vec<SessionMetadata>, String> {
    let conn = store.lock_conn()?;
    list(&conn).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn session_metadata_upsert(
    app: tauri::AppHandle,
    metadata: SessionMetadataUpsert,
) -> Result<Option<SessionMetadata>, String> {
    crate::background_work::store(app, move |app| {
        session_metadata_upsert_blocking(app.clone(), tauri::Manager::state(app), metadata)
    })
    .await
}

pub(crate) fn session_metadata_upsert_blocking(
    app: AppHandle,
    store: State<'_, SessionStore>,
    metadata: SessionMetadataUpsert,
) -> Result<Option<SessionMetadata>, String> {
    validate(&metadata)?;
    let conn = store.lock_conn()?;
    let saved = upsert(&conn, &metadata, now_millis()).map_err(|error| error.to_string())?;
    drop(conn);
    let _ = app.emit(CHANGED, ());
    Ok(saved)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn metadata(session_id: &str, label: &str, notes: &str) -> SessionMetadataUpsert {
        SessionMetadataUpsert {
            session_id: session_id.into(),
            label: label.into(),
            notes: notes.into(),
        }
    }

    #[test]
    fn saves_lists_and_updates_one_row_per_session() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        upsert(&conn, &metadata("b", "  Auth\nspike  ", "- [ ] cookie"), 1).unwrap();
        upsert(&conn, &metadata("a", "", "Only notes"), 2).unwrap();
        let saved = upsert(&conn, &metadata("b", "Auth spike 2", "done"), 3)
            .unwrap()
            .unwrap();
        assert_eq!(saved.label, "Auth spike 2");
        assert_eq!(saved.notes, "done");
        assert_eq!(saved.updated_at, 3);
        let rows = list(&conn).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].session_id, "a");
        assert_eq!(rows[0].label, "");
        assert_eq!(rows[1].label, "Auth spike 2");
    }

    #[test]
    fn the_label_is_kept_on_one_line() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let saved = upsert(&conn, &metadata("s", "  Auth\r\n  spike\t", ""), 1)
            .unwrap()
            .unwrap();
        assert_eq!(saved.label, "Auth spike");
    }

    #[test]
    fn clearing_both_fields_removes_the_row() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        upsert(&conn, &metadata("s", "Label", "Notes"), 1).unwrap();
        assert_eq!(upsert(&conn, &metadata("s", "  ", "\n"), 2).unwrap(), None);
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn rejects_bad_ids_and_oversized_fields() {
        assert!(validate(&metadata("../x", "Label", "")).is_err());
        assert!(validate(&metadata("s", &"x".repeat(LABEL_MAX + 1), "")).is_err());
        assert!(validate(&metadata("s", &"x".repeat(LABEL_MAX), "")).is_ok());
        assert!(validate(&metadata("s", "", &"x".repeat(NOTES_MAX + 1))).is_err());
        assert!(validate(&metadata("ok-id_1", "Fine", "Fine")).is_ok());
    }
}
