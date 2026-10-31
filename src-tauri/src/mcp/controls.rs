//! Native MCP enable choices. All writes start from a currently discovered row.
#[cfg(test)]
mod tests;
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::{discover, read_json};

#[tauri::command]
pub async fn mcp_set_enabled(
    cwd: String,
    provider: String,
    scope: String,
    config_path: String,
    name: String,
    enabled: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = crate::dirs_home().ok_or("Home directory not found")?;
        let project = crate::fs::expand_home(&cwd);
        let codex_home = std::env::var_os("CODEX_HOME").map(PathBuf::from);
        let opencode_config = std::env::var_os("OPENCODE_CONFIG").map(PathBuf::from);
        set_enabled(
            Path::new(&home),
            &project,
            codex_home.as_deref(),
            opencode_config.as_deref(),
            &provider,
            &scope,
            &config_path,
            &name,
            enabled,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[allow(clippy::too_many_arguments)]
fn set_enabled(
    home: &Path,
    project: &Path,
    codex_home: Option<&Path>,
    opencode_config: Option<&Path>,
    provider: &str,
    scope: &str,
    config_path: &str,
    name: &str,
    enabled: bool,
) -> Result<(), String> {
    if !matches!(
        provider,
        "claude" | "codex" | "opencode" | "antigravity-cli" | "antigravity"
    ) {
        return Err(
            "Enable/Disable is supported for Claude Code, Codex, OpenCode and Antigravity"
                .into(),
        );
    }
    if !project.is_dir() {
        return Err("Project directory does not exist".into());
    }
    let rows = discover(
        home,
        project,
        codex_home,
        &super::claude_desktop_config(home),
        opencode_config,
    );
    let row = rows
        .iter()
        .find(|row| {
            row.provider == provider
                && row.scope == scope
                && row.name == name
                && row.config_path == config_path
        })
        .ok_or("This MCP entry has changed or disappeared; refresh and try again")?;
    // Resolve links before replacing a file, so a config symlink remains intact.
    let selected = std::fs::canonicalize(&row.config_path).map_err(|error| error.to_string())?;
    if provider == "claude" {
        let path = home.join(".claude.json");
        update_file(&path, |raw| {
            // Recheck the selected server after taking the write lock.
            let config = read_json(&selected).ok_or("MCP config is no longer readable")?;
            let configured = match scope {
                "user" | "project" => config.get("mcpServers"),
                "local" => config
                    .get("projects")
                    .and_then(|projects| projects.get(claude_project_key(&config, project)))
                    .and_then(|entry| entry.get("mcpServers")),
                _ => None,
            };
            if !configured.is_some_and(|servers| servers.get(name).is_some_and(Value::is_object)) {
                return Err("This MCP entry disappeared; refresh and try again".into());
            }
            edit_claude(raw, project, name, enabled)
        })
    } else {
        update_file(&selected, |raw| match provider {
            "codex" => edit_codex(raw, name, enabled),
            "opencode" => edit_opencode(raw, name, enabled),
            "antigravity-cli" | "antigravity" => edit_antigravity_cli(raw, name, enabled),
            _ => unreachable!(),
        })
    }
}

pub(super) fn claude_project_key(config: &Value, project: &Path) -> String {
    let normal = project.to_string_lossy().replace('\\', "/");
    if let Some(projects) = config.get("projects").and_then(Value::as_object) {
        if let Some(key) = projects.keys().find(|key| {
            let candidate = key.replace('\\', "/");
            #[cfg(windows)]
            {
                candidate
                    .trim_end_matches('/')
                    .eq_ignore_ascii_case(normal.trim_end_matches('/'))
            }
            #[cfg(not(windows))]
            {
                candidate.trim_end_matches('/') == normal.trim_end_matches('/')
            }
        }) {
            return key.clone();
        }
    }
    normal
}

fn edit_claude(raw: &str, project: &Path, name: &str, enabled: bool) -> Result<String, String> {
    let config = json_value(raw)?;
    let key = claude_project_key(&config, project);
    let entry = config
        .get("projects")
        .and_then(|projects| projects.get(&key));
    // Configured servers consult only this opt-out list. enabledMcpServers
    // belongs to default-off built-ins; MCP-json lists are approval choices.
    // Preserve both instead of treating them as competing preferences.
    let list = "disabledMcpServers";
    if entry.and_then(|entry| entry.get(list)).is_some() || !enabled {
        set_name_in_array(raw, &["projects", &key, list], name, !enabled)
    } else {
        Ok(raw.to_owned())
    }
}

fn edit_codex(raw: &str, name: &str, enabled: bool) -> Result<String, String> {
    let parsed = toml_edit::Document::parse(raw)
        .map_err(|error| format!("Invalid Codex configuration: {error}"))?;
    let server = parsed
        .get("mcp_servers")
        .and_then(|servers| servers.get(name))
        .and_then(toml_edit::Item::as_table_like)
        .ok_or("This MCP entry disappeared; refresh and try again")?;
    if let Some(flag) = server.get("enabled") {
        if flag.as_bool().is_none() {
            return Err("Codex enabled must be a boolean".into());
        }
        let span = flag.span().ok_or("Cannot locate Codex enabled flag")?;
        let mut result = raw.to_owned();
        result.replace_range(span, if enabled { "true" } else { "false" });
        return Ok(result);
    }
    let mut config = parsed.into_mut();
    let server = config
        .get_mut("mcp_servers")
        .and_then(|servers| servers.get_mut(name))
        .and_then(toml_edit::Item::as_table_like_mut)
        .ok_or("This MCP entry disappeared; refresh and try again")?;
    server.insert("enabled", toml_edit::value(enabled));
    let result = config.to_string();
    // toml_edit writes LF; retain the existing file's Windows newline style
    // when adding a new key (existing flags use an exact span edit above).
    Ok(if raw.contains("\r\n") {
        result.replace("\r\n", "\n").replace('\n', "\r\n")
    } else {
        result
    })
}

fn edit_antigravity_cli(raw: &str, name: &str, enabled: bool) -> Result<String, String> {
    let config = json_value(raw)?;
    let server = config
        .get("mcpServers")
        .and_then(|servers| servers.get(name))
        .filter(|server| server.is_object())
        .ok_or("This MCP entry disappeared; refresh and try again")?;
    if server
        .get("disabled")
        .is_some_and(|value| !value.is_boolean())
    {
        return Err("Antigravity CLI disabled must be a boolean".into());
    }
    set_json_path(
        raw,
        &["mcpServers", name, "disabled"],
        Value::Bool(!enabled),
    )
}

fn edit_opencode(raw: &str, name: &str, enabled: bool) -> Result<String, String> {
    let config = json_value(raw)?;
    let mcp = config.get("mcp").ok_or("MCP configuration disappeared")?;
    let nested = mcp
        .get("servers")
        .and_then(Value::as_object)
        .is_some_and(|servers| servers.values().all(Value::is_object));
    let mut path = if nested {
        vec!["mcp", "servers"]
    } else {
        vec!["mcp"]
    };
    path.push(name);
    let server = if nested {
        &mcp["servers"][name]
    } else {
        &mcp[name]
    };
    if !server.is_object() {
        return Err("This MCP entry disappeared; refresh and try again".into());
    }
    let mut result = raw.to_owned();
    for (field, value) in [("enabled", enabled), ("disabled", !enabled)] {
        if server.get(field).is_some_and(|value| !value.is_boolean()) {
            return Err(format!("OpenCode {field} must be a boolean"));
        }
        if field == if nested { "disabled" } else { "enabled" } || server.get(field).is_some() {
            path.push(field);
            result = set_json_path(&result, &path, Value::Bool(value))?;
            path.pop();
        }
    }
    Ok(result)
}

/// Lock, preserve permissions, and atomically replace. Detect writers that do
/// not share our lock before publishing, rather than overwriting their changes.
fn update_file(
    path: &Path,
    edit: impl FnOnce(&str) -> Result<String, String>,
) -> Result<(), String> {
    let path = if path.exists() {
        std::fs::canonicalize(path).map_err(|error| error.to_string())?
    } else {
        path.to_path_buf()
    };
    let parent = path.parent().ok_or("Invalid config path")?;
    let file_name = path
        .file_name()
        .ok_or("Invalid config path")?
        .to_string_lossy();
    let mut options = std::fs::OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let lock = options
        .open(parent.join(format!(".{file_name}.lock")))
        .map_err(|error| error.to_string())?;
    lock.lock().map_err(|error| error.to_string())?;
    if std::fs::metadata(&path).is_ok_and(|metadata| metadata.permissions().readonly()) {
        return Err("Configuration is read-only; make it writable before toggling".into());
    }
    let original = match std::fs::read_to_string(&path) {
        Ok(raw) => Some(raw),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.to_string()),
    };
    let result = edit(original.as_deref().unwrap_or("{}"))?;
    if original.as_deref() == Some(&result) {
        return Ok(());
    }
    let temporary = parent.join(format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4()));
    let outcome = (|| -> Result<(), String> {
        use std::io::Write;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|error| error.to_string())?;
        if let Ok(metadata) = std::fs::metadata(&path) {
            file.set_permissions(metadata.permissions())
                .map_err(|error| error.to_string())?;
        }
        file.write_all(result.as_bytes())
            .map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        let current = match std::fs::read_to_string(&path) {
            Ok(raw) => Some(raw),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.to_string()),
        };
        if current != original {
            return Err("Configuration changed while saving; refresh and try again".into());
        }
        std::fs::rename(&temporary, &path).map_err(|error| error.to_string())
    })();
    if outcome.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    outcome
}

