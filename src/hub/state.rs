//! The hub's pure core (daemon-core.md §4.1–§4.6): every control client's `Session`,
//! the watched sessions with their windows, streams and owners, and each connection's credit,
//! in one value. `handle` turns one input into effects; `reconcile` (reconcile.rs) then
//! sends tmux whatever the watches need. No I/O and no clock: time comes in with each
//! input.
//!
//! This file holds the model, tmux's events and the pane streams; owners.rs decides
//! who owns each window and runs the control clients' lives; requests.rs answers the
//! connections; credit.rs keeps their credit and sends to them; time.rs handles what
//! waits on time; names.rs spells servers, windows and sessions for control JSON.

use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;

use bytes::Bytes;
use tracing::warn;

use super::names::cut;
use super::view::{Inflight, View, ViewKey, ViewPhase, Vote, WatchKey};
use super::{
    CAPTURE_RESERVATION, COLS, ConnId, Endpoints, FromConn, PasteFile, ROWS, ToConn, charge,
};
use crate::proto::{self, ErrorCode, ServerMsg, ShownWindow as ProtoShownWindow, WatchEndReason};
use crate::tmux::{
    ClientId, Endpoint, Event, OneShotCmd, Op, PaneId, PumpMsg, Reply, ServerInstance, Session,
    SessionId, Size, Step, Tag, TmuxError, TmuxVersion, WindowId,
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
    /// Name shown in session-limit messages.
    pub(super) host_name: String,
    /// The budget tier's control-client cap.
    pub(super) max_clients: usize,
    pub(super) clients: BTreeMap<ClientId, Client>,
    pub(super) views: BTreeMap<ViewKey, View>,
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
    /// tmux reported a change the session listing shows: `sessionsChanged` goes out
    /// once this input is handled, however many changes it brought.
    pub(super) relist: bool,
    pub(super) next_tag: u64,
    pub(super) next_client: u64,
}

pub(super) struct EndpointState {
    pub(super) name: &'static str,
    pub(super) endpoint: Endpoint,
    /// The server instance last seen running; ids from any other are dead.
    pub(super) live: Option<ServerInstance>,
    /// Version expanded by the live server, if a listing or startup reply identified it.
    pub(super) server_version: Option<TmuxVersion>,
    /// The configured binary's version, read once when the daemon starts.
    pub(super) program_version: Option<TmuxVersion>,
}

#[derive(Default)]
pub(super) struct Conn {
    /// Charged bytes not yet returned.
    pub(super) outstanding: u64,
    /// Credit held for captures and listings in flight: a counter, since deriving it
    /// on the output path costs too much. Debug builds check it against the work in
    /// flight after every input.
    pub(super) reserved: u64,
    pub(super) watches: BTreeMap<u32, Watch>,
}

pub(super) struct Watch {
    pub(super) view: ViewKey,
    /// The size this watch last claimed with `watch` or `resize`.
    pub(super) size: Size,
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
    pub(super) window: WindowId,
    pub(super) index: u32,
    pub(super) name: String,
    pub(super) size: Size,
    pub(super) pane: PaneId,
    pub(super) cwd: Option<String>,
}

pub(super) struct Client {
    pub(super) endpoint: usize,
    pub(super) session: SessionId,
    pub(super) session_name: String,
    pub(super) phase: ClientPhase,
    /// Votes and subscriptions sent, which count as applied.
    pub(super) votes: BTreeMap<WindowId, Vote>,
    pub(super) subscriptions: BTreeSet<WindowId>,
    pub(super) current_subscribed: bool,
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
        view: ViewKey,
    },
    SessionCheck {
        exited: ClientId,
    },
    /// Holds a capture slot until tmux answers, even once the window's stream no
    /// longer waits for this tag.
    Snapshot {
        view: ViewKey,
    },
    History {
        conn: ConnId,
        watch: u32,
        req: u32,
        start: i32,
        end: i32,
        pane: PaneId,
    },
    Input {
        conn: ConnId,
        watch: u32,
    },
    SelectWindow {
        conn: ConnId,
        watch: u32,
        req: u32,
        view: ViewKey,
        window: WindowId,
    },
    Paste {
        conn: ConnId,
        watch: u32,
        req: u32,
        file: PasteFile,
    },
    /// Votes and subscriptions: a failure on a window that has gone is harmless.
    Maintenance,
}

pub(super) enum OneShotWork {
    Locate {
        view: ViewKey,
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
        watch: Option<WatchKey>,
        session: Option<SessionId>,
    },
}

