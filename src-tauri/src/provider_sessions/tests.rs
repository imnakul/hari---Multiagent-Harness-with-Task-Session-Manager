use super::*;
use std::fs;

struct TestDir(PathBuf);
impl TestDir {
    fn path(&self) -> &Path {
        &self.0
    }
}
impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn setup() -> (TestDir, Connection) {
    let dir = TestDir(
        std::env::temp_dir().join(format!("monocode-provider-test-{}", uuid::Uuid::new_v4())),
    );
    fs::create_dir_all(dir.path()).unwrap();
    let conn = Connection::open_in_memory().unwrap();
    ensure_table(&conn).unwrap();
    (dir, conn)
}

fn claude(root: &Path, id: &str) {
    let dir = root.join("projects").join("-repo");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(format!("{id}.jsonl")), format!("{{\"type\":\"user\",\"sessionId\":\"{id}\",\"cwd\":\"/repo\",\"timestamp\":\"2026-10-04T00:00:00Z\",\"message\":{{\"role\":\"user\",\"content\":\"Keep original context\"}}}}\n")).unwrap();
}

#[test]
fn explicit_lookup_finds_old_archived_chats_and_reuses_native_binding() {
    let (dir, conn) = setup();
    for i in 0..30 {
        claude(dir.path(), &format!("native-{i}"));
    }
    let (rows, diagnostics) = discover_at(Provider::Claude, dir.path(), "work");
    let key = source_key(
        &Provider::Claude,
        &fs::canonicalize(dir.path()).unwrap(),
        "native-29",
    );
    bind(&conn, &key, "existing-mono", "/repo", "work").unwrap();
    set_archive(&conn, &key, true).unwrap();
    let row = resolve_from_rows(&conn, rows, diagnostics, "native-29").unwrap();
    assert_eq!(row.native_id, "native-29");
    assert_eq!(row.provider_account_id, "work");
    assert_eq!(row.monocode_session_id.as_deref(), Some("existing-mono"));
    assert!(row.archived);
    assert_eq!(row.cwd, "/repo");
    // Lookup cannot alter native files or unarchive the chat by itself.
    assert!(
        fs::read_to_string(dir.path().join("projects/-repo/native-29.jsonl"))
            .unwrap()
            .contains("Keep original context")
    );
}

#[test]
fn explicit_lookup_rejects_missing_and_unsafe_ids_without_binding() {
    let (dir, conn) = setup();
    claude(dir.path(), "known");
    let (rows, diagnostics) = discover_at(Provider::Claude, dir.path(), "default");
    assert!(resolve_from_rows(&conn, rows, diagnostics, "missing")
        .unwrap_err()
        .contains("not found"));
    for id in [
        "",
        "../known",
        "--last",
        "https://claude.ai/chat/x",
        "id\0",
        "a b",
    ] {
        assert!(validate_native_id(id).is_err());
    }
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM provider_conversation_state",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
}

#[test]
fn explicit_codex_lookup_supports_database_metadata_without_jsonl() {
    let (dir, conn) = setup();
    let db = Connection::open(dir.path().join("state_5.sqlite")).unwrap();
    db.execute_batch("CREATE TABLE threads(id TEXT, title TEXT, cwd TEXT, updated_at INTEGER); INSERT INTO threads VALUES('codex-native','Original','/repo',42)").unwrap();
    let (rows, diagnostics) = discover_at(Provider::Codex, dir.path(), "default");
    let row = resolve_from_rows(&conn, rows, diagnostics, "codex-native").unwrap();
    assert_eq!(row.provider, Provider::Codex);
    assert_eq!(row.title, "Original");
    assert!(row.monocode_session_id.is_none());
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM threads", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
}

