//! Bounded, read-only evidence from local Claude and Codex transcript files.
use crate::provider_sessions::{self, Provider};
use crate::session_store::SessionStore;
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs::{self, File, Metadata, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};

const MAX_NATIVE_ID_BYTES: usize = 128;
const MAX_SCAN_DEPTH: usize = 8;
const MAX_SCAN_ENTRIES: usize = 20_000;
const MAX_SCAN_TIME: Duration = Duration::from_millis(1_500);
const MAX_READ_BYTES: usize = 2 * 1024 * 1024;
const HEAD_READ_BYTES: usize = 256 * 1024;
const MAX_LINE_BYTES: usize = 128 * 1024;
const MAX_LINES: usize = 50_000;
const MAX_HEADER_LINES: usize = 256;
const MAX_MEASUREMENTS: usize = 1_000;
const MAX_SAFE_JSON_INTEGER: u64 = 9_007_199_254_740_991;
const SOURCE: &str = "local-native-transcript";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionIdentity {
    session_id: String,
    provider: Provider,
    native_id: String,
    account_id: String,
}

/// Reads bounded identity columns only. In particular, this never invokes the
/// general session loader or Mono's transcript migration/repair path.
#[tauri::command(async)]
pub fn debug_inspector_session_identity(
    store: State<'_, SessionStore>,
    session_id: String,
) -> Result<SessionIdentity, String> {
    let conn = store.lock_conn()?;
    session_identity(&conn, &session_id)
}

