//! Activity: a local log of what you did in Hari, plus desktop context from
//! ActivityWatch and an always-on Antigravity (`agy`) scribe that turns it
//! into short notes. Everything is stored in `monocode.db`; nothing leaves the
//! machine except the note prompt sent through the user's own `agy` login.

pub mod agent;
pub mod aw;
pub mod store;
pub mod time;

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::session_store::{now_millis, validate_id, SessionStore};
use agent::{AgentStatus, NotesAgent};
use store::{ActivityEvent, ActivityNote, NewEvent};

/// Emitted (no payload) whenever events or notes change.
pub const CHANGED_EVENT: &str = "activity-changed";

const TEXT_MAX_CHARS: usize = 2_000;
const TITLE_MAX_CHARS: usize = 200;
const FIELD_MAX_CHARS: usize = 120;
const CWD_MAX_CHARS: usize = 4_096;
/// Longest range one query may cover (a week), to keep the view snappy.
const RANGE_MAX_MS: i64 = 7 * 24 * 60 * 60 * 1000;

/// Event as sent by the frontend recorder.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEventInput {
    /// `prompt` or `turn`.
    pub kind: String,
    /// The user block id; makes recording idempotent.
    pub block_id: String,
    pub session_id: String,
    pub harness: String,
    #[serde(default)]
    pub model: String,
    pub cwd: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub text: String,
    /// Epoch ms the event happened (prompt sent / turn finished).
    pub at: i64,
    #[serde(default)]
    pub duration_ms: Option<i64>,
    /// Viewer's UTC offset in minutes (ISO sign: IST is +330).
    #[serde(default)]
    pub tz_offset_min: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLog {
    pub events: Vec<ActivityEvent>,
    pub notes: Vec<ActivityNote>,
}

/// Start the notes worker. Tables are created by the session store migration;
/// the worker stays idle until the frontend turns notes on.
pub fn init(app: &AppHandle) {
    app.state::<NotesAgent>().start(app.clone());
}

#[tauri::command(async)]
pub fn activity_record(
    app: AppHandle,
    store: State<'_, SessionStore>,
    agent: State<'_, NotesAgent>,
    event: ActivityEventInput,
) -> Result<ActivityEvent, String> {
    let kind = match event.kind.as_str() {
        "prompt" | "turn" => event.kind.as_str(),
        _ => return Err("Unknown activity kind".into()),
    };
    validate_id(&event.block_id, "block")?;
    validate_id(&event.session_id, "session")?;
    let cwd = event.cwd.trim();
    if cwd.is_empty() || cwd.chars().count() > CWD_MAX_CHARS {
        return Err("Invalid activity cwd".into());
    }

    let now = now_millis();
    // Trust the client clock only within a sane window.
    let ts = if (now - 24 * 60 * 60 * 1000..=now + 5 * 60 * 1000).contains(&event.at) {
        event.at
    } else {
        now
    };
    let duration_ms = event.duration_ms.filter(|ms| *ms >= 0);
    let branch = git_branch(Path::new(cwd));
    let text = truncate(event.text.trim(), TEXT_MAX_CHARS);
    let title = truncate(event.title.trim(), TITLE_MAX_CHARS);
    let harness = truncate(event.harness.trim(), FIELD_MAX_CHARS);
    let model = truncate(event.model.trim(), FIELD_MAX_CHARS);

    let (stored, inserted) = {
        let conn = store.lock_conn()?;
        store::insert_event(
            &conn,
            &NewEvent {
                ts,
                kind,
                block_id: &event.block_id,
                session_id: &event.session_id,
                harness: &harness,
                model: &model,
                cwd,
                branch: branch.as_deref(),
                title: &title,
                text: &text,
                duration_ms,
            },
        )
        .map_err(|e| e.to_string())?
    };
    if inserted {
        agent.kick(event.tz_offset_min);
        let _ = app.emit(CHANGED_EVENT, ());
    }
    Ok(stored)
}

#[tauri::command(async)]
pub fn activity_list(
    store: State<'_, SessionStore>,
    start: i64,
    end: i64,
) -> Result<ActivityLog, String> {
    validate_range(start, end)?;
    let conn = store.lock_conn()?;
    Ok(ActivityLog {
        events: store::list_events(&conn, start, end).map_err(|e| e.to_string())?,
        notes: store::list_notes(&conn, start, end).map_err(|e| e.to_string())?,
    })
}

