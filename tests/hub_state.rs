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
use tether::hub::{
    CAPTURE_RESERVATION, CREDIT, ConnId, Effect, Endpoints, FromConn, Input, OVERDRAFT, PasteFile,
    SNAPSHOT_SPACING, State, ToConn,
};
use tether::proto::{self, ClientMsg, SessionRef, WindowRef};
use tether::tmux::fake::{self, Capture, Command};
use tether::tmux::{
    ClientId, Created, Endpoint, Found, InputItem, ListedSession, Listing, Location, OneShotCmd,
    Op, PaneId, PumpMsg, Reply, ServerInstance, SessionId, SessionLocation, Size, Socket, Tag,
    TmuxError, TmuxVersion, WindowId, command,
};
use tokio::sync::Semaphore;

const SERVER: ServerInstance = ServerInstance {
    pid: 42,
    start_time: 7,
};
const SERVER_NAME: &str = "main:42-7";

/// A pane's place in the fake server.
#[derive(Clone)]
struct FakeWindow {
    /// Every session the window is linked into; Locate names the first, or the
    /// asking client's own.
    sessions: Vec<u32>,
    pane: u32,
    size: Size,
}

struct FakeClient {
    session: u32,
    /// Lines written and not yet answered, oldest first.
    unanswered: VecDeque<String>,
    closed: bool,
}

/// What a connection received, decoded.
#[derive(Debug, Clone, PartialEq)]
enum Got {
    Json(Value),
    Output(u32, Bytes),
    Snapshot(u32, proto::Size),
}

struct Hub {
    state: State,
    now: Instant,
    alive: bool,
    sessions: BTreeSet<u32>,
    windows: BTreeMap<u32, FakeWindow>,
    clients: BTreeMap<ClientId, FakeClient>,
    oneshots: VecDeque<(Tag, OneShotCmd)>,
    got: BTreeMap<ConnId, Vec<Got>>,
    /// Every line written per client, answered or not.
    written: BTreeMap<ClientId, Vec<String>>,
    dropped: BTreeSet<ConnId>,
    removed: Vec<PathBuf>,
    /// History rows are padded to this many bytes.
    row_width: usize,
    next_conn: u64,
    block: u64,
    slots: Arc<Semaphore>,
}

