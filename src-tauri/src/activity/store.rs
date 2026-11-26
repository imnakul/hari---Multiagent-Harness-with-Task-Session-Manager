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
         );
         CREATE TABLE IF NOT EXISTS phone_usage (
           device TEXT NOT NULL,
           package TEXT NOT NULL,
           label TEXT NOT NULL,
           start INTEGER NOT NULL,
           end INTEGER NOT NULL,
           PRIMARY KEY (device, package, start)
         );
         CREATE INDEX IF NOT EXISTS phone_usage_end_idx ON phone_usage (end);
         CREATE TABLE IF NOT EXISTS phone_devices (
           device TEXT PRIMARY KEY,
           name TEXT NOT NULL,
           last_sync INTEGER NOT NULL
         );",
    )?;
    migrate_notes_columns(conn)
}

/// Fork (L-397): hourly notes. Adds `kind`, `span_start` and `span_end` to a
/// database made before them (older rows are prompt notes) and the unique
/// index that makes a repeated hourly insert a no-op. Safe to run every start.
fn migrate_notes_columns(conn: &Connection) -> rusqlite::Result<()> {
    let mut existing: Vec<String> = Vec::new();
    {
        let mut stmt = conn.prepare("PRAGMA table_info(activity_notes)")?;
        let names = stmt.query_map([], |row| row.get::<_, String>(1))?;
        for name in names {
            existing.push(name?);
        }
    }
    for (column, definition) in [
        ("kind", "TEXT NOT NULL DEFAULT 'prompts'"),
        ("span_start", "INTEGER"),
        ("span_end", "INTEGER"),
    ] {
        if !existing.iter().any(|name| name == column) {
            conn.execute_batch(&format!(
                "ALTER TABLE activity_notes ADD COLUMN {column} {definition}"
            ))?;
        }
    }
    conn.execute_batch(
        "CREATE UNIQUE INDEX IF NOT EXISTS activity_notes_hourly_idx
           ON activity_notes (kind, span_start) WHERE kind = 'hourly'",
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
    /// `prompts` (a run of prompts) or `hourly` (a clock hour with desktop activity but no prompts).
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span_start: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span_end: Option<i64>,
}

const NOTE_COLUMNS: &str =
    "id, ts, first_event_id, last_event_id, body, kind, span_start, span_end";

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
        kind: row.get(5)?,
        span_start: row.get(6)?,
        span_end: row.get(7)?,
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
    let mut stmt = conn.prepare(&format!(
        "SELECT {NOTE_COLUMNS} FROM activity_notes
         WHERE ts >= ?1 AND ts < ?2
         ORDER BY ts ASC, id ASC
         LIMIT ?3"
    ))?;
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
        kind: "prompts".to_string(),
        span_start: None,
        span_end: None,
    })
}

/// Stores the note for one clock hour. A second note for the same hour is
/// ignored (returns `None`), so a retry or a second wake never duplicates it.
/// `last_event_id` stays 0 so prompt batching never counts it as covering events.
pub fn insert_hourly_note(
    conn: &Connection,
    ts: i64,
    span_start: i64,
    span_end: i64,
    body: &str,
) -> rusqlite::Result<Option<ActivityNote>> {
    let changed = conn.execute(
        "INSERT OR IGNORE INTO activity_notes
           (ts, first_event_id, last_event_id, body, kind, span_start, span_end)
         VALUES (?1, 0, 0, ?2, 'hourly', ?3, ?4)",
        params![ts, body, span_start, span_end],
    )?;
    if changed == 0 {
        return Ok(None);
    }
    Ok(Some(ActivityNote {
        id: conn.last_insert_rowid(),
        ts,
        first_event_id: 0,
        last_event_id: 0,
        body: body.to_string(),
        kind: "hourly".to_string(),
        span_start: Some(span_start),
        span_end: Some(span_end),
    }))
}

/// Start times of the hourly notes at or after `since`, so finished hours are skipped.
pub fn hourly_note_starts(conn: &Connection, since: i64) -> rusqlite::Result<Vec<i64>> {
    let mut stmt = conn.prepare(
        "SELECT span_start FROM activity_notes
         WHERE kind = 'hourly' AND span_start >= ?1",
    )?;
    let rows = stmt.query_map(params![since], |row| row.get::<_, i64>(0))?;
    rows.collect()
}

/// How many events fall in `[start, end)`.
pub fn count_events(conn: &Connection, start: i64, end: i64) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM activity_events WHERE ts >= ?1 AND ts < ?2",
        params![start, end],
        |row| row.get(0),
    )
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

