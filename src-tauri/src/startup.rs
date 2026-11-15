//! Fork (Hari, L-314): Launch on startup. Windows only. The installed app
//! adds itself to the programs that start when the user signs in (the
//! registry's Run key, through tauri-plugin-autostart) and starts hidden in
//! the tray, so the phone can reach the computer without opening a window.
//! Dev builds never add themselves: their exe is a build output that moves.

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

/// What the sign-in launch passes: start in the tray, with no window.
pub const ARG: &str = "--autostart";

/// Whether this run was started at sign-in.
pub fn at_sign_in(argv: &[String]) -> bool {
    argv.iter().any(|arg| arg == ARG)
}

/// Whether Hari starts when the user signs in; None where it can't (dev builds).
#[tauri::command]
pub fn startup_launch_get(app: AppHandle) -> Result<Option<bool>, String> {
    if cfg!(debug_assertions) {
        return Ok(None);
    }
    app.autolaunch()
        .is_enabled()
        .map(Some)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn startup_launch_set(app: AppHandle, on: bool) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("Launch on startup works in the installed app".into());
    }
    let launch = app.autolaunch();
    if on {
        launch.enable()
    } else {
        launch.disable()
    }
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_a_sign_in_launch() {
        let argv = |args: &[&str]| args.iter().map(|arg| arg.to_string()).collect::<Vec<_>>();
        assert!(at_sign_in(&argv(&["hari.exe", ARG])));
        assert!(!at_sign_in(&argv(&["hari.exe"])));
        assert!(!at_sign_in(&argv(&[
            "hari.exe",
            "--share",
            r"C:\files\--autostart.txt"
        ])));
    }
}
