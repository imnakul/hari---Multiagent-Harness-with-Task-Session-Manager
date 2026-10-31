//! Local web servers for the Browser's address suggestions (L-207): ports
//! listening on this computer that belong to a dev-server style process
//! (node, bun, python…), so system services never show up.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct LocalServer {
    port: u16,
    name: String,
}

/// Process names (lowercase, without `.exe`) that usually serve a web page.
const DEV_SERVERS: &[&str] = &[
    "node", "bun", "deno", "python", "python3", "pythonw", "php", "ruby", "java", "dotnet",
    "go", "hugo", "caddy", "nginx", "httpd", "uvicorn", "gunicorn", "flask", "rails", "puma",
    "air", "wrangler", "workerd", "vite", "next-server", "esbuild", "jekyll", "zola",
];

pub(crate) fn is_dev_server(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    let name = name.strip_suffix(".exe").unwrap_or(&name);
    DEV_SERVERS.contains(&name)
}

/// One row per port, lowest first.
pub(crate) fn pick(listeners: &[(u16, u32)], name_of: impl Fn(u32) -> Option<String>) -> Vec<LocalServer> {
    let mut servers: Vec<LocalServer> = listeners
        .iter()
        .filter(|(port, _)| *port >= 1024)
        .filter_map(|&(port, pid)| {
            let name = name_of(pid)?;
            is_dev_server(&name).then(|| LocalServer {
                port,
                name: name.trim_end_matches(".exe").to_string(),
            })
        })
        .collect();
    servers.sort_by_key(|s| s.port);
    servers.dedup_by_key(|s| s.port);
    servers
}

#[cfg(windows)]
pub(crate) fn listening() -> Vec<LocalServer> {
    let names: std::collections::HashMap<u32, String> = crate::process_metrics::snapshot()
        .unwrap_or_default()
        .into_iter()
        .map(|s| (s.pid, s.name))
        .collect();
    let mut listeners = native::ipv4();
    listeners.extend(native::ipv6());
    pick(&listeners, |pid| names.get(&pid).cloned())
}

#[cfg(not(windows))]
pub(crate) fn listening() -> Vec<LocalServer> {
    Vec::new()
}

#[cfg(windows)]
mod native {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCP6ROW_OWNER_PID, MIB_TCP6TABLE_OWNER_PID, MIB_TCPROW_OWNER_PID,
        MIB_TCPTABLE_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER,
    };
    use windows_sys::Win32::Networking::WinSock::{AF_INET, AF_INET6};

    /// The raw listener table for one address family, or None on failure.
    fn table(family: u16) -> Option<Vec<u64>> {
        let mut size = 0u32;
        unsafe {
            GetExtendedTcpTable(
                std::ptr::null_mut(),
                &mut size,
                0,
                family as u32,
                TCP_TABLE_OWNER_PID_LISTENER,
                0,
            );
        }
        if size == 0 {
            return None;
        }
        // u64 storage keeps the rows aligned.
        let mut buffer = vec![0u64; (size as usize).div_ceil(8) + 1];
        let status = unsafe {
            GetExtendedTcpTable(
                buffer.as_mut_ptr().cast(),
                &mut size,
                0,
                family as u32,
                TCP_TABLE_OWNER_PID_LISTENER,
                0,
            )
        };
        (status == 0).then_some(buffer)
    }

    fn port(raw: u32) -> u16 {
        u16::from_be((raw & 0xffff) as u16)
    }

    pub(super) fn ipv4() -> Vec<(u16, u32)> {
        let Some(buffer) = table(AF_INET) else { return Vec::new() };
        unsafe {
            let table = &*(buffer.as_ptr() as *const MIB_TCPTABLE_OWNER_PID);
            let rows: &[MIB_TCPROW_OWNER_PID] =
                std::slice::from_raw_parts(table.table.as_ptr(), table.dwNumEntries as usize);
            rows.iter()
                // Loopback (127.x) or every address (0.0.0.0); the first byte
                // in memory is the first octet.
                .filter(|row| row.dwLocalAddr == 0 || row.dwLocalAddr & 0xff == 127)
                .map(|row| (port(row.dwLocalPort), row.dwOwningPid))
                .collect()
        }
    }

    pub(super) fn ipv6() -> Vec<(u16, u32)> {
        let Some(buffer) = table(AF_INET6) else { return Vec::new() };
        let loopback: [u8; 16] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
        unsafe {
            let table = &*(buffer.as_ptr() as *const MIB_TCP6TABLE_OWNER_PID);
            let rows: &[MIB_TCP6ROW_OWNER_PID] =
                std::slice::from_raw_parts(table.table.as_ptr(), table.dwNumEntries as usize);
            rows.iter()
                .filter(|row| row.ucLocalAddr == [0; 16] || row.ucLocalAddr == loopback)
                .map(|row| (port(row.dwLocalPort), row.dwOwningPid))
                .collect()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{is_dev_server, pick, LocalServer};

    #[test]
    fn keeps_dev_servers_once_per_port() {
        assert!(is_dev_server("node.exe"));
        assert!(is_dev_server("Python"));
        assert!(!is_dev_server("svchost.exe"));
        let found = pick(&[(5173, 1), (5173, 1), (445, 2), (3000, 3), (8080, 4)], |pid| {
            Some(["", "node.exe", "System", "bun.exe", "svchost.exe"][pid as usize].to_string())
        });
        assert_eq!(
            found,
            vec![
                LocalServer { port: 3000, name: "bun".into() },
                LocalServer { port: 5173, name: "node".into() },
            ]
        );
    }
}