/// The newest prompt note (hourly notes never count: they cover no events).
pub fn latest_note(conn: &Connection) -> rusqlite::Result<Option<ActivityNote>> {
    conn.query_row(
        &format!(
            "SELECT {NOTE_COLUMNS} FROM activity_notes
             WHERE kind = 'prompts' ORDER BY id DESC LIMIT 1"
        ),
        [],
        read_note,
    )
    .optional()
}

/// The newest note of any kind, used as context for the next hourly note.
pub fn latest_note_any(conn: &Connection) -> rusqlite::Result<Option<ActivityNote>> {
    conn.query_row(
        &format!("SELECT {NOTE_COLUMNS} FROM activity_notes ORDER BY ts DESC, id DESC LIMIT 1"),
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

/// One interval of phone screen time, already validated (L-398).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PhoneInterval {
    pub package: String,
    pub label: String,
    pub start: i64,
    pub end: i64,
}

/// A phone that has synced screen time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneDevice {
    pub device: String,
    pub name: String,
    pub last_sync: i64,
}

/// Rows older than this are deleted on every sync.
const PHONE_KEEP_MS: i64 = 400 * 24 * 60 * 60 * 1000;

/// Stores intervals idempotently (a repeat of the same (device, package, start)
/// only updates end and label), records the device, and prunes old rows.
pub fn upsert_phone_usage(
    conn: &Connection,
    device: &str,
    name: &str,
    now: i64,
    intervals: &[PhoneInterval],
) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO phone_usage (device, package, label, start, end)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(device, package, start) DO UPDATE SET
               end = excluded.end, label = excluded.label",
        )?;
        for interval in intervals {
            stmt.execute(params![
                device,
                interval.package,
                interval.label,
                interval.start,
                interval.end
            ])?;
        }
    }
    tx.execute(
        "INSERT INTO phone_devices (device, name, last_sync) VALUES (?1, ?2, ?3)
         ON CONFLICT(device) DO UPDATE SET name = excluded.name, last_sync = excluded.last_sync",
        params![device, name, now],
    )?;
    tx.execute(
        "DELETE FROM phone_usage WHERE end < ?1",
        params![now - PHONE_KEEP_MS],
    )?;
    tx.commit()
}

/// Where the phone should resume: its newest stored end minus a 10 minute
/// overlap (harmless, the upsert dedupes), or None for a new device.
pub fn phone_cursor(conn: &Connection, device: &str) -> rusqlite::Result<Option<i64>> {
    let newest: Option<i64> = conn.query_row(
        "SELECT MAX(end) FROM phone_usage WHERE device = ?1",
        params![device],
        |row| row.get(0),
    )?;
    Ok(newest.map(|end| end - 10 * 60_000))
}

pub fn phone_devices(conn: &Connection) -> rusqlite::Result<Vec<PhoneDevice>> {
    let mut stmt = conn
        .prepare("SELECT device, name, last_sync FROM phone_devices ORDER BY last_sync DESC")?;
    let rows = stmt.query_map([], |row| {
        Ok(PhoneDevice {
            device: row.get(0)?,
            name: row.get(1)?,
            last_sync: row.get(2)?,
        })
    })?;
    rows.collect()
}

/// Phone intervals overlapping [start, end) as (label, start, end).
pub fn phone_rows(
    conn: &Connection,
    start: i64,
    end: i64,
) -> rusqlite::Result<Vec<(String, i64, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT label, start, end FROM phone_usage
         WHERE end > ?1 AND start < ?2
         ORDER BY start ASC
         LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![start, end, LIST_LIMIT * 5], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
    })?;
    rows.collect()
}

