//! Native, spawn-free process sampling. No dependency beyond existing OS bindings.
use std::collections::{HashMap, HashSet};
use std::time::Instant;

#[derive(Clone, Debug)]
pub(crate) struct Sample {
    pub pid: u32,
    pub parent: u32,
    pub birth: u64,
    /// Executable or command name from the snapshot; empty when the OS gives none.
    pub name: String,
    pub cpu_ns: Option<u64>,
    pub memory: Option<u64>,
}

#[cfg(target_os = "macos")]
fn c_name(raw: &[libc::c_char]) -> String {
    let bytes: Vec<u8> = raw
        .iter()
        .take_while(|c| **c != 0)
        .map(|c| *c as u8)
        .collect();
    String::from_utf8_lossy(&bytes).into_owned()
}

pub(crate) fn tree(roots: &[u32], samples: &[Sample]) -> HashMap<u32, Vec<u32>> {
    let parents: HashMap<_, _> = samples.iter().map(|s| (s.pid, s.parent)).collect();
    let owners: HashSet<_> = roots.iter().copied().collect();
    let mut result: HashMap<_, Vec<_>> = roots.iter().map(|p| (*p, Vec::new())).collect();
    for sample in samples {
        let mut current = sample.pid;
        let mut seen = HashSet::new();
        while seen.insert(current) {
            if owners.contains(&current) {
                result.entry(current).or_default().push(sample.pid);
                break; // Nearest owner wins: totals never double-count a child.
            }
            let Some(parent) = parents.get(&current) else {
                break;
            };
            if *parent == 0 {
                break;
            }
            current = *parent;
        }
    }
    result
}

#[derive(Default)]
pub(crate) struct CpuHistory(HashMap<(u32, u64), (Instant, u64)>);
impl CpuHistory {
    pub fn sample(
        &mut self,
        samples: &[Sample],
        now: Instant,
        cpus: usize,
    ) -> HashMap<u32, Option<f64>> {
        let mut next = HashMap::new();
        let mut values = HashMap::new();
        for sample in samples {
            let key = (sample.pid, sample.birth);
            let value = sample.cpu_ns.and_then(|cpu| {
                let previous = self.0.get(&key);
                next.insert(key, (now, cpu));
                previous.and_then(|(time, old)| {
                    let elapsed = now.saturating_duration_since(*time).as_nanos() as f64;
                    (elapsed > 0.0 && cpu >= *old).then(|| {
                        ((cpu - *old) as f64 / elapsed / cpus.max(1) as f64 * 100.0)
                            .clamp(0.0, 100.0)
                    })
                })
            });
            values.insert(sample.pid, value);
        }
        self.0 = next;
        values
    }
}

#[cfg(windows)]
pub(crate) fn snapshot() -> Result<Vec<Sample>, String> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError, ERROR_NO_MORE_FILES, INVALID_HANDLE_VALUE},
        System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
    };
    // Every acquired native handle is closed in this scope, including error paths.
    unsafe {
        let handle = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if handle == INVALID_HANDLE_VALUE {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of_val(&entry) as u32;
        if Process32FirstW(handle, &mut entry) == 0 {
            CloseHandle(handle);
            return Err(std::io::Error::last_os_error().to_string());
        }
        let mut result = Vec::new();
        loop {
            let len = entry
                .szExeFile
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(entry.szExeFile.len());
            result.push(Sample {
                pid: entry.th32ProcessID,
                parent: entry.th32ParentProcessID,
                birth: 0,
                name: String::from_utf16_lossy(&entry.szExeFile[..len]),
                cpu_ns: None,
                memory: None,
            });
            if Process32NextW(handle, &mut entry) == 0 {
                let error = GetLastError();
                if error != ERROR_NO_MORE_FILES {
                    CloseHandle(handle);
                    return Err(std::io::Error::from_raw_os_error(error as i32).to_string());
                }
                break;
            }
        }
        CloseHandle(handle);
        // Process metrics are collected separately, only for owned trees.
        Ok(result)
    }
}

