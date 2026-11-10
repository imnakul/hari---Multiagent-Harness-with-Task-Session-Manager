//! Week and month summaries: one on-demand `agy` call over a period's
//! numbers and notes. The prompt is built here (pure, tested) and kept well
//! under Windows' 32k command-line limit, because `agy -p` takes it as an
//! argument.

use std::collections::BTreeMap;

use super::aw::AwSummary;
use super::store::{ActivityEvent, ActivityNote};
use super::time::{format_day, format_duration, local_day};

/// Total characters given to per-day notes, spread evenly over the days.
const NOTES_BUDGET: usize = 12_000;
/// Fallback when a day has no AI notes: its first prompts, clipped.
const PROMPTS_PER_DAY: usize = 3;
const PROMPT_CHARS: usize = 140;

fn clip(text: &str, max: usize) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max {
        return flat;
    }
    let mut cut: String = flat.chars().take(max).collect();
    cut.push('…');
    cut
}

fn project_name(cwd: &str) -> &str {
    let trimmed = cwd.trim_end_matches(['/', '\\']);
    trimmed
        .rsplit(['/', '\\'])
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or(trimmed)
}

/// Whether `key` looks like `week:2026-11-09` or `month:2026-11`.
pub fn valid_period_key(key: &str) -> bool {
    let Some((kind, date)) = key.split_once(':') else {
        return false;
    };
    let digits_and_dashes = date.bytes().all(|b| b.is_ascii_digit() || b == b'-');
    match kind {
        "week" => date.len() == 10 && digits_and_dashes,
        "month" => date.len() == 7 && digits_and_dashes,
        _ => false,
    }
}

/// The prompt for a period summary. `label` is human text such as
/// "week of Mon 9 Nov" or "November 2026".
pub fn period_prompt(
    label: &str,
    events: &[ActivityEvent],
    notes: &[ActivityNote],
    aw: Option<&AwSummary>,
    tz_offset_min: i64,
) -> String {
    let mut out = format!(
        "You are Hari's activity scribe. Write a summary of the developer's {label}.\n\
         Format (Markdown, under 250 words):\n\
         - **Highlights**: 3 to 6 bullets of what got done.\n\
         - **By project**: one line per project with its agent time.\n\
         - **Time**: agent time, active time and meetings, if given.\n\
         - **Open threads**: unfinished work, only if the notes show any.\n\
         Use only the information below. Do not run tools, open files, browse, or ask questions.\n"
    );

    let prompts = events.iter().filter(|e| e.kind == "prompt").count();
    let agent_ms: i64 = events
        .iter()
        .filter(|e| e.kind == "turn")
        .filter_map(|e| e.duration_ms)
        .sum();
    out.push_str(&format!(
        "\nTotals: {prompts} prompts, agents worked {}.\n",
        format_duration(agent_ms)
    ));

    let mut projects: BTreeMap<&str, (usize, i64)> = BTreeMap::new();
    for event in events {
        let entry = projects.entry(project_name(&event.cwd)).or_default();
        if event.kind == "prompt" {
            entry.0 += 1;
        } else {
            entry.1 += event.duration_ms.unwrap_or(0);
        }
    }
    let mut projects: Vec<_> = projects.into_iter().collect();
    projects.sort_by(|a, b| b.1 .1.cmp(&a.1 .1).then(b.1 .0.cmp(&a.1 .0)));
    if !projects.is_empty() {
        out.push_str("Projects:\n");
        for (name, (count, ms)) in projects.iter().take(12) {
            out.push_str(&format!(
                "- {name}: {count} prompts, {}\n",
                format_duration(*ms)
            ));
        }
    }

    if let Some(aw) = aw.filter(|aw| aw.available) {
        out.push_str(&format!(
            "Desktop: active {}, meetings {} ({} calls).\n",
            format_duration(aw.active_ms),
            format_duration(aw.meeting_ms),
            aw.meetings.len()
        ));
        let apps: Vec<String> = aw
            .apps
            .iter()
            .take(6)
            .map(|a| format!("{} {}", a.app, format_duration(a.ms)))
            .collect();
        if !apps.is_empty() {
            out.push_str(&format!("Top apps: {}\n", apps.join(", ")));
        }
        let sites: Vec<String> = aw
            .sites
            .iter()
            .take(6)
            .map(|s| format!("{} {}", s.domain, format_duration(s.ms)))
            .collect();
        if !sites.is_empty() {
            out.push_str(&format!("Top sites: {}\n", sites.join(", ")));
        }
    }

    // Day by day: AI notes, or the first prompts when notes were off.
    let mut days: BTreeMap<i64, (Vec<&ActivityNote>, Vec<&ActivityEvent>)> = BTreeMap::new();
    for note in notes {
        days.entry(local_day(note.ts, tz_offset_min))
            .or_default()
            .0
            .push(note);
    }
    for event in events.iter().filter(|e| e.kind == "prompt") {
        days.entry(local_day(event.ts, tz_offset_min))
            .or_default()
            .1
            .push(event);
    }
    if days.is_empty() {
        out.push_str("\nNo activity was logged in this period.\n");
        return out;
    }
    let per_day = (NOTES_BUDGET / days.len()).max(200);
    out.push_str("\nBy day:\n");
    for (day, (day_notes, day_prompts)) in days {
        out.push_str(&format!("{}:\n", format_day(day)));
        let body = if day_notes.is_empty() {
            day_prompts
                .iter()
                .take(PROMPTS_PER_DAY)
                .map(|e| {
                    format!(
                        "- Prompt in {}: {}",
                        project_name(&e.cwd),
                        clip(&e.text, PROMPT_CHARS)
                    )
                })
                .collect::<Vec<_>>()
                .join("\n")
        } else {
            day_notes
                .iter()
                .map(|n| n.body.trim().to_string())
                .collect::<Vec<_>>()
                .join("\n")
        };
        out.push_str(&clip_lines(&body, per_day));
        out.push('\n');
    }
    out
}

