use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::session_store::{now_millis, validate_id, SessionStore};

const TITLE_MAX: usize = 200;
const BODY_MAX: usize = 1_000_000;
const TAG_MAX: usize = 48;
const TAGS_MAX: usize = 20;
const PROJECT_CWD_MAX: usize = 4096;
const SOURCE_BLOCK_ID_MAX: usize = 512;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Draft,
    Todo,
    InProgress,
    Blocked,
    Review,
    Completed,
    Deferred,
}

impl TaskStatus {
    /// Statuses that mean the task was actually worked on.
    fn was_worked_on(self) -> bool {
        matches!(
            self,
            Self::InProgress | Self::Blocked | Self::Review | Self::Completed
        )
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Todo => "todo",
            Self::InProgress => "in_progress",
            Self::Blocked => "blocked",
            Self::Review => "review",
            Self::Completed => "completed",
            Self::Deferred => "deferred",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "draft" => Self::Draft,
            "todo" => Self::Todo,
            "in_progress" => Self::InProgress,
            "blocked" => Self::Blocked,
            "review" => Self::Review,
            "completed" => Self::Completed,
            "deferred" => Self::Deferred,
            _ => return None,
        })
    }
}

// No `Eq`: `sort_order` is a float.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub body: String,
    pub status: TaskStatus,
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_block_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<i64>,
    /// Local calendar day (`YYYY-MM-DD`) the task is pinned to Focus.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focus_date: Option<String>,
    /// Past local days the task sat in focus before moving on (R2/R3 history).
    #[serde(default)]
    pub focus_days: Vec<String>,
    /// When the task was archived; archived tasks stay in their status.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<i64>,
    /// Manual position inside a board column (lower first).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_order: Option<f64>,
}

/// A full task replacement. Callers merge partial edits before invoking this.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskUpsert {
    pub id: String,
    pub title: String,
    pub body: String,
    pub status: TaskStatus,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub project_cwd: Option<String>,
    #[serde(default)]
    pub source_session_id: Option<String>,
    #[serde(default)]
    pub source_block_id: Option<String>,
    #[serde(default)]
    pub focus_date: Option<String>,
    /// History carried by full-replacement upserts; the server merges it with
    /// the stored history and R2/R3 additions (never drops entries by itself).
    #[serde(default)]
    pub focus_days: Vec<String>,
    /// Local day (`YYYY-MM-DD`) of the writer, sent whenever `focus_date` is
    /// in the changes. Used only to apply R2/R3; never stored.
    #[serde(default)]
    pub today: Option<String>,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub sort_order: Option<f64>,
}

/// Initialize or upgrade the independent task table before creating its indexes.
/// Older local databases may already have `tasks` without the current columns;
/// CREATE TABLE IF NOT EXISTS alone does not upgrade those databases.
pub fn ensure_tasks_table(conn: &Connection) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS tasks (
           id TEXT PRIMARY KEY,
           title TEXT NOT NULL,
           body TEXT NOT NULL DEFAULT '',
           status TEXT NOT NULL DEFAULT 'todo'
             CHECK (status IN ('draft', 'todo', 'in_progress', 'blocked',
                               'review', 'completed', 'deferred')),
           tags_json TEXT NOT NULL DEFAULT '[]',
           project_cwd TEXT,
           source_session_id TEXT,
           source_block_id TEXT,
           created_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL,
            completed_at INTEGER,
            focus_date TEXT,
            focus_days_json TEXT NOT NULL DEFAULT '[]',
            archived_at INTEGER,
            sort_order REAL
          );",
    )?;
    let columns = {
        let mut statement = tx.prepare("SELECT name FROM pragma_table_info('tasks')")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    if !columns
        .iter()
        .any(|column| column.eq_ignore_ascii_case("id"))
    {
        return Err(rusqlite::Error::InvalidColumnName(
            "tasks.id (cannot upgrade an existing Tasks table without record IDs)".into(),
        ));
    }
    // Add only missing fields. Existing columns, values, and legacy metadata
    // are preserved; records with no prior status become Todos. Fixed SQL
    // declarations provide safe defaults for populated tables.
    for (name, declaration) in [
        ("title", "TEXT NOT NULL DEFAULT 'Untitled task'"),
        ("body", "TEXT NOT NULL DEFAULT ''"),
        (
            "status",
            "TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('draft', 'todo', 'in_progress', 'blocked', 'review', 'completed', 'deferred'))",
        ),
        ("tags_json", "TEXT NOT NULL DEFAULT '[]'"),
        ("project_cwd", "TEXT"),
        ("source_session_id", "TEXT"),
        ("source_block_id", "TEXT"),
        ("created_at", "INTEGER NOT NULL DEFAULT 0"),
        ("updated_at", "INTEGER NOT NULL DEFAULT 0"),
        ("completed_at", "INTEGER"),
        ("focus_date", "TEXT"),
        ("focus_days_json", "TEXT NOT NULL DEFAULT '[]'"),
        ("archived_at", "INTEGER"),
        ("sort_order", "REAL"),
    ] {
        if !columns.iter().any(|column| column.eq_ignore_ascii_case(name)) {
            tx.execute_batch(&format!("ALTER TABLE tasks ADD COLUMN {name} {declaration};"))?;
        }
    }
    tx.execute_batch(
        "CREATE INDEX IF NOT EXISTS tasks_project_updated_idx
           ON tasks (project_cwd, updated_at DESC, id ASC);
         CREATE INDEX IF NOT EXISTS tasks_status_updated_idx
           ON tasks (status, updated_at DESC, id ASC);",
    )?;
    tx.commit()
}

