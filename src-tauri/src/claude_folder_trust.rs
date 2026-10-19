//! Pre-trusts a chat folder in Claude Code's own config before Interactive
//! launches it, so Claude never stops at "Do you trust the files in this
//! folder?" behind a hidden terminal (L-115). Mirrors Orca's
//! `claude-folder-trust-file.ts`: never creates the file, never breaks
//! Claude's lock, never rewrites a file it could not parse. Every miss means
//! Claude asks as usual, so nothing here can fail a launch.

use serde::de::{Deserialize, Deserializer, MapAccess, Visitor};
use serde_json::value::RawValue;
use std::collections::HashSet;
use std::fmt;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use unicode_normalization::UnicodeNormalization;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum TrustOutcome {
    Granted,
    Unchanged,
    MissingConfig,
    Locked,
    Unreadable,
}

/// Waits between attempts on Claude's lock; a lock held past these means skip.
const LOCK_RETRY_MS: [u64; 4] = [50, 100, 200, 250];
/// Serializes this process's writers so they never contend with each other for Claude's lock.
static WRITER: Mutex<()> = Mutex::new(());

/// Mirrors Claude Code's global config lookup: a legacy `<config dir>/.config.json`
/// wins, otherwise `.claude.json` sits in the config dir or the home directory.
pub(crate) fn config_file(config_dir: Option<&Path>, home: &Path, custom_oauth: bool) -> PathBuf {
    let config_dir = config_dir.filter(|d| !d.as_os_str().is_empty());
    let legacy = config_dir
        .map(Path::to_path_buf)
        .unwrap_or_else(|| home.join(".claude"))
        .join(".config.json");
    if legacy.exists() {
        return legacy;
    }
    let name = if custom_oauth {
        ".claude-custom-oauth.json"
    } else {
        ".claude.json"
    };
    config_dir.unwrap_or(home).join(name)
}

/// The config file Claude will read when launched with `account_dir` as its
/// `CLAUDE_CONFIG_DIR` (or this process's environment when there is none).
pub(crate) fn launch_config_file(account_dir: Option<&Path>) -> Option<PathBuf> {
    let home = PathBuf::from(crate::dirs_home()?);
    let inherited = std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from);
    let custom_oauth =
        std::env::var_os("CLAUDE_CODE_CUSTOM_OAUTH_URL").is_some_and(|v| !v.is_empty());
    Some(config_file(
        account_dir.or(inherited.as_deref()),
        &home,
        custom_oauth,
    ))
}

/// Claude looks a folder up by its NFC-normalized path, with `/` separators on Windows.
fn trust_key(path: &Path) -> String {
    let text = path.to_string_lossy();
    #[cfg(windows)]
    let text = {
        let text = text.replace('\\', "/");
        match text.strip_prefix("//?/UNC/") {
            Some(unc) => format!("//{unc}"),
            None => text.strip_prefix("//?/").unwrap_or(&text).to_owned(),
        }
    };
    let mut key: String = text.nfc().collect();
    while key.len() > 1 && key.ends_with('/') && !key.ends_with(":/") {
        key.pop();
    }
    key
}

/// Keys for `folder` as Claude will see it: the absolute and the real path.
pub(crate) fn trust_keys(folder: &Path) -> Vec<String> {
    let mut keys = Vec::new();
    for form in [
        std::path::absolute(folder).ok(),
        std::fs::canonicalize(folder).ok(),
    ]
    .into_iter()
    .flatten()
    {
        let key = trust_key(&form);
        if !keys.contains(&key) {
            keys.push(key);
        }
    }
    keys
}

/// A JSON object whose entries keep their order and their original text.
struct Object(Vec<(String, Box<RawValue>)>);

impl<'de> Deserialize<'de> for Object {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Entries;
        impl<'de> Visitor<'de> for Entries {
            type Value = Object;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a JSON object")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Object, A::Error> {
                let mut entries = Vec::new();
                let mut seen = HashSet::new();
                while let Some((key, value)) = map.next_entry::<String, Box<RawValue>>()? {
                    // JSON.parse keeps the last duplicate; refuse rather than guess.
                    if !seen.insert(key.clone()) {
                        return Err(serde::de::Error::custom("duplicate key"));
                    }
                    entries.push((key, value));
                }
                Ok(Object(entries))
            }
        }
        deserializer.deserialize_map(Entries)
    }
}

