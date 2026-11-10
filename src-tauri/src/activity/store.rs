//! SQLite storage for activity events, AI notes and period summaries.
//!
//! Lives in its own `activity.db` beside `monocode.db`: the tracker never
//! waits on the lock that saves chats, it can be wiped or trimmed without
//! touching them, and upstream's session store needs no fork changes.

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;

/// Hard cap per range query so a runaway recorder cannot stall the view
/// (a busy month is a few thousand rows).
const LIST_LIMIT: i64 = 20_000;

/// The tracker's own database. If it cannot be opened, Hari still starts and
/// every activity command reports the reason instead of silently doing nothing.
pub struct ActivityDb {
    conn: Mutex<Connection>,
    open_error: Option<String>,
}

impl ActivityDb {
    pub fn open(path: &Path) -> Self {
        match Self::try_open(path) {
            Ok(conn) => Self {
                conn: Mutex::new(conn),
                open_error: None,
            },
            Err(err) => {
                let reason = format!("Could not open {}: {err}", path.display());
                eprintln!("monocode: activity: {reason}");
                Self::fallback(reason)
            }
        }
    }

    fn try_open(path: &Path) -> Result<Connection, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;")
            .map_err(|e| e.to_string())?;
        ensure_activity_tables(&conn).map_err(|e| e.to_string())?;
        Ok(conn)
    }

    /// An in-memory stand-in that refuses work with `reason`.
    fn fallback(reason: String) -> Self {
        let conn = Connection::open_in_memory().expect("in-memory SQLite always opens");
        Self {
            conn: Mutex::new(conn),
            open_error: Some(reason),
        }
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Self {
        let conn = Connection::open_in_memory().expect("in-memory SQLite always opens");
        ensure_activity_tables(&conn).expect("activity tables");
        Self {
            conn: Mutex::new(conn),
            open_error: None,
        }
    }

    /// Run `work` on the connection. One writer at a time; reads are short.
    pub fn with<T>(
        &self,
        work: impl FnOnce(&Connection) -> rusqlite::Result<T>,
    ) -> Result<T, String> {
        if let Some(reason) = &self.open_error {
            return Err(reason.clone());
        }
        let conn: MutexGuard<'_, Connection> = self
            .conn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        work(&conn).map_err(|e| e.to_string())
    }
}

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
           ON activity_notes (ts);
         CREATE TABLE IF NOT EXISTS activity_summaries (
           period_key TEXT PRIMARY KEY,
           start_ms INTEGER NOT NULL,
           end_ms INTEGER NOT NULL,
           body TEXT NOT NULL,
           created_at INTEGER NOT NULL
         );",
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

/// A cached AI summary for a week or month (`week:2026-11-09`, `month:2026-11`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodSummary {
    pub key: String,
    pub start: i64,
    pub end: i64,
    pub body: String,
    pub created_at: i64,
}

pub fn get_summary(conn: &Connection, key: &str) -> rusqlite::Result<Option<PeriodSummary>> {
    conn.query_row(
        "SELECT period_key, start_ms, end_ms, body, created_at
         FROM activity_summaries WHERE period_key = ?1",
        params![key],
        |row| {
            Ok(PeriodSummary {
                key: row.get(0)?,
                start: row.get(1)?,
                end: row.get(2)?,
                body: row.get(3)?,
                created_at: row.get(4)?,
            })
        },
    )
    .optional()
}

pub fn put_summary(conn: &Connection, summary: &PeriodSummary) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO activity_summaries (period_key, start_ms, end_ms, body, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(period_key) DO UPDATE SET
           start_ms = excluded.start_ms, end_ms = excluded.end_ms,
           body = excluded.body, created_at = excluded.created_at",
        params![
            summary.key,
            summary.start,
            summary.end,
            summary.body,
            summary.created_at
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let db = ActivityDb::open_in_memory();
        let conn = db.conn.lock().unwrap();
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
        let db = ActivityDb::open_in_memory();
        let conn = db.conn.lock().unwrap();
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

    #[test]
    fn caches_and_replaces_period_summaries() {
        let db = ActivityDb::open_in_memory();
        let first = PeriodSummary {
            key: "week:2026-11-09".into(),
            start: 1,
            end: 2,
            body: "- first".into(),
            created_at: 10,
        };
        db.with(|conn| put_summary(conn, &first)).unwrap();
        let second = PeriodSummary {
            body: "- second".into(),
            created_at: 20,
            ..first.clone()
        };
        db.with(|conn| put_summary(conn, &second)).unwrap();
        assert_eq!(
            db.with(|conn| get_summary(conn, "week:2026-11-09"))
                .unwrap(),
            Some(second)
        );
        assert_eq!(
            db.with(|conn| get_summary(conn, "month:2026-11")).unwrap(),
            None
        );
    }

    #[test]
    fn a_db_that_failed_to_open_reports_why() {
        let db = ActivityDb::fallback("Could not open x: denied".into());
        assert_eq!(
            db.with(last_noted_event_id),
            Err("Could not open x: denied".into())
        );
    }

    #[test]
    fn opens_a_file_database_with_tables() {
        let dir = std::env::temp_dir().join(format!("hari-activity-db-{}", std::process::id()));
        let path = dir.join("nested/activity.db");
        let db = ActivityDb::open(&path);
        assert!(db.open_error.is_none());
        assert_eq!(db.with(last_noted_event_id), Ok(0));
        drop(db);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
