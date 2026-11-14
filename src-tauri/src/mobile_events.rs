//! Fork (Hari, L-277): the always-open event stream to each paired phone.
//!
//! The phone holds one `events.watch` open (in view and, with the watcher on,
//! in the background). Two things travel on it:
//! - **Items**: kept in a per-phone outbox on disk until the phone acks them,
//!   numbered per phone, resent after a reconnect, so nothing is lost while the
//!   phone is away. The phone ignores ids it has seen.
//! - **Signals**: the latest value per kind (for example the bell's list), sent
//!   when it changes and once on every connect. Not stored: a phone that was
//!   away gets the current value, not the history.
//!
//! The phone sends its own items with `events.send` (deduplicated by id) and
//! acks ours with `events.ack`. Commands (power, app control) never travel as
//! items: they are requests that are refused when stale.
use std::{
    collections::{HashMap, VecDeque},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::sync::Notify;

const METHODS: [&str; 2] = ["events.ack", "events.send"];
const FILE: &str = "mobile-events.json";
/// Items waiting for one phone; the oldest go first past this.
const MAX_ITEMS: usize = 200;
const MAX_PAYLOAD_BYTES: usize = 64 * 1024;
const MAX_AGE_MS: u64 = 7 * 24 * 60 * 60 * 1000;
/// Ids of the phone's items already taken, so a resend is not taken twice.
const SEEN_IDS: usize = 500;
const MAX_ID_CHARS: usize = 128;
const MAX_KIND_CHARS: usize = 64;
/// Items the phone may send at once.
const MAX_SEND_BATCH: usize = 50;
/// Frames written before the pump looks for newer ones.
const PUMP_BATCH: usize = 32;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct Item {
    pub seq: u64,
    pub id: String,
    pub kind: String,
    pub at: u64,
    pub payload: Value,
}

/// One phone's side of the link, as stored.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Outbox {
    /// Changes when the outbox is made anew (first use, or file lost), so the
    /// phone knows its cursor no longer applies.
    epoch: String,
    next_seq: u64,
    items: VecDeque<Item>,
    seen: VecDeque<String>,
}
impl Outbox {
    fn new() -> Self {
        Self {
            epoch: uuid::Uuid::new_v4().to_string(),
            next_seq: 1,
            items: VecDeque::new(),
            seen: VecDeque::new(),
        }
    }
    fn push(&mut self, kind: &str, payload: Value, now: u64) -> Item {
        let item = Item {
            seq: self.next_seq,
            id: uuid::Uuid::new_v4().to_string(),
            kind: kind.into(),
            at: now,
            payload,
        };
        self.next_seq += 1;
        self.items.push_back(item.clone());
        self.prune(now);
        item
    }
    fn prune(&mut self, now: u64) {
        self.items
            .retain(|item| now.saturating_sub(item.at) <= MAX_AGE_MS);
        while self.items.len() > MAX_ITEMS {
            self.items.pop_front();
        }
    }
    /// Drops what the phone confirmed. False when the epoch is not this one.
    fn ack(&mut self, epoch: &str, seq: u64) -> bool {
        if epoch != self.epoch {
            return false;
        }
        let before = self.items.len();
        self.items.retain(|item| item.seq > seq);
        before != self.items.len()
    }
    /// Whether this id is new; remembers it.
    fn take(&mut self, id: &str) -> bool {
        if self.seen.iter().any(|seen| seen == id) {
            return false;
        }
        self.seen.push_back(id.into());
        while self.seen.len() > SEEN_IDS {
            self.seen.pop_front();
        }
        true
    }
    /// The items after `after`, or all of them when the phone's cursor is from
    /// another epoch.
    fn after(&self, epoch: Option<&str>, after: u64, limit: usize) -> Vec<Item> {
        let after = if epoch == Some(self.epoch.as_str()) {
            after
        } else {
            0
        };
        self.items
            .iter()
            .filter(|item| item.seq > after)
            .take(limit)
            .cloned()
            .collect()
    }
}

struct Stream {
    token: u64,
    wake: Arc<Notify>,
}

