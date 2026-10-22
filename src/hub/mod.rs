//! The hub (daemon-core.md §4): one task that owns every tmux control client's
//! `Session`, the windows and pane streams the phone watches, and each connection's
//! credit. `State` is the pure core; `run` executes its effects. The hub never sees a
//! socket: a connection task drives it through `HubHandle` with `FromConn`, receives
//! `ToConn`, and writes frames from its own `Outbox`.

use std::path::PathBuf;
use std::time::Duration;

use bytes::Bytes;
use tokio::sync::{OwnedSemaphorePermit, mpsc, oneshot};
use tokio::task::JoinHandle;

use crate::proto::{self, ClientMsg, Encoded};
use crate::tmux::{Endpoint, Reply, Tag, TmuxError};

mod outbox;
mod owners;
mod reconcile;
mod requests;
mod run;
mod state;

pub use outbox::{Frame, Next, Outbox};
pub use state::{Effect, Input, State};

/// Watches per connection; a watch past it ends at once.
pub const MAX_WATCHES: usize = 2;
/// Control clients alive at once, lingering ones closed first to make room.
pub const MAX_CLIENTS: usize = 3;
/// How long a control client stays attached once it owns no watched window.
pub const LINGER: Duration = Duration::from_secs(15);
/// User requests are refused with `busy` once a control client has this many groups
/// in flight, so they never starve maintenance (which may use all of
/// `tmux::MAX_IN_FLIGHT`).
pub const USER_IN_FLIGHT: usize = 24;
/// Snapshots and history captures in flight daemon-wide.
pub const CAPTURE_SLOTS: usize = 2;
/// A control client with groups in flight and none answered for this long is killed.
pub const REPLY_TIMEOUT: Duration = Duration::from_secs(10);
/// A crashed control client is respawned after this.
pub const RESPAWN_DELAY: Duration = Duration::from_secs(1);
/// A second crash this soon after the first ends the watches.
pub const CRASH_WINDOW: Duration = Duration::from_secs(60);
/// Bytes outstanding to one connection: sent on `ToConn` and not yet returned.
pub const CREDIT: u64 = 2 * 1024 * 1024;
/// Reserved on a connection before a snapshot or history capture is issued.
pub const CAPTURE_RESERVATION: u64 = 1024 * 1024;
/// Reserved on a connection before the session listing runs.
pub const LISTING_RESERVATION: u64 = 256 * 1024;
/// How far control JSON may overdraw the credit before the connection is wedged.
pub const OVERDRAFT: u64 = 64 * 1024;
/// The least any `ToConn` is charged.
pub const CHARGE_FLOOR: u32 = 64;
/// The hub → connection channel: deep enough for every message the credit and the
/// overdraft allow, so it can't fill.
pub const CONN_CHANNEL: usize = ((CREDIT + OVERDRAFT) / CHARGE_FLOOR as u64) as usize;
/// The connection → hub and pump → hub channels.
pub const INBOX: usize = 128;
/// tmux names and error texts in control JSON are cut to this many bytes.
pub const NAME_LIMIT: usize = 256;
/// A watch that starved is snapshotted no sooner than this after its last snapshot.
pub const SNAPSHOT_SPACING: Duration = Duration::from_millis(250);
/// A watch's output leaves at once if its last frame left this long ago, else merged
/// when the interval ends.
pub const COALESCE: Duration = Duration::from_millis(33);
/// The most output bytes merged into one frame.
pub const MAX_FRAME: usize = 64 * 1024;
/// Bytes of text, raw bytes and key names in one `input` message.
pub const MAX_INPUT: usize = 4 * 1024;
/// Rows per `history` request; longer requests are cut.
pub const HISTORY_ROWS: i32 = 200;
/// Sizes from clients are clamped to these.
pub const COLS: std::ops::RangeInclusive<u16> = 20..=500;
pub const ROWS: std::ops::RangeInclusive<u16> = 5..=300;

/// One WebSocket connection, numbered by the hub.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ConnId(pub u64);

