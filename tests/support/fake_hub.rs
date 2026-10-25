//! `hub::State` driven by scripted inputs (daemon-core.md §8): a fake tmux server
//! answers the lines the hub writes, the way tmux 3.4 would, and each test checks what
//! reaches the connections and which ops the control clients ran. `tmux::fake` reads
//! the lines and frames the answers; this server only decides what each command finds,
//! and tests name ops by the lines `command::op` builds for them.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use bytes::Bytes;
use serde_json::{Value, json};
use tether::blocking::Lanes;
use tether::budget::DEFAULT_CAPS;
use tether::hub::{ConnId, Effect, Endpoints, FromConn, Input, PasteFile, State, ToConn};
use tether::proto::{self, ClientMsg, WindowRef};
use tether::tmux::fake::{self, Capture, Command};
use tether::tmux::{
    ClientId, Created, Endpoint, Found, ListedSession, Listing, Location, OneShotCmd, Op, PaneId,
    PumpMsg, Reply, ServerInstance, SessionId, SessionLocation, Size, Socket, Tag, TmuxError,
    TmuxVersion, WindowId, command,
};
use tokio::sync::Semaphore;

const SERVER: ServerInstance = ServerInstance {
    pid: 42,
    start_time: 7,
};
pub(super) const SERVER_NAME: &str = "main:42-7";

/// A pane's place in the fake server.
#[derive(Clone)]
pub(super) struct FakeWindow {
    /// Every session the window is linked into; Locate names the first, or the
    /// asking client's own.
    pub(super) sessions: Vec<u32>,
    pub(super) pane: u32,
    pub(super) size: Size,
    pub(super) session_name: String,
}

pub(super) struct FakeClient {
    pub(super) session: u32,
    /// Lines written and not yet answered, oldest first.
    pub(super) unanswered: VecDeque<String>,
    pub(super) closed: bool,
}

/// What a connection received, decoded.
#[derive(Debug, Clone, PartialEq)]
pub(super) enum Got {
    Json(Value),
    Output(u32, Bytes),
    Snapshot(u32, proto::Size),
}

pub(super) struct Hub {
    pub(super) state: State,
    pub(super) now: Instant,
    pub(super) alive: bool,
    pub(super) sessions: BTreeSet<u32>,
    pub(super) windows: BTreeMap<u32, FakeWindow>,
    pub(super) clients: BTreeMap<ClientId, FakeClient>,
    pub(super) oneshots: VecDeque<(Tag, OneShotCmd)>,
    pub(super) got: BTreeMap<ConnId, Vec<Got>>,
    /// Every line written per client, answered or not.
    pub(super) written: BTreeMap<ClientId, Vec<String>>,
    pub(super) dropped: BTreeSet<ConnId>,
    pub(super) removed: Vec<PathBuf>,
    /// History rows are padded to this many bytes.
    pub(super) row_width: usize,
    pub(super) next_conn: u64,
    pub(super) block: u64,
    pub(super) slots: Arc<Semaphore>,
}

impl Hub {
    /// Session `$0` holds window `@0` (pane `%0`, 80×24).
    pub(super) fn new() -> Self {
        Self::new_with_max_clients(DEFAULT_CAPS.control_clients)
    }

    pub(super) fn new_with_max_clients(max_clients: usize) -> Self {
        let endpoint = Endpoint {
            program: PathBuf::from("tmux"),
            socket: Socket::Name("fake".into()),
        };
        let now = Instant::now();
        let mut hub = Self {
            state: State::new(
                Endpoints { main: endpoint },
                now,
                max_clients,
                "devbox".to_owned(),
            ),
            now,
            alive: true,
            sessions: BTreeSet::from([0]),
            windows: BTreeMap::new(),
            clients: BTreeMap::new(),
            oneshots: VecDeque::new(),
            got: BTreeMap::new(),
            written: BTreeMap::new(),
            dropped: BTreeSet::new(),
            removed: Vec::new(),
            row_width: 0,
            next_conn: 1,
            block: 1,
            slots: Arc::new(Semaphore::new(4)),
        };
        hub.add_window(0, 0, 0);
        hub
    }

    pub(super) fn add_window(&mut self, window: u32, session: u32, pane: u32) {
        self.sessions.insert(session);
        self.windows.insert(
            window,
            FakeWindow {
                sessions: vec![session],
                pane,
                size: Size { cols: 80, rows: 24 },
                session_name: format!("session{session}"),
            },
        );
    }

    pub(super) fn window(&mut self, id: u32) -> &mut FakeWindow {
        self.windows.get_mut(&id).expect("a fake window")
    }