#[tauri::command]
pub async fn tasks_list(app: tauri::AppHandle) -> Result<Vec<Task>, String> {
    crate::background_work::store(app, move |app| {
        tasks_list_blocking(tauri::Manager::state(app))
    })
    .await
}

pub(crate) fn tasks_list_blocking(store: State<'_, SessionStore>) -> Result<Vec<Task>, String> {
    store.read(|conn| list_tasks(conn).map_err(|error| error.to_string()))
}

#[tauri::command]
pub async fn tasks_get(app: tauri::AppHandle, id: String) -> Result<Option<Task>, String> {
    crate::background_work::store(app, move |app| {
        tasks_get_blocking(tauri::Manager::state(app), id)
    })
    .await
}

pub(crate) fn tasks_get_blocking(
    store: State<'_, SessionStore>,
    id: String,
) -> Result<Option<Task>, String> {
    validate_id(&id, "task")?;
    let conn = store.lock_conn()?;
    get_task(&conn, &id).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn tasks_upsert(app: tauri::AppHandle, task: TaskUpsert) -> Result<Task, String> {
    crate::background_work::store(app, move |app| {
        tasks_upsert_blocking(tauri::Manager::state(app), task)
    })
    .await
}

pub(crate) fn tasks_upsert_blocking(
    store: State<'_, SessionStore>,
    task: TaskUpsert,
) -> Result<Task, String> {
    validate_task_upsert(&task)?;
    let conn = store.lock_conn()?;
    upsert_task(&conn, &task).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn tasks_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    crate::background_work::store(app, move |app| {
        tasks_delete_blocking(app.clone(), tauri::Manager::state(app), id)
    })
    .await
}

pub(crate) fn tasks_delete_blocking(
    app: AppHandle,
    store: State<'_, SessionStore>,
    id: String,
) -> Result<(), String> {
    validate_id(&id, "task")?;
    let conn = store.lock_conn()?;
    delete_task(&conn, &id).map_err(|error| error.to_string())?;
    drop(conn);
    // Same as notes: the row deletion is authoritative, image cleanup is best effort.
    let _ = crate::notes::remove_note_assets(&app, &id);
    Ok(())
}

fn validate_task_upsert(task: &TaskUpsert) -> Result<(), String> {
    validate_id(&task.id, "task")?;
    if task.body.len() > BODY_MAX {
        return Err("Task is too large".into());
    }
    validate_optional_id(task.source_session_id.as_deref(), "session")?;
    if let Some(day) = task
        .focus_date
        .as_deref()
        .map(str::trim)
        .filter(|day| !day.is_empty())
    {
        if !is_calendar_day(day) {
            return Err("Invalid task focus date".into());
        }
    }
    if let Some(day) = task
        .today
        .as_deref()
        .map(str::trim)
        .filter(|day| !day.is_empty())
    {
        if !is_calendar_day(day) {
            return Err("Invalid task today".into());
        }
    }
    for day in &task.focus_days {
        if !is_calendar_day(day.trim()) {
            return Err("Invalid task focus history".into());
        }
    }
    if task.sort_order.is_some_and(|order| !order.is_finite()) {
        return Err("Invalid task order".into());
    }
    validate_optional_block_id(task.source_block_id.as_deref())?;
    if let Some(project_cwd) = task.project_cwd.as_deref() {
        let project_cwd = project_cwd.trim();
        if project_cwd.is_empty()
            || project_cwd.len() > PROJECT_CWD_MAX
            || project_cwd.chars().any(char::is_control)
        {
            return Err("Invalid task project path".into());
        }
    }
    Ok(())
}

/// `YYYY-MM-DD` with a plausible month and day. The calendar day is local to
/// the user, so it is stored as text rather than a timestamp.
fn is_calendar_day(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    let digits = |range: std::ops::Range<usize>| -> Option<u32> {
        let part = &value[range];
        part.bytes()
            .all(|b| b.is_ascii_digit())
            .then(|| part.parse().ok())?
    };
    matches!(
        (digits(0..4), digits(5..7), digits(8..10)),
        (Some(_), Some(1..=12), Some(1..=31))
    )
}

fn validate_optional_id(value: Option<&str>, label: &str) -> Result<(), String> {
    if let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) {
        validate_id(value, label)?;
    }
    Ok(())
}

/// Block IDs can be provider-scoped opaque values such as `cline:native-id`.
/// Keep them bounded and control-free without applying the stricter session
/// and record ID alphabet to provider-owned identifiers.
fn validate_optional_block_id(value: Option<&str>) -> Result<(), String> {
    if let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) {
        if value.len() > SOURCE_BLOCK_ID_MAX || value.chars().any(char::is_control) {
            return Err("Invalid task source block id".into());
        }
    }
    Ok(())
}

fn list_tasks(conn: &Connection) -> rusqlite::Result<Vec<Task>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, body, status, tags_json, project_cwd,
                source_session_id, source_block_id, created_at, updated_at, completed_at,
                focus_date, focus_days_json, archived_at, sort_order
         FROM tasks
         ORDER BY updated_at DESC, id ASC",
    )?;
    let rows = stmt.query_map([], read_task)?;
    rows.collect()
}

