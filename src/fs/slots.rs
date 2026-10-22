//! The file API's limits (fs.md "Constants", "Limits and the memory ceiling"): 4 of the
//! runtime's 8 blocking threads, 1 scan, 2 raw responses, 1 upload. Waits have a
//! deadline and at most 8 requests wait at once, so a slow disk stalls the file
//! manager without holding memory or starving auth and pastes of threads.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use super::FsError;

const FS_THREADS: usize = 4;
const SCANS: usize = 1;
const RAW_RESPONSES: usize = 2;
const UPLOADS: usize = 1;
const WAIT: Duration = Duration::from_secs(10);
const MAX_WAITING: usize = 8;

/// Daemon-wide, shared by every fs request.
#[derive(Debug)]
pub struct Slots {
    fs: Arc<Semaphore>,
    scan: Arc<Semaphore>,
    raw: Arc<Semaphore>,
    upload: Arc<Semaphore>,
    waiting: AtomicUsize,
}

impl Default for Slots {
    fn default() -> Self {
        Self {
            fs: Arc::new(Semaphore::new(FS_THREADS)),
            scan: Arc::new(Semaphore::new(SCANS)),
            raw: Arc::new(Semaphore::new(RAW_RESPONSES)),
            upload: Arc::new(Semaphore::new(UPLOADS)),
            waiting: AtomicUsize::new(0),
        }
    }
}

impl Slots {
    /// Runs `work` on a blocking thread under an fs slot. The slot moves into the
    /// thread, so it is freed when the work ends, not when a dropped request stops
    /// waiting for it.
    pub async fn blocking<T, F>(&self, work: F) -> Result<T, FsError>
    where
        F: FnOnce() -> Result<T, FsError> + Send + 'static,
        T: Send + 'static,
    {
        let slot = self.wait(&self.fs).await?;
        tokio::task::spawn_blocking(move || {
            let _slot = slot;
            work()
        })
        .await
        .map_err(|joined| FsError::Internal(std::io::Error::other(joined)))?
    }

    /// The scan slot, for one directory listing.
    pub async fn scan(&self) -> Result<OwnedSemaphorePermit, FsError> {
        self.wait(&self.scan).await
    }

    /// A raw-response slot, held by the response's producer until it ends.
    pub async fn raw(&self) -> Result<OwnedSemaphorePermit, FsError> {
        self.wait(&self.raw).await
    }

    /// The upload slot, or `busy` at once: native sends one upload at a time.
    pub fn upload(&self) -> Result<OwnedSemaphorePermit, FsError> {
        self.upload
            .clone()
            .try_acquire_owned()
            .map_err(|_| FsError::Busy)
    }

    async fn wait(&self, slots: &Arc<Semaphore>) -> Result<OwnedSemaphorePermit, FsError> {
        if let Ok(slot) = slots.clone().try_acquire_owned() {
            return Ok(slot);
        }
        let admitted = self
            .waiting
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |waiting| {
                (waiting < MAX_WAITING).then_some(waiting + 1)
            });
        if admitted.is_err() {
            return Err(FsError::Busy);
        }
        let _waiting = Waiting(&self.waiting);
        match tokio::time::timeout(WAIT, slots.clone().acquire_owned()).await {
            Ok(Ok(slot)) => Ok(slot),
            // Timed out, or closed (never: the semaphores are never closed).
            _ => Err(FsError::Busy),
        }
    }
}

/// One request counted as waiting, until dropped.
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
        let slots = Arc::new(Slots::default());
        let held: Vec<_> = (0..RAW_RESPONSES)
            .map(|_| slots.raw.clone().try_acquire_owned().expect("free"))
            .collect();
        // Eight requests wait; the ninth is refused at once.
        let waiters: Vec<_> = (0..MAX_WAITING)
            .map(|_| {
                let slots = slots.clone();
                tokio::spawn(async move { slots.raw().await.map(drop) })
            })
            .collect();
        tokio::task::yield_now().await;
        assert!(matches!(slots.raw().await, Err(FsError::Busy)));
        assert_eq!(slots.waiting.load(Ordering::Acquire), MAX_WAITING);
        // Freed slots pass to the waiters in turn, well within the wait.
        drop(held);
        let started = tokio::time::Instant::now();
        let mut through = 0;
        for waiter in waiters {
            if waiter.await.expect("joined").is_ok() {
                through += 1;
            }
        }
        assert_eq!(through, MAX_WAITING);
        assert!(started.elapsed() < WAIT);

        // With every slot held for good, a waiter is refused after the wait.
        let _held: Vec<_> = (0..RAW_RESPONSES)
            .map(|_| slots.raw.clone().try_acquire_owned().expect("free"))
            .collect();
        let started = tokio::time::Instant::now();
        assert!(matches!(slots.raw().await, Err(FsError::Busy)));
        assert_eq!(started.elapsed(), WAIT);
        assert_eq!(slots.waiting.load(Ordering::Acquire), 0);
    }
}
