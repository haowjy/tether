//! The file API's limits (fs.md "Constants", "Limits and the memory ceiling"): 1 scan,
//! 2 raw responses, 1 upload, waited for in the fs lane's queue (`crate::blocking`), so a
//! slow disk stalls the file manager without holding memory or starving auth and pastes
//! of threads. Blocking calls run on `lane`.

use std::sync::Arc;

use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use super::FsError;
use crate::blocking::{Lane, PermitPool};

const SCANS: usize = 1;
const RAW_RESPONSES: usize = 2;
const UPLOADS: usize = 1;

/// Daemon-wide, shared by every fs request.
#[derive(Debug)]
pub struct Slots {
    /// The fs lane: every blocking call, `lane.run(work).await??`.
    pub lane: Lane,
    scan: PermitPool,
    raw: PermitPool,
    upload: Arc<Semaphore>,
}

impl Slots {
    pub fn new(lane: Lane) -> Self {
        Self {
            scan: lane.permits(SCANS),
            raw: lane.permits(RAW_RESPONSES),
            upload: Arc::new(Semaphore::new(UPLOADS)),
            lane,
        }
    }

    /// The scan slot, for one directory listing.
    pub async fn scan(&self) -> Result<OwnedSemaphorePermit, FsError> {
        Ok(self.scan.acquire().await?)
    }

    /// A raw-response slot, held by the response's producer until it ends.
    pub async fn raw(&self) -> Result<OwnedSemaphorePermit, FsError> {
        Ok(self.raw.acquire().await?)
    }

    /// The upload slot, or `busy` at once: native sends one upload at a time.
    pub fn upload(&self) -> Result<OwnedSemaphorePermit, FsError> {
        self.upload
            .clone()
            .try_acquire_owned()
            .map_err(|_| FsError::Busy)
    }
}