#[test]
fn archive_survives_refresh_without_writing_provider_files() {
    let (dir, conn) = setup();
    claude(dir.path(), "native-one");
    let path = dir.path().join("projects/-repo/native-one.jsonl");
    let original = fs::read(&path).unwrap();
    let first = list_at(&conn, Provider::Claude, dir.path(), "default", false, 20, 0).unwrap();
    assert_eq!(first.conversations.len(), 1);
    let key = &first.conversations[0].key;
    set_archive(&conn, key, true).unwrap();
    assert!(
        list_at(&conn, Provider::Claude, dir.path(), "default", false, 20, 0)
            .unwrap()
            .conversations
            .is_empty()
    );
    let archived = list_at(&conn, Provider::Claude, dir.path(), "default", true, 20, 0).unwrap();
    assert!(archived.conversations[0].archived);
    set_archive(&conn, key, false).unwrap();
    assert_eq!(
        list_at(&conn, Provider::Claude, dir.path(), "default", false, 20, 0)
            .unwrap()
            .conversations
            .len(),
        1
    );
    assert_eq!(fs::read(path).unwrap(), original);
}

#[test]
fn binding_is_atomic_sticky_and_archive_preserves_it() {
    let (dir, conn) = setup();
    let key = source_key(&Provider::Codex, dir.path(), "native");
    assert_eq!(
        bind(&conn, &key, "mono-one", "/repo", "default").unwrap(),
        "mono-one"
    );
    assert_eq!(
        bind(&conn, &key, "mono-two", "/changed", "default").unwrap(),
        "mono-one"
    );
    set_archive(&conn, &key, true).unwrap();
    assert_eq!(
        bind(&conn, &key, "mono-three", "/repo", "default").unwrap(),
        "mono-one"
    );
    assert!(bind(&conn, "bad-key", "mono", "/repo", "default").is_err());
    assert_eq!(
        conn.query_row(
            "SELECT source_cwd FROM provider_conversation_state WHERE source_key=?1",
            [key],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "/repo"
    );
}

#[test]
fn metadata_database_covers_non_jsonl_codex_store_and_deduplicates() {
    let (dir, conn) = setup();
    let db = Connection::open(dir.path().join("state_5.sqlite")).unwrap();
    db.execute_batch("CREATE TABLE threads (id TEXT, title TEXT, cwd TEXT, updated_at INTEGER); INSERT INTO threads VALUES ('native','Paged chat','/repo',42);").unwrap();
    let page = list_at(&conn, Provider::Codex, dir.path(), "default", false, 20, 0).unwrap();
    assert_eq!(page.conversations.len(), 1);
    assert_eq!(page.conversations[0].native_id, "native");
    assert_eq!(page.conversations[0].title, "Paged chat");
    fs::create_dir_all(dir.path().join("sessions")).unwrap();
    fs::write(dir.path().join("sessions/native.jsonl"), "{\"type\":\"session_meta\",\"timestamp\":\"1970-01-01T00:00:01Z\",\"payload\":{\"id\":\"native\",\"cwd\":\"/repo\"}}\n").unwrap();
    let deduplicated =
        list_at(&conn, Provider::Codex, dir.path(), "default", false, 20, 0).unwrap();
    assert_eq!(deduplicated.conversations.len(), 1);
    assert_eq!(deduplicated.conversations[0].title, "Paged chat");
    // Listing did not introduce tables or modify the provider DB.
    assert_eq!(
        db.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
}

#[test]
fn archives_and_original_folder_binding_survive_database_restart() {
    let (dir, _) = setup();
    claude(dir.path(), "restart");
    let db = dir.path().join("monocode.sqlite");
    let conn = Connection::open(&db).unwrap();
    ensure_table(&conn).unwrap();
    let key = list_at(&conn, Provider::Claude, dir.path(), "default", false, 20, 0)
        .unwrap()
        .conversations[0]
        .key
        .clone();
    bind(&conn, &key, "mono-stable", "/repo", "default").unwrap();
    set_archive(&conn, &key, true).unwrap();
    drop(conn);
    let conn = Connection::open(db).unwrap();
    ensure_table(&conn).unwrap();
    assert!(
        list_at(&conn, Provider::Claude, dir.path(), "default", false, 20, 0)
            .unwrap()
            .conversations
            .is_empty()
    );
    let row = list_at(&conn, Provider::Claude, dir.path(), "default", true, 20, 0)
        .unwrap()
        .conversations
        .remove(0);
    assert!(row.archived);
    assert_eq!(row.monocode_session_id.as_deref(), Some("mono-stable"));
    assert_eq!(
        conn.query_row(
            "SELECT source_cwd FROM provider_conversation_state WHERE source_key=?1",
            [key],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "/repo"
    );
}

#[test]
fn provider_list_and_binding_reuse_existing_monocode_chats_and_archives() {
    let (dir, conn) = setup();
    claude(dir.path(), "known");
    conn.execute_batch("CREATE TABLE sessions (id TEXT, harness TEXT, provider_session_id TEXT, cwd TEXT, provider_account_id TEXT, archived INTEGER, updated_at INTEGER);
        INSERT INTO sessions VALUES ('existing-mono','claude','known','/repo',NULL,1,42);
        INSERT INTO sessions VALUES ('other-account','claude','known','/repo','other',0,100);").unwrap();
    assert!(
        list_at(&conn, Provider::Claude, dir.path(), "default", false, 20, 0)
            .unwrap()
            .conversations
            .is_empty()
    );
    let row = list_at(&conn, Provider::Claude, dir.path(), "default", true, 20, 0)
        .unwrap()
        .conversations
        .remove(0);
    assert_eq!(row.monocode_session_id.as_deref(), Some("existing-mono"));
    assert_eq!(
        bind(&conn, &row.key, "new-candidate", "/repo", "default").unwrap(),
        "existing-mono"
    );
    assert!(
        list_at(&conn, Provider::Claude, dir.path(), "default", false, 20, 0)
            .unwrap()
            .conversations
            .is_empty()
    );
    // An explicit MonoCode-only unarchive overrides the old visibility metadata.
    set_archive(&conn, &row.key, false).unwrap();
    assert_eq!(
        list_at(&conn, Provider::Claude, dir.path(), "default", false, 20, 0)
            .unwrap()
            .conversations
            .len(),
        1
    );
}

#[test]
fn native_folder_identity_accepts_windows_spellings_but_preserves_unix() {
    for (left, right) in [
        (r"E:\Developing\Repo\", "e:/developing/repo"),
        (r"\\HOST\Share\Repo", "//host/share/repo/"),
        (r"C:\", "C:"),
        ("/repo/", "/repo"),
    ] {
        assert_eq!(cwd_key(left), cwd_key(right));
    }
    for (left, right) in [
        ("/Repo", "/repo"),
        (r"/repo\sub", "/repo/sub"),
        ("E:/Repo", "F:/Repo"),
        ("//host/share", "//host/other"),
    ] {
        assert_ne!(cwd_key(left), cwd_key(right));
    }
}

#[test]
fn explicit_lookup_and_bind_reuse_windows_folder_identity_only_in_same_profile() {
    for (native_cwd, saved_cwd) in [
        (r"E:\Developing\Repo\", "e:/developing/repo"),
        (r"\\HOST\Share\Repo", "//host/share/repo/"),
        (r"C:\", "C:"),
    ] {
        let (dir, conn) = setup();
        let db = Connection::open(dir.path().join("state_5.sqlite")).unwrap();
        db.execute_batch("CREATE TABLE threads(id TEXT, title TEXT, cwd TEXT, updated_at INTEGER)")
            .unwrap();
        db.execute(
            "INSERT INTO threads VALUES('native','Original',?1,42)",
            [native_cwd],
        )
        .unwrap();
        conn.execute_batch("CREATE TABLE sessions (id TEXT, harness TEXT, provider_session_id TEXT, cwd TEXT, provider_account_id TEXT, archived INTEGER, updated_at INTEGER)").unwrap();
        for (id, provider, cwd, account, updated) in [
            ("existing", "codex", saved_cwd, "default", 42),
            ("other-account", "codex", saved_cwd, "work", 100),
            ("other-folder", "codex", "E:/Elsewhere", "default", 101),
            ("other-harness", "claude", saved_cwd, "default", 102),
        ] {
            conn.execute(
                "INSERT INTO sessions VALUES(?1,?2,'native',?3,?4,0,?5)",
                params![id, provider, cwd, account, updated],
            )
            .unwrap();
        }
        let (rows, diagnostics) = discover_at(Provider::Codex, dir.path(), "default");
        let row = resolve_from_rows(&conn, rows, diagnostics, "native").unwrap();
        assert_eq!(row.monocode_session_id.as_deref(), Some("existing"));
        assert_eq!(
            bind(&conn, &row.key, "candidate", native_cwd, "default").unwrap(),
            "existing"
        );
        assert_eq!(
            conn.query_row("SELECT source_cwd FROM provider_conversation_state WHERE monocode_session_id='existing'", [], |r| r.get::<_, String>(0)).unwrap(),
            native_cwd
        );
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM provider_conversation_state WHERE monocode_session_id='candidate'", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    }
}

#[test]
fn pagination_profiles_and_corrupt_source_are_explicit() {
    let (dir, conn) = setup();
    claude(dir.path(), "one");
    claude(dir.path(), "two");
    fs::write(dir.path().join("projects/-repo/broken.jsonl"), "not json").unwrap();
    let first = list_at(&conn, Provider::Claude, dir.path(), "profile", false, 1, 0).unwrap();
    assert_eq!(first.next_offset, Some(1));
    assert_eq!(first.conversations[0].provider_account_id, "profile");
    assert_eq!(first.diagnostics.len(), 1);
    let second = list_at(&conn, Provider::Claude, dir.path(), "profile", false, 1, 1).unwrap();
    assert_ne!(first.conversations[0].key, second.conversations[0].key);
    assert_eq!(second.next_offset, None);
    let other = source_key(&Provider::Claude, &dir.path().join("other"), "one");
    assert_ne!(first.conversations[0].key, other);
}

#[test]
fn cloud_metadata_rejects_unsafe_urls_and_ids() {
    let mut item = CloudSession {
        provider: Provider::Claude,
        id: "session_one".into(),
        url: "https://claude.ai/code/session_one".into(),
        cwd: "/repo".into(),
        provider_account_id: "default".into(),
        environment_id: None,
        branch: None,
        created_at: 0,
    };
    assert!(validate_cloud(&item).is_ok());
    item.url = "https://claude.ai.evil.test/code/session_one".into();
    assert!(validate_cloud(&item).is_err());
    item.url = "https://user@claude.ai/code/session_one".into();
    assert!(validate_cloud(&item).is_err());
    item.url = "https://claude.ai/code/session_one".into();
    item.id = "--help".into();
    assert!(validate_cloud(&item).is_err());
    // ID validation also lives at the CLI boundary before use as an argument.
    item.id = "bad\nvalue".into();
    assert!(validate_cloud(&item).is_err());
}

#[test]
fn cloud_retention_survives_reopen_and_keeps_first_launch_metadata_per_account() {
    let (dir, _) = setup();
    let db = dir.path().join("monocode.sqlite");
    let conn = Connection::open(&db).unwrap();
    ensure_table(&conn).unwrap();
    let mut item = CloudSession {
        provider: Provider::Codex,
        id: "task_one".into(),
        url: "https://chatgpt.com/codex/tasks/task_one".into(),
        cwd: "/original".into(),
        provider_account_id: "default".into(),
        environment_id: Some("environment_one".into()),
        branch: Some("main".into()),
        created_at: 0,
    };
    let saved = save_cloud(&conn, item.clone()).unwrap();
    assert!(saved.created_at > 0);
    drop(conn);
    let conn = Connection::open(db).unwrap();
    ensure_table(&conn).unwrap();
    item.cwd = "/retry".into();
    let retry = save_cloud(&conn, item.clone()).unwrap();
    assert_eq!(retry.cwd, "/original");
    assert_eq!(retry.created_at, saved.created_at);
    item.provider_account_id = "other".into();
    assert_eq!(save_cloud(&conn, item).unwrap().cwd, "/retry");
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM provider_cloud_sessions", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        2
    );
}

#[test]
fn history_reads_claude_and_codex_files_read_only_and_pages_earlier_chunks() {
    let (dir, _conn) = setup();
    claude(dir.path(), "native-one");
    let path = dir.path().join("projects/-repo/native-one.jsonl");
    let mut lines = String::new();
    for index in 0..40 {
        lines.push_str(&format!(
            "{{\"type\":\"user\",\"message\":{{\"content\":\"line é {index}\"}}}}\n"
        ));
    }
    fs::write(&path, &lines).unwrap();
    let original = fs::read(&path).unwrap();
    let whole =
        read_history_at(dir.path(), &Provider::Claude, "native-one", None, 1 << 20).unwrap();
    assert!(!whole.has_earlier);
    assert_eq!(whole.text, lines);
    let tail = read_history_at(dir.path(), &Provider::Claude, "native-one", None, 300).unwrap();
    assert!(tail.has_earlier);
    assert!(
        tail.text.lines().all(|line| line.ends_with('}')),
        "complete lines only"
    );
    let earlier = read_history_at(
        dir.path(),
        &Provider::Claude,
        "native-one",
        Some(tail.start),
        300,
    )
    .unwrap();
    assert!(!earlier.text.is_empty());
    assert_eq!(
        format!("{}{}", earlier.text, tail.text).lines().count(),
        earlier.text.lines().count() + tail.text.lines().count()
    );
    assert_eq!(fs::read(&path).unwrap(), original);

    let codex = dir.path().join("sessions/2026/10/04");
    fs::create_dir_all(&codex).unwrap();
    fs::write(
        codex.join("rollout-2026-10-04T00-00-00-abc-123.jsonl"),
        "{\"type\":\"response_item\"}\n",
    )
    .unwrap();
    let found = read_history_at(dir.path(), &Provider::Codex, "abc-123", None, 1 << 20).unwrap();
    assert!(found.text.contains("response_item"));
}

#[test]
fn history_reports_missing_files_and_rejects_unsafe_ids() {
    let (dir, _conn) = setup();
    let missing = read_history_at(dir.path(), &Provider::Claude, "nope", None, 100).unwrap_err();
    assert!(missing.contains("No transcript file"));
    assert!(read_history_at(dir.path(), &Provider::Claude, "../etc", None, 100).is_err());
}

#[test]
fn find_filters_full_discovery_before_paging_and_keeps_native_titles() {
    let (dir, conn) = setup();
    for i in 0..25 {
        claude(dir.path(), &format!("native-{i:02}"));
    }
    let (rows, diagnostics) = discover_at(Provider::Claude, dir.path(), "default");
    let filtered = filter_conversations(rows, Some("native-24"), Some("/repo/"));
    let page = page_with_state(&conn, filtered, diagnostics, false, 10, 0).unwrap();
    assert_eq!(page.conversations.len(), 1);
    assert_eq!(page.conversations[0].native_id, "native-24");
    assert_eq!(page.conversations[0].title, "Keep original context");
    assert!(page.next_offset.is_none());
    let (rows, _) = discover_at(Provider::Claude, dir.path(), "default");
    assert!(filter_conversations(rows, None, Some("/different")).is_empty());
}

#[test]
fn find_discovers_and_filters_by_full_claude_saved_title() {
    let (dir, conn) = setup();
    let project = dir.path().join("projects/-repo");
    fs::create_dir_all(&project).unwrap();
    let title = format!("Project: {} searchable-tail", "設計".repeat(80));
    let transcript = [
        serde_json::json!({
            "type": "user",
            "sessionId": "saved-native",
            "cwd": "/repo",
            "timestamp": "2026-10-07T12:34:56Z",
            "message": { "content": "Original first prompt" }
        })
        .to_string(),
        serde_json::json!({
            "type": "summary",
            "sessionId": "saved-native",
            "summary": "Legacy summary",
            "customTitle": title
        })
        .to_string(),
    ]
    .join("\n");
    fs::write(project.join("saved-native.jsonl"), transcript).unwrap();

    let (rows, diagnostics) = discover_at(Provider::Claude, dir.path(), "default");
    let filtered = filter_conversations(rows, Some("searchable-tail"), Some("/repo"));
    let page = page_with_state(&conn, filtered, diagnostics, false, 10, 0).unwrap();
    assert_eq!(page.conversations.len(), 1);
    let conversation = &page.conversations[0];
    assert_eq!(conversation.native_id, "saved-native");
    assert_eq!(conversation.title, title);
    assert_eq!(conversation.updated_at, 1_791_376_496);
    assert!(page.next_offset.is_none());
}

#[test]
fn codex_millisecond_metadata_becomes_seconds_once_without_losing_title() {
    let (dir, conn) = setup();
    let db = Connection::open(dir.path().join("state_5.sqlite")).unwrap();
    db.execute_batch("CREATE TABLE threads(id TEXT, title TEXT, cwd TEXT, updated_at INTEGER, updated_at_ms INTEGER); INSERT INTO threads VALUES('native','Fix the landing page','/repo',100,1791288000123)").unwrap();
    let (rows, diagnostics) = discover_at(Provider::Codex, dir.path(), "default");
    let row = resolve_from_rows(&conn, rows, diagnostics, "native").unwrap();
    assert_eq!(row.updated_at, 1_791_288_000);
    assert_eq!(row.title, "Fix the landing page");
}

#[test]
fn find_project_filter_matches_windows_slashes_without_relaxing_unix_identity() {
    let (dir, _) = setup();
    claude(dir.path(), "native");
    let (mut rows, _) = discover_at(Provider::Claude, dir.path(), "default");
    rows.values_mut().next().unwrap().cwd = r"E:\Developing\Project".into();
    assert_eq!(
        filter_conversations(
            rows.clone(),
            Some("context"),
            Some("e:/developing/project/")
        )
        .len(),
        1
    );
    assert!(filter_conversations(rows, None, Some("e:/developing/other")).is_empty());
}

const CONTINUE_ID: &str = "11111111-2222-4333-8444-555555555555";

fn continue_fixture(root: &Path) -> PathBuf {
    let dir = root.join("projects").join("-repo");
    fs::create_dir_all(dir.join(CONTINUE_ID).join("subagents")).unwrap();
    fs::write(dir.join(format!("{CONTINUE_ID}.jsonl")), "history\n").unwrap();
    fs::write(
        dir.join(CONTINUE_ID).join("subagents").join("a.jsonl"),
        "sub\n",
    )
    .unwrap();
    dir
}

#[test]
fn continue_copies_transcript_and_sibling_folder_under_same_slug() {
    let (from, _c) = setup();
    let (to, _c2) = setup();
    let src = continue_fixture(from.path());
    copy_claude_session_at(from.path(), to.path(), CONTINUE_ID, "/repo").unwrap();
    let dst = to.path().join("projects").join("-repo");
    assert_eq!(
        fs::read(dst.join(format!("{CONTINUE_ID}.jsonl"))).unwrap(),
        fs::read(src.join(format!("{CONTINUE_ID}.jsonl"))).unwrap()
    );
    assert_eq!(
        fs::read_to_string(dst.join(CONTINUE_ID).join("subagents").join("a.jsonl")).unwrap(),
        "sub\n"
    );
    assert!(src.join(format!("{CONTINUE_ID}.jsonl")).is_file());
    assert!(fs::read_dir(&dst).unwrap().all(|e| !e
        .unwrap()
        .file_name()
        .to_string_lossy()
        .contains(".tmp-")));
}

#[test]
fn continue_reuses_identical_and_refuses_different_target() {
    let (from, _c) = setup();
    let (to, _c2) = setup();
    continue_fixture(from.path());
    copy_claude_session_at(from.path(), to.path(), CONTINUE_ID, "/repo").unwrap();
    copy_claude_session_at(from.path(), to.path(), CONTINUE_ID, "/repo").unwrap();
    let target = to
        .path()
        .join("projects")
        .join("-repo")
        .join(format!("{CONTINUE_ID}.jsonl"));
    fs::write(&target, "diverged\n").unwrap();
    let err = copy_claude_session_at(from.path(), to.path(), CONTINUE_ID, "/repo").unwrap_err();
    assert!(err.contains("different version"));
    assert_eq!(fs::read_to_string(&target).unwrap(), "diverged\n");
}

#[test]
fn continue_back_updates_an_older_prefix_copy_and_adds_new_sibling_files() {
    let (a, _c) = setup();
    let (b, _c2) = setup();
    let a_dir = continue_fixture(a.path());
    copy_claude_session_at(a.path(), b.path(), CONTINUE_ID, "/repo").unwrap();
    // The chat goes on under B, then switches back to A, whose copy is now a prefix.
    let b_dir = b.path().join("projects").join("-repo");
    let b_file = b_dir.join(format!("{CONTINUE_ID}.jsonl"));
    fs::write(&b_file, "history\non b\n").unwrap();
    fs::write(
        b_dir.join(CONTINUE_ID).join("subagents").join("b.jsonl"),
        "sub b\n",
    )
    .unwrap();
    fs::write(
        a_dir.join(CONTINUE_ID).join("subagents").join("a.jsonl"),
        "kept\n",
    )
    .unwrap();
    copy_claude_session_at(b.path(), a.path(), CONTINUE_ID, "/repo").unwrap();
    let a_file = a_dir.join(format!("{CONTINUE_ID}.jsonl"));
    assert_eq!(fs::read_to_string(&a_file).unwrap(), "history\non b\n");
    let subagents = a_dir.join(CONTINUE_ID).join("subagents");
    assert_eq!(
        fs::read_to_string(subagents.join("b.jsonl")).unwrap(),
        "sub b\n"
    );
    assert_eq!(
        fs::read_to_string(subagents.join("a.jsonl")).unwrap(),
        "kept\n"
    );
    assert!(fs::read_dir(&subagents)
        .unwrap()
        .chain(fs::read_dir(&a_dir).unwrap())
        .all(|e| !e.unwrap().file_name().to_string_lossy().contains(".tmp-")));
    // A longer target (the chat went further there) is never cut back.
    fs::write(&a_file, "history\non b\nmore on a\n").unwrap();
    let err = copy_claude_session_at(b.path(), a.path(), CONTINUE_ID, "/repo").unwrap_err();
    assert!(err.contains("different version"));
    assert_eq!(
        fs::read_to_string(&a_file).unwrap(),
        "history\non b\nmore on a\n"
    );
}

#[test]
fn continue_rejects_bad_ids_and_missing_sources() {
    let (from, _c) = setup();
    let (to, _c2) = setup();
    continue_fixture(from.path());
    for bad in [
        "../x",
        "not-a-uuid",
        "",
        "{11111111-2222-4333-8444-555555555555}",
    ] {
        assert!(copy_claude_session_at(from.path(), to.path(), bad, "/repo").is_err());
    }
    let other = "99999999-2222-4333-8444-555555555555";
    assert!(copy_claude_session_at(from.path(), to.path(), other, "/repo").is_err());
    assert!(copy_claude_session_at(from.path(), from.path(), CONTINUE_ID, "/repo").is_err());
}