impl Object {
    fn parse(text: &str) -> Option<Self> {
        if !text.trim_start().starts_with('{') {
            return None;
        }
        serde_json::from_str(text).ok()
    }

    fn get(&self, key: &str) -> Option<&RawValue> {
        self.0.iter().find(|(k, _)| k == key).map(|(_, v)| &**v)
    }

    fn set(&mut self, key: &str, value: Box<RawValue>) {
        match self.0.iter_mut().find(|(k, _)| k == key) {
            Some(entry) => entry.1 = value,
            None => self.0.push((key.to_owned(), value)),
        }
    }

    /// Writes the object as `JSON.stringify(_, null, 2)` would at `depth`, so
    /// untouched values (copied verbatim) keep their indentation.
    fn render(&self, depth: usize) -> Box<RawValue> {
        let text = if self.0.is_empty() {
            "{}".to_owned()
        } else {
            let inner = "  ".repeat(depth + 1);
            let entries: Vec<String> = self
                .0
                .iter()
                .map(|(k, v)| {
                    let key = serde_json::to_string(k).unwrap_or_default();
                    format!("{inner}{key}: {}", v.get())
                })
                .collect();
            format!("{{\n{}\n{}}}", entries.join(",\n"), "  ".repeat(depth))
        };
        RawValue::from_string(text).expect("rendered JSON object")
    }
}

fn raw(text: &str) -> Box<RawValue> {
    RawValue::from_string(text.to_owned()).expect("literal JSON")
}

#[derive(Debug, PartialEq, Eq)]
enum Change {
    Unchanged,
    Refuse,
    Changed(String),
}

fn is_trusted(entry: &RawValue) -> bool {
    serde_json::from_str::<serde_json::Value>(entry.get())
        .ok()
        .and_then(|v| v.get("hasTrustDialogAccepted").cloned())
        == Some(serde_json::Value::Bool(true))
}

/// Sets `projects[key].hasTrustDialogAccepted` for every key, keeping all
/// other text as it was. Pure: runs once to plan and again under the lock.
fn apply_trust(text: &str, keys: &[String]) -> Change {
    let Some(mut config) = Object::parse(text) else {
        return Change::Refuse;
    };
    let mut projects = match config.get("projects") {
        None => Object(Vec::new()),
        Some(value) => match Object::parse(value.get()) {
            Some(projects) => projects,
            None => return Change::Refuse,
        },
    };
    if keys
        .iter()
        .any(|key| projects.get(key).is_some_and(is_trusted))
    {
        return Change::Unchanged;
    }
    for key in keys {
        let entry = projects
            .get(key)
            .and_then(|value| Object::parse(value.get()))
            .unwrap_or(Object(Vec::new()));
        let mut entry = entry;
        entry.set("hasTrustDialogAccepted", raw("true"));
        projects.set(key, entry.render(2));
    }
    config.set("projects", projects.render(1));
    Change::Changed(format!("{}\n", config.render(0).get()))
}

/// Resolves a symlinked config to its target so the rename keeps the link.
fn target(config_file: &Path) -> Result<PathBuf, TrustOutcome> {
    let missing = |e: std::io::Error| {
        if e.kind() == ErrorKind::NotFound {
            TrustOutcome::MissingConfig
        } else {
            TrustOutcome::Unreadable
        }
    };
    let entry = std::fs::symlink_metadata(config_file).map_err(missing)?;
    let path = if entry.file_type().is_symlink() {
        std::fs::canonicalize(config_file).map_err(missing)?
    } else {
        config_file.to_path_buf()
    };
    if std::fs::metadata(&path).map_err(missing)?.is_file() {
        Ok(path)
    } else {
        Err(TrustOutcome::Unreadable)
    }
}

fn read(config_file: &Path) -> Result<(PathBuf, String), TrustOutcome> {
    let path = target(config_file)?;
    let text = std::fs::read_to_string(&path).map_err(|_| TrustOutcome::Unreadable)?;
    Ok((path, text))
}

/// Claude's lock is the directory `<file>.lock` (proper-lockfile). Creating it
/// is the acquire; an existing one is never removed.
struct ClaudeLock(PathBuf);

