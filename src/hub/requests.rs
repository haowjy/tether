//! What connections ask of the hub (daemon-core.md §4.2, §5.3): watches, input,
//! pastes, history, the session listing and new windows. User requests are refused
//! with `busy` rather than queued.

use std::collections::BTreeSet;

use super::state::{
    Effect, Locate, MAIN, OneShotWork, Phase, State, Stream, Watch, WatchKey, WinKey, Window, Work,
    clamp, cut,
};
use super::{
    CAPTURE_RESERVATION, CAPTURE_SLOTS, ConnId, FromConn, HISTORY_ROWS, LISTING_RESERVATION,
    MAX_INPUT, MAX_WATCHES, PasteFile, USER_IN_FLIGHT,
};
use crate::proto::{
    self, Base64, ClientMsg, ErrorCode, ServerMsg, SessionListing, SessionRef, TmuxListing,
    WatchEndReason, WindowListing, WindowRef,
};
use crate::tmux::{
    ClientId, InputItem, OneShotCmd, Op, PaneId, Reply, SessionId, Tag, TmuxError, WindowId,
};

enum Refusal {
    UnknownWatch,
    NotBound,
    Busy,
}

impl State {
    pub(super) fn conn(&mut self, conn: ConnId, msg: FromConn) {
        match msg {
            FromConn::Client(msg) => self.client_msg(conn, msg),
            FromConn::Paste { watch, file } => self.paste(conn, watch, file),
            FromConn::Credit { bytes } => {
                if let Some(state) = self.conns.get_mut(&conn) {
                    state.outstanding = state.outstanding.saturating_sub(u64::from(bytes));
                }
            }
            FromConn::Closed => self.closed(conn),
        }
    }

    pub(super) fn client_msg(&mut self, conn: ConnId, msg: ClientMsg) {
        if !self.conns.contains_key(&conn) {
            return;
        }
        match msg {
            ClientMsg::Watch {
                watch,
                window,
                size,
            } => self.watch(conn, watch, window, size),
            ClientMsg::Unwatch { watch } => {
                if let Some(state) = self.conns.get_mut(&conn) {
                    if let Some(removed) = state.watches.remove(&watch) {
                        self.leave(WatchKey { conn, watch }, removed.window);
                    }
                }
            }
            ClientMsg::Resize { watch, size } => {
                if let Some(key) = self.watch_window(conn, watch) {
                    if let Some(window) = self.windows.get_mut(&key) {
                        window.vote = clamp(size);
                    }
                }
            }
            ClientMsg::Resync { watch } => {
                if let Some(watch) = self
                    .conns
                    .get_mut(&conn)
                    .and_then(|state| state.watches.get_mut(&watch))
                {
                    watch.awaiting = true;
                    watch.starved = false;
                }
            }
            ClientMsg::Input { watch, items } => self.input(conn, watch, items),
            ClientMsg::History {
                req,
                watch,
                start,
                end,
            } => self.history(conn, req, watch, start, end),
            ClientMsg::ListSessions { req } => self.list(conn, req),
            ClientMsg::NewWindow {
                req,
                session,
                name,
                dir,
            } => self.new_window(conn, req, &session, name, dir),
            ClientMsg::NewSession {
                req,
                name,
                dir,
                scratch,
            } => {
                if scratch {
                    return self.refuse(
                        conn,
                        Some(req),
                        None,
                        ErrorCode::BadRequest,
                        "scratch shells aren't available yet",
                    );
                }
                let cmd = OneShotCmd::NewSession {
                    name,
                    dir: dir.map(Into::into),
                };
                self.create(conn, req, MAIN, cmd);
            }
            // The connection's own: handshake, heartbeat, and pastes as files.
            ClientMsg::Hello { .. }
            | ClientMsg::Ping { .. }
            | ClientMsg::Paste { .. }
            | ClientMsg::Unknown => {}
        }
    }

