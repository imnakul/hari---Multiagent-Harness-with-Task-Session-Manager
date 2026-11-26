//! Fork (L-381): a small ClickUp API v2 client for the ClickUp view and the
//! `clickup.*` agent actions.
//!
//! The personal token lives only in the OS keychain (service
//! `com.monocode.clickup`, account `personal-token`). No command returns it,
//! and error values never carry it or any request header. Commands take plain
//! arguments (no window), so a workspace window can call them (L-218).

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Map, Value};

const API: &str = "https://api.clickup.com/api/v2";
const HTTP_TIMEOUT: Duration = Duration::from_secs(20);
const KEYCHAIN_SERVICE: &str = "com.monocode.clickup";
const KEYCHAIN_ACCOUNT: &str = "personal-token";
const MAX_TOKEN_LEN: usize = 200;
/// A comment longer than this is refused before the network.
const MAX_COMMENT_CHARS: usize = 10_000;
/// Attachments bigger than this aren't downloaded (opened in ClickUp instead).
const MAX_ATTACHMENT_BYTES: u64 = 200 * 1024 * 1024;
const ATTACHMENT_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_ATTACHMENT_REDIRECTS: usize = 5;
/// Keys a create or update may send; anything else is refused before the network.
const TASK_INPUT_KEYS: [&str; 9] = [
    "name",
    "markdown_content",
    "status",
    "priority",
    "assignees",
    "start_date",
    "start_date_time",
    "due_date",
    "due_date_time",
];

/// What the front end sees on failure. Serialised as `{ "kind": "...", ... }`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ClickupError {
    NotConnected,
    Auth,
    Forbidden,
    NotFound,
    #[serde(rename_all = "camelCase")]
    RateLimited {
        retry_after_seconds: u64,
    },
    Invalid {
        message: String,
    },
    Server,
    Network,
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

/// Seconds until `X-RateLimit-Reset` (a Unix time in seconds): at least 1, 60 when missing or unreadable.
fn retry_after_seconds(reset: Option<&str>, now: u64) -> u64 {
    match reset.and_then(|value| value.trim().parse::<u64>().ok()) {
        Some(at) => at.saturating_sub(now).max(1),
        None => 60,
    }
}

/// Maps an HTTP failure status. `message` is ClickUp's `err` text for a 400.
fn error_for_status(
    status: u16,
    reset: Option<&str>,
    message: Option<String>,
    now: u64,
) -> ClickupError {
    match status {
        401 => ClickupError::Auth,
        403 => ClickupError::Forbidden,
        404 => ClickupError::NotFound,
        429 => ClickupError::RateLimited {
            retry_after_seconds: retry_after_seconds(reset, now),
        },
        400 | 422 => ClickupError::Invalid {
            message: message
                .filter(|text| !text.trim().is_empty())
                .unwrap_or_else(|| "ClickUp rejected the request.".into()),
        },
        500..=599 => ClickupError::Server,
        _ => ClickupError::Invalid {
            message: "ClickUp rejected the request.".into(),
        },
    }
}

fn keychain_entry() -> Result<keyring::Entry, ClickupError> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|_| ClickupError::Server)
}

fn read_token() -> Result<Option<String>, ClickupError> {
    match keychain_entry()?.get_password() {
        Ok(value) if !value.trim().is_empty() => Ok(Some(value)),
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(ClickupError::Server),
    }
}

fn write_token(token: &str) -> Result<(), ClickupError> {
    keychain_entry()?
        .set_password(token)
        .map_err(|_| ClickupError::Server)
}

fn delete_token() -> Result<(), ClickupError> {
    match keychain_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(ClickupError::Server),
    }
}

fn request(
    token: &str,
    method: &str,
    path: &str,
    query: &[(&str, String)],
    body: Option<&Value>,
) -> Result<Value, ClickupError> {
    let mut url = url::Url::parse(&format!("{API}{path}")).map_err(|_| ClickupError::Network)?;
    if !query.is_empty() {
        url.query_pairs_mut()
            .extend_pairs(query.iter().map(|(key, value)| (*key, value.as_str())));
    }
    let agent = ureq::AgentBuilder::new().timeout(HTTP_TIMEOUT).build();
    let call = agent
        .request(method, url.as_str())
        .set("Authorization", token)
        .set("Accept", "application/json");
    let result = match body {
        Some(body) => call
            .set("Content-Type", "application/json")
            .send_string(&body.to_string()),
        None => call.call(),
    };
    read_reply(result)
}

/// Turns a finished HTTP call into the JSON body or a `ClickupError`.
fn read_reply(result: Result<ureq::Response, ureq::Error>) -> Result<Value, ClickupError> {
    match result {
        Ok(response) => response
            .into_string()
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .ok_or(ClickupError::Server),
        Err(ureq::Error::Status(status, response)) => {
            let reset = response.header("X-RateLimit-Reset").map(str::to_owned);
            let message = response
                .into_string()
                .ok()
                .and_then(|text| serde_json::from_str::<Value>(&text).ok())
                .and_then(|value| value.get("err").and_then(Value::as_str).map(str::to_owned));
            Err(error_for_status(status, reset.as_deref(), message, now_seconds()))
        }
        Err(_) => Err(ClickupError::Network),
    }
}

fn with_token<T>(
    action: impl FnOnce(&str) -> Result<T, ClickupError>,
) -> Result<T, ClickupError> {
    let token = read_token()?.ok_or(ClickupError::NotConnected)?;
    action(&token)
}

/// ClickUp sends numbers as strings in places; accepts both.
fn number_of(value: Option<&Value>) -> Option<i64> {
    match value? {
        Value::Number(number) => number.as_i64(),
        Value::String(text) => text.trim().parse::<i64>().ok(),
        _ => None,
    }
}

fn text_of(value: Option<&Value>) -> String {
    value.and_then(Value::as_str).unwrap_or_default().to_owned()
}