#[derive(Default)]
struct Events {
    path: Option<PathBuf>,
    outboxes: HashMap<String, Outbox>,
    streams: HashMap<String, Stream>,
    /// Latest value per signal kind, with the version it was set at.
    signals: HashMap<String, (u64, Value)>,
    version: u64,
    next_token: u64,
}

static EVENTS: Mutex<Option<Events>> = Mutex::new(None);

fn with<T>(apply: impl FnOnce(&mut Events) -> T) -> Result<T, String> {
    let mut guard = EVENTS.lock().map_err(|_| "Phone link unavailable")?;
    Ok(apply(guard.get_or_insert_with(Events::default)))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

/// Loads the outboxes. A missing or unreadable file starts empty (each phone
/// then gets a new epoch and resets its cursor).
pub fn init(app: &AppHandle) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(FILE);
    let mut outboxes: HashMap<String, Outbox> = std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let now = now_ms();
    for outbox in outboxes.values_mut() {
        outbox.prune(now);
    }
    with(|events| {
        events.path = Some(path);
        events.outboxes = outboxes;
    })
}

fn save(events: &Events) {
    let Some(path) = events.path.as_ref() else {
        return;
    };
    let Ok(bytes) = serde_json::to_vec(&events.outboxes) else {
        return;
    };
    let temp = path.with_extension("json.tmp");
    if std::fs::write(&temp, bytes).is_ok() {
        if let Err(error) = std::fs::rename(&temp, path) {
            eprintln!("monocode: couldn't save the phone outbox: {error}");
        }
    }
}

/// Queues an item for one phone; it goes now if the phone is connected, else
/// on its next connect.
// TODO(nakul): first used by Share (L-279); remove this allow then.
#[allow(dead_code)]
pub(crate) fn push(peer: &str, kind: &str, payload: Value) -> Result<Item, String> {
    if serde_json::to_vec(&payload).map_or(true, |bytes| bytes.len() > MAX_PAYLOAD_BYTES) {
        return Err("Item too large".into());
    }
    with(|events| {
        let item = events
            .outboxes
            .entry(peer.into())
            .or_insert_with(Outbox::new)
            .push(kind, payload, now_ms());
        save(events);
        if let Some(stream) = events.streams.get(peer) {
            stream.wake.notify_one();
        }
        item
    })
}

/// Sets a signal's latest value and sends it to every connected phone.
pub(crate) fn signal(kind: &str, payload: Value) {
    let _ = with(|events| {
        events.version += 1;
        let version = events.version;
        events.signals.insert(kind.into(), (version, payload));
        for stream in events.streams.values() {
            stream.wake.notify_one();
        }
    });
}

/// Ends the phone's stream and drops its outbox (revoked, or it left).
pub(crate) fn forget(peer: &str) {
    let _ = with(|events| {
        events.streams.remove(peer);
        if events.outboxes.remove(peer).is_some() {
            save(events);
        }
    });
}

pub(crate) fn handles(method: &str) -> bool {
    METHODS.contains(&method)
}

/// `events.ack` and `events.send`, from a paired phone.
pub(crate) fn handle(
    app: &AppHandle,
    peer: &str,
    method: &str,
    params: &Value,
) -> Result<Value, String> {
    match method {
        "events.ack" => {
            let epoch = params["epoch"].as_str().ok_or("Missing epoch")?;
            let seq = params["seq"].as_u64().ok_or("Missing sequence")?;
            with(|events| {
                let changed = events
                    .outboxes
                    .get_mut(peer)
                    .is_some_and(|outbox| outbox.ack(epoch, seq));
                if changed {
                    save(events);
                }
            })?;
            Ok(json!({ "ok": true }))
        }
        "events.send" => {
            let list = params["items"].as_array().ok_or("Missing items")?;
            if list.len() > MAX_SEND_BATCH {
                return Err("Too many items".into());
            }
            let mut accepted = Vec::new();
            let mut rejected = Vec::new();
            for raw in list {
                let Some(id) = raw["id"]
                    .as_str()
                    .filter(|id| !id.is_empty() && id.chars().count() <= MAX_ID_CHARS)
                else {
                    continue;
                };
                let kind = raw["kind"]
                    .as_str()
                    .filter(|kind| !kind.is_empty() && kind.len() <= MAX_KIND_CHARS);
                let fresh = with(|events| {
                    let outbox = events
                        .outboxes
                        .entry(peer.into())
                        .or_insert_with(Outbox::new);
                    let fresh = outbox.take(id);
                    if fresh {
                        save(events);
                    }
                    fresh
                })?;
                // Taken before: it already ran, so the phone may drop it.
                if !fresh {
                    accepted.push(json!(id));
                    continue;
                }
                match kind
                    .ok_or_else(|| "Unsupported item".to_string())
                    .and_then(|kind| receive(app, peer, kind, &raw["payload"]))
                {
                    Ok(()) => accepted.push(json!(id)),
                    Err(error) => rejected.push(json!({ "id": id, "error": error })),
                }
            }
            Ok(json!({ "accepted": accepted, "rejected": rejected }))
        }
        _ => Err("Unsupported mobile operation".into()),
    }
}

