//! SQLite storage for activity events and AI notes. Lives in `monocode.db`
//! next to sessions, so it shares one connection, backup, and migration path.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;

/// Hard cap per day query so a runaway recorder cannot stall the view.
const LIST_LIMIT: i64 = 5_000;

pub fn ensure_activity_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS activity_events (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           ts INTEGER NOT NULL,
           kind TEXT NOT NULL,
           block_id TEXT NOT NULL,
           session_id TEXT NOT NULL,
           harness TEXT NOT NULL,
           model TEXT NOT NULL DEFAULT '',
           cwd TEXT NOT NULL,
           branch TEXT,
           title TEXT NOT NULL DEFAULT '',
           text TEXT NOT NULL DEFAULT '',
           duration_ms INTEGER,
           UNIQUE (kind, block_id)
         );
         CREATE INDEX IF NOT EXISTS activity_events_ts_idx
           ON activity_events (ts);
         CREATE TABLE IF NOT EXISTS activity_notes (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           ts INTEGER NOT NULL,
           first_event_id INTEGER NOT NULL,
           last_event_id INTEGER NOT NULL,
           body TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS activity_notes_ts_idx
           ON activity_notes (ts);",
    )
}

/// One prompt sent, or one agent turn finished.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEvent {
    pub id: i64,
    pub ts: i64,
    /// `prompt` or `turn`.
    pub kind: String,
    pub session_id: String,
    pub harness: String,
    pub model: String,
    pub cwd: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    pub title: String,
    /// Prompt text, or a short excerpt of the agent's final reply.
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
}

/// An AI-written log entry covering a run of events.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityNote {
    pub id: i64,
    pub ts: i64,
    pub first_event_id: i64,
    pub last_event_id: i64,
    pub body: String,
}

/// A validated event ready to insert.
pub struct NewEvent<'a> {
    pub ts: i64,
    pub kind: &'a str,
    pub block_id: &'a str,
    pub session_id: &'a str,
    pub harness: &'a str,
    pub model: &'a str,
    pub cwd: &'a str,
    pub branch: Option<&'a str>,
    pub title: &'a str,
    pub text: &'a str,
    pub duration_ms: Option<i64>,
}

const EVENT_COLUMNS: &str =
    "id, ts, kind, session_id, harness, model, cwd, branch, title, text, duration_ms";

fn read_event(row: &Row<'_>) -> rusqlite::Result<ActivityEvent> {
    Ok(ActivityEvent {
        id: row.get(0)?,
        ts: row.get(1)?,
        kind: row.get(2)?,
        session_id: row.get(3)?,
        harness: row.get(4)?,
        model: row.get(5)?,
        cwd: row.get(6)?,
        branch: row.get(7)?,
        title: row.get(8)?,
        text: row.get(9)?,
        duration_ms: row.get(10)?,
    })
}

fn read_note(row: &Row<'_>) -> rusqlite::Result<ActivityNote> {
    Ok(ActivityNote {
        id: row.get(0)?,
        ts: row.get(1)?,
        first_event_id: row.get(2)?,
        last_event_id: row.get(3)?,
        body: row.get(4)?,
    })
}

/// Insert an event. Returns `(event, inserted)`; a repeat of the same
/// `(kind, block_id)` returns the stored row with `inserted = false`, so a
/// double-fired React effect cannot double-count a prompt.
pub fn insert_event(
    conn: &Connection,
    event: &NewEvent<'_>,
) -> rusqlite::Result<(ActivityEvent, bool)> {
    let changed = conn.execute(
        "INSERT OR IGNORE INTO activity_events
           (ts, kind, block_id, session_id, harness, model, cwd, branch, title, text, duration_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            event.ts,
            event.kind,
            event.block_id,
            event.session_id,
            event.harness,
            event.model,
            event.cwd,
            event.branch,
            event.title,
            event.text,
            event.duration_ms,
        ],
    )?;
    let stored = conn.query_row(
        &format!("SELECT {EVENT_COLUMNS} FROM activity_events WHERE kind = ?1 AND block_id = ?2"),
        params![event.kind, event.block_id],
        read_event,
    )?;
    Ok((stored, changed > 0))
}

pub fn list_events(
    conn: &Connection,
    start: i64,
    end: i64,
) -> rusqlite::Result<Vec<ActivityEvent>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {EVENT_COLUMNS} FROM activity_events
         WHERE ts >= ?1 AND ts < ?2
         ORDER BY ts ASC, id ASC
         LIMIT ?3"
    ))?;
    let rows = stmt.query_map(params![start, end, LIST_LIMIT], read_event)?;
    rows.collect()
}

