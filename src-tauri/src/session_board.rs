use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::session_store::{now_millis, validate_id, SessionStore};

const SESSION_ID_MAX: usize = 256;
const RUN_ID_MAX: usize = 512;
const TITLE_MAX: usize = 200;
const CWD_MAX: usize = 4096;
const HARNESS_MAX: usize = 128;
const MODEL_MAX: usize = 512;
const REASON_MAX: usize = 8192;
const BRANCH_MAX: usize = 512;
const CARD_JSON_MAX: usize = 16 * 1024;
const HIDE_BATCH_MAX: usize = 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionBoardStatus {
    Todo,
    InProgress,
    NeedsAttention,
    Blocked,
    Done,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionBoardCard {
    pub session_id: String,
    pub run_id: String,
    pub title: String,
    pub cwd: String,
    pub harness: String,
    pub model: String,
    pub status: SessionBoardStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    pub queued_count: u32,
    pub updated_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden_run_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionBoardHideRequest {
    pub session_id: String,
    pub run_id: String,
}

/// Create the session board's independent storage without changing user-owned
/// session, note, task, or other application tables.
pub(crate) fn ensure_session_board_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS session_board_cards (
           session_id TEXT PRIMARY KEY,
           payload_json TEXT NOT NULL
         );",
    )
}

#[tauri::command]
pub async fn session_board_list(app: tauri::AppHandle) -> Result<Vec<SessionBoardCard>, String> {
    crate::background_work::store(app, move |app| {
        session_board_list_blocking(tauri::Manager::state(app))
    })
    .await
}

pub(crate) fn session_board_list_blocking(
    store: State<'_, SessionStore>,
) -> Result<Vec<SessionBoardCard>, String> {
    let mut conn = store.lock_conn()?;
    prune_missing_sessions(&conn, now_millis()).map_err(|error| error.to_string())?;
    list_current_cards(&mut conn).map_err(|error| error.to_string())
}

/// Drops the card of a deleted chat (Session Manager never shows a session
/// that cannot be opened). Removing a card that does not exist is harmless.
#[tauri::command]
pub async fn session_board_remove(app: tauri::AppHandle, session_id: String) -> Result<(), String> {
    crate::background_work::store(app, move |app| {
        session_board_remove_blocking(tauri::Manager::state(app), session_id)
    })
    .await
}

pub(crate) fn session_board_remove_blocking(
    store: State<'_, SessionStore>,
    session_id: String,
) -> Result<(), String> {
    validate_id(&session_id, "session")?;
    let conn = store.lock_conn()?;
    conn.execute(
        "DELETE FROM session_board_cards WHERE session_id = ?1",
        params![session_id],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

/// A brand-new chat can show a card a moment before its first save, so only
/// cards untouched for a minute whose session row is gone are removed.
const MISSING_SESSION_GRACE_MS: i64 = 60_000;

fn prune_missing_sessions(conn: &Connection, now: i64) -> rusqlite::Result<usize> {
    let cards = list_cards(conn)?;
    let mut removed = 0;
    for card in cards {
        if card.updated_at > now - MISSING_SESSION_GRACE_MS {
            continue;
        }
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM sessions WHERE id = ?1)",
            params![card.session_id],
            |row| row.get(0),
        )?;
        if !exists {
            removed += conn.execute(
                "DELETE FROM session_board_cards WHERE session_id = ?1",
                params![card.session_id],
            )?;
        }
    }
    Ok(removed)
}

#[tauri::command]
pub async fn session_board_upsert(
    app: tauri::AppHandle,
    card: SessionBoardCard,
) -> Result<SessionBoardCard, String> {
    crate::background_work::store(app, move |app| {
        session_board_upsert_blocking(tauri::Manager::state(app), card)
    })
    .await
}

pub(crate) fn session_board_upsert_blocking(
    store: State<'_, SessionStore>,
    card: SessionBoardCard,
) -> Result<SessionBoardCard, String> {
    let card = validate_and_normalize_card(card)?;
    let mut conn = store.lock_conn()?;
    upsert_card(&mut conn, card).map_err(|error| error.to_string())
}

/// Atomically applies all run-scoped hide/show requests, then returns the full
/// current card list so callers can replace their local snapshot. A stale
/// request for an earlier run leaves the current card untouched.
#[tauri::command]
pub async fn session_board_hide(
    app: tauri::AppHandle,
    cards: Vec<SessionBoardHideRequest>,
    hidden: bool,
) -> Result<Vec<SessionBoardCard>, String> {
    crate::background_work::store(app, move |app| {
        session_board_hide_blocking(tauri::Manager::state(app), cards, hidden)
    })
    .await
}

