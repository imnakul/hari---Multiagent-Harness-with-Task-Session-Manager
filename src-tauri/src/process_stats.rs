//! Owned-process registry bridge. No arbitrary PID input and no background sampler.
use crate::process_gpu::GpuSampler;
use crate::process_metrics::{self, CpuHistory};
use serde::Serialize;
use std::collections::HashMap;
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
pub struct ProcessStats {
    cpu: Mutex<CpuHistory>,
    gpu: Mutex<GpuSampler>,
}

/// GPU % by PID, or `None` while measuring or on platforms without counters.
type GpuReadings = Option<HashMap<u32, f64>>;

/// Sum for a set of processes; a process missing from the counters uses no GPU.
fn gpu_total(ids: &[u32], gpu: &GpuReadings) -> Option<f64> {
    gpu.as_ref().map(|by_pid| {
        ids.iter()
            .filter_map(|id| by_pid.get(id))
            .sum::<f64>()
            .min(100.0)
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessRow {
    root: ProcessRoot,
    cpu: Option<f64>,
    memory: Option<u64>,
    gpu: Option<f64>,
    processes: usize,
    status: &'static str,
    children: Vec<ProcessDetail>,
}

/// One process inside a row, for the read-only expanded list.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessDetail {
    pid: u32,
    parent: u32,
    name: String,
    depth: usize,
    cpu: Option<f64>,
    memory: Option<u64>,
    gpu: Option<f64>,
}

/// MonoCode's own process tree (host plus WebView2 or WebKit helpers), minus the
/// chat and terminal trees listed separately. Read failures are counted, not hidden,
/// so one sandboxed helper cannot blank the whole total.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUsage {
    pid: u32,
    cpu: Option<f64>,
    memory: Option<u64>,
    gpu: Option<f64>,
    processes: usize,
    unreadable: usize,
    children: Vec<ProcessDetail>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMonitorStats {
    app: AppUsage,
    owned: Vec<ProcessRow>,
}

pub(crate) fn has_descendants(pid: u32) -> Result<bool, String> {
    let samples = process_metrics::snapshot()?;
    let trees = process_metrics::tree(&[pid], &samples);
    // Missing root is an uncertain exit, never permission to kill a reused PID.
    Ok(!samples.iter().any(|r| r.pid == pid) || trees.get(&pid).is_none_or(|ids| ids.len() > 1))
}

/// The processes `tree` assigned to `root`, depth-first from the root (depth 0).
/// Empty when the root has exited. Siblings keep snapshot order.
fn details(
    root: u32,
    ids: &[u32],
    samples: &[process_metrics::Sample],
    cpu: &HashMap<u32, Option<f64>>,
    gpu: &GpuReadings,
) -> Vec<ProcessDetail> {
    let by_pid: HashMap<u32, &process_metrics::Sample> = samples
        .iter()
        .filter(|s| ids.contains(&s.pid))
        .map(|s| (s.pid, s))
        .collect();
    let mut kids: HashMap<u32, Vec<u32>> = HashMap::new();
    for s in samples
        .iter()
        .filter(|s| s.pid != root && by_pid.contains_key(&s.pid))
    {
        kids.entry(s.parent).or_default().push(s.pid);
    }
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut stack = vec![(root, 0)];
    while let Some((pid, depth)) = stack.pop() {
        let Some(s) = by_pid.get(&pid) else { continue };
        if !seen.insert(pid) {
            continue;
        }
        out.push(ProcessDetail {
            pid,
            parent: s.parent,
            name: s.name.clone(),
            depth,
            cpu: cpu.get(&pid).copied().flatten(),
            memory: s.memory,
            gpu: gpu_total(&[pid], gpu),
        });
        if let Some(children) = kids.get(&pid) {
            stack.extend(children.iter().rev().map(|c| (*c, depth + 1)));
        }
    }
    out
}

/// CPU and memory summed over the readable processes of one tree. A protected or
/// just-exited helper must not blank the whole tree, so each total is `None` only
/// when no process in it has a reading (CPU also waits for a second sample).
fn readable_totals(
    ids: &[u32],
    rows: &[&process_metrics::Sample],
    cpu: &HashMap<u32, Option<f64>>,
) -> (Option<f64>, Option<u64>) {
    let readings: Vec<f64> = ids
        .iter()
        .filter_map(|id| cpu.get(id).copied().flatten())
        .collect();
    let memory: Vec<u64> = rows.iter().filter_map(|s| s.memory).collect();
    (
        (!readings.is_empty()).then(|| readings.iter().sum()),
        (!memory.is_empty()).then(|| memory.iter().sum()),
    )
}

fn app_usage(
    pid: u32,
    trees: &HashMap<u32, Vec<u32>>,
    samples: &[process_metrics::Sample],
    cpu: &HashMap<u32, Option<f64>>,
    gpu: &GpuReadings,
) -> AppUsage {
    let ids = trees.get(&pid).map(Vec::as_slice).unwrap_or_default();
    let rows: Vec<_> = samples.iter().filter(|s| ids.contains(&s.pid)).collect();
    let (cpu_total, memory) = readable_totals(ids, &rows, cpu);
    AppUsage {
        pid,
        cpu: cpu_total,
        memory,
        gpu: gpu_total(ids, gpu),
        processes: ids.len(),
        children: details(pid, ids, samples, cpu, gpu),
        unreadable: rows
            .iter()
            .filter(|s| s.cpu_ns.is_none() || s.memory.is_none())
            .count(),
    }
}

#[tauri::command(async)]
pub fn process_monitor_stats(
    harness: State<'_, crate::harness::HarnessHost>,
    pty: State<'_, crate::pty::PtyHost>,
    stats: State<'_, ProcessStats>,
) -> Result<ProcessMonitorStats, String> {
    let mut roots = harness.process_roots();
    roots.extend(pty.process_roots());
    let app_pid = std::process::id();
    // One snapshot for the app and every owned root: the nearest root claims each
    // process, so chat/terminal subtrees never also count under the app.
    let mut pids: Vec<_> = roots.iter().map(|r| r.pid).collect();
    pids.push(app_pid);
    let samples = process_metrics::owned_snapshot(&pids)?;
    let trees = process_metrics::tree(&pids, &samples);
    let gpu = stats.gpu.lock().unwrap_or_else(|e| e.into_inner()).sample();
    let cpu = stats.cpu.lock().unwrap_or_else(|e| e.into_inner()).sample(
        &samples,
        std::time::Instant::now(),
        std::thread::available_parallelism()
            .map(usize::from)
            .unwrap_or(1),
    );
    let owned = roots
        .into_iter()
        .map(|root| {
            let ids = trees.get(&root.pid).cloned().unwrap_or_default();
            let alive = samples.iter().any(|s| s.pid == root.pid);
            let rows: Vec<_> = samples.iter().filter(|s| ids.contains(&s.pid)).collect();
            let (total_cpu, memory) = readable_totals(&ids, &rows, &cpu);
            let unavailable = rows
                .iter()
                .any(|r| r.cpu_ns.is_none() || r.memory.is_none());
            let children = details(root.pid, &ids, &samples, &cpu, &gpu);
            ProcessRow {
                root,
                cpu: total_cpu,
                memory,
                gpu: gpu_total(&ids, &gpu),
                processes: ids.len(),
                children,
                status: if !alive {
                    "exited"
                } else if unavailable {
                    "unavailable"
                } else {
                    "live"
                },
            }
        })
        .collect();
    Ok(ProcessMonitorStats {
        app: app_usage(app_pid, &trees, &samples, &cpu, &gpu),
        owned,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use process_metrics::Sample;

    fn sample(pid: u32, parent: u32, readable: bool) -> Sample {
        Sample {
            pid,
            parent,
            birth: pid as u64,
            cpu_ns: readable.then_some(0),
            memory: readable.then_some(100),
            name: format!("p{pid}.exe"),
        }
    }

    #[test]
    fn app_usage_excludes_owned_subtrees_and_counts_unreadable_helpers() {
        // 1 app, 2 WebView2 browser, 3 sandboxed renderer, 4 chat root, 5 its tool.
        let samples = vec![
            sample(1, 0, true),
            sample(2, 1, true),
            sample(3, 2, false),
            sample(4, 1, true),
            sample(5, 4, true),
        ];
        let trees = process_metrics::tree(&[4, 1], &samples);
        let cpu = HashMap::from([(1, Some(1.5)), (2, Some(2.0)), (3, None), (4, Some(9.0))]);
        // The chat's GPU (pid 4) stays on its own row; pid 3 has no GPU instance.
        let gpu = Some(HashMap::from([(1, 2.0), (2, 5.5), (4, 40.0)]));
        let usage = app_usage(1, &trees, &samples, &cpu, &gpu);
        assert_eq!(
            (usage.cpu, usage.memory, usage.processes, usage.unreadable),
            (Some(3.5), Some(200), 3, 1)
        );
        assert_eq!(usage.gpu, Some(7.5));
        assert_eq!(usage.children[2].gpu, Some(0.0));
        let listed: Vec<_> = usage.children.iter().map(|d| (d.pid, d.depth)).collect();
        assert_eq!(listed, vec![(1, 0), (2, 1), (3, 2)]);
        assert_eq!(
            (usage.children[2].cpu, usage.children[2].memory),
            (None, None)
        );
    }

    #[test]
    fn readable_totals_skip_unreadable_processes_instead_of_blanking() {
        let samples = vec![sample(4, 1, true), sample(5, 4, false), sample(6, 4, true)];
        let rows: Vec<_> = samples.iter().collect();
        let cpu = HashMap::from([(4, Some(2.0)), (5, None), (6, Some(0.5))]);
        assert_eq!(
            readable_totals(&[4, 5, 6], &rows, &cpu),
            (Some(2.5), Some(200))
        );
        let none = vec![sample(7, 1, false)];
        let rows: Vec<_> = none.iter().collect();
        assert_eq!(
            readable_totals(&[7], &rows, &HashMap::from([(7, None)])),
            (None, None)
        );
    }

    #[test]
    fn app_usage_waits_for_a_cpu_delta() {
        let samples = vec![sample(1, 0, true)];
        let trees = process_metrics::tree(&[1], &samples);
        let usage = app_usage(1, &trees, &samples, &HashMap::from([(1, None)]), &None);
        assert_eq!(
            (usage.cpu, usage.memory, usage.gpu, usage.unreadable),
            (None, Some(100), None, 0)
        );
    }

    #[test]
    fn details_lists_depth_first_with_names_and_skips_exited_roots() {
        // Root 10 → 11 → 13, and 10 → 12; snapshot order is not tree order.
        let samples = vec![
            sample(13, 11, true),
            sample(10, 0, true),
            sample(12, 10, true),
            sample(11, 10, true),
        ];
        let ids = [10, 11, 12, 13];
        let cpu = HashMap::from([(10, Some(1.0)), (13, Some(0.5))]);
        let listed = details(10, &ids, &samples, &cpu, &None);
        let order: Vec<_> = listed.iter().map(|d| (d.pid, d.depth)).collect();
        assert_eq!(order, vec![(10, 0), (12, 1), (11, 1), (13, 2)]);
        assert_eq!(listed[3].name, "p13.exe");
        assert_eq!((listed[3].parent, listed[3].cpu), (11, Some(0.5)));
        assert!(details(99, &[], &samples, &cpu, &None).is_empty());
    }
}