    pub(super) fn input(&mut self, input: Input) {
        for effect in self.state.handle(input, self.now) {
            match effect {
                Effect::SpawnClient {
                    client, session, ..
                } => {
                    let fake = FakeClient {
                        session: session.0,
                        unanswered: VecDeque::new(),
                        closed: false,
                    };
                    assert!(self.clients.insert(client, fake).is_none());
                }
                Effect::Write { client, lines } => {
                    let fake = self.clients.get_mut(&client).expect("a spawned client");
                    assert!(!fake.closed, "write to a closed client");
                    self.written
                        .entry(client)
                        .or_default()
                        .extend(lines.iter().cloned());
                    fake.unanswered.extend(lines);
                }
                Effect::CloseClient { client } => {
                    self.clients.get_mut(&client).expect("a client").closed = true;
                }
                Effect::OneShot { tag, cmd, .. } => {
                    assert!(self.oneshots.is_empty(), "two one-shots at once");
                    self.oneshots.push_back((tag, cmd));
                }
                Effect::Send { conn, msg } => {
                    let got = match msg {
                        ToConn::Msg { json, .. } => {
                            Got::Json(serde_json::from_str(json.as_str()).expect("JSON"))
                        }
                        ToConn::Output { watch, bytes } => Got::Output(watch, bytes),
                        ToConn::Snapshot { watch, size, .. } => Got::Snapshot(watch, size),
                    };
                    self.got.entry(conn).or_default().push(got);
                }
                Effect::DropConn { conn } => {
                    self.dropped.insert(conn);
                }
                Effect::RemoveFile { file } => self.removed.push(file.path.clone()),
            }
        }
    }

    pub(super) fn connect(&mut self) -> ConnId {
        let conn = ConnId(self.next_conn);
        self.next_conn += 1;
        self.input(Input::Connected(conn));
        conn
    }

    pub(super) fn send(&mut self, conn: ConnId, msg: Value) {
        let msg: ClientMsg = serde_json::from_value(msg).expect("a client message");
        self.input(Input::Conn(conn, FromConn::Client(msg)));
    }

    pub(super) fn watch(&mut self, conn: ConnId, watch: u32, window: u32) {
        self.watch_sized(conn, watch, window, 80, 24);
    }

    pub(super) fn watch_sized(
        &mut self,
        conn: ConnId,
        watch: u32,
        window: u32,
        cols: u16,
        rows: u16,
    ) {
        let window = WindowRef {
            server: SERVER_NAME.into(),
            window,
        };
        let msg = json!({"type": "watch", "data": {"watch": watch, "window": window, "size": {"cols": cols, "rows": rows}}});
        self.send(conn, msg);
    }

    pub(super) fn credit(&mut self, conn: ConnId, bytes: u32) {
        self.input(Input::Conn(conn, FromConn::Credit { bytes }));
    }

    pub(super) fn advance(&mut self, by: Duration) {
        self.now += by;
        self.input(Input::Tick);
    }

    /// Bytes from a control client's stdout.
    pub(super) fn feed(&mut self, client: ClientId, text: &str) {
        let bytes = Bytes::copy_from_slice(text.as_bytes());
        self.input(Input::Pump(client, PumpMsg::Bytes(bytes)));
    }

    pub(super) fn output(&mut self, client: ClientId, pane: u32, text: &str) {
        self.feed(client, &format!("%output %{pane} {text}\n"));
    }

    /// The client's process ended (the pump's last message).
    pub(super) fn exited(&mut self, client: ClientId) {
        self.clients.get_mut(&client).expect("a client").closed = true;
        let stderr_tail = String::new();
        self.input(Input::Pump(client, PumpMsg::Exited { stderr_tail }));
    }

    /// Answers every written line and one-shot until nothing is left to answer.
    pub(super) fn settle(&mut self) {
        self.settle_until(|_| false);
    }

    /// Like `settle`, but a client whose next line matches `hold` stops answering.
    pub(super) fn settle_until(&mut self, hold: impl Fn(&str) -> bool) {
        for _ in 0..100 {
            let pending: Vec<ClientId> = self
                .clients
                .iter()
                .filter(|(_, fake)| {
                    !fake.closed && fake.unanswered.front().is_some_and(|line| !hold(line))
                })
                .map(|(id, _)| *id)
                .collect();
            if pending.is_empty() && self.oneshots.is_empty() {
                return;
            }
            for client in pending {
                while self.clients[&client]
                    .unanswered
                    .front()
                    .is_some_and(|line| !hold(line))
                {
                    self.answer_one(client);
                }
            }
            self.answer_oneshot();
        }
        panic!("the hub never settled");
    }

