//! The hub's pure core (daemon-core.md §4.1–§4.6): every control client's `Session`,
//! the watched windows with their streams and owners, and each connection's credit,
//! in one value. `handle` turns one input into effects; `reconcile` (reconcile.rs) then
//! sends tmux whatever the watches need. No I/O and no clock: time comes in with each
//! input.
//!
//! This file holds the model, tmux's events and the pane streams; owners.rs decides
//! who owns each window and runs the control clients' lives; requests.rs answers the
//! connections.

use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;

use bytes::Bytes;
use tracing::warn;

use super::{
    CAPTURE_RESERVATION, COLS, CREDIT, ConnId, Endpoints, FromConn, NAME_LIMIT, OVERDRAFT,
    PasteFile, REPLY_TIMEOUT, ROWS, SNAPSHOT_SPACING, ToConn, charge,
};
use crate::proto::{self, Encoded, ErrorCode, ServerMsg, SessionRef, WatchEndReason, WindowRef};
use crate::tmux::{
    ClientId, Endpoint, Event, OneShotCmd, Op, PaneId, PumpMsg, Reply, ServerInstance, Session,
    SessionId, Size, Step, Tag, TmuxError, WindowId,
};

/// The endpoint the session sheet lists and new sessions start on.
pub(super) const MAIN: usize = 0;

#[derive(Debug)]
pub enum Input {
    /// A connection registered; its messages follow as `Conn`.
    Connected(ConnId),
    Pump(ClientId, PumpMsg),
    Conn(ConnId, FromConn),
    OneShot(Tag, Result<Reply, TmuxError>),
    /// A deadline from `next_deadline` passed.
    Tick,
}

#[derive(Debug)]
pub enum Effect {
    /// Start a control client attached to `session`; `Write`s for it follow.
    SpawnClient {
        client: ClientId,
        endpoint: Endpoint,
        session: SessionId,
    },
    Write {
        client: ClientId,
        lines: Vec<String>,
    },
    /// The client is gone from the hub: close its stdin if it is still open. Its pump's
    /// `Exited`, if still to come, is then ignored.
    CloseClient {
        client: ClientId,
    },
    /// Run a one-shot; its answer comes back as `Input::OneShot`. One at a time.
    OneShot {
        tag: Tag,
        endpoint: Endpoint,
        cmd: OneShotCmd,
    },
    Send {
        conn: ConnId,
        msg: ToConn,
    },
    /// The connection is gone from the hub: drop its channel. A connection still
    /// reading it was dropped as wedged, and closes with 4002.
    DropConn {
        conn: ConnId,
    },
    RemoveFile {
        file: PasteFile,
    },
}

pub struct State {
    pub(super) endpoints: Vec<EndpointState>,
    pub(super) clients: BTreeMap<ClientId, Client>,
    pub(super) windows: BTreeMap<WinKey, Window>,
    pub(super) conns: BTreeMap<ConnId, Conn>,
    /// Exited control clients whose session is being checked (§4.5).
    pub(super) exits: BTreeMap<ClientId, ExitCheck>,
    /// The one one-shot that may run, and what its answer is for.
    pub(super) oneshot: Option<(Tag, OneShotWork)>,
    pub(super) now: Instant,
    pub(super) effects: Vec<Effect>,
    /// Whether this input may have changed what tmux should be doing. Pump bytes that
    /// only carry output delivered as it came, the hot path, don't, so `reconcile`
    /// skips them.
    pub(super) dirty: bool,
    pub(super) next_tag: u64,
    pub(super) next_client: u64,
}

pub(super) struct EndpointState {
    pub(super) name: &'static str,
    pub(super) endpoint: Endpoint,
    /// The server instance last seen running; ids from any other are dead.
    pub(super) live: Option<ServerInstance>,
}

/// A window on one run of one endpoint's server.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct WinKey {
    pub(super) endpoint: usize,
    pub(super) server: ServerInstance,
    pub(super) window: WindowId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct WatchKey {
    pub(super) conn: ConnId,
    pub(super) watch: u32,
}

/// A watched window and the stream of the pane it shows (§4.2, §4.3). It exists while
/// it has a watch.
pub(super) struct Window {
    pub(super) watches: BTreeSet<WatchKey>,
    /// The size of the latest `watch` or `resize`: the vote its owner casts.
    pub(super) vote: Size,
    pub(super) phase: Phase,
    pub(super) locate: Locate,
    pub(super) stream: Stream,
    pub(super) cwd: Option<String>,
}