fn get_task(conn: &Connection, id: &str) -> rusqlite::Result<Option<Task>> {
    conn.query_row(
        "SELECT id, title, body, status, tags_json, project_cwd,
                source_session_id, source_block_id, created_at, updated_at, completed_at,
                focus_date, focus_days_json, archived_at, sort_order
         FROM tasks
         WHERE id = ?1",
        params![id],
        read_task,
    )
    .optional()
}

/// Local day (`YYYY-MM-DD`) of a millis timestamp, in the machine's timezone.
/// SQLite's `localtime` modifier shares the OS timezone with the frontend's
/// `localDay()`, so R3 sees the same created day the UI does.
fn local_day_of(conn: &Connection, at_millis: i64) -> rusqlite::Result<String> {
    conn.query_row(
        "SELECT date(?1 / 1000, 'unixepoch', 'localtime')",
        params![at_millis],
        |row| row.get(0),
    )
}

/// R2/R3: on a change of `focus_date` from O to N (N = none included), the
/// frontend sends `today`. Only a task that was worked on (its status before or
/// after the update is in progress, blocked, review or completed) records
/// history; Draft/Todo/Deferred tasks record nothing, so a deferred untouched
/// task leaves today's focus. O is recorded when O < today, or when O == today
/// and N is another day. When O is none, R3 treats the created day C as O when
/// C < today.
fn focus_history_addition(
    old_focus_date: Option<&str>,
    new_focus_date: Option<&str>,
    created_day: Option<&str>,
    today: &str,
    old_status: TaskStatus,
    new_status: TaskStatus,
) -> Option<String> {
    if old_focus_date == new_focus_date {
        return None;
    }
    if !old_status.was_worked_on() && !new_status.was_worked_on() {
        return None;
    }
    let effective_old = match old_focus_date {
        Some(day) => Some(day),
        None => match created_day {
            Some(created) if created < today => Some(created),
            _ => None,
        },
    };
    let old = effective_old?;
    if old < today {
        Some(old.to_string())
    } else if old == today {
        match new_focus_date {
            Some(next) if next != today => Some(old.to_string()),
            _ => None,
        }
    } else {
        None
    }
}

fn normalize_focus_days(days: &[String]) -> Vec<String> {
    let mut kept: Vec<String> = days
        .iter()
        .map(|day| day.trim().to_string())
        .filter(|day| is_calendar_day(day))
        .collect();
    kept.sort();
    kept.dedup();
    kept
}

fn upsert_task(conn: &Connection, input: &TaskUpsert) -> rusqlite::Result<Task> {
    let title = normalize_title(&input.title);
    let body = input.body.replace("\r\n", "\n").replace('\r', "\n");
    let status = input.status.as_str();
    let tags = normalize_tags(&input.tags);
    let tags_json = serde_json::to_string(&tags)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let project_cwd = clean_optional(input.project_cwd.as_deref());
    let source_session_id = clean_optional(input.source_session_id.as_deref());
    let source_block_id = clean_optional(input.source_block_id.as_deref());
    let focus_date = clean_optional(input.focus_date.as_deref());
    let today = clean_optional(input.today.as_deref());
    let sort_order = input.sort_order.filter(|order| order.is_finite());
    let now = now_millis();

    // R2/R3 history is computed in the same transaction as the focus_date
    // write, so a concurrent edit cannot drop the recorded day.
    let tx = conn.unchecked_transaction()?;
    let previous: Option<Task> = tx
        .query_row(
            "SELECT id, title, body, status, tags_json, project_cwd,
                    source_session_id, source_block_id, created_at, updated_at, completed_at,
                    focus_date, focus_days_json, archived_at, sort_order
             FROM tasks
             WHERE id = ?1",
            params![input.id],
            read_task,
        )
        .optional()?;
    let mut focus_days = normalize_focus_days(&input.focus_days);
    if let Some(stored) = previous.as_ref() {
        for day in normalize_focus_days(&stored.focus_days) {
            if !focus_days.contains(&day) {
                focus_days.push(day);
            }
        }
        focus_days.sort();
        if let Some(day) = today.as_deref() {
            // New rows have no previous focus; R3 still applies when an
            // existing row never had a focus date (created day before today).
            let created_day = local_day_of(&tx, stored.created_at).ok();
            let addition = focus_history_addition(
                stored.focus_date.as_deref(),
                focus_date.as_deref(),
                created_day.as_deref(),
                day,
                stored.status,
                input.status,
            );
            if let Some(record) = addition {
                if !focus_days.contains(&record) {
                    focus_days.push(record);
                    focus_days.sort();
                }
            }
        }
    }
    let focus_days_json = serde_json::to_string(&focus_days)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;

    // Completion time and created time transitions are evaluated by one
    // SQLite statement, so an edit racing a completion cannot reset the time.
    tx.execute(
        "INSERT INTO tasks (
           id, title, body, status, tags_json, project_cwd,
           source_session_id, source_block_id, created_at, updated_at, completed_at,
           focus_date, focus_days_json, archived_at, sort_order
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9,
                   CASE WHEN ?4 = 'completed' THEN ?9 ELSE NULL END,
                   ?10, ?11, CASE WHEN ?12 THEN ?9 ELSE NULL END, ?13)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           body = excluded.body,
           status = excluded.status,
           tags_json = excluded.tags_json,
           project_cwd = excluded.project_cwd,
           source_session_id = excluded.source_session_id,
           source_block_id = excluded.source_block_id,
           focus_date = excluded.focus_date,
           focus_days_json = excluded.focus_days_json,
           sort_order = excluded.sort_order,
           archived_at = CASE
             WHEN ?12 AND tasks.archived_at IS NULL THEN excluded.updated_at
             WHEN ?12 THEN tasks.archived_at
             ELSE NULL END,
           updated_at = CASE
             WHEN tasks.title IS NOT excluded.title
               OR tasks.body IS NOT excluded.body
               OR tasks.status IS NOT excluded.status
               OR tasks.tags_json IS NOT excluded.tags_json
               OR tasks.project_cwd IS NOT excluded.project_cwd
               OR tasks.source_session_id IS NOT excluded.source_session_id
               OR tasks.source_block_id IS NOT excluded.source_block_id
               OR tasks.focus_date IS NOT excluded.focus_date
               OR tasks.focus_days_json IS NOT excluded.focus_days_json
               OR (tasks.archived_at IS NULL) = ?12
             THEN excluded.updated_at ELSE tasks.updated_at END,
           completed_at = CASE
             WHEN excluded.status = 'completed' AND tasks.status <> 'completed'
               THEN excluded.completed_at
             WHEN excluded.status = 'completed' THEN tasks.completed_at
             ELSE NULL END",
        params![
            input.id,
            title,
            body,
            status,
            tags_json,
            project_cwd,
            source_session_id,
            source_block_id,
            now,
            focus_date,
            focus_days_json,
            input.archived,
            sort_order,
        ],
    )?;
    let saved: Task = tx
        .query_row(
            "SELECT id, title, body, status, tags_json, project_cwd,
                    source_session_id, source_block_id, created_at, updated_at, completed_at,
                    focus_date, focus_days_json, archived_at, sort_order
             FROM tasks
             WHERE id = ?1",
            params![input.id],
            read_task,
        )
        .map_err(|_| rusqlite::Error::QueryReturnedNoRows)?;
    tx.commit()?;
    Ok(saved)
}