fn json_value(raw: &str) -> Result<Value, String> {
    serde_json::from_str(&super::strip_jsonc(raw))
        .map_err(|error| format!("Invalid JSON configuration: {error}"))
}

// The serde validator handles the JSON grammar. This small span reader locates
// only the value to change in JSON/JSONC, preserving all surrounding bytes.
#[derive(Debug)]
struct JsonSpan {
    start: usize,
    end: usize,
    properties: Vec<(String, JsonSpan)>,
    items: Vec<JsonSpan>,
}

struct SpanReader<'a> {
    raw: &'a str,
    position: usize,
}

impl SpanReader<'_> {
    fn trivia(&mut self) {
        let bytes = self.raw.as_bytes();
        loop {
            while bytes
                .get(self.position)
                .is_some_and(u8::is_ascii_whitespace)
            {
                self.position += 1;
            }
            if bytes.get(self.position..self.position + 2) == Some(b"//") {
                while bytes.get(self.position).is_some_and(|byte| *byte != b'\n') {
                    self.position += 1;
                }
            } else if bytes.get(self.position..self.position + 2) == Some(b"/*") {
                self.position += 2;
                while self.position + 1 < bytes.len()
                    && &bytes[self.position..self.position + 2] != b"*/"
                {
                    self.position += 1;
                }
                self.position = (self.position + 2).min(bytes.len());
            } else {
                break;
            }
        }
    }

    fn string(&mut self) -> Result<String, String> {
        let start = self.position;
        let bytes = self.raw.as_bytes();
        if bytes.get(start) != Some(&b'"') {
            return Err("Expected JSON property name".into());
        }
        self.position += 1;
        while let Some(byte) = bytes.get(self.position) {
            self.position += 1;
            if *byte == b'\\' {
                self.position += 1;
            } else if *byte == b'"' {
                return serde_json::from_str(&self.raw[start..self.position])
                    .map_err(|error| error.to_string());
            }
        }
        Err("Unclosed JSON string".into())
    }

    fn value(&mut self) -> Result<JsonSpan, String> {
        self.trivia();
        let start = self.position;
        let mut properties = Vec::new();
        let mut items = Vec::new();
        match self.raw.as_bytes().get(start) {
            Some(b'{') | Some(b'[') => {
                let object = self.raw.as_bytes()[start] == b'{';
                let close = if object { b'}' } else { b']' };
                self.position += 1;
                self.trivia();
                while self.raw.as_bytes().get(self.position) != Some(&close) {
                    if object {
                        let key = self.string()?;
                        if properties.iter().any(|(existing, _)| existing == &key) {
                            return Err(
                                "Duplicate JSON property; fix the config before toggling".into()
                            );
                        }
                        self.trivia();
                        if self.raw.as_bytes().get(self.position) != Some(&b':') {
                            return Err("Expected JSON colon".into());
                        }
                        self.position += 1;
                        properties.push((key, self.value()?));
                    } else {
                        items.push(self.value()?);
                    }
                    self.trivia();
                    if self.raw.as_bytes().get(self.position) == Some(&b',') {
                        self.position += 1;
                        self.trivia();
                    } else if self.raw.as_bytes().get(self.position) != Some(&close) {
                        return Err("Expected JSON comma".into());
                    }
                }
                self.position += 1;
            }
            Some(b'"') => {
                self.string()?;
            }
            Some(_) => {
                while self
                    .raw
                    .as_bytes()
                    .get(self.position)
                    .is_some_and(|byte| !byte.is_ascii_whitespace() && !b",]} /".contains(byte))
                {
                    self.position += 1;
                }
                if self.position == start {
                    return Err("Invalid JSON value".into());
                }
            }
            None => return Err("Missing JSON value".into()),
        }
        Ok(JsonSpan {
            start,
            end: self.position,
            properties,
            items,
        })
    }
}