/// The tmux servers the hub talks to (daemon-core.md §3.8). Window and session refs
/// name theirs as `"main:<pid>-<start_time>"`; `main` is the one the session sheet
/// lists and new sessions start on.
#[derive(Debug, Clone)]
pub struct Endpoints {
    pub main: Endpoint,
}

/// What a connection tells the hub.
#[derive(Debug)]
pub enum FromConn {
    /// A client message, except `hello`, `ping` and `paste`, which the connection
    /// handles itself.
    Client(ClientMsg),
    /// A paste whose text the connection wrote to a file under a paste slot.
    Paste { watch: u32, file: PasteFile },
    /// Charged bytes written to the socket or discarded since the last `Credit`.
    Credit { bytes: u32 },
    /// The socket is gone.
    Closed,
}

/// What the hub sends a connection. Every one is charged against its credit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToConn {
    /// Control JSON. `ends` names the watch a `watchEnded` ends, which the outbox then
    /// forgets.
    Msg {
        json: Encoded,
        ends: Option<u32>,
    },
    Snapshot {
        watch: u32,
        size: proto::Size,
        restore: Bytes,
    },
    Output {
        watch: u32,
        bytes: Bytes,
    },
}

impl ToConn {
    /// What this message costs the connection's credit until the connection returns
    /// it: the payload's length, at least `CHARGE_FLOOR`. The hub and the outbox both
    /// use it, so every debit is returned exactly.
    pub fn charge(&self) -> u32 {
        let length = match self {
            Self::Msg { json, .. } => json.len(),
            Self::Snapshot { restore, .. } => restore.len(),
            Self::Output { bytes, .. } => bytes.len(),
        };
        charge(length)
    }
}

pub(crate) fn charge(length: usize) -> u32 {
    u32::try_from(length).unwrap_or(u32::MAX).max(CHARGE_FLOOR)
}

/// A paste's text in a 0600 file, and the daemon-wide paste slot it holds. The hub
/// hands it back in `Effect::RemoveFile`; deleting the file and dropping this frees
/// the slot.
#[derive(Debug)]
pub struct PasteFile {
    pub path: PathBuf,
    _slot: OwnedSemaphorePermit,
}

impl PasteFile {
    pub fn new(path: PathBuf, slot: OwnedSemaphorePermit) -> Self {
        Self { path, _slot: slot }
    }
}

/// The hub's inbox from connections and the one-shot runner.
enum HubMsg {
    Connect(oneshot::Sender<(ConnId, mpsc::Receiver<ToConn>)>),
    Conn(ConnId, FromConn),
    OneShot(Tag, Result<Reply, TmuxError>),
}

/// The hub has ended: it panicked, or the daemon is shutting down.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("the hub has ended")]
pub struct HubGone;

/// How connection tasks reach the hub.
#[derive(Clone)]
pub struct HubHandle {
    inbox: mpsc::Sender<HubMsg>,
}

impl HubHandle {
    /// Registers a connection: its id and the channel the hub sends it on. The hub
    /// closes that channel when it drops the connection as wedged (close 4002).
    pub async fn connect(&self) -> Result<(ConnId, mpsc::Receiver<ToConn>), HubGone> {
        let (reply, answer) = oneshot::channel();
        self.inbox
            .send(HubMsg::Connect(reply))
            .await
            .map_err(|_| HubGone)?;
        answer.await.map_err(|_| HubGone)
    }

    /// Waits for room in the hub's inbox.
    pub async fn send(&self, conn: ConnId, msg: FromConn) -> Result<(), HubGone> {
        self.inbox
            .send(HubMsg::Conn(conn, msg))
            .await
            .map_err(|_| HubGone)
    }
}

/// Starts the hub task. It runs until every `HubHandle` is dropped, then closes its
/// control clients. Must be called inside the tokio runtime.
pub fn spawn(endpoints: Endpoints) -> (HubHandle, JoinHandle<()>) {
    let (inbox, receiver) = mpsc::channel(INBOX);
    let state = State::new(endpoints, std::time::Instant::now());
    let task = tokio::spawn(run::run(state, receiver, inbox.downgrade()));
    (HubHandle { inbox }, task)
}
