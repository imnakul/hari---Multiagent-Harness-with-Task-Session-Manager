use super::*;
use serde_json::json;
use std::fs;

#[test]
fn saved_identity_reads_only_bounded_columns_without_parsing_or_changing_transcripts() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE sessions (id TEXT PRIMARY KEY, harness TEXT,
         provider_session_id TEXT, provider_account_id TEXT, blocks_json TEXT);
         INSERT INTO sessions VALUES ('chat', 'claude', 'native-session',
         'profile-2', 'private malformed transcript');",
    )
    .unwrap();
    let identity = session_identity(&conn, "chat").unwrap();
    assert_eq!(identity.provider, Provider::Claude);
    assert_eq!(identity.native_id, "native-session");
    assert_eq!(identity.account_id, "profile-2");
    let serialized = serde_json::to_string(&identity).unwrap();
    assert!(!serialized.contains("private"));
    assert!(!serialized.contains("blocks"));
    let transcript: String = conn
        .query_row("SELECT blocks_json FROM sessions WHERE id='chat'", [], |row| row.get(0))
        .unwrap();
    assert_eq!(transcript, "private malformed transcript");
}

#[test]
fn saved_identity_rejects_missing_unsupported_and_oversized_metadata() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE sessions (id TEXT PRIMARY KEY, harness TEXT,
         provider_session_id TEXT, provider_account_id TEXT);",
    )
    .unwrap();
    assert!(session_identity(&conn, "missing").is_err());
    conn.execute(
        "INSERT INTO sessions VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params!["chat", "unsupported", "native-session", "default"],
    )
    .unwrap();
    assert!(session_identity(&conn, "chat").is_err());
    conn.execute("UPDATE sessions SET harness='codex', provider_account_id=?1", ["x".repeat(81)])
        .unwrap();
    assert!(session_identity(&conn, "chat").is_err());
    assert!(session_identity(&conn, "../credentials").is_err());
}

struct TestDir(PathBuf);

impl TestDir {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "monocode-debug-inspector-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

const NATIVE_ID: &str = "native-session-1";
const MESSAGE_ID: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

fn write_claude_transcript(root: &Path, relative: &str, contents: &str) -> PathBuf {
    let path = root.join("projects").join(relative).join(format!("{NATIVE_ID}.jsonl"));
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, contents).unwrap();
    path
}

fn claude_header(session_id: &str) -> String {
    format!(
        "{}\n",
        json!({
            "type": "user",
            "sessionId": session_id,
            "message": {"role": "user", "content": "private prompt"}
        })
    )
}

fn claude_assistant(session_id: &str, message_id: &str, input_tokens: u64) -> String {
    format!(
        "{}\n",
        json!({
            "type": "assistant",
            "sessionId": session_id,
            "timestamp": "2026-10-12T10:11:12.123Z",
            "message": {
                "id": message_id,
                "model": "claude-sonnet-4-5",
                "content": [{"type": "text", "text": "private response"}],
                "usage": {
                    "input_tokens": input_tokens,
                    "output_tokens": 23,
                    "cache_read_input_tokens": 17,
                    "cache_creation_input_tokens": 11,
                    "cache_creation": {
                        "ephemeral_5m_input_tokens": 7,
                        "ephemeral_1h_input_tokens": 4
                    }
                }
            }
        })
    )
}

fn claude_result(session_id: &str, uuid: Option<&str>, input_tokens: u64) -> String {
    let mut record = json!({
        "type": "result",
        "sessionId": session_id,
        "timestamp": "2026-10-12T10:11:12.123Z",
        "model": "claude-sonnet-4-5",
        "usage": {
            "input_tokens": input_tokens,
            "output_tokens": 23
        }
    });
    if let Some(uuid) = uuid {
        record["uuid"] = json!(uuid);
    }
    format!("{record}\n")
}

fn read_claude(root: &Path, native_id: &str) -> Result<LocalEvidence, String> {
    read_local_evidence(
        root,
        Provider::Claude,
        "default".to_string(),
        native_id.to_string(),
    )
}