    pub(super) fn watch(&mut self, conn: ConnId, watch: u32, window: WindowRef, size: proto::Size) {
        let Some(state) = self.conns.get(&conn) else {
            return;
        };
        if state.watches.contains_key(&watch) {
            let message = "that watch id is in use";
            return self.refuse(conn, None, Some(watch), ErrorCode::BadRequest, message);
        }
        if state.watches.len() >= MAX_WATCHES {
            let msg = ServerMsg::WatchEnded {
                watch,
                reason: WatchEndReason::Error,
                message: Some(format!("too many tabs open at once ({MAX_WATCHES})")),
            };
            return self.send(conn, &msg, Some(watch));
        }
        let Some((endpoint, server)) = self.parse_server(&window.server) else {
            // Not a server this daemon can ever reach: close the tab.
            let msg = ServerMsg::ServerExited {
                server: window.server,
            };
            return self.send(conn, &msg, None);
        };
        if self.endpoints[endpoint]
            .live
            .is_some_and(|live| live != server)
        {
            return self.server_gone(endpoint, server);
        }
        let key = WinKey {
            endpoint,
            server,
            window: WindowId(window.window),
        };
        let size = clamp(size);
        let entry = self.windows.entry(key).or_insert_with(|| Window {
            watches: BTreeSet::new(),
            vote: size,
            phase: Phase::Locating { after: None },
            locate: Locate {
                needed: true,
                ..Locate::default()
            },
            stream: Stream {
                live: false,
                size,
                inflight: None,
            },
            cwd: None,
        });
        entry.vote = size;
        entry.watches.insert(WatchKey { conn, watch });
        if let Some(state) = self.conns.get_mut(&conn) {
            state.watches.insert(
                watch,
                Watch {
                    window: key,
                    awaiting: true,
                    starved: false,
                    last_snapshot: None,
                    told: None,
                },
            );
        }
        self.tell(key);
    }

    pub(super) fn watch_window(&self, conn: ConnId, watch: u32) -> Option<WinKey> {
        Some(self.conns.get(&conn)?.watches.get(&watch)?.window)
    }

    /// The owner and pane a user request on this watch goes to, or why it can't.
    fn user_target(&self, conn: ConnId, watch: u32) -> Result<(WinKey, ClientId, PaneId), Refusal> {
        let key = self
            .watch_window(conn, watch)
            .ok_or(Refusal::UnknownWatch)?;
        let window = self.windows.get(&key).ok_or(Refusal::UnknownWatch)?;
        let Phase::Bound { owner, pane, .. } = window.phase else {
            return Err(Refusal::NotBound);
        };
        if !self.room(owner, USER_IN_FLIGHT) {
            return Err(Refusal::Busy);
        }
        Ok((key, owner, pane))
    }

    pub(super) fn input(&mut self, conn: ConnId, watch: u32, items: Vec<proto::InputItem>) {
        let size: usize = items
            .iter()
            .map(|item| match item {
                proto::InputItem::Text(text) | proto::InputItem::Key(text) => text.len(),
                proto::InputItem::Bytes(bytes) => bytes.0.len(),
            })
            .sum();
        if size > MAX_INPUT {
            let message = format!("input over {MAX_INPUT} bytes");
            return self.refuse(conn, None, Some(watch), ErrorCode::InputTooLarge, &message);
        }
        let (key, owner, _) = match self.user_target(conn, watch) {
            Ok(target) => target,
            Err(refusal) => return self.refuse_for(conn, None, watch, refusal),
        };
        let items = items
            .into_iter()
            .map(|item| match item {
                proto::InputItem::Text(text) => InputItem::Text(text),
                proto::InputItem::Key(name) => InputItem::Key(name),
                proto::InputItem::Bytes(bytes) => InputItem::Bytes(bytes.0),
            })
            .collect();
        let tag = self.next_tag();
        let op = Op::Input {
            window: key.window,
            items,
        };
        self.request(owner, tag, op, Work::Input { conn, watch });
    }

    pub(super) fn paste(&mut self, conn: ConnId, watch: u32, file: PasteFile) {
        if !self.conns.contains_key(&conn) {
            return self.effects.push(Effect::RemoveFile { file });
        }
        let (key, owner, _) = match self.user_target(conn, watch) {
            Ok(target) => target,
            Err(refusal) => {
                self.effects.push(Effect::RemoveFile { file });
                return self.refuse_for(conn, None, watch, refusal);
            }
        };
        let tag = self.next_tag();
        let op = Op::Paste {
            window: key.window,
            path: file.path.clone(),
        };
        self.request(owner, tag, op, Work::Paste { conn, watch, file });
    }

