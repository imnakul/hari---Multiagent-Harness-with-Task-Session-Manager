//! Windows counterpart to the Unix opt-in PTY host: JSON plumbing only.
#![allow(dead_code)]

#[path = "../../../src-tauri/src/process_metrics.rs"]
#[allow(dead_code)]
mod process_metrics;

#[cfg(windows)]
#[path = "../../../src-tauri/src/pty_output.rs"]
mod output;
#[cfg(windows)]
#[path = "../../../src-tauri/src/windows.rs"]
mod windows;

#[cfg(windows)]
const READ_CHUNK: usize = 32 * 1024;
#[cfg(windows)]
const PTY_COALESCE: std::time::Duration = std::time::Duration::from_millis(8);

#[cfg(not(windows))]
fn main() {
    eprintln!("Use fixtures/interactive-pty-host.py on Unix");
    std::process::exit(1);
}

#[cfg(windows)]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    use base64::Engine;
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use serde::Deserialize;
    use serde_json::{json, Value};
    use std::collections::HashMap;
    use std::io::{BufRead, Write};
    use std::sync::{Arc, Mutex};

    #[derive(Deserialize)]
    struct Request {
        id: u64,
        command: String,
        #[serde(default)]
        argv: Vec<String>,
        #[serde(default)]
        cwd: String,
        #[serde(default)]
        env: HashMap<String, String>,
        data: Option<String>,
        cols: Option<u16>,
        rows: Option<u16>,
    }
    type Child = Box<dyn portable_pty::Child + Send + Sync>;
    struct Live {
        writer: Box<dyn Write + Send>,
        master: Box<dyn portable_pty::MasterPty + Send>,
        child: Arc<Mutex<Child>>,
        reader: std::thread::JoinHandle<()>,
    }
    fn stop(live: Option<Live>) {
        if let Some(live) = live {
            let mut child = live.child.lock().unwrap();
            if let Some(pid) = child.process_id() {
                use std::os::windows::process::CommandExt;
                let _ = std::process::Command::new("taskkill.exe")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .creation_flags(0x08000000)
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .status();
            }
            let _ = child.kill();
            drop(child);
            drop(live.writer);
            // The output pump keeps draining while ClosePseudoConsole flushes.
            drop(live.master);
            let _ = live.reader.join();
        }
    }
    fn emit(stdout: &Mutex<std::io::Stdout>, value: Value) {
        let mut stdout = stdout.lock().unwrap();
        writeln!(stdout, "{value}").unwrap();
        stdout.flush().unwrap();
    }
    windows::initialize()?;
    let stdout = Arc::new(Mutex::new(std::io::stdout()));
    let mut live: Option<Live> = None;
    for line in std::io::stdin().lock().lines() {
        let request: Request = serde_json::from_str(&line?)?;
        let result: Result<(), Box<dyn std::error::Error>> = (|| {
            match request.command.as_str() {
                "start" => {
                    stop(live.take());
                    let pair = native_pty_system().openpty(PtySize {
                        cols: 120,
                        rows: 40,
                        ..Default::default()
                    })?;
                    let mut command = CommandBuilder::new(
                        request.argv.first().ok_or("Missing native executable")?,
                    );
                    command.args(&request.argv[1..]);
                    command.cwd(&request.cwd);
                    for (key, value) in std::env::vars() {
                        command.env(key, value);
                    }
                    for name in [
                        "CLAUDECODE",
                        "ANTHROPIC_AUTH_TOKEN",
                        "CLAUDE_CODE_OAUTH_TOKEN",
                    ] {
                        command.env_remove(name);
                    }
                    command.env("TERM_PROGRAM", "MonoCode");
                    for (key, value) in &request.env {
                        command.env(key, value);
                    }
                    let child = windows::spawn_pty(pair.slave.as_ref(), command)?;
                    drop(pair.slave);
                    let reader = pair.master.try_clone_reader()?;
                    let mut writer = pair.master.take_writer()?;
                    // Match the production Windows startup handshake exactly.
                    writer.write_all(b"\x1b[1;1R")?;
                    writer.flush()?;
                    let child = Arc::new(Mutex::new(child));
                    let child_reader = child.clone();
                    let stream = stdout.clone();
                    let reader = std::thread::spawn(move || {
                        output::pump(reader, |bytes| {
                            emit(
                                &stream,
                                json!({"event":"data", "data":base64::engine::general_purpose::STANDARD.encode(bytes)}),
                            );
                        });
                        let code = child_reader
                            .lock()
                            .unwrap()
                            .try_wait()
                            .ok()
                            .flatten()
                            .map(|status| status.exit_code());
                        emit(&stream, json!({"event":"exit", "code":code}));
                    });
                    live = Some(Live {
                        writer,
                        master: pair.master,
                        child,
                        reader,
                    });
                }
                "write" => {
                    let live = live.as_mut().ok_or("No live PTY")?;
                    let data = request.data.as_deref().ok_or("Missing input")?;
                    live.writer.write_all(data.as_bytes())?;
                    live.writer.flush()?;
                }
                "resize" => {
                    live.as_ref().ok_or("No live PTY")?.master.resize(PtySize {
                        cols: request.cols.ok_or("Missing columns")?,
                        rows: request.rows.ok_or("Missing rows")?,
                        ..Default::default()
                    })?;
                }
                "stop" => stop(live.take()),
                _ => return Err("Unknown PTY command".into()),
            }
            Ok(())
        })();
        emit(
            &stdout,
            match result {
                Ok(()) => json!({"id":request.id}),
                Err(error) => json!({"id":request.id, "error":error.to_string()}),
            },
        );
    }
    stop(live);
    Ok(())
}

#[cfg(all(windows, test))]
fn hide_window_console(command: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000);
}
