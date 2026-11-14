//! Fork (Hari, L-275): the title-bar bell's history for the phone. Every
//! workspace window publishes the list when it changes (they share one store),
//! and the phone reads it from here at once, with no window round trip. The
//! phone's dismiss, read and clear change this copy and go to every window,
//! which change the history so the bell matches.
use std::sync::Mutex;

use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, Window};

const METHODS: [&str; 4] = [
    "notifications.list",
    "notifications.dismiss",
    "notifications.read",
    "notifications.clear",
];
const CHANGE_EVENT: &str = "monocode-mobile-notifications";
/// The bell keeps 100; anything past that is not the bell's list.
const MAX_ITEMS: usize = 100;
const MAX_ID_CHARS: usize = 128;
const TITLE_CHARS: usize = 200;
const BODY_CHARS: usize = 600;
const KINDS: [&str; 5] = [
    "finished",
    "approval",
    "question",
    "automationSucceeded",
    "automationFailed",
];

/// None until a window has published: the phone then knows not to treat an
/// empty list as "everything was cleared".
static FEED: Mutex<Option<Vec<Value>>> = Mutex::new(None);

pub(crate) fn handles(method: &str) -> bool {
    METHODS.contains(&method)
}

#[tauri::command]
pub fn mobile_notifications_publish(window: Window, items: Value) -> Result<(), String> {
    if !crate::window::is_workspace_window(window.label()) {
        return Err("Only workspace windows can publish notifications".into());
    }
    let items = sanitize(&items)?;
    let mut feed = FEED.lock().map_err(|_| "Notifications unavailable")?;
    // Every window publishes the same shared list; send only real changes.
    if feed.as_ref() == Some(&items) {
        return Ok(());
    }
    *feed = Some(items);
    signal_feed(&feed);
    Ok(())
}

/// Fork (Hari, L-277): connected phones get the list at once, in the shape
/// `notifications.list` answers.
fn signal_feed(feed: &Option<Vec<Value>>) {
    if let Some(items) = feed {
        crate::mobile_events::signal(
            "notifications",
            json!({ "available": true, "items": items }),
        );
    }
}

/// Answers a phone request. Changes are applied here and sent to the windows.
pub(crate) fn handle(app: &AppHandle, method: &str, params: &Value) -> Result<Value, String> {
    let change = change_for(method, params)?;
    let mut feed = FEED.lock().map_err(|_| "Notifications unavailable")?;
    let Some(change) = change else {
        return Ok(match feed.as_ref() {
            Some(items) => json!({ "available": true, "items": items }),
            None => json!({ "available": false, "items": [] }),
        });
    };
    if let Some(items) = feed.as_mut() {
        apply(items, &change);
    }
    signal_feed(&feed);
    drop(feed);
    app.emit(CHANGE_EVENT, &change)
        .map_err(|_| "Desktop window is unavailable")?;
    Ok(json!({ "ok": true }))
}

