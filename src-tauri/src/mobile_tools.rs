//! Fork (Hari, L-236): the phone's Tasks, Notes and link cards. These belong to
//! no window, so the desktop service answers them from its own store, then
//! tells every window to refresh. The only writes are task and note saves, the
//! same ones the desktop's own screens make.
use std::collections::HashMap;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::link_preview::fetch_link_preview_sync;
use crate::notes::{
    notes_get_blocking, notes_list_blocking, notes_upsert_blocking, Note, NoteUpsert,
};
use crate::tasks::{
    tasks_get_blocking, tasks_list_blocking, tasks_upsert_blocking, Task, TaskStatus, TaskUpsert,
};

const METHODS: [&str; 7] = [
    "tasks.list",
    "tasks.create",
    "tasks.update",
    "notes.list",
    "notes.read",
    "notes.save",
    "link.preview",
];
/// How much of a task or note the lists carry; the full text is read on open.
const EXCERPT_CHARS: usize = 300;
const TITLE_CHARS: usize = 200;

pub(crate) fn handles(method: &str) -> bool {
    METHODS.contains(&method)
}

pub(crate) async fn handle(app: &AppHandle, method: &str, params: Value) -> Result<Value, String> {
    let worker = app.clone();
    let name = method.to_owned();
    let result = tauri::async_runtime::spawn_blocking(move || run(&worker, &name, &params))
        .await
        .map_err(|error| error.to_string())??;
    if matches!(method, "tasks.create" | "tasks.update") {
        let _ = app.emit("monocode://tasks-changed", ());
    }
    if method == "notes.save" && result["conflict"] != true {
        let _ = app.emit("monocode://notes-changed", ());
    }
    Ok(result)
}

fn run(app: &AppHandle, method: &str, params: &Value) -> Result<Value, String> {
    match method {
        "tasks.list" => {
            let tasks = tasks_list_blocking(app.state())?;
            Ok(json!({ "tasks": tasks.iter().map(task_summary).collect::<Vec<_>>() }))
        }
        "tasks.create" => {
            let task = create_task(app, uuid::Uuid::new_v4().to_string(), params)?;
            Ok(json!({ "task": task_summary(&task) }))
        }
        "tasks.update" => {
            let id = text(params, "id");
            let task = tasks_get_blocking(app.state(), id)?.ok_or("This task was deleted")?;
            let task = update_task(app, task, params)?;
            Ok(json!({ "task": task_summary(&task) }))
        }
        "notes.list" => {
            let notes = notes_list_blocking(app.state())?;
            Ok(json!({ "notes": notes.iter().map(note_summary).collect::<Vec<_>>() }))
        }
        "notes.read" => {
            let note = notes_get_blocking(app.state(), text(params, "id"))?
                .ok_or("This note was deleted on your computer")?;
            Ok(json!({ "note": note }))
        }
        "notes.save" => save_note(app, params),
        "link.preview" => {
            let url = text(params, "url");
            let metadata = fetch_link_preview_sync(&url, params["image"] == true)?;
            serde_json::to_value(metadata).map_err(|error| error.to_string())
        }
        _ => Err("Unsupported mobile operation".into()),
    }
}

/// Saves a note unless it changed on the desktop since the phone read it
/// (`baseUpdatedAt`); then answers the desktop's copy instead, and saves only
/// once the phone asks again with `force`.
fn save_note(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let id = text(params, "id");
    let current = notes_get_blocking(app.state(), id.clone())?;
    if params["force"] != true {
        let base = params["baseUpdatedAt"].as_i64();
        let changed = match (&current, base) {
            (Some(note), Some(base)) => note.updated_at != base,
            // Deleted on the desktop while the phone had it open.
            (None, Some(_)) => true,
            // A new note from the phone that somehow exists already.
            (Some(_), None) => true,
            (None, None) => false,
        };
        if changed {
            return Ok(json!({ "conflict": true, "note": current }));
        }
    }
    let note = write_note(app, params, current)?;
    Ok(json!({ "conflict": false, "note": note }))
}