pub(super) enum Phase {
    /// Being found. `after` is how its owner ended, applied by the first answer that
    /// finds the window still in that owner's session.
    Locating { after: Option<Exit> },
    /// Found in a session whose control client is starting (or waits to respawn).
    Starting { client: ClientId },
    /// The owner's output, layout, active pane and cwd are the window's.
    Bound {
        owner: ClientId,
        session: SessionId,
        pane: PaneId,
    },
    /// The owner exited; waits for its session check.
    Orphaned { client: ClientId },
}

/// One Locate per window in flight; a trigger during it runs it again afterwards.
#[derive(Default)]
pub(super) struct Locate {
    pub(super) needed: bool,
    /// The control client it must run on: the window binds only from an answer its
    /// owner gave, which is ordered with the owner's notifications.
    pub(super) on: Option<ClientId>,
    pub(super) in_flight: Option<Tag>,
}

pub(super) struct Stream {
    /// False: output is dropped until a snapshot lands.
    pub(super) live: bool,
    pub(super) size: Size,
    /// The snapshot that can make it live, and the watches whose credit it reserved.
    pub(super) inflight: Option<Inflight>,
}

pub(super) struct Inflight {
    pub(super) tag: Tag,
    pub(super) client: ClientId,
    pub(super) reserved: BTreeSet<WatchKey>,
}

#[derive(Default)]
pub(super) struct Conn {
    /// Charged bytes not yet returned.
    pub(super) outstanding: u64,
    /// Credit held for captures and listings in flight.
    pub(super) reserved: u64,
    pub(super) watches: BTreeMap<u32, Watch>,
}

pub(super) struct Watch {
    pub(super) window: WinKey,
    /// Gets the next snapshot, and no output until then.
    pub(super) awaiting: bool,
    /// Started awaiting because its output didn't fit: snapshot spacing applies.
    pub(super) starved: bool,
    pub(super) last_snapshot: Option<Instant>,
    /// What its last `watching` said.
    pub(super) told: Option<Told>,
}

#[derive(Clone, PartialEq, Eq)]
pub(super) struct Told {
    pub(super) session: SessionId,
    pub(super) pane: PaneId,
    pub(super) cwd: Option<String>,
}

pub(super) struct Client {
    pub(super) endpoint: usize,
    pub(super) session: SessionId,
    pub(super) phase: ClientPhase,
    /// Votes and subscriptions sent, which count as applied.
    pub(super) votes: BTreeMap<WindowId, Size>,
    pub(super) subscriptions: BTreeSet<WindowId>,
    /// What each tag in flight is for.
    pub(super) pending: BTreeMap<Tag, Work>,
    /// When a group last completed, or the first of the groups in flight went out.
    pub(super) progress: Instant,
    pub(super) linger: Option<Instant>,
    pub(super) last_crash: Option<Instant>,
}

pub(super) enum ClientPhase {
    /// A crash respawn waiting for its delay; no process yet.
    Delayed {
        until: Instant,
    },
    Starting(Session),
    Ready {
        tmux: Session,
        server: ServerInstance,
    },
}

pub(super) enum Work {
    Locate {
        window: WinKey,
    },
    SessionCheck {
        exited: ClientId,
    },
    /// `window` is `None` once the hub stopped caring; the tag still holds a capture
    /// slot until tmux answers.
    Snapshot {
        window: Option<WinKey>,
        pane: PaneId,
    },
    /// Its answer also ends the snapshots it invalidated, which answer nothing.
    Release {
        invalidates: Vec<Tag>,
    },
    History {
        conn: ConnId,
        watch: u32,
        req: u32,
        start: i32,
        end: i32,
    },
    Input {
        conn: ConnId,
        watch: u32,
    },
    Paste {
        conn: ConnId,
        watch: u32,
        file: PasteFile,
    },
    /// Votes and subscriptions: a failure on a window that has gone is harmless.
    Maintenance,
}

pub(super) enum OneShotWork {
    Locate {
        window: WinKey,
    },
    SessionCheck {
        exited: ClientId,
    },
    List {
        conn: ConnId,
        req: u32,
    },
    Create {
        conn: ConnId,
        req: u32,
        endpoint: usize,
        /// The instance a new window's session belongs to; `None` for a new session.
        server: Option<ServerInstance>,
    },
}

