//! The Browser tab (L-203): one web page drawn inside the main window as a
//! child webview. The frontend owns the toolbar and tells this module where
//! the page area sits (physical pixels) and when to show or hide it, since a
//! native view always paints above MonoCode's own menus and dialogs.
//!
//! Pages are remote origins, so the app's capabilities (local origin only)
//! give them no IPC access.

use serde::{Deserialize, Serialize};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Rect, Runtime, Url, Webview,
    WebviewBuilder, WebviewUrl,
};

const LABEL: &str = "monocode-browser";
const HOST_WINDOW: &str = "main";
const STATE_EVENT: &str = "browser://state";

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserState {
    url: Option<String>,
    title: Option<String>,
    loading: Option<bool>,
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

fn emit_state<R: Runtime>(app: &AppHandle<R>, state: BrowserState) {
    let _ = app.emit_to(HOST_WINDOW, STATE_EVENT, state);
}

fn browser<R: Runtime>(app: &AppHandle<R>) -> Option<Webview<R>> {
    app.get_webview(LABEL)
}

fn create<R: Runtime>(app: &AppHandle<R>, url: Url, bounds: BrowserBounds) -> Result<(), String> {
    let window = app
        .get_window(HOST_WINDOW)
        .ok_or_else(|| "The main window is not open".to_string())?;
    let load_app = app.clone();
    let title_app = app.clone();
    let popup_app = app.clone();
    let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(url))
        .background_color(tauri::window::Color(255, 255, 255, 255))
        .on_navigation(|url| matches!(url.scheme(), "http" | "https" | "about" | "data" | "blob"))
        .on_page_load(move |_webview, payload| {
            emit_state(
                &load_app,
                BrowserState {
                    url: Some(payload.url().to_string()),
                    title: None,
                    loading: Some(matches!(payload.event(), PageLoadEvent::Started)),
                },
            );
        })
        .on_document_title_changed(move |_webview, title| {
            emit_state(
                &title_app,
                BrowserState {
                    url: None,
                    title: Some(title),
                    loading: None,
                },
            );
        })
        // Links that ask for a new window load in this page instead.
        .on_new_window(move |url, _features| {
            if parse_web_url(url.as_str()).is_ok() {
                if let Some(webview) = browser(&popup_app) {
                    let _ = webview.navigate(url);
                }
            }
            NewWindowResponse::Deny
        });
    let rect = bounds.rect();
    window
        .add_child(builder, rect.position, rect.size)
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// Opens `url`, creating the page view on first use. Async so the webview is
/// built off the main thread's command loop (a sync command deadlocks on
/// Windows when it creates a webview).
#[tauri::command]
pub async fn browser_open(
    app: AppHandle,
    url: String,
    bounds: BrowserBounds,
) -> Result<(), String> {
    let url = parse_web_url(&url)?;
    match browser(&app) {
        Some(webview) => {
            webview.set_bounds(bounds.rect()).map_err(|e| e.to_string())?;
            webview.navigate(url).map_err(|e| e.to_string())?;
            webview.show().map_err(|e| e.to_string())
        }
        None => create(&app, url, bounds),
    }
}

#[tauri::command]
pub async fn browser_navigate(app: AppHandle, url: String) -> Result<(), String> {
    let url = parse_web_url(&url)?;
    let webview = browser(&app).ok_or("The browser is not open")?;
    webview.navigate(url).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_set_bounds(
    app: AppHandle,
    bounds: BrowserBounds,
) -> Result<(), String> {
    match browser(&app) {
        Some(webview) => webview.set_bounds(bounds.rect()).map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

#[tauri::command]
pub async fn browser_set_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    let Some(webview) = browser(&app) else {
        return Ok(());
    };
    if visible { webview.show() } else { webview.hide() }.map_err(|e| e.to_string())
}

/// `action` is "back", "forward" or "reload".
#[tauri::command]
pub async fn browser_history(app: AppHandle, action: String) -> Result<(), String> {
    let webview = browser(&app).ok_or("The browser is not open")?;
    match action.as_str() {
        "back" => webview.eval("history.back()"),
        "forward" => webview.eval("history.forward()"),
        "reload" => webview.reload(),
        other => return Err(format!("Unknown browser action: {other}")),
    }
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_close(app: AppHandle) -> Result<(), String> {
    match browser(&app) {
        Some(webview) => webview.close().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::parse_web_url;

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
}