/// Writes the phone's note over `current` (the desktop's copy, if any).
fn write_note(app: &AppHandle, params: &Value, current: Option<Note>) -> Result<Note, String> {
    let id = text(params, "id");
    let body = text(params, "body").replace("\r\n", "\n");
    let title = match text(params, "title").trim() {
        "" => title_from(&body),
        given => clip(given, TITLE_CHARS),
    };
    notes_upsert_blocking(
        app.state(),
        NoteUpsert {
            id,
            title,
            body,
            tags: tags(params)
                .or_else(|| current.as_ref().map(|note| note.tags.clone()))
                .unwrap_or_default(),
            source_session_id: current
                .as_ref()
                .and_then(|note| note.source_session_id.clone())
                .or_else(|| optional(params, "sourceSessionId")),
            // Left out on an update, which keeps the saved project.
            source_cwd: if current.is_some() {
                None
            } else {
                optional(params, "sourceCwd")
            },
            finalize_slug: params["finalize"] == true,
        },
    )
}

fn create_task(app: &AppHandle, id: String, params: &Value) -> Result<Task, String> {
    let body = text(params, "body");
    let title = match text(params, "title").trim() {
        "" => title_from(&body),
        given => clip(given, TITLE_CHARS),
    };
    tasks_upsert_blocking(
        app.state(),
        TaskUpsert {
            id,
            title,
            body,
            status: TaskStatus::Todo,
            tags: tags(params).unwrap_or_default(),
            project_cwd: optional(params, "projectCwd"),
            source_session_id: optional(params, "sourceSessionId"),
            source_block_id: None,
            focus_date: None,
            focus_days: Vec::new(),
            today: None,
            archived: false,
            sort_order: None,
        },
    )
}

/// Applies the fields `params` carries to `task`; the rest stay as they are.
fn update_task(app: &AppHandle, task: Task, params: &Value) -> Result<Task, String> {
    let mut next = upsert_of(task);
    if let Some(status) = params.get("status").filter(|value| value.is_string()) {
        next.status = serde_json::from_value(status.clone())
            .map_err(|_| "Unknown task status".to_string())?;
    }
    if let Some(title) = params["title"]
        .as_str()
        .map(str::trim)
        .filter(|t| !t.is_empty())
    {
        next.title = clip(title, TITLE_CHARS);
    }
    if let Some(tags) = tags(params) {
        next.tags = tags;
    }
    if params.get("projectCwd").is_some() {
        next.project_cwd = optional(params, "projectCwd");
    }
    // Fork (L-243): the phone pins a task to a day, or unpins it, with
    // its own local day so the desktop records Focus history.
    if let Some(focus) = focus_change(params)? {
        next.focus_date = focus;
        next.today = optional(params, "today");
    }
    tasks_upsert_blocking(app.state(), next)
}

/// Fork (Hari, L-281): tells the paired phone that tasks or notes changed, so
/// it refreshes its offline copy. Called after every desktop write, whatever
/// made it (a window, an agent, the phone).
pub(crate) fn changed(kind: &str) {
    let signal = match kind {
        "tasks" => "tasks.changed",
        _ => "notes.changed",
    };
    let at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(0));
    crate::mobile_events::signal(signal, json!({ "at": at }));
}

pub(crate) const OUTBOX_KINDS: [&str; 3] = ["tasks.create", "tasks.update", "notes.save"];

/// The `updatedAt` each phone outbox write produced, by task or note id, so a
/// later queued edit of the same item (whose base is older) still applies.
static PHONE_WRITES: std::sync::LazyLock<std::sync::Mutex<HashMap<String, i64>>> =
    std::sync::LazyLock::new(Default::default);
const PHONE_WRITES_MAX: usize = 500;

fn recorded(id: &str) -> Option<i64> {
    PHONE_WRITES.lock().ok()?.get(id).copied()
}

fn record(id: &str, updated_at: i64) {
    if let Ok(mut writes) = PHONE_WRITES.lock() {
        if writes.len() >= PHONE_WRITES_MAX {
            writes.clear();
        }
        writes.insert(id.to_owned(), updated_at);
    }
}

/// Newer edit wins: the phone's offline edit applies when the desktop's copy is
/// the one the phone edited (`base`), or the phone's own last write, or older
/// than the edit itself (`edited_at`, the phone's clock).
fn phone_wins(base: Option<i64>, recorded: Option<i64>, current: i64, edited_at: i64) -> bool {
    base == Some(current) || recorded == Some(current) || edited_at > current
}