/// How a control client ended (§4.5).
#[derive(Clone)]
pub(super) struct Exit {
    pub(super) endpoint: usize,
    pub(super) session: SessionId,
    pub(super) session_name: String,
    /// The control client was detached or moved, not crashed.
    pub(super) detached: bool,
    /// The client never reached `Ready`; it is a startup crash even if tmux sent `%exit`.
    pub(super) startup_failure: bool,
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
    pub fn new(
        endpoints: Endpoints,
        now: Instant,
        max_clients: usize,
        host_name: String,
        program_version: Option<TmuxVersion>,
    ) -> Self {
        Self {
            endpoints: vec![EndpointState {
                name: "main",
                endpoint: endpoints.main,
                live: None,
                server_version: None,
                program_version,
            }],
            host_name,
            max_clients,
            clients: BTreeMap::new(),
            views: BTreeMap::new(),
            conns: BTreeMap::new(),
            exits: BTreeMap::new(),
            oneshot: None,
            now,
            effects: Vec::new(),
            dirty: false,
            relist: false,
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
        if std::mem::take(&mut self.relist) {
            self.broadcast(&ServerMsg::SessionsChanged);
        }
        #[cfg(debug_assertions)]
        self.check_reservations();
        std::mem::take(&mut self.effects)
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
            Event::Layout {
                window,
                size,
                panes,
            } => {
                self.vote_layout(client, window, size);
                let Some(key) = self.owned(client, window) else {
                    return;
                };
                let Some(view) = self.views.get_mut(&key) else {
                    return;
                };
                let ViewPhase::Bound { pane, .. } = view.phase else {
                    return;
                };
                let pane_size = panes
                    .iter()
                    .find(|(id, _)| *id == pane)
                    .map(|(_, size)| *size);
                let mut changed = false;
                if let Some(current) = &mut view.shown {
                    if current.size != size {
                        current.size = size;
                        changed = true;
                    }
                }
                if let Some(pane_size) = pane_size.filter(|size| *size != view.stream.size) {
                    view.stream.size = pane_size;
                    self.break_stream(key);
                }
                if changed {
                    self.tell(key);
                }
            }
            Event::ActivePane { window, pane } => {
                let Some(key) = self.owned(client, window) else {
                    return;
                };
                if let Some(ViewPhase::Bound { pane: current, .. }) =
                    self.views.get_mut(&key).map(|view| &mut view.phase)
                {
                    if *current != pane {
                        *current = pane;
                        self.break_stream(key);
                        self.tell(key);
                    }
                }
            }
            Event::Acted { window } => {
                if let Some(key) = self.targeted(client, window) {
                    if let Some(view) = self.views.get_mut(&key) {
                        view.yield_if(window);
                    }
                }
            }
            Event::Cwd { window, .. } => {
                if let Some(key) = self.owned(client, window) {
                    self.tell(key);
                }
            }
            Event::WindowRenamed { window, name } => {
                if self.reporter(client).is_some() {
                    self.relist = true;
                }
                if let Some(key) = self.owned(client, window) {
                    if let Some(current) = self
                        .views
                        .get_mut(&key)
                        .and_then(|view| view.shown.as_mut())
                    {
                        if current.name != name {
                            current.name = cut(name);
                            self.tell(key);
                        }
                    }
                }
            }
            Event::CurrentWindow { window } => self.current_window(client, window),
            Event::SessionChanged => self.owner_moved(client),
            Event::SessionsChanged => {
                if self.reporter(client).is_some() {
                    self.relist = true;
                }
            }
            Event::Fatal(error) => {
                warn!(client = client.0, %error, "tmux control client failed");
                self.client_exited(client, error.to_string(), false);
            }
            Event::Exit => self.client_exited(client, "tmux sent %exit".to_owned(), true),
        }
    }

    pub(super) fn vote_layout(&mut self, client: ClientId, window: WindowId, size: Size) {
        let Some(vote) = self
            .clients
            .get_mut(&client)
            .and_then(|record| record.votes.get_mut(&window))
        else {
            return;
        };
        if vote.size == size {
            vote.confirmed = true;
            vote.take_due = false;
        } else if vote.confirmed {
            vote.confirmed = false;
            vote.take_due = true;
        }
    }