impl Hub {
    /// Session `$0` holds window `@0` (pane `%0`, 80×24).
    fn new() -> Self {
        let endpoint = Endpoint {
            program: PathBuf::from("tmux"),
            socket: Socket::Name("fake".into()),
        };
        let now = Instant::now();
        let mut hub = Self {
            state: State::new(Endpoints { main: endpoint }, now),
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

    fn add_window(&mut self, window: u32, session: u32, pane: u32) {
        self.sessions.insert(session);
        self.windows.insert(
            window,
            FakeWindow {
                sessions: vec![session],
                pane,
                size: Size { cols: 80, rows: 24 },
            },
        );
    }

    fn window(&mut self, id: u32) -> &mut FakeWindow {
        self.windows.get_mut(&id).expect("a fake window")
    }

    fn input(&mut self, input: Input) {
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

    fn connect(&mut self) -> ConnId {
        let conn = ConnId(self.next_conn);
        self.next_conn += 1;
        self.input(Input::Connected(conn));
        conn
    }

    fn send(&mut self, conn: ConnId, msg: Value) {
        let msg: ClientMsg = serde_json::from_value(msg).expect("a client message");
        self.input(Input::Conn(conn, FromConn::Client(msg)));
    }

    fn watch(&mut self, conn: ConnId, watch: u32, window: u32) {
        self.watch_sized(conn, watch, window, 80, 24);
    }

    fn watch_sized(&mut self, conn: ConnId, watch: u32, window: u32, cols: u16, rows: u16) {
        let window = WindowRef {
            server: SERVER_NAME.into(),
            window,
        };
        let msg = json!({"type": "watch", "data": {"watch": watch, "window": window, "size": {"cols": cols, "rows": rows}}});
        self.send(conn, msg);
    }

    fn credit(&mut self, conn: ConnId, bytes: u32) {
        self.input(Input::Conn(conn, FromConn::Credit { bytes }));
    }

    fn advance(&mut self, by: Duration) {
        self.now += by;
        self.input(Input::Tick);
    }

    /// Bytes from a control client's stdout.
    fn feed(&mut self, client: ClientId, text: &str) {
        let bytes = Bytes::copy_from_slice(text.as_bytes());
        self.input(Input::Pump(client, PumpMsg::Bytes(bytes)));
    }

    fn output(&mut self, client: ClientId, pane: u32, text: &str) {
        self.feed(client, &format!("%output %{pane} {text}\n"));
    }

    /// The client's process ended (the pump's last message).
    fn exited(&mut self, client: ClientId) {
        self.clients.get_mut(&client).expect("a client").closed = true;
        let stderr_tail = String::new();
        self.input(Input::Pump(client, PumpMsg::Exited { stderr_tail }));
    }

    /// Answers every written line and one-shot until nothing is left to answer.
    fn settle(&mut self) {
        self.settle_until(|_| false);
    }

    /// Like `settle`, but a client whose next line matches `hold` stops answering.
    fn settle_until(&mut self, hold: impl Fn(&str) -> bool) {
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
    fn reply_bytes(&mut self, client: ClientId) -> Option<String> {
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
                        attached_elsewhere: true,
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
    fn take(&mut self, conn: ConnId) -> Vec<Got> {
        self.got.remove(&conn).unwrap_or_default()
    }

    fn take_json(&mut self, conn: ConnId) -> Vec<Value> {
        self.take(conn)
            .into_iter()
            .filter_map(|got| match got {
                Got::Json(value) => Some(value),
                _ => None,
            })
            .collect()
    }

    /// The control client attached to `session`, still open.
    fn client(&self, session: u32) -> ClientId {
        *self
            .clients
            .iter()
            .find(|(_, fake)| fake.session == session && !fake.closed)
            .map(|(id, _)| id)
            .unwrap_or_else(|| panic!("no open client for ${session}"))
    }

    fn lines(&self, client: ClientId) -> &[String] {
        self.written.get(&client).map_or(&[], Vec::as_slice)
    }

    /// A watch on `@window`, bound and caught up.
    fn open(&mut self, conn: ConnId, watch: u32, window: u32) {
        self.watch(conn, watch, window);
        self.settle();
    }

    fn paste_file(&self, name: &str) -> PasteFile {
        let slot = Arc::clone(&self.slots)
            .try_acquire_owned()
            .expect("a paste slot");
        PasteFile::new(PathBuf::from(name), slot)
    }
}

fn kind(value: &Value) -> &str {
    value["type"].as_str().unwrap_or_default()
}

fn kinds(values: &[Value]) -> Vec<&str> {
    values.iter().map(kind).collect()
}

fn size(cols: u16, rows: u16) -> proto::Size {
    proto::Size { cols, rows }
}

/// The line the hub writes for `op`.
fn line_for(op: Op) -> String {
    command::op(&op, Tag(0)).expect("a valid op").line
}

fn vote(window: u32, cols: u16, rows: u16) -> String {
    let size = Size { cols, rows };
    line_for(Op::Vote {
        window: WindowId(window),
        size,
    })
}

fn release(pane: u32) -> String {
    line_for(Op::Release { pane: PaneId(pane) })
}

fn snapshot(pane: u32) -> String {
    line_for(Op::Snapshot { pane: PaneId(pane) })
}

fn capture_history(start: i32, end: i32) -> String {
    let pane = PaneId(0);
    line_for(Op::History { pane, start, end })
}

/// What the hub writes once it lets go of window `@0`, whose pane is `%0`.
fn let_go_of_window_0() -> [String; 3] {
    let window = WindowId(0);
    [
        release(0),
        line_for(Op::ClearVote { window }),
        line_for(Op::Unsubscribe { window }),
    ]
}

#[test]
fn a_watch_binds_after_locating_and_catches_up_by_snapshot() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.watch(conn, 1, 0);
    // No control client exists yet, so the first Locate is a one-shot.
    assert!(
        matches!(hub.oneshots.front(), Some((_, OneShotCmd::Locate { window })) if *window == WindowId(0))
    );
    hub.settle();
    let client = hub.client(0);
    let got = hub.take(conn);
    assert_eq!(
        got,
        [
            Got::Json(
                json!({"type": "watching", "data": {"watch": 1, "window": {"server": SERVER_NAME, "window": 0}, "session": {"server": SERVER_NAME, "session": 0}, "pane": 0, "cwd": null}})
            ),
            Got::Snapshot(1, size(80, 24)),
        ]
    );
    let lines = hub.lines(client);
    assert!(lines.contains(&line_for(Op::Subscribe {
        window: WindowId(0)
    })));
    assert!(lines.contains(&vote(0, 80, 24)));

    hub.output(client, 0, "hi");
    assert_eq!(hub.take(conn), [Got::Output(1, Bytes::from_static(b"hi"))]);
    hub.feed(client, "%subscription-changed w0 $0 @0 1 - : /home/j\n");
    let watching = hub.take_json(conn);
    assert_eq!(watching[0]["data"]["cwd"], "/home/j");

    hub.send(
        conn,
        json!({"type": "input", "data": {"watch": 1, "items": [{"text": "ls"}, {"key": "Enter"}]}}),
    );
    hub.settle();
    let input = Op::Input {
        window: WindowId(0),
        items: vec![InputItem::Text("ls".into()), InputItem::Key("Enter".into())],
    };
    assert_eq!(hub.lines(client).last(), Some(&line_for(input)));
    assert!(
        hub.take(conn).is_empty(),
        "input that succeeds answers nothing"
    );
}

#[test]
fn a_second_watch_joins_a_live_stream_without_disturbing_the_first() {
    let mut hub = Hub::new();
    let (first, second) = (hub.connect(), hub.connect());
    hub.open(first, 1, 0);
    let client = hub.client(0);
    hub.take(first);
    hub.watch_sized(second, 5, 0, 100, 30);
    // Bound already: `watching` at once, then a snapshot for the new watch only.
    assert_eq!(kinds(&hub.take_json(second)), ["watching"]);
    hub.output(client, 0, "a");
    assert_eq!(hub.take(first), [Got::Output(1, Bytes::from_static(b"a"))]);
    assert!(hub.take(second).is_empty(), "awaiting its snapshot");
    hub.settle();
    assert_eq!(hub.take(second), [Got::Snapshot(5, size(80, 24))]);
    assert!(hub.take(first).is_empty());
    // The last watch's size is the window's vote.
    assert!(hub.lines(client).contains(&vote(0, 100, 30)));
    hub.output(client, 0, "b");
    assert_eq!(hub.take(first), [Got::Output(1, Bytes::from_static(b"b"))]);
    assert_eq!(hub.take(second), [Got::Output(5, Bytes::from_static(b"b"))]);

    // The pane stays wanted until its last watch leaves.
    hub.send(first, json!({"type": "unwatch", "data": {"watch": 1}}));
    hub.settle();
    assert!(!hub.lines(client).contains(&release(0)));
    hub.send(second, json!({"type": "unwatch", "data": {"watch": 5}}));
    hub.settle();
    assert!(hub.lines(client).ends_with(&let_go_of_window_0()));
    // The client lingers, then closes.
    hub.advance(Duration::from_secs(16));
    assert!(hub.clients[&client].closed);
}

#[test]
fn a_resize_votes_and_a_new_pane_size_breaks_the_stream() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    let client = hub.client(0);
    hub.take(conn);
    hub.send(
        conn,
        json!({"type": "resize", "data": {"watch": 1, "size": {"cols": 1000, "rows": 2}}}),
    );
    // Clamped to 500×5.
    assert_eq!(hub.lines(client).last(), Some(&vote(0, 500, 5)));
    hub.settle();
    // A layout repeating the pane's size is no break.
    hub.feed(
        client,
        "%layout-change @0 b25d,80x24,0,0,0 b25d,80x24,0,0,0 *\n",
    );
    hub.output(client, 0, "x");
    assert_eq!(hub.take(conn), [Got::Output(1, Bytes::from_static(b"x"))]);
    hub.window(0).size = Size { cols: 500, rows: 5 };
    hub.feed(
        client,
        "%layout-change @0 b25d,500x5,0,0,0 b25d,500x5,0,0,0 *\n",
    );
    hub.output(client, 0, "dropped: the snapshot holds it");
    assert!(hub.take(conn).is_empty());
    hub.settle();
    assert_eq!(hub.take(conn), [Got::Snapshot(1, size(500, 5))]);
}

#[test]
fn an_active_pane_change_during_a_snapshot_forgets_it_and_snapshots_the_new_pane() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.watch(conn, 1, 0);
    // Bind, but leave the first snapshot unanswered.
    hub.settle_until(|line| line == snapshot(0));
    let client = hub.client(0);
    hub.take(conn);
    hub.add_window(0, 0, 1);
    hub.feed(client, "%window-pane-changed @0 %1\n");
    assert_eq!(hub.take_json(conn)[0]["data"]["pane"], 1);
    hub.settle();
    // Only the new pane's snapshot reaches the watch.
    assert_eq!(hub.take(conn), [Got::Snapshot(1, size(80, 24))]);
    assert!(hub.lines(client).contains(&release(0)));
    hub.output(client, 1, "new");
    assert_eq!(hub.take(conn), [Got::Output(1, Bytes::from_static(b"new"))]);
}

#[test]
fn a_moved_window_rehomes_its_watch_with_a_fresh_snapshot() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    let old = hub.client(0);
    hub.take(conn);
    // move-window -s $0:@0 -t $1:
    hub.sessions.insert(1);
    hub.window(0).sessions = vec![1];
    hub.feed(old, "%unlinked-window-close @0\n");
    hub.settle();
    let new = hub.client(1);
    let got = hub.take(conn);
    let [Got::Json(watching), snapshot] = &got[..] else {
        panic!("{got:?}");
    };
    assert_eq!(kind(watching), "watching");
    assert_eq!(watching["data"]["session"]["session"], 1);
    assert_eq!(*snapshot, Got::Snapshot(1, size(80, 24)));
    // The old owner's copy no longer counts; it lets go of the window.
    hub.output(old, 0, "stale");
    hub.output(new, 0, "live");
    assert_eq!(
        hub.take(conn),
        [Got::Output(1, Bytes::from_static(b"live"))]
    );
    let [_, clear_vote, unsubscribe] = let_go_of_window_0();
    assert!(hub.lines(old).contains(&clear_vote) && hub.lines(old).contains(&unsubscribe));
    hub.advance(Duration::from_secs(16));
    assert!(hub.clients[&old].closed);
    assert!(!hub.clients[&new].closed);
}

#[test]
fn moving_a_sessions_last_window_rebinds_after_the_session_check() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    let old = hub.client(0);
    hub.take(conn);
    // The session dies with its last window: tmux sends %exit and the client ends.
    hub.sessions = BTreeSet::from([1]);
    hub.window(0).sessions = vec![1];
    hub.feed(old, "%exit\n");
    hub.exited(old);
    hub.settle();
    let got = hub.take(conn);
    let [Got::Json(closed), Got::Json(watching), snapshot] = &got[..] else {
        panic!("{got:?}");
    };
    assert_eq!(
        (kind(closed), kind(watching)),
        ("sessionClosed", "watching")
    );
    assert_eq!(closed["data"]["session"]["session"], 0);
    assert_eq!(watching["data"]["session"]["session"], 1);
    assert_eq!(*snapshot, Got::Snapshot(1, size(80, 24)));
    assert!(!hub.clients[&hub.client(1)].closed);
}

