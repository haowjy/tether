//! Handle client requests against the session views. User requests are refused with
//! `busy` rather than queued.

use std::collections::BTreeSet;

use super::names::cut;
use super::state::{Effect, MAIN, OneShotWork, State, Watch, Work, clamp};
use super::view::{Locate, Stream, Take, View, ViewKey, ViewPhase, Vote, WatchKey, vote_plan};
use super::{
    CAPTURE_RESERVATION, CAPTURE_SLOTS, ConnId, FromConn, HISTORY_ROWS, LISTING_RESERVATION,
    MAX_INPUT, MAX_WATCHES, PasteFile, USER_IN_FLIGHT,
};
use crate::proto::{
    self, Base64, ClientMsg, ErrorCode, ServerMsg, SessionListing, SessionRef, TmuxListing,
    WatchEndReason, WindowListing,
};
use crate::tmux::{
    ClientId, InputItem, OneShotCmd, Op, PaneId, Reply, SessionId, Size, Tag, TmuxError, WindowId,
};

#[derive(Clone, Copy)]
enum Refusal {
    UnknownWatch,
    NotBound,
    Busy,
}

impl State {
    pub(super) fn conn(&mut self, conn: ConnId, msg: FromConn) {
        match msg {
            FromConn::Client(msg) => self.client_msg(conn, msg),
            FromConn::Paste {
                req,
                watch,
                window,
                enter,
                file,
            } => self.paste(conn, req, watch, WindowId(window), enter, file),
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
                session,
                size,
                claim,
            } => self.watch(conn, watch, session, size, claim.unwrap_or(true)),
            ClientMsg::Unwatch { watch } => {
                if let Some(state) = self.conns.get_mut(&conn) {
                    if let Some(removed) = state.watches.remove(&watch) {
                        self.leave(WatchKey { conn, watch }, removed.view);
                    }
                }
            }
            ClientMsg::Resize { watch, size } => self.resize(conn, watch, size),
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
            ClientMsg::Input {
                watch,
                window,
                items,
            } => self.input(conn, watch, WindowId(window), items),
            ClientMsg::Paste { .. } => {}
            ClientMsg::History {
                req,
                watch,
                start,
                end,
            } => self.history(conn, req, watch, start, end),
            ClientMsg::SelectWindow { req, watch, window } => {
                self.select_window(conn, req, watch, WindowId(window))
            }
            ClientMsg::ListSessions { req } => self.list(conn, req),
            ClientMsg::NewWindow {
                req,
                session,
                name,
                dir,
                watch,
            } => self.new_window(conn, req, &session, watch, name, dir),
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
                self.create(
                    OneShotCmd::NewSession {
                        name,
                        dir: dir.map(Into::into),
                    },
                    OneShotWork::Create {
                        conn,
                        req,
                        endpoint: MAIN,
                        server: None,
                        watch: None,
                        session: None,
                    },
                );
            }
            ClientMsg::Hello { .. } | ClientMsg::Ping { .. } | ClientMsg::Unknown => {}
        }
    }

    fn watch(
        &mut self,
        conn: ConnId,
        watch: u32,
        session: SessionRef,
        size: proto::Size,
        claim: bool,
    ) {
        let Some(state) = self.conns.get(&conn) else {
            return;
        };
        if state.watches.contains_key(&watch) {
            return self.refuse(
                conn,
                None,
                Some(watch),
                ErrorCode::BadRequest,
                "that watch id is in use",
            );
        }
        if state.watches.len() >= MAX_WATCHES {
            let msg = ServerMsg::WatchEnded {
                watch,
                reason: WatchEndReason::Error,
                message: Some(format!("too many tabs open at once ({MAX_WATCHES})")),
            };
            return self.send(conn, &msg, Some(watch));
        }
        let Some((endpoint, server)) = self.parse_server(&session.server) else {
            return self.send(
                conn,
                &ServerMsg::ServerExited {
                    server: session.server,
                },
                None,
            );
        };
        if self.endpoints[endpoint]
            .live
            .is_some_and(|live| live != server)
        {
            return self.server_gone(endpoint, server);
        }
        let key = ViewKey {
            endpoint,
            server,
            session: SessionId(session.session),
        };
        let size = clamp(size);
        let owner = self.client_for(endpoint, key.session);
        let entry = self.views.entry(key).or_insert_with(|| View {
            watches: BTreeSet::new(),
            claim: None,
            selecting: None,
            phase: owner.map_or(ViewPhase::Checking, |owner| ViewPhase::Locating { owner }),
            locate: Locate {
                needed: true,
                ..Default::default()
            },
            shown: None,
            next: None,
            stream: Stream {
                live: false,
                size,
                inflight: None,
            },
        });
        let watch_key = WatchKey { conn, watch };
        entry.watches.insert(watch_key);
        if claim {
            entry.claim(watch_key, Take::Due);
        }
        if let Some(state) = self.conns.get_mut(&conn) {
            state.watches.insert(
                watch,
                Watch {
                    view: key,
                    size,
                    awaiting: true,
                    starved: false,
                    last_snapshot: None,
                    told: None,
                },
            );
        }
        self.tell(key);
    }

    fn resize(&mut self, conn: ConnId, watch: u32, size: proto::Size) {
        let Some(key) = self.watch_view(conn, watch) else {
            return;
        };
        let watch_key = WatchKey { conn, watch };
        let Some(current) = self
            .conns
            .get_mut(&conn)
            .and_then(|state| state.watches.get_mut(&watch))
        else {
            return;
        };
        let old_size = current.size;
        current.size = clamp(size);
        let size = current.size;
        let Some(view) = self.views.get_mut(&key) else {
            return;
        };
        view.claim(
            watch_key,
            if old_size == size {
                Take::Fit
            } else {
                Take::Due
            },
        );
    }

    fn watch_view(&self, conn: ConnId, watch: u32) -> Option<ViewKey> {
        self.conns
            .get(&conn)?
            .watches
            .get(&watch)
            .map(|watch| watch.view)
    }

    fn user_target(
        &self,
        conn: ConnId,
        watch: u32,
    ) -> Result<(ViewKey, ClientId, PaneId), Refusal> {
        let key = self.watch_view(conn, watch).ok_or(Refusal::UnknownWatch)?;
        let view = self.views.get(&key).ok_or(Refusal::UnknownWatch)?;
        let ViewPhase::Bound { owner, pane } = view.phase else {
            return Err(Refusal::NotBound);
        };
        if !self.room(owner, USER_IN_FLIGHT) {
            return Err(Refusal::Busy);
        }
        if self
            .conns
            .get(&conn)
            .and_then(|state| state.watches.get(&watch))
            .is_none_or(|watch| watch.told.is_none())
        {
            return Err(Refusal::NotBound);
        }
        Ok((key, owner, pane))
    }

    pub(super) fn record_vote(
        &mut self,
        owner: ClientId,
        window: WindowId,
        size: Size,
        take: bool,
    ) {
        self.record_vote_state(owner, window, size);
        let tag = self.next_tag();
        self.request(
            owner,
            tag,
            Op::Vote { window, size, take },
            Work::Maintenance,
        );
    }

    fn record_vote_state(&mut self, owner: ClientId, window: WindowId, size: Size) {
        if let Some(client) = self.clients.get_mut(&owner) {
            client.votes.insert(
                window,
                Vote {
                    size,
                    confirmed: false,
                    take_due: false,
                },
            );
        }
    }

    fn input(&mut self, conn: ConnId, watch: u32, window: WindowId, items: Vec<proto::InputItem>) {
        let size_bytes: usize = items
            .iter()
            .map(|item| match item {
                proto::InputItem::Text(text) | proto::InputItem::Key(text) => text.len(),
                proto::InputItem::Bytes(bytes) => bytes.0.len(),
            })
            .sum();
        if size_bytes > MAX_INPUT {
            return self.refuse(
                conn,
                None,
                Some(watch),
                ErrorCode::InputTooLarge,
                &format!("input over {MAX_INPUT} bytes"),
            );
        }
        let (key, owner, _) = match self.user_target(conn, watch) {
            Ok(target) => target,
            Err(refusal) => return self.refuse_for(conn, None, watch, refusal),
        };
        let claim = self
            .views
            .get(&key)
            .is_some_and(|view| view.target() == Some(window));
        let size = self.conns[&conn].watches[&watch].size;
        let plan = if claim {
            vote_plan(
                self.clients
                    .get(&owner)
                    .and_then(|client| client.votes.get(&window)),
                size,
                Take::Due,
            )
        } else {
            None
        };
        let (vote, take) = plan.map_or((false, false), |take| (true, take));
        let groups = 1 + usize::from(vote);
        if !self.room_for(owner, USER_IN_FLIGHT, groups) {
            return self.refuse(conn, None, Some(watch), ErrorCode::Busy, "tmux is busy");
        }
        if claim {
            if let Some(view) = self.views.get_mut(&key) {
                view.claim(WatchKey { conn, watch }, Take::None);
            }
        }
        if vote {
            self.record_vote(owner, window, size, take);
        }
        let items = items
            .into_iter()
            .map(|item| match item {
                proto::InputItem::Text(text) => InputItem::Text(text),
                proto::InputItem::Key(name) => InputItem::Key(name),
                proto::InputItem::Bytes(bytes) => InputItem::Bytes(bytes.0),
            })
            .collect();
        let tag = self.next_tag();
        self.request(
            owner,
            tag,
            Op::Input { window, items },
            Work::Input { conn, watch },
        );
    }

    fn paste(
        &mut self,
        conn: ConnId,
        req: u32,
        watch: u32,
        window: WindowId,
        enter: bool,
        file: PasteFile,
    ) {
        if !self.conns.contains_key(&conn) {
            return self.effects.push(Effect::RemoveFile { file });
        }
        let (key, owner, _) = match self.user_target(conn, watch) {
            Ok(target) => target,
            Err(refusal) => {
                self.effects.push(Effect::RemoveFile { file });
                return self.refuse_for(conn, Some(req), watch, refusal);
            }
        };
        let claim = self
            .views
            .get(&key)
            .is_some_and(|view| view.target() == Some(window));
        let size = self.conns[&conn].watches[&watch].size;
        let plan = if claim {
            vote_plan(
                self.clients
                    .get(&owner)
                    .and_then(|client| client.votes.get(&window)),
                size,
                Take::Due,
            )
        } else {
            None
        };
        let (vote, take) = plan.map_or((false, false), |take| (true, take));
        if !self.room_for(owner, USER_IN_FLIGHT, 1 + usize::from(vote)) {
            self.effects.push(Effect::RemoveFile { file });
            return self.refuse(
                conn,
                Some(req),
                Some(watch),
                ErrorCode::Busy,
                "tmux is busy",
            );
        }
        if claim {
            if let Some(view) = self.views.get_mut(&key) {
                view.claim(WatchKey { conn, watch }, Take::None);
            }
        }
        if vote {
            self.record_vote(owner, window, size, take);
        }
        let tag = self.next_tag();
        self.request(
            owner,
            tag,
            Op::Paste {
                window,
                path: file.path.clone(),
                enter,
            },
            Work::Paste {
                conn,
                watch,
                req,
                file,
            },
        );
    }

    fn select_window(&mut self, conn: ConnId, req: u32, watch: u32, window: WindowId) {
        let (key, owner, _) = match self.user_target(conn, watch) {
            Ok(target) => target,
            Err(refusal) => return self.refuse_for(conn, Some(req), watch, refusal),
        };
        if !self.room_for(owner, USER_IN_FLIGHT, 1) {
            return self.refuse(
                conn,
                Some(req),
                Some(watch),
                ErrorCode::Busy,
                "tmux is busy",
            );
        }
        let watch_key = WatchKey { conn, watch };
        let size = self.conns[&conn].watches[&watch].size;
        if let Some(view) = self.views.get_mut(&key) {
            view.select(window, watch_key);
            view.locate.needed = true;
        }
        self.record_vote_state(owner, window, size);
        let tag = self.next_tag();
        self.request(
            owner,
            tag,
            Op::SelectWindow {
                session: key.session,
                window,
                vote: size,
            },
            Work::SelectWindow {
                conn,
                watch,
                req,
                view: key,
                window,
            },
        );
    }

    fn history(&mut self, conn: ConnId, req: u32, watch: u32, start: i32, end: i32) {
        if end < start {
            return self.refuse(
                conn,
                Some(req),
                Some(watch),
                ErrorCode::BadRequest,
                "history end is before its start",
            );
        }
        if self.captures() >= CAPTURE_SLOTS || !self.can_reserve(conn, CAPTURE_RESERVATION) {
            return self.refuse_for(conn, Some(req), watch, Refusal::Busy);
        }
        self.reserve(conn, CAPTURE_RESERVATION);
        let end = end.min(start.saturating_add(HISTORY_ROWS - 1));
        self.capture_history(conn, req, watch, start, end);
    }

    fn capture_history(&mut self, conn: ConnId, req: u32, watch: u32, start: i32, end: i32) {
        let (_, owner, pane) = match self.user_target(conn, watch) {
            Ok(target) => target,
            Err(refusal) => {
                self.unreserve(conn, CAPTURE_RESERVATION);
                return self.refuse_for(conn, Some(req), watch, refusal);
            }
        };
        let tag = self.next_tag();
        self.request(
            owner,
            tag,
            Op::History { pane, start, end },
            Work::History {
                conn,
                watch,
                req,
                start,
                end,
                pane,
            },
        );
    }

    pub(super) fn history_answered(&mut self, work: Work, result: Result<Reply, TmuxError>) {
        let Work::History {
            conn,
            watch,
            req,
            start,
            end,
            pane,
        } = work
        else {
            unreachable!("only history work reaches history_answered")
        };
        if matches!(result, Err(TmuxError::TooLarge)) && start < end {
            let half = (end - start + 1) / 2;
            return self.capture_history(conn, req, watch, start, start + half - 1);
        }
        self.unreserve(conn, CAPTURE_RESERVATION);
        let mut history = match result {
            Ok(Reply::History(history)) => history,
            Err(error) => return self.refuse_tmux(conn, Some(req), Some(watch), &error),
            Ok(_) => return self.refuse_tmux(conn, Some(req), Some(watch), &TmuxError::BadReply),
        };
        let start = history.start;
        let history_size = history.history_size;
        let chunk = |lines: Vec<Base64>, wraps| ServerMsg::HistoryChunk {
            req,
            watch,
            pane: pane.0,
            start,
            history_size: Some(history_size),
            lines,
            wraps: Base64(wraps),
        };
        let base = chunk(Vec::new(), bytes::Bytes::new()).encode().len() as u64;
        let mut lines_size = 0;
        let mut fit = 0_usize;
        for row in &history.rows {
            let row_size = (row.len() as u64).div_ceil(3) * 4 + 2 + u64::from(fit > 0);
            let next_fit = fit + 1;
            let wraps_size = (next_fit.div_ceil(8) as u64).div_ceil(3) * 4;
            if base + lines_size + row_size + wraps_size > CAPTURE_RESERVATION {
                break;
            }
            lines_size += row_size;
            fit = next_fit;
        }
        if fit == 0 && !history.rows.is_empty() {
            return self.refuse_tmux(conn, Some(req), Some(watch), &TmuxError::TooLarge);
        }
        history.truncate(fit);
        let lines = history.rows.into_iter().map(Base64).collect();
        self.send(conn, &chunk(lines, history.wraps.into_bytes()), None);
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
        self.learned_version(MAIN, listing.server, &listing.version);
        let sessions = listing
            .sessions
            .into_iter()
            .map(|session| SessionListing {
                id: session.id.0,
                name: cut(session.name),
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
        let json = ServerMsg::Sessions {
            req,
            tmux: Some(TmuxListing {
                server: self.server_name(MAIN, listing.server),
                version: listing.version.to_string(),
                sessions,
            }),
        }
        .encode();
        if json.len() as u64 > LISTING_RESERVATION {
            return self.refuse(
                conn,
                Some(req),
                None,
                ErrorCode::Tmux,
                "the session list is too large",
            );
        }
        self.send_encoded(conn, json, None);
    }

    fn new_window(
        &mut self,
        conn: ConnId,
        req: u32,
        session: &SessionRef,
        watch: Option<u32>,
        name: Option<String>,
        dir: Option<String>,
    ) {
        let Some((endpoint, server)) = self.parse_server(&session.server) else {
            return self.refuse(
                conn,
                Some(req),
                None,
                ErrorCode::BadRequest,
                "unknown tmux server",
            );
        };
        let session_id = SessionId(session.session);
        let watch_key = if let Some(watch) = watch {
            let Some(key) = self.watch_view(conn, watch) else {
                return self.refuse(
                    conn,
                    Some(req),
                    Some(watch),
                    ErrorCode::BadRequest,
                    "no such watch",
                );
            };
            if key.endpoint != endpoint || key.server != server || key.session != session_id {
                return self.refuse(
                    conn,
                    Some(req),
                    Some(watch),
                    ErrorCode::BadRequest,
                    "the watch is on another session",
                );
            }
            Some(WatchKey { conn, watch })
        } else {
            None
        };
        if self.oneshot.is_some() {
            return self.refuse(conn, Some(req), None, ErrorCode::Busy, "tmux is busy");
        }
        self.create(
            OneShotCmd::NewWindow {
                server,
                session: session_id,
                name,
                dir: dir.map(Into::into),
            },
            OneShotWork::Create {
                conn,
                req,
                endpoint,
                server: Some(server),
                watch: watch_key,
                session: Some(session_id),
            },
        );
    }

    fn create(&mut self, cmd: OneShotCmd, work: OneShotWork) {
        let OneShotWork::Create {
            conn,
            req,
            endpoint,
            watch,
            ..
        } = &work
        else {
            unreachable!("only create work reaches create")
        };
        if self.oneshot.is_some() {
            return self.refuse(
                *conn,
                Some(*req),
                watch.map(|watch| watch.watch),
                ErrorCode::Busy,
                "tmux is busy",
            );
        }
        self.run_oneshot(*endpoint, cmd, work);
    }

    pub(super) fn created(&mut self, work: OneShotWork, result: Result<Reply, TmuxError>) {
        let OneShotWork::Create {
            conn,
            req,
            endpoint,
            server,
            watch,
            session,
        } = work
        else {
            unreachable!("only create work reaches created")
        };
        match result {
            Err(TmuxError::NoServer) => {
                if let Some(gone) = server.or(self.endpoints[endpoint].live) {
                    self.server_gone(endpoint, gone);
                }
                let message = if server.is_some() {
                    "that tmux server has exited"
                } else {
                    "no tmux server running"
                };
                self.refuse(
                    conn,
                    Some(req),
                    watch.map(|watch| watch.watch),
                    ErrorCode::NoServer,
                    message,
                );
            }
            Ok(Reply::Created(created)) => {
                self.learned(endpoint, created.server);
                if let (Some(watch), Some(session)) = (watch, session) {
                    let key = ViewKey {
                        endpoint,
                        server: created.server,
                        session,
                    };
                    if let Some(view) = self
                        .views
                        .get_mut(&key)
                        .filter(|view| view.watches.contains(&watch))
                    {
                        view.created(created.window, watch);
                        view.locate.needed = true;
                    }
                }
                let msg = ServerMsg::Created {
                    req,
                    window: self.window_ref(endpoint, created.server, created.window),
                    session: self.session_ref(endpoint, created.server, created.session),
                };
                self.send(conn, &msg, None);
            }
            Err(error) => {
                self.refuse_tmux(conn, Some(req), watch.map(|watch| watch.watch), &error);
            }
            Ok(_) => {
                self.refuse_tmux(
                    conn,
                    Some(req),
                    watch.map(|watch| watch.watch),
                    &TmuxError::BadReply,
                );
            }
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
            OneShotWork::Locate { view } => self.located(view, tag, None, result),
            OneShotWork::SessionCheck { exited } => self.checked(exited, tag, result),
            OneShotWork::List { conn, req } => self.listed(conn, req, result),
            work @ OneShotWork::Create { .. } => self.created(work, result),
        }
    }

    pub(super) fn closed(&mut self, conn: ConnId) {
        let Some(state) = self.conns.remove(&conn) else {
            return;
        };
        self.effects.push(Effect::DropConn { conn });
        for (watch, removed) in state.watches {
            self.leave(WatchKey { conn, watch }, removed.view);
        }
    }

    fn refuse_for(&mut self, conn: ConnId, req: Option<u32>, watch: u32, refusal: Refusal) {
        let (code, message) = match refusal {
            Refusal::UnknownWatch => (ErrorCode::BadRequest, "no such watch"),
            Refusal::NotBound => (ErrorCode::Busy, "the session isn't connected yet"),
            Refusal::Busy => (ErrorCode::Busy, "tmux is busy"),
        };
        self.refuse(conn, req, Some(watch), code, message);
    }
}
