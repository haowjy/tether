//! tokio's blocking pool, the only way into it (plan.md "Resource budget"). The pool is
//! capped at `BLOCKING_THREADS` for systemd's `TasksMax`, and split into lanes, so work
//! stuck on a hung mount fills its own lane and no other: auth keeps its threads
//! whatever the disks do. A lane's permit moves into the blocking closure, so a caller
//! that stops waiting frees nothing until the work ends, and a call stuck in the kernel
//! holds its lane rather than piling up threads. `clippy.toml` forbids `spawn_blocking`
//! anywhere else, and tokio's `fs` feature is off.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tracing::error;

/// tokio's blocking pool. `TasksMax` counts these threads with tmux's.
pub const BLOCKING_THREADS: usize = 8;

/// One lane: its threads, how long a caller waits for one before `Busy`, and how many
/// callers may wait at once (`None`: as many as come).
#[derive(Debug)]
struct Spec {
    name: &'static str,
    threads: usize,
    wait: Duration,
    waiters: Option<usize>,
}

/// The file API (fs.md "Constants"). Its scan and raw-response slots wait in this
/// lane's queue too: at most 8 requests wait for any fs slot.
const FS: Spec = Spec {
    name: "fs",
    threads: 4,
    wait: Duration::from_secs(10),
    waiters: Some(8),
};
/// Completion's history, `PATH` index and carapace lookup (complete.md). Its callers are
/// bounded by `/complete`'s in-flight cap, and a source that waits longer is skipped.
const INDEX: Spec = Spec {
    name: "index",
    threads: 1,
    wait: Duration::from_millis(300),
    waiters: None,
};
/// `check_dir` (completion's, and `newWindow`/`newSession`'s `dir`) and completion's
/// listings: the calls that meet any directory Jimmy types, and so any hung mount.
const DIR: Spec = Spec {
    name: "dir",
    threads: 1,
    wait: Duration::from_millis(300),
    waiters: None,
};
/// The daemon's own small files: `auth.toml` for every request's device check and every
/// socket's re-check, enrolment, and the paste files. No cap: checks come in bursts (a
/// grid of thumbnails), each a read of a few hundred bytes.
const AUTH: Spec = Spec {
    name: "auth",
    threads: 2,
    wait: Duration::from_secs(10),
    waiters: None,
};

const _: () = assert!(FS.threads + INDEX.threads + DIR.threads + AUTH.threads == BLOCKING_THREADS);

/// No thread within the lane's wait, or too many callers waiting already.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("no blocking thread in time")]
pub struct Busy;

/// Every lane. Build one per runtime: their threads add up to the runtime's pool.
#[derive(Debug, Clone)]
pub struct Lanes {
    pub fs: Lane,
    pub index: Lane,
    pub dir: Lane,
    pub auth: Lane,
}

impl Default for Lanes {
    fn default() -> Self {
        Self {
            fs: Lane::new(&FS),
            index: Lane::new(&INDEX),
            dir: Lane::new(&DIR),
            auth: Lane::new(&AUTH),
        }
    }
}

/// A share of the blocking pool; cheap to clone.
#[derive(Debug, Clone)]
pub struct Lane(Arc<Inner>);

#[derive(Debug)]
struct Inner {
    spec: &'static Spec,
    threads: Arc<Semaphore>,
    waiting: AtomicUsize,
}

impl Lane {
    fn new(spec: &'static Spec) -> Self {
        Self(Arc::new(Inner {
            spec,
            threads: Arc::new(Semaphore::new(spec.threads)),
            waiting: AtomicUsize::new(0),
        }))
    }

    /// Runs `work` on a blocking thread of this lane. A panic in `work` is logged and
    /// comes back as `Busy`, as an answer that never came. On `Busy`, `work` is dropped
    /// unrun on the caller's thread, the runtime's: nothing it owns may delete or write
    /// in its `Drop` (why `files::Temp` has none).
    pub async fn run<T, F>(&self, work: F) -> Result<T, Busy>
    where
        F: FnOnce() -> T + Send + 'static,
        T: Send + 'static,
    {
        let thread = self.wait_for(&self.0.threads).await?;
        #[expect(clippy::disallowed_methods, reason = "the lanes own the pool")]
        let joined = tokio::task::spawn_blocking(move || {
            let _thread = thread;
            work()
        })
        .await;
        joined.map_err(|cause| {
            error!(lane = self.0.spec.name, %cause, "blocking work failed");
            Busy
        })
    }

    /// `run`, not waited for: a cleanup whose caller can't wait (a `Drop`). A busy lane
    /// drops it unrun; outside a runtime it runs here.
    pub fn spawn(&self, work: impl FnOnce() + Send + 'static) {
        match tokio::runtime::Handle::try_current() {
            Ok(runtime) => {
                let lane = self.clone();
                drop(runtime.spawn(async move { lane.run(work).await }));
            }
            Err(_) => work(),
        }
    }

    /// A permit of `slots`, waited for under this lane's wait and waiter cap: fs's scan
    /// and raw-response slots queue with its threads.
    pub async fn wait_for(&self, slots: &Arc<Semaphore>) -> Result<OwnedSemaphorePermit, Busy> {
        if let Ok(permit) = slots.clone().try_acquire_owned() {
            return Ok(permit);
        }
        let cap = self.0.spec.waiters.unwrap_or(usize::MAX);
        let admitted = self
            .0
            .waiting
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| {
                (n < cap).then_some(n + 1)
            });
        if admitted.is_err() {
            return Err(Busy);
        }
        let _waiting = Waiting(&self.0.waiting);
        match tokio::time::timeout(self.0.spec.wait, slots.clone().acquire_owned()).await {
            Ok(Ok(permit)) => Ok(permit),
            // Timed out, or closed (never: no semaphore here is closed).
            _ => Err(Busy),
        }
    }
}

/// One caller counted as waiting, until dropped.
struct Waiting<'a>(&'a AtomicUsize);

impl Drop for Waiting<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn waits_have_a_deadline_and_a_cap() {
        let fs = Lane::new(&FS);
        let raw = Arc::new(Semaphore::new(2));
        let held: Vec<_> = (0..2)
            .map(|_| raw.clone().try_acquire_owned().expect("free"))
            .collect();
        let cap = FS.waiters.expect("a cap");
        // Eight requests wait; the ninth is refused at once.
        let waiters: Vec<_> = (0..cap)
            .map(|_| {
                let (fs, raw) = (fs.clone(), raw.clone());
                tokio::spawn(async move { fs.wait_for(&raw).await.map(drop) })
            })
            .collect();
        tokio::task::yield_now().await;
        assert_eq!(fs.wait_for(&raw).await.map(drop), Err(Busy));
        assert_eq!(fs.0.waiting.load(Ordering::Acquire), cap);
        // Freed slots pass to the waiters in turn, well within the wait.
        drop(held);
        let started = tokio::time::Instant::now();
        let mut through = 0;
        for waiter in waiters {
            if waiter.await.expect("joined").is_ok() {
                through += 1;
            }
        }
        assert_eq!(through, cap);
        assert!(started.elapsed() < FS.wait);

        // With every slot held for good, a waiter is refused after the wait.
        let _held: Vec<_> = (0..2)
            .map(|_| raw.clone().try_acquire_owned().expect("free"))
            .collect();
        let started = tokio::time::Instant::now();
        assert_eq!(fs.wait_for(&raw).await.map(drop), Err(Busy));
        assert_eq!(started.elapsed(), FS.wait);
        assert_eq!(fs.0.waiting.load(Ordering::Acquire), 0);
    }
}
