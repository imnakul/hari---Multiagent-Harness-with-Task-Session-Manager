//! Fork (Hari, L-398): the paired phone's screen time, kept for Activity.
//!
//! Hari (Android) reads which apps were in the foreground and for how long
//! (`phone.usage`), resuming from where the computer last heard from it
//! (`phone.usageCursor`). Only app names and times arrive, never anything
//! inside an app. Stored in `activity.db`; the Activity page reads it with
//! `activity_phone_summary`.
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::activity::store::{self, ActivityDb, PhoneInterval};
use crate::activity::CHANGED_EVENT;
use crate::session_store::now_millis;

const CURSOR_METHOD: &str = "phone.usageCursor";
const USAGE_METHOD: &str = "phone.usage";
const MAX_INTERVALS: usize = 500;
const MAX_NAME_CHARS: usize = 80;
const MAX_PACKAGE_CHARS: usize = 200;
const MAX_LABEL_CHARS: usize = 120;
const MAX_INTERVAL_MS: i64 = 24 * 60 * 60 * 1000;
/// A phone clock slightly ahead of the computer's is fine.
const CLOCK_SKEW_MS: i64 = 5 * 60 * 1000;

pub(crate) fn handles(method: &str) -> bool {
    method == CURSOR_METHOD || method == USAGE_METHOD
}

/// `8 to 64` letters, digits and dashes: the phone's random id.
fn valid_device(device: &str) -> bool {
    (8..=64).contains(&device.len())
        && device
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

fn valid_package(package: &str) -> bool {
    !package.is_empty()
        && package.chars().count() <= MAX_PACKAGE_CHARS
        && package
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_')
}

/// Keeps the well-formed intervals and counts the rest. At most 500 are read;
/// the phone sends in chunks of that size.
pub(crate) fn validate_intervals(raw: &Value, now: i64) -> (Vec<PhoneInterval>, usize) {
    let Some(items) = raw.as_array() else {
        return (Vec::new(), 0);
    };
    let mut valid = Vec::new();
    let mut skipped = 0;
    for item in items.iter().take(MAX_INTERVALS) {
        let package = item["package"].as_str().unwrap_or("");
        let label = item["label"].as_str().unwrap_or("").trim();
        let (Some(start), Some(end)) = (item["start"].as_i64(), item["end"].as_i64()) else {
            skipped += 1;
            continue;
        };
        let label = if label.is_empty() { package } else { label };
        if !valid_package(package)
            || label.chars().count() > MAX_LABEL_CHARS
            || start <= 0
            || end <= start
            || end > now + CLOCK_SKEW_MS
            || end - start > MAX_INTERVAL_MS
        {
            skipped += 1;
            continue;
        }
        valid.push(PhoneInterval {
            package: package.to_string(),
            label: label.to_string(),
            start,
            end,
        });
    }
    skipped += items.len().saturating_sub(MAX_INTERVALS);
    (valid, skipped)
}

/// Answers `phone.usageCursor` with `{since}` and `phone.usage` with
/// `{stored, skipped}`. Runs off the pairing lock (see `mobile_access`).
pub(crate) fn handle(app: &AppHandle, method: &str, params: &Value) -> Result<Value, String> {
    let device = params["device"].as_str().unwrap_or("");
    if !valid_device(device) {
        return Err("Invalid device".into());
    }
    let db = app.state::<ActivityDb>();
    if method == CURSOR_METHOD {
        let since = db.with(|conn| store::phone_cursor(conn, device))?;
        return Ok(json!({ "since": since }));
    }
    let name: String = params["name"]
        .as_str()
        .unwrap_or("")
        .trim()
        .chars()
        .take(MAX_NAME_CHARS)
        .collect();
    let now = now_millis();
    let (intervals, skipped) = validate_intervals(&params["intervals"], now);
    db.with(|conn| store::upsert_phone_usage(conn, device, &name, now, &intervals))?;
    let _ = app.emit(CHANGED_EVENT, ());
    Ok(json!({ "stored": intervals.len(), "skipped": skipped }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_795_000_000_000;

    fn good(package: &str, start: i64, end: i64) -> Value {
        json!({ "package": package, "label": "App", "start": start, "end": end })
    }

    #[test]
    fn skips_a_bad_interval_and_keeps_the_rest() {
        let mut items: Vec<Value> = (0..9)
            .map(|i| good("com.example.app", NOW - 100_000 + i, NOW - 50_000 + i))
            .collect();
        items.push(good("com.example.app", NOW - 10, NOW - 50_000));
        let (valid, skipped) = validate_intervals(&Value::Array(items), NOW);
        assert_eq!(valid.len(), 9);
        assert_eq!(skipped, 1);
    }

    #[test]
    fn rejects_bad_packages_future_and_overlong_intervals() {
        let items = json!([
            good("bad package!", NOW - 2_000, NOW - 1_000),
            good("", NOW - 2_000, NOW - 1_000),
            good("com.ok", NOW - 2_000, NOW + 10 * 60_000),
            good("com.ok", NOW - 25 * 60 * 60 * 1000, NOW - 1_000),
            good("com.ok", 0, 500),
            { "package": "com.ok", "label": "x".repeat(121), "start": NOW - 2_000, "end": NOW - 1_000 },
            { "package": "com.ok", "start": "soon", "end": NOW },
            good("com.ok", NOW - 2_000, NOW - 1_000),
        ]);
        let (valid, skipped) = validate_intervals(&items, NOW);
        assert_eq!(valid.len(), 1);
        assert_eq!(skipped, 7);
    }

    #[test]
    fn a_missing_label_falls_back_to_the_package() {
        let items = json!([{ "package": "com.example.mail", "start": NOW - 2_000, "end": NOW - 1_000 }]);
        let (valid, _) = validate_intervals(&items, NOW);
        assert_eq!(valid[0].label, "com.example.mail");
    }

    #[test]
    fn counts_everything_past_the_chunk_limit_as_skipped() {
        let items: Vec<Value> = (0..502)
            .map(|i| good("com.ok", NOW - 100_000 + i, NOW - 50_000 + i))
            .collect();
        let (valid, skipped) = validate_intervals(&Value::Array(items), NOW);
        assert_eq!(valid.len(), 500);
        assert_eq!(skipped, 2);
    }

    #[test]
    fn only_a_well_formed_device_id_is_accepted() {
        assert!(valid_device("3f2a9c1e-77b0-4d1c"));
        assert!(!valid_device("short"));
        assert!(!valid_device("has space in it!"));
        assert!(!valid_device(&"a".repeat(65)));
    }

    #[test]
    fn routes_only_its_two_methods() {
        assert!(handles("phone.usage") && handles("phone.usageCursor"));
        assert!(!handles("phone.notifications"));
    }
}
