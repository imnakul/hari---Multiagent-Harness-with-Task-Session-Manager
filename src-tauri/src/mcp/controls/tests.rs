use super::*;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("monocode-mcp-controls-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(path.join("home")).unwrap();
        std::fs::create_dir_all(path.join("project/.git")).unwrap();
        Self(path)
    }
    fn home(&self) -> PathBuf {
        self.0.join("home")
    }
    fn project(&self) -> PathBuf {
        self.0.join("project")
    }
    fn write(&self, path: &Path, raw: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, raw).unwrap();
    }
    fn toggle(
        &self,
        provider: &str,
        scope: &str,
        path: &Path,
        name: &str,
        enabled: bool,
    ) -> Result<(), String> {
        set_enabled(
            &self.home(),
            &self.project(),
            None,
            None,
            provider,
            scope,
            &path.to_string_lossy(),
            name,
            enabled,
        )
    }
    fn rows(&self) -> Vec<super::super::McpConnection> {
        discover(
            &self.home(),
            &self.project(),
            None,
            &self.home().join("desktop.json"),
            None,
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn codex_preserves_comments_and_inline_tables() {
    let raw = "# account stays\nmodel = 'gpt'\n[mcp_servers.'docs.tools']\ncommand = 'node'\nenabled = false # keep flag comment\nenv = { TOKEN = '${SECRET}', OTHER = 'yes' }\n[mcp_servers.other]\nurl = 'https://example.test'\n";
    assert_eq!(
        edit_codex(raw, "docs.tools", true).unwrap(),
        raw.replace("enabled = false", "enabled = true")
    );
    let inline = "mcp_servers = { docs = { command = 'node', enabled = false }, other = { command = 'else' } } # saved\n";
    let result = edit_codex(inline, "docs", true).unwrap();
    assert!(result.contains("enabled = true"));
    assert!(result.contains("other = { command = 'else' }"));
    assert!(result.ends_with("# saved\n"));
}

#[test]
fn codex_adds_missing_flag_before_subtables() {
    let raw = "[mcp_servers.docs]\ncommand = 'node'\n[mcp_servers.docs.env]\nTOKEN = 'keep'\n[mcp_servers.other]\nenabled = false\n";
    let result = edit_codex(raw, "docs", false).unwrap();
    let value: toml::Value = toml::from_str(&result).unwrap();
    assert_eq!(
        value["mcp_servers"]["docs"]["enabled"].as_bool(),
        Some(false)
    );
    assert_eq!(
        value["mcp_servers"]["docs"]["env"]["TOKEN"].as_str(),
        Some("keep")
    );
    assert!(result.contains("[mcp_servers.other]\nenabled = false\n"));
}

#[test]
fn codex_preserves_windows_line_endings() {
    let raw = "# keep\r\n[mcp_servers.docs]\r\ncommand = 'node'\r\nenabled = false # saved\r\n";
    assert_eq!(
        edit_codex(raw, "docs", true).unwrap(),
        raw.replace("false", "true")
    );
    let raw = "# keep\r\n[mcp_servers.docs]\r\ncommand = 'node'\r\n";
    let result = edit_codex(raw, "docs", false).unwrap();
    assert!(result.contains("enabled = false\r\n"));
    assert!(!result.replace("\r\n", "").contains('\n'));
}

#[test]
fn opencode_preserves_jsonc_bytes_crlf_and_trailing_commas() {
    let raw = "{\r\n // keep provider preference\r\n \"theme\": \"dark\", \"mcp\": {\"døcs\": {\"command\": [\"node\"], /* keep */ \"enabled\": false, \"environment\": {\"TOKEN\": \"http://token/*literal*/\"},}, \"other\": {\"enabled\": false},},\r\n}\r\n";
    assert_eq!(
        edit_opencode(raw, "døcs", true).unwrap(),
        raw.replacen("\"enabled\": false", "\"enabled\": true", 1)
    );
}

#[test]
fn opencode_two_uses_disabled_and_keeps_timeouts_and_credentials() {
    let raw = r#"{"mcp":{"timeout":{"connect":1000},"servers":{"docs":{"url":"https://example.test","headers":{"Auth":"unchanged"}},"other":{"disabled":true}}}}"#;
    let result = edit_opencode(raw, "docs", false).unwrap();
    let value = json_value(&result).unwrap();
    assert_eq!(value["mcp"]["servers"]["docs"]["disabled"], true);
    assert_eq!(value["mcp"]["timeout"]["connect"], 1000);
    assert!(result.contains(r#""other":{"disabled":true}"#));
    assert!(result.contains(r#""headers":{"Auth":"unchanged"}"#));
    assert_eq!(
        json_value(&edit_opencode(&result, "docs", true).unwrap()).unwrap()["mcp"]["servers"]
            ["docs"]["disabled"],
        false
    );
}

#[test]
fn server_named_servers_is_not_mistaken_for_v2() {
    let raw = r#"{"mcp":{"servers":{"type":"local","command":["node"],"enabled":false}}}"#;
    assert_eq!(
        edit_opencode(raw, "servers", true).unwrap(),
        raw.replace("false", "true")
    );
}

#[test]
fn opencode_removes_conflicting_disable_state() {
    for raw in [
        r#"{"mcp":{"docs":{"command":["node"],"enabled":false,"disabled":true}}}"#,
        r#"{"mcp":{"servers":{"docs":{"command":"node","enabled":false,"disabled":true}}}}"#,
    ] {
        let result = edit_opencode(raw, "docs", true).unwrap();
        assert!(!result.contains("\"enabled\":false"));
        assert!(!result.contains("\"disabled\":true"));
    }
}

#[test]
fn invalid_flags_duplicate_keys_and_missing_entries_fail_closed() {
    assert!(edit_codex("[mcp_servers.docs]\nenabled = 'false'", "docs", true).is_err());
    assert!(edit_codex("[mcp_servers.other]\ncommand = 'node'", "docs", true).is_err());
    for raw in [
        r#"{"mcp":{"docs":{"enabled":"false"}}}"#,
        r#"{"mcp":{"docs":{"enabled":true,"enabled":false}}}"#,
        r#"{"mcp":{}}"#,
        "{ invalid }",
    ] {
        assert!(edit_opencode(raw, "docs", true).is_err());
    }
}

#[test]
fn claude_keeps_mcp_definitions_project_approvals_and_other_projects() {
    let raw = r#"{"mcpServers":{"docs":{"command":"node","args":["keep"]}},"projects":{"/selected":{"enabledMcpServers":["docs","other"],"disabledMcpjsonServers":["unapproved"]},"/other":{"disabledMcpServers":["docs"]}}}"#;
    let result = edit_claude(raw, Path::new("/selected"), "docs", false).unwrap();
    let value = json_value(&result).unwrap();
    assert_eq!(
        value["projects"]["/selected"]["disabledMcpServers"],
        serde_json::json!(["docs"])
    );
    assert_eq!(
        value["projects"]["/selected"]["enabledMcpServers"],
        serde_json::json!(["docs", "other"])
    );
    assert_eq!(
        value["projects"]["/selected"]["disabledMcpjsonServers"],
        serde_json::json!(["unapproved"])
    );
    assert!(result.contains(r#""/other":{"disabledMcpServers":["docs"]}"#));
    assert!(result.contains(r#""enabledMcpServers":["docs","other"]"#));
    assert!(result.contains(r#""mcpServers":{"docs":{"command":"node","args":["keep"]}}"#));
}

#[test]
fn claude_list_edits_preserve_comments_and_remove_duplicates() {
    let raw = "{\"projects\":{\"/p\":{\"disabledMcpServers\":[ /* a */ \"docs\", // b\n \"keep\", /* c */ \"docs\", /* d */ ]}}}";
    let result = edit_claude(raw, Path::new("/p"), "docs", true).unwrap();
    assert_eq!(
        json_value(&result).unwrap()["projects"]["/p"]["disabledMcpServers"],
        serde_json::json!(["keep"])
    );
    for comment in ["/* a */", "// b", "/* c */", "/* d */"] {
        assert!(result.contains(comment));
    }
    for list in ["[1]", "{}"] {
        let raw = format!("{{\"projects\":{{\"/p\":{{\"disabledMcpServers\":{list}}}}}}}");
        assert!(edit_claude(&raw, Path::new("/p"), "docs", true).is_err());
    }
    let only = "{\"projects\":{\"/p\":{\"disabledMcpServers\":[\"docs\", /* saved */ ]}}}";
    let result = edit_claude(only, Path::new("/p"), "docs", true).unwrap();
    assert!(result.contains("/* saved */"));
    assert_eq!(
        json_value(&result).unwrap()["projects"]["/p"]["disabledMcpServers"],
        serde_json::json!([])
    );
}

#[test]
fn creates_missing_project_preferences_without_reformatting_config() {
    let raw = "{\n // keep\n \"theme\":\"dark\",\n}\n";
    let result = edit_claude(raw, Path::new("/p"), "docs", false).unwrap();
    assert!(result.contains("// keep"));
    assert_eq!(
        json_value(&result).unwrap()["projects"]["/p"]["disabledMcpServers"],
        serde_json::json!(["docs"])
    );
    assert_eq!(
        edit_claude("{}", Path::new("/p"), "docs", true).unwrap(),
        "{}"
    );
    let raw = r#"{"mcp":{"do\u0063s":{"enabled":false,"command":["node"]}}}"#;
    assert_eq!(
        edit_opencode(raw, "docs", true).unwrap(),
        raw.replace("false", "true")
    );
}

#[test]
fn selected_config_does_not_change_another_definition_with_the_same_name() {
    let fixture = Fixture::new();
    let user = fixture.home().join(".codex/config.toml");
    let project = fixture.project().join(".codex/config.toml");
    let raw = "[mcp_servers.docs]\ncommand='node'\n";
    fixture.write(&user, raw);
    fixture.write(&project, raw);
    fixture
        .toggle("codex", "project", &project, "docs", false)
        .unwrap();
    assert_eq!(std::fs::read_to_string(user).unwrap(), raw);
    let rows = fixture.rows();
    assert!(
        rows.iter()
            .find(|row| row.provider == "codex" && row.scope == "user")
            .unwrap()
            .enabled
    );
    assert!(
        !rows
            .iter()
            .find(|row| row.provider == "codex" && row.scope == "project")
            .unwrap()
            .enabled
    );
}

#[test]
fn forged_paths_scopes_and_stale_rows_cannot_write_config() {
    let fixture = Fixture::new();
    let path = fixture.home().join(".codex/config.toml");
    let raw = "[mcp_servers.docs]\ncommand='node'\n";
    fixture.write(&path, raw);
    let arbitrary = fixture.0.join("arbitrary.toml");
    fixture.write(&arbitrary, raw);
    assert!(fixture
        .toggle("codex", "user", &arbitrary, "docs", false)
        .is_err());
    assert!(fixture
        .toggle("codex", "project", &path, "docs", false)
        .is_err());
    assert!(fixture
        .toggle("codex", "user", &path, "missing", false)
        .is_err());
    assert!(fixture
        .toggle("claude_desktop", "user", &path, "docs", false)
        .is_err());
    assert_eq!(std::fs::read_to_string(path).unwrap(), raw);
    assert_eq!(std::fs::read_to_string(arbitrary).unwrap(), raw);
}

#[test]
fn claude_discovery_reflects_native_project_choice_across_scopes() {
    let fixture = Fixture::new();
    let user = fixture.home().join(".claude.json");
    let project = fixture.project().join(".mcp.json");
    let root = serde_json::json!({"mcpServers":{"docs":{"command":"node"}},"projects":{fixture.project().to_string_lossy().as_ref():{"mcpServers":{"docs":{"command":"local"}},"disabledMcpServers":["other"]}}});
    fixture.write(&user, &root.to_string());
    fixture.write(&project, r#"{"mcpServers":{"docs":{"command":"project"}}}"#);
    fixture
        .toggle("claude", "project", &project, "docs", false)
        .unwrap();
    let rows = fixture.rows();
    let docs: Vec<_> = rows
        .iter()
        .filter(|row| row.provider == "claude" && row.name == "docs")
        .collect();
    assert_eq!(docs.len(), 3);
    assert!(docs.iter().all(|row| !row.enabled));
    fixture
        .toggle("claude", "local", &user, "docs", true)
        .unwrap();
    assert!(fixture
        .rows()
        .iter()
        .filter(|row| row.provider == "claude")
        .all(|row| row.enabled));
    assert_eq!(
        read_json(&user).unwrap()["projects"][fixture.project().to_string_lossy().as_ref()]
            ["disabledMcpServers"],
        serde_json::json!(["other"])
    );
}

#[test]
fn project_server_can_be_disabled_before_user_config_exists() {
    let fixture = Fixture::new();
    let project = fixture.project().join(".mcp.json");
    fixture.write(&project, r#"{"mcpServers":{"docs":{"command":"node"}}}"#);
    fixture
        .toggle("claude", "project", &project, "docs", false)
        .unwrap();
    assert!(
        !fixture
            .rows()
            .iter()
            .find(|row| row.provider == "claude")
            .unwrap()
            .enabled
    );
    assert!(fixture.home().join(".claude.json").exists());
}

#[test]
fn concurrent_external_writer_is_not_overwritten() {
    let fixture = Fixture::new();
    let path = fixture.0.join("config.json");
    fixture.write(&path, "{}");
    let result = update_file(&path, |_| {
        std::fs::write(&path, "{\"external\":true}").unwrap();
        Ok("{\"ours\":true}".to_owned())
    });
    assert!(result.unwrap_err().contains("changed while saving"));
    assert_eq!(
        std::fs::read_to_string(path).unwrap(),
        "{\"external\":true}"
    );
    assert!(!std::fs::read_dir(&fixture.0).unwrap().any(|entry| entry
        .unwrap()
        .path()
        .extension()
        .is_some_and(|extension| extension == "tmp")));
}

#[cfg(unix)]
#[test]
fn preserves_symlinks_and_restrictive_config_permissions() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let fixture = Fixture::new();
    let real = fixture.0.join("real.toml");
    fixture.write(&real, "[mcp_servers.docs]\ncommand='node'\n");
    std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o600)).unwrap();
    let link = fixture.home().join(".codex/config.toml");
    std::fs::create_dir_all(link.parent().unwrap()).unwrap();
    symlink(&real, &link).unwrap();
    fixture
        .toggle("codex", "user", &link, "docs", false)
        .unwrap();
    assert!(link.is_symlink());
    assert!(std::fs::read_to_string(&real)
        .unwrap()
        .contains("enabled = false"));
    assert_eq!(
        std::fs::metadata(real).unwrap().permissions().mode() & 0o777,
        0o600
    );
}

#[test]
fn readonly_configuration_is_reported_without_replacing_it() {
    let fixture = Fixture::new();
    let path = fixture.home().join(".codex").join("config.toml");
    let raw = "[mcp_servers.docs]\ncommand='node'\n";
    fixture.write(&path, raw);
    let original = std::fs::metadata(&path).unwrap().permissions();
    let mut readonly = original.clone();
    readonly.set_readonly(true);
    std::fs::set_permissions(&path, readonly).unwrap();
    let result = fixture.toggle("codex", "user", &path, "docs", false);
    let error = result.unwrap_err();
    assert!(error.contains("read-only"), "Unexpected error: {error}");
    assert_eq!(std::fs::read_to_string(&path).unwrap(), raw);
    // Restore this test fixture's permissions before its RAII cleanup.
    std::fs::set_permissions(path, original).unwrap();
}

#[test]
fn antigravity_cli_discovery_and_toggle_preserve_scope_transport_and_config() {
    let f = Fixture::new();
    let user = f.home().join(".gemini/config/mcp_config.json");
    let project = f.project().join(".agents/mcp_config.json");
    let raw = "{\r\n // keep\r\n \"mcpServers\": {\"docs\": {\"serverUrl\": \"https://example.test/mcp\", \"headers\": {\"Auth\": \"keep\"}, \"disabled\": false,}, \"other\": {\"command\": \"node\"}},\r\n}\r\n";
    f.write(&project, raw);
    f.write(
        &user,
        r#"{"mcpServers":{"docs":{"command":"node","disabled":true}}}"#,
    );
    let rows = f.rows();
    let cli: Vec<_> = rows
        .iter()
        .filter(|row| row.provider == "antigravity-cli")
        .collect();
    assert_eq!(cli.len(), 3);
    let local = cli
        .iter()
        .find(|row| row.name == "docs" && row.scope == "project")
        .unwrap();
    assert_eq!(local.transport, "http");
    assert!(local.enabled);
    assert!(!cli.iter().find(|row| row.scope == "user").unwrap().enabled);
    f.toggle("antigravity-cli", "project", &project, "docs", false)
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(&project).unwrap(),
        raw.replace("false", "true")
    );
    assert_eq!(
        json_value(&std::fs::read_to_string(&user).unwrap()).unwrap()["mcpServers"]["docs"]
            ["disabled"],
        true
    );
    f.toggle("antigravity-cli", "project", &project, "docs", true)
        .unwrap();
    assert_eq!(std::fs::read_to_string(&project).unwrap(), raw);
    f.toggle("antigravity-cli", "user", &user, "docs", true)
        .unwrap();
    assert!(
        f.rows()
            .iter()
            .find(|row| row.provider == "antigravity-cli" && row.scope == "user")
            .unwrap()
            .enabled
    );
}

#[test]
fn antigravity_cli_rejects_invalid_flags_and_undiscovered_paths() {
    let f = Fixture::new();
    let path = f.project().join(".agents/mcp_config.json");
    let raw = r#"{"mcpServers":{"docs":{"command":"node","disabled":"false"}}}"#;
    f.write(&path, raw);
    assert!(f
        .toggle("antigravity-cli", "project", &path, "docs", false)
        .unwrap_err()
        .contains("boolean"));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), raw);
    let unrelated = f.0.join("outside.json");
    f.write(&unrelated, r#"{"mcpServers":{"docs":{"command":"node"}}}"#);
    assert!(f
        .toggle("antigravity-cli", "user", &unrelated, "docs", false)
        .is_err());
}