impl ClaudeLock {
    fn acquire(config_file: &Path) -> Option<Self> {
        let mut path = config_file.as_os_str().to_owned();
        path.push(".lock");
        let path = PathBuf::from(path);
        for wait in std::iter::once(0).chain(LOCK_RETRY_MS) {
            std::thread::sleep(Duration::from_millis(wait));
            match std::fs::create_dir(&path) {
                Ok(()) => return Some(Self(path)),
                Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
                Err(_) => return None,
            }
        }
        None
    }
}

impl Drop for ClaudeLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir(&self.0);
    }
}

/// Removes the replacement file unless it was renamed over the config.
struct Replacement(PathBuf);

impl Drop for Replacement {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn replace(target: &Path, text: &str) -> std::io::Result<()> {
    let mut name = target.as_os_str().to_owned();
    name.push(format!(".monocode-trust-{}.tmp", uuid::Uuid::new_v4()));
    let replacement = Replacement(PathBuf::from(name));
    std::fs::write(&replacement.0, text)?;
    std::fs::set_permissions(&replacement.0, std::fs::metadata(target)?.permissions())?;
    // Windows refuses the rename while another process briefly has the file open.
    let mut result = std::fs::rename(&replacement.0, target);
    for wait in [20, 50, 100] {
        if result.is_ok() || !cfg!(windows) {
            break;
        }
        std::thread::sleep(Duration::from_millis(wait));
        result = std::fs::rename(&replacement.0, target);
    }
    result
}

/// Sets `projects[<folder>].hasTrustDialogAccepted` in Claude's global config.
pub(crate) fn grant(config_file: &Path, keys: &[String]) -> TrustOutcome {
    if keys.is_empty() {
        return TrustOutcome::Unchanged;
    }
    let _writer = WRITER.lock().unwrap_or_else(|e| e.into_inner());
    // Most launches need nothing, so skip Claude's lock unless a write is due.
    let planned = match read(config_file) {
        Ok((_, text)) => apply_trust(&text, keys),
        Err(outcome) => return outcome,
    };
    match planned {
        Change::Unchanged => return TrustOutcome::Unchanged,
        Change::Refuse => return TrustOutcome::Unreadable,
        Change::Changed(_) => {}
    }
    let Some(_lock) = ClaudeLock::acquire(config_file) else {
        return TrustOutcome::Locked;
    };
    let (path, text) = match read(config_file) {
        Ok(current) => current,
        Err(outcome) => return outcome,
    };
    match apply_trust(&text, keys) {
        Change::Unchanged => TrustOutcome::Unchanged,
        Change::Refuse => TrustOutcome::Unreadable,
        Change::Changed(next) => match replace(&path, &next) {
            Ok(()) => TrustOutcome::Granted,
            Err(_) => TrustOutcome::Unreadable,
        },
    }
}

/// Pre-trusts `folder` for a Claude launched with `account_dir` as its config dir.
pub(crate) fn grant_for_launch(account_dir: Option<&Path>, folder: &Path) -> TrustOutcome {
    match launch_config_file(account_dir) {
        Some(config_file) => grant(&config_file, &trust_keys(folder)),
        None => TrustOutcome::MissingConfig,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("monocode-trust-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn keys(list: &[&str]) -> Vec<String> {
        list.iter().map(|k| (*k).to_owned()).collect()
    }

    #[test]
    fn adds_trust_keeping_other_fields_order_and_formatting() {
        let config = "{\n  \"numStartups\": 7,\n  \"projects\": {\n    \"E:/other\": {\n      \"allowedTools\": [],\n      \"hasTrustDialogAccepted\": true\n    },\n    \"E:/repo\": {\n      \"lastCost\": 0.5,\n      \"hasTrustDialogAccepted\": false\n    }\n  },\n  \"autoUpdates\": false\n}\n";
        let Change::Changed(next) = apply_trust(config, &keys(&["E:/repo", "E:/real"])) else {
            panic!("expected a change");
        };
        assert_eq!(
            next,
            "{\n  \"numStartups\": 7,\n  \"projects\": {\n    \"E:/other\": {\n      \"allowedTools\": [],\n      \"hasTrustDialogAccepted\": true\n    },\n    \"E:/repo\": {\n      \"lastCost\": 0.5,\n      \"hasTrustDialogAccepted\": true\n    },\n    \"E:/real\": {\n      \"hasTrustDialogAccepted\": true\n    }\n  },\n  \"autoUpdates\": false\n}\n"
        );
        assert_eq!(apply_trust(&next, &keys(&["E:/repo"])), Change::Unchanged);
    }

    #[test]
    fn adds_projects_when_absent_and_refuses_what_it_cannot_read() {
        let Change::Changed(next) = apply_trust("{\"a\":1}", &keys(&["/repo"])) else {
            panic!("expected a change");
        };
        assert_eq!(
            next,
            "{\n  \"a\": 1,\n  \"projects\": {\n    \"/repo\": {\n      \"hasTrustDialogAccepted\": true\n    }\n  }\n}\n"
        );
        for config in [
            "not json",
            "[1]",
            "{\"projects\": []}",
            "{\"projects\": 3}",
            "{\"a\": 1, \"a\": 2}",
            "{\"projects\": {}} trailing",
        ] {
            assert_eq!(
                apply_trust(config, &keys(&["/repo"])),
                Change::Refuse,
                "{config}"
            );
        }
        // Trust under either key is enough.
        let trusted = "{\"projects\":{\"/real\":{\"hasTrustDialogAccepted\":true}}}";
        assert_eq!(
            apply_trust(trusted, &keys(&["/repo", "/real"])),
            Change::Unchanged
        );
    }

    #[test]
    fn writes_only_an_existing_parsable_unlocked_config() {
        let dir = temp_dir("write");
        let file = dir.join(".claude.json");
        let key = keys(&["/repo"]);
        assert_eq!(grant(&file, &key), TrustOutcome::MissingConfig);
        assert!(!file.exists());

        std::fs::write(&file, "{broken").unwrap();
        assert_eq!(grant(&file, &key), TrustOutcome::Unreadable);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "{broken");

        std::fs::write(&file, "{\"oauthAccount\":{\"emailAddress\":\"x\"}}").unwrap();
        let lock = dir.join(".claude.json.lock");
        std::fs::create_dir(&lock).unwrap();
        assert_eq!(grant(&file, &key), TrustOutcome::Locked);
        assert!(lock.is_dir(), "a held lock is never broken");
        std::fs::remove_dir(&lock).unwrap();

        assert_eq!(grant(&file, &key), TrustOutcome::Granted);
        assert!(!lock.exists(), "our lock is released");
        let written: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(written["oauthAccount"]["emailAddress"], "x");
        assert_eq!(written["projects"]["/repo"]["hasTrustDialogAccepted"], true);
        assert_eq!(grant(&file, &key), TrustOutcome::Unchanged);
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn resolves_the_config_file_claude_reads() {
        let dir = temp_dir("resolve");
        let home = dir.join("home");
        let account = dir.join("account");
        std::fs::create_dir_all(home.join(".claude")).unwrap();
        std::fs::create_dir_all(&account).unwrap();
        assert_eq!(config_file(None, &home, false), home.join(".claude.json"));
        assert_eq!(
            config_file(None, &home, true),
            home.join(".claude-custom-oauth.json")
        );
        assert_eq!(
            config_file(Some(&account), &home, false),
            account.join(".claude.json")
        );
        assert_eq!(
            config_file(Some(Path::new("")), &home, false),
            home.join(".claude.json")
        );
        std::fs::write(account.join(".config.json"), "{}").unwrap();
        assert_eq!(
            config_file(Some(&account), &home, false),
            account.join(".config.json")
        );
        std::fs::write(home.join(".claude").join(".config.json"), "{}").unwrap();
        assert_eq!(
            config_file(None, &home, false),
            home.join(".claude").join(".config.json")
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn keys_use_claude_path_form() {
        let dir = temp_dir("keys");
        let found = trust_keys(&dir);
        assert!(!found.is_empty());
        for key in &found {
            assert!(!key.ends_with('/'));
            #[cfg(windows)]
            {
                assert!(!key.contains('\\'), "{key}");
                assert!(!key.starts_with("//?/"), "{key}");
            }
        }
        #[cfg(windows)]
        {
            assert_eq!(trust_key(Path::new(r"\\?\E:\Repo\")), "E:/Repo");
            assert_eq!(
                trust_key(Path::new(r"\\?\UNC\srv\share\x")),
                "//srv/share/x"
            );
            assert_eq!(trust_key(Path::new(r"E:\")), "E:/");
        }
        // Decomposed é becomes the composed form Claude looks up.
        assert_eq!(trust_key(Path::new("/cafe\u{301}")), "/caf\u{e9}");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