/// How a control client ended (§4.5).
#[derive(Clone)]
pub(super) struct Exit {
    pub(super) endpoint: usize,
    pub(super) session: SessionId,
    /// tmux said `%exit` and the hub didn't kill it.
    pub(super) detached: bool,
    pub(super) at: Instant,
    pub(super) last_crash: Option<Instant>,
    pub(super) reason: String,
}

pub(super) struct ExitCheck {
    pub(super) exit: Exit,
    pub(super) server: Option<ServerInstance>,
    pub(super) in_flight: Option<Tag>,
}

impl State {
    pub fn new(endpoints: Endpoints, now: Instant) -> Self {
        Self {
            endpoints: vec![EndpointState {
                name: "main",
                endpoint: endpoints.main,
                live: None,
            }],
            clients: BTreeMap::new(),
            windows: BTreeMap::new(),
            conns: BTreeMap::new(),
            exits: BTreeMap::new(),
            oneshot: None,
            now,
            effects: Vec::new(),
            dirty: false,
            next_tag: 1,
            next_client: 1,
        }
    }

    pub fn handle(&mut self, input: Input, now: Instant) -> Vec<Effect> {
        // An input at or past the deadline stands in for the Tick the runtime didn't
        // get to: once `now` passes a deadline, `next_deadline` no longer reports it.
        let due = self.next_deadline().is_some_and(|deadline| deadline <= now);
        self.now = now;
        self.dirty = due || !matches!(input, Input::Pump(_, PumpMsg::Bytes(_)));
        match input {
            Input::Connected(conn) => {
                self.conns.insert(conn, Conn::default());
            }
            Input::Pump(client, PumpMsg::Bytes(bytes)) => self.feed(client, &bytes),
            Input::Pump(client, PumpMsg::Exited { stderr_tail }) => {
                let reason = if stderr_tail.is_empty() {
                    "the tmux control client exited".to_owned()
                } else {
                    stderr_tail
                };
                self.client_exited(client, reason, false);
            }
            Input::Conn(conn, msg) => self.conn(conn, msg),
            Input::OneShot(tag, result) => self.oneshot_answered(tag, result),
            Input::Tick => {}
        }
        self.timers();
        if self.dirty {
            self.reconcile();
        }
        std::mem::take(&mut self.effects)
    }

    /// When `handle(Input::Tick, …)` is next due: a respawn, a linger's end, a reply
    /// deadline, a starved watch's snapshot spacing. `None`: nothing is waiting on time.
    /// A deadline is reported until an input comes at or after it, which handles it,
    /// so one that can't be acted on then (no credit, no capture slot) can't spin.
    pub fn next_deadline(&self) -> Option<Instant> {
        let clients = self.clients.values().flat_map(|client| {
            let respawn = match client.phase {
                ClientPhase::Delayed { until } => Some(until),
                _ => None,
            };
            let reply = client
                .tmux()
                .filter(|tmux| tmux.in_flight() > 0)
                .map(|_| client.progress + REPLY_TIMEOUT);
            [respawn, client.linger, reply]
        });
        let spacing = self.conns.values().flat_map(|conn| {
            conn.watches
                .values()
                .filter(|watch| watch.awaiting && watch.starved)
                .map(|watch| watch.last_snapshot.map(|at| at + SNAPSHOT_SPACING))
        });
        clients
            .chain(spacing)
            .flatten()
            .filter(|deadline| *deadline > self.now)
            .min()
    }

    // --- tmux ---

    pub(super) fn feed(&mut self, client: ClientId, bytes: &[u8]) {
        let Some(tmux) = self.clients.get_mut(&client).and_then(Client::tmux_mut) else {
            return;
        };
        let before = tmux.in_flight();
        let step = tmux.feed(bytes);
        self.apply(client, before, step);
    }

    pub(super) fn next_tag(&mut self) -> Tag {
        let tag = Tag(self.next_tag);
        self.next_tag += 1;
        tag
    }

    /// Sends `op` on a control client the caller found ready and with room.
    pub(super) fn request(&mut self, client: ClientId, tag: Tag, op: Op, work: Work) {
        let Some(record) = self.clients.get_mut(&client) else {
            return self.settle(client, tag, work);
        };
        record.pending.insert(tag, work);
        let Some(tmux) = record.ready_mut() else {
            if let Some(work) = record.pending.remove(&tag) {
                self.settle(client, tag, work);
            }
            return;
        };
        let before = tmux.in_flight();
        let step = tmux.request(tag, op);
        self.apply(client, before, step);
    }