    /// Answers the client's oldest unanswered line; false if there is none.
    fn answer_one(&mut self, client: ClientId) -> bool {
        match self.reply_bytes(client) {
            Some(stdout) => {
                self.feed(client, &stdout);
                true
            }
            None => false,
        }
    }

    /// tmux's stdout answering the client's oldest unanswered line, as the server is
    /// now; the caller feeds it.
    pub(super) fn reply_bytes(&mut self, client: ClientId) -> Option<String> {
        let fake = self.clients.get_mut(&client)?;
        let line = fake.unanswered.pop_front()?;
        let session = fake.session;
        let mut block = self.block;
        let stdout = fake::answer(&line, &mut block, |command| self.reply(session, command));
        self.block = block;
        Some(stdout)
    }

    fn answer_oneshot(&mut self) {
        let Some((tag, cmd)) = self.oneshots.pop_front() else {
            return;
        };
        let result = match cmd {
            _ if !self.alive => Err(TmuxError::NoServer),
            // tmux checks the instance before it creates anything (`command::only_on`).
            OneShotCmd::NewWindow { server, .. } if server != SERVER => Err(TmuxError::NoServer),
            cmd => Ok(match cmd {
                OneShotCmd::Locate { window } => Reply::Location(self.locate(window.0, None)),
                OneShotCmd::LocateSession { session } => Reply::SessionLocation(SessionLocation {
                    server: SERVER,
                    exists: self.sessions.contains(&session.0),
                }),
                OneShotCmd::NewWindow { session, .. } => {
                    self.add_window(9, session.0, 9);
                    Reply::Created(Created {
                        server: SERVER,
                        session,
                        window: WindowId(9),
                    })
                }
                OneShotCmd::List => Reply::Listing(Listing {
                    server: SERVER,
                    version: TmuxVersion::parse("3.4"),
                    sessions: vec![ListedSession {
                        id: SessionId(0),
                        name: "fixture".into(),
                        windows: Vec::new(),
                    }],
                }),
                other => panic!("unexpected one-shot {other:?}"),
            }),
        };
        self.input(Input::OneShot(tag, result));
    }

    fn locate(&self, window: u32, asking: Option<u32>) -> Location {
        let found = self.windows.get(&window).map(|fake| {
            let session = asking
                .filter(|session| fake.sessions.contains(session))
                .unwrap_or(fake.sessions[0]);
            Found {
                session: SessionId(session),
                pane: PaneId(fake.pane),
                size: fake.size,
                session_name: fake.session_name.clone(),
            }
        });
        Location {
            server: SERVER,
            found,
        }
    }

    /// tmux's reply rows to one command from a client attached to `session`, or its
    /// error.
    fn reply(&self, session: u32, command: &Command) -> Result<Vec<String>, String> {
        match command {
            Command::Display { target, format } => {
                let value = |name: &str| self.variable(session, target.as_deref(), name);
                Ok(vec![fake::expand(format, value)])
            }
            Command::Capture { pane, rows } => {
                if self.pane_size(pane.0).is_none() {
                    return Err(format!("can't find pane: {pane}"));
                }
                Ok(match *rows {
                    Capture::Screen => vec![format!("screen of {pane}")],
                    Capture::Pending | Capture::Saved => Vec::new(),
                    // Not `format!` padding: its width can't reach a row too large to send.
                    Capture::Range { start, end } => (start..=end)
                        .map(|row| {
                            let row = format!("row {row}");
                            let pad = self.row_width.saturating_sub(row.len());
                            row + &"w".repeat(pad)
                        })
                        .collect(),
                })
            }
            Command::PasteBuffer { window } => {
                if self.locate(window.0, Some(session)).found.is_some() {
                    Ok(Vec::new())
                } else {
                    Err(format!("can't find window: {window}"))
                }
            }
            Command::Other => Ok(Vec::new()),
        }
    }