pub(crate) fn session_board_hide_blocking(
    store: State<'_, SessionStore>,
    cards: Vec<SessionBoardHideRequest>,
    hidden: bool,
) -> Result<Vec<SessionBoardCard>, String> {
    validate_hide_requests(&cards)?;
    let mut conn = store.lock_conn()?;
    hide_cards(&mut conn, &cards, hidden).map_err(|error| error.to_string())
}

fn validate_and_normalize_card(mut card: SessionBoardCard) -> Result<SessionBoardCard, String> {
    if card.session_id.len() > SESSION_ID_MAX {
        return Err("Invalid session board session id".into());
    }
    validate_id(&card.session_id, "session")?;
    validate_run_id(&card.run_id)?;

    if card.title.len() > 4096 || has_non_whitespace_control(&card.title) {
        return Err("Invalid session board title".into());
    }
    card.title = card.title.split_whitespace().collect::<Vec<_>>().join(" ");
    card.title = card.title.chars().take(TITLE_MAX).collect();
    card.title = card.title.trim().to_owned();
    if card.title.is_empty() {
        return Err("Session board title must not be empty".into());
    }

    validate_required_text(&card.cwd, "working directory", CWD_MAX)?;
    validate_required_text(&card.harness, "harness", HARNESS_MAX)?;
    validate_required_text(&card.model, "model", MODEL_MAX)?;

    if let Some(reason) = card.reason.as_mut() {
        if reason.len() > REASON_MAX || has_non_whitespace_control(reason) {
            return Err("Invalid session board reason".into());
        }
        *reason = reason.replace("\r\n", "\n").replace('\r', "\n");
        if reason.trim().is_empty() {
            card.reason = None;
        }
    }
    if let Some(branch) = card.branch.as_mut() {
        if branch.trim().is_empty() {
            card.branch = None;
        } else {
            validate_required_text(branch, "branch", BRANCH_MAX)?;
        }
    }
    if card.updated_at < 0 {
        return Err("Invalid session board timestamp".into());
    }
    if let Some(hidden_run_id) = card.hidden_run_id.as_deref() {
        validate_run_id(hidden_run_id)?;
    }

    ensure_payload_size(&card)?;
    Ok(card)
}

fn validate_hide_requests(cards: &[SessionBoardHideRequest]) -> Result<(), String> {
    if cards.len() > HIDE_BATCH_MAX {
        return Err(format!(
            "Session board hide batch exceeds {HIDE_BATCH_MAX} cards"
        ));
    }
    let mut seen = std::collections::HashSet::with_capacity(cards.len());
    for card in cards {
        if card.session_id.len() > SESSION_ID_MAX {
            return Err("Invalid session board session id".into());
        }
        validate_id(&card.session_id, "session")?;
        validate_run_id(&card.run_id)?;
        if !seen.insert(card.session_id.as_str()) {
            return Err("Session board hide batch contains a duplicate session id".into());
        }
    }
    Ok(())
}

fn validate_run_id(value: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > RUN_ID_MAX || value.chars().any(char::is_control) {
        return Err("Invalid session board run id".into());
    }
    Ok(())
}

fn validate_required_text(value: &str, label: &str, max: usize) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > max || value.chars().any(char::is_control) {
        return Err(format!("Invalid session board {label}"));
    }
    Ok(())
}

fn has_non_whitespace_control(value: &str) -> bool {
    value
        .chars()
        .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
}

fn ensure_payload_size(card: &SessionBoardCard) -> Result<String, String> {
    let payload = serde_json::to_string(card).map_err(|error| error.to_string())?;
    if payload.len() > CARD_JSON_MAX {
        return Err("Session board card is too large".into());
    }
    Ok(payload)
}

fn list_cards(conn: &Connection) -> rusqlite::Result<Vec<SessionBoardCard>> {
    let mut statement = conn.prepare(
        "SELECT session_id, payload_json FROM session_board_cards ORDER BY session_id ASC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut cards = rows
        .map(|row| {
            let (session_id, payload) = row?;
            decode_card(&session_id, &payload)
        })
        .collect::<rusqlite::Result<Vec<_>>>()?;
    cards.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.session_id.cmp(&b.session_id))
    });
    Ok(cards)
}

