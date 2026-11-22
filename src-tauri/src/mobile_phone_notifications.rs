//! Fork (Hari, L-325): the paired phone's notifications, for the Notifications
//! view in Share.
//!
//! The phone sends its whole list (`phone.notifications`, minus the apps the
//! user skipped there) on every connect and after each change; nothing waits
//! for an absent computer. What left the phone stays as "earlier" for a day.
//! Kept in memory only: notification text is never written to disk, and a
//! restart forgets it all. Dismissing one here asks the phone to clear it.
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, Window};

/// Identifier prefix of a desktop banner for a phone notification (L-384).
pub(crate) const NOTIFICATION_PREFIX: &str = "hari-phone:";
const SHARE_OPEN_EVENT: &str = "monocode-share-open";
const METHOD: &str = "phone.notifications";
const CHANGE_EVENT: &str = "monocode-phone-notifications-changed";
const MAX_ITEMS: usize = 150;
const MAX_EARLIER: usize = 300;
const EARLIER_MS: u64 = 24 * 60 * 60 * 1000;
/// A dismissed notification the phone still lists (it hasn't cleared it yet)
/// stays hidden this long.
const DISMISSED_MS: u64 = 2 * 60 * 1000;
const MAX_KEY_CHARS: usize = 512;
const MAX_PACKAGE_CHARS: usize = 255;
const MAX_APP_CHARS: usize = 120;
const MAX_TITLE_CHARS: usize = 300;
const MAX_TEXT_CHARS: usize = 2000;
const MAX_ICON_BYTES: usize = 48 * 1024;
const MAX_ICONS: usize = 400;
const PNG_MAGIC: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Notice {
    key: String,
    package: String,
    app: String,
    title: String,
    text: String,
    posted_at: u64,
}

#[derive(Default)]
struct State {
    /// The phone the list came from; another phone's list replaces it whole.
    peer: Option<String>,
    on_phone: Vec<Notice>,
    /// Left the phone (cleared there, or the computer was told the phone
    /// stopped sending), newest first.
    earlier: Vec<Notice>,
    /// Base64 PNGs by app package.
    icons: HashMap<String, String>,
    dismissed: HashMap<String, u64>,
    /// Whether the phone has sent a list since it last said it stopped.
    receiving: bool,
    /// L-334: the phone is set to send but its notification reader isn't
    /// running (Android left it stopped, often after an app update).
    stalled: bool,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);