#[test]
fn a_detached_client_ends_its_watches_and_does_not_reattach() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    let client = hub.client(0);
    hub.take(conn);
    hub.feed(client, "%exit\n");
    hub.exited(client);
    hub.settle();
    assert_eq!(
        hub.take_json(conn),
        [json!({"type": "watchEnded", "data": {"watch": 1, "reason": "detached"}})]
    );
    assert_eq!(hub.clients.len(), 1, "nothing reattached");
}

#[test]
fn a_crashed_client_respawns_once_and_a_second_crash_ends_the_watch() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    let first = hub.client(0);
    hub.take(conn);
    hub.exited(first); // no %exit: a crash
    hub.settle();
    assert_eq!(hub.clients.len(), 1, "the respawn waits a second");
    assert!(hub.take(conn).is_empty());
    hub.advance(Duration::from_millis(1000));
    hub.settle();
    let second = hub.client(0);
    assert_ne!(first, second);
    // Same session and pane: no new `watching`, just the snapshot.
    assert_eq!(hub.take(conn), [Got::Snapshot(1, size(80, 24))]);
    hub.advance(Duration::from_secs(30));
    hub.exited(second);
    hub.settle();
    let json = hub.take_json(conn);
    assert_eq!(kinds(&json), ["watchEnded"]);
    assert_eq!(json[0]["data"]["reason"], "error");
}

