//! The Browser (L-203, L-207): web pages drawn inside the main window as child
//! webviews, one per Browser tab. The frontend owns the toolbar and tells this
//! module where the page area sits (physical pixels) and when to show or hide
//! it, since a native view always paints above MonoCode's own menus and dialogs.
//!
//! Pages are remote origins, so the app's capabilities (local origin only)
//! give them no IPC access. They run in their own WebView2 profile
//! (`browser-profile`), so saved passwords and cookies never mix with
//! MonoCode's own webview. On Windows the Chrome DevTools Protocol supplies
//! screenshots, console and network rows, and the pick tool's bridge.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Rect, Runtime, State, Url,
    Webview, WebviewBuilder, WebviewUrl,
};

const LABEL_PREFIX: &str = "monocode-browser-";
const HOST_WINDOW: &str = "main";
const STATE_EVENT: &str = "browser://state";
const PICK_EVENT: &str = "browser://pick";
const DEVTOOLS_EVENT: &str = "browser://devtools";
const DOWNLOAD_EVENT: &str = "browser://download";
const NEW_TAB_EVENT: &str = "browser://new-tab";
const BRIDGE: &str = "__monocodeBridge";
const PICKER_JS: &str = include_str!("browser_picker.js");
/// A page can call the bridge too; anything bigger than real picks is dropped.
const MAX_BRIDGE_BYTES: usize = 128 * 1024;

/// Which Browser tab is on screen, whether the page area is showing, which
/// tabs have the pick tool on, and the Browser profile's main process (for
/// the process monitor).
#[derive(Default)]
pub struct BrowserTabs(Mutex<TabsState>);

#[derive(Default)]
struct TabsState {
    active: Option<u32>,
    visible: bool,
    picking: HashMap<u32, String>,
    browser_pid: Option<u32>,
}

impl BrowserTabs {
    fn lock(&self) -> std::sync::MutexGuard<'_, TabsState> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub(crate) fn browser_pid(&self) -> Option<u32> {
        self.lock().browser_pid
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct BrowserBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl BrowserBounds {
    fn rect(self) -> Rect {
        Rect {
            position: PhysicalPosition::new(self.x.round() as i32, self.y.round() as i32).into(),
            size: PhysicalSize::new(
                self.width.round().max(1.0) as u32,
                self.height.round().max(1.0) as u32,
            )
            .into(),
        }
    }
}

/// A screenshot region in CSS pixels, page (document) coordinates.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct BrowserClip {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserState {
    tab: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    loading: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    zoom: Option<f64>,
}

/// Only web pages open here; anything else (file:, javascript:, custom
/// schemes) is refused rather than handed to the webview.
pub(crate) fn parse_web_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw.trim()).map_err(|error| format!("Invalid address: {error}"))?;
    match url.scheme() {
        "http" | "https" => Ok(url),
        "about" if url.as_str() == "about:blank" => Ok(url),
        other => Err(format!("The browser opens http and https pages, not {other}:")),
    }
}

fn label(tab: u32) -> String {
    format!("{LABEL_PREFIX}{tab}")
}

fn tab_of(label: &str) -> Option<u32> {
    label.strip_prefix(LABEL_PREFIX)?.parse().ok()
}

fn emit_state<R: Runtime>(app: &AppHandle<R>, state: BrowserState) {
    let _ = app.emit_to(HOST_WINDOW, STATE_EVENT, state);
}

fn tab_view<R: Runtime>(app: &AppHandle<R>, tab: u32) -> Result<Webview<R>, String> {
    app.get_webview(&label(tab))
        .ok_or_else(|| "That browser tab is not open".to_string())
}

fn picker_script(mode: &str) -> String {
    format!(
        "{PICKER_JS}\n;window.__monocodePicker && window.__monocodePicker.start({});",
        json!(mode)
    )
}

