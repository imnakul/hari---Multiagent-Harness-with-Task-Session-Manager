//! Observe native output settling after a bracketed paste before the single
//! Enter. A write acknowledgement does not mean the paste is attached.
use std::time::{Duration, Instant};

fn frame(text: &str) -> String {
    format!("\x1b[200~{text}\x1b[201~")
}

/// Claude manual mode needs literal request text outside a folded context paste.
/// Keep every original character and never type a control or mode shortcut.
pub(crate) fn paste_payload(text: &str) -> String {
    if text != "/compact" {
        if let Some((offset, letter)) = text.char_indices().find(|(_, c)| c.is_alphanumeric()) {
            let end = offset + letter.len_utf8();
            return format!(
                "{}{}{}",
                if offset == 0 {
                    String::new()
                } else {
                    frame(&text[..offset])
                },
                letter,
                if end == text.len() {
                    String::new()
                } else {
                    frame(&text[end..])
                },
            );
        }
    }
    frame(text)
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
                "R\x1b[200~ead files\none\ntwo\nthree\nfour\x1b[201~",
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