#[cfg(windows)]
fn read_metrics(sample: &mut Sample) {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, FILETIME},
        System::{
            ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS},
            Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ},
        },
    };
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, sample.pid);
        if process.is_null() {
            return;
        }
        let mut times: [FILETIME; 4] = std::mem::zeroed();
        if GetProcessTimes(
            process,
            &mut times[0],
            &mut times[1],
            &mut times[2],
            &mut times[3],
        ) != 0
        {
            let ticks = |t: FILETIME| ((t.dwHighDateTime as u64) << 32) | t.dwLowDateTime as u64;
            sample.birth = ticks(times[0]);
            sample.cpu_ns = Some((ticks(times[2]) + ticks(times[3])).saturating_mul(100));
        }
        let mut memory: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
        memory.cb = std::mem::size_of_val(&memory) as u32;
        if K32GetProcessMemoryInfo(
            process,
            &mut memory,
            std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
        ) != 0
        {
            sample.memory = Some(memory.WorkingSetSize as u64);
        }
        CloseHandle(process);
    }
}

#[cfg(target_os = "linux")]
pub(crate) fn snapshot() -> Result<Vec<Sample>, String> {
    let mut result = Vec::new();
    for entry in std::fs::read_dir("/proc").map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|s| s.parse::<u32>().ok())
        else {
            continue;
        };
        let stat = match std::fs::read_to_string(entry.path().join("stat")) {
            Ok(stat) => stat,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("Process tree enumeration unavailable: {error}")),
        };
        if let Some(sample) = linux_stat(pid, &stat) {
            result.push(sample);
        }
    }
    Ok(result)
}

#[cfg(target_os = "linux")]
fn linux_stat(pid: u32, stat: &str) -> Option<Sample> {
    let fields: Vec<_> = stat
        .get(stat.rfind(')')? + 2..)?
        .split_whitespace()
        .collect();
    Some(Sample {
        pid,
        parent: fields.get(1)?.parse().ok()?,
        birth: fields.get(19)?.parse().ok()?,
        name: stat.get(stat.find('(')? + 1..stat.rfind(')')?)?.to_string(),
        cpu_ns: None,
        memory: None,
    })
}