/// Fork (Hari, L-281): a task or note edit the phone made offline, from its
/// outbox. Deletes on the desktop stick, and an edit older than the desktop's
/// copy is dropped; the error tells the phone why.
pub(crate) fn receive(app: &AppHandle, kind: &str, payload: &Value) -> Result<(), String> {
    let edited_at = payload["editedAt"].as_i64().ok_or("Missing edit time")?;
    let base = payload["baseUpdatedAt"].as_i64();
    let id = text(payload, "id");
    match kind {
        "tasks.create" => {
            // Sent twice (the answer was lost): it exists already.
            if tasks_get_blocking(app.state(), id.clone())?.is_none() {
                let task = create_task(app, id, payload)?;
                record(&task.id, task.updated_at);
            }
            let _ = app.emit("monocode://tasks-changed", ());
        }
        "tasks.update" => {
            let task = tasks_get_blocking(app.state(), id.clone())?
                .ok_or("This task was deleted on your computer")?;
            if !phone_wins(base, recorded(&id), task.updated_at, edited_at) {
                return Err("This task changed on your computer after this edit".into());
            }
            let task = update_task(app, task, payload)?;
            record(&task.id, task.updated_at);
            let _ = app.emit("monocode://tasks-changed", ());
        }
        "notes.save" => {
            let current = notes_get_blocking(app.state(), id.clone())?;
            // Keep mine / Save again, chosen on the phone after a refusal.
            let force = payload["force"] == true;
            match (&current, base) {
                _ if force => {}
                (None, Some(_)) => return Err("This note was deleted on your computer".into()),
                (Some(note), _) if !phone_wins(base, recorded(&id), note.updated_at, edited_at) => {
                    return Err("This note changed on your computer after this edit".into());
                }
                _ => {}
            }
            let note = write_note(app, payload, current)?;
            record(&note.id, note.updated_at);
            let _ = app.emit("monocode://notes-changed", ());
        }
        _ => return Err("Unsupported item".into()),
    }
    Ok(())
}

/// The task as the phone's list shows it. Retired statuses read as Todo, and
/// Deferred as an archived Todo, as the desktop shows them.
fn task_summary(task: &Task) -> Value {
    let (status, deferred) = match task.status {
        TaskStatus::Draft => (TaskStatus::Todo, false),
        TaskStatus::Deferred => (TaskStatus::Todo, true),
        other => (other, false),
    };
    json!({
        "id": task.id,
        "title": task.title,
        "excerpt": clip(&task.body, EXCERPT_CHARS),
        "status": status,
        "tags": task.tags,
        "projectCwd": task.project_cwd,
        "sourceSessionId": task.source_session_id,
        "createdAt": task.created_at,
        "updatedAt": task.updated_at,
        "completedAt": task.completed_at,
        "archived": deferred || task.archived_at.is_some(),
        "focusDate": task.focus_date,
        "focusDays": task.focus_days,
    })
}

fn note_summary(note: &Note) -> Value {
    json!({
        "id": note.id,
        "title": note.title,
        "excerpt": clip(&note.body, EXCERPT_CHARS),
        "tags": note.tags,
        "sourceCwd": note.source_cwd,
        "updatedAt": note.updated_at,
    })
}

/// The upsert that keeps a task exactly as it is.
fn upsert_of(task: Task) -> TaskUpsert {
    let status = match task.status {
        TaskStatus::Draft | TaskStatus::Deferred => TaskStatus::Todo,
        other => other,
    };
    TaskUpsert {
        archived: task.archived_at.is_some() || task.status == TaskStatus::Deferred,
        id: task.id,
        title: task.title,
        body: task.body,
        status,
        tags: task.tags,
        project_cwd: task.project_cwd,
        source_session_id: task.source_session_id,
        source_block_id: task.source_block_id,
        focus_date: task.focus_date,
        focus_days: task.focus_days,
        today: None,
        sort_order: task.sort_order,
    }
}

/// A Focus change in `params`: `None` when `focusDate` is absent; otherwise the
/// day to pin to (`null` unpins). Every change must carry the phone's `today`.
fn focus_change(params: &Value) -> Result<Option<Option<String>>, String> {
    match params.get("focusDate") {
        None => Ok(None),
        Some(_) if optional(params, "today").is_none() => {
            Err("A Focus change needs the phone's day".into())
        }
        Some(Value::Null) => Ok(Some(None)),
        Some(Value::String(day)) if !day.trim().is_empty() => Ok(Some(Some(day.trim().to_owned()))),
        Some(_) => Err("Invalid task focus date".into()),
    }
}