    /// What `#{name}` expands to for a `display-message -t target` from a client
    /// attached to `session`. Every field of a target that is gone is empty.
    fn variable(&self, session: u32, target: Option<&str>, name: &str) -> String {
        match name {
            "version" => return "3.4".to_owned(),
            "pid" => return SERVER.pid.to_string(),
            "start_time" => return SERVER.start_time.to_string(),
            _ => {}
        }
        let Some(target) = target else {
            // The attached session's current window.
            return match name {
                "window_width" => "80".to_owned(),
                "window_height" => "24".to_owned(),
                _ => panic!("no #{{{name}}} without a target"),
            };
        };
        if let Some(window) = WindowId::parse(target.as_bytes()) {
            let Some(found) = self.locate(window.0, Some(session)).found else {
                return String::new();
            };
            return match name {
                "session_id" => found.session.to_string(),
                "window_id" => window.to_string(),
                "pane_id" => found.pane.to_string(),
                "pane_width" => found.size.cols.to_string(),
                "pane_height" => found.size.rows.to_string(),
                "session_name" => found.session_name,
                _ => panic!("#{{{name}}} of a window"),
            };
        }
        if let Some(id) = SessionId::parse(target.as_bytes()) {
            let exists = self.sessions.contains(&id.0);
            return if exists {
                id.to_string()
            } else {
                String::new()
            };
        }
        let pane = PaneId::parse(target.as_bytes()).expect("a pane target");
        let Some(size) = self.pane_size(pane.0) else {
            return String::new();
        };
        // A shell at the top left of a fresh screen.
        match name {
            "pane_id" => pane.to_string(),
            "history_size" => "1000".to_owned(),
            "pane_width" => size.cols.to_string(),
            "pane_height" => size.rows.to_string(),
            "alternate_saved_x" | "alternate_saved_y" => u32::MAX.to_string(),
            "cursor_flag" | "wrap_flag" => "1".to_owned(),
            "scroll_region_lower" => (size.rows - 1).to_string(),
            "pane_tabs" => String::new(),
            _ => "0".to_owned(),
        }
    }

    fn pane_size(&self, pane: u32) -> Option<Size> {
        self.windows
            .values()
            .find(|window| window.pane == pane)
            .map(|window| window.size)
    }

    /// Takes what the connection received so far.
    pub(super) fn take(&mut self, conn: ConnId) -> Vec<Got> {
        self.got.remove(&conn).unwrap_or_default()
    }

    pub(super) fn take_json(&mut self, conn: ConnId) -> Vec<Value> {
        self.take(conn)
            .into_iter()
            .filter_map(|got| match got {
                Got::Json(value) => Some(value),
                _ => None,
            })
            .collect()
    }

    /// The control client attached to `session`, still open.
    pub(super) fn client(&self, session: u32) -> ClientId {
        *self
            .clients
            .iter()
            .find(|(_, fake)| fake.session == session && !fake.closed)
            .map(|(id, _)| id)
            .unwrap_or_else(|| panic!("no open client for ${session}"))
    }

    pub(super) fn lines(&self, client: ClientId) -> &[String] {
        self.written.get(&client).map_or(&[], Vec::as_slice)
    }

    /// A watch on `@window`, bound and caught up.
    pub(super) fn open(&mut self, conn: ConnId, watch: u32, window: u32) {
        self.watch(conn, watch, window);
        self.settle();
    }

    pub(super) fn paste_file(&self, name: &str) -> PasteFile {
        let slot = Arc::clone(&self.slots)
            .try_acquire_owned()
            .expect("a paste slot");
        PasteFile::new(PathBuf::from(name), slot, Lanes::default().auth)
    }
}

pub(super) fn kind(value: &Value) -> &str {
    value["type"].as_str().unwrap_or_default()
}

pub(super) fn kinds(values: &[Value]) -> Vec<&str> {
    values.iter().map(kind).collect()
}

pub(super) fn size(cols: u16, rows: u16) -> proto::Size {
    proto::Size { cols, rows }
}

/// The line the hub writes for `op`.
pub(super) fn line_for(op: Op) -> String {
    command::op(&op, Tag(0)).expect("a valid op").line
}

pub(super) fn vote(window: u32, cols: u16, rows: u16) -> String {
    let size = Size { cols, rows };
    line_for(Op::Vote {
        window: WindowId(window),
        size,
    })
}

pub(super) fn release(pane: u32) -> String {
    line_for(Op::Release { pane: PaneId(pane) })
}

pub(super) fn snapshot(pane: u32) -> String {
    line_for(Op::Snapshot { pane: PaneId(pane) })
}

pub(super) fn capture_history(start: i32, end: i32) -> String {
    let pane = PaneId(0);
    line_for(Op::History { pane, start, end })
}

/// What the hub writes once it lets go of window `@0`, whose pane is `%0`.
pub(super) fn let_go_of_window_0() -> [String; 3] {
    let window = WindowId(0);
    [
        release(0),
        line_for(Op::ClearVote { window }),
        line_for(Op::Unsubscribe { window }),
    ]
}