#[test]
fn a_client_that_stops_answering_is_killed_as_a_crash() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    let client = hub.client(0);
    hub.send(
        conn,
        json!({"type": "input", "data": {"watch": 1, "items": [{"text": "x"}]}}),
    );
    hub.advance(Duration::from_secs(9));
    assert!(!hub.clients[&client].closed);
    hub.advance(Duration::from_secs(1));
    assert!(hub.clients[&client].closed);
    hub.settle();
    hub.advance(Duration::from_secs(1));
    hub.settle();
    assert_ne!(hub.client(0), client, "respawned like a crash");
}

#[test]
fn kill_server_broadcasts_server_exited_and_drops_everything() {
    let mut hub = Hub::new();
    let (conn, other) = (hub.connect(), hub.connect());
    hub.open(conn, 1, 0);
    let client = hub.client(0);
    hub.take(conn);
    hub.alive = false;
    hub.feed(client, "%exit\n");
    hub.exited(client);
    hub.settle();
    let expected = json!({"type": "serverExited", "data": {"server": SERVER_NAME}});
    assert_eq!(hub.take_json(conn), std::slice::from_ref(&expected));
    assert_eq!(hub.take_json(other), [expected]);
    // A tab from that server, watched again, closes at once.
    hub.watch(conn, 2, 0);
    hub.settle();
    assert_eq!(kinds(&hub.take_json(conn)), ["serverExited"]);
}

