//! Observe native output settling after a bracketed paste before the single
//! Enter. A write acknowledgement does not mean the paste is attached.
use std::time::{Duration, Instant};

fn frame(text: &str) -> String {
    format!("\x1b[200~{text}\x1b[201~")
}

/// Claude folds one paste longer than 800 characters, or with more than two
/// line breaks, into a "[Pasted text #1 +N lines]" label. The model then gets
/// it as quoted material "the user did not write", so it may not follow the
/// instructions in it (fork, L-250). Smaller pastes are inserted as typed text,
/// and Claude handles each bracketed paste on its own, so a message goes as
/// several small pastes. Limits keep a margin under Claude's; a tab counts as
/// the four spaces Claude turns it into.
const PASTE_UNITS: usize = 700;
const PASTE_BREAKS: usize = 2;
/// Past this many pastes (about 240 lines or 80 KB), keep one folded paste per
/// part as before: Claude redraws its prompt once per paste.
const MAX_PASTES: usize = 120;

fn chunks(text: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let (mut start, mut units, mut breaks) = (0, 0, 0);
    let mut chars = text.char_indices().peekable();
    while let Some((index, c)) = chars.next() {
        // "\r\n" is one break and is never split across two pastes.
        let end = match (c, chars.peek()) {
            ('\r', Some(&(next, '\n'))) => {
                chars.next();
                next + 1
            }
            _ => index + c.len_utf8(),
        };
        let size = if c == '\t' {
            4
        } else {
            text[index..end].encode_utf16().count()
        };
        let line = usize::from(c == '\n' || c == '\r');
        if index > start && (units + size > PASTE_UNITS || breaks + line > PASTE_BREAKS) {
            parts.push(&text[start..index]);
            (start, units, breaks) = (index, 0, 0);
        }
        units += size;
        breaks += line;
    }
    if start < text.len() {
        parts.push(&text[start..]);
    }
    parts
}

/// Claude manual mode needs literal request text outside a folded context paste.
/// Keep every original character and never type a control or mode shortcut.
pub(crate) fn paste_payload(text: &str) -> String {
    payload(text, true)
}

/// The second try after Claude redrew an empty prompt: only the pasted parts.
/// The typed letter often survives a dropped paste, and typing it again sent
/// "CC…" (fork, L-187). If the letter was lost too, the GUI accepts the prompt
/// without it. A text that is only the letter is sent as before.
pub(crate) fn repaste_payload(text: &str) -> String {
    let pasted = payload(text, false);
    if pasted.is_empty() {
        paste_payload(text)
    } else {
        pasted
    }
}

fn payload(text: &str, typed: bool) -> String {
    let letter = (text != "/compact")
        .then(|| text.char_indices().find(|(_, c)| c.is_alphanumeric()))
        .flatten();
    let Some((offset, letter)) = letter else {
        return frame(text);
    };
    let (before, after) = (&text[..offset], &text[offset + letter.len_utf8()..]);
    let mut parts = [chunks(before), chunks(after)];
    if parts.iter().map(Vec::len).sum::<usize>() > MAX_PASTES {
        parts =
            [before, after].map(|part| (!part.is_empty()).then_some(part).into_iter().collect());
    }
    let [before, after] = parts.map(|part| part.into_iter().map(frame).collect::<String>());
    format!(
        "{before}{}{after}",
        if typed {
            letter.to_string()
        } else {
            String::new()
        }
    )
}

pub(crate) fn paste_settle_delay(bytes: usize) -> Duration {
    // Orca's measured ConPTY ingest floor is 64 bytes/ms; Unix is much faster.
    // Keep the CLI's 500ms attachment window after ingestion, without a cap.
    let rate = if cfg!(windows) { 64 } else { 4096 };
    Duration::from_millis(500 + (bytes as u64).div_ceil(rate))
}