/// Repair only the synthetic historical fallback; absence of an outcome is not
/// a provider failure. Keep user-owned hide tombstones and all real outcomes.
fn list_current_cards(conn: &mut Connection) -> rusqlite::Result<Vec<SessionBoardCard>> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let cards = list_cards(&tx)?;
    for card in &cards {
        if card.status == SessionBoardStatus::Blocked
            && card.reason.as_deref()
                == Some("Earlier run has no recorded result; review the session")
            && card.queued_count == 0
            && card.hidden_run_id.is_none()
        {
            tx.execute(
                "DELETE FROM session_board_cards WHERE session_id = ?1",
                params![card.session_id],
            )?;
        }
    }
    let remaining = list_cards(&tx)?;
    tx.commit()?;
    Ok(remaining)
}

fn get_card(conn: &Connection, session_id: &str) -> rusqlite::Result<Option<SessionBoardCard>> {
    let row = conn
        .query_row(
            "SELECT session_id, payload_json FROM session_board_cards WHERE session_id = ?1",
            params![session_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    row.map(|(stored_id, payload)| decode_card(&stored_id, &payload))
        .transpose()
}

fn decode_card(session_id: &str, payload: &str) -> rusqlite::Result<SessionBoardCard> {
    let invalid_data = |message: String| {
        rusqlite::Error::FromSqlConversionFailure(
            1,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                message,
            )),
        )
    };
    if payload.len() > CARD_JSON_MAX {
        return Err(invalid_data("Session board card is too large".into()));
    }
    let card: SessionBoardCard = serde_json::from_str(payload)
        .map_err(|error| invalid_data(format!("Invalid session board card JSON: {error}")))?;
    if card.session_id != session_id {
        return Err(invalid_data(
            "Session board row id does not match its payload".into(),
        ));
    }
    validate_and_normalize_card(card).map_err(invalid_data)
}

fn upsert_card(
    conn: &mut Connection,
    mut card: SessionBoardCard,
) -> rusqlite::Result<SessionBoardCard> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    // Hide metadata is owned by the hide command. Ignore any incoming value;
    // keep the prior tombstone when updating the rest of a card snapshot.
    card.hidden_run_id =
        get_card(&tx, &card.session_id)?.and_then(|existing| existing.hidden_run_id);
    let payload = ensure_payload_size(&card).map_err(|error| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            error,
        )))
    })?;
    tx.execute(
        "INSERT INTO session_board_cards (session_id, payload_json) VALUES (?1, ?2)
         ON CONFLICT(session_id) DO UPDATE SET payload_json = excluded.payload_json",
        params![card.session_id, payload],
    )?;
    tx.commit()?;
    Ok(card)
}

