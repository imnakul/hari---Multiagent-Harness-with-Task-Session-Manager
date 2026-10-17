//! Owned-process registry bridge. No arbitrary PID input and no background sampler.
use crate::process_metrics::{self, CpuHistory};
use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProcessRoot {
    pub id: String,
    pub pid: u32,
    pub cwd: String,
    pub kind: String,
    pub idle_ms: u64,
}

#[derive(Default)]
pub struct ProcessStats(Mutex<CpuHistory>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessRow {
    root: ProcessRoot,
    cpu: Option<f64>,
    memory: Option<u64>,
    processes: usize,
    status: &'static str,
}

pub(crate) fn has_descendants(pid: u32) -> Result<bool, String> {
    let samples = process_metrics::snapshot()?;
    let trees = process_metrics::tree(&[pid], &samples);
    // Missing root is an uncertain exit, never permission to kill a reused PID.
    Ok(!samples.iter().any(|r| r.pid == pid) || trees.get(&pid).is_none_or(|ids| ids.len() > 1))
}

#[tauri::command(async)]
pub fn owned_process_stats(
    harness: State<'_, crate::harness::HarnessHost>,
    pty: State<'_, crate::pty::PtyHost>,
    stats: State<'_, ProcessStats>,
) -> Result<Vec<ProcessRow>, String> {
    let mut roots = harness.process_roots();
    roots.extend(pty.process_roots());
    let pids: Vec<_> = roots.iter().map(|r| r.pid).collect();
    if roots.is_empty() {
        return Ok(Vec::new());
    }
    let samples = process_metrics::owned_snapshot(&pids)?;
    let trees = process_metrics::tree(&pids, &samples);
    let cpu = stats.0.lock().unwrap_or_else(|e| e.into_inner()).sample(
        &samples,
        std::time::Instant::now(),
        std::thread::available_parallelism()
            .map(usize::from)
            .unwrap_or(1),
    );
    Ok(roots
        .into_iter()
        .map(|root| {
            let ids = trees.get(&root.pid).cloned().unwrap_or_default();
            let alive = samples.iter().any(|s| s.pid == root.pid);
            let rows: Vec<_> = samples.iter().filter(|s| ids.contains(&s.pid)).collect();
            let memory = rows.iter().map(|s| s.memory).sum::<Option<u64>>();
            let total_cpu = ids
                .iter()
                .map(|id| cpu.get(id).copied().flatten())
                .sum::<Option<f64>>();
            let unavailable = rows
                .iter()
                .any(|r| r.cpu_ns.is_none() || r.memory.is_none());
            ProcessRow {
                root,
                cpu: total_cpu,
                memory,
                processes: ids.len(),
                status: if !alive {
                    "exited"
                } else if unavailable {
                    "unavailable"
                } else {
                    "live"
                },
            }
        })
        .collect())
}