    pub(super) fn output(&mut self, client: ClientId, pane: PaneId, bytes: Bytes) {
        let Some(key) = self.owned_pane(client, pane) else {
            return;
        };
        let Some(view) = self.views.get(&key) else {
            return;
        };
        if !view.stream.live {
            return;
        }
        let charge = u64::from(charge(bytes.len()));
        let watches: Vec<WatchKey> = view.watches.iter().copied().collect();
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

    pub(super) fn snapshot(&mut self, client: ClientId, tag: Tag, size: Size, restore: Bytes) {
        let Some(Work::Snapshot { view: key }) = self
            .clients
            .get_mut(&client)
            .and_then(|record| record.pending.remove(&tag))
        else {
            return;
        };
        let Some(view) = self.views.get_mut(&key) else {
            return;
        };
        let Some(inflight) = view.stream.inflight.take_if(|inflight| inflight.tag == tag) else {
            return;
        };
        if restore.len() as u64 > CAPTURE_RESERVATION {
            self.abandon(inflight);
            let message = "the pane's screen is too large to show".to_owned();
            return self.end_view(key, WatchEndReason::Error, Some(message));
        }
        view.stream.live = true;
        view.stream.size = size;
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
            Work::Locate { view } => self.located(view, tag, Some(client), result),
            Work::SessionCheck { exited } => self.checked(exited, tag, result),
            Work::Snapshot { view: key } => {
                let Some(stream) = self.views.get_mut(&key).map(|view| &mut view.stream) else {
                    return;
                };
                let Some(inflight) = stream.inflight.take_if(|inflight| inflight.tag == tag) else {
                    return;
                };
                self.abandon(inflight);
                match result {
                    // The window's active pane changed or it closed: find out which.
                    Err(TmuxError::PaneGone) => {
                        if let Some(view) = self.views.get_mut(&key) {
                            view.locate.needed = true;
                        }
                    }
                    Err(TmuxError::Torn) => self.end_view(
                        key,
                        WatchEndReason::Error,
                        Some("a tmux hook keeps changing the pane during snapshots".to_owned()),
                    ),
                    Err(TmuxError::TooLarge) => self.end_view(
                        key,
                        WatchEndReason::Error,
                        Some("the pane's screen is too large to show".to_owned()),
                    ),
                    // A stream waits only for a snapshot of a pane its owner shows,
                    // which it doesn't release; reconcile sends another.
                    Err(TmuxError::Released) | Ok(_) => {}
                    Err(error) => self.end_view(
                        key,
                        WatchEndReason::Error,
                        Some(cut(format!("snapshot failed: {error}"))),
                    ),
                }
            }
            work @ Work::History { .. } => self.history_answered(work, result),
            Work::Input { conn, watch } => {
                if let Err(error) = result {
                    self.refuse_tmux(conn, None, Some(watch), &error);
                }
            }
            Work::SelectWindow {
                conn,
                watch,
                req,
                view: key,
                window,
            } => match result {
                Ok(Reply::Ok) => {
                    if let Some(view) = self.views.get_mut(&key) {
                        if view.select_replied(window) {
                            view.locate.needed = true;
                        }
                    }
                }
                Err(error) => {
                    if let Some(view) = self.views.get_mut(&key) {
                        view.select_failed(window);
                    }
                    self.refuse_tmux(conn, Some(req), Some(watch), &error);
                }
                Ok(_) => self.refuse_tmux(conn, Some(req), Some(watch), &TmuxError::BadReply),
            },
            Work::Paste {
                conn,
                watch,
                req,
                file,
            } => {
                self.effects.push(Effect::RemoveFile { file });
                match result {
                    Ok(Reply::Ok) => self.send(conn, &ServerMsg::Pasted { req, watch }, None),
                    Err(error) => self.refuse_tmux(conn, Some(req), Some(watch), &error),
                    Ok(_) => self.refuse_tmux(conn, Some(req), Some(watch), &TmuxError::BadReply),
                }
            }
            Work::Maintenance => {}
        }
    }