/// Runs one item the phone sent. Kinds arrive with later phases.
fn receive(_app: &AppHandle, _peer: &str, _kind: &str, _payload: &Value) -> Result<(), String> {
    Err("Unsupported item".into())
}

/// The phone opens its stream. The newest stream per phone replaces the old.
pub(crate) fn watch(
    peer: &str,
    params: &Value,
    sink: monocode_mobile_link::WatchSink,
) -> Result<(), String> {
    let epoch = params["epoch"]
        .as_str()
        .filter(|epoch| epoch.len() <= 64)
        .map(str::to_string);
    let after = params["after"].as_u64().unwrap_or(0);
    let wake = Arc::new(Notify::new());
    let token = with(|events| {
        events.next_token += 1;
        let token = events.next_token;
        let created = !events.outboxes.contains_key(peer);
        events
            .outboxes
            .entry(peer.into())
            .or_insert_with(Outbox::new);
        // Dropping the old entry stops its pump, which ends that stream.
        if let Some(old) = events.streams.insert(
            peer.into(),
            Stream {
                token,
                wake: wake.clone(),
            },
        ) {
            old.wake.notify_one();
        }
        if created {
            save(events);
        }
        token
    })?;
    tauri::async_runtime::spawn(pump(peer.to_string(), token, epoch, after, wake, sink));
    Ok(())
}

/// What the pump sends next, read under the lock.
enum Next {
    Stop,
    Idle,
    Frames(Vec<Value>, u64, Vec<(String, u64)>),
}

fn next_frames(
    peer: &str,
    token: u64,
    epoch: Option<&str>,
    sent: u64,
    signal_versions: &HashMap<String, u64>,
) -> Next {
    let mut guard = match EVENTS.lock() {
        Ok(guard) => guard,
        Err(_) => return Next::Stop,
    };
    let events = guard.get_or_insert_with(Events::default);
    if events.streams.get(peer).map(|stream| stream.token) != Some(token) {
        return Next::Stop;
    }
    let Some(outbox) = events.outboxes.get(peer) else {
        return Next::Stop;
    };
    let items = outbox.after(epoch, sent, PUMP_BATCH);
    let last_sent = items.last().map_or(sent, |item| item.seq);
    let mut frames: Vec<Value> = items
        .into_iter()
        .map(|item| json!({ "type": "item", "item": item }))
        .collect();
    let mut seen = Vec::new();
    for (kind, (version, payload)) in &events.signals {
        if signal_versions
            .get(kind)
            .is_none_or(|known| known < version)
        {
            frames.push(json!({ "type": "signal", "kind": kind, "payload": payload }));
            seen.push((kind.clone(), *version));
        }
    }
    if frames.is_empty() {
        Next::Idle
    } else {
        Next::Frames(frames, last_sent, seen)
    }
}

