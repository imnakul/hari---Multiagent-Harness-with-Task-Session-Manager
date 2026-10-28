//! Session panel (L-191): the AI-written points (events, decisions, findings),
//! the "left off" line and the bookmarks shown in a chat's side panel. Fork-only,
//! so it lives in its own table, like `session_metadata`. The frontend owns the
//! JSON shape; this module only stores it, caps its size and tells every window.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::session_store::{now_millis, validate_id, SessionStore};

/// Every window reloads the chat's panel on this event; the payload is the id.
pub(crate) const CHANGED: &str = "monocode:session-panel-changed";
const DATA_MAX: usize = 400_000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPanel {
    pub session_id: String,
    pub data: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPanelSave {
    pub session_id: String,
    #[serde(default)]
    pub data: String,
}

pub(crate) fn ensure_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS session_panel (
           session_id TEXT PRIMARY KEY,
           data TEXT NOT NULL,
           updated_at INTEGER NOT NULL
         );",
    )
}

fn get(conn: &Connection, session_id: &str) -> rusqlite::Result<Option<SessionPanel>> {
    conn.query_row(
        "SELECT session_id, data, updated_at FROM session_panel WHERE session_id = ?1",
        [session_id],
        |row| {
            Ok(SessionPanel {
                session_id: row.get(0)?,
                data: row.get(1)?,
                updated_at: row.get(2)?,
            })
        },
    )
    .optional()
}

fn validate(panel: &SessionPanelSave) -> Result<(), String> {
    validate_id(&panel.session_id, "session")?;
    if panel.data.len() > DATA_MAX {
        return Err("The session panel is too large".into());
    }
    Ok(())
}

/// Saves the panel; empty data removes the row.
fn save(
    conn: &Connection,
    panel: &SessionPanelSave,
    now: i64,
) -> rusqlite::Result<Option<SessionPanel>> {
    if panel.data.trim().is_empty() {
        delete(conn, &panel.session_id)?;
        return Ok(None);
    }
    conn.execute(
        "INSERT INTO session_panel (session_id, data, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(session_id) DO UPDATE SET
           data = excluded.data,
           updated_at = excluded.updated_at",
        params![panel.session_id, panel.data, now],
    )?;
    get(conn, &panel.session_id)
}

pub(crate) fn delete(conn: &Connection, session_id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM session_panel WHERE session_id = ?1", [session_id])?;
    Ok(())
}

#[tauri::command]
pub async fn session_panel_get(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<Option<SessionPanel>, String> {
    crate::background_work::store(app, move |app| {
        session_panel_get_blocking(tauri::Manager::state(app), session_id)
    })
    .await
}

pub(crate) fn session_panel_get_blocking(
    store: State<'_, SessionStore>,
    session_id: String,
) -> Result<Option<SessionPanel>, String> {
    validate_id(&session_id, "session")?;
    let conn = store.lock_conn()?;
    get(&conn, &session_id).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn session_panel_save(
    app: tauri::AppHandle,
    panel: SessionPanelSave,
) -> Result<Option<SessionPanel>, String> {
    crate::background_work::store(app, move |app| {
        session_panel_save_blocking(app.clone(), tauri::Manager::state(app), panel)
    })
    .await
}

pub(crate) fn session_panel_save_blocking(
    app: AppHandle,
    store: State<'_, SessionStore>,
    panel: SessionPanelSave,
) -> Result<Option<SessionPanel>, String> {
    validate(&panel)?;
    let conn = store.lock_conn()?;
    let saved = save(&conn, &panel, now_millis()).map_err(|error| error.to_string())?;
    drop(conn);
    let _ = app.emit(CHANGED, panel.session_id.clone());
    Ok(saved)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn panel(session_id: &str, data: &str) -> SessionPanelSave {
        SessionPanelSave {
            session_id: session_id.into(),
            data: data.into(),
        }
    }

    #[test]
    fn saves_and_replaces_one_row_per_session() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        save(&conn, &panel("s", "{\"version\":1}"), 1).unwrap();
        let saved = save(&conn, &panel("s", "{\"version\":1,\"points\":[]}"), 2)
            .unwrap()
            .unwrap();
        assert_eq!(saved.data, "{\"version\":1,\"points\":[]}");
        assert_eq!(saved.updated_at, 2);
        assert_eq!(get(&conn, "other").unwrap(), None);
    }

    #[test]
    fn empty_data_removes_the_row() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        save(&conn, &panel("s", "{}"), 1).unwrap();
        assert_eq!(save(&conn, &panel("s", "  "), 2).unwrap(), None);
        assert_eq!(get(&conn, "s").unwrap(), None);
    }

    #[test]
    fn rejects_bad_ids_and_oversized_data() {
        assert!(validate(&panel("../x", "{}")).is_err());
        assert!(validate(&panel("s", &"x".repeat(DATA_MAX + 1))).is_err());
        assert!(validate(&panel("s", &"x".repeat(DATA_MAX))).is_ok());
    }
}