#[test]
fn a_killed_session_broadcasts_and_its_closed_window_too() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    let client = hub.client(0);
    hub.take(conn);
    hub.sessions.clear();
    hub.windows.clear();
    hub.feed(client, "%exit\n");
    hub.exited(client);
    hub.settle();
    assert_eq!(
        kinds(&hub.take_json(conn)),
        ["sessionClosed", "windowClosed"]
    );
}

#[test]
fn a_linked_window_counts_only_its_owners_output() {
    let mut hub = Hub::new();
    // @0 is linked into $0 and $1; @1 lives in $1 only.
    hub.add_window(1, 1, 1);
    hub.window(0).sessions = vec![0, 1];
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    hub.open(conn, 2, 1);
    let (owner, other) = (hub.client(0), hub.client(1));
    hub.take(conn);
    // $1's client sees @0's pane too, but doesn't want it: it pauses it.
    hub.output(other, 0, "copy");
    assert!(hub.take(conn).is_empty());
    assert_eq!(
        hub.clients[&other].unanswered.back(),
        Some(&command::pause(PaneId(0)).line)
    );
    hub.output(owner, 0, "real");
    assert_eq!(
        hub.take(conn),
        [Got::Output(1, Bytes::from_static(b"real"))]
    );
    // Its notifications about the window don't count either.
    hub.feed(
        other,
        "%layout-change @0 b25d,90x30,0,0,0 b25d,90x30,0,0,0 *\n",
    );
    hub.feed(other, "%window-pane-changed @0 %7\n");
    hub.output(owner, 0, "still live");
    assert_eq!(
        hub.take(conn),
        [Got::Output(1, Bytes::from_static(b"still live"))]
    );
}

#[test]
fn a_window_binds_only_from_its_owners_own_answer() {
    let mut hub = Hub::new();
    hub.add_window(1, 1, 1);
    hub.add_window(2, 1, 2);
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    hub.open(conn, 2, 1);
    let (first, owner) = (hub.client(0), hub.client(1));
    let other = hub.connect();
    hub.take(conn);
    // @2's Locate runs on $0's client, which answers with the pane as it is now…
    hub.watch(other, 1, 2);
    let answer = hub.reply_bytes(first).expect("a Locate on $0's client");
    assert!(answer.contains("\t%2\t"));
    // …but the owner reports a new active pane before that answer is read.
    hub.window(2).pane = 9;
    hub.feed(owner, "%window-pane-changed @2 %9\n");
    hub.feed(first, &answer);
    hub.settle();
    let watching = hub.take_json(other);
    assert_eq!(kinds(&watching), ["watching"]);
    assert_eq!(watching[0]["data"]["pane"], 9);
}

#[test]
fn output_past_the_credit_starves_one_watch_until_a_spaced_snapshot() {
    let mut hub = Hub::new();
    hub.add_window(1, 0, 1);
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    hub.open(conn, 2, 1);
    let client = hub.client(0);
    hub.take(conn);
    // Fill most of the credit with watch 1's output, nothing returned.
    let chunk = "x".repeat(60_000);
    let sent = (0..100)
        .take_while(|_| {
            hub.output(client, 0, &chunk);
            !hub.take(conn).is_empty()
        })
        .count();
    assert_eq!(
        sent as u64,
        (CREDIT - 2 * 64 - 2 * 200) / 60_000,
        "then it starved"
    );
    // Watch 1 starved; watch 2's output now fits only above watch 1's reservation.
    hub.output(client, 1, "y");
    assert!(hub.take(conn).is_empty(), "the waiting snapshot goes first");
    // It starves too. Credit back: both catch up, no sooner than the spacing.
    hub.credit(conn, CREDIT as u32);
    hub.settle();
    assert!(hub.take(conn).is_empty());
    hub.advance(Duration::from_millis(250));
    hub.settle();
    let got = hub.take(conn);
    assert!(got.contains(&Got::Snapshot(1, size(80, 24))), "{got:?}");
    assert!(got.contains(&Got::Snapshot(2, size(80, 24))), "{got:?}");
    hub.output(client, 1, "z");
    assert_eq!(hub.take(conn), [Got::Output(2, Bytes::from_static(b"z"))]);
}