fn clip(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

fn optional_text(source: &Value, name: &str, max: usize, into: &mut Map<String, Value>) {
    if let Some(text) = source[name].as_str().filter(|text| !text.is_empty()) {
        into.insert(name.into(), json!(clip(text, max)));
    }
}

/// Keeps well-formed entries only, clipped, at most `MAX_ITEMS`.
fn sanitize(items: &Value) -> Result<Vec<Value>, String> {
    let list = items.as_array().ok_or("Invalid notifications")?;
    Ok(list
        .iter()
        .filter_map(|item| {
            let id = item["id"]
                .as_str()
                .filter(|id| !id.is_empty() && id.chars().count() <= MAX_ID_CHARS)?;
            let kind = item["kind"].as_str().filter(|kind| KINDS.contains(kind))?;
            let at = item["at"]
                .as_f64()
                .filter(|at| at.is_finite() && *at >= 0.0)?;
            let mut entry = Map::new();
            entry.insert("id".into(), json!(id));
            entry.insert("kind".into(), json!(kind));
            entry.insert(
                "title".into(),
                json!(clip(item["title"].as_str()?, TITLE_CHARS)),
            );
            entry.insert(
                "body".into(),
                json!(clip(item["body"].as_str()?, BODY_CHARS)),
            );
            entry.insert("at".into(), json!(at as u64));
            entry.insert("read".into(), json!(item["read"].as_bool()?));
            optional_text(item, "sessionId", 256, &mut entry);
            optional_text(item, "projectId", 2048, &mut entry);
            optional_text(item, "projectName", TITLE_CHARS, &mut entry);
            if item["seenOnDesktop"] == true {
                entry.insert("seenOnDesktop".into(), json!(true));
            }
            // Fork (Hari, L-278): the request the phone's buttons answer.
            if kind == "approval" || kind == "question" {
                if let Some(request) = item["requestId"].as_u64() {
                    entry.insert("requestId".into(), json!(request));
                }
            }
            Some(Value::Object(entry))
        })
        .take(MAX_ITEMS)
        .collect())
}

fn ids(params: &Value) -> Result<Vec<String>, String> {
    let list = params["ids"].as_array().ok_or("Missing notifications")?;
    if list.is_empty() || list.len() > MAX_ITEMS {
        return Err("Missing notifications".into());
    }
    list.iter()
        .map(|id| {
            id.as_str()
                .filter(|id| !id.is_empty() && id.chars().count() <= MAX_ID_CHARS)
                .map(str::to_owned)
                .ok_or_else(|| "Invalid notification".to_string())
        })
        .collect()
}

/// The change a request asks for; None for a read of the list.
fn change_for(method: &str, params: &Value) -> Result<Option<Value>, String> {
    match method {
        "notifications.list" => Ok(None),
        "notifications.dismiss" => Ok(Some(json!({ "action": "dismiss", "ids": ids(params)? }))),
        "notifications.read" if params["ids"].is_null() => Ok(Some(json!({ "action": "read" }))),
        "notifications.read" => Ok(Some(json!({ "action": "read", "ids": ids(params)? }))),
        "notifications.clear" => Ok(Some(json!({ "action": "clear" }))),
        _ => Err("Unsupported mobile operation".into()),
    }
}

fn apply(items: &mut Vec<Value>, change: &Value) {
    let named = |item: &Value| {
        change["ids"]
            .as_array()
            .is_none_or(|ids| ids.iter().any(|id| *id == item["id"]))
    };
    match change["action"].as_str() {
        Some("clear") => items.clear(),
        Some("dismiss") => items.retain(|item| !named(item)),
        Some("read") => {
            for item in items.iter_mut().filter(|item| named(item)) {
                item["read"] = json!(true);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str) -> Value {
        json!({ "id": id, "kind": "finished", "title": "Chat", "body": "Done", "at": 5, "read": false })
    }

    #[test]
    fn sanitize_keeps_valid_entries_clipped_and_capped() {
        let long = "x".repeat(BODY_CHARS + 50);
        let items = json!([
            { "id": "a", "kind": "approval", "title": "T", "body": long, "at": 1.0, "read": true,
              "sessionId": "s1", "projectId": "E%3A%5Crepo", "projectName": "repo", "seenOnDesktop": true,
              "cwd": "E:\\secret" },
            { "id": "b", "kind": "other", "title": "T", "body": "B", "at": 1, "read": false },
            { "id": "", "kind": "finished", "title": "T", "body": "B", "at": 1, "read": false },
            { "id": "c", "kind": "finished", "title": "T", "body": "B", "at": -1, "read": false },
            { "id": "d", "kind": "finished", "title": "T", "body": "B", "at": 2 },
        ]);
        let kept = sanitize(&items).unwrap();
        assert_eq!(kept.len(), 1);
        assert_eq!(
            kept[0]["body"].as_str().unwrap().chars().count(),
            BODY_CHARS
        );
        assert_eq!(kept[0]["sessionId"], "s1");
        assert_eq!(kept[0]["seenOnDesktop"], true);
        assert!(kept[0].get("cwd").is_none());
        let many: Vec<Value> = (0..MAX_ITEMS + 5)
            .map(|i| entry(&format!("n{i}")))
            .collect();
        assert_eq!(sanitize(&json!(many)).unwrap().len(), MAX_ITEMS);
        assert!(sanitize(&json!({})).is_err());
    }

    #[test]
    fn sanitize_keeps_request_ids_for_approvals_and_questions_only() {
        let items = json!([
            { "id": "s:approval:7", "kind": "approval", "title": "T", "body": "B", "at": 1, "read": false, "requestId": 7 },
            { "id": "s:question:8", "kind": "question", "title": "T", "body": "B", "at": 1, "read": false, "requestId": 8 },
            { "id": "s:finished", "kind": "finished", "title": "T", "body": "B", "at": 1, "read": false, "requestId": 9 },
            { "id": "s:approval:x", "kind": "approval", "title": "T", "body": "B", "at": 1, "read": false, "requestId": "x" },
        ]);
        let kept = sanitize(&items).unwrap();
        assert_eq!(kept[0]["requestId"], 7);
        assert_eq!(kept[1]["requestId"], 8);
        assert!(kept[2].get("requestId").is_none());
        assert!(kept[3].get("requestId").is_none());
    }

    #[test]
    fn changes_are_parsed_and_applied() {
        assert_eq!(change_for("notifications.list", &json!({})).unwrap(), None);
        assert!(change_for("notifications.dismiss", &json!({ "ids": [] })).is_err());
        assert!(change_for("notifications.dismiss", &json!({ "ids": [3] })).is_err());
        assert!(change_for("notifications.other", &json!({})).is_err());

        let mut items = vec![entry("a"), entry("b"), entry("c")];
        let dismiss = change_for("notifications.dismiss", &json!({ "ids": ["b"] }))
            .unwrap()
            .unwrap();
        apply(&mut items, &dismiss);
        assert_eq!(
            items.iter().map(|i| i["id"].clone()).collect::<Vec<_>>(),
            [json!("a"), json!("c")]
        );

        let read_one = change_for("notifications.read", &json!({ "ids": ["c"] }))
            .unwrap()
            .unwrap();
        apply(&mut items, &read_one);
        assert_eq!(items[0]["read"], false);
        assert_eq!(items[1]["read"], true);

        let read_all = change_for("notifications.read", &json!({}))
            .unwrap()
            .unwrap();
        apply(&mut items, &read_all);
        assert!(items.iter().all(|item| item["read"] == true));

        let clear = change_for("notifications.clear", &json!({}))
            .unwrap()
            .unwrap();
        apply(&mut items, &clear);
        assert!(items.is_empty());
    }
}
