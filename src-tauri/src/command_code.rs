use std::path::{Path, PathBuf};

/// Fork (L-255): an empty working folder in MonoCode's app data where AI
/// helpers run Command Code, so a helper turn never sees a project's files or
/// agent instructions.
#[tauri::command]
pub(crate) fn command_code_helper_directory(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Could not locate MonoCode's app data folder.".to_string())?;
    let directory = ensure_command_code_helper_directory(&app_data_dir)?;
    Ok(crate::fs::path_to_js(&directory))
}

fn ensure_command_code_helper_directory(app_data_dir: &Path) -> Result<PathBuf, String> {
    let directory = app_data_dir.join("command-code-helper");
    std::fs::create_dir_all(&directory)
        .map_err(|_| "Could not create MonoCode's Command Code helper folder.".to_string())?;
    Ok(directory)
}

/// Largest catalog file read; the real one is about 100 KB.
const CATALOG_MAX_BYTES: u64 = 8 * 1024 * 1024;

/// Fork (L-259): the model catalog Command Code caches for the signed-in
/// account (`~/.commandcode/cache/model-catalog/v1/catalog-*.json`). It lists
/// every model with its plan, badge and efforts, which `cmdc acp` and
/// `cmdc --list-models` leave out. `None` until the CLI has run once.
#[tauri::command(async)]
pub(crate) fn command_code_model_catalog() -> Result<Option<String>, String> {
    let Some(home) = crate::dirs_home() else {
        return Ok(None);
    };
    newest_catalog(
        &Path::new(&home)
            .join(".commandcode")
            .join("cache")
            .join("model-catalog")
            .join("v1"),
    )
}

fn newest_catalog(directory: &Path) -> Result<Option<String>, String> {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return Ok(None);
    };
    let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with("catalog-") || !name.ends_with(".json") {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() || meta.len() > CATALOG_MAX_BYTES {
            continue;
        }
        let modified = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
        if newest.as_ref().is_none_or(|(time, _)| modified > *time) {
            newest = Some((modified, entry.path()));
        }
    }
    match newest {
        None => Ok(None),
        Some((_, path)) => std::fs::read_to_string(path)
            .map(Some)
            .map_err(|_| "Could not read Command Code's model catalog.".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helper_directory_is_created_inside_app_data_and_starts_empty() {
        let root = std::env::temp_dir().join(format!(
            "monocode-command-code-helper-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));

        let helper = ensure_command_code_helper_directory(&root).expect("helper directory");

        assert_eq!(helper, root.join("command-code-helper"));
        assert!(helper.is_dir());
        assert_eq!(std::fs::read_dir(&helper).expect("empty folder").count(), 0);
        std::fs::remove_dir_all(root).expect("remove test folder");
    }

    #[test]
    fn newest_catalog_reads_only_the_latest_catalog_file() {
        let root = std::env::temp_dir().join(format!(
            "monocode-command-code-catalog-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(newest_catalog(&root), Ok(None));
        std::fs::create_dir_all(&root).expect("create test folder");
        std::fs::write(root.join("notes.json"), "{}").expect("write other file");
        assert_eq!(newest_catalog(&root), Ok(None));
        std::fs::write(root.join("catalog-old.json"), "old").expect("write old");
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(root.join("catalog-new.json"), "new").expect("write new");
        assert_eq!(newest_catalog(&root), Ok(Some("new".to_string())));
        std::fs::remove_dir_all(root).expect("remove test folder");
    }
}
