//! Read-only client for a locally running ActivityWatch server.
//!
//! ActivityWatch (MPL-2.0) already does cross-platform window, browser, and
//! AFK tracking, including on Wayland where reading other windows is locked
//! down. Hari only reads its local REST API and folds the raw heartbeats into
//! the numbers the Activity view shows: active time, top apps, and meetings.
//! Window titles stay in this process; they are only used to spot meetings.

use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::time::format_iso_utc;

const AW_BASE: &str = "http://127.0.0.1:5600/api/0";
const AW_TIMEOUT: Duration = Duration::from_secs(4);
/// Two meeting heartbeats this close together are the same meeting.
const MEETING_GAP_MS: i64 = 3 * 60_000;
/// Shorter blips (a Zoom window focused for a second) are not meetings.
const MEETING_MIN_MS: i64 = 2 * 60_000;
/// Window events closer than this are one active stretch when there is no AFK bucket.
const ACTIVE_GAP_MS: i64 = 60_000;
const TOP_APPS: usize = 8;
const TOP_SITES: usize = 10;
/// Tab titles kept per site for the local list; never sent to the notes AI.
const TITLES_PER_SITE: usize = 8;
const TITLE_MAX_CHARS: usize = 120;
/// Window `app` names (lower-case substrings) that are web browsers.
const BROWSER_APPS: &[&str] = &[
    "chrome",
    "chromium",
    "firefox",
    "msedge",
    "edge",
    "brave",
    "arc",
    "safari",
    "opera",
    "vivaldi",
    "zen",
    "librewolf",
    "floorp",
    "orion",
    "thorium",
    // Aside (Chromium-based); its tabs come from the Chrome extension.
    "aside",
];

/// A closed `[start, end)` interval in epoch ms.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    pub start: i64,
    pub end: i64,
}

