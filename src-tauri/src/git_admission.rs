//! Fork (L-179): a cap on background git processes, so a burst of branch,
//! status and diff reads cannot slow a git action the user clicked.
//!
//! Reads share a small limit, and `fetch` has its own because it waits on the
//! network for up to two minutes. Actions the user started (stage, commit,
//! checkout, push, pull, clone, worktree changes) never take a slot, so they
//! start at once however many reads are queued.
//!
//! A slot covers one git process and is never held across calls, so a holder
//! cannot end up waiting on a second slot. Waiting blocks the thread: never
//! take a slot on the window's thread, where Tauri runs sync commands (this is
//! why `fs::git_ignored_names`, reached from `list_dir`, stays outside).

use std::sync::{Condvar, Mutex, PoisonError};

/// Background git reads running at once, across all repositories.
pub(crate) const READ_LIMIT: usize = 4;

/// `git fetch` processes running at once.
const NETWORK_LIMIT: usize = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum GitLane {
    Read,
    Network,
}

impl GitLane {
    /// The lane for a read helper's arguments.
    pub(crate) fn for_read(args: &[&str]) -> Self {
        let args = args.strip_prefix(&["--literal-pathspecs"]).unwrap_or(args);
        if args.first() == Some(&"fetch") {
            GitLane::Network
        } else {
            GitLane::Read
        }
    }
}

struct Gate {
    running: Mutex<usize>,
    freed: Condvar,
    limit: usize,
}

impl Gate {
    const fn new(limit: usize) -> Self {
        Self {
            running: Mutex::new(0),
            freed: Condvar::new(),
            limit,
        }
    }

    fn enter(&self) -> GitSlot<'_> {
        // A panic while holding the count cannot leave it wrong: the count is
        // changed in single steps, so a poisoned lock is still accurate.
        let mut running = self.running.lock().unwrap_or_else(PoisonError::into_inner);
        while *running >= self.limit {
            running = self
                .freed
                .wait(running)
                .unwrap_or_else(PoisonError::into_inner);
        }
        *running += 1;
        GitSlot { gate: self }
    }
}

/// One running git process in a capped lane; the slot frees on drop.
#[must_use = "the slot frees as soon as it is dropped"]
pub(crate) struct GitSlot<'a> {
    gate: &'a Gate,
}

impl Drop for GitSlot<'_> {
    fn drop(&mut self) {
        let mut running = self
            .gate
            .running
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        *running -= 1;
        drop(running);
        self.gate.freed.notify_one();
    }
}

static READS: Gate = Gate::new(READ_LIMIT);
static NETWORK: Gate = Gate::new(NETWORK_LIMIT);

/// Waits until `lane` has room, then holds a place in it until the slot drops.
pub(crate) fn admit(lane: GitLane) -> GitSlot<'static> {
    match lane {
        GitLane::Read => READS.enter(),
        GitLane::Network => NETWORK.enter(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{mpsc, Arc};
    use std::thread;
    use std::time::Duration;

    #[test]
    fn fetch_takes_the_network_lane_and_other_reads_the_read_lane() {
        assert_eq!(GitLane::for_read(&["fetch", "origin"]), GitLane::Network);
        assert_eq!(
            GitLane::for_read(&["--literal-pathspecs", "fetch"]),
            GitLane::Network
        );
        assert_eq!(GitLane::for_read(&["status", "--porcelain"]), GitLane::Read);
        assert_eq!(GitLane::for_read(&[]), GitLane::Read);
    }

    #[test]
    fn a_full_lane_holds_the_next_read_until_a_slot_frees() {
        let gate = Arc::new(Gate::new(1));
        let first = gate.enter();
        let (entered, waited) = mpsc::channel();
        let waiting = Arc::clone(&gate);
        let second = thread::spawn(move || {
            let _slot = waiting.enter();
            entered.send(()).unwrap();
        });
        assert!(waited.recv_timeout(Duration::from_millis(100)).is_err());
        drop(first);
        waited.recv_timeout(Duration::from_secs(10)).unwrap();
        second.join().unwrap();
    }

    #[test]
    fn never_more_than_the_limit_run_at_once() {
        let gate = Arc::new(Gate::new(3));
        let running = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let workers: Vec<_> = (0..12)
            .map(|_| {
                let (gate, running, peak) =
                    (Arc::clone(&gate), Arc::clone(&running), Arc::clone(&peak));
                thread::spawn(move || {
                    let _slot = gate.enter();
                    let now = running.fetch_add(1, Ordering::SeqCst) + 1;
                    peak.fetch_max(now, Ordering::SeqCst);
                    thread::sleep(Duration::from_millis(5));
                    running.fetch_sub(1, Ordering::SeqCst);
                })
            })
            .collect();
        for worker in workers {
            worker.join().unwrap();
        }
        assert!(peak.load(Ordering::SeqCst) <= 3);
        assert_eq!(*gate.running.lock().unwrap(), 0);
    }
}