    /// Writes a step's lines and applies its events in stream order.
    pub(super) fn apply(&mut self, client: ClientId, before: usize, step: Step) {
        let Some(record) = self.clients.get_mut(&client) else {
            return;
        };
        let after = record.tmux().map_or(0, Session::in_flight);
        // Each line adds one group in flight, so fewer than that means some completed,
        // which frees room for waiting work.
        let completed = before + step.lines.len() > after;
        if completed || (before == 0 && after > 0) {
            record.progress = self.now;
        }
        self.dirty |= completed;
        if !step.lines.is_empty() {
            self.write(client, step.lines);
        }
        for event in step.events {
            if !self.clients.contains_key(&client) {
                break;
            }
            self.dirty |= !matches!(event, Event::Output { .. });
            self.event(client, event);
        }
    }

    pub(super) fn write(&mut self, client: ClientId, lines: Vec<String>) {
        if let Some(Effect::Write {
            client: last,
            lines: queued,
        }) = self.effects.last_mut()
        {
            if *last == client {
                queued.extend(lines);
                return;
            }
        }
        self.effects.push(Effect::Write { client, lines });
    }

    pub(super) fn event(&mut self, client: ClientId, event: Event) {
        match event {
            Event::Ready { server, version } => self.client_ready(client, server, &version),
            Event::Output { pane, bytes } => self.output(client, pane, bytes),
            Event::Snapshot {
                tag,
                pane: _,
                size,
                restore,
            } => self.snapshot(client, tag, size, restore),
            Event::Done { tag, result } => self.done(client, tag, result),
            Event::Gap { pane } => {
                if let Some(key) = self.owned_pane(client, pane) {
                    self.break_stream(key);
                }
            }
            Event::Layout { window, panes } => {
                let Some(key) = self.owned(client, window) else {
                    return;
                };
                let Some(window) = self.windows.get_mut(&key) else {
                    return;
                };
                let Phase::Bound { pane, .. } = window.phase else {
                    return;
                };
                let size = panes
                    .iter()
                    .find(|(id, _)| *id == pane)
                    .map(|(_, size)| *size);
                if let Some(size) = size.filter(|size| *size != window.stream.size) {
                    window.stream.size = size;
                    self.break_stream(key);
                }
            }
            Event::ActivePane { window, pane } => {
                let Some(key) = self.owned(client, window) else {
                    return;
                };
                if let Some(Phase::Bound { pane: current, .. }) =
                    self.windows.get_mut(&key).map(|window| &mut window.phase)
                {
                    if *current != pane {
                        *current = pane;
                        self.break_stream(key);
                        self.tell(key);
                    }
                }
            }
            Event::Cwd { window, path } => {
                let Some(key) = self.owned(client, window) else {
                    return;
                };
                if let Some(window) = self.windows.get_mut(&key) {
                    if window.cwd.as_deref() != Some(&path) {
                        window.cwd = Some(path);
                        self.tell(key);
                    }
                }
            }
            Event::WindowUnlinked { window } => {
                // Closed or moved: only a Locate tells which.
                let Some(record) = self.clients.get(&client) else {
                    return;
                };
                let (endpoint, server) = (record.endpoint, record.server());
                for (key, watched) in &mut self.windows {
                    if key.endpoint == endpoint
                        && Some(key.server) == server
                        && key.window == window
                        && matches!(watched.phase, Phase::Bound { .. } | Phase::Locating { .. })
                    {
                        watched.locate.needed = true;
                    }
                }
            }
            Event::WindowRenamed { window, name } => {
                if let Some((endpoint, server)) = self.reporter(client) {
                    let window = self.window_ref(endpoint, server, window);
                    self.broadcast(&ServerMsg::WindowRenamed {
                        window,
                        name: cut(name),
                    });
                }
            }
            Event::SessionsChanged => {
                if self.reporter(client).is_some() {
                    self.broadcast(&ServerMsg::SessionsChanged);
                }
            }
            Event::Fatal(error) => {
                warn!(client = client.0, %error, "tmux control client failed");
                self.client_exited(client, error.to_string(), true);
            }
        }
    }

