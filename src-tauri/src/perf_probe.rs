//! Fork (L-161): no-op commands the Performance overlay times once a second
//! while it records. Each one waits in a different queue before it runs, so a
//! slow reply says which queue is backed up.

use tauri::State;

use crate::session_store::SessionStore;

/// Runs on the main (window) thread, like every plain sync command.
#[tauri::command]
pub fn perf_ping_main() {}

/// Runs on the async runtime's worker threads, like every `(async)` command.
#[tauri::command(async)]
pub fn perf_ping_pool() {}

/// Runs on the blocking pool and waits for the shared database connection,
/// like every notes, tasks and session command (L-166), then releases it at once.
#[tauri::command]
pub async fn perf_ping_db(app: tauri::AppHandle) -> Result<(), String> {
    crate::background_work::store(app, move |app| {
        perf_ping_db_blocking(tauri::Manager::state(app))
    })
    .await
}

pub(crate) fn perf_ping_db_blocking(store: State<'_, SessionStore>) -> Result<(), String> {
    store.lock_conn().map(drop)
}
