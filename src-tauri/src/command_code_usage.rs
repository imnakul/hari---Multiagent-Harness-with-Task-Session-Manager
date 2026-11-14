//! Fork (L-296): Command Code plan usage (5-hour, weekly and monthly), read
//! the way the Command Code CLI reads it. The API key in
//! `~/.commandcode/auth.json` is only sent to Command Code's own API, from
//! this process; it is never returned to the webview, logged or sent to the
//! phone.

use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::dirs_home;

const API_BASE: &str = "https://api.commandcode.ai";
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandCodeUsageFetch {
    /// "ok", "unavailable" (not signed in) or "error".
    pub status: String,
    pub http_status: Option<u16>,
    /// `/alpha/billing/credits`: remaining credits and the 5-hour and weekly limits.
    pub credits: Option<Value>,
    /// `/alpha/billing/subscriptions`: the plan and its billing period.
    pub subscription: Option<Value>,
    /// `/alpha/usage/summary`: spend in the current billing period.
    pub summary: Option<Value>,
    pub error: Option<String>,
}

fn result(status: &str, http_status: Option<u16>, error: Option<String>) -> CommandCodeUsageFetch {
    CommandCodeUsageFetch {
        status: status.into(),
        http_status,
        credits: None,
        subscription: None,
        summary: None,
        error,
    }
}

#[tauri::command]
pub async fn fetch_command_code_usage() -> Result<CommandCodeUsageFetch, String> {
    tauri::async_runtime::spawn_blocking(fetch_sync)
        .await
        .map_err(|e| e.to_string())?
}

fn auth_path() -> Option<PathBuf> {
    Some(
        PathBuf::from(dirs_home()?)
            .join(".commandcode")
            .join("auth.json"),
    )
}

fn read_api_key() -> Option<String> {
    if let Ok(key) = std::env::var("COMMANDCODE_API_KEY") {
        let key = key.trim().to_string();
        if !key.is_empty() {
            return Some(key);
        }
    }
    let raw = std::fs::read_to_string(auth_path()?).ok()?;
    parse_api_key(&raw)
}

fn parse_api_key(raw: &str) -> Option<String> {
    let value: Value = serde_json::from_str(raw).ok()?;
    let key = value.get("apiKey")?.as_str()?.trim();
    (!key.is_empty()).then(|| key.to_string())
}

enum Failure {
    Status(u16),
    Network(String),
}

fn get(
    agent: &ureq::Agent,
    key: &str,
    path: &str,
    query: &[(&str, Option<&str>)],
) -> Result<Value, Failure> {
    let mut request = agent
        .get(&format!("{API_BASE}{path}"))
        .set("Authorization", &format!("Bearer {key}"))
        .set("Accept", "application/json");
    for (name, value) in query {
        if let Some(value) = value {
            request = request.query(name, value);
        }
    }
    match request.call() {
        Ok(response) => {
            let body = response
                .into_string()
                .map_err(|error| Failure::Network(error.to_string()))?;
            serde_json::from_str(&body)
                .map_err(|_| Failure::Network("Command Code's answer wasn't JSON".into()))
        }
        Err(ureq::Error::Status(status, _)) => Err(Failure::Status(status)),
        Err(error) => Err(Failure::Network(error.to_string())),
    }
}

fn failure(error: Failure) -> CommandCodeUsageFetch {
    match error {
        Failure::Status(status @ (401 | 403)) => result(
            "error",
            Some(status),
            Some("Command Code sign-in expired. Run `cmd login` again.".into()),
        ),
        Failure::Status(status) => result(
            "error",
            Some(status),
            Some(format!("Command Code usage request failed ({status})")),
        ),
        Failure::Network(message) => result(
            "error",
            None,
            Some(format!("Couldn't reach Command Code: {message}")),
        ),
    }
}

fn fetch_sync() -> Result<CommandCodeUsageFetch, String> {
    let Some(key) = read_api_key() else {
        return Ok(result(
            "unavailable",
            None,
            Some("Command Code not signed in".into()),
        ));
    };
    let agent = ureq::AgentBuilder::new().timeout(HTTP_TIMEOUT).build();
    let whoami = match get(&agent, &key, "/alpha/whoami", &[("limits", Some("1"))]) {
        Ok(value) => value,
        Err(error) => return Ok(failure(error)),
    };
    let org = whoami
        .get("org")
        .and_then(|org| org.get("id"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let org = org.as_deref();
    let credits = match get(&agent, &key, "/alpha/billing/credits", &[("orgId", org)]) {
        Ok(value) => value,
        Err(error) => return Ok(failure(error)),
    };
    // The plan and summary only sharpen the monthly figure; go on without them.
    let subscription = get(
        &agent,
        &key,
        "/alpha/billing/subscriptions",
        &[("orgId", org)],
    )
    .ok();
    let since = subscription
        .as_ref()
        .and_then(|value| value.get("data"))
        .and_then(|data| data.get("currentPeriodStart"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let summary = get(
        &agent,
        &key,
        "/alpha/usage/summary",
        &[("orgId", org), ("since", since.as_deref())],
    )
    .ok();
    Ok(CommandCodeUsageFetch {
        status: "ok".into(),
        http_status: Some(200),
        credits: Some(credits),
        subscription,
        summary,
        error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_only_a_non_empty_api_key() {
        assert_eq!(
            parse_api_key(r#"{"apiKey":" k1 ","userId":"u"}"#).as_deref(),
            Some("k1")
        );
        assert_eq!(parse_api_key(r#"{"apiKey":""}"#), None);
        assert_eq!(parse_api_key(r#"{"userId":"u"}"#), None);
        assert_eq!(parse_api_key("not json"), None);
    }
}
