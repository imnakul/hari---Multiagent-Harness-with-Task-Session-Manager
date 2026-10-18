//! Per-process GPU use for the process monitor, read from the Windows "GPU Engine"
//! performance counters (the source of Task Manager's GPU column). Other platforms
//! have no comparable per-process counter, so they report nothing.
use std::collections::HashMap;

/// Task Manager's rule: add up a process's engines of the same type (3D, Copy,
/// VideoDecode…), then report its busiest type, capped at 100%.
/// Instance names look like `pid_1234_luid_0x0_0x1_phys_0_eng_0_engtype_3D`.
#[cfg(any(windows, test))]
pub(crate) fn gpu_by_pid(readings: &[(String, f64)]) -> HashMap<u32, f64> {
    let mut per_type: HashMap<(u32, &str), f64> = HashMap::new();
    for (name, value) in readings {
        let Some(pid) = name
            .strip_prefix("pid_")
            .and_then(|rest| rest.split('_').next())
            .and_then(|pid| pid.parse().ok())
        else {
            continue;
        };
        let engine = name.rsplit_once("engtype_").map_or("", |(_, kind)| kind);
        *per_type.entry((pid, engine)).or_default() += value.max(0.0);
    }
    let mut result: HashMap<u32, f64> = HashMap::new();
    for ((pid, _), value) in per_type {
        let busiest = result.entry(pid).or_default();
        *busiest = busiest.max(value.min(100.0));
    }
    result
}

/// Keeps one PDH query open between monitor refreshes: utilization is a rate,
/// so the first collection only primes it. Only sampled while the monitor runs.
#[cfg(windows)]
pub(crate) struct GpuSampler {
    query: windows_sys::Win32::System::Performance::PDH_HQUERY,
    counter: windows_sys::Win32::System::Performance::PDH_HCOUNTER,
    primed: bool,
    unavailable: bool,
}

// SAFETY: PDH handles are process-wide and only touched behind ProcessStats' mutex.
#[cfg(windows)]
unsafe impl Send for GpuSampler {}

#[cfg(windows)]
impl Default for GpuSampler {
    fn default() -> Self {
        Self {
            query: std::ptr::null_mut(),
            counter: std::ptr::null_mut(),
            primed: false,
            unavailable: false,
        }
    }
}

#[cfg(windows)]
impl GpuSampler {
    /// GPU % by PID; `None` while the first reading primes the counters or when
    /// this machine exposes no GPU counters (no driver support, some VMs).
    pub fn sample(&mut self) -> Option<HashMap<u32, f64>> {
        use windows_sys::Win32::System::Performance::{
            PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData,
            PdhGetFormattedCounterArrayW, PdhOpenQueryW, PDH_CSTATUS_NEW_DATA,
            PDH_CSTATUS_VALID_DATA, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE, PDH_MORE_DATA,
        };
        if self.unavailable {
            return None;
        }
        // Every PDH handle opened here is closed on failure or in Drop.
        unsafe {
            if self.query.is_null() {
                let mut query = std::ptr::null_mut();
                if PdhOpenQueryW(std::ptr::null(), 0, &mut query) != 0 {
                    self.unavailable = true;
                    return None;
                }
                let path: Vec<u16> = "\\GPU Engine(*)\\Utilization Percentage\0"
                    .encode_utf16()
                    .collect();
                let mut counter = std::ptr::null_mut();
                if PdhAddEnglishCounterW(query, path.as_ptr(), 0, &mut counter) != 0 {
                    PdhCloseQuery(query);
                    self.unavailable = true;
                    return None;
                }
                self.query = query;
                self.counter = counter;
            }
            if PdhCollectQueryData(self.query) != 0 {
                return None;
            }
            if !self.primed {
                self.primed = true;
                return None;
            }
            let (mut size, mut count) = (0u32, 0u32);
            let status = PdhGetFormattedCounterArrayW(
                self.counter,
                PDH_FMT_DOUBLE,
                &mut size,
                &mut count,
                std::ptr::null_mut(),
            );
            if status != PDH_MORE_DATA {
                // No instances means no process is using the GPU right now.
                return (status == 0).then(HashMap::new);
            }
            // PDH stores the names after the items, so size the buffer in items.
            let item = std::mem::size_of::<PDH_FMT_COUNTERVALUE_ITEM_W>();
            let mut buffer =
                vec![PDH_FMT_COUNTERVALUE_ITEM_W::default(); (size as usize).div_ceil(item)];
            if PdhGetFormattedCounterArrayW(
                self.counter,
                PDH_FMT_DOUBLE,
                &mut size,
                &mut count,
                buffer.as_mut_ptr(),
            ) != 0
            {
                return None;
            }
            let readings: Vec<(String, f64)> = buffer
                .iter()
                .take(count as usize)
                .filter(|entry| {
                    let status = entry.FmtValue.CStatus;
                    !entry.szName.is_null()
                        && (status == PDH_CSTATUS_VALID_DATA || status == PDH_CSTATUS_NEW_DATA)
                })
                .map(|entry| {
                    let len = (0..).take_while(|i| *entry.szName.add(*i) != 0).count();
                    let name =
                        String::from_utf16_lossy(std::slice::from_raw_parts(entry.szName, len));
                    (name, entry.FmtValue.Anonymous.doubleValue)
                })
                .collect();
            Some(gpu_by_pid(&readings))
        }
    }
}

#[cfg(windows)]
impl Drop for GpuSampler {
    fn drop(&mut self) {
        if !self.query.is_null() {
            // SAFETY: the query was opened by PdhOpenQueryW and is closed once.
            unsafe {
                windows_sys::Win32::System::Performance::PdhCloseQuery(self.query);
            }
        }
    }
}

#[cfg(not(windows))]
#[derive(Default)]
pub(crate) struct GpuSampler;

#[cfg(not(windows))]
impl GpuSampler {
    pub fn sample(&mut self) -> Option<HashMap<u32, f64>> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reading(name: &str, value: f64) -> (String, f64) {
        (name.to_string(), value)
    }

    #[test]
    fn sums_engines_per_type_and_reports_the_busiest_type() {
        let readings = vec![
            reading("pid_10_luid_0x0_0x1_phys_0_eng_0_engtype_3D", 12.0),
            reading("pid_10_luid_0x0_0x1_phys_0_eng_1_engtype_3D", 8.0),
            reading("pid_10_luid_0x0_0x1_phys_0_eng_5_engtype_Copy", 30.0),
            reading("pid_11_luid_0x0_0x1_phys_0_eng_0_engtype_3D", 70.0),
            reading("pid_11_luid_0x0_0x1_phys_0_eng_2_engtype_3D", 60.0),
            reading("_Total", 99.0),
        ];
        let gpu = gpu_by_pid(&readings);
        assert_eq!(gpu.get(&10), Some(&30.0));
        assert_eq!(gpu.get(&11), Some(&100.0));
        assert_eq!(gpu.len(), 2);
    }

    #[cfg(windows)]
    #[test]
    fn sampler_primes_then_reads_or_reports_unavailable() {
        let mut sampler = GpuSampler::default();
        assert!(sampler.sample().is_none());
        std::thread::sleep(std::time::Duration::from_millis(50));
        // Machines without GPU counters stay None; others return a map.
        if let Some(gpu) = sampler.sample() {
            assert!(gpu.values().all(|v| (0.0..=100.0).contains(v)));
        }
    }
}
