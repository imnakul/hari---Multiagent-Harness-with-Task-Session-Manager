//! Fork (Hari, L-354): the phone's bookmarks, in the same session panel the
//! desktop's Bookmarks list reads (L-191). The panel's JSON shape belongs to the
//! frontend (`sessionPanel.ts`); only its `bookmarks` list is touched here, with
//! the same rules: one whole-reply bookmark per reply, one per quote within it,
//! the newest last and at most 300. Saving tells every window to reload.
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::session_panel::{session_panel_get_blocking, session_panel_save_blocking, SessionPanelSave};
use crate::session_store::now_millis;

const METHODS: [&str; 3] = ["bookmarks.list", "bookmarks.toggle", "bookmarks.quote"];
const TEXT_MAX: usize = 400;
const QUOTE_MAX: usize = 2_000;
const BOOKMARKS_MAX: usize = 300;

pub(crate) fn handles(method: &str) -> bool {
    METHODS.contains(&method)
}

pub(crate) async fn handle(app: &AppHandle, method: &str, params: Value) -> Result<Value, String> {
    let worker = app.clone();
    let name = method.to_owned();
    tauri::async_runtime::spawn_blocking(move || run(&worker, &name, &params))
        .await
        .map_err(|error| error.to_string())?
}

fn run(app: &AppHandle, method: &str, params: &Value) -> Result<Value, String> {
    let session = text(params, "sessionId");
    let mut data = read(app, &session)?;
    match method {
        "bookmarks.list" => Ok(json!({ "blockIds": whole_reply_ids(&data) })),
        "bookmarks.toggle" => {
            let block = required(params, "blockId")?;
            let bookmarked = toggle(&mut data, &block, &text(params, "text"), now_millis());
            write(app, &session, &data)?;
            Ok(json!({ "bookmarked": bookmarked, "blockIds": whole_reply_ids(&data) }))
        }
        "bookmarks.quote" => {
            let block = required(params, "blockId")?;
            let quote = clean(&text(params, "quote"), QUOTE_MAX);
            if quote.is_empty() {
                return Err("Select some text to bookmark".into());
            }
            add(&mut data, &block, "", Some(&quote), now_millis());
            write(app, &session, &data)?;
            Ok(json!({ "bookmarked": true }))
        }
        _ => Err("Unsupported mobile operation".into()),
    }
}

fn read(app: &AppHandle, session: &str) -> Result<Value, String> {
    let saved = session_panel_get_blocking(app.state(), session.to_owned())?;
    let mut data = saved
        .and_then(|panel| serde_json::from_str::<Value>(&panel.data).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({ "version": 1, "points": [] }));
    if !data["bookmarks"].is_array() {
        data["bookmarks"] = json!([]);
    }
    Ok(data)
}

fn write(app: &AppHandle, session: &str, data: &Value) -> Result<(), String> {
    session_panel_save_blocking(
        app.clone(),
        app.state(),
        SessionPanelSave { session_id: session.to_owned(), data: data.to_string() },
    )
    .map(|_| ())
}

fn list(data: &mut Value) -> &mut Vec<Value> {
    if !data["bookmarks"].is_array() {
        data["bookmarks"] = json!([]);
    }
    data["bookmarks"].as_array_mut().expect("bookmarks is an array")
}

fn quote_of(bookmark: &Value) -> &str {
    bookmark["quote"].as_str().unwrap_or_default()
}

/// Replies bookmarked whole; a saved quote doesn't mark its reply as set.
fn whole_reply_ids(data: &Value) -> Vec<String> {
    data["bookmarks"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter(|bookmark| quote_of(bookmark).is_empty())
                .filter_map(|bookmark| bookmark["blockId"].as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

/// Removes the reply's whole-reply bookmark, or adds one; true when added.
fn toggle(data: &mut Value, block: &str, line: &str, now: i64) -> bool {
    let items = list(data);
    let before = items.len();
    items.retain(|bookmark| !(bookmark["blockId"] == block && quote_of(bookmark).is_empty()));
    if items.len() != before {
        return false;
    }
    add(data, block, line, None, now);
    true
}

fn add(data: &mut Value, block: &str, line: &str, quote: Option<&str>, now: i64) {
    let quote = quote.unwrap_or_default();
    let items = list(data);
    items.retain(|bookmark| !(bookmark["blockId"] == block && quote_of(bookmark) == quote));
    let mut added = json!({
        "id": format!("b-{}-p{}", radix36(now), radix36(items.len() as i64)),
        "blockId": block,
        "text": clean(line, TEXT_MAX),
        "at": now,
    });
    if !quote.is_empty() {
        added["quote"] = json!(quote);
    }
    items.push(added);
    let extra = items.len().saturating_sub(BOOKMARKS_MAX);
    items.drain(..extra);
}

/// As `cleanText` on the desktop: runs of space become one, trimmed, capped.
fn clean(value: &str, max: usize) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(max).collect()
}

fn radix36(mut value: i64) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if value <= 0 {
        return "0".into();
    }
    let mut out = Vec::new();
    while value > 0 {
        out.push(DIGITS[(value % 36) as usize]);
        value /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

fn text(params: &Value, key: &str) -> String {
    params[key].as_str().unwrap_or_default().to_owned()
}

fn required(params: &Value, key: &str) -> Result<String, String> {
    let value = text(params, key);
    if value.trim().is_empty() {
        return Err(format!("Missing {key}"));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toggles_a_whole_reply_and_keeps_its_quotes() {
        let mut data = json!({ "version": 1, "points": [], "bookmarks": [] });
        add(&mut data, "t1", "", Some("a quote"), 1);
        assert!(toggle(&mut data, "t1", "  Fix   the bug ", 2));
        assert_eq!(whole_reply_ids(&data), vec!["t1"]);
        assert_eq!(data["bookmarks"][1]["text"], "Fix the bug");
        assert!(!toggle(&mut data, "t1", "", 3));
        assert!(whole_reply_ids(&data).is_empty());
        assert_eq!(data["bookmarks"].as_array().unwrap().len(), 1);
        assert_eq!(data["bookmarks"][0]["quote"], "a quote");
    }

    #[test]
    fn the_same_quote_moves_to_the_end_and_the_list_is_capped() {
        let mut data = json!({});
        for at in 0..(BOOKMARKS_MAX as i64 + 5) {
            add(&mut data, &format!("t{at}"), "", Some("q"), at);
        }
        add(&mut data, "t10", "", Some("q"), 999);
        let items = data["bookmarks"].as_array().unwrap();
        assert_eq!(items.len(), BOOKMARKS_MAX);
        assert_eq!(items.last().unwrap()["blockId"], "t10");
        assert_eq!(items.iter().filter(|item| item["blockId"] == "t10").count(), 1);
    }
}
