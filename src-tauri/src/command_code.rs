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
}