impl Span {
    fn len(self) -> i64 {
        (self.end - self.start).max(0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUsage {
    pub app: String,
    pub ms: i64,
}

/// Time on one website (from the ActivityWatch browser extension).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteUsage {
    /// Host without `www.`, e.g. `github.com`. The only part the notes AI sees.
    pub domain: String,
    pub ms: i64,
    /// Most-viewed tab titles on this site with their time, for the local list only.
    pub titles: Vec<TabUsage>,
}

/// Time on one tab title within a site.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabUsage {
    pub title: String,
    pub ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Meeting {
    pub start: i64,
    pub end: i64,
    /// Generic product name ("Zoom", "Google Meet"), never a window title.
    pub label: String,
}

/// What the Activity view needs from ActivityWatch for one time range.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AwSummary {
    /// False when the server is not running or has no usable buckets.
    pub available: bool,
    /// Plain-language reason when `available` is false.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Whether an AFK watcher fed `active_ms`; without it activity is inferred from window focus.
    pub has_afk: bool,
    pub active_ms: i64,
    pub active_spans: Vec<Span>,
    pub apps: Vec<AppUsage>,
    /// Whether the browser extension sent any tab data for this range.
    pub has_web: bool,
    pub sites: Vec<SiteUsage>,
    pub meetings: Vec<Meeting>,
    pub meeting_ms: i64,
}

/// One raw ActivityWatch event, reduced to what the aggregation reads.
#[derive(Debug, Clone)]
pub struct RawEvent {
    pub start: i64,
    pub end: i64,
    pub data: Value,
}

#[derive(Debug, Deserialize)]
struct BucketInfo {
    #[serde(rename = "type", default)]
    kind: String,
    #[serde(default)]
    hostname: String,
}

#[derive(Debug, Deserialize)]
struct WireEvent {
    timestamp: String,
    #[serde(default)]
    duration: f64,
    #[serde(default)]
    data: Value,
}

/// Fetch and aggregate ActivityWatch data for `[start, end)`.
///
/// Never fails: an unreachable server yields `available: false` with a
/// reason, so the UI can show a setup hint instead of an error.
pub fn summary(start: i64, end: i64) -> AwSummary {
    match fetch(start, end) {
        Ok(Some(raw)) => aggregate(&raw, start, end),
        Ok(None) => AwSummary {
            error: Some("ActivityWatch is running but has no window or AFK watchers yet.".into()),
            ..AwSummary::default()
        },
        Err(err) => AwSummary {
            error: Some(err),
            ..AwSummary::default()
        },
    }
}

/// Raw events grouped by watcher kind.
#[derive(Debug, Default)]
pub struct RawBuckets {
    pub window: Vec<RawEvent>,
    pub afk: Vec<RawEvent>,
    pub web: Vec<RawEvent>,
}

fn fetch(start: i64, end: i64) -> Result<Option<RawBuckets>, String> {
    let agent = ureq::AgentBuilder::new().timeout(AW_TIMEOUT).build();
    let body = agent
        .get(&format!("{AW_BASE}/buckets/"))
        .call()
        .map_err(|_| {
            "ActivityWatch is not running. Start it to add app, idle, and meeting time.".to_string()
        })?
        .into_string()
        .map_err(|e| format!("ActivityWatch sent an unreadable response: {e}"))?;
    let buckets: HashMap<String, BucketInfo> = serde_json::from_str(&body)
        .map_err(|e| format!("ActivityWatch sent an unexpected response: {e}"))?;

    let host = local_hostname();
    let picked = pick_buckets(&buckets, host.as_deref());
    if picked.is_empty() {
        return Ok(None);
    }

    let start_iso = format_iso_utc(start);
    let end_iso = format_iso_utc(end);
    let mut raw = RawBuckets::default();
    for (id, kind) in picked {
        let url = format!(
            "{AW_BASE}/buckets/{}/events?start={}&end={}&limit=-1",
            encode_path_segment(&id),
            start_iso,
            end_iso
        );
        let events: Vec<WireEvent> = match agent.get(&url).call() {
            Ok(response) => response
                .into_string()
                .ok()
                .and_then(|body| serde_json::from_str(&body).ok())
                .unwrap_or_default(),
            Err(err) => {
                eprintln!("monocode: activity: ActivityWatch bucket {id} failed: {err}");
                continue;
            }
        };
        let target = match kind {
            BucketKind::Window => &mut raw.window,
            BucketKind::Afk => &mut raw.afk,
            BucketKind::Web => &mut raw.web,
        };
        target.extend(events.into_iter().filter_map(to_raw));
    }
    Ok(Some(raw))
}

fn to_raw(event: WireEvent) -> Option<RawEvent> {
    let start = super::time::parse_iso_ms(&event.timestamp)?;
    let duration_ms = (event.duration.max(0.0) * 1000.0).round() as i64;
    Some(RawEvent {
        start,
        end: start + duration_ms,
        data: event.data,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BucketKind {
    Window,
    Afk,
    Web,
}

/// Choose this machine's buckets. ActivityWatch sync can bring in buckets from
/// other devices; those would double-count, so prefer an exact hostname match
/// and only fall back to every bucket of a kind when nothing matches.
fn pick_buckets(
    buckets: &HashMap<String, BucketInfo>,
    host: Option<&str>,
) -> Vec<(String, BucketKind)> {
    let classify = |kind: &str| match kind {
        "currentwindow" => Some(BucketKind::Window),
        "afkstatus" => Some(BucketKind::Afk),
        "web.tab.current" => Some(BucketKind::Web),
        _ => None,
    };
    let mut picked = Vec::new();
    for kind in [BucketKind::Window, BucketKind::Afk, BucketKind::Web] {
        let of_kind: Vec<(&String, &BucketInfo)> = buckets
            .iter()
            .filter(|(_, info)| classify(&info.kind) == Some(kind))
            .collect();
        let local: Vec<&String> = of_kind
            .iter()
            .filter(|(_, info)| host.is_some_and(|h| info.hostname.eq_ignore_ascii_case(h)))
            .map(|(id, _)| *id)
            .collect();
        let chosen: Vec<&String> = if local.is_empty() {
            of_kind.iter().map(|(id, _)| *id).collect()
        } else {
            local
        };
        let mut chosen: Vec<String> = chosen.into_iter().cloned().collect();
        chosen.sort();
        picked.extend(chosen.into_iter().map(|id| (id, kind)));
    }
    picked
}

fn encode_path_segment(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len());
    for byte in segment.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn local_hostname() -> Option<String> {
    #[cfg(unix)]
    {
        let mut buf = [0u8; 256];
        // SAFETY: `buf` is a valid, writable buffer and its length is passed
        // alongside; gethostname writes at most that many bytes.
        let rc = unsafe { libc::gethostname(buf.as_mut_ptr().cast(), buf.len()) };
        if rc != 0 {
            return None;
        }
        let len = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
        let name = String::from_utf8_lossy(&buf[..len]).trim().to_string();
        (!name.is_empty()).then_some(name)
    }
    #[cfg(not(unix))]
    {
        std::env::var("COMPUTERNAME").ok()
    }
}

/// Fold raw heartbeats into the summary. Pure, so it is unit-tested directly.
pub fn aggregate(raw: &RawBuckets, start: i64, end: i64) -> AwSummary {
    let clip = |span: Span| Span {
        start: span.start.max(start),
        end: span.end.min(end),
    };

    let has_afk = !raw.afk.is_empty();
    let active_spans = if has_afk {
        merge(
            raw.afk
                .iter()
                .filter(|event| str_field(&event.data, "status") == Some("not-afk"))
                .map(|event| {
                    clip(Span {
                        start: event.start,
                        end: event.end,
                    })
                })
                .collect(),
            0,
        )
    } else {
        merge(
            raw.window
                .iter()
                .map(|event| {
                    clip(Span {
                        start: event.start,
                        end: event.end,
                    })
                })
                .collect(),
            ACTIVE_GAP_MS,
        )
    };
    let active_ms = active_spans.iter().map(|span| span.len()).sum();

    let mut per_app: HashMap<String, i64> = HashMap::new();
    for event in &raw.window {
        let Some(app) = str_field(&event.data, "app")
            .map(str::trim)
            .filter(|a| !a.is_empty())
        else {
            continue;
        };
        let span = clip(Span {
            start: event.start,
            end: event.end,
        });
        let ms = if has_afk {
            overlap_ms(span, &active_spans)
        } else {
            span.len()
        };
        if ms > 0 {
            *per_app.entry(display_app(app)).or_default() += ms;
        }
    }
    let mut apps: Vec<AppUsage> = per_app
        .into_iter()
        .map(|(app, ms)| AppUsage { app, ms })
        .collect();
    apps.sort_by(|a, b| b.ms.cmp(&a.ms).then_with(|| a.app.cmp(&b.app)));
    apps.truncate(TOP_APPS);

    // Meetings are not intersected with "active": nobody types during a call,
    // so the AFK watcher often marks a meeting as away.
    let mut hits: Vec<(Span, &'static str)> = Vec::new();
    for event in &raw.window {
        let app = str_field(&event.data, "app").unwrap_or("");
        let title = str_field(&event.data, "title").unwrap_or("");
        if let Some(label) = meeting_from_window(app, title) {
            hits.push((
                clip(Span {
                    start: event.start,
                    end: event.end,
                }),
                label,
            ));
        }
    }
    for event in &raw.web {
        let url = str_field(&event.data, "url").unwrap_or("");
        let title = str_field(&event.data, "title").unwrap_or("");
        if let Some(label) = meeting_from_web(url, title) {
            hits.push((
                clip(Span {
                    start: event.start,
                    end: event.end,
                }),
                label,
            ));
        }
    }
    let meetings = merge_meetings(hits);
    let meeting_ms = meetings.iter().map(|m| m.end - m.start).sum();
    let sites = site_usage(raw, &active_spans, has_afk, clip);

    AwSummary {
        available: true,
        error: None,
        has_afk,
        active_ms,
        active_spans,
        apps,
        has_web: !raw.web.is_empty(),
        sites,
        meetings,
        meeting_ms,
    }
}

/// Per-domain time. The extension reports the browser's active tab even when
/// the browser is in the background, so a tab only counts while a browser
/// window is focused (when window data exists) and you are not away.
fn site_usage(
    raw: &RawBuckets,
    active_spans: &[Span],
    has_afk: bool,
    clip: impl Fn(Span) -> Span,
) -> Vec<SiteUsage> {
    let browser_focus = merge(
        raw.window
            .iter()
            .filter(|event| str_field(&event.data, "app").is_some_and(is_browser_app))
            .map(|event| {
                clip(Span {
                    start: event.start,
                    end: event.end,
                })
            })
            .collect(),
        0,
    );
    let mut counted = if raw.window.is_empty() {
        None
    } else {
        Some(browser_focus)
    };
    if has_afk {
        counted = Some(match counted {
            Some(focus) => intersect(&focus, active_spans),
            None => active_spans.to_vec(),
        });
    }

    let mut per_site: HashMap<String, (i64, HashMap<String, i64>)> = HashMap::new();
    for event in &raw.web {
        let Some(domain) = str_field(&event.data, "url").and_then(site_domain) else {
            continue;
        };
        let span = clip(Span {
            start: event.start,
            end: event.end,
        });
        let ms = match &counted {
            Some(spans) => overlap_ms(span, spans),
            None => span.len(),
        };
        if ms <= 0 {
            continue;
        }
        let entry = per_site.entry(domain).or_default();
        entry.0 += ms;
        let title = str_field(&event.data, "title").map(str::trim).unwrap_or("");
        if !title.is_empty() {
            let title: String = title.chars().take(TITLE_MAX_CHARS).collect();
            *entry.1.entry(title).or_default() += ms;
        }
    }

    let mut sites: Vec<SiteUsage> = per_site
        .into_iter()
        .map(|(domain, (ms, titles))| {
            let mut titles: Vec<(String, i64)> = titles.into_iter().collect();
            titles.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
            SiteUsage {
                domain,
                ms,
                titles: titles
                    .into_iter()
                    .take(TITLES_PER_SITE)
                    .map(|(title, ms)| TabUsage { title, ms })
                    .collect(),
            }
        })
        .collect();
    sites.sort_by(|a, b| b.ms.cmp(&a.ms).then_with(|| a.domain.cmp(&b.domain)));
    sites.truncate(TOP_SITES);
    sites
}

fn is_browser_app(app: &str) -> bool {
    let app = app.to_ascii_lowercase();
    BROWSER_APPS.iter().any(|name| app.contains(name))
}

/// `https://www.github.com/x?y` → `github.com`. Internal pages
/// (`chrome://`, `about:`, `file:`, extensions) are not websites.
fn site_domain(url: &str) -> Option<String> {
    let lower = url.trim().to_ascii_lowercase();
    let rest = lower
        .strip_prefix("https://")
        .or_else(|| lower.strip_prefix("http://"))?;
    let host = rest.split(['/', '?', '#']).next()?;
    let host = host.rsplit('@').next()?; // drop any user:pass@
    let host = host.split(':').next()?; // drop the port
    let host = host.strip_prefix("www.").unwrap_or(host);
    (!host.is_empty() && host.contains('.') || host == "localhost").then(|| host.to_string())
}

/// Overlap of two sorted, non-overlapping span lists.
fn intersect(a: &[Span], b: &[Span]) -> Vec<Span> {
    let (mut i, mut j) = (0, 0);
    let mut out = Vec::new();
    while i < a.len() && j < b.len() {
        let start = a[i].start.max(b[j].start);
        let end = a[i].end.min(b[j].end);
        if end > start {
            out.push(Span { start, end });
        }
        if a[i].end < b[j].end {
            i += 1;
        } else {
            j += 1;
        }
    }
    out
}

fn str_field<'a>(data: &'a Value, key: &str) -> Option<&'a str> {
    data.get(key).and_then(Value::as_str)
}

/// Trim platform suffixes so one app does not appear under two names.
fn display_app(app: &str) -> String {
    let trimmed = app.trim_end_matches(".exe").trim_end_matches(".app");
    let mut chars = trimmed.chars();
    match chars.next() {
        Some(first) if first.is_lowercase() && !trimmed.contains('.') => {
            first.to_uppercase().chain(chars).collect()
        }
        _ => trimmed.to_string(),
    }
}

/// Sort, drop empty spans, and join spans that touch or sit within `gap` ms.
fn merge(mut spans: Vec<Span>, gap: i64) -> Vec<Span> {
    spans.retain(|span| span.end > span.start);
    spans.sort_by_key(|span| (span.start, span.end));
    let mut out: Vec<Span> = Vec::with_capacity(spans.len());
    for span in spans {
        match out.last_mut() {
            Some(last) if span.start <= last.end + gap => last.end = last.end.max(span.end),
            _ => out.push(span),
        }
    }
    out
}

/// Total overlap of `span` with sorted, non-overlapping `spans`.
fn overlap_ms(span: Span, spans: &[Span]) -> i64 {
    let first = spans.partition_point(|s| s.end <= span.start);
    spans[first..]
        .iter()
        .take_while(|s| s.start < span.end)
        .map(|s| (s.end.min(span.end) - s.start.max(span.start)).max(0))
        .sum()
}

fn meeting_from_window(app: &str, title: &str) -> Option<&'static str> {
    let app = app.to_ascii_lowercase();
    let title = title.to_ascii_lowercase();
    if app.contains("zoom") || title.contains("zoom meeting") {
        return Some("Zoom");
    }
    if app.contains("teams") {
        return Some("Microsoft Teams");
    }
    if app.contains("webex") {
        return Some("Webex");
    }
    if app.contains("facetime") {
        return Some("FaceTime");
    }
    if app.contains("slack") && title.contains("huddle") {
        return Some("Slack huddle");
    }
    if title.starts_with("meet - ")
        || title.contains("google meet")
        || title.contains("meet.google.com")
    {
        return Some("Google Meet");
    }
    None
}

fn meeting_from_web(url: &str, title: &str) -> Option<&'static str> {
    let url = url.to_ascii_lowercase();
    let title = title.to_ascii_lowercase();
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap_or(&url);
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    let path = path.split(['?', '#']).next().unwrap_or("");
    // A bare meet.google.com is the lobby/landing page, not a call.
    if host == "meet.google.com" && !path.is_empty() && path != "landing" {
        return Some("Google Meet");
    }
    if (host == "zoom.us" || host.ends_with(".zoom.us"))
        && (path.starts_with("wc/") || path.starts_with("j/"))
    {
        return Some("Zoom");
    }
    if (host == "teams.microsoft.com" || host == "teams.live.com")
        && (title.contains("meeting") || title.contains("call"))
    {
        return Some("Microsoft Teams");
    }
    None
}

fn merge_meetings(mut hits: Vec<(Span, &'static str)>) -> Vec<Meeting> {
    hits.retain(|(span, _)| span.end > span.start);
    hits.sort_by_key(|(span, _)| (span.start, span.end));
    let mut merged: Vec<Meeting> = Vec::new();
    for (span, label) in hits {
        match merged.last_mut() {
            Some(last) if span.start <= last.end + MEETING_GAP_MS => {
                last.end = last.end.max(span.end);
            }
            _ => merged.push(Meeting {
                start: span.start,
                end: span.end,
                label: label.to_string(),
            }),
        }
    }
    merged.retain(|meeting| meeting.end - meeting.start >= MEETING_MIN_MS);
    merged
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const MIN: i64 = 60_000;

    fn event(start_min: i64, end_min: i64, data: Value) -> RawEvent {
        RawEvent {
            start: start_min * MIN,
            end: end_min * MIN,
            data,
        }
    }

    #[test]
    fn active_time_comes_from_not_afk_spans() {
        let raw = RawBuckets {
            afk: vec![
                event(0, 30, json!({"status": "not-afk"})),
                event(30, 40, json!({"status": "afk"})),
                event(40, 60, json!({"status": "not-afk"})),
            ],
            window: vec![
                event(0, 20, json!({"app": "Code", "title": "x"})),
                event(20, 60, json!({"app": "firefox", "title": "y"})),
            ],
            web: vec![],
        };
        let summary = aggregate(&raw, 0, 60 * MIN);
        assert!(summary.available && summary.has_afk);
        assert_eq!(summary.active_ms, 50 * MIN);
        // Firefox was focused 40 min but 10 of those were AFK.
        assert_eq!(
            summary.apps,
            vec![
                AppUsage {
                    app: "Firefox".into(),
                    ms: 30 * MIN
                },
                AppUsage {
                    app: "Code".into(),
                    ms: 20 * MIN
                },
            ]
        );
    }

    #[test]
    fn falls_back_to_window_focus_without_afk_bucket() {
        let raw = RawBuckets {
            window: vec![
                event(0, 10, json!({"app": "Code"})),
                event(10, 15, json!({"app": "Code"})),
                event(40, 50, json!({"app": "Code"})),
            ],
            ..RawBuckets::default()
        };
        let summary = aggregate(&raw, 0, 60 * MIN);
        assert!(!summary.has_afk);
        assert_eq!(summary.active_spans.len(), 2);
        assert_eq!(summary.active_ms, 25 * MIN);
    }

    #[test]
    fn clips_events_to_the_requested_range() {
        let raw = RawBuckets {
            afk: vec![event(-30, 30, json!({"status": "not-afk"}))],
            ..RawBuckets::default()
        };
        assert_eq!(aggregate(&raw, 0, 60 * MIN).active_ms, 30 * MIN);
    }

    #[test]
    fn detects_and_merges_meetings_even_while_afk() {
        let raw = RawBuckets {
            afk: vec![event(0, 60, json!({"status": "afk"}))],
            window: vec![
                event(0, 10, json!({"app": "zoom.us", "title": "Zoom Meeting"})),
                event(11, 25, json!({"app": "zoom.us", "title": "Zoom Meeting"})),
                event(30, 31, json!({"app": "zoom.us", "title": "Zoom"})),
            ],
            web: vec![event(
                40,
                55,
                json!({"url": "https://meet.google.com/abc-defg-hij", "title": "Meet - Standup"}),
            )],
        };
        let summary = aggregate(&raw, 0, 60 * MIN);
        assert_eq!(
            summary.meetings,
            vec![
                Meeting {
                    start: 0,
                    end: 25 * MIN,
                    label: "Zoom".into()
                },
                Meeting {
                    start: 40 * MIN,
                    end: 55 * MIN,
                    label: "Google Meet".into()
                },
            ]
        );
        assert_eq!(summary.meeting_ms, 40 * MIN);
    }

    #[test]
    fn sites_count_only_focused_active_browser_time() {
        let raw = RawBuckets {
            afk: vec![
                event(0, 50, json!({"status": "not-afk"})),
                event(50, 60, json!({"status": "afk"})),
            ],
            window: vec![
                event(0, 20, json!({"app": "Figma"})),
                event(20, 60, json!({"app": "Google Chrome"})),
            ],
            web: vec![
                // Background tab while Figma was focused: 10 of 30 min count.
                event(
                    10,
                    30,
                    json!({"url": "https://www.github.com/a/b", "title": "PR #1"}),
                ),
                event(
                    30,
                    60,
                    json!({"url": "https://figma.com/file/x", "title": "Design"}),
                ),
                event(
                    30,
                    40,
                    json!({"url": "chrome://newtab", "title": "New Tab"}),
                ),
            ],
        };
        let summary = aggregate(&raw, 0, 60 * MIN);
        assert!(summary.has_web);
        assert_eq!(
            summary.sites,
            vec![
                // 30–50 counts; 50–60 was AFK.
                SiteUsage {
                    domain: "figma.com".into(),
                    ms: 20 * MIN,
                    titles: vec![TabUsage {
                        title: "Design".into(),
                        ms: 20 * MIN
                    }]
                },
                SiteUsage {
                    domain: "github.com".into(),
                    ms: 10 * MIN,
                    titles: vec![TabUsage {
                        title: "PR #1".into(),
                        ms: 10 * MIN
                    }]
                },
            ]
        );
        // Figma desktop app time still shows under apps.
        assert_eq!(summary.apps[0].app, "Google Chrome");
        assert_eq!(
            summary.apps[1],
            AppUsage {
                app: "Figma".into(),
                ms: 20 * MIN
            }
        );
    }

    #[test]
    fn recognises_browsers_by_app_name() {
        assert!(is_browser_app("chrome.exe"));
        // The user's browser; its tab time was dropped before (L-240).
        assert!(is_browser_app("Aside.exe"));
        assert!(!is_browser_app("monocode.exe"));
    }

    #[test]
    fn parses_site_domains() {
        assert_eq!(
            site_domain("https://www.github.com/x?y"),
            Some("github.com".into())
        );
        assert_eq!(
            site_domain("http://user:pw@docs.rs:8080/a"),
            Some("docs.rs".into())
        );
        assert_eq!(
            site_domain("http://localhost:3000/"),
            Some("localhost".into())
        );
        assert_eq!(site_domain("chrome://newtab"), None);
        assert_eq!(site_domain("about:blank"), None);
        assert_eq!(site_domain("file:///tmp/a.html"), None);
    }

    #[test]
    fn intersects_span_lists() {
        let a = vec![Span { start: 0, end: 10 }, Span { start: 20, end: 30 }];
        let b = vec![Span { start: 5, end: 25 }];
        assert_eq!(
            intersect(&a, &b),
            vec![Span { start: 5, end: 10 }, Span { start: 20, end: 25 }]
        );
    }

    #[test]
    fn ignores_meeting_landing_pages() {
        assert_eq!(
            meeting_from_web("https://meet.google.com/", "Google Meet"),
            None
        );
        assert_eq!(
            meeting_from_web("https://meet.google.com/landing", ""),
            None
        );
        assert_eq!(meeting_from_web("https://zoom.us/pricing", ""), None);
        assert_eq!(
            meeting_from_web("https://us02web.zoom.us/wc/123/join", ""),
            Some("Zoom")
        );
        assert_eq!(
            meeting_from_web(
                "https://teams.microsoft.com/v2/",
                "Meeting with Ana | Microsoft Teams"
            ),
            Some("Microsoft Teams")
        );
    }

    #[test]
    fn prefers_this_hosts_buckets() {
        let mut buckets = HashMap::new();
        for (id, kind, host) in [
            ("aw-watcher-window_laptop", "currentwindow", "laptop"),
            ("aw-watcher-window_desktop", "currentwindow", "desktop"),
            ("aw-watcher-afk_desktop", "afkstatus", "desktop"),
            ("aw-watcher-input_laptop", "os.hid.input", "laptop"),
        ] {
            buckets.insert(
                id.to_string(),
                BucketInfo {
                    kind: kind.into(),
                    hostname: host.into(),
                },
            );
        }
        let picked = pick_buckets(&buckets, Some("laptop"));
        assert_eq!(
            picked,
            vec![
                ("aw-watcher-window_laptop".to_string(), BucketKind::Window),
                // No local AFK bucket, so the only one is used.
                ("aw-watcher-afk_desktop".to_string(), BucketKind::Afk),
            ]
        );
    }

    #[test]
    fn encodes_bucket_ids_for_urls() {
        assert_eq!(
            encode_path_segment("aw-watcher-window_my host"),
            "aw-watcher-window_my%20host"
        );
        assert_eq!(encode_path_segment("a/b"), "a%2Fb");
    }

    #[test]
    fn overlap_handles_unsorted_edges() {
        let spans = vec![Span { start: 0, end: 10 }, Span { start: 20, end: 30 }];
        assert_eq!(overlap_ms(Span { start: 5, end: 25 }, &spans), 10);
        assert_eq!(overlap_ms(Span { start: 40, end: 50 }, &spans), 0);
    }
}