    pub(super) fn history(&mut self, conn: ConnId, req: u32, watch: u32, start: i32, end: i32) {
        if end < start {
            let message = "history end is before its start";
            return self.refuse(conn, Some(req), Some(watch), ErrorCode::BadRequest, message);
        }
        let (_, owner, pane) = match self.user_target(conn, watch) {
            Ok(target) => target,
            Err(refusal) => return self.refuse_for(conn, Some(req), watch, refusal),
        };
        if self.captures() >= CAPTURE_SLOTS || !self.can_reserve(conn, CAPTURE_RESERVATION) {
            return self.refuse_for(conn, Some(req), watch, Refusal::Busy);
        }
        self.reserve(conn, CAPTURE_RESERVATION);
        let end = end.min(start.saturating_add(HISTORY_ROWS - 1));
        let tag = self.next_tag();
        let work = Work::History {
            conn,
            watch,
            req,
            start,
        };
        self.request(owner, tag, Op::History { pane, start, end }, work);
    }

    pub(super) fn history_answered(
        &mut self,
        conn: ConnId,
        watch: u32,
        req: u32,
        start: i32,
        result: Result<Reply, TmuxError>,
    ) {
        self.unreserve(conn, CAPTURE_RESERVATION);
        let rows = match result {
            Ok(Reply::History(rows)) => rows,
            Err(error) => return self.refuse_tmux(conn, Some(req), Some(watch), &error),
            Ok(_) => return self.refuse_tmux(conn, Some(req), Some(watch), &TmuxError::BadReply),
        };
        // Keep the rows that fit the reservation; the client asks again from there.
        let chunk = |lines: Vec<Base64>| ServerMsg::HistoryChunk {
            req,
            watch,
            start,
            lines,
        };
        let mut size = chunk(Vec::new()).encode().len() as u64;
        let mut fit = 0;
        for row in &rows {
            // Base64 in quotes, and a comma after the first.
            let cost = (row.len() as u64).div_ceil(3) * 4 + 2 + u64::from(fit > 0);
            if size + cost > CAPTURE_RESERVATION {
                break;
            }
            size += cost;
            fit += 1;
        }
        let lines = rows.into_iter().take(fit).map(Base64).collect();
        self.send(conn, &chunk(lines), None);
    }

    pub(super) fn list(&mut self, conn: ConnId, req: u32) {
        if self.oneshot.is_some() || !self.can_reserve(conn, LISTING_RESERVATION) {
            return self.refuse(conn, Some(req), None, ErrorCode::Busy, "tmux is busy");
        }
        self.reserve(conn, LISTING_RESERVATION);
        self.run_oneshot(MAIN, OneShotCmd::List, OneShotWork::List { conn, req });
    }

    pub(super) fn listed(&mut self, conn: ConnId, req: u32, result: Result<Reply, TmuxError>) {
        self.unreserve(conn, LISTING_RESERVATION);
        let listing = match result {
            Ok(Reply::Listing(listing)) => listing,
            Err(TmuxError::NoServer) => {
                if let Some(live) = self.endpoints[MAIN].live {
                    self.server_gone(MAIN, live);
                }
                return self.send(conn, &ServerMsg::Sessions { req, tmux: None }, None);
            }
            Err(error) => return self.refuse_tmux(conn, Some(req), None, &error),
            Ok(_) => return self.refuse_tmux(conn, Some(req), None, &TmuxError::BadReply),
        };
        self.learned(MAIN, listing.server);
        let sessions = listing
            .sessions
            .into_iter()
            .map(|session| SessionListing {
                id: session.id.0,
                name: cut(session.name),
                attached_elsewhere: session.attached_elsewhere,
                windows: session
                    .windows
                    .into_iter()
                    .map(|window| WindowListing {
                        id: window.id.0,
                        index: window.index,
                        name: cut(window.name),
                        active: window.active,
                        activity: window.activity,
                    })
                    .collect(),
            })
            .collect();
        let msg = ServerMsg::Sessions {
            req,
            tmux: Some(TmuxListing {
                server: self.server_name(MAIN, listing.server),
                version: listing.version.to_string(),
                sessions,
            }),
        };
        let json = msg.encode();
        if json.len() as u64 > LISTING_RESERVATION {
            let message = "the session list is too large";
            return self.refuse(conn, Some(req), None, ErrorCode::Tmux, message);
        }
        self.send_encoded(conn, json, None);
    }