/// The only writer to one phone's stream: hello, then items in order and
/// signals as they change, until the phone goes or a newer stream replaces it.
async fn pump(
    peer: String,
    token: u64,
    epoch: Option<String>,
    after: u64,
    wake: Arc<Notify>,
    sink: monocode_mobile_link::WatchSink,
) {
    let hello = with(|events| {
        events.outboxes.get(&peer).map(|outbox| {
            json!({
                "type": "hello",
                "epoch": outbox.epoch,
                "last": outbox.next_seq - 1,
                "resume": epoch.as_deref() == Some(outbox.epoch.as_str()),
            })
        })
    });
    let Ok(Some(hello)) = hello else {
        return;
    };
    // A cursor from another epoch no longer applies: replay from the start.
    let current = hello["epoch"].as_str().map(str::to_string);
    let mut sent = if epoch == current { after } else { 0 };
    let epoch = current;
    if sink.send(hello).await.is_err() {
        return;
    }
    let mut signal_versions: HashMap<String, u64> = HashMap::new();
    loop {
        match next_frames(&peer, token, epoch.as_deref(), sent, &signal_versions) {
            Next::Stop => break,
            Next::Idle => {
                tokio::select! {
                    _ = wake.notified() => {}
                    _ = sink.closed() => break,
                }
            }
            Next::Frames(frames, last_sent, seen) => {
                for frame in frames {
                    if sink.send(frame).await.is_err() {
                        return finish(&peer, token);
                    }
                }
                sent = last_sent;
                signal_versions.extend(seen);
            }
        }
    }
    finish(&peer, token);
}

fn finish(peer: &str, token: u64) {
    let _ = with(|events| {
        if events
            .streams
            .get(peer)
            .is_some_and(|stream| stream.token == token)
        {
            events.streams.remove(peer);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn items_after_a_cursor_resume_in_order_and_a_new_epoch_replays_all() {
        let mut outbox = Outbox::new();
        for n in 0..5 {
            outbox.push("share", json!({ "n": n }), 1_000);
        }
        let epoch = outbox.epoch.clone();
        let seqs = |items: Vec<Item>| items.iter().map(|item| item.seq).collect::<Vec<_>>();
        assert_eq!(seqs(outbox.after(Some(&epoch), 2, 10)), vec![3, 4, 5]);
        assert_eq!(seqs(outbox.after(Some("old"), 4, 10)), vec![1, 2, 3, 4, 5]);
        assert_eq!(seqs(outbox.after(None, 0, 2)), vec![1, 2]);
    }

    #[test]
    fn acks_drop_confirmed_items_only_in_the_same_epoch() {
        let mut outbox = Outbox::new();
        for _ in 0..4 {
            outbox.push("share", Value::Null, 1_000);
        }
        let epoch = outbox.epoch.clone();
        assert!(!outbox.ack("other", 4));
        assert_eq!(outbox.items.len(), 4);
        assert!(outbox.ack(&epoch, 2));
        assert_eq!(outbox.items.front().map(|item| item.seq), Some(3));
        assert!(!outbox.ack(&epoch, 2));
    }

    #[test]
    fn the_outbox_keeps_the_newest_items_within_age_and_count() {
        let mut outbox = Outbox::new();
        outbox.push("old", Value::Null, 0);
        let now = MAX_AGE_MS + 10;
        for _ in 0..MAX_ITEMS + 5 {
            outbox.push("share", Value::Null, now);
        }
        assert_eq!(outbox.items.len(), MAX_ITEMS);
        assert!(outbox.items.iter().all(|item| item.kind == "share"));
        assert_eq!(
            outbox.items.back().map(|item| item.seq),
            Some(MAX_ITEMS as u64 + 6)
        );
    }

    #[test]
    fn a_resent_item_is_taken_once() {
        let mut outbox = Outbox::new();
        assert!(outbox.take("a"));
        assert!(!outbox.take("a"));
        for n in 0..SEEN_IDS {
            outbox.take(&n.to_string());
        }
        assert_eq!(outbox.seen.len(), SEEN_IDS);
        assert!(outbox.take("a"));
    }

    #[test]
    fn an_outbox_survives_a_save_and_load() {
        let mut outbox = Outbox::new();
        outbox.push("share", json!({ "text": "hi" }), 5);
        outbox.take("phone-1");
        let bytes = serde_json::to_vec(&outbox).unwrap();
        let loaded: Outbox = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(loaded.epoch, outbox.epoch);
        assert_eq!(loaded.next_seq, 2);
        assert_eq!(loaded.items, outbox.items);
        assert_eq!(loaded.seen, outbox.seen);
    }
}