fn text(params: &Value, key: &str) -> String {
    params[key].as_str().unwrap_or_default().to_owned()
}

fn optional(params: &Value, key: &str) -> Option<String> {
    params[key]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

/// Tags as the desktop keeps them: no leading `#`, dashes for spaces, lower
/// case, at most 20 of 48 characters each, no repeats.
fn tags(params: &Value) -> Option<Vec<String>> {
    let given = params["tags"].as_array()?;
    let mut tags: Vec<String> = Vec::new();
    for tag in given.iter().filter_map(Value::as_str) {
        let tag = tag
            .trim()
            .trim_start_matches('#')
            .split_whitespace()
            .collect::<Vec<_>>()
            .join("-")
            .to_lowercase();
        let tag = clip(&tag, 48).trim_end_matches('-').to_owned();
        if !tag.is_empty() && !tags.contains(&tag) {
            tags.push(tag);
        }
        if tags.len() == 20 {
            break;
        }
    }
    Some(tags)
}

fn clip(value: &str, chars: usize) -> String {
    value.chars().take(chars).collect()
}

/// The first heading or line of text, as a title, when none was given.
fn title_from(body: &str) -> String {
    let mut fenced = false;
    for line in body.lines() {
        let line = line.trim();
        if line.starts_with("```") {
            fenced = !fenced;
            continue;
        }
        if fenced || line.is_empty() || line == "---" {
            continue;
        }
        let line = line
            .trim_start_matches('#')
            .replace("**", "")
            .replace("__", "")
            .replace('`', "");
        let line = line.trim();
        if !line.is_empty() {
            return clip(line, TITLE_CHARS);
        }
    }
    "Untitled".into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_come_from_the_first_line_of_text() {
        assert_eq!(
            title_from("\n```\ncode\n```\n## **Plan** for today\nmore"),
            "Plan for today"
        );
        assert_eq!(title_from("  \n---\n"), "Untitled");
        assert_eq!(title_from("Buy milk"), "Buy milk");
    }

    #[test]
    fn tags_are_kept_as_the_desktop_keeps_them() {
        let given = json!({ "tags": ["#Bug Fix", "bug-fix", "  ", "UI"] });
        assert_eq!(
            tags(&given),
            Some(vec!["bug-fix".to_string(), "ui".to_string()])
        );
        assert_eq!(tags(&json!({})), None);
    }

    #[test]
    fn focus_changes_need_the_phones_day() {
        assert_eq!(focus_change(&json!({})).unwrap(), None);
        assert_eq!(
            focus_change(&json!({ "focusDate": "2026-11-11", "today": "2026-11-11" })).unwrap(),
            Some(Some("2026-11-11".to_string()))
        );
        assert_eq!(
            focus_change(&json!({ "focusDate": null, "today": "2026-11-11" })).unwrap(),
            Some(None)
        );
        assert!(focus_change(&json!({ "focusDate": "2026-11-11" })).is_err());
        assert!(focus_change(&json!({ "focusDate": 5, "today": "2026-11-11" })).is_err());
    }

    #[test]
    fn the_newer_edit_wins() {
        // The phone edited the copy the desktop still has.
        assert!(phone_wins(Some(100), None, 100, 50));
        // A second queued edit after the phone's own first write.
        assert!(phone_wins(Some(100), Some(300), 300, 200));
        // Changed on the desktop after the phone's edit: the desktop wins.
        assert!(!phone_wins(Some(100), None, 300, 200));
        // Changed on the desktop before the phone's edit: the phone wins.
        assert!(phone_wins(Some(100), None, 300, 400));
        // A note the phone made, already on the desktop from its own write.
        assert!(phone_wins(None, Some(300), 300, 200));
        assert!(!phone_wins(None, None, 300, 200));
    }

    #[test]
    fn records_forget_everything_when_full() {
        for index in 0..PHONE_WRITES_MAX {
            record(&format!("test-{index}"), 1);
        }
        record("test-last", 7);
        assert_eq!(recorded("test-last"), Some(7));
        assert_eq!(recorded("test-0"), None);
    }

    #[test]
    fn only_its_own_methods_are_handled() {
        assert!(handles("notes.save"));
        assert!(!handles("session.start"));
    }
}