    pub(super) fn new_window(
        &mut self,
        conn: ConnId,
        req: u32,
        session: &SessionRef,
        name: Option<String>,
        dir: Option<String>,
    ) {
        let Some((endpoint, server)) = self.parse_server(&session.server) else {
            let message = "unknown tmux server";
            return self.refuse(conn, Some(req), None, ErrorCode::BadRequest, message);
        };
        // A session id from another run of the server names some other session.
        if self.endpoints[endpoint]
            .live
            .is_some_and(|live| live != server)
        {
            self.server_gone(endpoint, server);
            let message = "that tmux server has exited";
            return self.refuse(conn, Some(req), None, ErrorCode::NoServer, message);
        }
        let cmd = OneShotCmd::NewWindow {
            session: SessionId(session.session),
            name,
            dir: dir.map(Into::into),
        };
        self.create(conn, req, endpoint, cmd);
    }

    pub(super) fn create(&mut self, conn: ConnId, req: u32, endpoint: usize, cmd: OneShotCmd) {
        if self.oneshot.is_some() {
            return self.refuse(conn, Some(req), None, ErrorCode::Busy, "tmux is busy");
        }
        let work = OneShotWork::Create {
            conn,
            req,
            endpoint,
        };
        self.run_oneshot(endpoint, cmd, work);
    }

    pub(super) fn created(
        &mut self,
        conn: ConnId,
        req: u32,
        endpoint: usize,
        result: Result<Reply, TmuxError>,
    ) {
        match result {
            Ok(Reply::Created(created)) => {
                self.learned(endpoint, created.server);
                let msg = ServerMsg::Created {
                    req,
                    window: self.window_ref(endpoint, created.server, created.window),
                    session: self.session_ref(endpoint, created.server, created.session),
                };
                self.send(conn, &msg, None);
            }
            Err(error) => self.refuse_tmux(conn, Some(req), None, &error),
            Ok(_) => self.refuse_tmux(conn, Some(req), None, &TmuxError::BadReply),
        }
    }

    pub(super) fn run_oneshot(
        &mut self,
        endpoint: usize,
        cmd: OneShotCmd,
        work: OneShotWork,
    ) -> Tag {
        let tag = self.next_tag();
        self.oneshot = Some((tag, work));
        self.effects.push(Effect::OneShot {
            tag,
            endpoint: self.endpoints[endpoint].endpoint.clone(),
            cmd,
        });
        tag
    }

    pub(super) fn oneshot_answered(&mut self, tag: Tag, result: Result<Reply, TmuxError>) {
        let Some((_, work)) = self.oneshot.take_if(|(current, _)| *current == tag) else {
            return;
        };
        match work {
            OneShotWork::Locate { window } => self.located(window, tag, None, result),
            OneShotWork::SessionCheck { exited } => self.checked(exited, tag, result),
            OneShotWork::List { conn, req } => self.listed(conn, req, result),
            OneShotWork::Create {
                conn,
                req,
                endpoint,
            } => self.created(conn, req, endpoint, result),
        }
    }

    pub(super) fn closed(&mut self, conn: ConnId) {
        let Some(state) = self.conns.remove(&conn) else {
            return;
        };
        for (watch, removed) in state.watches {
            self.leave(WatchKey { conn, watch }, removed.window);
        }
    }

    fn refuse_for(&mut self, conn: ConnId, req: Option<u32>, watch: u32, refusal: Refusal) {
        let (code, message) = match refusal {
            Refusal::UnknownWatch => (ErrorCode::BadRequest, "no such watch"),
            Refusal::NotBound => (ErrorCode::Busy, "the window isn't connected yet"),
            Refusal::Busy => (ErrorCode::Busy, "tmux is busy"),
        };
        self.refuse(conn, req, Some(watch), code, message);
    }
}