pub fn list_notes(conn: &Connection, start: i64, end: i64) -> rusqlite::Result<Vec<ActivityNote>> {
    let mut stmt = conn.prepare(
        "SELECT id, ts, first_event_id, last_event_id, body FROM activity_notes
         WHERE ts >= ?1 AND ts < ?2
         ORDER BY ts ASC, id ASC
         LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![start, end, LIST_LIMIT], read_note)?;
    rows.collect()
}

pub fn insert_note(
    conn: &Connection,
    ts: i64,
    first_event_id: i64,
    last_event_id: i64,
    body: &str,
) -> rusqlite::Result<ActivityNote> {
    conn.execute(
        "INSERT INTO activity_notes (ts, first_event_id, last_event_id, body)
         VALUES (?1, ?2, ?3, ?4)",
        params![ts, first_event_id, last_event_id, body],
    )?;
    Ok(ActivityNote {
        id: conn.last_insert_rowid(),
        ts,
        first_event_id,
        last_event_id,
        body: body.to_string(),
    })
}

/// Highest event id any note covers; events above it still need a note.
pub fn last_noted_event_id(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COALESCE(MAX(last_event_id), 0) FROM activity_notes",
        [],
        |row| row.get(0),
    )
}

/// Events after `after_id` and no older than `since_ts`, oldest first.
pub fn unnoted_events(
    conn: &Connection,
    after_id: i64,
    since_ts: i64,
    limit: usize,
) -> rusqlite::Result<Vec<ActivityEvent>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {EVENT_COLUMNS} FROM activity_events
         WHERE id > ?1 AND ts >= ?2
         ORDER BY id ASC
         LIMIT ?3"
    ))?;
    let limit = i64::try_from(limit).unwrap_or(i64::MAX);
    let rows = stmt.query_map(params![after_id, since_ts, limit], read_event)?;
    rows.collect()
}

pub fn latest_note(conn: &Connection) -> rusqlite::Result<Option<ActivityNote>> {
    conn.query_row(
        "SELECT id, ts, first_event_id, last_event_id, body FROM activity_notes
         ORDER BY id DESC LIMIT 1",
        [],
        read_note,
    )
    .optional()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_store::SessionStore;

    fn new_event<'a>(ts: i64, kind: &'a str, block_id: &'a str) -> NewEvent<'a> {
        NewEvent {
            ts,
            kind,
            block_id,
            session_id: "s1",
            harness: "claude",
            model: "opus",
            cwd: "/code/hari",
            branch: Some("main"),
            title: "Title",
            text: "hello",
            duration_ms: None,
        }
    }

    #[test]
    fn migration_creates_tables_and_dedupes_events() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let (first, inserted) = insert_event(&conn, &new_event(10, "prompt", "b1")).unwrap();
        assert!(inserted);
        let (again, inserted) = insert_event(&conn, &new_event(99, "prompt", "b1")).unwrap();
        assert!(!inserted);
        assert_eq!(first, again);
        // Same block, different kind, is a separate event.
        let (turn, inserted) = insert_event(&conn, &new_event(20, "turn", "b1")).unwrap();
        assert!(inserted);
        assert_ne!(turn.id, first.id);
        assert_eq!(list_events(&conn, 0, 100).unwrap().len(), 2);
        assert_eq!(list_events(&conn, 15, 100).unwrap(), vec![turn]);
    }

    #[test]
    fn tracks_which_events_still_need_notes() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let (a, _) = insert_event(&conn, &new_event(10, "prompt", "a")).unwrap();
        let (b, _) = insert_event(&conn, &new_event(20, "prompt", "b")).unwrap();
        let (c, _) = insert_event(&conn, &new_event(30, "prompt", "c")).unwrap();
        assert_eq!(last_noted_event_id(&conn).unwrap(), 0);
        assert!(latest_note(&conn).unwrap().is_none());

        let note = insert_note(&conn, 25, a.id, b.id, "- did a and b").unwrap();
        assert_eq!(last_noted_event_id(&conn).unwrap(), b.id);
        assert_eq!(latest_note(&conn).unwrap(), Some(note.clone()));
        assert_eq!(unnoted_events(&conn, b.id, 0, 10).unwrap(), vec![c.clone()]);
        // Too old to replay.
        assert!(unnoted_events(&conn, b.id, 31, 10).unwrap().is_empty());
        assert_eq!(list_notes(&conn, 0, 100).unwrap(), vec![note]);
    }
}