fn member_from_json(value: &Value) -> Value {
    json!({
        "id": number_of(value.get("id")).unwrap_or(0),
        "username": text_of(value.get("username")),
        "email": text_of(value.get("email")),
        "initials": text_of(value.get("initials")),
        "color": text_of(value.get("color")),
        "profilePicture": value.get("profilePicture").and_then(Value::as_str),
    })
}

/// A ClickUp task as the front end reads it. Dates arrive as strings of
/// milliseconds, priority as an object with a string `id`; both are converted.
fn task_from_json(value: &Value) -> Value {
    let priority = value
        .get("priority")
        .filter(|priority| !priority.is_null())
        .and_then(|priority| number_of(priority.get("id")).or_else(|| number_of(Some(priority))))
        .filter(|level| (1..=4).contains(level));
    let status = value.get("status");
    json!({
        "id": text_of(value.get("id")),
        "name": text_of(value.get("name")),
        "markdownDescription": value
            .get("markdown_description")
            .or_else(|| value.get("description"))
            .and_then(Value::as_str),
        "status": {
            "status": text_of(status.and_then(|status| status.get("status"))),
            "type": text_of(status.and_then(|status| status.get("type"))),
            "color": text_of(status.and_then(|status| status.get("color"))),
        },
        "priority": priority,
        "assignees": value
            .get("assignees")
            .and_then(Value::as_array)
            .map(|members| members.iter().map(member_from_json).collect::<Vec<_>>())
            .unwrap_or_default(),
        "startDate": number_of(value.get("start_date")),
        "dueDate": number_of(value.get("due_date")),
        "dateUpdated": number_of(value.get("date_updated")).unwrap_or(0),
        "dateCreated": number_of(value.get("date_created")),
        "dateClosed": number_of(value.get("date_closed")),
        "customId": value.get("custom_id").and_then(Value::as_str),
        "tags": value
            .get("tags")
            .and_then(Value::as_array)
            .map(|tags| tags.iter().filter_map(|tag| tag.get("name").and_then(Value::as_str)).collect::<Vec<_>>())
            .unwrap_or_default(),
        "customFields": value
            .get("custom_fields")
            .and_then(Value::as_array)
            .map(|fields| fields.iter().filter_map(custom_field_from_json).collect::<Vec<_>>())
            .unwrap_or_default(),
        "url": text_of(value.get("url")),
        "listId": text_of(value.get("list").and_then(|list| list.get("id"))),
    })
}

/// Fork (L-381): one custom field as display text, or None when it has no
/// value or a type we don't show. Drop-downs and labels carry the chosen
/// option's colour; a drop-down's value is the option's orderindex in older
/// replies and its id in newer ones, so both are matched.
fn custom_field_from_json(field: &Value) -> Option<Value> {
    let id = text_of(field.get("id"));
    let name = text_of(field.get("name"));
    let kind = text_of(field.get("type"));
    let value = field.get("value").filter(|value| !value.is_null())?;
    let options = field
        .get("type_config")
        .and_then(|config| config.get("options"))
        .and_then(Value::as_array);
    let (text, color) = match kind.as_str() {
        "drop_down" => {
            let option = options?.iter().find(|option| match value {
                Value::Number(_) => number_of(option.get("orderindex")) == number_of(Some(value)),
                Value::String(text) => option.get("id").and_then(Value::as_str) == Some(text.as_str())
                    || number_of(option.get("orderindex")) == text.parse::<i64>().ok(),
                _ => false,
            })?;
            (text_of(option.get("name")), option.get("color").and_then(Value::as_str).map(str::to_owned))
        }
        "labels" => {
            let chosen = value.as_array()?;
            let names = options?
                .iter()
                .filter(|option| chosen.iter().any(|id| option.get("id") == Some(id)))
                .filter_map(|option| option.get("label").or_else(|| option.get("name")).and_then(Value::as_str))
                .collect::<Vec<_>>();
            (names.join(", "), None)
        }
        "users" => {
            let names = value
                .as_array()?
                .iter()
                .filter_map(|user| user.get("username").and_then(Value::as_str))
                .collect::<Vec<_>>();
            (names.join(", "), None)
        }
        "checkbox" => match value {
            Value::Bool(true) => ("Yes".to_owned(), None),
            Value::String(text) if text == "true" => ("Yes".to_owned(), None),
            _ => return None,
        },
        "date" => (number_of(Some(value))?.to_string(), None),
        "number" | "currency" | "emoji" | "manual_progress" => match value {
            Value::Number(number) => (number.to_string(), None),
            Value::String(text) => (text.clone(), None),
            _ => return None,
        },
        "short_text" | "text" | "email" | "url" | "phone" => (value.as_str()?.to_owned(), None),
        _ => return None,
    };
    if text.trim().is_empty() {
        return None;
    }
    Some(json!({ "id": id, "name": name, "type": kind, "text": text, "color": color }))
}

