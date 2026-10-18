//! Explicit tool stops for the combined resource view; all roots come from live registries.
use crate::process_metrics::{self, Sample};
use crate::process_stats::ProcessRoot;
use std::collections::HashMap;
use tauri::State;

#[tauri::command(async)]
pub fn process_stop_tool(
    harness: State<'_, crate::harness::HarnessHost>,
    pty: State<'_, crate::pty::PtyHost>,
    root_id: String,
    root_pid: u32,
    root_identity: String,
    pid: u32,
    identity: String,
) -> Result<(), String> {
    let mut roots = harness.process_roots();
    roots.extend(pty.process_roots());
    let root = roots
        .iter()
        .find(|root| root.id == root_id && root.pid == root_pid)
        .ok_or("The owning session exited or restarted; refresh the list")?;
    if root.identity.as_deref() != Some(root_identity.as_str()) {
        return Err("The owning session exited or restarted; refresh the list".into());
    }
    let samples =
        process_metrics::owned_snapshot(&roots.iter().map(|root| root.pid).collect::<Vec<_>>())?;
    let targets = validated_targets(root, pid, &identity, &roots, &samples)?;
    for (target, stamp) in &targets {
        if process_metrics::identity(root_pid).as_deref() != Some(root_identity.as_str()) {
            return Err("The owning session exited or changed".into());
        }
        signal_verified(*target, stamp, false)?;
    }
    #[cfg(unix)]
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(2));
        for (target, stamp) in targets {
            let _ = signal_verified(target, &stamp, true);
        }
    });
    Ok(())
}

/// The selected PID must be a current descendant, never a root, app process or
/// a different session. Birth ordering rejects parent PIDs reused after a child started.
fn validated_targets(
    root: &ProcessRoot,
    pid: u32,
    identity: &str,
    roots: &[ProcessRoot],
    samples: &[Sample],
) -> Result<Vec<(u32, String)>, String> {
    let by_pid: HashMap<_, _> = samples.iter().map(|sample| (sample.pid, sample)).collect();
    let current_root = by_pid.get(&root.pid).ok_or("The owning session exited")?;
    let current_identity = process_metrics::sample_identity(current_root);
    if current_identity.is_none() || current_identity != root.identity {
        return Err("The owning session changed; refresh the list".into());
    }
    if roots.iter().any(|root| root.pid == pid) || pid == std::process::id() {
        return Err("Use the session Stop control for an agent or terminal".into());
    }
    let target = by_pid
        .get(&pid)
        .ok_or("This tool exited; refresh the list")?;
    if process_metrics::sample_identity(target).as_deref() != Some(identity) {
        return Err("This tool exited or changed; refresh the list".into());
    }
    let owners: Vec<_> = roots.iter().map(|root| root.pid).collect();
    let owned = process_metrics::tree(&owners, samples);
    let ids = owned.get(&root.pid).ok_or("The owning session exited")?;
    if !ids.contains(&pid) {
        return Err("This tool is not owned by this session".into());
    }
    let tree = process_metrics::tree(&[pid], samples);
    let mut targets = Vec::new();
    for sample in samples
        .iter()
        .filter(|sample| ids.contains(&sample.pid) && tree[&pid].contains(&sample.pid))
    {
        let stamp = process_metrics::sample_identity(sample)
            .ok_or("Tool identity unavailable; refresh the list")?;
        let mut current = sample;
        let mut depth = 0;
        while current.pid != root.pid {
            let parent = by_pid
                .get(&current.parent)
                .ok_or("Tool ancestry changed; refresh the list")?;
            if current.birth < parent.birth || parent.birth == 0 || depth >= samples.len() {
                return Err("Tool ancestry changed; refresh the list".into());
            }
            current = parent;
            depth += 1;
        }
        targets.push((depth, sample.pid, stamp));
    }
    targets.sort_by_key(|(depth, _, _)| std::cmp::Reverse(*depth));
    Ok(targets
        .into_iter()
        .map(|(_, pid, identity)| (pid, identity))
        .collect())
}