#[test]
fn history_and_listings_need_a_capture_slot_and_credit() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    hub.take(conn);
    // Rows past 200 are cut.
    hub.send(
        conn,
        json!({"type": "history", "data": {"req": 3, "watch": 1, "start": -500, "end": 0}}),
    );
    let client = hub.client(0);
    assert_eq!(hub.lines(client).last(), Some(&capture_history(-500, -301)));
    hub.settle();
    let chunk = hub.take_json(conn);
    assert_eq!(kind(&chunk[0]), "historyChunk");
    assert_eq!(
        chunk[0]["data"]["lines"].as_array().map(Vec::len),
        Some(200)
    );
    // Rows that don't fit the reservation are left for the next request.
    hub.row_width = 5000;
    let history =
        json!({"type": "history", "data": {"req": 4, "watch": 1, "start": -199, "end": 0}});
    hub.send(conn, history.clone());
    hub.settle();
    let chunk = hub.take_json(conn);
    let rows = chunk[0]["data"]["lines"].as_array().map_or(0, Vec::len);
    assert!(rows > 0 && rows < 200, "{rows} rows");
    assert!(chunk[0].to_string().len() as u64 <= CAPTURE_RESERVATION);
    // Rows over tmux's reply cap are asked again by halves.
    hub.credit(conn, CREDIT as u32);
    hub.row_width = 6000;
    hub.send(conn, history.clone());
    hub.settle();
    assert!(
        hub.lines(client)
            .ends_with(&[capture_history(-199, 0), capture_history(-199, -100)])
    );
    let chunk = hub.take_json(conn);
    assert_eq!(
        chunk[0]["data"]["lines"].as_array().map(Vec::len),
        Some(100)
    );
    // Down to one row, which fails if it still doesn't fit.
    hub.credit(conn, CREDIT as u32);
    hub.row_width = 800_000;
    let one = json!({"type": "history", "data": {"req": 9, "watch": 1, "start": -1, "end": 0}});
    hub.send(conn, one);
    hub.settle();
    assert!(
        hub.lines(client)
            .ends_with(&[capture_history(-1, 0), capture_history(-1, -1)])
    );
    let refused = hub.take_json(conn);
    assert_eq!(refused[0]["data"]["code"], "tmux");
    assert_eq!(refused[0]["data"]["req"], 9);
    let listing = json!({"type": "listSessions", "data": {"req": 5}});
    hub.send(conn, listing.clone());
    hub.settle();
    let sessions = hub.take_json(conn);
    assert_eq!(
        sessions[0]["data"]["tmux"]["sessions"][0]["attachedElsewhere"],
        true
    );
    // Without credit for their reservations, both are refused.
    let flood = "z".repeat(60_000);
    for _ in 0..32 {
        hub.output(client, 0, &flood);
    }
    hub.take(conn);
    hub.send(conn, history);
    hub.send(conn, listing);
    let refused = hub.take_json(conn);
    assert_eq!(refused[0]["data"]["code"], "busy");
    assert_eq!(refused[0]["data"]["req"], 4);
    assert_eq!(refused[1]["data"]["code"], "busy");
    assert_eq!(refused[1]["data"]["req"], 5);
    // With no server, the sheet says so.
    hub.credit(conn, CREDIT as u32);
    hub.alive = false;
    hub.send(conn, json!({"type": "listSessions", "data": {"req": 6}}));
    hub.settle();
    let json = hub.take_json(conn);
    assert!(json.contains(&json!({"type": "sessions", "data": {"req": 6, "tmux": null}})));
}

#[test]
fn a_released_snapshot_holds_its_capture_slot_until_tmux_answers_it() {
    let mut hub = Hub::new();
    hub.add_window(1, 0, 1);
    hub.add_window(2, 0, 2);
    // One watch per connection, so credit never holds a capture back.
    let (conn, one, two) = (hub.connect(), hub.connect(), hub.connect());
    hub.open(conn, 1, 0);
    hub.open(one, 1, 1);
    hub.open(two, 1, 2);
    hub.take(conn);
    let client = hub.client(0);
    let snapshots = [snapshot(0), snapshot(1), snapshot(2)];
    let continues = |hub: &Hub| {
        let lines = hub.lines(client);
        lines.iter().filter(|line| snapshots.contains(line)).count()
    };
    let resync_both = |hub: &mut Hub| {
        hub.send(one, json!({"type": "resync", "data": {"watch": 1}}));
        hub.send(two, json!({"type": "resync", "data": {"watch": 1}}));
    };
    let before = continues(&hub);
    // A snapshot of %0 goes out; the tab closes before it lands.
    hub.send(conn, json!({"type": "resync", "data": {"watch": 1}}));
    hub.send(conn, json!({"type": "unwatch", "data": {"watch": 1}}));
    assert!(hub.lines(client).ends_with(&let_go_of_window_0()));
    // Until tmux answers it, the released snapshot holds one of the two slots.
    resync_both(&mut hub);
    assert_eq!(continues(&hub), before + 2);
    hub.settle();
    assert_eq!(continues(&hub), before + 3);
    assert_eq!(hub.take(one).last(), Some(&Got::Snapshot(1, size(80, 24))));
    assert_eq!(hub.take(two).last(), Some(&Got::Snapshot(1, size(80, 24))));
    assert!(hub.take(conn).is_empty(), "nothing for the released pane");
    // Answered `Released`, it gave the slot back: two captures fit again.
    resync_both(&mut hub);
    assert_eq!(continues(&hub), before + 5);
}