/// Clips intervals to [start, end), sums time per app label (busiest first)
/// and merges the intervals into non-overlapping spans.
pub fn phone_summary(
    rows: &[(String, i64, i64)],
    start: i64,
    end: i64,
) -> (Vec<(String, i64)>, Vec<(i64, i64)>) {
    let mut totals: Vec<(String, i64)> = Vec::new();
    let mut clipped: Vec<(i64, i64)> = Vec::new();
    for (label, from, to) in rows {
        let from = (*from).max(start);
        let to = (*to).min(end);
        if to <= from {
            continue;
        }
        clipped.push((from, to));
        match totals.iter_mut().find(|(name, _)| name == label) {
            Some((_, ms)) => *ms += to - from,
            None => totals.push((label.clone(), to - from)),
        }
    }
    totals.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    clipped.sort_unstable();
    let mut spans: Vec<(i64, i64)> = Vec::new();
    for (from, to) in clipped {
        match spans.last_mut() {
            Some(last) if from <= last.1 => last.1 = last.1.max(to),
            _ => spans.push((from, to)),
        }
    }
    (totals, spans)
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
    fn hourly_notes_are_unique_per_hour_and_do_not_cover_events() {
        let db = ActivityDb::open_in_memory();
        let conn = db.conn.lock().unwrap();
        let hour = 3_600_000;
        let first = insert_hourly_note(&conn, 5 * hour + 120_000, 4 * hour, 5 * hour, "- read docs")
            .unwrap()
            .expect("inserted");
        assert_eq!(first.kind, "hourly");
        assert!(insert_hourly_note(&conn, 5 * hour + 300_000, 4 * hour, 5 * hour, "- again")
            .unwrap()
            .is_none());
        assert_eq!(hourly_note_starts(&conn, 0).unwrap(), vec![4 * hour]);
        assert!(hourly_note_starts(&conn, 5 * hour).unwrap().is_empty());
        // An hourly note is not a prompt batch.
        assert_eq!(last_noted_event_id(&conn).unwrap(), 0);
        assert!(latest_note(&conn).unwrap().is_none());
        assert_eq!(latest_note_any(&conn).unwrap().map(|n| n.body), Some("- read docs".into()));
        insert_event(&conn, &new_event(4 * hour + 10, "prompt", "x")).unwrap();
        assert_eq!(count_events(&conn, 4 * hour, 5 * hour).unwrap(), 1);
        assert_eq!(count_events(&conn, 5 * hour, 6 * hour).unwrap(), 0);
    }

    #[test]
    fn an_old_notes_table_gains_the_hourly_columns_and_keeps_its_notes() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE activity_notes (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               ts INTEGER NOT NULL,
               first_event_id INTEGER NOT NULL,
               last_event_id INTEGER NOT NULL,
               body TEXT NOT NULL
             );
             INSERT INTO activity_notes (ts, first_event_id, last_event_id, body)
               VALUES (10, 1, 2, '- old note');",
        )
        .unwrap();
        ensure_activity_tables(&conn).unwrap();
        // Running again is harmless.
        ensure_activity_tables(&conn).unwrap();
        let notes = list_notes(&conn, 0, 100).unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].kind, "prompts");
        assert_eq!(notes[0].span_start, None);
        assert_eq!(notes[0].body, "- old note");
    }

    fn interval(package: &str, label: &str, start: i64, end: i64) -> PhoneInterval {
        PhoneInterval {
            package: package.into(),
            label: label.into(),
            start,
            end,
        }
    }

    #[test]
    fn phone_usage_upserts_once_reports_a_cursor_and_prunes() {
        let db = ActivityDb::open_in_memory();
        let conn = db.conn.lock().unwrap();
        let day = 24 * 60 * 60 * 1000;
        let now = 500 * day;
        assert_eq!(phone_cursor(&conn, "dev-00000001").unwrap(), None);
        let batch = vec![
            interval("com.a", "A", now - 3_600_000, now - 3_000_000),
            interval("com.b", "B", now - 2_000_000, now - 1_000_000),
        ];
        upsert_phone_usage(&conn, "dev-00000001", "Pixel", now, &batch).unwrap();
        // The same intervals again, one of them longer: still two rows.
        let mut again = batch.clone();
        again[1].end = now - 500_000;
        upsert_phone_usage(&conn, "dev-00000001", "Pixel 9", now + 1, &again).unwrap();
        let rows = phone_rows(&conn, 0, now + day).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1].2, now - 500_000);
        assert_eq!(
            phone_cursor(&conn, "dev-00000001").unwrap(),
            Some(now - 500_000 - 10 * 60_000)
        );
        assert_eq!(phone_cursor(&conn, "dev-00000002").unwrap(), None);
        let devices = phone_devices(&conn).unwrap();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].name, "Pixel 9");
        // A row older than 400 days goes on the next sync.
        let old = vec![interval("com.old", "Old", 1_000, 2_000)];
        upsert_phone_usage(&conn, "dev-00000001", "Pixel 9", now, &old).unwrap();
        assert!(phone_rows(&conn, 0, 10_000).unwrap().is_empty());
    }

    #[test]
    fn phone_summary_clips_sums_and_merges() {
        let rows = vec![
            ("Chat".to_string(), 0, 600_000),
            ("Maps".to_string(), 500_000, 800_000),
            ("Chat".to_string(), 900_000, 1_200_000),
            ("Gone".to_string(), 2_000_000, 3_000_000),
        ];
        let (apps, spans) = phone_summary(&rows, 100_000, 1_000_000);
        assert_eq!(
            apps,
            vec![("Chat".to_string(), 600_000), ("Maps".to_string(), 300_000)]
        );
        assert_eq!(spans, vec![(100_000, 800_000), (900_000, 1_000_000)]);
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