    pub(super) fn output(&mut self, client: ClientId, pane: PaneId, bytes: Bytes) {
        let Some(key) = self.owned_pane(client, pane) else {
            return;
        };
        let Some(window) = self.windows.get(&key) else {
            return;
        };
        if !window.stream.live {
            return;
        }
        let charge = u64::from(charge(bytes.len()));
        let watches: Vec<WatchKey> = window.watches.iter().copied().collect();
        for key in watches {
            let room = self.output_room(key.conn);
            let Some(conn) = self.conns.get_mut(&key.conn) else {
                continue;
            };
            let Some(watch) = conn.watches.get_mut(&key.watch) else {
                continue;
            };
            if watch.awaiting {
                continue;
            }
            if charge <= room {
                conn.outstanding += charge;
                self.effects.push(Effect::Send {
                    conn: key.conn,
                    msg: ToConn::Output {
                        watch: key.watch,
                        bytes: bytes.clone(),
                    },
                });
            } else {
                // Only this watch starves; its catch-up is the next snapshot.
                watch.awaiting = true;
                watch.starved = true;
                self.dirty = true;
            }
        }
    }

    /// Credit output may use: while one of the connection's watches waits for a
    /// snapshot it hasn't reserved yet, output fits only above that reservation.
    pub(super) fn output_room(&self, conn: ConnId) -> u64 {
        let Some(state) = self.conns.get(&conn) else {
            return 0;
        };
        let waiting = state.watches.iter().any(|(id, watch)| {
            watch.awaiting && !self.reserved_for(WatchKey { conn, watch: *id }, watch.window)
        });
        let hold = if waiting { CAPTURE_RESERVATION } else { 0 };
        CREDIT.saturating_sub(state.outstanding + state.reserved + hold)
    }

    pub(super) fn reserved_for(&self, watch: WatchKey, key: WinKey) -> bool {
        self.windows
            .get(&key)
            .and_then(|window| window.stream.inflight.as_ref())
            .is_some_and(|inflight| inflight.reserved.contains(&watch))
    }

    pub(super) fn snapshot(&mut self, client: ClientId, tag: Tag, size: Size, restore: Bytes) {
        let Some(Work::Snapshot {
            window: Some(key), ..
        }) = self
            .clients
            .get_mut(&client)
            .and_then(|record| record.pending.remove(&tag))
        else {
            return;
        };
        let Some(window) = self.windows.get_mut(&key) else {
            return;
        };
        let Some(inflight) = window
            .stream
            .inflight
            .take_if(|inflight| inflight.tag == tag)
        else {
            return;
        };
        if restore.len() as u64 > CAPTURE_RESERVATION {
            self.abandon(inflight);
            let message = "the pane's screen is too large to show".to_owned();
            return self.end_window(key, WatchEndReason::Error, Some(message));
        }
        window.stream.live = true;
        window.stream.size = size;
        let charge = u64::from(charge(restore.len()));
        let size = proto::Size {
            cols: size.cols,
            rows: size.rows,
        };
        for key in inflight.reserved {
            let Some(conn) = self.conns.get_mut(&key.conn) else {
                continue;
            };
            conn.reserved = conn.reserved.saturating_sub(CAPTURE_RESERVATION);
            let Some(watch) = conn.watches.get_mut(&key.watch) else {
                continue;
            };
            conn.outstanding += charge;
            watch.awaiting = false;
            watch.starved = false;
            watch.last_snapshot = Some(self.now);
            self.effects.push(Effect::Send {
                conn: key.conn,
                msg: ToConn::Snapshot {
                    watch: key.watch,
                    size,
                    restore: restore.clone(),
                },
            });
        }
    }

