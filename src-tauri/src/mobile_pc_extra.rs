//! Fork (Hari, L-292..L-297): more of the computer from the phone's Control
//! tab: microphone and speaker (`pc.audio`), what's playing (`pc.media`),
//! the camera privacy switch (`pc.camera`), Bluetooth (`pc.bluetooth`),
//! hibernate once idle (`pc.idleHibernate`), and the computer's files,
//! read-only (`pc.files.list`, `pc.files.offer`). Windows only; elsewhere
//! each says so.
//!
//! Hibernate on idle (L-292) is armed here (one flag, shared with the desktop's
//! bottom-bar toggle); the desktop webview watches its sessions and asks
//! [`idle_hibernate_now`] once none has worked for two minutes.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

const IDLE_EVENT: &str = "monocode-idle-hibernate";
/// Entries per page of a folder.
const FILES_PAGE: usize = 200;

static IDLE_ARMED: AtomicBool = AtomicBool::new(false);

// ── Hibernate on idle ────────────────────────────────────────────────────

fn set_armed(app: &AppHandle, armed: bool) {
    IDLE_ARMED.store(armed, Ordering::SeqCst);
    let _ = app.emit(IDLE_EVENT, armed);
}

#[tauri::command]
pub fn idle_hibernate_get() -> bool {
    IDLE_ARMED.load(Ordering::SeqCst)
}

#[tauri::command]
pub fn idle_hibernate_set(app: AppHandle, armed: bool) -> bool {
    set_armed(&app, armed);
    armed
}

/// The webview's countdown ran out: disarm (one-shot) and hibernate.
#[tauri::command]
pub fn idle_hibernate_now(app: AppHandle) -> Result<(), String> {
    if !IDLE_ARMED.load(Ordering::SeqCst) {
        return Err("Hibernate on idle was turned off".into());
    }
    set_armed(&app, false);
    native::hibernate()
}

pub(crate) fn idle_hibernate(app: &AppHandle, params: &Value) -> Result<Value, String> {
    if let Some(armed) = params["armed"].as_bool() {
        set_armed(app, armed);
    }
    Ok(json!({ "armed": IDLE_ARMED.load(Ordering::SeqCst) }))
}

// ── Audio, media, camera, Bluetooth ──────────────────────────────────────

pub(crate) fn audio(params: &Value) -> Result<Value, String> {
    if let Some(muted) = params["micMuted"].as_bool() {
        native::set_mic_muted(muted)?;
    }
    if let Some(muted) = params["speakerMuted"].as_bool() {
        native::set_speaker_muted(muted)?;
    }
    if let Some(volume) = params["volume"].as_f64() {
        native::set_volume(volume.clamp(0.0, 1.0) as f32)?;
    }
    if let Some(id) = params["output"].as_str() {
        native::set_output(id)?;
    }
    native::audio_state()
}

pub(crate) fn media(params: &Value) -> Result<Value, String> {
    if let Some(action) = params["action"].as_str() {
        native::media_action(action)?;
        // The player updates its state a moment after the press.
        std::thread::sleep(std::time::Duration::from_millis(350));
    }
    native::media_state()
}

pub(crate) fn camera(params: &Value) -> Result<Value, String> {
    if let Some(allowed) = params["allowed"].as_bool() {
        native::set_camera_allowed(allowed)?;
    }
    Ok(json!({ "allowed": native::camera_allowed()? }))
}

pub(crate) fn bluetooth(params: &Value) -> Result<Value, String> {
    if let Some(on) = params["on"].as_bool() {
        native::set_bluetooth(on)?;
    }
    native::bluetooth_state()
}

// ── Files (read-only) ────────────────────────────────────────────────────

fn hidden(meta: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM
        meta.file_attributes() & 0x6 != 0
    }
    #[cfg(not(windows))]
    {
        let _ = meta;
        false
    }
}

fn modified_ms(meta: &std::fs::Metadata) -> Option<u64> {
    meta.modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}