/// How a paste finished: native output went quiet, or it advanced but never
/// went quiet (an animated status line keeps drawing). A noisy paste is not
/// proof by itself: the GUI must then see the message held still in Claude's
/// prompt before it presses Enter (L-133).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum PasteSettle {
    Quiet,
    Noisy,
}

/// Past the ingest floor, output that advanced but stays busy this long is noisy.
const NOISY_AFTER: Duration = Duration::from_secs(4);
/// Past the ingest floor, output that never advanced fails after this long.
const UNOBSERVED_AFTER: Duration = Duration::from_secs(8);

#[derive(Debug, PartialEq)]
enum PasteCheck {
    Wait,
    Settled(PasteSettle),
    Unobserved,
}

fn check_paste(elapsed: Duration, minimum: Duration, output: bool, quiet: Duration) -> PasteCheck {
    if elapsed >= minimum && output && quiet >= Duration::from_millis(1500) {
        PasteCheck::Settled(PasteSettle::Quiet)
    } else if output && elapsed >= minimum + NOISY_AFTER {
        PasteCheck::Settled(PasteSettle::Noisy)
    } else if elapsed >= minimum + UNOBSERVED_AFTER {
        PasteCheck::Unobserved
    } else {
        PasteCheck::Wait
    }
}

/// Output must advance after the paste and pass its ingest floor. It then
/// either goes quiet, or stays busy and is reported noisy for the GUI's screen
/// check. Never treat a timeout as permission to submit an unobserved paste.
pub(crate) fn wait_for_paste(
    bytes: usize,
    baseline: u64,
    mut output: impl FnMut() -> Result<(u64, Duration), String>,
) -> Result<PasteSettle, String> {
    let started = Instant::now();
    let minimum = paste_settle_delay(bytes);
    loop {
        let (total, quiet) = output()?;
        match check_paste(started.elapsed(), minimum, total > baseline, quiet) {
            PasteCheck::Settled(settle) => return Ok(settle),
            PasteCheck::Unobserved => return Err("Input was pasted but the native terminal never drew it. Review the native terminal; no Enter was sent and this input must not be resent automatically.".into()),
            PasteCheck::Wait => std::thread::sleep(Duration::from_millis(20)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn typed_request_preserves_unicode_whitespace_and_punctuation_without_hotkeys() {
        for (text, expected) in [
            (
                "Read files\none\ntwo\nthree\nfour",
                "R\x1b[200~ead files\none\ntwo\x1b[201~\x1b[200~\nthree\nfour\x1b[201~",
            ),
            (
                "\n\t!हैलो\nworld",
                "\x1b[200~\n\t!\x1b[201~ह\x1b[200~ैलो\nworld\x1b[201~",
            ),
            ("///\n123", "\x1b[200~///\n\x1b[201~1\x1b[200~23\x1b[201~"),
            ("/compact", "\x1b[200~/compact\x1b[201~"),
        ] {
            assert_eq!(paste_payload(text), expected);
            assert_eq!(
                expected.replace("\x1b[200~", "").replace("\x1b[201~", ""),
                text
            );
        }
    }

    #[test]
    fn repaste_never_types_the_letter_again() {
        for (text, expected) in [
            ("Context here", "\x1b[200~ontext here\x1b[201~"),
            ("\n\t!हैलो", "\x1b[200~\n\t!\x1b[201~\x1b[200~ैलो\x1b[201~"),
            ("C", "C"),
            ("/compact", "\x1b[200~/compact\x1b[201~"),
            ("?!", "\x1b[200~?!\x1b[201~"),
            (
                "Fix a\nb\nc\nd",
                "\x1b[200~ix a\nb\nc\x1b[201~\x1b[200~\nd\x1b[201~",
            ),
        ] {
            assert_eq!(repaste_payload(text), expected);
        }
    }

    fn frames(payload: &str) -> Vec<&str> {
        payload
            .split("\x1b[200~")
            .filter_map(|part| part.split_once("\x1b[201~").map(|(inside, _)| inside))
            .collect()
    }

    /// Regression (L-250): one paste with 3+ line breaks or 800+ characters
    /// reached the model as `<pasted_content>`, so a multi-line request was
    /// treated as quoted material instead of the user's own words.
    #[test]
    fn every_paste_stays_under_claudes_fold_limits_and_keeps_the_text() {
        let paragraphs = (1..=12)
            .map(|n| format!("Paragraph {n}: keep\tthe onboarding styles, 你好 नमस्ते 😀."))
            .collect::<Vec<_>>()
            .join("\n");
        let crlf = "Line one\r\nLine two\r\nLine three\r\nLine four";
        let dense = format!("Dense {}", "context ".repeat(300));
        let blank = format!("Start{}end", "\n".repeat(9));
        for text in [paragraphs.as_str(), crlf, dense.as_str(), blank.as_str()] {
            let payload = paste_payload(text);
            assert_eq!(
                payload.replace("\x1b[200~", "").replace("\x1b[201~", ""),
                text
            );
            let pasted = frames(&payload);
            assert!(pasted.len() > 1, "{text:?} must not be one folded paste");
            for part in pasted {
                assert!(!part.is_empty() && !part.ends_with('\r'));
                assert!(part.matches(['\n', '\r']).count() - part.matches("\r\n").count() <= 2);
                assert!(part.encode_utf16().count() + part.matches('\t').count() * 3 <= 700);
            }
        }
    }

    #[test]
    fn very_long_text_keeps_one_paste_per_part() {
        let text = format!("Log\n{}", "line\n".repeat(400));
        assert_eq!(
            paste_payload(&text),
            format!("L\x1b[200~{}\x1b[201~", &text[1..])
        );
    }

    #[test]
    fn large_pastes_keep_the_full_ingest_floor_before_one_submit() {
        assert!(paste_settle_delay(512 * 1024) > paste_settle_delay(1024));
        #[cfg(windows)]
        assert_eq!(paste_settle_delay(512 * 1024), Duration::from_millis(8692));
        assert!(paste_settle_delay(1024) >= Duration::from_millis(500));
    }

    #[test]
    fn silence_without_new_output_is_not_settlement() {
        let minimum = Duration::from_millis(500);
        let quiet = Duration::from_secs(5);
        assert_eq!(
            check_paste(Duration::from_secs(5), minimum, false, quiet),
            PasteCheck::Wait
        );
        // Not even past the noisy window: unobserved output never submits.
        assert_eq!(
            check_paste(Duration::from_secs(9), minimum, false, quiet),
            PasteCheck::Unobserved
        );
    }

    #[test]
    fn output_during_ingest_or_a_paste_repaint_resets_settlement() {
        let minimum = Duration::from_secs(9);
        assert_eq!(
            check_paste(
                Duration::from_secs(8),
                minimum,
                true,
                Duration::from_secs(2)
            ),
            PasteCheck::Wait
        );
        assert_eq!(
            check_paste(
                Duration::from_secs(10),
                minimum,
                true,
                Duration::from_millis(100)
            ),
            PasteCheck::Wait
        );
        assert_eq!(
            check_paste(
                Duration::from_secs(11),
                minimum,
                true,
                Duration::from_millis(1500)
            ),
            PasteCheck::Settled(PasteSettle::Quiet)
        );
    }

    #[test]
    fn output_that_never_goes_quiet_is_noisy_only_after_the_floor_and_window() {
        let minimum = Duration::from_secs(1);
        let busy = Duration::from_millis(50);
        assert_eq!(
            check_paste(Duration::from_millis(4900), minimum, true, busy),
            PasteCheck::Wait
        );
        assert_eq!(
            check_paste(Duration::from_secs(5), minimum, true, busy),
            PasteCheck::Settled(PasteSettle::Noisy)
        );
        assert_eq!(serde_json::to_value(PasteSettle::Noisy).unwrap(), "noisy");
        assert_eq!(serde_json::to_value(PasteSettle::Quiet).unwrap(), "quiet");
    }
}