fn create<R: Runtime>(
    app: &AppHandle<R>,
    tab: u32,
    url: Url,
    bounds: BrowserBounds,
) -> Result<Webview<R>, String> {
    let window = app
        .get_window(HOST_WINDOW)
        .ok_or_else(|| "The main window is not open".to_string())?;
    let profile = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("browser-profile");
    let load_app = app.clone();
    let title_app = app.clone();
    let download_app = app.clone();
    let popup_app = app.clone();
    let builder = WebviewBuilder::new(label(tab), WebviewUrl::External(url))
        .background_color(tauri::window::Color(255, 255, 255, 255))
        .data_directory(profile)
        .zoom_hotkeys_enabled(true)
        .on_navigation(|url| matches!(url.scheme(), "http" | "https" | "about" | "data" | "blob"))
        .on_page_load(move |webview, payload| {
            let loading = matches!(payload.event(), PageLoadEvent::Started);
            emit_state(
                &load_app,
                BrowserState {
                    tab,
                    url: Some(payload.url().to_string()),
                    loading: Some(loading),
                    ..Default::default()
                },
            );
            // A new page drops the injected tool; put it back while it is on.
            if !loading {
                let mode = webview.state::<BrowserTabs>().lock().picking.get(&tab).cloned();
                if let Some(mode) = mode {
                    let _ = webview.eval(picker_script(&mode));
                }
            }
        })
        .on_document_title_changed(move |_webview, title| {
            emit_state(
                &title_app,
                BrowserState {
                    tab,
                    title: Some(title),
                    ..Default::default()
                },
            );
        })
        // Files go to the user's Downloads folder (WebView2's default); the
        // frontend shows a notice when each one starts and ends.
        .on_download(move |_webview, event| {
            let payload = match event {
                DownloadEvent::Requested { url, destination } => json!({
                    "tab": tab,
                    "url": url.as_str(),
                    "path": destination.display().to_string(),
                    "status": "started",
                }),
                DownloadEvent::Finished { url, path, success } => json!({
                    "tab": tab,
                    "url": url.as_str(),
                    "path": path.map(|p| p.display().to_string()),
                    "status": if success { "done" } else { "failed" },
                }),
                _ => return true,
            };
            let _ = download_app.emit_to(HOST_WINDOW, DOWNLOAD_EVENT, payload);
            true
        })
        // Links that ask for a new window open as a new Browser tab.
        .on_new_window(move |url, _features| {
            if parse_web_url(url.as_str()).is_ok() {
                let _ = popup_app.emit_to(HOST_WINDOW, NEW_TAB_EVENT, json!({ "url": url.as_str() }));
            }
            NewWindowResponse::Deny
        });
    let rect = bounds.rect();
    let webview = window
        .add_child(builder, rect.position, rect.size)
        .map_err(|error| error.to_string())?;
    #[cfg(windows)]
    native::setup(&webview, tab);
    Ok(webview)
}

/// Shows `tab` and hides (and, on Windows, suspends) every other Browser tab.
fn activate<R: Runtime>(
    app: &AppHandle<R>,
    tabs: &BrowserTabs,
    tab: u32,
    bounds: Option<BrowserBounds>,
) -> Result<(), String> {
    let visible = {
        let mut state = tabs.lock();
        state.active = Some(tab);
        state.visible
    };
    for (name, webview) in app.webviews() {
        let Some(id) = tab_of(&name) else { continue };
        if id == tab {
            if let Some(bounds) = bounds {
                webview.set_bounds(bounds.rect()).map_err(|e| e.to_string())?;
            }
            #[cfg(windows)]
            native::resume(&webview);
            if visible { webview.show() } else { webview.hide() }.map_err(|e| e.to_string())?;
        } else {
            let _ = webview.hide();
            #[cfg(windows)]
            native::suspend(&webview);
        }
    }
    Ok(())
}