fn set_json_path(raw: &str, path: &[&str], value: Value) -> Result<String, String> {
    json_value(raw)?;
    let mut reader = SpanReader { raw, position: 0 };
    let root = reader.value()?;
    let mut node = &root;
    for (index, key) in path.iter().enumerate() {
        if raw.as_bytes().get(node.start) != Some(&b'{') {
            return Err(format!(
                "Configuration {} must be an object",
                path[..index].join(".")
            ));
        }
        if let Some((_, child)) = node.properties.iter().find(|(name, _)| name == key) {
            node = child;
        } else {
            let mut nested = value;
            for key in path[index + 1..].iter().rev() {
                let mut object = serde_json::Map::new();
                object.insert((*key).to_owned(), nested);
                nested = Value::Object(object);
            }
            let property = format!("{}: {}", serde_json::to_string(key).unwrap(), nested);
            let (position, insertion) = match node.properties.last() {
                Some((_, last)) => (last.end, format!(", {property}")),
                None => (node.start + 1, property),
            };
            let mut result = raw.to_owned();
            result.insert_str(position, &insertion);
            json_value(&result)?;
            return Ok(result);
        }
    }
    let mut result = raw.to_owned();
    result.replace_range(node.start..node.end, &value.to_string());
    json_value(&result)?;
    Ok(result)
}