#[tauri::command(async)]
pub fn activity_watch_summary(start: i64, end: i64) -> Result<aw::AwSummary, String> {
    validate_range(start, end)?;
    Ok(aw::summary(start, end.min(now_millis())))
}

#[tauri::command(async)]
pub fn activity_agent_status(agent: State<'_, NotesAgent>) -> AgentStatus {
    agent.status()
}

#[tauri::command(async)]
pub fn activity_agent_configure(
    app: AppHandle,
    agent: State<'_, NotesAgent>,
    enabled: bool,
    tz_offset_min: i64,
) -> AgentStatus {
    let status = agent.configure(enabled, tz_offset_min);
    let _ = app.emit(agent::STATUS_EVENT, status.clone());
    status
}

#[tauri::command(async)]
pub fn activity_agent_retry(app: AppHandle, agent: State<'_, NotesAgent>) -> AgentStatus {
    let status = agent.retry();
    let _ = app.emit(agent::STATUS_EVENT, status.clone());
    status
}

fn validate_range(start: i64, end: i64) -> Result<(), String> {
    if start < 0 || end <= start || end - start > RANGE_MAX_MS {
        return Err("Invalid activity range".into());
    }
    Ok(())
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut cut: String = text.chars().take(max).collect();
    cut.push('…');
    cut
}

/// Current branch read straight from `.git/HEAD` — no `git` process per prompt.
/// Handles linked worktrees (`.git` file) and detached HEADs (short sha).
pub fn git_branch(cwd: &Path) -> Option<String> {
    let git_dir = find_git_dir(cwd)?;
    let head = std::fs::read_to_string(git_dir.join("HEAD")).ok()?;
    parse_head(&head)
}

fn find_git_dir(start: &Path) -> Option<PathBuf> {
    let mut dir = Some(start);
    while let Some(current) = dir {
        let dot_git = current.join(".git");
        if dot_git.is_dir() {
            return Some(dot_git);
        }
        if dot_git.is_file() {
            let pointer = std::fs::read_to_string(&dot_git).ok()?;
            let target = pointer.trim().strip_prefix("gitdir:")?.trim();
            let path = PathBuf::from(target);
            return Some(if path.is_absolute() {
                path
            } else {
                current.join(path)
            });
        }
        dir = current.parent();
    }
    None
}

fn parse_head(head: &str) -> Option<String> {
    let head = head.trim();
    if let Some(reference) = head.strip_prefix("ref:") {
        let reference = reference.trim();
        let branch = reference.strip_prefix("refs/heads/").unwrap_or(reference);
        return (!branch.is_empty()).then(|| branch.to_string());
    }
    let is_sha = head.len() >= 7 && head.bytes().all(|b| b.is_ascii_hexdigit());
    is_sha.then(|| head[..7].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_head_variants() {
        assert_eq!(parse_head("ref: refs/heads/main\n"), Some("main".into()));
        assert_eq!(parse_head("ref: refs/heads/feat/x"), Some("feat/x".into()));
        assert_eq!(
            parse_head("0123456789abcdef0123456789abcdef01234567"),
            Some("0123456".into())
        );
        assert_eq!(parse_head("garbage"), None);
    }

    #[test]
    fn reads_branch_from_repo_and_worktree_pointer() {
        let root = std::env::temp_dir().join(format!("hari-activity-{}", now_millis()));
        let repo = root.join("repo");
        let nested = repo.join("src/deep");
        std::fs::create_dir_all(repo.join(".git")).unwrap();
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(repo.join(".git/HEAD"), "ref: refs/heads/dev\n").unwrap();
        assert_eq!(git_branch(&nested), Some("dev".into()));

        let worktree = root.join("wt");
        let wt_git = root.join("gitdirs/wt");
        std::fs::create_dir_all(&worktree).unwrap();
        std::fs::create_dir_all(&wt_git).unwrap();
        std::fs::write(wt_git.join("HEAD"), "ref: refs/heads/feature\n").unwrap();
        std::fs::write(
            worktree.join(".git"),
            format!("gitdir: {}\n", wt_git.display()),
        )
        .unwrap();
        assert_eq!(git_branch(&worktree), Some("feature".into()));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn validates_ranges_and_truncates() {
        assert!(validate_range(0, 10).is_ok());
        assert!(validate_range(10, 10).is_err());
        assert!(validate_range(-1, 10).is_err());
        assert!(validate_range(0, RANGE_MAX_MS + 1).is_err());
        assert_eq!(truncate("abcdef", 3), "abc…");
        assert_eq!(truncate("abc", 3), "abc");
    }
}