/// A folder's folders then files, by name, 200 at a time; hidden and system
/// items skipped. No path: the computer's drives.
pub(crate) fn files_list(params: &Value, drives: Vec<(String, u64, u64)>) -> Result<Value, String> {
    let path = params["path"].as_str().unwrap_or_default().trim();
    if path.is_empty() {
        let entries: Vec<Value> = drives
            .into_iter()
            .map(|(name, free, total)| {
                json!({ "name": name, "path": format!("{name}\\"), "dir": true, "drive": true, "free": free, "total": total })
            })
            .collect();
        return Ok(json!({ "path": "", "parent": null, "entries": entries, "more": false }));
    }
    let dir = PathBuf::from(path);
    if !dir.is_absolute() {
        return Err("Pick a folder from the list".into());
    }
    let read = std::fs::read_dir(&dir).map_err(|e| format!("Couldn't open the folder: {e}"))?;
    let mut entries: Vec<(bool, String, Value)> = Vec::new();
    for entry in read.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if hidden(&meta) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = meta.is_dir();
        entries.push((
            is_dir,
            name.to_lowercase(),
            json!({
                "name": name,
                "path": entry.path().to_string_lossy(),
                "dir": is_dir,
                "size": if is_dir { Value::Null } else { json!(meta.len()) },
                "modified": modified_ms(&meta),
            }),
        ));
    }
    entries.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    let offset = params["offset"].as_u64().unwrap_or(0) as usize;
    let total = entries.len();
    let page: Vec<Value> = entries
        .into_iter()
        .skip(offset)
        .take(FILES_PAGE)
        .map(|(_, _, value)| value)
        .collect();
    let parent = dir
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(json!({
        "path": dir.to_string_lossy(),
        "parent": parent,
        "entries": page,
        "more": offset + FILES_PAGE < total,
        "total": total,
    }))
}

/// Offers one of the computer's files to the phone through Share.
pub(crate) fn files_offer(app: &AppHandle, peer: &str, params: &Value) -> Result<Value, String> {
    let path = params["path"].as_str().unwrap_or_default();
    let file = Path::new(path);
    if !file.is_absolute() || !file.is_file() {
        return Err("That file isn't there any more".into());
    }
    crate::mobile_share::offer_file(app, peer, file)
}

