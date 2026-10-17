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

fn paste_settled(elapsed: Duration, minimum: Duration, output: bool, quiet: Duration) -> bool {
    elapsed >= minimum && output && quiet >= Duration::from_millis(1500)
}

/// Output must advance after the paste, then go quiet after its ingest floor.
/// Never treat a timeout as permission to submit an unobserved paste.
pub(crate) fn wait_for_paste(
    bytes: usize,
    baseline: u64,
    mut output: impl FnMut() -> Result<(u64, Duration), String>,
) -> Result<(), String> {
    let started = Instant::now();
    let minimum = paste_settle_delay(bytes);
    loop {
        let (total, quiet) = output()?;
        let elapsed = started.elapsed();
        if paste_settled(elapsed, minimum, total > baseline, quiet) {
            return Ok(());
        }
        if elapsed >= minimum + Duration::from_secs(8) {
            return Err("Input was pasted but its native output did not settle. Review the native terminal; no Enter was sent and this input must not be resent automatically.".into());
        }
        std::thread::sleep(Duration::from_millis(20));
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
        assert!(!paste_settled(
            Duration::from_secs(5),
            Duration::from_millis(500),
            false,
            Duration::from_secs(5),
        ));
    }

    #[test]
    fn output_during_ingest_or_a_paste_repaint_resets_settlement() {
        let minimum = Duration::from_secs(9);
        assert!(!paste_settled(
            Duration::from_secs(8),
            minimum,
            true,
            Duration::from_secs(2),
        ));
        assert!(!paste_settled(
            Duration::from_secs(10),
            minimum,
            true,
            Duration::from_millis(100),
        ));
        assert!(paste_settled(
            Duration::from_secs(11),
            minimum,
            true,
            Duration::from_millis(1500),
        ));
    }
}