fn session_identity(conn: &Connection, session_id: &str) -> Result<SessionIdentity, String> {
    validate_native_id(session_id)?;
    let row: Option<(String, String, String)> = conn
        .query_row(
            "SELECT harness, provider_session_id, COALESCE(provider_account_id, 'default')
             FROM sessions WHERE id = ?1 AND length(harness) <= 32
             AND length(provider_session_id) <= 128
             AND (provider_account_id IS NULL OR length(provider_account_id) <= 80)",
            [session_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|_| "Could not read saved session identity".to_string())?;
    let (harness, native_id, account_id) = row.ok_or("No supported native identity for this chat")?;
    let provider = match harness.as_str() {
        "claude" => Provider::Claude,
        "codex" => Provider::Codex,
        _ => return Err("This provider has no supported local evidence format".into()),
    };
    validate_native_id(&native_id)?;
    validate_native_id(&account_id)?;
    Ok(SessionIdentity {
        session_id: session_id.to_string(),
        provider,
        native_id,
        account_id,
    })
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
enum MeasurementScope {
    Message,
    SessionCumulative,
    SdkResult,
    LastResponse,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct EvidenceMeasurement {
    identity: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    timestamp: Option<String>,
    scope: MeasurementScope,
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    uncached_input: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    input: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    output: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cache_read: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cache_write: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cache_write_5m: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cache_write_1h: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cost_usd: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEvidence {
    provider: Provider,
    native_id: String,
    account_id: String,
    source: &'static str,
    observed_at: u64,
    file_bytes: u64,
    read_bytes: u64,
    truncated: bool,
    changed_during_read: bool,
    malformed_lines: u32,
    partial_lines: u32,
    limitations: Vec<String>,
    measurements: Vec<EvidenceMeasurement>,
}

#[derive(Debug)]
struct CandidateScan {
    candidate: Option<PathBuf>,
    limitations: BTreeSet<&'static str>,
}

#[derive(Debug)]
struct TextSegment {
    bytes: Vec<u8>,
    starts_at_file_start: bool,
    preceding_byte: Option<u8>,
}

#[derive(Debug)]
struct BoundedRead {
    file_bytes: u64,
    read_bytes: u64,
    truncated: bool,
    changed_during_read: bool,
    head: TextSegment,
    tail: Option<TextSegment>,
}

#[derive(Debug, Default)]
struct ParseStats {
    malformed_lines: u32,
    partial_lines: u32,
    lines_seen: usize,
    measurements: Vec<EvidenceMeasurement>,
    limitations: BTreeSet<&'static str>,
    seen_message_ids: HashMap<String, usize>,
    seen_sdk_result_ids: HashMap<String, usize>,
    seen_codex_measurements: HashSet<CodexMeasurementFingerprint>,
    codex_records: usize,
    claude_results: usize,
    stopped: bool,
}

#[derive(Debug, Hash, PartialEq, Eq)]
struct CodexMeasurementFingerprint {
    scope: MeasurementScope,
    timestamp: Option<String>,
    input: Option<u64>,
    cache_read: Option<u64>,
    output: Option<u64>,
    reasoning: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HeaderIdentity {
    Match,
    Missing,
    Mismatch,
}

#[tauri::command(async)]
/// Reads allowlisted usage metadata from one account-scoped native transcript.
/// The scan and read are bounded, validate the transcript identity, and never
/// return transcript text or paths.
pub fn debug_inspector_local_evidence(
    app: AppHandle,
    provider: Provider,
    account_id: Option<String>,
    native_id: String,
) -> Result<LocalEvidence, String> {
    validate_native_id(&native_id)?;
    let account = account_id.unwrap_or_else(|| "default".to_string());
    let root = provider_sessions::root_for(&app, &provider, &account)
        .map_err(|_| "Could not resolve the selected provider account".to_string())?;
    read_local_evidence(&root, provider, account, native_id)
}

fn validate_native_id(native_id: &str) -> Result<(), String> {
    if native_id.is_empty()
        || native_id.len() > MAX_NATIVE_ID_BYTES
        || !native_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("Invalid native session ID".into());
    }
    Ok(())
}

fn read_local_evidence(
    root: &Path,
    provider: Provider,
    account_id: String,
    native_id: String,
) -> Result<LocalEvidence, String> {
    let canonical_root = fs::canonicalize(root)
        .map_err(|_| "The selected provider account directory is unavailable".to_string())?;
    let scan = scan_for_transcript(&canonical_root, &provider, &native_id)?;
    let path = scan
        .candidate
        .ok_or_else(|| {
            "No matching native transcript was found in this provider account".to_string()
        })?;
    let read = read_bounded_file(&path)?;
    let mut truncated = read.truncated;

    let header = read_header_identity(&provider, &read.head.bytes, &native_id);
    match header {
        HeaderIdentity::Match => {}
        HeaderIdentity::Missing => {
            return Err("The transcript does not contain a supported native identity header".into())
        }
        HeaderIdentity::Mismatch => {
            return Err("The transcript identity does not match the requested native session".into())
        }
    }

    let mut stats = ParseStats::default();
    parse_segment(&provider, &native_id, &read.head, &mut stats);
    if let Some(tail) = read.tail.as_ref() {
        parse_segment(&provider, &native_id, tail, &mut stats);
    }

    let mut limitations = scan.limitations;
    limitations.extend(stats.limitations);
    if read.file_bytes > read.read_bytes {
        limitations.insert("headAndTailReadOnly");
        truncated = true;
    }
    if stats.partial_lines > 0 {
        limitations.insert("incompleteLinesSkipped");
        truncated = true;
    }
    if stats.malformed_lines > 0 {
        limitations.insert("malformedLinesSkipped");
    }
    if read.changed_during_read {
        limitations.insert("fileChangedDuringRead");
        truncated = true;
    }
    if stats.stopped {
        truncated = true;
    }

    Ok(LocalEvidence {
        provider,
        native_id,
        account_id,
        source: SOURCE,
        observed_at: now_millis(),
        file_bytes: read.file_bytes,
        read_bytes: read.read_bytes,
        truncated,
        changed_during_read: read.changed_during_read,
        malformed_lines: stats.malformed_lines,
        partial_lines: stats.partial_lines,
        limitations: limitations.into_iter().map(str::to_string).collect(),
        measurements: stats.measurements,
    })
}

fn scan_for_transcript(
    canonical_root: &Path,
    provider: &Provider,
    native_id: &str,
) -> Result<CandidateScan, String> {
    let deadline = Instant::now() + MAX_SCAN_TIME;
    let mut stack = Vec::<(PathBuf, usize)>::new();
    let mut limitations = BTreeSet::new();
    let mut incomplete = false;

    let allowed_roots: &[&str] = match provider {
        Provider::Claude => &["projects"],
        Provider::Codex => &["sessions", "archived_sessions"],
    };
    for directory in allowed_roots {
        let path = canonical_root.join(directory);
        match safe_canonical_path(&path, canonical_root) {
            Some(path) if fs::metadata(&path).is_ok_and(|metadata| metadata.is_dir()) => {
                stack.push((path, 0));
            }
            Some(_) => {}
            None if fs::symlink_metadata(&path).is_ok() => {
                limitations.insert("providerDirectorySkipped");
                incomplete = true;
            }
            None => {}
        }
    }

    let mut entries_seen = 0usize;
    let mut candidate = None;
    while let Some((directory, depth)) = stack.pop() {
        if Instant::now() >= deadline {
            limitations.insert("scanTimeLimitReached");
            incomplete = true;
            break;
        }
        let directory = match safe_canonical_path(&directory, canonical_root) {
            Some(path) => path,
            None => {
                limitations.insert("linkedDirectorySkipped");
                incomplete = true;
                continue;
            }
        };
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => {
                limitations.insert("unreadableDirectorySkipped");
                incomplete = true;
                continue;
            }
        };
        for entry in entries {
            if entries_seen >= MAX_SCAN_ENTRIES {
                limitations.insert("scanEntryLimitReached");
                incomplete = true;
                break;
            }
            if Instant::now() >= deadline {
                limitations.insert("scanTimeLimitReached");
                incomplete = true;
                break;
            }
            entries_seen += 1;
            let Ok(entry) = entry else {
                limitations.insert("unreadableEntrySkipped");
                incomplete = true;
                continue;
            };
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                limitations.insert("unreadableEntrySkipped");
                incomplete = true;
                continue;
            };
            if file_type.is_symlink() || is_reparse_point_path(&path) {
                limitations.insert("linkedEntrySkipped");
                incomplete = true;
                continue;
            }
            if file_type.is_dir() {
                if *provider == Provider::Claude && entry.file_name() == "subagents" {
                    continue;
                }
                if depth >= MAX_SCAN_DEPTH {
                    limitations.insert("scanDepthLimitReached");
                    incomplete = true;
                    continue;
                }
                if safe_canonical_path(&path, canonical_root).is_some() {
                    stack.push((path, depth + 1));
                } else {
                    limitations.insert("linkedDirectorySkipped");
                    incomplete = true;
                }
                continue;
            }
            if !file_type.is_file()
                || !matches_transcript_name(provider, &entry.file_name(), native_id)
            {
                continue;
            }
            let Some(canonical_path) = safe_canonical_path(&path, canonical_root) else {
                limitations.insert("linkedEntrySkipped");
                incomplete = true;
                continue;
            };
            let Ok(metadata) = fs::metadata(&canonical_path) else {
                limitations.insert("unreadableEntrySkipped");
                incomplete = true;
                continue;
            };
            if !metadata.is_file() {
                continue;
            }
            if candidate.is_some() {
                return Err("More than one native transcript matched this identity".into());
            }
            candidate = Some(canonical_path);
        }
        if entries_seen >= MAX_SCAN_ENTRIES {
            break;
        }
        if Instant::now() >= deadline {
            break;
        }
    }

    if incomplete {
        return Err("The bounded provider transcript scan was incomplete".into());
    }
    Ok(CandidateScan {
        candidate,
        limitations,
    })
}

fn matches_transcript_name(
    provider: &Provider,
    file_name: &std::ffi::OsStr,
    native_id: &str,
) -> bool {
    let Some(file_name) = file_name.to_str() else {
        return false;
    };
    match provider {
        Provider::Claude => file_name == format!("{native_id}.jsonl"),
        Provider::Codex => file_name.ends_with(&format!("{native_id}.jsonl")),
    }
}

fn safe_canonical_path(path: &Path, canonical_root: &Path) -> Option<PathBuf> {
    if is_reparse_point_path(path) {
        return None;
    }
    let canonical = fs::canonicalize(path).ok()?;
    canonical.starts_with(canonical_root).then_some(canonical)
}

fn is_reparse_point_path(path: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    metadata.file_type().is_symlink() || metadata_is_reparse_point(&metadata)
}

#[cfg(windows)]
fn metadata_is_reparse_point(metadata: &Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn metadata_is_reparse_point(_metadata: &Metadata) -> bool {
    false
}

fn read_bounded_file(path: &Path) -> Result<BoundedRead, String> {
    let mut file = open_file_without_following_reparse_point(path)
        .map_err(|_| "Could not open the selected native transcript".to_string())?;
    let before = file
        .metadata()
        .map_err(|_| "Could not inspect the selected native transcript".to_string())?;
    if !before.is_file() || metadata_is_reparse_point(&before) {
        return Err("The selected native transcript is not a regular file".into());
    }
    let file_bytes = before.len();
    let mut read_bytes = 0u64;
    let mut head_length = usize::try_from(file_bytes.min(MAX_READ_BYTES as u64))
        .unwrap_or(MAX_READ_BYTES);
    let mut tail = None;

    if file_bytes > MAX_READ_BYTES as u64 {
        head_length = HEAD_READ_BYTES;
    }
    let head_bytes = read_segment(&mut file, 0, head_length)?;
    read_bytes += head_bytes.len() as u64;
    let head = TextSegment {
        bytes: head_bytes,
        starts_at_file_start: true,
        preceding_byte: None,
    };

    if file_bytes > MAX_READ_BYTES as u64 {
        let tail_length = MAX_READ_BYTES - HEAD_READ_BYTES - 1;
        let tail_offset = file_bytes.saturating_sub(tail_length as u64);
        let marker_offset = tail_offset.saturating_sub(1);
        let tail_window = read_segment(&mut file, marker_offset, tail_length + 1)?;
        read_bytes += tail_window.len() as u64;
        let preceding_byte = tail_window.first().copied();
        tail = Some(TextSegment {
            bytes: tail_window.get(1..).unwrap_or_default().to_vec(),
            starts_at_file_start: false,
            preceding_byte,
        });
    }

    let after = file
        .metadata()
        .map_err(|_| "Could not inspect the selected native transcript".to_string())?;
    let expected_read_bytes = file_bytes.min(MAX_READ_BYTES as u64);
    let changed = metadata_changed(&before, &after) || read_bytes != expected_read_bytes;
    Ok(BoundedRead {
        file_bytes,
        read_bytes,
        truncated: file_bytes > read_bytes,
        changed_during_read: changed,
        head,
        tail,
    })
}

fn open_file_without_following_reparse_point(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    options.open(path)
}

fn read_segment(file: &mut File, offset: u64, limit: usize) -> Result<Vec<u8>, String> {
    file.seek(SeekFrom::Start(offset))
        .map_err(|_| "Could not seek within the selected native transcript".to_string())?;
    let mut bytes = Vec::with_capacity(limit);
    (&mut *file)
        .take(limit as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read the selected native transcript".to_string())?;
    Ok(bytes)
}

fn metadata_changed(before: &Metadata, after: &Metadata) -> bool {
    if before.len() != after.len() {
        return true;
    }
    match (before.modified(), after.modified()) {
        (Ok(before), Ok(after)) => before != after,
        _ => true,
    }
}

fn read_header_identity(provider: &Provider, head: &[u8], native_id: &str) -> HeaderIdentity {
    let mut result = HeaderIdentity::Missing;
    let mut header_lines = 0usize;
    {
        let mut process = |line: &[u8]| {
            header_lines += 1;
            if header_lines > MAX_HEADER_LINES || line.len() > MAX_LINE_BYTES {
                return false;
            }
            let Ok(value) = serde_json::from_slice::<Value>(line) else {
                return true;
            };
            let identity = match provider {
                Provider::Claude => value.get("sessionId").and_then(Value::as_str),
                Provider::Codex => {
                    if value.get("type").and_then(Value::as_str) == Some("session_meta") {
                        value
                            .get("payload")
                            .and_then(|payload| payload.get("id"))
                            .and_then(Value::as_str)
                    } else {
                        None
                    }
                }
            };
            if let Some(identity) = identity {
                if identity != native_id {
                    result = HeaderIdentity::Mismatch;
                    return false;
                }
                result = HeaderIdentity::Match;
            }
            true
        };
        let _ = visit_complete_lines(head, true, None, &mut process);
    }
    result
}

fn parse_segment(
    provider: &Provider,
    native_id: &str,
    segment: &TextSegment,
    stats: &mut ParseStats,
) {
    if stats.stopped {
        return;
    }
    let line_stats = {
        let mut process = |line: &[u8]| {
            if stats.lines_seen >= MAX_LINES {
                stats.limitations.insert("lineLimitReached");
                stats.stopped = true;
                return false;
            }
            stats.lines_seen += 1;
            if line.len() > MAX_LINE_BYTES {
                stats.malformed_lines = stats.malformed_lines.saturating_add(1);
                stats.limitations.insert("oversizedLineSkipped");
                return true;
            }
            let trimmed = trim_ascii(line);
            if trimmed.is_empty() {
                return true;
            }
            let value = match serde_json::from_slice::<Value>(trimmed) {
                Ok(value) => value,
                Err(_) => {
                    stats.malformed_lines = stats.malformed_lines.saturating_add(1);
                    return true;
                }
            };
            let continue_parsing = match provider {
                Provider::Claude => parse_claude_record(native_id, &value, stats),
                Provider::Codex => parse_codex_record(&value, stats),
            };
            if !continue_parsing {
                stats.stopped = true;
            }
            continue_parsing
        };
        visit_complete_lines(
            &segment.bytes,
            segment.starts_at_file_start,
            segment.preceding_byte,
            &mut process,
        )
    };
    stats.partial_lines = stats.partial_lines.saturating_add(line_stats.partial_lines);
    if line_stats.stopped {
        stats.stopped = true;
    }
}

#[derive(Debug, Default)]
struct LineVisit {
    partial_lines: u32,
    stopped: bool,
}

fn visit_complete_lines<F>(
    bytes: &[u8],
    starts_at_file_start: bool,
    preceding_byte: Option<u8>,
    visit: &mut F,
) -> LineVisit
where
    F: FnMut(&[u8]) -> bool,
{
    let mut result = LineVisit::default();
    let mut first = 0usize;
    if !starts_at_file_start && preceding_byte != Some(b'\n') {
        match bytes.iter().position(|byte| *byte == b'\n') {
            Some(newline) => {
                result.partial_lines = result.partial_lines.saturating_add(1);
                first = newline + 1;
            }
            None if !bytes.is_empty() => {
                result.partial_lines = result.partial_lines.saturating_add(1);
                return result;
            }
            None => return result,
        }
    }

    let mut line_start = first;
    while let Some(relative_newline) = bytes[line_start..].iter().position(|byte| *byte == b'\n') {
        let newline = line_start + relative_newline;
        if !visit(&bytes[line_start..newline]) {
            result.stopped = true;
            return result;
        }
        line_start = newline + 1;
    }
    if line_start < bytes.len() {
        result.partial_lines = result.partial_lines.saturating_add(1);
    }
    result
}

fn trim_ascii(mut bytes: &[u8]) -> &[u8] {
    while bytes.first().is_some_and(u8::is_ascii_whitespace) {
        bytes = &bytes[1..];
    }
    while bytes.last().is_some_and(u8::is_ascii_whitespace) {
        bytes = &bytes[..bytes.len() - 1];
    }
    bytes
}

fn parse_claude_record(native_id: &str, value: &Value, stats: &mut ParseStats) -> bool {
    let kind = value.get("type").and_then(Value::as_str).unwrap_or_default();
    if !matches!(kind, "assistant" | "result") {
        return true;
    }
    if value.get("sessionId").and_then(Value::as_str) != Some(native_id) {
        stats.limitations.insert("recordIdentityMismatchSkipped");
        return true;
    }
    let timestamp = safe_timestamp(value.get("timestamp").and_then(Value::as_str));
    if kind == "assistant" {
        let Some(message) = value.get("message") else {
            return true;
        };
        let Some(message_id) = message.get("id").and_then(Value::as_str) else {
            stats.limitations.insert("assistantMessageIdentityMissing");
            return true;
        };
        if !is_safe_identifier(message_id) {
            stats.limitations.insert("assistantMessageIdentityInvalid");
            return true;
        }
        let Some(usage) = message.get("usage") else {
            return true;
        };
        let measurement = measurement_from_claude_usage(
            format!("claude-message:{message_id}"),
            timestamp,
            safe_model(message.get("model").and_then(Value::as_str)),
            MeasurementScope::Message,
            usage,
        );
        if let Some(measurement) = measurement {
            if let Some(index) = stats.seen_message_ids.get(message_id).copied() {
                stats.measurements[index] = measurement;
            } else {
                if !push_measurement(stats, measurement) {
                    return false;
                }
                stats
                    .seen_message_ids
                    .insert(message_id.to_string(), stats.measurements.len() - 1);
            }
        }
        return true;
    }

    let Some(usage) = value.get("usage") else {
        return true;
    };
    let trusted_result_id = value
        .get("uuid")
        .or_else(|| value.get("id"))
        .and_then(Value::as_str)
        .and_then(canonical_uuid);
    let result_identity = trusted_result_id.as_ref().map_or_else(
        || {
            stats.limitations.insert("sdkResultIdentityMissing");
            format!("claude-sdk-result-unidentified-{}", stats.claude_results + 1)
        },
        |uuid| format!("claude-sdk-result:{uuid}"),
    );
    if let Some(measurement) = measurement_from_claude_usage(
        result_identity,
        timestamp,
        safe_model(value.get("model").and_then(Value::as_str)),
        MeasurementScope::SdkResult,
        usage,
    ) {
        if let Some(result_id) = trusted_result_id {
            if let Some(index) = stats.seen_sdk_result_ids.get(&result_id).copied() {
                stats.measurements[index] = measurement;
            } else {
                if !push_measurement(stats, measurement) {
                    return false;
                }
                stats
                    .seen_sdk_result_ids
                    .insert(result_id, stats.measurements.len() - 1);
            }
        } else {
            if !push_measurement(stats, measurement) {
                return false;
            }
        }
        stats.claude_results += 1;
    }
    true
}

fn measurement_from_claude_usage(
    identity: String,
    timestamp: Option<String>,
    model: Option<String>,
    scope: MeasurementScope,
    usage: &Value,
) -> Option<EvidenceMeasurement> {
    let uncached_input = safe_count(usage.get("input_tokens"));
    let output = safe_count(usage.get("output_tokens"));
    let cache_read = safe_count(usage.get("cache_read_input_tokens"));
    let cache_write = safe_count(usage.get("cache_creation_input_tokens"));
    let cache_creation = usage.get("cache_creation");
    let cache_write_5m = safe_count(
        cache_creation.and_then(|value| value.get("ephemeral_5m_input_tokens")),
    );
    let cache_write_1h = safe_count(
        cache_creation.and_then(|value| value.get("ephemeral_1h_input_tokens")),
    );
    if uncached_input.is_none()
        && output.is_none()
        && cache_read.is_none()
        && cache_write.is_none()
        && cache_write_5m.is_none()
        && cache_write_1h.is_none()
    {
        return None;
    }
    Some(EvidenceMeasurement {
        identity,
        timestamp,
        scope,
        model,
        uncached_input,
        input: None,
        output,
        cache_read,
        cache_write,
        cache_write_5m,
        cache_write_1h,
        reasoning: None,
        cost_usd: None,
    })
}

fn parse_codex_record(value: &Value, stats: &mut ParseStats) -> bool {
    if value.get("type").and_then(Value::as_str) != Some("event_msg") {
        return true;
    }
    let Some(payload) = value.get("payload") else {
        return true;
    };
    if payload.get("type").and_then(Value::as_str) != Some("token_count") {
        return true;
    }
    let Some(info) = payload.get("info") else {
        return true;
    };
    let timestamp = safe_timestamp(value.get("timestamp").and_then(Value::as_str));
    for (usage_key, scope, suffix) in [
        ("total_token_usage", MeasurementScope::SessionCumulative, "total"),
        ("last_token_usage", MeasurementScope::LastResponse, "last"),
    ] {
        let Some(usage) = info.get(usage_key) else {
            continue;
        };
        let Some(measurement) = measurement_from_codex_usage(
            format!("codex-token-count-{}-{suffix}", stats.codex_records + 1),
            timestamp.clone(),
            scope,
            usage,
        ) else {
            continue;
        };
        let fingerprint = CodexMeasurementFingerprint {
            scope: measurement.scope,
            timestamp: measurement.timestamp.clone(),
            input: measurement.input,
            cache_read: measurement.cache_read,
            output: measurement.output,
            reasoning: measurement.reasoning,
        };
        if !stats.seen_codex_measurements.insert(fingerprint) {
            continue;
        }
        if !push_measurement(stats, measurement) {
            return false;
        }
    }
    stats.codex_records += 1;
    true
}

fn measurement_from_codex_usage(
    identity: String,
    timestamp: Option<String>,
    scope: MeasurementScope,
    usage: &Value,
) -> Option<EvidenceMeasurement> {
    let input = safe_count(usage.get("input_tokens"));
    let cache_read = safe_count(usage.get("cached_input_tokens"));
    let uncached_input = input
        .zip(cache_read)
        .and_then(|(input, cached)| input.checked_sub(cached));
    let output = safe_count(usage.get("output_tokens"));
    let reasoning = safe_count(usage.get("reasoning_output_tokens"));
    if input.is_none() && cache_read.is_none() && output.is_none() && reasoning.is_none() {
        return None;
    }
    Some(EvidenceMeasurement {
        identity,
        timestamp,
        scope,
        model: None,
        uncached_input,
        input,
        output,
        cache_read,
        cache_write: None,
        cache_write_5m: None,
        cache_write_1h: None,
        reasoning,
        cost_usd: None,
    })
}

fn push_measurement(stats: &mut ParseStats, measurement: EvidenceMeasurement) -> bool {
    if stats.measurements.len() >= MAX_MEASUREMENTS {
        stats.limitations.insert("measurementLimitReached");
        return false;
    }
    stats.measurements.push(measurement);
    true
}

fn canonical_uuid(value: &str) -> Option<String> {
    if value.len() != 36 {
        return None;
    }
    let parsed = uuid::Uuid::parse_str(value).ok()?;
    let canonical = parsed.hyphenated().to_string();
    canonical.eq_ignore_ascii_case(value).then_some(canonical)
}

fn safe_count(value: Option<&Value>) -> Option<u64> {
    value
        .and_then(Value::as_u64)
        .filter(|count| *count <= MAX_SAFE_JSON_INTEGER)
}

fn is_safe_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_NATIVE_ID_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn safe_model(model: Option<&str>) -> Option<String> {
    let model = model?;
    (!model.is_empty()
        && model.len() <= 128
        && model
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte)))
    .then(|| model.to_string())
}

fn safe_timestamp(timestamp: Option<&str>) -> Option<String> {
    let timestamp = timestamp?;
    (!timestamp.is_empty()
        && timestamp.len() <= 64
        && timestamp.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || b"-+:.TZ".contains(&byte)
        }))
    .then(|| timestamp.to_string())
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests;