#[cfg(windows)]
mod native {
    use std::ffi::c_void;
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    use serde_json::{json, Value};
    use windows::core::{IUnknown, Interface, GUID, HSTRING, PCWSTR};
    use windows::Devices::Bluetooth::{
        BluetoothConnectionStatus, BluetoothDevice, BluetoothLEDevice,
    };
    use windows::Devices::Enumeration::DeviceInformation;
    use windows::Devices::Radios::{Radio, RadioKind, RadioState};
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{
        eCapture, eCommunications, eConsole, eMultimedia, eRender, EDataFlow, IMMDevice,
        IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
    };
    use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED,
        STGM_READ,
    };
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE};
    use winreg::RegKey;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const CAMERA_KEY: &str =
        r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam";
    /// The undocumented policy config every "set default device" tool uses.
    const POLICY_CONFIG_CLIENT: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);
    const IPOLICY_CONFIG: GUID = GUID::from_u128(0xf8679f50_850a_41cf_9c72_430f290290c8);
    /// `SetDefaultEndpoint`'s place in IPolicyConfig's table (after IUnknown's three).
    const SET_DEFAULT_ENDPOINT_SLOT: usize = 13;

    fn err(context: &str, error: windows::core::Error) -> String {
        format!("{context}: {}", error.message())
    }

    fn com() {
        // SAFETY: joins this blocking thread to the multithreaded apartment;
        // a second call on the same thread just returns S_FALSE.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
    }

    fn enumerator() -> Result<IMMDeviceEnumerator, String> {
        com();
        // SAFETY: a plain COM activation.
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
            .map_err(|e| err("Sound devices unavailable", e))
    }

    fn default_device(flow: EDataFlow) -> Result<IMMDevice, String> {
        // SAFETY: COM calls on a live enumerator.
        unsafe { enumerator()?.GetDefaultAudioEndpoint(flow, eConsole) }
            .map_err(|e| err("No sound device", e))
    }

    fn endpoint_volume(flow: EDataFlow) -> Result<IAudioEndpointVolume, String> {
        let device = default_device(flow)?;
        // SAFETY: activating a documented interface on a live device.
        unsafe { device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) }
            .map_err(|e| err("Volume unavailable", e))
    }

    fn device_id(device: &IMMDevice) -> Option<String> {
        // SAFETY: GetId returns a CoTaskMem string we free after copying.
        unsafe {
            let id = device.GetId().ok()?;
            let text = id.to_string().ok();
            CoTaskMemFree(Some(id.0 as *const c_void));
            text
        }
    }

    fn device_name(device: &IMMDevice) -> Option<String> {
        // SAFETY: reading one documented property; the string is freed after copying.
        unsafe {
            let store = device.OpenPropertyStore(STGM_READ).ok()?;
            let value = store.GetValue(&PKEY_Device_FriendlyName).ok()?;
            let text = PropVariantToStringAlloc(&value).ok()?;
            let name = text.to_string().ok();
            CoTaskMemFree(Some(text.0 as *const c_void));
            name
        }
    }

    pub fn set_mic_muted(muted: bool) -> Result<(), String> {
        let volume = endpoint_volume(eCapture)?;
        // SAFETY: COM call on a live interface.
        unsafe { volume.SetMute(muted, std::ptr::null()) }
            .map_err(|e| err("Couldn't change the microphone", e))
    }

    pub fn set_speaker_muted(muted: bool) -> Result<(), String> {
        let volume = endpoint_volume(eRender)?;
        // SAFETY: COM call on a live interface.
        unsafe { volume.SetMute(muted, std::ptr::null()) }
            .map_err(|e| err("Couldn't change the sound", e))
    }

    pub fn set_volume(level: f32) -> Result<(), String> {
        let volume = endpoint_volume(eRender)?;
        // SAFETY: COM call on a live interface.
        unsafe { volume.SetMasterVolumeLevelScalar(level, std::ptr::null()) }
            .map_err(|e| err("Couldn't change the volume", e))
    }

    pub fn set_output(id: &str) -> Result<(), String> {
        com();
        let wide: Vec<u16> = id.encode_utf16().chain(std::iter::once(0)).collect();
        // SAFETY: IPolicyConfig is undocumented but stable since Windows 7;
        // we call only SetDefaultEndpoint through its table, with a valid
        // nul-terminated id, and release the reference we took.
        unsafe {
            let unknown: IUnknown = CoCreateInstance(&POLICY_CONFIG_CLIENT, None, CLSCTX_ALL)
                .map_err(|e| err("Couldn't switch the sound output", e))?;
            let mut raw: *mut c_void = std::ptr::null_mut();
            unknown
                .query(&IPOLICY_CONFIG, &mut raw)
                .ok()
                .map_err(|e| err("Couldn't switch the sound output", e))?;
            let table = *(raw as *const *const usize);
            type SetDefault =
                unsafe extern "system" fn(*mut c_void, PCWSTR, i32) -> windows::core::HRESULT;
            type Release = unsafe extern "system" fn(*mut c_void) -> u32;
            let set_default: SetDefault =
                std::mem::transmute(*table.add(SET_DEFAULT_ENDPOINT_SLOT));
            let release: Release = std::mem::transmute(*table.add(2));
            let mut result = Ok(());
            for role in [eConsole, eMultimedia, eCommunications] {
                let hr = set_default(raw, PCWSTR(wide.as_ptr()), role.0);
                if hr.is_err() {
                    result = Err(err("Couldn't switch the sound output", hr.into()));
                }
            }
            release(raw);
            result
        }
    }

    pub fn audio_state() -> Result<Value, String> {
        let mic = endpoint_volume(eCapture)
            .ok()
            // SAFETY: COM call on a live interface.
            .and_then(|v| unsafe { v.GetMute() }.ok())
            .map(|m| m.as_bool());
        let speaker = endpoint_volume(eRender)?;
        // SAFETY: COM calls on a live interface.
        let (muted, level) = unsafe {
            (
                speaker.GetMute().map(|m| m.as_bool()).unwrap_or(false),
                speaker.GetMasterVolumeLevelScalar().unwrap_or(0.0),
            )
        };
        let default_id = default_device(eRender).ok().and_then(|d| device_id(&d));
        let mut outputs = Vec::new();
        // SAFETY: COM calls on a live enumerator and collection.
        unsafe {
            if let Ok(list) = enumerator()?.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) {
                for index in 0..list.GetCount().unwrap_or(0) {
                    let Ok(device) = list.Item(index) else {
                        continue;
                    };
                    let Some(id) = device_id(&device) else {
                        continue;
                    };
                    let name = device_name(&device).unwrap_or_else(|| "Sound output".into());
                    outputs.push(json!({ "id": id, "name": name, "default": Some(&id) == default_id.as_ref() }));
                }
            }
        }
        Ok(json!({
            "micMuted": mic,
            "speakerMuted": muted,
            "volume": level,
            "outputs": outputs,
        }))
    }

    fn manager() -> Result<Manager, String> {
        com();
        Manager::RequestAsync()
            .and_then(|op| op.join())
            .map_err(|e| err("Media controls unavailable", e))
    }

    pub fn media_action(action: &str) -> Result<(), String> {
        let session = manager()?
            .GetCurrentSession()
            .map_err(|_| "Nothing is playing".to_string())?;
        let op = match action {
            "playPause" => session.TryTogglePlayPauseAsync(),
            "next" => session.TrySkipNextAsync(),
            "previous" => session.TrySkipPreviousAsync(),
            _ => return Err("Unknown media action".into()),
        };
        let done = op
            .and_then(|op| op.join())
            .map_err(|e| err("The player didn't respond", e))?;
        if done {
            Ok(())
        } else {
            Err("The player didn't take that".into())
        }
    }

    fn app_name(id: &str) -> String {
        let last = id.rsplit(['!', '\\']).next().unwrap_or(id);
        let name = last.trim_end_matches(".exe").trim_end_matches(".EXE");
        match name.to_lowercase().as_str() {
            "app" | "" => id.split(['_', '.']).next().unwrap_or(id).to_string(),
            _ => {
                let mut chars = name.chars();
                chars
                    .next()
                    .map(|c| c.to_uppercase().collect::<String>() + chars.as_str())
                    .unwrap_or_default()
            }
        }
    }

    pub fn media_state() -> Result<Value, String> {
        let Ok(session) = manager()?.GetCurrentSession() else {
            return Ok(json!({ "playing": false, "title": null }));
        };
        let props = session
            .TryGetMediaPropertiesAsync()
            .and_then(|op| op.join())
            .ok();
        let title = props
            .as_ref()
            .and_then(|p| p.Title().ok())
            .map(|t| t.to_string());
        let artist = props
            .as_ref()
            .and_then(|p| p.Artist().ok())
            .map(|t| t.to_string());
        let playing = session
            .GetPlaybackInfo()
            .and_then(|info| info.PlaybackStatus())
            .map(|status| status == Status::Playing)
            .unwrap_or(false);
        let app = session
            .SourceAppUserModelId()
            .map(|id| app_name(&id.to_string()))
            .ok();
        Ok(json!({
            "playing": playing,
            "title": title.filter(|t| !t.is_empty()),
            "artist": artist.filter(|a| !a.is_empty()),
            "app": app,
        }))
    }

    pub fn camera_allowed() -> Result<bool, String> {
        let key = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags(CAMERA_KEY, KEY_READ)
            .map_err(|_| "Camera setting unavailable".to_string())?;
        let value: String = key.get_value("Value").unwrap_or_else(|_| "Allow".into());
        Ok(!value.eq_ignore_ascii_case("Deny"))
    }

    pub fn set_camera_allowed(allowed: bool) -> Result<(), String> {
        let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey_with_flags(CAMERA_KEY, KEY_SET_VALUE)
            .map_err(|e| format!("Couldn't change the camera setting: {e}"))?;
        key.set_value("Value", &if allowed { "Allow" } else { "Deny" })
            .map_err(|e| format!("Couldn't change the camera setting: {e}"))
    }

    fn bluetooth_radio() -> Result<Option<Radio>, String> {
        com();
        let radios = Radio::GetRadiosAsync()
            .and_then(|op| op.join())
            .map_err(|e| err("Bluetooth unavailable", e))?;
        for index in 0..radios.Size().unwrap_or(0) {
            if let Ok(radio) = radios.GetAt(index) {
                if radio.Kind().ok() == Some(RadioKind::Bluetooth) {
                    return Ok(Some(radio));
                }
            }
        }
        Ok(None)
    }

    pub fn set_bluetooth(on: bool) -> Result<(), String> {
        let _ = Radio::RequestAccessAsync().and_then(|op| op.join());
        let radio = bluetooth_radio()?.ok_or("This computer has no Bluetooth")?;
        let state = if on { RadioState::On } else { RadioState::Off };
        let status = radio
            .SetStateAsync(state)
            .and_then(|op| op.join())
            .map_err(|e| err("Couldn't switch Bluetooth", e))?;
        if status == windows::Devices::Radios::RadioAccessStatus::Allowed {
            Ok(())
        } else {
            Err("Windows didn't allow switching Bluetooth from here".into())
        }
    }

    fn paired(selector: windows::core::Result<HSTRING>, classic: bool) -> Vec<(String, bool)> {
        let Ok(selector) = selector else {
            return Vec::new();
        };
        let Ok(found) =
            DeviceInformation::FindAllAsyncAqsFilter(&selector).and_then(|op| op.join())
        else {
            return Vec::new();
        };
        let mut devices = Vec::new();
        for index in 0..found.Size().unwrap_or(0) {
            let Ok(info) = found.GetAt(index) else {
                continue;
            };
            let Ok(id) = info.Id() else { continue };
            let name = info.Name().map(|n| n.to_string()).unwrap_or_default();
            let connected = if classic {
                BluetoothDevice::FromIdAsync(&id)
                    .and_then(|op| op.join())
                    .and_then(|d| d.ConnectionStatus())
                    .map(|s| s == BluetoothConnectionStatus::Connected)
                    .unwrap_or(false)
            } else {
                BluetoothLEDevice::FromIdAsync(&id)
                    .and_then(|op| op.join())
                    .and_then(|d| d.ConnectionStatus())
                    .map(|s| s == BluetoothConnectionStatus::Connected)
                    .unwrap_or(false)
            };
            if !name.trim().is_empty() {
                devices.push((name, connected));
            }
        }
        devices
    }

    pub fn bluetooth_state() -> Result<Value, String> {
        let Some(radio) = bluetooth_radio()? else {
            return Ok(json!({ "available": false, "on": false, "devices": [] }));
        };
        let on = radio.State().ok() == Some(RadioState::On);
        let mut devices = paired(
            BluetoothDevice::GetDeviceSelectorFromPairingState(true),
            true,
        );
        for (name, connected) in paired(
            BluetoothLEDevice::GetDeviceSelectorFromPairingState(true),
            false,
        ) {
            match devices.iter_mut().find(|(known, _)| *known == name) {
                Some(entry) => entry.1 |= connected,
                None => devices.push((name, connected)),
            }
        }
        devices.sort_by(|a, b| {
            b.1.cmp(&a.1)
                .then_with(|| a.0.to_lowercase().cmp(&b.0.to_lowercase()))
        });
        let devices: Vec<Value> = devices
            .into_iter()
            .map(|(name, connected)| json!({ "name": name, "connected": connected }))
            .collect();
        Ok(json!({ "available": true, "on": on, "devices": devices }))
    }

    pub fn hibernate() -> Result<(), String> {
        let windir = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        Command::new(format!(r"{windir}\System32\shutdown.exe"))
            .arg("/h")
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

#[cfg(not(windows))]
mod native {
    use serde_json::Value;

    const ONLY_WINDOWS: &str = "Only on Windows";

    pub fn set_mic_muted(_muted: bool) -> Result<(), String> {
        Err(ONLY_WINDOWS.into())
    }
    pub fn set_speaker_muted(_muted: bool) -> Result<(), String> {
        Err(ONLY_WINDOWS.into())
    }
    pub fn set_volume(_level: f32) -> Result<(), String> {
        Err(ONLY_WINDOWS.into())
    }
    pub fn set_output(_id: &str) -> Result<(), String> {
        Err(ONLY_WINDOWS.into())
    }
    pub fn audio_state() -> Result<Value, String> {
        Err(ONLY_WINDOWS.into())
    }
    pub fn media_action(_action: &str) -> Result<(), String> {
        Err(ONLY_WINDOWS.into())
    }
    pub fn media_state() -> Result<Value, String> {
        Err(ONLY_WINDOWS.into())
    }
    pub fn camera_allowed() -> Result<bool, String> {
        Err(ONLY_WINDOWS.into())
    }
    pub fn set_camera_allowed(_allowed: bool) -> Result<(), String> {
        Err(ONLY_WINDOWS.into())
    }
    pub fn set_bluetooth(_on: bool) -> Result<(), String> {
        Err(ONLY_WINDOWS.into())
    }
    pub fn bluetooth_state() -> Result<Value, String> {
        Err(ONLY_WINDOWS.into())
    }
    pub fn hibernate() -> Result<(), String> {
        Err(ONLY_WINDOWS.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_path_lists_the_drives() {
        let answer = files_list(&json!({}), vec![("C:".into(), 10, 100)]).unwrap();
        assert_eq!(answer["entries"][0]["path"], "C:\\");
        assert_eq!(answer["entries"][0]["drive"], true);
    }

    #[test]
    fn a_relative_path_is_refused() {
        assert!(files_list(&json!({ "path": "Users" }), Vec::new()).is_err());
    }

    #[test]
    fn folders_come_before_files() {
        let dir = std::env::temp_dir().join(format!("hari-files-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("b-folder")).unwrap();
        std::fs::write(dir.join("a-file.txt"), "x").unwrap();
        let answer = files_list(&json!({ "path": dir.to_string_lossy() }), Vec::new()).unwrap();
        assert_eq!(answer["entries"][0]["name"], "b-folder");
        assert_eq!(answer["entries"][1]["name"], "a-file.txt");
        assert_eq!(answer["entries"][1]["size"], 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