#[test]
fn user_requests_stop_at_the_threshold_and_maintenance_continues() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    let client = hub.client(0);
    hub.take(conn);
    for _ in 0..30 {
        hub.send(
            conn,
            json!({"type": "input", "data": {"watch": 1, "items": [{"text": "x"}]}}),
        );
    }
    let busy = hub
        .take_json(conn)
        .iter()
        .filter(|value| value["data"]["code"] == "busy")
        .count();
    assert_eq!(busy, 30 - 24, "inputs past 24 in flight are refused");
    // A resize still goes out.
    hub.send(
        conn,
        json!({"type": "resize", "data": {"watch": 1, "size": {"cols": 90, "rows": 30}}}),
    );
    assert_eq!(hub.clients[&client].unanswered.len(), 25);
    assert_eq!(hub.lines(client).last(), Some(&vote(0, 90, 30)));
}

#[test]
fn daemon_limits_end_or_refuse_what_is_over_them() {
    let mut hub = Hub::new();
    hub.add_window(1, 1, 1);
    hub.add_window(2, 2, 2);
    hub.add_window(3, 3, 3);
    let (a, b) = (hub.connect(), hub.connect());
    hub.open(a, 1, 0);
    hub.open(a, 2, 1);
    hub.watch(a, 3, 2);
    assert_eq!(
        hub.take_json(a).last().cloned(),
        Some(
            json!({"type": "watchEnded", "data": {"watch": 3, "reason": "error", "message": "too many tabs open at once (2)"}})
        )
    );
    // Three sessions' clients exist; a fourth session finds none lingering.
    hub.open(b, 1, 2);
    hub.take(b);
    hub.open(b, 2, 3);
    let ended = hub.take_json(b);
    assert_eq!(kinds(&ended), ["watchEnded"]);
    assert_eq!(
        ended[0]["data"]["message"],
        "too many tmux sessions open (3)"
    );
    // Once one lingers, it makes room.
    hub.send(b, json!({"type": "unwatch", "data": {"watch": 1}}));
    hub.settle();
    hub.open(b, 3, 3);
    assert!(kinds(&hub.take_json(b)).contains(&"watching"));
    // Input over 4 KiB is refused, and the watch stays.
    let text = "q".repeat(4097);
    hub.send(
        a,
        json!({"type": "input", "data": {"watch": 1, "items": [{"text": text}]}}),
    );
    let refused = hub.take_json(a);
    assert_eq!(
        refused.last().map(|value| value["data"]["code"].clone()),
        Some(json!("inputTooLarge"))
    );
}

#[test]
fn every_paste_path_removes_its_file() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    // Before `watching`: busy.
    hub.watch(conn, 1, 0);
    let file = hub.paste_file("/run/early");
    hub.input(Input::Conn(conn, FromConn::Paste { watch: 1, file }));
    assert_eq!(hub.removed, [PathBuf::from("/run/early")]);
    assert_eq!(
        hub.take_json(conn)
            .last()
            .map(|value| value["data"]["code"].clone()),
        Some(json!("busy"))
    );
    hub.settle();
    // Answered: removed on its reply.
    let file = hub.paste_file("/run/ok");
    hub.input(Input::Conn(conn, FromConn::Paste { watch: 1, file }));
    assert_eq!(hub.removed.len(), 1);
    hub.settle();
    assert_eq!(hub.removed.last(), Some(&PathBuf::from("/run/ok")));
    // In flight when its client ends.
    let file = hub.paste_file("/run/lost");
    hub.input(Input::Conn(conn, FromConn::Paste { watch: 1, file }));
    let client = hub.client(0);
    hub.exited(client);
    assert_eq!(hub.removed.last(), Some(&PathBuf::from("/run/lost")));
    // For an unknown watch, or a connection that has gone.
    let file = hub.paste_file("/run/unknown");
    hub.input(Input::Conn(conn, FromConn::Paste { watch: 9, file }));
    hub.input(Input::Conn(conn, FromConn::Closed));
    let file = hub.paste_file("/run/closed");
    hub.input(Input::Conn(conn, FromConn::Paste { watch: 1, file }));
    assert_eq!(
        hub.removed[3..],
        [PathBuf::from("/run/unknown"), PathBuf::from("/run/closed")]
    );
    assert_eq!(hub.slots.available_permits(), 4);
}