#[cfg(target_os = "linux")]
fn read_metrics(sample: &mut Sample) {
    let Ok(stat) = std::fs::read_to_string(format!("/proc/{}/stat", sample.pid)) else {
        return;
    };
    let Some(parsed) = linux_stat(sample.pid, &stat) else {
        return;
    };
    if parsed.birth != sample.birth {
        return;
    }
    let Some(tail) = stat.rfind(')').and_then(|i| stat.get(i + 2..)) else {
        return;
    };
    let fields: Vec<_> = tail.split_whitespace().collect();
    let number = |index: usize| fields.get(index).and_then(|n| n.parse::<u64>().ok());
    let ticks = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
    let page = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    if ticks > 0 {
        sample.cpu_ns = number(11)
            .zip(number(12))
            .map(|(a, b)| (a + b).saturating_mul(1_000_000_000) / ticks as u64);
    }
    if page > 0 {
        sample.memory = number(21).map(|rss| rss.saturating_mul(page as u64));
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn snapshot() -> Result<Vec<Sample>, String> {
    // libproc.h PROC_ALL_PIDS is not exported by the existing libc version.
    const PROC_ALL_PIDS: u32 = 1;
    unsafe {
        let bytes = libc::proc_listpids(PROC_ALL_PIDS, 0, std::ptr::null_mut(), 0);
        if bytes <= 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let mut pids = vec![0i32; bytes as usize / 4 + 1024];
        let count = libc::proc_listpids(
            PROC_ALL_PIDS,
            0,
            pids.as_mut_ptr().cast(),
            (pids.len() * 4) as i32,
        );
        if count <= 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let mut result = Vec::new();
        for pid in pids.into_iter().take(count as usize / 4).filter(|p| *p > 0) {
            let mut info: libc::proc_bsdinfo = std::mem::zeroed();
            let size = std::mem::size_of_val(&info) as i32;
            *libc::__error() = 0;
            if libc::proc_pidinfo(
                pid,
                libc::PROC_PIDTBSDINFO,
                0,
                (&mut info as *mut libc::proc_bsdinfo).cast(),
                size,
            ) != size
            {
                let error = std::io::Error::last_os_error();
                if matches!(error.raw_os_error(), Some(libc::ESRCH | libc::ENOENT)) {
                    continue;
                }
                return Err(format!("Process tree enumeration unavailable: {error}"));
            }
            result.push(Sample {
                pid: pid as u32,
                parent: info.pbi_ppid,
                birth: info.pbi_start_tvsec.saturating_mul(1_000_000) + info.pbi_start_tvusec,
                name: match c_name(&info.pbi_name) {
                    name if name.is_empty() => c_name(&info.pbi_comm),
                    name => name,
                },
                cpu_ns: None,
                memory: None,
            });
        }
        Ok(result)
    }
}
#[cfg(target_os = "macos")]
fn read_metrics(sample: &mut Sample) {
    unsafe {
        let mut info: libc::proc_taskallinfo = std::mem::zeroed();
        let size = std::mem::size_of_val(&info) as i32;
        if libc::proc_pidinfo(
            sample.pid as i32,
            libc::PROC_PIDTASKALLINFO,
            0,
            (&mut info as *mut libc::proc_taskallinfo).cast(),
            size,
        ) != size
        {
            return;
        }
        let birth =
            info.pbsd.pbi_start_tvsec.saturating_mul(1_000_000) + info.pbsd.pbi_start_tvusec;
        if birth != sample.birth {
            return;
        }
        sample.cpu_ns = Some(info.ptinfo.pti_total_user + info.ptinfo.pti_total_system);
        sample.memory = Some(info.ptinfo.pti_resident_size);
    }
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
pub(crate) fn snapshot() -> Result<Vec<Sample>, String> {
    Err("Native process stats unavailable on this platform".into())
}
#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
fn read_metrics(_sample: &mut Sample) {}

pub(crate) fn owned_snapshot(roots: &[u32]) -> Result<Vec<Sample>, String> {
    let samples = snapshot()?;
    let owned: HashSet<_> = tree(roots, &samples).into_values().flatten().collect();
    Ok(samples
        .into_iter()
        .filter(|s| owned.contains(&s.pid))
        .map(|mut s| {
            read_metrics(&mut s);
            s
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample(pid: u32, parent: u32, birth: u64, cpu: u64) -> Sample {
        Sample {
            pid,
            parent,
            birth,
            name: String::new(),
            cpu_ns: Some(cpu),
            memory: Some(1),
        }
    }
    #[test]
    fn partitions_nested_owners_and_handles_parent_cycles() {
        let rows = vec![
            sample(1, 0, 1, 0),
            sample(2, 1, 2, 0),
            sample(3, 2, 3, 0),
            sample(4, 5, 4, 0),
            sample(5, 4, 5, 0),
        ];
        assert_eq!(
            tree(&[1, 2], &rows),
            HashMap::from([(1, vec![1]), (2, vec![2, 3])])
        );
    }
    #[test]
    fn cpu_deltas_normalize_and_do_not_reuse_pid_history() {
        let mut cache = CpuHistory::default();
        let time = Instant::now();
        assert_eq!(cache.sample(&[sample(5, 1, 7, 100)], time, 2)[&5], None);
        let later = time + std::time::Duration::from_secs(1);
        assert_eq!(
            cache.sample(&[sample(5, 1, 7, 1_000_000_100)], later, 2)[&5],
            Some(50.0)
        );
        assert_eq!(cache.sample(&[sample(5, 1, 8, 1)], later, 2)[&5], None);
    }
    #[test]
    fn native_snapshot_can_read_our_own_process() {
        let pid = std::process::id();
        let rows = owned_snapshot(&[pid]).unwrap();
        let own = rows.iter().find(|r| r.pid == pid).unwrap();
        assert!(own.cpu_ns.is_some());
        assert!(own.memory.is_some_and(|m| m > 0));
    }
}