#[test]
fn native_ids_are_ascii_and_bounded_to_128_bytes() {
    assert!(validate_native_id(&"a".repeat(128)).is_ok());
    assert!(validate_native_id(&"a".repeat(129)).is_err());
    assert!(validate_native_id("../outside").is_err());
    assert!(validate_native_id("é").is_err());
    assert!(validate_native_id("").is_err());
}

#[test]
fn claude_usage_is_allowlisted_deduplicated_and_partial_lines_are_excluded() {
    let temp = TestDir::new();
    let mut contents = claude_header(NATIVE_ID);
    contents.push_str(&claude_assistant(NATIVE_ID, MESSAGE_ID, 31));
    contents.push_str(&claude_assistant(NATIVE_ID, MESSAGE_ID, 999));
    contents.push_str("{malformed transcript row}\n");
    contents.push_str(&claude_assistant(NATIVE_ID, "unfinished-message", 88).trim_end());
    write_claude_transcript(temp.path(), "project-a", &contents);

    let evidence = read_claude(temp.path(), NATIVE_ID).unwrap();
    assert_eq!(evidence.measurements.len(), 1);
    assert_eq!(evidence.measurements[0].identity, format!("claude-message:{MESSAGE_ID}"));
    assert_eq!(evidence.measurements[0].uncached_input, Some(999));
    assert_eq!(evidence.measurements[0].cache_read, Some(17));
    assert_eq!(evidence.measurements[0].cache_write, Some(11));
    assert_eq!(evidence.measurements[0].cache_write_5m, Some(7));
    assert_eq!(evidence.measurements[0].cache_write_1h, Some(4));
    assert_eq!(evidence.malformed_lines, 1);
    assert_eq!(evidence.partial_lines, 1);
    assert!(evidence.truncated);

    let serialized = serde_json::to_string(&evidence).unwrap();
    assert!(!serialized.contains("private prompt"));
    assert!(!serialized.contains("private response"));
    let temp_path = temp.path().to_string_lossy().into_owned();
    let serialized_path = serde_json::to_string(&temp_path).unwrap();
    assert!(!serialized.contains(serialized_path.as_str()));
    let output = serde_json::from_str::<Value>(&serialized).unwrap();
    assert_eq!(output["source"].as_str(), Some(SOURCE));
}

#[test]
fn claude_result_snapshots_reconcile_by_uuid_and_unidentified_snapshots_are_labeled() {
    let temp = TestDir::new();
    let result_id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    let mut contents = claude_header(NATIVE_ID);
    contents.push_str(&claude_result(NATIVE_ID, Some(result_id), 31));
    contents.push_str(&claude_result(NATIVE_ID, Some(result_id), 999));
    contents.push_str(&claude_result(NATIVE_ID, Some("not-a-uuid"), 77));
    contents.push_str(&claude_result(NATIVE_ID, None, 88));
    write_claude_transcript(temp.path(), "project-a", &contents);

    let evidence = read_claude(temp.path(), NATIVE_ID).unwrap();
    assert_eq!(evidence.measurements.len(), 3);
    assert_eq!(evidence.measurements[0].identity, format!("claude-sdk-result:{result_id}"));
    assert_eq!(evidence.measurements[0].uncached_input, Some(999));
    assert!(evidence.measurements[1]
        .identity
        .starts_with("claude-sdk-result-unidentified-"));
    assert!(evidence.measurements[2]
        .identity
        .starts_with("claude-sdk-result-unidentified-"));
    assert!(evidence.measurements[1..]
        .iter()
        .all(|measurement| measurement.scope == MeasurementScope::SdkResult));
    assert!(evidence
        .measurements
        .iter()
        .all(|measurement| measurement.identity.len() <= 256));
    assert!(evidence
        .limitations
        .iter()
        .any(|limitation| limitation == "sdkResultIdentityMissing"));
}

