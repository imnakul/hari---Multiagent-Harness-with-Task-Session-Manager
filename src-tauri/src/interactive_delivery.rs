//! Give the native CLI time to ingest and attach a bracketed paste before the
//! single Enter. A write acknowledgement does not mean the paste is attached.
use std::time::Duration;

pub(crate) fn paste_settle_delay(bytes: usize) -> Duration {
    // Orca's measured ConPTY ingest floor is 64 bytes/ms; Unix is much faster.
    // Keep the CLI's 500ms attachment window after ingestion, without a cap.
    let rate = if cfg!(windows) { 64 } else { 4096 };
    Duration::from_millis(500 + (bytes as u64).div_ceil(rate))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn large_pastes_keep_the_full_ingest_floor_before_one_submit() {
        assert!(paste_settle_delay(512 * 1024) > paste_settle_delay(1024));
        #[cfg(windows)]
        assert_eq!(paste_settle_delay(512 * 1024), Duration::from_millis(8692));
        assert!(paste_settle_delay(1024) >= Duration::from_millis(500));
    }
}