#[cfg(windows)]
fn signal_verified(pid: u32, identity: &str, _force: bool) -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, FILETIME},
        System::Threading::{
            GetProcessTimes, OpenProcess, TerminateProcess, PROCESS_QUERY_LIMITED_INFORMATION,
            PROCESS_TERMINATE,
        },
    };
    // Keep the verified kernel handle through termination: PID reuse cannot
    // redirect this request to a replacement process.
    unsafe {
        let handle = OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE,
            0,
            pid,
        );
        if handle.is_null() {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let mut times: [FILETIME; 4] = std::mem::zeroed();
        let ok = GetProcessTimes(
            handle,
            &mut times[0],
            &mut times[1],
            &mut times[2],
            &mut times[3],
        );
        let birth = ((times[0].dwHighDateTime as u64) << 32) | times[0].dwLowDateTime as u64;
        if ok == 0 || format!("{pid}:{birth}") != identity {
            CloseHandle(handle);
            return Err("This tool exited or changed; refresh the list".into());
        }
        let result = TerminateProcess(handle, 1);
        let error = std::io::Error::last_os_error();
        CloseHandle(handle);
        if result == 0 {
            return Err(error.to_string());
        }
    }
    Ok(())
}

#[cfg(unix)]
fn signal_verified(pid: u32, identity: &str, force: bool) -> Result<(), String> {
    let Some(current) = process_metrics::identity(pid) else {
        return Ok(());
    };
    if current != identity {
        return Err("This tool exited or changed; refresh the list".into());
    }
    let signal = if force { libc::SIGKILL } else { libc::SIGTERM };
    let result = unsafe { libc::kill(pid as i32, signal) };
    if result != 0 && std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH) {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

#[cfg(not(any(windows, unix)))]
fn signal_verified(_pid: u32, _identity: &str, _force: bool) -> Result<(), String> {
    Err("Stopping individual tools is unavailable on this platform".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample(pid: u32, parent: u32, birth: u64) -> Sample {
        Sample {
            pid,
            parent,
            birth,
            name: "tool".into(),
            cpu_ns: Some(0),
            memory: Some(1),
        }
    }
    fn root(pid: u32, birth: u64) -> ProcessRoot {
        ProcessRoot {
            id: format!("chat-{pid}"),
            pid,
            identity: Some(format!("{pid}:{birth}")),
            cwd: "/repo".into(),
            kind: "structured".into(),
            idle_ms: 0,
        }
    }
    #[test]
    fn only_the_selected_tools_owned_tree_is_stopped_children_first() {
        let root = root(100, 10);
        let rows = vec![
            sample(100, 1, 10),
            sample(101, 100, 11),
            sample(102, 101, 12),
            sample(103, 100, 13),
        ];
        assert_eq!(
            validated_targets(&root, 101, "101:11", std::slice::from_ref(&root), &rows).unwrap(),
            vec![(102, "102:12".into()), (101, "101:11".into())]
        );
    }
    #[test]
    fn refuses_agents_unknown_processes_reused_pids_and_other_owned_trees() {
        let first = root(100, 10);
        let second = root(200, 20);
        let roots = vec![first.clone(), second];
        let rows = vec![
            sample(100, 1, 10),
            sample(101, 100, 11),
            sample(200, 1, 20),
            sample(201, 200, 21),
        ];
        for (pid, stamp) in [
            (100, "100:10"),
            (999, "999:1"),
            (101, "101:9"),
            (201, "201:21"),
        ] {
            assert!(validated_targets(&first, pid, stamp, &roots, &rows).is_err());
        }
        let mut reused = rows.clone();
        reused[0].birth = 30;
        assert!(validated_targets(&first, 101, "101:11", &roots, &reused).is_err());
    }
    #[test]
    fn refuses_unreadable_birth_times_and_reused_parent_links() {
        let root = root(100, 10);
        for birth in [0, 9] {
            let rows = vec![sample(100, 1, 10), sample(101, 100, birth)];
            assert!(validated_targets(
                &root,
                101,
                &format!("101:{birth}"),
                std::slice::from_ref(&root),
                &rows
            )
            .is_err());
        }
    }
}