/// Opens `url` in browser tab `tab`, creating its page on first use, and makes
/// it the shown tab. Async so the webview is built off the main thread's
/// command loop (a sync command deadlocks on Windows when it creates a webview).
#[tauri::command]
pub async fn browser_open(
    app: AppHandle,
    tabs: State<'_, BrowserTabs>,
    tab: u32,
    url: String,
    bounds: BrowserBounds,
) -> Result<(), String> {
    let url = parse_web_url(&url)?;
    tabs.lock().visible = true;
    match app.get_webview(&label(tab)) {
        Some(webview) => webview.navigate(url).map_err(|e| e.to_string())?,
        None => {
            create(&app, tab, url, bounds)?;
        }
    }
    activate(&app, &tabs, tab, Some(bounds))
}

/// Switches to a tab that already has a page.
#[tauri::command]
pub async fn browser_select(
    app: AppHandle,
    tabs: State<'_, BrowserTabs>,
    tab: u32,
) -> Result<bool, String> {
    if app.get_webview(&label(tab)).is_none() {
        return Ok(false);
    }
    activate(&app, &tabs, tab, None)?;
    Ok(true)
}

#[tauri::command]
pub async fn browser_set_bounds(
    app: AppHandle,
    tabs: State<'_, BrowserTabs>,
    bounds: BrowserBounds,
) -> Result<(), String> {
    let Some(tab) = tabs.lock().active else {
        return Ok(());
    };
    match app.get_webview(&label(tab)) {
        Some(webview) => webview.set_bounds(bounds.rect()).map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

#[tauri::command]
pub async fn browser_set_visible(
    app: AppHandle,
    tabs: State<'_, BrowserTabs>,
    visible: bool,
) -> Result<(), String> {
    let active = {
        let mut state = tabs.lock();
        state.visible = visible;
        state.active
    };
    let Some(webview) = active.and_then(|tab| app.get_webview(&label(tab))) else {
        return Ok(());
    };
    if visible { webview.show() } else { webview.hide() }.map_err(|e| e.to_string())
}

/// `action` is "back", "forward", "reload" or "hardReload" (skips the cache).
#[tauri::command]
pub async fn browser_history(app: AppHandle, tab: u32, action: String) -> Result<(), String> {
    let webview = tab_view(&app, tab)?;
    match action.as_str() {
        "back" => webview.eval("history.back()"),
        "forward" => webview.eval("history.forward()"),
        "reload" => webview.reload(),
        "hardReload" => {
            #[cfg(windows)]
            {
                return native::cdp(&webview, "Page.reload", json!({ "ignoreCache": true }))
                    .await
                    .map(|_| ());
            }
            #[cfg(not(windows))]
            webview.reload()
        }
        other => return Err(format!("Unknown browser action: {other}")),
    }
    .map_err(|e| e.to_string())
}

/// Closes one tab's page, or every Browser page when `tab` is absent.
#[tauri::command]
pub async fn browser_close(
    app: AppHandle,
    tabs: State<'_, BrowserTabs>,
    tab: Option<u32>,
) -> Result<(), String> {
    for (name, webview) in app.webviews() {
        let Some(id) = tab_of(&name) else { continue };
        if tab.is_none_or(|t| t == id) {
            webview.close().map_err(|e| e.to_string())?;
            let mut state = tabs.lock();
            state.picking.remove(&id);
            if state.active == Some(id) {
                state.active = None;
            }
        }
    }
    Ok(())
}

/// Page zoom; 1.0 is 100%.
#[tauri::command]
pub async fn browser_zoom(app: AppHandle, tab: u32, factor: f64) -> Result<(), String> {
    let factor = if factor.is_finite() { factor.clamp(0.25, 5.0) } else { 1.0 };
    tab_view(&app, tab)?
        .set_zoom(factor)
        .map_err(|e| e.to_string())?;
    emit_state(
        &app,
        BrowserState {
            tab,
            zoom: Some(factor),
            ..Default::default()
        },
    );
    Ok(())
}

/// Opens Edge DevTools for the tab in its own window.
#[tauri::command]
pub async fn browser_devtools(app: AppHandle, tab: u32) -> Result<(), String> {
    let webview = tab_view(&app, tab)?;
    #[cfg(windows)]
    return native::open_devtools(&webview);
    #[cfg(not(windows))]
    {
        let _ = webview;
        Err("Inspect is available on Windows for now".into())
    }
}

/// A PNG of the visible page, or of `clip`, as base64.
#[tauri::command]
pub async fn browser_screenshot(
    app: AppHandle,
    tab: u32,
    clip: Option<BrowserClip>,
) -> Result<String, String> {
    let webview = tab_view(&app, tab)?;
    #[cfg(windows)]
    {
        let params = match clip {
            Some(c) if c.width >= 1.0 && c.height >= 1.0 => json!({
                "format": "png",
                "clip": { "x": c.x, "y": c.y, "width": c.width, "height": c.height, "scale": 1 },
            }),
            _ => json!({ "format": "png" }),
        };
        let result = native::cdp(&webview, "Page.captureScreenshot", params).await?;
        result["data"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| "The page returned no image".to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = (webview, clip);
        Err("Screenshots are available on Windows for now".into())
    }
}

/// Turns the pick tool on ("element" or "area") or off for a tab.
#[tauri::command]
pub async fn browser_pick(
    app: AppHandle,
    tabs: State<'_, BrowserTabs>,
    tab: u32,
    mode: String,
) -> Result<(), String> {
    let webview = tab_view(&app, tab)?;
    match mode.as_str() {
        "element" | "area" => {
            tabs.lock().picking.insert(tab, mode.clone());
            webview.eval(picker_script(&mode)).map_err(|e| e.to_string())
        }
        "off" => {
            tabs.lock().picking.remove(&tab);
            webview
                .eval("window.__monocodePicker && window.__monocodePicker.stop()")
                .map_err(|e| e.to_string())
        }
        other => Err(format!("Unknown pick mode: {other}")),
    }
}

/// The body of a network response, fetched only when the user attaches it.
#[tauri::command]
pub async fn browser_response_body(
    app: AppHandle,
    tab: u32,
    request_id: String,
) -> Result<Value, String> {
    let webview = tab_view(&app, tab)?;
    #[cfg(windows)]
    return native::cdp(
        &webview,
        "Network.getResponseBody",
        json!({ "requestId": request_id }),
    )
    .await;
    #[cfg(not(windows))]
    {
        let _ = (webview, request_id);
        Err("Response bodies are available on Windows for now".into())
    }
}

/// Local web servers to suggest in the address bar.
#[tauri::command(async)]
pub fn browser_local_servers() -> Vec<crate::browser_servers::LocalServer> {
    crate::browser_servers::listening()
}

fn on_bridge<R: Runtime>(app: &AppHandle<R>, tab: u32, params: &Value) {
    if params["name"].as_str() != Some(BRIDGE) {
        return;
    }
    let Some(payload) = params["payload"].as_str() else { return };
    if payload.len() > MAX_BRIDGE_BYTES {
        return;
    }
    let tabs = app.state::<BrowserTabs>();
    if !tabs.lock().picking.contains_key(&tab) {
        return;
    }
    let Ok(data) = serde_json::from_str::<Value>(payload) else { return };
    match data["kind"].as_str() {
        Some("picks") => {}
        // An area capture and Escape both end the tool.
        Some("area") | Some("cancel") => {
            tabs.lock().picking.remove(&tab);
        }
        _ => return,
    }
    let _ = app.emit_to(HOST_WINDOW, PICK_EVENT, json!({ "tab": tab, "data": data }));
}

fn on_cdp_event<R: Runtime>(app: &AppHandle<R>, tab: u32, event: &str, json: &str) {
    let Ok(params) = serde_json::from_str::<Value>(json) else { return };
    if event == "Runtime.bindingCalled" {
        on_bridge(app, tab, &params);
        return;
    }
    if let Some(entry) = devtools_entry(event, &params) {
        let _ = app.emit_to(HOST_WINDOW, DEVTOOLS_EVENT, json!({ "tab": tab, "entry": entry }));
    }
}

fn cap(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max).collect();
    out.push('…');
    out
}

/// One console argument as text: strings as-is, objects from their preview.
fn remote_text(object: &Value) -> String {
    if object["type"] == "string" {
        return object["value"].as_str().unwrap_or_default().to_string();
    }
    if let Some(value) = object.get("unserializableValue").and_then(Value::as_str) {
        return value.to_string();
    }
    if let Some(props) = object["preview"]["properties"].as_array() {
        let fields: Vec<String> = props
            .iter()
            .map(|p| {
                format!(
                    "{}: {}",
                    p["name"].as_str().unwrap_or("?"),
                    p["value"].as_str().unwrap_or(p["type"].as_str().unwrap_or("?"))
                )
            })
            .collect();
        let open = if object["subtype"] == "array" { "[" } else { "{" };
        let close = if open == "[" { "]" } else { "}" };
        let more = if object["preview"]["overflow"] == true { ", …" } else { "" };
        return format!("{open}{}{more}{close}", fields.join(", "));
    }
    if let Some(value) = object.get("value") {
        return value.to_string();
    }
    object["description"]
        .as_str()
        .or(object["type"].as_str())
        .unwrap_or_default()
        .to_string()
}

fn source_of(url: &Value, line: &Value) -> Value {
    match (url.as_str(), line.as_i64()) {
        (Some(url), Some(line)) if !url.is_empty() => json!(format!("{}:{}", cap(url, 300), line + 1)),
        (Some(url), None) if !url.is_empty() => json!(cap(url, 300)),
        _ => Value::Null,
    }
}

/// A compact console or network row from a CDP event, or None for events the
/// panel does not show. Long text is cut so one noisy page cannot flood IPC.
pub(crate) fn devtools_entry(event: &str, p: &Value) -> Option<Value> {
    match event {
        "Runtime.consoleAPICalled" => {
            let level = match p["type"].as_str().unwrap_or("log") {
                "warning" => "warn",
                "error" | "assert" => "error",
                "info" => "info",
                "debug" => "debug",
                _ => "log",
            };
            let text = p["args"]
                .as_array()
                .map(|args| args.iter().map(remote_text).collect::<Vec<_>>().join(" "))
                .unwrap_or_default();
            let frame = &p["stackTrace"]["callFrames"][0];
            Some(json!({
                "kind": "console",
                "level": level,
                "text": cap(&text, 4000),
                "source": source_of(&frame["url"], &frame["lineNumber"]),
            }))
        }
        "Runtime.exceptionThrown" => {
            let d = &p["exceptionDetails"];
            let text = d["exception"]["description"]
                .as_str()
                .or(d["text"].as_str())
                .unwrap_or("Uncaught error");
            Some(json!({
                "kind": "console",
                "level": "error",
                "text": cap(text, 4000),
                "source": source_of(&d["url"], &d["lineNumber"]),
            }))
        }
        "Log.entryAdded" => {
            let e = &p["entry"];
            let level = match e["level"].as_str().unwrap_or("info") {
                "error" => "error",
                "warning" => "warn",
                "verbose" => "debug",
                _ => "info",
            };
            Some(json!({
                "kind": "console",
                "level": level,
                "text": cap(e["text"].as_str().unwrap_or_default(), 4000),
                "source": source_of(&e["url"], &e["lineNumber"]),
            }))
        }
        "Network.requestWillBeSent" => {
            let r = &p["request"];
            Some(json!({
                "kind": "request",
                "id": p["requestId"],
                "method": r["method"],
                "url": cap(r["url"].as_str().unwrap_or_default(), 2000),
                "type": p["type"],
                "postData": r["postData"].as_str().map(|s| cap(s, 8000)),
            }))
        }
        "Network.responseReceived" => {
            let r = &p["response"];
            Some(json!({
                "kind": "response",
                "id": p["requestId"],
                "status": r["status"],
                "statusText": r["statusText"],
                "mimeType": r["mimeType"],
            }))
        }
        "Network.loadingFailed" => Some(json!({
            "kind": "failed",
            "id": p["requestId"],
            "error": p["errorText"],
            "canceled": p["canceled"],
        })),
        "Network.loadingFinished" => Some(json!({
            "kind": "finished",
            "id": p["requestId"],
            "size": p["encodedDataLength"],
        })),
        _ => None,
    }
}

#[cfg(windows)]
mod native {
    use super::{emit_state, on_cdp_event, BrowserState, BrowserTabs, BRIDGE};
    use serde_json::Value;
    use std::time::Duration;
    use tauri::{Manager, Runtime, Webview};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2, ICoreWebView2Settings4, ICoreWebView2_3,
    };
    use webview2_com::{
        take_pwstr, CallDevToolsProtocolMethodCompletedHandler,
        DevToolsProtocolEventReceivedEventHandler, TrySuspendCompletedHandler,
        ZoomFactorChangedEventHandler,
    };
    use windows_core::{Interface, HSTRING, PWSTR};

    const EVENTS: [&str; 8] = [
        "Runtime.bindingCalled",
        "Runtime.consoleAPICalled",
        "Runtime.exceptionThrown",
        "Log.entryAdded",
        "Network.requestWillBeSent",
        "Network.responseReceived",
        "Network.loadingFailed",
        "Network.loadingFinished",
    ];

    unsafe fn subscribe(
        core: &ICoreWebView2,
        event: &'static str,
        mut on_event: impl FnMut(String) + 'static,
    ) -> windows_core::Result<()> {
        let receiver = core.GetDevToolsProtocolEventReceiver(&HSTRING::from(event))?;
        let handler = DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_, args| {
            if let Some(args) = args {
                let mut json = PWSTR::null();
                args.ParameterObjectAsJson(&mut json)?;
                on_event(take_pwstr(json));
            }
            Ok(())
        }));
        let mut token = 0i64;
        receiver.add_DevToolsProtocolEventReceived(&handler, &mut token)
    }

    unsafe fn fire(core: &ICoreWebView2, method: &str, params: &str) {
        let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|_, _| Ok(())));
        let _ = core.CallDevToolsProtocolMethod(
            &HSTRING::from(method),
            &HSTRING::from(params),
            &handler,
        );
    }

    /// Profile settings, the process id, CDP events and the pick bridge.
    pub(super) fn setup<R: Runtime>(webview: &Webview<R>, tab: u32) {
        let app = webview.app_handle().clone();
        let _ = webview.with_webview(move |platform| {
            let controller = platform.controller();
            unsafe {
                let Ok(core) = controller.CoreWebView2() else { return };
                if let Ok(settings) = core.Settings() {
                    let _ = settings.SetAreDevToolsEnabled(true);
                    // Edge's own saver: offers to save a login, then fills
                    // it, with a pick list when a site has several.
                    if let Ok(settings) = settings.cast::<ICoreWebView2Settings4>() {
                        let _ = settings.SetIsPasswordAutosaveEnabled(true);
                        let _ = settings.SetIsGeneralAutofillEnabled(true);
                    }
                }
                let mut pid = 0u32;
                if core.BrowserProcessId(&mut pid).is_ok() && pid != 0 {
                    app.state::<BrowserTabs>().lock().browser_pid = Some(pid);
                }
                for event in EVENTS {
                    let app = app.clone();
                    let _ = subscribe(&core, event, move |json| {
                        on_cdp_event(&app, tab, event, &json)
                    });
                }
                let zoom_app = app.clone();
                let handler = ZoomFactorChangedEventHandler::create(Box::new(move |sender, _| {
                    if let Some(sender) = sender {
                        let mut zoom = 1.0f64;
                        sender.ZoomFactor(&mut zoom)?;
                        emit_state(
                            &zoom_app,
                            BrowserState {
                                tab,
                                zoom: Some(zoom),
                                ..Default::default()
                            },
                        );
                    }
                    Ok(())
                }));
                let mut token = 0i64;
                let _ = controller.add_ZoomFactorChanged(&handler, &mut token);
                fire(&core, "Runtime.enable", "{}");
                fire(&core, "Log.enable", "{}");
                fire(&core, "Network.enable", r#"{"maxPostDataSize":8192}"#);
                fire(
                    &core,
                    "Runtime.addBinding",
                    &serde_json::json!({ "name": BRIDGE }).to_string(),
                );
            }
        });
    }

    /// Calls one DevTools Protocol method and returns its result object.
    pub(super) async fn cdp<R: Runtime>(
        webview: &Webview<R>,
        method: &str,
        params: Value,
    ) -> Result<Value, String> {
        let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
        let method = method.to_string();
        let params = params.to_string();
        webview
            .with_webview(move |platform| unsafe {
                let Ok(core) = platform.controller().CoreWebView2() else { return };
                let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                    move |result, json| {
                        let _ = tx.send(result.map(|_| json).map_err(|e| e.message().to_string()));
                        Ok(())
                    },
                ));
                let _ = core.CallDevToolsProtocolMethod(
                    &HSTRING::from(method),
                    &HSTRING::from(params),
                    &handler,
                );
            })
            .map_err(|e| e.to_string())?;
        let json = tokio::time::timeout(Duration::from_secs(15), rx)
            .await
            .map_err(|_| "The page took too long to answer".to_string())?
            .map_err(|_| "The page closed before answering".to_string())??;
        serde_json::from_str(&json).map_err(|e| e.to_string())
    }

    pub(super) fn open_devtools<R: Runtime>(webview: &Webview<R>) -> Result<(), String> {
        webview
            .with_webview(|platform| unsafe {
                if let Ok(core) = platform.controller().CoreWebView2() {
                    if let Ok(settings) = core.Settings() {
                        let _ = settings.SetAreDevToolsEnabled(true);
                    }
                    let _ = core.OpenDevToolsWindow();
                }
            })
            .map_err(|e| e.to_string())
    }

    /// A hidden tab stops running scripts and gives memory back until shown.
    pub(super) fn suspend<R: Runtime>(webview: &Webview<R>) {
        let _ = webview.with_webview(|platform| unsafe {
            if let Ok(core) = platform
                .controller()
                .CoreWebView2()
                .and_then(|core| core.cast::<ICoreWebView2_3>())
            {
                let handler = TrySuspendCompletedHandler::create(Box::new(|_, _| Ok(())));
                let _ = core.TrySuspend(&handler);
            }
        });
    }

    pub(super) fn resume<R: Runtime>(webview: &Webview<R>) {
        let _ = webview.with_webview(|platform| unsafe {
            if let Ok(core) = platform
                .controller()
                .CoreWebView2()
                .and_then(|core| core.cast::<ICoreWebView2_3>())
            {
                let _ = core.Resume();
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::{devtools_entry, parse_web_url, tab_of};
    use serde_json::json;

    #[test]
    fn opens_only_web_pages() {
        assert!(parse_web_url("https://example.com/a?b=1").is_ok());
        assert!(parse_web_url("  http://localhost:5173  ").is_ok());
        assert!(parse_web_url("about:blank").is_ok());
        assert!(parse_web_url("file:///C:/Windows/win.ini").is_err());
        assert!(parse_web_url("javascript:alert(1)").is_err());
        assert!(parse_web_url("monocode://settings").is_err());
        assert!(parse_web_url("example.com").is_err());
    }

    #[test]
    fn tab_labels_round_trip() {
        assert_eq!(tab_of("monocode-browser-7"), Some(7));
        assert_eq!(tab_of("main"), None);
    }

    #[test]
    fn console_rows_are_compact() {
        let row = devtools_entry(
            "Runtime.consoleAPICalled",
            &json!({
                "type": "warning",
                "args": [{ "type": "string", "value": "slow" }, { "type": "number", "value": 3 }],
                "stackTrace": { "callFrames": [{ "url": "http://localhost:5173/src/a.ts", "lineNumber": 9 }] },
            }),
        )
        .unwrap();
        assert_eq!(row["level"], "warn");
        assert_eq!(row["text"], "slow 3");
        assert_eq!(row["source"], "http://localhost:5173/src/a.ts:10");
        assert!(devtools_entry("Page.frameNavigated", &json!({})).is_none());
    }
}