fn delete_task(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
    Ok(())
}

fn read_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    let status_text: String = row.get(3)?;
    let status = TaskStatus::parse(&status_text).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            3,
            rusqlite::types::Type::Text,
            format!("Invalid task status: {status_text}").into(),
        )
    })?;
    let tags_json: String = row.get(4)?;
    let tags = serde_json::from_str::<Vec<String>>(&tags_json).unwrap_or_default();
    let focus_days_json: String = row.get(12).unwrap_or_else(|_| "[]".to_string());
    let focus_days = serde_json::from_str::<Vec<String>>(&focus_days_json).unwrap_or_default();
    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        body: row.get(2)?,
        status,
        tags,
        project_cwd: row.get(5)?,
        source_session_id: row.get(6)?,
        source_block_id: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        completed_at: row.get(10)?,
        focus_date: row.get(11)?,
        focus_days: normalize_focus_days(&focus_days),
        archived_at: row.get(13)?,
        sort_order: row.get(14)?,
    })
}

fn clean_optional(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut normalized = Vec::new();
    for input in tags {
        let tag = input
            .trim()
            .trim_start_matches('#')
            .split_whitespace()
            .collect::<Vec<_>>()
            .join("-")
            .to_lowercase();
        let tag: String = tag.chars().take(TAG_MAX).collect();
        let tag = tag.trim_end_matches('-').to_string();
        if tag.is_empty() || normalized.contains(&tag) {
            continue;
        }
        normalized.push(tag);
        if normalized.len() == TAGS_MAX {
            break;
        }
    }
    normalized
}

