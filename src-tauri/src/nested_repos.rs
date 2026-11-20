//! Fork (L-370): git repositories one level inside a project folder that is
//! not itself in a repository, so Changes can work on each (a "multi-repo"
//! folder holding, say, `Teacher/`, `student_dash/` and `landing-page/`).

use std::path::Path;

use serde::Serialize;

use crate::fs::expand_home;

/// More than this many is a folder of unrelated checkouts (a "code" folder),
/// not one project: the switcher would be unusable, so none are offered.
const MAX_NESTED_REPOS: usize = 24;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NestedRepo {
    /// Absolute path, `/`-separated as the rest of the file commands return.
    pub path: String,
    /// Folder name, shown in the switcher.
    pub name: String,
}

/// Repositories directly inside `cwd`, by name. Empty when `cwd` is itself in
/// a repository (Changes already works there), is missing, or holds too many.
#[tauri::command]
pub async fn git_nested_repos(cwd: String) -> Result<Vec<NestedRepo>, String> {
    crate::background_work::read(move || nested_repos(&expand_home(&cwd))).await
}

pub(crate) fn nested_repos(root: &Path) -> Vec<NestedRepo> {
    if !root.is_dir() || inside_repo(root) {
        return Vec::new();
    }
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut repos: Vec<NestedRepo> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || name == "node_modules" {
                return None;
            }
            let path = entry.path();
            // `.git` is a folder in a clone and a file in a linked worktree.
            (path.is_dir() && path.join(".git").exists()).then(|| NestedRepo {
                path: slash(&path),
                name,
            })
        })
        .collect();
    if repos.len() > MAX_NESTED_REPOS {
        return Vec::new();
    }
    repos.sort_by_key(|repo| repo.name.to_lowercase());
    repos
}

fn inside_repo(root: &Path) -> bool {
    root.ancestors().any(|dir| dir.join(".git").exists())
}

fn slash(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nested-repos-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn lists_repos_one_level_down_by_name() {
        let root = temp();
        for name in ["student_dash", "Teacher", "docs", ".hidden", "node_modules"] {
            std::fs::create_dir_all(root.join(name)).unwrap();
        }
        std::fs::create_dir_all(root.join("Teacher/.git")).unwrap();
        std::fs::create_dir_all(root.join("student_dash/.git")).unwrap();
        std::fs::create_dir_all(root.join(".hidden/.git")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/.git")).unwrap();
        // A linked worktree has a `.git` file.
        std::fs::create_dir_all(root.join("landing")).unwrap();
        std::fs::write(root.join("landing/.git"), "gitdir: elsewhere").unwrap();

        let names: Vec<String> = nested_repos(&root)
            .into_iter()
            .map(|repo| repo.name)
            .collect();
        assert_eq!(names, ["landing", "student_dash", "Teacher"]);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn none_inside_a_repo_or_for_a_missing_folder() {
        let root = temp();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::create_dir_all(root.join("sub/.git")).unwrap();
        assert!(nested_repos(&root).is_empty());
        assert!(nested_repos(&root.join("sub")).is_empty());
        assert!(nested_repos(&root.join("missing")).is_empty());
        let _ = std::fs::remove_dir_all(root);
    }
}