    /// A tag that will never be answered: its control client is gone.
    pub(super) fn settle(&mut self, client: ClientId, tag: Tag, work: Work) {
        match work {
            Work::Locate { view: key } => {
                if let Some(view) = self.views.get_mut(&key) {
                    if view.locate.in_flight == Some(tag) {
                        view.locate.in_flight = None;
                        view.locate.needed = true;
                    }
                    if matches!(view.phase, ViewPhase::Locating { owner } if owner == client) {
                        view.phase = ViewPhase::Checking;
                    }
                }
            }
            Work::SessionCheck { exited } => {
                if let Some(check) = self.exits.get_mut(&exited) {
                    check.in_flight = check.in_flight.filter(|current| *current != tag);
                }
            }
            Work::Snapshot { view: key } => {
                let inflight = self
                    .views
                    .get_mut(&key)
                    .and_then(|view| view.stream.inflight.take_if(|inflight| inflight.tag == tag));
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
            Work::Paste {
                conn,
                watch,
                req,
                file,
            } => {
                self.effects.push(Effect::RemoveFile { file });
                self.refuse(
                    conn,
                    Some(req),
                    Some(watch),
                    ErrorCode::Tmux,
                    "tmux stopped answering before confirming the paste; it may have been sent",
                );
            }
            Work::SelectWindow {
                conn,
                watch,
                req,
                view: key,
                window,
            } => {
                if let Some(view) = self.views.get_mut(&key) {
                    view.select_failed(window);
                }
                self.refuse(
                    conn,
                    Some(req),
                    Some(watch),
                    ErrorCode::Tmux,
                    "tmux stopped answering before confirming the window selection",
                );
            }
            Work::Input { .. } | Work::Maintenance => {}
        }
    }

    // --- streams ---

    /// The stream's continuity is lost: every watch waits for a fresh snapshot, and one
    /// already in flight may predate the cause, so it is forgotten.
    pub(super) fn break_stream(&mut self, key: ViewKey) {
        let Some(view) = self.views.get_mut(&key) else {
            return;
        };
        view.stream.live = false;
        let inflight = view.stream.inflight.take();
        for watch in &view.watches {
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
    }

    /// Sends `watching` to every watch whose last one is out of date.
    pub(super) fn tell(&mut self, key: ViewKey) {
        let Some(view) = self.views.get(&key) else {
            return;
        };
        let ViewPhase::Bound { pane, owner } = view.phase else {
            return;
        };
        let Some(current) = &view.shown else {
            return;
        };
        let shown = ProtoShownWindow {
            id: current.id.0,
            index: current.index,
            name: current.name.clone(),
            size: proto::Size {
                cols: current.size.cols,
                rows: current.size.rows,
            },
        };
        let told = Told {
            window: current.id,
            index: current.index,
            name: current.name.clone(),
            size: current.size,
            pane,
            cwd: self
                .clients
                .get(&owner)
                .and_then(Client::tmux)
                .and_then(|tmux| tmux.cwd(current.id))
                .map(str::to_owned),
        };
        let watches: Vec<WatchKey> = view.watches.iter().copied().collect();
        let session_ref = self.session_ref(key.endpoint, key.server, key.session);
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
                window: shown.clone(),
                session: session_ref.clone(),
                pane: pane.0,
                cwd: told.cwd.clone(),
            };
            self.send(watch_key.conn, &msg, None);
        }
    }

    pub(super) fn remove_view(&mut self, key: ViewKey) -> Option<View> {
        let mut view = self.views.remove(&key)?;
        if let Some(inflight) = view.stream.inflight.take() {
            self.abandon(inflight);
        }
        Some(view)
    }

    /// Ends every watch on the view with `watchEnded`, and drops it.
    pub(super) fn end_view(
        &mut self,
        key: ViewKey,
        reason: WatchEndReason,
        message: Option<String>,
    ) {
        let Some(view) = self.remove_view(key) else {
            return;
        };
        for watch in view.watches {
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

    /// Drops the view and its watches without a word: a closure broadcast has told
    /// the clients.
    pub(super) fn drop_view(&mut self, key: ViewKey) {
        let Some(view) = self.remove_view(key) else {
            return;
        };
        for watch in view.watches {
            if let Some(conn) = self.conns.get_mut(&watch.conn) {
                conn.watches.remove(&watch.watch);
            }
        }
    }

    /// A watch has gone; its view goes with its last watch.
    pub(super) fn leave(&mut self, watch: WatchKey, key: ViewKey) {
        let Some(view) = self.views.get_mut(&key) else {
            return;
        };
        view.watches.remove(&watch);
        if view
            .claim
            .as_ref()
            .is_some_and(|claim| claim.watch == watch)
        {
            view.claim = None;
        }
        let reserved = view
            .stream
            .inflight
            .as_mut()
            .is_some_and(|inflight| inflight.reserved.remove(&watch));
        let empty = view.watches.is_empty();
        if reserved {
            self.unreserve(watch.conn, CAPTURE_RESERVATION);
        }
        if empty {
            self.remove_view(key);
        }
    }

    // --- capacity ---

    /// Whether the client is ready with fewer than `limit` groups in flight.
    pub(super) fn room(&self, client: ClientId, limit: usize) -> bool {
        self.clients
            .get(&client)
            .and_then(Client::ready)
            .is_some_and(|tmux| tmux.in_flight() < limit)
    }

    pub(super) fn room_for(&self, client: ClientId, limit: usize, groups: usize) -> bool {
        self.clients
            .get(&client)
            .and_then(Client::ready)
            .is_some_and(|tmux| tmux.in_flight() + groups <= limit)
    }

    /// Snapshots and history captures in flight, daemon-wide.
    pub(super) fn captures(&self) -> usize {
        self.clients
            .values()
            .flat_map(|client| client.pending.values())
            .filter(|work| matches!(work, Work::Snapshot { .. } | Work::History { .. }))
            .count()
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