    pub(super) fn done(&mut self, client: ClientId, tag: Tag, result: Result<Reply, TmuxError>) {
        let Some(record) = self.clients.get_mut(&client) else {
            return;
        };
        let Some(work) = record.pending.remove(&tag) else {
            return;
        };
        match work {
            Work::Locate { window } => self.located(window, tag, Some(client), result),
            Work::SessionCheck { exited } => self.checked(exited, tag, result),
            Work::Snapshot { window, .. } => {
                let Some(key) = window else {
                    return;
                };
                let Some(stream) = self.windows.get_mut(&key).map(|window| &mut window.stream)
                else {
                    return;
                };
                let Some(inflight) = stream.inflight.take_if(|inflight| inflight.tag == tag) else {
                    return;
                };
                self.abandon(inflight);
                match result {
                    // The window's active pane changed or it closed: find out which.
                    Err(TmuxError::PaneGone) => {
                        if let Some(window) = self.windows.get_mut(&key) {
                            window.locate.needed = true;
                        }
                    }
                    Err(TmuxError::Torn) => self.end_window(
                        key,
                        WatchEndReason::Error,
                        Some("a tmux hook keeps changing the pane during snapshots".to_owned()),
                    ),
                    Err(TmuxError::TooLarge) => self.end_window(
                        key,
                        WatchEndReason::Error,
                        Some("the pane's screen is too large to show".to_owned()),
                    ),
                    Err(error) => self.end_window(
                        key,
                        WatchEndReason::Error,
                        Some(cut(format!("snapshot failed: {error}"))),
                    ),
                    Ok(_) => {}
                }
            }
            Work::Release { invalidates } => {
                // Ordered after the snapshots it invalidated, which answer nothing.
                if let Some(record) = self.clients.get_mut(&client) {
                    for tag in invalidates {
                        record.pending.remove(&tag);
                    }
                }
            }
            Work::History {
                conn,
                watch,
                req,
                start,
                end,
            } => self.history_answered(conn, watch, req, start, end, result),
            Work::Input { conn, watch } => {
                if let Err(error) = result {
                    self.refuse_tmux(conn, None, Some(watch), &error);
                }
            }
            Work::Paste { conn, watch, file } => {
                self.effects.push(Effect::RemoveFile { file });
                if let Err(error) = result {
                    self.refuse_tmux(conn, None, Some(watch), &error);
                }
            }
            Work::Maintenance => {}
        }
    }

    /// A tag that will never be answered: its control client is gone.
    pub(super) fn settle(&mut self, client: ClientId, tag: Tag, work: Work) {
        match work {
            Work::Locate { window } => {
                if let Some(window) = self.windows.get_mut(&window) {
                    if window.locate.in_flight == Some(tag) {
                        window.locate.in_flight = None;
                        window.locate.needed = true;
                    }
                    if window.locate.on == Some(client) {
                        window.locate.on = None;
                    }
                }
            }
            Work::SessionCheck { exited } => {
                if let Some(check) = self.exits.get_mut(&exited) {
                    check.in_flight = check.in_flight.filter(|current| *current != tag);
                }
            }
            Work::Snapshot {
                window: Some(key), ..
            } => {
                let inflight = self.windows.get_mut(&key).and_then(|window| {
                    window
                        .stream
                        .inflight
                        .take_if(|inflight| inflight.tag == tag)
                });
                if let Some(inflight) = inflight {
                    self.abandon(inflight);
                }
            }
            Work::History {
                conn, watch, req, ..
            } => {
                self.unreserve(conn, CAPTURE_RESERVATION);
                self.refuse(
                    conn,
                    Some(req),
                    Some(watch),
                    ErrorCode::Tmux,
                    "the tmux control client ended",
                );
            }
            Work::Paste { file, .. } => self.effects.push(Effect::RemoveFile { file }),
            Work::Snapshot { window: None, .. }
            | Work::Release { .. }
            | Work::Input { .. }
            | Work::Maintenance => {}
        }
    }

    // --- streams ---

    /// The stream's continuity is lost: every watch waits for a fresh snapshot, and one
    /// already in flight may predate the cause, so it is forgotten.
    pub(super) fn break_stream(&mut self, key: WinKey) {
        let Some(window) = self.windows.get_mut(&key) else {
            return;
        };
        window.stream.live = false;
        let inflight = window.stream.inflight.take();
        for watch in &window.watches {
            if let Some(watch) = self
                .conns
                .get_mut(&watch.conn)
                .and_then(|conn| conn.watches.get_mut(&watch.watch))
            {
                watch.awaiting = true;
                watch.starved = false;
            }
        }
        if let Some(inflight) = inflight {
            self.abandon(inflight);
        }
    }

    /// A snapshot the hub no longer waits for: its reservations go back now; its tag
    /// keeps a capture slot until tmux answers.
    pub(super) fn abandon(&mut self, inflight: Inflight) {
        for watch in inflight.reserved {
            self.unreserve(watch.conn, CAPTURE_RESERVATION);
        }
        if let Some(Work::Snapshot { window, .. }) = self
            .clients
            .get_mut(&inflight.client)
            .and_then(|record| record.pending.get_mut(&inflight.tag))
        {
            *window = None;
        }
    }