fn hide_cards(
    conn: &mut Connection,
    cards: &[SessionBoardHideRequest],
    hidden: bool,
) -> rusqlite::Result<Vec<SessionBoardCard>> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    for request in cards {
        let Some(mut card) = get_card(&tx, &request.session_id)? else {
            continue;
        };
        if card.run_id != request.run_id {
            continue;
        }
        card.hidden_run_id = hidden.then(|| request.run_id.clone());
        let payload = ensure_payload_size(&card).map_err(|error| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                error,
            )))
        })?;
        tx.execute(
            "UPDATE session_board_cards SET payload_json = ?2 WHERE session_id = ?1",
            params![card.session_id, payload],
        )?;
    }
    let cards = list_cards(&tx)?;
    tx.commit()?;
    Ok(cards)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_store::SessionStore;

    fn card(session_id: &str, run_id: &str, status: SessionBoardStatus) -> SessionBoardCard {
        SessionBoardCard {
            session_id: session_id.into(),
            run_id: run_id.into(),
            title: "  A session\n title  ".into(),
            cwd: "/work/project".into(),
            harness: "claude".into(),
            model: "model-1".into(),
            status,
            reason: None,
            branch: None,
            queued_count: 0,
            updated_at: 123,
            hidden_run_id: None,
        }
    }

    #[test]
    fn prunes_cards_of_deleted_sessions_after_a_grace_period() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        conn.execute(
            "INSERT INTO sessions (id,cwd,harness,model,runtime_mode,title,blocks_json,created_at,updated_at)
             VALUES ('alive','/work','claude','model','default','Alive','[]',1,1)",
            [],
        )
        .unwrap();
        for id in ["alive", "deleted", "fresh"] {
            let mut entry = card(id, "run-1", SessionBoardStatus::Done);
            if id == "fresh" {
                entry.updated_at = 1_000_000;
            }
            upsert_card(&mut conn, entry).unwrap();
        }
        // "fresh" is newer than the grace period; "deleted" has no session row.
        assert_eq!(prune_missing_sessions(&conn, 1_030_000).unwrap(), 1);
        assert!(get_card(&conn, "deleted").unwrap().is_none());
        assert!(get_card(&conn, "alive").unwrap().is_some());
        assert!(get_card(&conn, "fresh").unwrap().is_some());
    }

    fn table_exists(conn: &Connection) -> bool {
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='session_board_cards')",
            [],
            |row| row.get(0),
        )
        .unwrap()
    }

    #[test]
    fn startup_creates_namespaced_table_idempotently_and_leaves_other_data_alone() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        assert!(table_exists(&conn));
        conn.execute(
            "INSERT INTO sessions (id,cwd,harness,model,runtime_mode,title,blocks_json,created_at,updated_at)
             VALUES ('session-keep','/work','claude','model','default','Keep me','[]',1,1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO notes (id,slug,title,body,created_at,updated_at)
             VALUES ('note-keep','note-keep','Keep note','Body',1,1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tasks (id,title,body,status,created_at,updated_at)
             VALUES ('task-keep','Keep task','Body','todo',1,1)",
            [],
        )
        .unwrap();
        ensure_session_board_table(&conn).unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT title FROM sessions WHERE id='session-keep'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
            "Keep me"
        );
        assert_eq!(
            conn.query_row("SELECT title FROM notes WHERE id='note-keep'", [], |row| {
                row.get::<_, String>(0)
            })
            .unwrap(),
            "Keep note"
        );
        assert_eq!(
            conn.query_row("SELECT title FROM tasks WHERE id='task-keep'", [], |row| {
                row.get::<_, String>(0)
            })
            .unwrap(),
            "Keep task"
        );
    }

    #[test]
    fn every_board_status_round_trips_as_camel_case_json_and_lists_by_recency() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        let cases = [
            (SessionBoardStatus::Todo, "todo"),
            (SessionBoardStatus::InProgress, "in_progress"),
            (SessionBoardStatus::NeedsAttention, "needs_attention"),
            (SessionBoardStatus::Blocked, "blocked"),
            (SessionBoardStatus::Done, "done"),
            (SessionBoardStatus::Stopped, "stopped"),
        ];
        for (index, (status, encoded)) in cases.into_iter().enumerate() {
            let mut entry = card(&format!("session-{index}"), "run-1", status);
            entry.updated_at = index as i64;
            entry.reason =
                (status == SessionBoardStatus::Blocked).then(|| "Needs approval\nfrom you".into());
            entry.branch = Some("feature/work".into());
            entry.queued_count = index as u32;
            let saved =
                upsert_card(&mut conn, validate_and_normalize_card(entry).unwrap()).unwrap();
            assert_eq!(saved.status, status);
            assert_eq!(saved.title, "A session title");
            let json = serde_json::to_value(&saved).unwrap();
            assert_eq!(json["sessionId"], format!("session-{index}"));
            assert_eq!(json["status"], encoded);
            assert_eq!(json["queuedCount"], index as u32);
            assert!(json.get("session_id").is_none());
        }
        let list = list_cards(&conn).unwrap();
        assert_eq!(list.len(), cases.len());
        assert_eq!(list[0].updated_at, 5);
        assert_eq!(list[0].status, SessionBoardStatus::Stopped);
        assert_eq!(list[2].reason.as_deref(), Some("Needs approval\nfrom you"));
    }

    #[test]
    fn upsert_preserves_hide_tombstone_and_new_run_invalidates_stale_hide_actions() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        upsert_card(
            &mut conn,
            validate_and_normalize_card(card("session-1", "run-old", SessionBoardStatus::Done))
                .unwrap(),
        )
        .unwrap();
        let request = SessionBoardHideRequest {
            session_id: "session-1".into(),
            run_id: "run-old".into(),
        };
        let hidden = hide_cards(&mut conn, std::slice::from_ref(&request), true).unwrap();
        assert_eq!(hidden[0].hidden_run_id.as_deref(), Some("run-old"));

        let mut new_run = card("session-1", "run-new", SessionBoardStatus::InProgress);
        new_run.hidden_run_id = Some("client-overwrite-attempt".into());
        let saved = upsert_card(&mut conn, validate_and_normalize_card(new_run).unwrap()).unwrap();
        assert_eq!(saved.run_id, "run-new");
        assert_eq!(saved.hidden_run_id.as_deref(), Some("run-old"));

        // Clearing a terminal card from an earlier run cannot clear or hide
        // the current run's state. A current-run show request can clear it.
        let stale_result = hide_cards(&mut conn, &[request], false).unwrap();
        assert_eq!(stale_result[0].run_id, "run-new");
        assert_eq!(stale_result[0].hidden_run_id.as_deref(), Some("run-old"));
        let current = SessionBoardHideRequest {
            session_id: "session-1".into(),
            run_id: "run-new".into(),
        };
        let shown = hide_cards(&mut conn, &[current], false).unwrap();
        assert_eq!(shown[0].hidden_run_id, None);
    }

    #[test]
    fn hide_batches_validate_before_mutation_and_ignore_missing_or_stale_runs() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        upsert_card(
            &mut conn,
            validate_and_normalize_card(card("session-1", "run-1", SessionBoardStatus::Done))
                .unwrap(),
        )
        .unwrap();
        upsert_card(
            &mut conn,
            validate_and_normalize_card(card("session-2", "run-2", SessionBoardStatus::Done))
                .unwrap(),
        )
        .unwrap();
        let invalid = vec![
            SessionBoardHideRequest {
                session_id: "session-1".into(),
                run_id: "run-1".into(),
            },
            SessionBoardHideRequest {
                session_id: "session-1".into(),
                run_id: "run-other".into(),
            },
        ];
        assert!(validate_hide_requests(&invalid).is_err());

        // A database failure partway through the batch rolls back all earlier
        // hide updates instead of leaving only part of a clear operation.
        conn.execute_batch(
            "CREATE TRIGGER fail_second_board_hide BEFORE UPDATE ON session_board_cards
             WHEN OLD.session_id = 'session-2'
             BEGIN SELECT RAISE(ABORT, 'test hide failure'); END;",
        )
        .unwrap();
        let batch = [
            SessionBoardHideRequest {
                session_id: "session-1".into(),
                run_id: "run-1".into(),
            },
            SessionBoardHideRequest {
                session_id: "session-2".into(),
                run_id: "run-2".into(),
            },
        ];
        assert!(hide_cards(&mut conn, &batch, true).is_err());
        let unchanged = list_cards(&conn).unwrap();
        assert!(unchanged.iter().all(|card| card.hidden_run_id.is_none()));
        conn.execute_batch("DROP TRIGGER fail_second_board_hide;")
            .unwrap();
        let hidden = hide_cards(&mut conn, &batch, true).unwrap();
        assert!(hidden
            .iter()
            .all(|card| card.hidden_run_id.as_deref() == Some(card.run_id.as_str())));

        let stale_or_missing = [
            SessionBoardHideRequest {
                session_id: "session-1".into(),
                run_id: "run-other".into(),
            },
            SessionBoardHideRequest {
                session_id: "missing-session".into(),
                run_id: "run-1".into(),
            },
        ];
        assert_eq!(
            hide_cards(&mut conn, &stale_or_missing, true)
                .unwrap()
                .len(),
            2
        );
        assert!(list_cards(&conn)
            .unwrap()
            .iter()
            .all(|card| card.hidden_run_id.as_deref() == Some(card.run_id.as_str())));
    }

    #[test]
    fn card_data_and_hide_state_survive_close_and_reopen() {
        let path = std::env::temp_dir().join(format!(
            "monocode-session-board-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        {
            let store = SessionStore::open(path.clone()).unwrap();
            let mut conn = store.lock_conn().unwrap();
            let mut saved = card(
                "session-durable",
                "provider:run:1",
                SessionBoardStatus::Blocked,
            );
            saved.reason = Some("Waiting for approval".into());
            saved.branch = Some("feature/durable".into());
            saved.queued_count = 3;
            upsert_card(&mut conn, validate_and_normalize_card(saved).unwrap()).unwrap();
            hide_cards(
                &mut conn,
                &[SessionBoardHideRequest {
                    session_id: "session-durable".into(),
                    run_id: "provider:run:1".into(),
                }],
                true,
            )
            .unwrap();
        }
        {
            let store = SessionStore::open(path.clone()).unwrap();
            let conn = store.lock_conn().unwrap();
            let restored = get_card(&conn, "session-durable").unwrap().unwrap();
            assert_eq!(restored.status, SessionBoardStatus::Blocked);
            assert_eq!(restored.reason.as_deref(), Some("Waiting for approval"));
            assert_eq!(restored.branch.as_deref(), Some("feature/durable"));
            assert_eq!(restored.queued_count, 3);
            assert_eq!(restored.hidden_run_id.as_deref(), Some("provider:run:1"));
        }
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn list_repairs_only_synthetic_history_and_preserves_outcomes_and_hidden_runs() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        let reason = "Earlier run has no recorded result; review the session";
        for (id, status, why, queued) in [
            ("legacy", SessionBoardStatus::Blocked, reason, 0),
            ("hidden", SessionBoardStatus::Blocked, reason, 0),
            ("quota", SessionBoardStatus::Blocked, "Quota expired", 0),
            (
                "interrupted",
                SessionBoardStatus::Blocked,
                "Previous run was interrupted; review the session",
                0,
            ),
            ("done", SessionBoardStatus::Done, reason, 0),
            ("stopped", SessionBoardStatus::Stopped, reason, 0),
            ("resumed", SessionBoardStatus::InProgress, reason, 0),
            ("queued", SessionBoardStatus::Blocked, reason, 2),
        ] {
            let mut entry = card(id, "run-1", status);
            entry.reason = Some(why.into());
            entry.queued_count = queued;
            upsert_card(&mut conn, entry).unwrap();
        }
        hide_cards(
            &mut conn,
            &[SessionBoardHideRequest {
                session_id: "hidden".into(),
                run_id: "run-1".into(),
            }],
            true,
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sessions (id,cwd,harness,model,runtime_mode,title,blocks_json,created_at,updated_at)
             VALUES ('legacy','/work','claude','model','default','Original conversation','[]',1,1)",
            [],
        ).unwrap();
        let remaining = list_current_cards(&mut conn).unwrap();
        assert_eq!(remaining.len(), 7);
        assert!(get_card(&conn, "legacy").unwrap().is_none());
        assert_eq!(
            get_card(&conn, "hidden")
                .unwrap()
                .unwrap()
                .hidden_run_id
                .as_deref(),
            Some("run-1")
        );
        assert_eq!(remaining, list_current_cards(&mut conn).unwrap());
        assert_eq!(
            conn.query_row("SELECT title FROM sessions WHERE id='legacy'", [], |row| {
                row.get::<_, String>(0)
            })
            .unwrap(),
            "Original conversation"
        );
        // An old conversation can run again, even with the same turn identity.
        upsert_card(
            &mut conn,
            card("legacy", "run-1", SessionBoardStatus::InProgress),
        )
        .unwrap();
        assert_eq!(list_current_cards(&mut conn).unwrap().len(), 8);
    }

    #[test]
    fn validation_bounds_ids_text_payload_and_unknown_fields() {
        let mut invalid = card("bad/id", "run-1", SessionBoardStatus::Todo);
        assert!(validate_and_normalize_card(invalid.clone()).is_err());

        invalid = card("session-1", "  ", SessionBoardStatus::Todo);
        assert!(validate_and_normalize_card(invalid.clone()).is_err());
        invalid = card(
            "session-1",
            &"r".repeat(RUN_ID_MAX + 1),
            SessionBoardStatus::Todo,
        );
        assert!(validate_and_normalize_card(invalid.clone()).is_err());
        invalid = card("session-1", "run-1", SessionBoardStatus::Todo);
        invalid.title = "  ".into();
        assert!(validate_and_normalize_card(invalid.clone()).is_err());
        invalid.title = "界".repeat(TITLE_MAX + 1);
        let normalized = validate_and_normalize_card(invalid).unwrap();
        assert_eq!(normalized.title.chars().count(), TITLE_MAX);

        invalid = card("session-1", "run-1", SessionBoardStatus::Todo);
        invalid.cwd = "/".repeat(CWD_MAX);
        invalid.reason = Some("\nX".repeat(REASON_MAX / 2));
        assert!(validate_and_normalize_card(invalid).is_err());

        let encoded =
            serde_json::to_string(&card("session-1", "run-1", SessionBoardStatus::Todo)).unwrap();
        let with_unknown = encoded.trim_end_matches('}').to_owned() + ",\"extra\":true}";
        assert!(serde_json::from_str::<SessionBoardCard>(&with_unknown).is_err());
        assert!(serde_json::from_str::<SessionBoardStatus>("\"cancelled\"").is_err());
    }
}