/// Change membership without reserializing the array: comments and the other
/// server names keep their original spelling and layout.
fn set_name_in_array(
    raw: &str,
    path: &[&str],
    name: &str,
    present: bool,
) -> Result<String, String> {
    let mut result = raw.to_owned();
    loop {
        json_value(&result)?;
        let mut reader = SpanReader {
            raw: &result,
            position: 0,
        };
        let root = reader.value()?;
        let mut node = &root;
        for (index, key) in path.iter().enumerate() {
            if result.as_bytes().get(node.start) != Some(&b'{') {
                return Err(format!(
                    "Configuration {} must be an object",
                    path[..index].join(".")
                ));
            }
            let Some((_, child)) = node.properties.iter().find(|(name, _)| name == key) else {
                return if present {
                    set_json_path(&result, path, serde_json::json!([name]))
                } else {
                    Ok(result)
                };
            };
            node = child;
        }
        if result.as_bytes().get(node.start) != Some(&b'[') {
            return Err("Claude MCP preferences must be an array".into());
        }
        let values: Vec<String> = node
            .items
            .iter()
            .map(|item| {
                serde_json::from_str(&result[item.start..item.end])
                    .map_err(|_| "Claude MCP preferences must contain only server names".to_owned())
            })
            .collect::<Result<_, _>>()?;
        let index = values.iter().position(|value| value == name);
        match (present, index) {
            (true, Some(_)) | (false, None) => return Ok(result),
            (true, None) => {
                let encoded = serde_json::to_string(name).map_err(|error| error.to_string())?;
                match node.items.last() {
                    Some(last) => result.insert_str(last.end, &format!(", {encoded}")),
                    None => result.insert_str(node.start + 1, &encoded),
                }
                json_value(&result)?;
                return Ok(result);
            }
            (false, Some(index)) => {
                let item = &node.items[index];
                let mut trivia = SpanReader {
                    raw: &result,
                    position: item.end,
                };
                trivia.trivia();
                let comma = if result.as_bytes().get(trivia.position) == Some(&b',') {
                    Some(trivia.position)
                } else if index > 0 {
                    let mut trivia = SpanReader {
                        raw: &result,
                        position: node.items[index - 1].end,
                    };
                    trivia.trivia();
                    Some(trivia.position)
                } else {
                    None
                };
                let mut removals = vec![(item.start, item.end)];
                if let Some(comma) = comma {
                    removals.push((comma, comma + 1));
                }
                removals.sort_by_key(|range| std::cmp::Reverse(range.0));
                for (start, end) in removals {
                    result.replace_range(start..end, "");
                }
                // Remove duplicate occurrences too, if a native config contains them.
            }
        }
    }
}