fn list_from_json(value: &Value) -> Value {
    let statuses = value
        .get("statuses")
        .and_then(Value::as_array)
        .map(|statuses| {
            statuses
                .iter()
                .map(|status| {
                    json!({
                        "status": text_of(status.get("status")),
                        "type": text_of(status.get("type")),
                        "color": text_of(status.get("color")),
                        "orderindex": number_of(status.get("orderindex")).unwrap_or(0),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({
        "id": text_of(value.get("id")),
        "name": text_of(value.get("name")),
        "statuses": statuses,
        "permissionLevel": value.get("permission_level").and_then(Value::as_str),
    })
}

fn checked_id(id: &str) -> Result<&str, ClickupError> {
    let valid = !id.is_empty()
        && id.len() <= 40
        && id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_');
    if valid {
        Ok(id)
    } else {
        Err(ClickupError::Invalid {
            message: "That isn't a ClickUp ID.".into(),
        })
    }
}

/// Keeps only the keys a task write may send.
fn task_body(input: &Value) -> Result<Value, ClickupError> {
    let object = input.as_object().ok_or_else(|| ClickupError::Invalid {
        message: "The task input must be an object.".into(),
    })?;
    let mut body = Map::new();
    for (key, value) in object {
        if !TASK_INPUT_KEYS.contains(&key.as_str()) {
            return Err(ClickupError::Invalid {
                message: format!("Unknown task field {key}."),
            });
        }
        body.insert(key.clone(), value.clone());
    }
    Ok(Value::Object(body))
}

fn run_blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, ClickupError> + Send + 'static,
) -> impl std::future::Future<Output = Result<T, ClickupError>> {
    async move {
        tauri::async_runtime::spawn_blocking(work)
            .await
            .map_err(|_| ClickupError::Server)?
    }
}

#[tauri::command]
pub async fn clickup_status() -> Result<Value, ClickupError> {
    run_blocking(|| Ok(json!({ "connected": read_token()?.is_some() }))).await
}

/// Checks the token against `GET /user` and keeps it in the keychain only when ClickUp accepts it.
#[tauri::command]
pub async fn clickup_set_token(token: String) -> Result<Value, ClickupError> {
    run_blocking(move || {
        let token = token.trim().to_owned();
        if token.is_empty() || token.len() > MAX_TOKEN_LEN {
            return Err(ClickupError::Auth);
        }
        let reply = request(&token, "GET", "/user", &[], None)?;
        write_token(&token)?;
        let user = reply.get("user").unwrap_or(&Value::Null);
        Ok(json!({
            "id": number_of(user.get("id")).unwrap_or(0),
            "username": text_of(user.get("username")),
        }))
    })
    .await
}

/// The ClickUp user the stored token belongs to, for the "Assignee: me" filter.
#[tauri::command]
pub async fn clickup_me() -> Result<Value, ClickupError> {
    run_blocking(|| {
        with_token(|token| {
            let reply = request(token, "GET", "/user", &[], None)?;
            Ok(member_from_json(reply.get("user").unwrap_or(&Value::Null)))
        })
    })
    .await
}

#[tauri::command]
pub async fn clickup_disconnect() -> Result<(), ClickupError> {
    run_blocking(delete_token).await
}

#[tauri::command]
pub async fn clickup_list(list_id: String) -> Result<Value, ClickupError> {
    run_blocking(move || {
        let id = checked_id(&list_id)?.to_owned();
        with_token(|token| Ok(list_from_json(&request(token, "GET", &format!("/list/{id}"), &[], None)?)))
    })
    .await
}

#[tauri::command]
pub async fn clickup_list_members(list_id: String) -> Result<Value, ClickupError> {
    run_blocking(move || {
        let id = checked_id(&list_id)?.to_owned();
        with_token(|token| {
            let reply = request(token, "GET", &format!("/list/{id}/member"), &[], None)?;
            let members = reply
                .get("members")
                .and_then(Value::as_array)
                .map(|members| members.iter().map(member_from_json).collect::<Vec<_>>())
                .unwrap_or_default();
            Ok(Value::Array(members))
        })
    })
    .await
}

#[tauri::command]
pub async fn clickup_tasks(
    list_id: String,
    page: u32,
    include_closed: bool,
) -> Result<Value, ClickupError> {
    run_blocking(move || {
        let id = checked_id(&list_id)?.to_owned();
        with_token(|token| {
            let query = [
                ("page", page.to_string()),
                ("include_closed", include_closed.to_string()),
                ("subtasks", "false".to_owned()),
                ("order_by", "updated".to_owned()),
                ("reverse", "true".to_owned()),
                ("include_markdown_description", "true".to_owned()),
            ];
            let reply = request(token, "GET", &format!("/list/{id}/task"), &query, None)?;
            let tasks = reply
                .get("tasks")
                .and_then(Value::as_array)
                .map(|tasks| tasks.iter().map(task_from_json).collect::<Vec<_>>())
                .unwrap_or_default();
            let last_page = reply
                .get("last_page")
                .and_then(Value::as_bool)
                .unwrap_or(tasks.is_empty());
            Ok(json!({ "tasks": tasks, "lastPage": last_page }))
        })
    })
    .await
}

#[tauri::command]
pub async fn clickup_task(task_id: String) -> Result<Value, ClickupError> {
    run_blocking(move || {
        let id = checked_id(&task_id)?.to_owned();
        with_token(|token| {
            let query = [("include_markdown_description", "true".to_owned())];
            Ok(task_from_json(&request(token, "GET", &format!("/task/{id}"), &query, None)?))
        })
    })
    .await
}

/// Fork (L-381): everything the detail panel shows beyond the list row:
/// attachments, checklists, subtasks, linked tasks, dependencies, creator,
/// watchers, estimates and comments. Comments come from a second request;
/// when only that one fails, the rest still arrives with `commentsFailed`.
#[tauri::command]
pub async fn clickup_task_details(task_id: String) -> Result<Value, ClickupError> {
    run_blocking(move || {
        let id = checked_id(&task_id)?.to_owned();
        with_token(|token| {
            let query = [
                ("include_markdown_description", "true".to_owned()),
                ("include_subtasks", "true".to_owned()),
            ];
            let task = request(token, "GET", &format!("/task/{id}"), &query, None)?;
            let comments = match request(token, "GET", &format!("/task/{id}/comment"), &[], None) {
                Ok(reply) => Some(reply),
                Err(ClickupError::Auth) => return Err(ClickupError::Auth),
                Err(_) => None,
            };
            Ok(task_details_from_json(&task, comments.as_ref()))
        })
    })
    .await
}

fn array_of<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value.get(key).and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}

/// Only web links are passed on; anything else (javascript:, file:) is dropped.
fn web_url(value: Option<&Value>) -> Option<String> {
    let url = value.and_then(Value::as_str)?.trim();
    let lower = url.to_ascii_lowercase();
    (lower.starts_with("https://") || lower.starts_with("http://")).then(|| url.to_owned())
}

fn task_details_from_json(task: &Value, comments: Option<&Value>) -> Value {
    let attachments = array_of(task, "attachments")
        .iter()
        .filter_map(|file| {
            let url = web_url(file.get("url"))?;
            Some(json!({
                "id": text_of(file.get("id")),
                "title": text_of(file.get("title")),
                "url": url,
                "thumbnail": web_url(file.get("thumbnail_medium").or_else(|| file.get("thumbnail_small"))),
                "extension": text_of(file.get("extension")),
                "size": number_of(file.get("size")),
                "date": number_of(file.get("date")),
            }))
        })
        .collect::<Vec<_>>();
    let checklists = array_of(task, "checklists")
        .iter()
        .map(|list| {
            json!({
                "id": text_of(list.get("id")),
                "name": text_of(list.get("name")),
                "items": array_of(list, "items")
                    .iter()
                    .map(|item| json!({
                        "id": text_of(item.get("id")),
                        "name": text_of(item.get("name")),
                        "resolved": item.get("resolved").and_then(Value::as_bool).unwrap_or(false),
                    }))
                    .collect::<Vec<_>>(),
            })
        })
        .collect::<Vec<_>>();
    let subtasks = array_of(task, "subtasks")
        .iter()
        .map(|sub| {
            let status = sub.get("status");
            json!({
                "id": text_of(sub.get("id")),
                "name": text_of(sub.get("name")),
                "status": text_of(status.and_then(|status| status.get("status"))),
                "color": text_of(status.and_then(|status| status.get("color"))),
                "url": web_url(sub.get("url")),
            })
        })
        .collect::<Vec<_>>();
    let task_id = text_of(task.get("id"));
    let linked = array_of(task, "linked_tasks")
        .iter()
        .filter_map(|link| {
            let one = text_of(link.get("task_id"));
            let other = text_of(link.get("link_id"));
            let id = if one == task_id { other } else { one };
            (!id.is_empty()).then_some(id)
        })
        .collect::<Vec<_>>();
    let dependencies = array_of(task, "dependencies")
        .iter()
        .filter_map(|dep| {
            let waits_on = text_of(dep.get("depends_on"));
            let blocks = text_of(dep.get("task_id"));
            if blocks == task_id && !waits_on.is_empty() {
                Some(json!({ "id": waits_on, "kind": "waitingOn" }))
            } else if waits_on == task_id && !blocks.is_empty() {
                Some(json!({ "id": blocks, "kind": "blocking" }))
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    let comments_json = comments.map(|reply| {
        array_of(reply, "comments")
            .iter()
            .map(|comment| json!({
                "id": text_of(comment.get("id")),
                "text": text_of(comment.get("comment_text")),
                "user": member_from_json(comment.get("user").unwrap_or(&Value::Null)),
                "date": number_of(comment.get("date")),
            }))
            .collect::<Vec<_>>()
    });
    json!({
        "task": task_from_json(task),
        "attachments": attachments,
        "checklists": checklists,
        "subtasks": subtasks,
        "linkedTaskIds": linked,
        "dependencies": dependencies,
        "creator": task.get("creator").filter(|creator| !creator.is_null()).map(member_from_json),
        "watchers": array_of(task, "watchers").iter().map(member_from_json).collect::<Vec<_>>(),
        "timeEstimate": number_of(task.get("time_estimate")),
        "timeSpent": number_of(task.get("time_spent")),
        "points": task.get("points").and_then(Value::as_f64),
        "parentId": task.get("parent").and_then(Value::as_str),
        "commentsFailed": comments_json.is_none(),
        "comments": comments_json.unwrap_or_default(),
    })
}

#[tauri::command]
pub async fn clickup_create_task(list_id: String, input: Value) -> Result<Value, ClickupError> {
    run_blocking(move || {
        let id = checked_id(&list_id)?.to_owned();
        let body = task_body(&input)?;
        with_token(|token| {
            Ok(task_from_json(&request(token, "POST", &format!("/list/{id}/task"), &[], Some(&body))?))
        })
    })
    .await
}

/// Fork (L-395): the biggest file a task attachment may be.
const MAX_UPLOAD_BYTES: u64 = 25 * 1024 * 1024;
const UPLOAD_TIMEOUT: Duration = Duration::from_secs(120);

/// A file name safe to send: no path parts or control characters, at most 200 characters.
fn clean_file_name(name: &str) -> String {
    let last = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = last.chars().filter(|c| !c.is_control()).take(200).collect();
    let cleaned = cleaned.trim().trim_matches('.').trim().to_owned();
    if cleaned.is_empty() {
        "attachment".to_owned()
    } else {
        cleaned
    }
}

/// A multipart/form-data body with one file part named `attachment`.
fn multipart_body(boundary: &str, file_name: &str, mime: &str, bytes: &[u8]) -> Vec<u8> {
    let escaped = file_name.replace('"', "'");
    let mut body = Vec::with_capacity(bytes.len() + 256);
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"attachment\"; filename=\"{escaped}\"\r\nContent-Type: {mime}\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

/// Reads the bytes to upload: a regular file of at most 25 MB, or a base64 payload.
fn upload_bytes(path: Option<&str>, data: Option<&str>) -> Result<Vec<u8>, ClickupError> {
    use base64::Engine;
    match (path, data) {
        (Some(path), None) => {
            let meta = std::fs::metadata(path).map_err(|_| ClickupError::NotFound)?;
            if !meta.is_file() {
                return Err(ClickupError::Invalid { message: "Pick a file, not a folder.".to_owned() });
            }
            if meta.len() > MAX_UPLOAD_BYTES {
                return Err(ClickupError::Invalid { message: "Files must be 25 MB or smaller.".to_owned() });
            }
            std::fs::read(path).map_err(|_| ClickupError::NotFound)
        }
        (None, Some(data)) => {
            // Refuse before decoding: base64 is 4 characters per 3 bytes.
            if (data.len() as u64) / 4 * 3 > MAX_UPLOAD_BYTES + 3 {
                return Err(ClickupError::Invalid { message: "Files must be 25 MB or smaller.".to_owned() });
            }
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(data)
                .map_err(|_| ClickupError::Invalid { message: "That file couldn't be read.".to_owned() })?;
            if bytes.len() as u64 > MAX_UPLOAD_BYTES {
                return Err(ClickupError::Invalid { message: "Files must be 25 MB or smaller.".to_owned() });
            }
            Ok(bytes)
        }
        _ => Err(ClickupError::Invalid { message: "Send a path or data, not both.".to_owned() }),
    }
}

/// Uploads one file to a task. Not retried here: a POST is not idempotent.
#[tauri::command]
pub async fn clickup_upload_attachment(
    task_id: String,
    path: Option<String>,
    data: Option<String>,
    name: String,
    mime: Option<String>,
) -> Result<Value, ClickupError> {
    run_blocking(move || {
        let id = checked_id(&task_id)?.to_owned();
        let bytes = upload_bytes(path.as_deref(), data.as_deref())?;
        let file_name = clean_file_name(&name);
        let mime = mime
            .filter(|value| !value.is_empty() && value.len() <= 100 && !value.contains(['\r', '\n']))
            .unwrap_or_else(|| "application/octet-stream".to_owned());
        let boundary = format!("----monocode{}", uuid::Uuid::new_v4().simple());
        let body = multipart_body(&boundary, &file_name, &mime, &bytes);
        let url = format!("{API}/task/{id}/attachment");
        with_token(|token| {
            let agent = ureq::AgentBuilder::new().timeout(UPLOAD_TIMEOUT).build();
            let result = agent
                .post(&url)
                .set("Authorization", token)
                .set("Accept", "application/json")
                .set("Content-Type", &format!("multipart/form-data; boundary={boundary}"))
                .send_bytes(&body);
            let reply = read_reply(result)?;
            Ok(json!({ "id": text_of(reply.get("id")), "title": text_of(reply.get("title")) }))
        })
    })
    .await
}

#[tauri::command]
pub async fn clickup_update_task(task_id: String, input: Value) -> Result<Value, ClickupError> {
    run_blocking(move || {
        let id = checked_id(&task_id)?.to_owned();
        let body = task_body(&input)?;
        with_token(|token| {
            Ok(task_from_json(&request(token, "PUT", &format!("/task/{id}"), &[], Some(&body))?))
        })
    })
    .await
}

/// Posts a plain-text comment on a task as the connected user. Nobody is
/// notified beyond ClickUp's own defaults (`notify_all: false`).
#[tauri::command]
pub async fn clickup_post_comment(task_id: String, text: String) -> Result<Value, ClickupError> {
    run_blocking(move || {
        let id = checked_id(&task_id)?.to_owned();
        let body = comment_body(&text)?;
        with_token(|token| request(token, "POST", &format!("/task/{id}/comment"), &[], Some(&body)))
    })
    .await
}

fn comment_body(text: &str) -> Result<Value, ClickupError> {
    let text = text.trim();
    if text.is_empty() {
        return Err(ClickupError::Invalid {
            message: "Write a comment first.".into(),
        });
    }
    if text.chars().count() > MAX_COMMENT_CHARS {
        return Err(ClickupError::Invalid {
            message: "That comment is too long.".into(),
        });
    }
    Ok(json!({ "comment_text": text, "notify_all": false }))
}

/// Attachment IDs look like `a1b2c3d4-…` or `a1b2.jpg`; anything else is refused.
fn checked_attachment_id(id: &str) -> Result<&str, ClickupError> {
    let valid = !id.is_empty()
        && id.len() <= 80
        && id != "."
        && id != ".."
        && id.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'));
    if valid {
        Ok(id)
    } else {
        Err(ClickupError::Invalid {
            message: "That isn't a ClickUp attachment.".into(),
        })
    }
}

/// The token is only ever sent to ClickUp's own hosts.
fn is_clickup_host(url: &url::Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some_and(|host| {
            host == "clickup.com"
                || host.ends_with(".clickup.com")
                || host.ends_with(".clickup-attachments.com")
        })
}

/// A file name that is safe on every desktop OS: no separators, reserved
/// characters or trailing dots, at most 120 characters.
fn safe_file_name(title: &str, extension: &str, id: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|ch| if ch.is_control() || r#"<>:"/\|?*"#.contains(ch) { '_' } else { ch })
        .collect();
    let mut name = cleaned.trim().trim_end_matches(['.', ' ']).to_owned();
    if name.is_empty() || name.starts_with('.') {
        name = format!("attachment-{id}");
        let extension: String = extension.chars().filter(char::is_ascii_alphanumeric).take(10).collect();
        if !extension.is_empty() && !name.ends_with(&format!(".{extension}")) {
            name.push('.');
            name.push_str(&extension);
        }
    }
    if name.chars().count() > 120 {
        let (stem, extension) = match name.rfind('.') {
            Some(dot) if name.len() - dot <= 11 => (name[..dot].to_owned(), name[dot..].to_owned()),
            _ => (name.clone(), String::new()),
        };
        name = stem.chars().take(120 - extension.chars().count()).collect::<String>() + &extension;
    }
    name
}

/// Downloads a ClickUp attachment. The token goes only with the first request,
/// and only to a ClickUp host; redirects are followed by hand without it, so it
/// never reaches a storage host. A protected file that refuses the token is
/// tried once more without it (public links refuse unknown auth on some hosts).
fn download_attachment(token: &str, start: url::Url) -> Result<Vec<u8>, ClickupError> {
    let agent = ureq::AgentBuilder::new()
        .timeout(ATTACHMENT_TIMEOUT)
        .redirects(0)
        .build();
    let mut url = start;
    let mut with_auth = is_clickup_host(&url);
    let mut hops = 0;
    loop {
        let mut call = agent.get(url.as_str());
        if with_auth {
            call = call.set("Authorization", token);
        }
        let response = match call.call() {
            Ok(response) => response,
            Err(ureq::Error::Status(401 | 403, _)) if with_auth => {
                with_auth = false;
                continue;
            }
            Err(ureq::Error::Status(status, response)) => {
                let reset = response.header("X-RateLimit-Reset").map(str::to_owned);
                return Err(error_for_status(status, reset.as_deref(), None, now_seconds()));
            }
            Err(_) => return Err(ClickupError::Network),
        };
        if (300..400).contains(&response.status()) {
            hops += 1;
            let next = response
                .header("Location")
                .and_then(|location| url.join(location).ok())
                .filter(|next| next.scheme() == "https");
            match next {
                Some(next) if hops <= MAX_ATTACHMENT_REDIRECTS => {
                    url = next;
                    with_auth = false;
                    continue;
                }
                _ => return Err(ClickupError::Server),
            }
        }
        let mut bytes = Vec::new();
        response
            .into_reader()
            .take(MAX_ATTACHMENT_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ClickupError::Network)?;
        if bytes.len() as u64 > MAX_ATTACHMENT_BYTES {
            return Err(ClickupError::Invalid {
                message: "That file is too large to download here. Open it in ClickUp.".into(),
            });
        }
        return Ok(bytes);
    }
}

fn attachment_path(cache: &Path, task_id: &str, attachment_id: &str, name: &str) -> PathBuf {
    cache
        .join("clickup-attachments")
        .join(task_id)
        .join(attachment_id)
        .join(name)
}

/// Downloads a task's attachment into the app cache once (later calls reuse
/// the copy while its size still matches) and returns its path and name. The
/// file's address is read from ClickUp by ID, never taken from the caller.
fn cached_attachment(
    cache: &Path,
    token: &str,
    task_id: &str,
    file_id: &str,
) -> Result<(PathBuf, String, u64), ClickupError> {
    let task = request(token, "GET", &format!("/task/{task_id}"), &[], None)?;
    let file = array_of(&task, "attachments")
        .iter()
        .find(|file| text_of(file.get("id")) == file_id)
        .ok_or(ClickupError::NotFound)?;
    let url = url::Url::parse(&text_of(file.get("url")))
        .ok()
        .filter(|url| url.scheme() == "https")
        .ok_or(ClickupError::NotFound)?;
    let name = safe_file_name(&text_of(file.get("title")), &text_of(file.get("extension")), file_id);
    let path = attachment_path(cache, task_id, file_id, &name);
    let expected = number_of(file.get("size")).and_then(|size| u64::try_from(size).ok());
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.is_file() && expected.is_none_or(|size| size == meta.len()) {
            return Ok((path, name, meta.len()));
        }
    }
    let bytes = download_attachment(token, url)?;
    let dir = path.parent().ok_or(ClickupError::Server)?;
    std::fs::create_dir_all(dir).map_err(|_| ClickupError::Server)?;
    // Written beside it, then moved into place, so a half download is never opened.
    let partial = dir.join(format!(".{file_id}.part"));
    std::fs::write(&partial, &bytes).map_err(|_| ClickupError::Server)?;
    std::fs::rename(&partial, &path).map_err(|_| ClickupError::Server)?;
    Ok((path, name, bytes.len() as u64))
}

fn attachment_cache(app: &tauri::AppHandle) -> Result<PathBuf, ClickupError> {
    use tauri::Manager;
    app.path().app_cache_dir().map_err(|_| ClickupError::Server)
}

/// Downloads a task's attachment (see `cached_attachment`) and returns
/// `{ path, name, size }` for opening, copying or attaching it.
#[tauri::command]
pub async fn clickup_download_attachment(
    app: tauri::AppHandle,
    task_id: String,
    attachment_id: String,
) -> Result<Value, ClickupError> {
    let cache = attachment_cache(&app)?;
    run_blocking(move || {
        let id = checked_id(&task_id)?.to_owned();
        let file_id = checked_attachment_id(&attachment_id)?.to_owned();
        with_token(|token| {
            let (path, name, size) = cached_attachment(&cache, token, &id, &file_id)?;
            Ok(json!({ "path": path.to_string_lossy(), "name": name, "size": size }))
        })
    })
    .await
}

/// Saves a copy of a task's attachment to `destination`, a full file path the
/// user picked in the save dialog (it may replace a file the dialog confirmed).
#[tauri::command]
pub async fn clickup_save_attachment(
    app: tauri::AppHandle,
    task_id: String,
    attachment_id: String,
    destination: String,
) -> Result<(), ClickupError> {
    let cache = attachment_cache(&app)?;
    run_blocking(move || {
        let id = checked_id(&task_id)?.to_owned();
        let file_id = checked_attachment_id(&attachment_id)?.to_owned();
        let target = PathBuf::from(destination.trim());
        if !target.is_absolute() || target.is_dir() || target.file_name().is_none() {
            return Err(ClickupError::Invalid {
                message: "Pick a file name to save to.".into(),
            });
        }
        with_token(|token| {
            let (path, _, _) = cached_attachment(&cache, token, &id, &file_id)?;
            std::fs::copy(&path, &target).map_err(|_| ClickupError::Invalid {
                message: "Couldn't save the file there.".into(),
            })?;
            Ok(())
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comments_are_trimmed_and_bounded() {
        assert_eq!(comment_body("  hi  ").unwrap()["comment_text"], "hi");
        assert_eq!(comment_body("  hi  ").unwrap()["notify_all"], false);
        assert!(comment_body("   ").is_err());
        assert!(comment_body(&"x".repeat(MAX_COMMENT_CHARS + 1)).is_err());
    }

    #[test]
    fn attachment_ids_and_hosts_are_checked() {
        assert!(checked_attachment_id("a1b2-c3.jpg").is_ok());
        assert!(checked_attachment_id("..").is_err());
        assert!(checked_attachment_id("a/b").is_err());
        let host = |text: &str| is_clickup_host(&url::Url::parse(text).unwrap());
        assert!(host("https://t123.p.clickup-attachments.com/x.png"));
        assert!(host("https://attachments.clickup.com/x.png"));
        assert!(!host("http://attachments.clickup.com/x.png"));
        assert!(!host("https://clickup.com.evil.example/x.png"));
        assert!(!host("https://s3.amazonaws.com/x.png"));
    }

    #[test]
    fn attachment_names_are_safe_on_disk() {
        assert_eq!(safe_file_name("IMG-1.jpg", "jpg", "a"), "IMG-1.jpg");
        assert_eq!(safe_file_name("a/b\\c:d?.pdf", "pdf", "a"), "a_b_c_d_.pdf");
        assert_eq!(safe_file_name("  ", "png", "id1"), "attachment-id1.png");
        assert_eq!(safe_file_name("..", "png", "id1"), "attachment-id1.png");
        assert_eq!(safe_file_name("report. ", "", "x"), "report");
        let long = safe_file_name(&format!("{}.pdf", "n".repeat(300)), "pdf", "x");
        assert_eq!(long.chars().count(), 120);
        assert!(long.ends_with(".pdf"));
        let path = attachment_path(Path::new("/cache"), "t1", "f1", "a.png");
        assert!(path.ends_with(Path::new("clickup-attachments/t1/f1/a.png")));
    }

    #[test]
    fn maps_http_statuses() {
        assert_eq!(error_for_status(401, None, None, 0), ClickupError::Auth);
        assert_eq!(error_for_status(403, None, None, 0), ClickupError::Forbidden);
        assert_eq!(error_for_status(404, None, None, 0), ClickupError::NotFound);
        assert_eq!(error_for_status(503, None, None, 0), ClickupError::Server);
        assert_eq!(
            error_for_status(400, None, Some("Status invalid".into()), 0),
            ClickupError::Invalid { message: "Status invalid".into() }
        );
        assert_eq!(
            error_for_status(429, Some("130"), None, 100),
            ClickupError::RateLimited { retry_after_seconds: 30 }
        );
    }

    #[test]
    fn rate_limit_reset_is_at_least_one_second_and_defaults_to_sixty() {
        assert_eq!(retry_after_seconds(Some("90"), 100), 1);
        assert_eq!(retry_after_seconds(None, 100), 60);
        assert_eq!(retry_after_seconds(Some("soon"), 100), 60);
    }

    #[test]
    fn errors_serialise_with_a_kind() {
        let value = serde_json::to_value(ClickupError::RateLimited { retry_after_seconds: 5 }).unwrap();
        assert_eq!(value, json!({ "kind": "rateLimited", "retryAfterSeconds": 5 }));
        assert_eq!(serde_json::to_value(ClickupError::NotConnected).unwrap(), json!({ "kind": "notConnected" }));
    }

    #[test]
    fn converts_a_full_task() {
        let task = task_from_json(&json!({
            "id": "abc",
            "name": "Fix login",
            "markdown_description": "# Steps",
            "status": { "status": "open", "type": "open", "color": "#aaa" },
            "priority": { "id": "2", "priority": "high" },
            "assignees": [{ "id": 7, "username": "nakul", "email": "n@x", "initials": "N", "color": "#fff", "profilePicture": null }],
            "start_date": "1700000000000",
            "due_date": "1700086400000",
            "date_updated": "1700000500000",
            "url": "https://app.clickup.com/t/abc",
            "list": { "id": "901" }
        }));
        assert_eq!(task["priority"], json!(2));
        assert_eq!(task["startDate"], json!(1700000000000_i64));
        assert_eq!(task["dueDate"], json!(1700086400000_i64));
        assert_eq!(task["dateUpdated"], json!(1700000500000_i64));
        assert_eq!(task["markdownDescription"], json!("# Steps"));
        assert_eq!(task["assignees"][0]["username"], json!("nakul"));
        assert_eq!(task["listId"], json!("901"));
    }

    #[test]
    fn converts_a_task_with_nothing_optional() {
        let task = task_from_json(&json!({
            "id": "abc",
            "name": "Bare",
            "status": { "status": "open", "type": "open", "color": "#aaa" },
            "priority": null,
            "start_date": null,
            "due_date": null,
            "date_updated": "5"
        }));
        assert_eq!(task["priority"], Value::Null);
        assert_eq!(task["startDate"], Value::Null);
        assert_eq!(task["dueDate"], Value::Null);
        assert_eq!(task["markdownDescription"], Value::Null);
        assert_eq!(task["assignees"], json!([]));
        assert_eq!(task["dateCreated"], Value::Null);
        assert_eq!(task["customId"], Value::Null);
        assert_eq!(task["tags"], json!([]));
        assert_eq!(task["customFields"], json!([]));
    }

    #[test]
    fn task_details_keep_web_links_and_both_dependency_directions() {
        let task = json!({
            "id": "t1",
            "attachments": [
                { "id": "a1", "title": "shot.png", "url": "https://t.example/shot.png", "extension": "png", "size": 2048 },
                { "id": "a2", "title": "bad", "url": "javascript:alert(1)" }
            ],
            "checklists": [{ "id": "c1", "name": "QA", "items": [{ "id": "i1", "name": "Try it", "resolved": true }] }],
            "subtasks": [{ "id": "s1", "name": "Child", "status": { "status": "open", "color": "#ccc" }, "url": "https://app.clickup.com/t/s1" }],
            "linked_tasks": [{ "task_id": "t1", "link_id": "t9" }, { "task_id": "t8", "link_id": "t1" }],
            "dependencies": [{ "task_id": "t1", "depends_on": "t2" }, { "task_id": "t3", "depends_on": "t1" }],
            "creator": { "id": 7, "username": "Kalyani" },
            "time_estimate": 3600000
        });
        let comments = json!({ "comments": [{ "id": "m1", "comment_text": "Seen on prod", "user": { "id": 7, "username": "Kalyani" }, "date": "1700000000000" }] });
        let details = task_details_from_json(&task, Some(&comments));
        assert_eq!(details["attachments"].as_array().map(Vec::len), Some(1));
        assert_eq!(details["attachments"][0]["size"], 2048);
        assert_eq!(details["checklists"][0]["items"][0]["resolved"], true);
        assert_eq!(details["subtasks"][0]["status"], "open");
        assert_eq!(details["linkedTaskIds"], json!(["t9", "t8"]));
        assert_eq!(details["dependencies"], json!([{ "id": "t2", "kind": "waitingOn" }, { "id": "t3", "kind": "blocking" }]));
        assert_eq!(details["creator"]["username"], "Kalyani");
        assert_eq!(details["comments"][0]["text"], "Seen on prod");
        assert_eq!(details["commentsFailed"], false);
        assert_eq!(task_details_from_json(&task, None)["commentsFailed"], true);
    }

    #[test]
    fn converts_custom_fields_to_display_text() {
        let task = task_from_json(&json!({
            "id": "abc",
            "date_created": "1700000000000",
            "custom_id": "BUG-12",
            "tags": [{ "name": "ui" }, { "name": "teacher" }],
            "custom_fields": [
                { "id": "f1", "name": "Severity", "type": "drop_down", "value": 1,
                  "type_config": { "options": [
                      { "id": "o1", "name": "S2", "color": "#f80", "orderindex": 0 },
                      { "id": "o2", "name": "S3", "color": "#fd0", "orderindex": 1 } ] } },
                { "id": "f2", "name": "Report Type", "type": "drop_down", "value": "o9",
                  "type_config": { "options": [{ "id": "o9", "name": "Defect", "color": null, "orderindex": 0 }] } },
                { "id": "f3", "name": "Area", "type": "labels", "value": ["l2"],
                  "type_config": { "options": [{ "id": "l1", "label": "Web" }, { "id": "l2", "label": "Mobile" }] } },
                { "id": "f4", "name": "Reporter", "type": "users", "value": [{ "username": "kalyani" }] },
                { "id": "f5", "name": "Notes", "type": "text", "value": "" },
                { "id": "f6", "name": "Empty", "type": "drop_down" },
                { "id": "f7", "name": "Location", "type": "location", "value": { "lat": 1 } }
            ]
        }));
        assert_eq!(task["dateCreated"], json!(1700000000000_i64));
        assert_eq!(task["customId"], json!("BUG-12"));
        assert_eq!(task["tags"], json!(["ui", "teacher"]));
        assert_eq!(
            task["customFields"],
            json!([
                { "id": "f1", "name": "Severity", "type": "drop_down", "text": "S3", "color": "#fd0" },
                { "id": "f2", "name": "Report Type", "type": "drop_down", "text": "Defect", "color": null },
                { "id": "f3", "name": "Area", "type": "labels", "text": "Mobile", "color": null },
                { "id": "f4", "name": "Reporter", "type": "users", "text": "kalyani", "color": null }
            ])
        );
    }

    #[test]
    fn task_writes_keep_only_known_fields() {
        assert!(task_body(&json!({ "name": "x", "priority": null, "due_date": 1 })).is_ok());
        assert!(task_body(&json!({ "creator": 1 })).is_err());
        assert!(task_body(&json!("nope")).is_err());
    }

    #[test]
    fn ids_are_checked_before_they_reach_a_url() {
        assert!(checked_id("901234567890").is_ok());
        assert!(checked_id("86abc-x").is_ok());
        assert!(checked_id("../team").is_err());
        assert!(checked_id("").is_err());
    }

    #[test]
    fn clean_file_name_drops_path_parts_and_control_characters() {
        assert_eq!(clean_file_name("..\\a/b.png"), "b.png");
        assert_eq!(clean_file_name("C:\\docs\\plan\u{7}.pdf"), "plan.pdf");
        assert_eq!(clean_file_name("///"), "attachment");
        assert_eq!(clean_file_name(&"x".repeat(300)).chars().count(), 200);
    }

    #[test]
    fn multipart_body_has_boundary_file_name_type_and_bytes() {
        let body = multipart_body("BND", "a\"b.png", "image/png", &[1, 2, 3]);
        let text = String::from_utf8_lossy(&body).into_owned();
        assert!(text.starts_with("--BND\r\n"));
        assert!(text.contains("name=\"attachment\"; filename=\"a'b.png\""));
        assert!(text.contains("Content-Type: image/png\r\n\r\n"));
        assert!(text.ends_with("\r\n--BND--\r\n"));
        assert!(body.windows(3).any(|window| window == [1, 2, 3]));
    }

    #[test]
    fn upload_bytes_needs_exactly_one_source_and_refuses_big_files() {
        assert!(upload_bytes(None, None).is_err());
        assert!(upload_bytes(Some("a"), Some("b")).is_err());
        let big = "A".repeat(40 * 1024 * 1024);
        assert!(matches!(upload_bytes(None, Some(&big)), Err(ClickupError::Invalid { .. })));
        assert_eq!(upload_bytes(None, Some("AQID")).unwrap(), vec![1, 2, 3]);
        let dir = std::env::temp_dir();
        assert!(upload_bytes(Some(dir.to_str().unwrap()), None).is_err());
    }
}