fn normalize_title(title: &str) -> String {
    let trimmed = title.trim();
    let sliced: String = trimmed.chars().take(TITLE_MAX).collect();
    let sliced = sliced.trim().to_string();
    if sliced.is_empty() {
        "Untitled task".into()
    } else {
        sliced
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_store::SessionStore;

    fn input(id: &str, status: TaskStatus) -> TaskUpsert {
        TaskUpsert {
            id: id.into(),
            title: "Task title".into(),
            body: "Markdown body".into(),
            status,
            tags: Vec::new(),
            project_cwd: None,
            source_session_id: None,
            source_block_id: None,
            focus_date: None,
            focus_days: Vec::new(),
            today: None,
            archived: false,
            sort_order: None,
        }
    }

    /// A worked-on (in progress) task, so focus history applies.
    fn with_focus(id: &str, focus_date: Option<&str>, today: Option<&str>) -> TaskUpsert {
        with_focus_status(id, TaskStatus::InProgress, focus_date, today)
    }

    fn with_focus_status(
        id: &str,
        status: TaskStatus,
        focus_date: Option<&str>,
        today: Option<&str>,
    ) -> TaskUpsert {
        TaskUpsert {
            focus_date: focus_date.map(str::to_string),
            today: today.map(str::to_string),
            ..input(id, status)
        }
    }

    #[test]
    fn session_store_initializes_an_independent_tasks_table() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'tasks'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        ensure_tasks_table(&conn).unwrap();
        let still_one: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'tasks'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(still_one, 1);
        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 21, "tasks do not add a global migration version");
    }

    #[test]
    fn tasks_and_deletions_survive_reopening_the_session_database() {
        let path =
            std::env::temp_dir().join(format!("monocode-tasks-{}.sqlite", uuid::Uuid::new_v4()));
        let expected = {
            let store = SessionStore::open(path.clone()).unwrap();
            let conn = store.lock_conn().unwrap();
            let mut project = input("persistent-project", TaskStatus::Completed);
            project.project_cwd = Some("C:/Work/Mono".into());
            project.tags = vec!["windows".into()];
            project.source_session_id = Some("source-session".into());
            project.source_block_id = Some("cline:42".into());
            let saved = upsert_task(&conn, &project).unwrap();
            upsert_task(&conn, &input("persistent-personal", TaskStatus::Deferred)).unwrap();
            saved
        };
        {
            let store = SessionStore::open(path.clone()).unwrap();
            let conn = store.lock_conn().unwrap();
            assert_eq!(
                get_task(&conn, &expected.id).unwrap(),
                Some(expected.clone())
            );
            assert_eq!(list_tasks(&conn).unwrap().len(), 2);
            assert_eq!(
                get_task(&conn, "persistent-personal")
                    .unwrap()
                    .unwrap()
                    .project_cwd,
                None
            );
            delete_task(&conn, &expected.id).unwrap();
        }
        {
            let store = SessionStore::open(path.clone()).unwrap();
            let conn = store.lock_conn().unwrap();
            assert!(get_task(&conn, &expected.id).unwrap().is_none());
            assert_eq!(list_tasks(&conn).unwrap().len(), 1);
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn legacy_schema_is_upgraded_before_indexes_without_rewriting_rows() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE tasks (
               id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
               project_cwd TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
               legacy_metadata TEXT
             );
             INSERT INTO tasks VALUES (
               'legacy-task', 'Existing task', '# Keep this Markdown',
               'C:/Work/Mono', 100, 200, 'keep unknown legacy data'
             );",
        )
        .unwrap();
        ensure_tasks_table(&conn).unwrap();
        let task = get_task(&conn, "legacy-task").unwrap().unwrap();
        assert_eq!(task.title, "Existing task");
        assert_eq!(task.body, "# Keep this Markdown");
        assert_eq!(task.project_cwd.as_deref(), Some("C:/Work/Mono"));
        assert_eq!((task.created_at, task.updated_at), (100, 200));
        assert_eq!(task.status, TaskStatus::Todo);
        assert!(task.tags.is_empty());
        assert_eq!(task.source_session_id, None);
        assert_eq!(task.source_block_id, None);
        assert_eq!(task.completed_at, None);
        let legacy: String = conn
            .query_row(
                "SELECT legacy_metadata FROM tasks WHERE id = 'legacy-task'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(legacy, "keep unknown legacy data");
        let indexes: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index'
             AND name IN ('tasks_project_updated_idx', 'tasks_status_updated_idx')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(indexes, 2);
        let completed = upsert_task(&conn, &input("legacy-task", TaskStatus::Completed)).unwrap();
        ensure_tasks_table(&conn).unwrap();
        assert_eq!(get_task(&conn, "legacy-task").unwrap(), Some(completed));
        delete_task(&conn, "legacy-task").unwrap();
        assert!(list_tasks(&conn).unwrap().is_empty());
    }

    #[test]
    fn older_tasks_schema_survives_session_store_startup_and_reopen() {
        let path = std::env::temp_dir().join(format!(
            "monocode-legacy-tasks-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        {
            let store = SessionStore::open(path.clone()).unwrap();
            let conn = store.lock_conn().unwrap();
            conn.execute_batch(
                "DROP TABLE tasks;
                 CREATE TABLE tasks (
                   id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
                   tags_json TEXT NOT NULL, project_cwd TEXT, source_session_id TEXT,
                   source_block_id TEXT, created_at INTEGER NOT NULL,
                   updated_at INTEGER NOT NULL, completed_at INTEGER
                 );
                 INSERT INTO tasks VALUES (
                   'old-task', 'Old task', '| Keep |\n| --- |\n| Table |',
                   '[\"legacy\"]', 'C:/Work/Mono', 'source-session', 'cline:42', 123, 456, NULL
                 );
                 INSERT INTO notes (id, slug, title, body, tags_json, created_at, updated_at)
                   VALUES ('existing-note', 'existing-note', 'Existing note', 'Keep note', '[]', 1, 2);
                 INSERT INTO sessions (id, cwd, harness, model, runtime_mode, title, created_at, updated_at)
                   VALUES ('existing-session', 'C:/Work/Mono', 'codex', '', 'supervised', 'Keep session', 1, 2);"
            ).unwrap();
        }
        for _ in 0..2 {
            let store = SessionStore::open(path.clone()).unwrap();
            let conn = store.lock_conn().unwrap();
            let task = get_task(&conn, "old-task").unwrap().unwrap();
            assert_eq!(task.title, "Old task");
            assert_eq!(task.body, "| Keep |\n| --- |\n| Table |");
            assert_eq!(task.tags, vec!["legacy"]);
            assert_eq!(task.status, TaskStatus::Todo);
            assert_eq!(task.project_cwd.as_deref(), Some("C:/Work/Mono"));
            assert_eq!(task.source_session_id.as_deref(), Some("source-session"));
            assert_eq!(task.source_block_id.as_deref(), Some("cline:42"));
            assert_eq!((task.created_at, task.updated_at), (123, 456));
            assert_eq!(
                conn.query_row(
                    "SELECT body FROM notes WHERE id = 'existing-note'",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
                "Keep note"
            );
            assert_eq!(
                conn.query_row(
                    "SELECT title FROM sessions WHERE id = 'existing-session'",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
                "Keep session"
            );
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn failed_schema_upgrade_rolls_back_added_columns_and_indexes() {
        let unidentified = Connection::open_in_memory().unwrap();
        unidentified.execute_batch(
            "CREATE TABLE tasks (title TEXT); INSERT INTO tasks VALUES ('Keep unidentified record');"
        ).unwrap();
        assert!(ensure_tasks_table(&unidentified)
            .unwrap_err()
            .to_string()
            .contains("without record IDs"));
        assert_eq!(
            unidentified
                .query_row("SELECT title FROM tasks", [], |row| row.get::<_, String>(0))
                .unwrap(),
            "Keep unidentified record"
        );

        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL);
             INSERT INTO tasks VALUES ('legacy', 'Keep me');
             CREATE TABLE tasks_status_updated_idx (placeholder TEXT);",
        )
        .unwrap();
        assert!(ensure_tasks_table(&conn).is_err());
        let columns: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('tasks')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(columns, 2);
        let indexes: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'tasks_project_updated_idx'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(indexes, 0);
        assert_eq!(
            conn.query_row("SELECT title FROM tasks WHERE id = 'legacy'", [], |row| row
                .get::<_, String>(0))
                .unwrap(),
            "Keep me"
        );
        conn.execute_batch("DROP TABLE tasks_status_updated_idx;")
            .unwrap();
        ensure_tasks_table(&conn).unwrap();
        assert_eq!(get_task(&conn, "legacy").unwrap().unwrap().title, "Keep me");
    }

    #[test]
    fn task_crud_normalizes_fields_and_full_upserts_clear_omitted_options() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let mut first = input("task-1", TaskStatus::Todo);
        first.title = "  Write tasks  ".into();
        first.body = "first\r\nsecond".into();
        first.tags = vec!["#Road Map".into(), "road-map".into(), "Other".into()];
        first.project_cwd = Some(" /work/project ".into());
        first.source_session_id = Some("session-1".into());
        first.source_block_id = Some("cline:native-42".into());
        validate_task_upsert(&first).unwrap();
        let created = upsert_task(&conn, &first).unwrap();
        assert_eq!(created.title, "Write tasks");
        assert_eq!(created.body, "first\nsecond");
        assert_eq!(created.tags, vec!["road-map", "other"]);
        assert_eq!(created.project_cwd.as_deref(), Some("/work/project"));
        assert_eq!(created.source_session_id.as_deref(), Some("session-1"));
        assert_eq!(created.source_block_id.as_deref(), Some("cline:native-42"));
        assert_eq!(created.status, TaskStatus::Todo);

        std::thread::sleep(std::time::Duration::from_millis(5));
        let mut replacement = input("task-1", TaskStatus::InProgress);
        replacement.title = "Continue implementation".into();
        replacement.body = "Updated body".into();
        replacement.tags = vec!["Implementation".into()];
        let updated = upsert_task(&conn, &replacement).unwrap();
        assert_eq!(updated.created_at, created.created_at);
        assert!(updated.updated_at > created.updated_at);
        assert_eq!(updated.title, "Continue implementation");
        assert_eq!(updated.tags, vec!["implementation"]);
        assert_eq!(updated.project_cwd, None);
        assert_eq!(updated.source_session_id, None);
        assert_eq!(updated.source_block_id, None);
        assert_eq!(get_task(&conn, "task-1").unwrap(), Some(updated.clone()));
        assert_eq!(list_tasks(&conn).unwrap(), vec![updated]);

        delete_task(&conn, "task-1").unwrap();
        assert!(get_task(&conn, "task-1").unwrap().is_none());
        delete_task(&conn, "missing-task").unwrap();
        assert!(get_task(&conn, "missing-task").unwrap().is_none());
        assert!(list_tasks(&conn).unwrap().is_empty());
    }

    #[test]
    fn every_canonical_status_round_trips_and_serializes_with_its_stable_id() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let cases = [
            (TaskStatus::Draft, "draft"),
            (TaskStatus::Todo, "todo"),
            (TaskStatus::InProgress, "in_progress"),
            (TaskStatus::Blocked, "blocked"),
            (TaskStatus::Review, "review"),
            (TaskStatus::Completed, "completed"),
            (TaskStatus::Deferred, "deferred"),
        ];

        for (index, (status, serialized)) in cases.into_iter().enumerate() {
            let id = format!("status-{index}");
            let task = upsert_task(&conn, &input(&id, status)).unwrap();
            assert_eq!(task.status, status);
            assert_eq!(serde_json::to_value(status).unwrap(), serialized);
            assert_eq!(get_task(&conn, &id).unwrap().unwrap().status, status);
        }
        assert_eq!(list_tasks(&conn).unwrap().len(), cases.len());
    }

    #[test]
    fn completion_time_is_set_once_preserved_on_edits_and_cleared_on_reopen() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let completed = upsert_task(&conn, &input("done-1", TaskStatus::Completed)).unwrap();
        let first_completed_at = completed.completed_at.unwrap();
        assert_eq!(completed.status, TaskStatus::Completed);

        std::thread::sleep(std::time::Duration::from_millis(5));
        let mut edit = input("done-1", TaskStatus::Completed);
        edit.body = "Edited after completion".into();
        let edited = upsert_task(&conn, &edit).unwrap();
        assert_eq!(edited.completed_at, Some(first_completed_at));
        assert_eq!(edited.created_at, completed.created_at);
        assert!(edited.updated_at > completed.updated_at);

        let reopened = upsert_task(&conn, &input("done-1", TaskStatus::Todo)).unwrap();
        assert_eq!(reopened.completed_at, None);
        std::thread::sleep(std::time::Duration::from_millis(5));
        let completed_again = upsert_task(&conn, &input("done-1", TaskStatus::Completed)).unwrap();
        assert!(completed_again.completed_at.unwrap() > first_completed_at);
    }

    #[test]
    fn task_validation_rejects_bad_ids_sizes_provenance_and_project_paths() {
        let mut task = input("bad/id", TaskStatus::Todo);
        assert!(validate_task_upsert(&task).is_err());

        task = input("task-1", TaskStatus::Todo);
        task.body = "x".repeat(BODY_MAX + 1);
        assert!(validate_task_upsert(&task).is_err());

        task = input("task-1", TaskStatus::Todo);
        task.source_session_id = Some("bad/session".into());
        assert!(validate_task_upsert(&task).is_err());

        task = input("task-1", TaskStatus::Todo);
        task.source_block_id = Some("bad\nblock".into());
        assert!(validate_task_upsert(&task).is_err());

        task.source_block_id = Some("x".repeat(SOURCE_BLOCK_ID_MAX + 1));
        assert!(validate_task_upsert(&task).is_err());

        task = input("task-1", TaskStatus::Todo);
        task.project_cwd = Some("/work\0/project".into());
        assert!(validate_task_upsert(&task).is_err());
        task.project_cwd = Some("x".repeat(PROJECT_CWD_MAX + 1));
        assert!(validate_task_upsert(&task).is_err());

        assert!(serde_json::from_str::<TaskStatus>("\"todo\"").is_ok());
        assert!(serde_json::from_str::<TaskStatus>("\"in_progress\"").is_ok());
        assert!(serde_json::from_str::<TaskStatus>("\"unknown\"").is_err());
    }

    #[test]
    fn focus_date_archive_and_order_round_trip_without_touching_other_fields() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let mut task = input("focus-task", TaskStatus::Todo);
        let created = upsert_task(&conn, &task).unwrap();
        assert_eq!(created.focus_date, None);
        assert_eq!(created.archived_at, None);

        task.focus_date = Some("2026-10-03".into());
        task.archived = true;
        task.sort_order = Some(1.5);
        let archived = upsert_task(&conn, &task).unwrap();
        assert_eq!(archived.focus_date.as_deref(), Some("2026-10-03"));
        assert!(archived.archived_at.is_some());
        assert_eq!(archived.sort_order, Some(1.5));
        assert_eq!(
            archived.status,
            TaskStatus::Todo,
            "archive keeps the status"
        );

        // Saving again while archived keeps the original archive time.
        let again = upsert_task(&conn, &task).unwrap();
        assert_eq!(again.archived_at, archived.archived_at);

        task.archived = false;
        task.focus_date = None;
        let restored = upsert_task(&conn, &task).unwrap();
        assert_eq!(restored.archived_at, None);
        assert_eq!(restored.focus_date, None);
    }

    #[test]
    fn rejects_malformed_focus_dates_and_orders() {
        let mut task = input("bad-focus", TaskStatus::Todo);
        task.focus_date = Some("03/10/2026".into());
        assert!(validate_task_upsert(&task).is_err());
        task.focus_date = Some("2026-13-01".into());
        assert!(validate_task_upsert(&task).is_err());
        task.focus_date = Some("2026-10-03".into());
        assert!(validate_task_upsert(&task).is_ok());
        task.sort_order = Some(f64::NAN);
        assert!(validate_task_upsert(&task).is_err());
    }

    #[test]
    fn upgrades_a_tasks_table_without_focus_archive_or_order_columns() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE tasks (
               id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
               status TEXT NOT NULL DEFAULT 'todo', tags_json TEXT NOT NULL DEFAULT '[]',
               project_cwd TEXT, source_session_id TEXT, source_block_id TEXT,
               created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER);
             INSERT INTO tasks (id, title, status, created_at, updated_at)
               VALUES ('old', 'Old task', 'completed', 1, 1);",
        )
        .unwrap();
        ensure_tasks_table(&conn).unwrap();
        let old = get_task(&conn, "old").unwrap().unwrap();
        assert_eq!(old.title, "Old task");
        assert_eq!(old.status, TaskStatus::Completed);
        assert_eq!(old.focus_date, None);
        assert!(old.focus_days.is_empty());
        assert_eq!(old.archived_at, None);
        assert_eq!(old.sort_order, None);
    }

    fn local_day(conn: &Connection, modifier: &str) -> String {
        let query = if modifier.is_empty() {
            "SELECT date('now', 'localtime')".to_string()
        } else {
            format!("SELECT date('now', '{modifier}', 'localtime')")
        };
        conn.query_row(&query, [], |row| row.get(0)).unwrap()
    }

    fn backdate_created(conn: &Connection, id: &str, modifier: &str) {
        conn.execute(
            &format!(
                "UPDATE tasks SET created_at = \
                 (strftime('%s', 'now', '{modifier}') * 1000) WHERE id = ?1"
            ),
            params![id],
        )
        .unwrap();
    }

    #[test]
    fn focus_history_records_a_past_day_when_moving_on() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let today = local_day(&conn, "");
        let yesterday = local_day(&conn, "-1 day");
        upsert_task(&conn, &with_focus("hist-1", Some(&yesterday), None)).unwrap();
        let moved = upsert_task(&conn, &with_focus("hist-1", Some(&today), Some(&today))).unwrap();
        assert_eq!(moved.focus_days, vec![yesterday.clone()]);
        // Re-saving without a focus change records nothing more.
        let again = upsert_task(&conn, &with_focus("hist-1", Some(&today), Some(&today))).unwrap();
        assert_eq!(again.focus_days, vec![yesterday]);
    }

    #[test]
    fn focus_history_follows_the_task_status() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let today = local_day(&conn, "");
        let tomorrow = local_day(&conn, "+1 day");
        let later = local_day(&conn, "+3 days");
        // A todo task pinned today and deferred records nothing.
        let todo = with_focus_status("hist-a", TaskStatus::Todo, Some(&today), None);
        upsert_task(&conn, &todo).unwrap();
        let moved = with_focus_status("hist-a", TaskStatus::Todo, Some(&later), Some(&today));
        assert!(upsert_task(&conn, &moved).unwrap().focus_days.is_empty());
        // A task in progress records today when moved to another day.
        let work = with_focus_status("hist-b", TaskStatus::InProgress, Some(&today), None);
        upsert_task(&conn, &work).unwrap();
        let planned = with_focus_status(
            "hist-b",
            TaskStatus::InProgress,
            Some(&tomorrow),
            Some(&today),
        );
        assert_eq!(
            upsert_task(&conn, &planned).unwrap().focus_days,
            vec![today.clone()]
        );
        // Becoming completed in the same update counts as worked on.
        let pinned = with_focus_status("hist-c", TaskStatus::Todo, Some(&today), None);
        upsert_task(&conn, &pinned).unwrap();
        let done = with_focus_status(
            "hist-c",
            TaskStatus::Completed,
            Some(&tomorrow),
            Some(&today),
        );
        assert_eq!(
            upsert_task(&conn, &done).unwrap().focus_days,
            vec![today.clone()]
        );
        // Unpinning today records nothing, whatever the status.
        let pinned = with_focus_status("hist-d", TaskStatus::InProgress, Some(&today), None);
        upsert_task(&conn, &pinned).unwrap();
        let unpinned = with_focus_status("hist-d", TaskStatus::InProgress, None, Some(&today));
        assert!(upsert_task(&conn, &unpinned).unwrap().focus_days.is_empty());
    }

    #[test]
    fn focus_history_carry_over_depends_on_status() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let today = local_day(&conn, "");
        let yesterday = local_day(&conn, "-1 day");
        let todo = with_focus_status("hist-e", TaskStatus::Todo, Some(&yesterday), None);
        upsert_task(&conn, &todo).unwrap();
        let carried = with_focus_status("hist-e", TaskStatus::Todo, Some(&today), Some(&today));
        assert!(upsert_task(&conn, &carried).unwrap().focus_days.is_empty());
        let work = with_focus_status("hist-f", TaskStatus::InProgress, Some(&yesterday), None);
        upsert_task(&conn, &work).unwrap();
        let carried =
            with_focus_status("hist-f", TaskStatus::InProgress, Some(&today), Some(&today));
        assert_eq!(
            upsert_task(&conn, &carried).unwrap().focus_days,
            vec![yesterday]
        );
    }

    #[test]
    fn focus_history_ignores_moves_between_future_days() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let today = local_day(&conn, "");
        let tomorrow = local_day(&conn, "+1 day");
        let day_after = local_day(&conn, "+2 days");
        upsert_task(&conn, &with_focus("hist-4", Some(&tomorrow), None)).unwrap();
        let moved =
            upsert_task(&conn, &with_focus("hist-4", Some(&day_after), Some(&today))).unwrap();
        assert!(moved.focus_days.is_empty());
        // Planning for the first time on the same day records nothing (R3
        // needs the created day to be before today).
        let fresh =
            upsert_task(&conn, &with_focus("hist-5", Some(&tomorrow), Some(&today))).unwrap();
        assert!(fresh.focus_days.is_empty());
    }

    #[test]
    fn focus_history_uses_the_created_day_when_never_pinned() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let today = local_day(&conn, "");
        let yesterday = local_day(&conn, "-1 day");
        upsert_task(&conn, &with_focus("hist-6", None, None)).unwrap();
        backdate_created(&conn, "hist-6", "-1 day");
        let pinned = upsert_task(&conn, &with_focus("hist-6", Some(&today), Some(&today))).unwrap();
        assert_eq!(pinned.focus_days, vec![yesterday]);
    }

    #[test]
    fn focus_history_stays_sorted_without_duplicates_and_merges_inputs() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let mut seeded = input("hist-7", TaskStatus::Todo);
        seeded.focus_days = vec![
            "2026-10-10".into(),
            "2026-10-08".into(),
            "2026-10-10".into(),
            "bad-day".into(),
        ];
        let saved = upsert_task(&conn, &seeded).unwrap();
        assert_eq!(saved.focus_days, vec!["2026-10-08", "2026-10-10"]);
        // A later write without a focus change keeps stored days even when
        // the input omits them.
        let kept = upsert_task(&conn, &input("hist-7", TaskStatus::Todo)).unwrap();
        assert_eq!(kept.focus_days, vec!["2026-10-08", "2026-10-10"]);
    }

    #[test]
    fn focus_history_rejects_bad_today_and_history_values() {
        let mut task = input("bad-hist", TaskStatus::Todo);
        task.today = Some("tomorrow".into());
        assert!(validate_task_upsert(&task).is_err());
        task.today = Some("2026-10-07".into());
        task.focus_days = vec!["2026-13-01".into()];
        assert!(validate_task_upsert(&task).is_err());
    }
}