/// Keep whole lines up to `max` characters, then mark the cut.
fn clip_lines(text: &str, max: usize) -> String {
    let mut out = String::new();
    for line in text.lines() {
        let line = line.trim_end();
        if line.is_empty() {
            continue;
        }
        if out.chars().count() + line.chars().count() + 1 > max {
            if out.is_empty() {
                out.push_str(&clip(line, max));
            } else {
                out.push_str("\n- …");
            }
            return out;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(line);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: i64 = 86_400_000;

    fn event(
        id: i64,
        ts: i64,
        kind: &str,
        cwd: &str,
        text: &str,
        ms: Option<i64>,
    ) -> ActivityEvent {
        ActivityEvent {
            id,
            ts,
            kind: kind.into(),
            session_id: "s".into(),
            harness: "claude".into(),
            model: "m".into(),
            cwd: cwd.into(),
            branch: None,
            title: "secret title".into(),
            text: text.into(),
            duration_ms: ms,
        }
    }

    #[test]
    fn validates_period_keys() {
        assert!(valid_period_key("week:2026-11-09"));
        assert!(valid_period_key("month:2026-11"));
        assert!(!valid_period_key("day:2026-11-09"));
        assert!(!valid_period_key("week:2026-11"));
        assert!(!valid_period_key("month:2026/11"));
        assert!(!valid_period_key("week:../../x"));
    }

    #[test]
    fn builds_a_period_prompt_with_totals_projects_and_days() {
        let base = 20_400 * DAY;
        let events = vec![
            event(1, base + 3_600_000, "prompt", "/c/hari", "add sites", None),
            event(
                2,
                base + 7_200_000,
                "turn",
                "/c/hari",
                "done",
                Some(30 * 60_000),
            ),
            event(3, base + DAY, "prompt", "C:\\c\\site", "hero scroll", None),
        ];
        let notes = vec![ActivityNote {
            id: 1,
            ts: base + 7_300_000,
            first_event_id: 1,
            last_event_id: 2,
            body: "- Added sites to Activity.".into(),
        }];
        let prompt = period_prompt("week of Mon 9 Nov", &events, &notes, None, 0);
        assert!(prompt.contains("summary of the developer's week of Mon 9 Nov"));
        assert!(prompt.contains("Totals: 2 prompts, agents worked 30m."));
        assert!(prompt.contains("- hari: 1 prompts, 30m\n- site: 1 prompts, 0s"));
        assert!(prompt.contains("- Added sites to Activity."));
        // A day without notes falls back to its prompts.
        assert!(prompt.contains("- Prompt in site: hero scroll"));
        assert!(!prompt.contains("secret title"));
    }

    #[test]
    fn stays_under_the_windows_command_line_limit() {
        let base = 20_400 * DAY;
        let long = "- ".to_string() + &"word ".repeat(400);
        let notes: Vec<ActivityNote> = (0..31 * 20)
            .map(|i| ActivityNote {
                id: i,
                ts: base + (i / 20) * DAY + i,
                first_event_id: i,
                last_event_id: i,
                body: long.clone(),
            })
            .collect();
        let prompt = period_prompt("November 2026", &[], &notes, None, 0);
        assert!(
            prompt.chars().count() < 20_000,
            "{}",
            prompt.chars().count()
        );
        assert!(prompt.contains('…'));
    }

    #[test]
    fn says_so_when_nothing_was_logged() {
        let prompt = period_prompt("November 2026", &[], &[], None, 0);
        assert!(prompt.contains("No activity was logged in this period."));
    }
}