    /// Sends `watching` to every watch whose last one is out of date.
    pub(super) fn tell(&mut self, key: WinKey) {
        let Some(window) = self.windows.get(&key) else {
            return;
        };
        let Phase::Bound { session, pane, .. } = window.phase else {
            return;
        };
        let told = Told {
            session,
            pane,
            cwd: window.cwd.clone(),
        };
        let watches: Vec<WatchKey> = window.watches.iter().copied().collect();
        let window_ref = self.window_ref(key.endpoint, key.server, key.window);
        let session_ref = self.session_ref(key.endpoint, key.server, session);
        for watch_key in watches {
            let Some(watch) = self
                .conns
                .get_mut(&watch_key.conn)
                .and_then(|conn| conn.watches.get_mut(&watch_key.watch))
            else {
                continue;
            };
            if watch.told.as_ref() == Some(&told) {
                continue;
            }
            watch.told = Some(told.clone());
            let msg = ServerMsg::Watching {
                watch: watch_key.watch,
                window: window_ref.clone(),
                session: session_ref.clone(),
                pane: pane.0,
                cwd: told.cwd.clone(),
            };
            self.send(watch_key.conn, &msg, None);
        }
    }

    pub(super) fn remove_window(&mut self, key: WinKey) -> Option<Window> {
        let mut window = self.windows.remove(&key)?;
        if let Some(inflight) = window.stream.inflight.take() {
            self.abandon(inflight);
        }
        Some(window)
    }

    /// Ends every watch on the window with `watchEnded`, and drops it.
    pub(super) fn end_window(
        &mut self,
        key: WinKey,
        reason: WatchEndReason,
        message: Option<String>,
    ) {
        let Some(window) = self.remove_window(key) else {
            return;
        };
        for watch in window.watches {
            if let Some(conn) = self.conns.get_mut(&watch.conn) {
                conn.watches.remove(&watch.watch);
            }
            let msg = ServerMsg::WatchEnded {
                watch: watch.watch,
                reason,
                message: message.clone(),
            };
            self.send(watch.conn, &msg, Some(watch.watch));
        }
    }

    /// Drops the window and its watches without a word: a closure broadcast has told
    /// the clients.
    pub(super) fn drop_window(&mut self, key: WinKey) {
        let Some(window) = self.remove_window(key) else {
            return;
        };
        for watch in window.watches {
            if let Some(conn) = self.conns.get_mut(&watch.conn) {
                conn.watches.remove(&watch.watch);
            }
        }
    }

    /// A watch has gone; its window goes with its last watch.
    pub(super) fn leave(&mut self, watch: WatchKey, key: WinKey) {
        let Some(window) = self.windows.get_mut(&key) else {
            return;
        };
        window.watches.remove(&watch);
        let reserved = window
            .stream
            .inflight
            .as_mut()
            .is_some_and(|inflight| inflight.reserved.remove(&watch));
        let empty = window.watches.is_empty();
        if reserved {
            self.unreserve(watch.conn, CAPTURE_RESERVATION);
        }
        if empty {
            self.remove_window(key);
        }
    }

    // --- credit and sending ---

    pub(super) fn can_reserve(&self, conn: ConnId, amount: u64) -> bool {
        self.conns
            .get(&conn)
            .is_some_and(|state| state.outstanding + state.reserved + amount <= CREDIT)
    }

    pub(super) fn reserve(&mut self, conn: ConnId, amount: u64) {
        if let Some(state) = self.conns.get_mut(&conn) {
            state.reserved += amount;
        }
    }

    pub(super) fn unreserve(&mut self, conn: ConnId, amount: u64) {
        if let Some(state) = self.conns.get_mut(&conn) {
            state.reserved = state.reserved.saturating_sub(amount);
        }
    }

    pub(super) fn send(&mut self, conn: ConnId, msg: &ServerMsg, ends: Option<u32>) {
        self.send_encoded(conn, msg.encode(), ends);
    }

    /// Control JSON is never refused; past the overdraft the connection is wedged.
    pub(super) fn send_encoded(&mut self, conn: ConnId, json: Encoded, ends: Option<u32>) {
        let Some(state) = self.conns.get_mut(&conn) else {
            return;
        };
        state.outstanding += u64::from(charge(json.len()));
        let wedged = state.outstanding + state.reserved > CREDIT + OVERDRAFT;
        self.effects.push(Effect::Send {
            conn,
            msg: ToConn::Msg { json, ends },
        });
        if wedged {
            warn!(
                conn = conn.0,
                "connection wedged: control messages past the overdraft"
            );
            self.closed(conn);
        }
    }