#[test]
fn transcript_identity_must_match_and_must_be_present_in_the_header() {
    let wrong = TestDir::new();
    write_claude_transcript(
        wrong.path(),
        "project-a",
        &claude_header("another-session"),
    );
    assert!(read_claude(wrong.path(), NATIVE_ID)
        .unwrap_err()
        .contains("identity does not match"));

    let missing = TestDir::new();
    let contents = format!("{}\n", json!({"type": "user", "message": {"role": "user"}}));
    write_claude_transcript(missing.path(), "project-a", &contents);
    assert!(read_claude(missing.path(), NATIVE_ID)
        .unwrap_err()
        .contains("identity header"));
}

#[test]
fn account_roots_are_isolated_and_duplicate_native_transcripts_fail_closed() {
    let first_account = TestDir::new();
    let second_account = TestDir::new();
    write_claude_transcript(
        first_account.path(),
        "project-a",
        &(claude_header(NATIVE_ID) + &claude_assistant(NATIVE_ID, MESSAGE_ID, 41)),
    );
    write_claude_transcript(
        second_account.path(),
        "project-b",
        &(claude_header(NATIVE_ID) + &claude_assistant(NATIVE_ID, MESSAGE_ID, 92)),
    );

    let first = read_claude(first_account.path(), NATIVE_ID).unwrap();
    let second = read_claude(second_account.path(), NATIVE_ID).unwrap();
    assert_eq!(first.measurements[0].uncached_input, Some(41));
    assert_eq!(second.measurements[0].uncached_input, Some(92));

    write_claude_transcript(
        first_account.path(),
        "project-c",
        &claude_header(NATIVE_ID),
    );
    assert!(read_claude(first_account.path(), NATIVE_ID)
        .unwrap_err()
        .contains("More than one"));
}

#[test]
fn codex_cumulative_and_last_response_snapshots_remain_separate() {
    let temp = TestDir::new();
    let sessions = temp.path().join("sessions").join("2026").join("10");
    fs::create_dir_all(&sessions).unwrap();
    let path = sessions.join(format!("rollout-{NATIVE_ID}.jsonl"));
    let token_count_event = json!({
            "type": "event_msg",
            "timestamp": "2026-10-12T10:11:12Z",
            "payload": {
                "type": "token_count",
                "info": {
                    "total_token_usage": {
                        "input_tokens": 120,
                        "cached_input_tokens": 70,
                        "output_tokens": 31,
                        "reasoning_output_tokens": 9
                    },
                    "last_token_usage": {
                        "input_tokens": 30,
                        "cached_input_tokens": 20,
                        "output_tokens": 11,
                        "reasoning_output_tokens": 3
                    }
                }
            }
        });
    let transcript = format!(
        "{}\n{}\n{}\n",
        json!({
            "type": "session_meta",
            "payload": {"id": NATIVE_ID, "cwd": "private/path"}
        }),
        token_count_event,
        token_count_event,
    );
    fs::write(&path, transcript).unwrap();

    let evidence = read_local_evidence(
        temp.path(),
        Provider::Codex,
        "default".to_string(),
        NATIVE_ID.to_string(),
    )
    .unwrap();
    assert_eq!(evidence.measurements.len(), 2);
    assert_eq!(
        evidence.measurements[0].scope,
        MeasurementScope::SessionCumulative
    );
    assert_eq!(evidence.measurements[0].input, Some(120));
    assert_eq!(evidence.measurements[0].uncached_input, Some(50));
    assert_eq!(evidence.measurements[0].output, Some(31));
    assert_eq!(
        evidence.measurements[1].scope,
        MeasurementScope::LastResponse
    );
    assert_eq!(evidence.measurements[1].input, Some(30));
    assert_eq!(evidence.measurements[1].uncached_input, Some(10));
    assert!(!serde_json::to_string(&evidence)
        .unwrap()
        .contains("private/path"));

    let rescanned = read_local_evidence(
        temp.path(),
        Provider::Codex,
        "default".to_string(),
        NATIVE_ID.to_string(),
    )
    .unwrap();
    assert_eq!(evidence.measurements, rescanned.measurements);
}

