//! Fork (Hari, L-236): the phone's Tasks, Notes and link cards. These belong to
//! no window, so the desktop service answers them from its own store, then
//! tells every window to refresh. The only writes are task and note saves, the
//! same ones the desktop's own screens make.
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
            let body = text(params, "body");
            let title = match text(params, "title").trim() {
                "" => title_from(&body),
                given => clip(given, TITLE_CHARS),
            };
            let task = tasks_upsert_blocking(
                app.state(),
                TaskUpsert {
                    id: uuid::Uuid::new_v4().to_string(),
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
            )?;
            Ok(json!({ "task": task_summary(&task) }))
        }
        "tasks.update" => {
            let id = text(params, "id");
            let task = tasks_get_blocking(app.state(), id)?.ok_or("This task was deleted")?;
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
            let task = tasks_upsert_blocking(app.state(), next)?;
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
    let body = text(params, "body").replace("\r\n", "\n");
    let title = match text(params, "title").trim() {
        "" => title_from(&body),
        given => clip(given, TITLE_CHARS),
    };
    let note = notes_upsert_blocking(
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
    )?;
    Ok(json!({ "conflict": false, "note": note }))
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
    fn only_its_own_methods_are_handled() {
        assert!(handles("notes.save"));
        assert!(!handles("session.start"));
    }
}
