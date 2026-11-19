//! Fork (L-362): Claude's own servers (user scope, in `~/.claude.json` or a
//! MonoCode account's file) are off until switched on for a project. Claude
//! keeps its off list per project, so every new project started them all;
//! MonoCode keeps the on list here and denies the rest at launch
//! (`deniedMcpServers` in `--settings`).
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

pub(crate) fn file(home: &Path) -> PathBuf {
    home.join(".monocode").join("mcp-on-demand.json")
}

/// One spelling per folder: forward slashes, no trailing slash, and on
/// Windows any case.
pub(crate) fn project_key(project: &Path) -> String {
    let key = project
        .to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_owned();
    if cfg!(windows) {
        key.to_lowercase()
    } else {
        key
    }
}

/// Servers switched on for this project.
pub(crate) fn on_list(home: &Path, project: &Path) -> Vec<String> {
    let Ok(raw) = std::fs::read_to_string(file(home)) else {
        return Vec::new();
    };
    serde_json::from_str::<Value>(&raw)
        .ok()
        .as_ref()
        .and_then(|config| config.get("projects"))
        .and_then(|projects| projects.get(project_key(project)))
        .and_then(Value::as_array)
        .map(|names| {
            names
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn set_on(home: &Path, project: &Path, name: &str, on: bool) -> Result<(), String> {
    let path = file(home);
    let mut config = std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| Value::Object(Map::new()));
    let projects = config
        .as_object_mut()
        .expect("object")
        .entry("projects")
        .or_insert_with(|| Value::Object(Map::new()));
    if !projects.is_object() {
        *projects = Value::Object(Map::new());
    }
    let projects = projects.as_object_mut().expect("object");
    let key = project_key(project);
    let mut names: Vec<String> = projects
        .get(&key)
        .and_then(Value::as_array)
        .map(|names| {
            names
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    names.retain(|existing| existing != name);
    if on {
        names.push(name.to_owned());
        names.sort();
    }
    if names.is_empty() {
        projects.remove(&key);
    } else {
        projects.insert(key, Value::from(names));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?;
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, text).map_err(|error| error.to_string())?;
    std::fs::rename(&temp, &path).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn switches_a_server_on_and_off_per_project() {
        let root = std::env::temp_dir().join(format!("monocode-od-{}", uuid::Uuid::new_v4()));
        let home = &root;
        let project = Path::new("/work/App");
        assert!(on_list(home, project).is_empty());
        set_on(home, project, "tabularis", true).unwrap();
        set_on(home, project, "aside", true).unwrap();
        set_on(home, project, "aside", true).unwrap();
        assert_eq!(on_list(home, project), ["aside", "tabularis"]);
        assert!(on_list(home, Path::new("/work/Other")).is_empty());
        set_on(home, project, "aside", false).unwrap();
        assert_eq!(on_list(home, project), ["tabularis"]);
        assert_eq!(on_list(home, Path::new("/work/App/")), ["tabularis"]);
        let _ = std::fs::remove_dir_all(&root);
    }
}