fn with<T>(apply: impl FnOnce(&mut State) -> T) -> Result<T, String> {
    let mut guard = STATE
        .lock()
        .map_err(|_| "Phone notifications are unavailable".to_string())?;
    Ok(apply(guard.get_or_insert_with(State::default)))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

fn clipped(value: &Value, max: usize) -> String {
    value
        .as_str()
        .unwrap_or_default()
        .trim()
        .chars()
        .take(max)
        .collect()
}

/// The phone's entries, read defensively: one with no key, package or time is dropped.
fn parse_items(value: &Value) -> Vec<Notice> {
    let Some(list) = value.as_array() else {
        return Vec::new();
    };
    list.iter()
        .take(MAX_ITEMS)
        .filter_map(|raw| {
            let key = raw["key"].as_str().filter(|key| {
                !key.is_empty() && key.chars().count() <= MAX_KEY_CHARS
            })?;
            let package = raw["package"].as_str().filter(|package| {
                !package.is_empty() && package.chars().count() <= MAX_PACKAGE_CHARS
            })?;
            let posted_at = raw["postedAt"].as_u64()?;
            let app = clipped(&raw["app"], MAX_APP_CHARS);
            Some(Notice {
                key: key.into(),
                package: package.into(),
                app: if app.is_empty() { package.into() } else { app },
                title: clipped(&raw["title"], MAX_TITLE_CHARS),
                text: clipped(&raw["text"], MAX_TEXT_CHARS),
                posted_at,
            })
        })
        .collect()
}

/// A PNG of reasonable size, as base64.
fn valid_icon(base64: &str) -> bool {
    base64.len() <= MAX_ICON_BYTES * 4 / 3 + 4
        && STANDARD
            .decode(base64)
            .is_ok_and(|bytes| bytes.starts_with(&PNG_MAGIC))
}

impl State {
    fn reset(&mut self) {
        *self = State::default();
    }

    fn prune(&mut self, now: u64) {
        self.earlier
            .retain(|notice| now.saturating_sub(notice.posted_at) <= EARLIER_MS);
        self.earlier.truncate(MAX_EARLIER);
        self.dismissed
            .retain(|_, at| now.saturating_sub(*at) <= DISMISSED_MS);
    }

    /// L-334: the phone says its reader stopped; another phone starts afresh.
    fn stall(&mut self, peer: &str) {
        if self.peer.as_deref() != Some(peer) {
            self.reset();
            self.peer = Some(peer.into());
        }
        self.stalled = true;
    }

    /// The phone's new list: what's gone from it moves to earlier.
    fn replace(&mut self, peer: &str, items: Vec<Notice>, now: u64) {
        if self.peer.as_deref() != Some(peer) {
            self.reset();
            self.peer = Some(peer.into());
        }
        self.receiving = true;
        self.stalled = false;
        self.prune(now);
        let items: Vec<Notice> = items
            .into_iter()
            .filter(|notice| !self.dismissed.contains_key(&notice.key))
            .collect();
        let gone: Vec<Notice> = self
            .on_phone
            .drain(..)
            .filter(|old| !items.iter().any(|notice| notice.key == old.key))
            .collect();
        self.earlier
            .retain(|old| !items.iter().any(|notice| notice.key == old.key));
        for notice in gone.into_iter().rev() {
            self.earlier.retain(|old| old.key != notice.key);
            self.earlier.insert(0, notice);
        }
        self.earlier
            .sort_by(|a, b| b.posted_at.cmp(&a.posted_at));
        self.on_phone = items;
        self.prune(now);
    }

    fn add_icons(&mut self, icons: &Map<String, Value>) {
        for (package, icon) in icons {
            let Some(icon) = icon.as_str().filter(|icon| valid_icon(icon)) else {
                continue;
            };
            if package.is_empty() || package.chars().count() > MAX_PACKAGE_CHARS {
                continue;
            }
            if self.icons.len() >= MAX_ICONS && !self.icons.contains_key(package) {
                continue;
            }
            self.icons.insert(package.clone(), icon.into());
        }
    }

    /// Takes one off the view; true when the phone still shows it.
    fn dismiss(&mut self, key: &str, now: u64) -> bool {
        let before = self.on_phone.len();
        self.on_phone.retain(|notice| notice.key != key);
        self.earlier.retain(|notice| notice.key != key);
        let on_phone = self.on_phone.len() != before;
        if on_phone {
            self.dismissed.insert(key.into(), now);
        }
        on_phone
    }

    fn view(&self) -> Value {
        let mut packages: Vec<&str> = self
            .on_phone
            .iter()
            .chain(&self.earlier)
            .map(|notice| notice.package.as_str())
            .collect();
        packages.sort_unstable();
        packages.dedup();
        let icons: Map<String, Value> = packages
            .into_iter()
            .filter_map(|package| {
                self.icons
                    .get(package)
                    .map(|icon| (package.to_string(), json!(icon)))
            })
            .collect();
        json!({
            "receiving": self.receiving,
            "stalled": self.stalled,
            "onPhone": self.on_phone,
            "earlier": self.earlier,
            "icons": icons,
        })
    }
}

pub(crate) fn handles(method: &str) -> bool {
    method == METHOD
}

/// `phone.notifications`, from a paired phone: its whole list, or that it
/// stopped sending (`enabled: false`), which empties the view.
pub(crate) fn handle(app: &AppHandle, peer: &str, params: &Value) -> Result<Value, String> {
    if params["enabled"] == false {
        with(|state| {
            if state.peer.as_deref() == Some(peer) || state.peer.is_none() {
                state.reset();
            }
        })?;
    } else if params["listening"] == false {
        // L-334: the reader isn't running; keep what we had, say why it's quiet.
        with(|state| state.stall(peer))?;
    } else {
        let items = parse_items(&params["items"]);
        with(|state| {
            state.replace(peer, items, now_ms());
            if let Some(icons) = params["icons"].as_object() {
                state.add_icons(icons);
            }
        })?;
    }
    let _ = app.emit(CHANGE_EVENT, ());
    Ok(json!({ "ok": true }))
}

fn check_window(window: &Window) -> Result<(), String> {
    if crate::window::is_workspace_window(window.label()) {
        Ok(())
    } else {
        Err("Only workspace windows can show phone notifications".into())
    }
}

/// What the view shows: `{ receiving, stalled, paired, onPhone, earlier, icons }`.
/// An unpaired phone's list is forgotten.
#[tauri::command]
pub fn mobile_phone_notifications_list(window: Window, app: AppHandle) -> Result<Value, String> {
    check_window(&window)?;
    let phones = crate::mobile_access::paired_phones(&app);
    with(|state| {
        let paired = state
            .peer
            .as_ref()
            .is_some_and(|peer| phones.iter().any(|(phone, _)| phone == peer));
        if state.peer.is_some() && !paired {
            state.reset();
        }
        state.prune(now_ms());
        let mut view = state.view();
        view["paired"] = json!(!phones.is_empty());
        view
    })
}

/// Takes one off the view, and clears it on the phone (now, or when the phone
/// is next connected).
#[tauri::command]
pub fn mobile_phone_notification_dismiss(
    window: Window,
    app: AppHandle,
    key: String,
) -> Result<(), String> {
    check_window(&window)?;
    let (peer, on_phone) = with(|state| (state.peer.clone(), state.dismiss(&key, now_ms())))?;
    if let (Some(peer), true) = (peer, on_phone) {
        crate::mobile_events::push(&peer, "notifications.dismiss", json!({ "key": key }))?;
    }
    let _ = app.emit(CHANGE_EVENT, ());
    Ok(())
}

/// Forgets the ones no longer on the phone.
#[tauri::command]
pub fn mobile_phone_notifications_clear(window: Window, app: AppHandle) -> Result<(), String> {
    check_window(&window)?;
    with(|state| state.earlier.clear())?;
    let _ = app.emit(CHANGE_EVENT, ());
    Ok(())
}

/// Payload of the event that opens Share on the Notifications view, scrolled
/// to one notice.
fn open_payload(key: &str) -> Value {
    json!({ "view": "notifications", "key": key })
}

/// Clicked phone banner: bring the main window forward and open Share on
/// Notifications at that notice.
pub(crate) fn open_from_notification(app: &AppHandle, key: &str) {
    use tauri::Manager;
    let handle = app.clone();
    let payload = open_payload(key);
    let _ = app.run_on_main_thread(move || {
        let mut windows = handle.windows();
        windows.retain(|label, _| crate::window::is_workspace_window(label));
        let target = windows
            .values()
            .find(|window| window.is_focused().unwrap_or(false))
            .or_else(|| windows.get("main"))
            .or_else(|| windows.values().min_by_key(|window| window.label()));
        if let Some(window) = target {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
        let _ = handle.emit(SHARE_OPEN_EVENT, payload);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notice(key: &str, posted_at: u64) -> Value {
        json!({ "key": key, "package": "com.chat", "app": "Chat", "title": "Ann", "text": "Hi", "postedAt": posted_at })
    }

    #[test]
    fn a_clicked_banner_opens_share_on_notifications_at_its_key() {
        assert!(NOTIFICATION_PREFIX.ends_with(':'));
        assert_eq!(
            open_payload("k1"),
            json!({ "view": "notifications", "key": "k1" })
        );
    }

    #[test]
    fn a_stopped_reader_keeps_the_list_until_the_next_one_arrives() {
        let mut state = State::default();
        state.replace("phone", parse_items(&json!([notice("a", 1)])), 10);
        state.stall("phone");
        assert!(state.stalled);
        assert_eq!(state.on_phone.len(), 1);
        state.replace("phone", parse_items(&json!([notice("a", 1)])), 10);
        assert!(!state.stalled);
        state.stall("other");
        assert!(state.stalled && state.on_phone.is_empty());
    }

    #[test]
    fn broken_entries_are_dropped_and_long_text_is_cut() {
        let long = "x".repeat(MAX_TEXT_CHARS + 50);
        let items = parse_items(&json!([
            notice("a", 1),
            { "key": "b", "postedAt": 2 },
            { "key": "c", "package": "com.mail", "postedAt": 3, "text": long },
            "nonsense",
        ]));
        assert_eq!(items.len(), 2);
        assert_eq!(items[1].app, "com.mail");
        assert_eq!(items[1].text.chars().count(), MAX_TEXT_CHARS);
    }

    #[test]
    fn what_leaves_the_phone_moves_to_earlier_for_a_day() {
        let now = EARLIER_MS * 2;
        let mut state = State::default();
        state.replace("phone", parse_items(&json!([notice("a", now - 10), notice("b", now - 5)])), now);
        state.replace("phone", parse_items(&json!([notice("b", now - 5)])), now);
        assert_eq!(state.on_phone.len(), 1);
        assert_eq!(state.earlier.iter().map(|n| n.key.as_str()).collect::<Vec<_>>(), ["a"]);
        // Shown again on the phone: back out of earlier.
        state.replace("phone", parse_items(&json!([notice("a", now - 10), notice("b", now - 5)])), now);
        assert!(state.earlier.is_empty());
        state.replace("phone", Vec::new(), now);
        state.prune(now + EARLIER_MS);
        assert!(state.earlier.is_empty());
    }

    #[test]
    fn another_phone_replaces_the_list_whole() {
        let mut state = State::default();
        state.replace("one", parse_items(&json!([notice("a", 1)])), 2);
        state.replace("two", parse_items(&json!([notice("b", 1)])), 2);
        assert!(state.earlier.is_empty());
        assert_eq!(state.on_phone[0].key, "b");
    }

    #[test]
    fn a_dismissed_one_stays_hidden_until_the_phone_clears_it() {
        let mut state = State::default();
        state.replace("phone", parse_items(&json!([notice("a", 1), notice("b", 1)])), 10);
        assert!(state.dismiss("a", 10));
        state.replace("phone", parse_items(&json!([notice("a", 1), notice("b", 1)])), 20);
        assert_eq!(state.on_phone.len(), 1);
        assert!(state.earlier.is_empty());
        // Not on the phone: nothing to tell it.
        assert!(!state.dismiss("zzz", 20));
    }

    #[test]
    fn only_png_icons_are_kept() {
        let mut state = State::default();
        let png = STANDARD.encode([PNG_MAGIC.as_slice(), &[0, 1, 2]].concat());
        let mut icons = Map::new();
        icons.insert("com.chat".into(), json!(png));
        icons.insert("com.bad".into(), json!(STANDARD.encode(b"<svg/>")));
        icons.insert("com.junk".into(), json!("%%%"));
        state.add_icons(&icons);
        assert_eq!(state.icons.keys().collect::<Vec<_>>(), ["com.chat"]);
    }
}