    pub(super) fn broadcast(&mut self, msg: &ServerMsg) {
        let json = msg.encode();
        let conns: Vec<ConnId> = self.conns.keys().copied().collect();
        for conn in conns {
            self.send_encoded(conn, json.clone(), None);
        }
    }

    pub(super) fn refuse(
        &mut self,
        conn: ConnId,
        req: Option<u32>,
        watch: Option<u32>,
        code: ErrorCode,
        message: &str,
    ) {
        let msg = ServerMsg::Error {
            req,
            watch,
            code,
            message: cut(message.to_owned()),
        };
        self.send(conn, &msg, None);
    }

    pub(super) fn refuse_tmux(
        &mut self,
        conn: ConnId,
        req: Option<u32>,
        watch: Option<u32>,
        error: &TmuxError,
    ) {
        let code = match error {
            TmuxError::BadRequest(_) => ErrorCode::BadRequest,
            TmuxError::NoServer => ErrorCode::NoServer,
            _ => ErrorCode::Tmux,
        };
        self.refuse(conn, req, watch, code, &error.to_string());
    }

    // --- capacity ---

    /// Whether the client is ready with fewer than `limit` groups in flight.
    pub(super) fn room(&self, client: ClientId, limit: usize) -> bool {
        self.clients
            .get(&client)
            .and_then(Client::ready)
            .is_some_and(|tmux| tmux.in_flight() < limit)
    }

    /// Snapshots and history captures in flight, daemon-wide.
    pub(super) fn captures(&self) -> usize {
        self.clients
            .values()
            .flat_map(|client| client.pending.values())
            .filter(|work| matches!(work, Work::Snapshot { .. } | Work::History { .. }))
            .count()
    }

    // --- names ---

    pub(super) fn parse_server(&self, text: &str) -> Option<(usize, ServerInstance)> {
        let (name, instance) = text.split_once(':')?;
        let endpoint = self
            .endpoints
            .iter()
            .position(|endpoint| endpoint.name == name)?;
        let (pid, start_time) = instance.split_once('-')?;
        let server = ServerInstance {
            pid: pid.parse().ok()?,
            start_time: start_time.parse().ok()?,
        };
        Some((endpoint, server))
    }

    pub(super) fn server_name(&self, endpoint: usize, server: ServerInstance) -> String {
        format!("{}:{server}", self.endpoints[endpoint].name)
    }

    pub(super) fn window_ref(
        &self,
        endpoint: usize,
        server: ServerInstance,
        window: WindowId,
    ) -> WindowRef {
        WindowRef {
            server: self.server_name(endpoint, server),
            window: window.0,
        }
    }

    pub(super) fn session_ref(
        &self,
        endpoint: usize,
        server: ServerInstance,
        session: SessionId,
    ) -> SessionRef {
        SessionRef {
            server: self.server_name(endpoint, server),
            session: session.0,
        }
    }
}

impl Client {
    pub(super) fn tmux(&self) -> Option<&Session> {
        match &self.phase {
            ClientPhase::Starting(tmux) | ClientPhase::Ready { tmux, .. } => Some(tmux),
            ClientPhase::Delayed { .. } => None,
        }
    }

    pub(super) fn tmux_mut(&mut self) -> Option<&mut Session> {
        match &mut self.phase {
            ClientPhase::Starting(tmux) | ClientPhase::Ready { tmux, .. } => Some(tmux),
            ClientPhase::Delayed { .. } => None,
        }
    }

    pub(super) fn ready(&self) -> Option<&Session> {
        match &self.phase {
            ClientPhase::Ready { tmux, .. } => Some(tmux),
            _ => None,
        }
    }

    pub(super) fn ready_mut(&mut self) -> Option<&mut Session> {
        match &mut self.phase {
            ClientPhase::Ready { tmux, .. } => Some(tmux),
            _ => None,
        }
    }

    pub(super) fn server(&self) -> Option<ServerInstance> {
        match self.phase {
            ClientPhase::Ready { server, .. } => Some(server),
            _ => None,
        }
    }
}

pub(super) fn clamp(size: proto::Size) -> Size {
    Size {
        cols: size.cols.clamp(*COLS.start(), *COLS.end()),
        rows: size.rows.clamp(*ROWS.start(), *ROWS.end()),
    }
}

/// tmux names and error texts are cut to `NAME_LIMIT` bytes, which bounds every
/// control message.
pub(super) fn cut(mut text: String) -> String {
    if text.len() > NAME_LIMIT {
        let mut end = NAME_LIMIT;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
    }
    text
}