#[test]
fn control_json_past_the_overdraft_wedges_the_connection() {
    let mut hub = Hub::new();
    let (quiet, other) = (hub.connect(), hub.connect());
    hub.open(other, 1, 0);
    let client = hub.client(0);
    // `quiet` never returns credit; every rename is broadcast to it.
    let mut renames = 0;
    while !hub.dropped.contains(&quiet) {
        hub.feed(client, "%window-renamed @0 x\n");
        hub.credit(other, u32::MAX);
        renames += 1;
        assert!(renames < 40_000);
    }
    let rename = proto::ServerMsg::WindowRenamed {
        window: WindowRef {
            server: SERVER_NAME.into(),
            window: 0,
        },
        name: "x".into(),
    };
    let charge = rename.encode().len() as u64;
    // The first message past the credit plus the overdraft.
    assert_eq!(renames, (CREDIT + OVERDRAFT) / charge + 1);
    hub.take(quiet);
    hub.feed(client, "%window-renamed @0 y\n");
    assert!(
        hub.take(quiet).is_empty(),
        "a dropped connection gets nothing more"
    );
}

#[test]
fn new_windows_and_session_refs_from_another_server_run() {
    // A fresh hub has seen no server, so only tmux can refuse another run's session id,
    // which here names an unrelated session `$0`.
    let mut hub = Hub::new();
    let conn = hub.connect();
    let stale = SessionRef {
        server: "main:41-1".into(),
        session: 0,
    };
    hub.send(
        conn,
        json!({"type": "newWindow", "data": {"req": 1, "session": stale}}),
    );
    hub.settle();
    let json = hub.take_json(conn);
    assert_eq!(kinds(&json), ["serverExited", "error"]);
    assert_eq!(json[0]["data"]["server"], "main:41-1");
    assert_eq!(json[1]["data"]["code"], "noServer");
    assert!(
        !hub.windows.contains_key(&9),
        "nothing created on the new server"
    );
    let session = SessionRef {
        server: SERVER_NAME.into(),
        session: 0,
    };
    hub.send(
        conn,
        json!({"type": "newWindow", "data": {"req": 2, "session": session}}),
    );
    hub.settle();
    assert_eq!(
        hub.take_json(conn),
        [
            json!({"type": "created", "data": {"req": 2, "window": {"server": SERVER_NAME, "window": 9}, "session": {"server": SERVER_NAME, "session": 0}}})
        ]
    );
}

#[test]
fn a_closed_connection_and_an_exited_client_let_go_of_their_channels() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    let client = hub.client(0);
    hub.input(Input::Conn(conn, FromConn::Closed));
    assert!(
        hub.dropped.contains(&conn),
        "the executor drops its channel"
    );
    // tmux ended the lingering client on its own, not the hub.
    let stderr_tail = String::new();
    hub.input(Input::Pump(client, PumpMsg::Exited { stderr_tail }));
    assert!(
        hub.clients[&client].closed,
        "the executor drops its line channel"
    );
}

#[test]
fn output_past_the_spacing_deadline_stands_in_for_the_tick() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    let client = hub.client(0);
    hub.take(conn);
    let starve = |hub: &mut Hub| {
        let chunk = "x".repeat(60_000);
        for _ in 0..100 {
            hub.output(client, 0, &chunk);
            if hub.take(conn).is_empty() {
                return;
            }
        }
        panic!("never starved");
    };
    // Past the spacing with no credit to snapshot on: the deadline is spent, not
    // reported again and again.
    starve(&mut hub);
    hub.now += SNAPSHOT_SPACING + Duration::from_millis(1);
    hub.output(client, 0, "late");
    hub.settle();
    assert!(hub.take(conn).is_empty());
    assert_eq!(hub.state.next_deadline(), None);
    hub.credit(conn, CREDIT as u32);
    hub.settle();
    assert_eq!(hub.take(conn), [Got::Snapshot(1, size(80, 24))]);
    // Credit back within the spacing: the snapshot waits for its deadline, and the
    // output that comes first, not a Tick, takes it.
    hub.credit(conn, CREDIT as u32);
    starve(&mut hub);
    hub.credit(conn, CREDIT as u32);
    hub.settle();
    assert!(hub.take(conn).is_empty());
    assert_eq!(hub.state.next_deadline(), Some(hub.now + SNAPSHOT_SPACING));
    hub.now += SNAPSHOT_SPACING + Duration::from_millis(1);
    hub.output(client, 0, "late");
    hub.settle();
    assert_eq!(hub.take(conn), [Got::Snapshot(1, size(80, 24))]);
}