#[test]
fn oversized_lines_and_large_files_stay_within_the_read_and_record_bounds() {
    let temp = TestDir::new();
    let mut contents = claude_header(NATIVE_ID);
    contents.push_str(&format!(
        "{{\"type\":\"user\",\"sessionId\":\"{NATIVE_ID}\",\"pad\":\"{}\"}}\n",
        "x".repeat(MAX_LINE_BYTES + 1)
    ));
    contents.push_str(&format!("{}\n", "y".repeat(MAX_READ_BYTES + 100)));
    contents.push_str(&claude_assistant(NATIVE_ID, MESSAGE_ID, 31));
    write_claude_transcript(temp.path(), "project-a", &contents);

    let evidence = read_claude(temp.path(), NATIVE_ID).unwrap();
    assert!(evidence.file_bytes > MAX_READ_BYTES as u64);
    assert_eq!(evidence.read_bytes, MAX_READ_BYTES as u64);
    assert!(evidence.truncated);
    assert!(evidence.malformed_lines >= 1);
    assert!(evidence.limitations.iter().any(|item| item == "oversizedLineSkipped"));
    assert!(evidence.measurements.len() <= MAX_MEASUREMENTS);
}

#[test]
fn measurement_retention_stops_at_one_thousand_records() {
    let temp = TestDir::new();
    let mut contents = claude_header(NATIVE_ID);
    for index in 0..=MAX_MEASUREMENTS {
        contents.push_str(&claude_assistant(
            NATIVE_ID,
            &format!("message-{index}"),
            index as u64,
        ));
    }
    write_claude_transcript(temp.path(), "project-a", &contents);

    let evidence = read_claude(temp.path(), NATIVE_ID).unwrap();
    assert_eq!(evidence.measurements.len(), MAX_MEASUREMENTS);
    assert!(evidence
        .measurements
        .iter()
        .all(|measurement| measurement.identity.len() <= 256));
    assert!(evidence.truncated);
    assert!(evidence
        .limitations
        .iter()
        .any(|item| item == "measurementLimitReached"));
}

#[test]
fn metadata_comparison_marks_a_transcript_changed_during_read() {
    let temp = TestDir::new();
    let path = temp.path().join("transcript.jsonl");
    fs::write(&path, "before").unwrap();
    let before = fs::metadata(&path).unwrap();
    fs::write(&path, "after changed").unwrap();
    let after = fs::metadata(&path).unwrap();
    assert!(metadata_changed(&before, &after));
}

#[cfg(unix)]
#[test]
fn linked_project_directories_make_scan_inconclusive_even_with_a_candidate() {
    use std::os::unix::fs::symlink;

    let root = TestDir::new();
    let outside = TestDir::new();
    write_claude_transcript(root.path(), "project-a", &claude_header(NATIVE_ID));
    write_claude_transcript(outside.path(), "outside", &claude_header(NATIVE_ID));
    let projects = root.path().join("projects");
    fs::create_dir_all(&projects).unwrap();
    symlink(outside.path().join("projects/outside"), projects.join("linked-project")).unwrap();

    assert!(read_claude(root.path(), NATIVE_ID)
        .unwrap_err()
        .contains("scan was incomplete"));
}

#[cfg(windows)]
#[test]
fn linked_project_directories_make_scan_inconclusive_even_with_a_candidate() {
    let root = TestDir::new();
    let outside = TestDir::new();
    write_claude_transcript(root.path(), "project-a", &claude_header(NATIVE_ID));
    write_claude_transcript(outside.path(), "outside", &claude_header(NATIVE_ID));
    let projects = root.path().join("projects");
    fs::create_dir_all(&projects).unwrap();
    let link = projects.join("linked-project");
    junction::create(outside.path().join("projects/outside"), &link).unwrap();

    assert!(read_claude(root.path(), NATIVE_ID)
        .unwrap_err()
        .contains("scan was incomplete"));
}
