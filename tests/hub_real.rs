//! The hub against a real tmux (daemon-core.md §8): `hub::spawn` with real pumps and
//! one-shots on a private server, and a connection that does what `http/` will, minus
//! the socket: it moves every `ToConn` through an `Outbox`, decodes the frames and
//! returns the credit. Runs only with `TETHER_TMUX_TESTS=1`, one test at a time;
//! `TETHER_TMUX` picks the tmux binary.

#[path = "support/tmux_server.rs"]
mod tmux_server;

use std::time::{Duration, Instant};

use bytes::Bytes;
use serde_json::{Value, json};
use tether::budget::DEFAULT_CAPS;
use tether::hub::{self, ConnId, Endpoints, FromConn, HubHandle, Next, Outbox, ToConn};
use tether::proto::frames::{self, Frame as Binary};
use tether::proto::{ClientMsg, Size};
use tokio::sync::mpsc;

use tmux_server::{Server, setup};

const WAIT: Duration = Duration::from_secs(10);

/// `"main:<pid>-<start_time>"` for the server.
fn server_name(server: &Server) -> String {
    let instance = server
        .run(&["display-message", "-p", "#{pid}-#{start_time}"])
        .expect("the server instance");
    format!("main:{}", instance.trim())
}

/// What the connection received, decoded from the frames it would have written.
#[derive(Debug, Clone)]
enum Got {
    Json(Value),
    Output(u32, Bytes),
    Snapshot(u32, Size, Bytes),
}

struct Conn {
    hub: HubHandle,
    id: ConnId,
    channel: mpsc::Receiver<ToConn>,
    outbox: Outbox,
    got: Vec<Got>,
}

impl Conn {
    async fn open(hub: &HubHandle) -> Self {
        let (id, channel) = hub.connect().await.expect("the hub is running");
        Self {
            hub: hub.clone(),
            id,
            channel,
            outbox: Outbox::new(),
            got: Vec::new(),
        }
    }

    async fn send(&mut self, msg: Value) {
        let msg: ClientMsg = serde_json::from_value(msg).expect("a client message");
        if let ClientMsg::Unwatch { watch } = msg {
            self.outbox.unwatch(watch);
        }
        let sent = self.hub.send(self.id, FromConn::Client(msg)).await;
        sent.expect("the hub is running");
    }

    async fn watch(&mut self, watch: u32, server: &str, window: u32) {
        let size = json!({"cols": 80, "rows": 24});
        let window = json!({"server": server, "window": window});
        let msg =
            json!({"type": "watch", "data": {"watch": watch, "window": window, "size": size}});
        self.send(msg).await;
    }

    async fn input(&mut self, watch: u32, text: &str) {
        let items = json!([{"text": text}, {"key": "Enter"}]);
        self.send(json!({"type": "input", "data": {"watch": watch, "items": items}}))
            .await;
    }

    /// Takes the next message into the outbox and writes out everything due,
    /// returning the credit; false if nothing came within `wait`.
    async fn next(&mut self, wait: Duration) -> bool {
        let Ok(Some(msg)) = tokio::time::timeout(wait, self.channel.recv()).await else {
            return false;
        };
        self.outbox.push(msg);
        loop {
            match self.outbox.next(Instant::now()) {
                Next::Frame { frame, charge } => {
                    self.got.push(decode(frame));
                    self.outbox.written(charge);
                }
                Next::WaitUntil(at) => tokio::time::sleep_until(at.into()).await,
                Next::Idle => break,
            }
        }
        let bytes = self.outbox.take_credit();
        if bytes > 0 {
            let credit = FromConn::Credit { bytes };
            self.hub
                .send(self.id, credit)
                .await
                .expect("the hub is running");
        }
        true
    }

    /// Receives until `found` matches something received from `start` on.
    async fn wait_from(&mut self, start: usize, what: &str, found: impl Fn(&Got) -> bool) -> Got {
        let deadline = Instant::now() + WAIT;
        loop {
            if let Some(got) = self.got[start..].iter().find(|got| found(got)) {
                return got.clone();
            }
            let left = deadline.saturating_duration_since(Instant::now());
            assert!(
                !left.is_zero(),
                "no {what} within {WAIT:?}; got {:?}",
                self.got
            );
            self.next(left).await;
        }
    }

    async fn wait_json(
        &mut self,
        start: usize,
        kind: &str,
        found: impl Fn(&Value) -> bool,
    ) -> Value {
        let got = self
            .wait_from(
                start,
                kind,
                |got| matches!(got, Got::Json(value) if value["type"] == kind && found(value)),
            )
            .await;
        match got {
            Got::Json(value) => value,
            other => panic!("{other:?}"),
        }
    }

    async fn wait_snapshot(&mut self, start: usize, watch: u32) -> (Size, Bytes) {
        let got = self
            .wait_from(
                start,
                "a snapshot",
                |got| matches!(got, Got::Snapshot(of, ..) if *of == watch),
            )
            .await;
        match got {
            Got::Snapshot(_, size, restore) => (size, restore),
            other => panic!("{other:?}"),
        }
    }

    /// Receives until the watch's output from `start` on contains `needle`.
    async fn wait_output(&mut self, start: usize, watch: u32, needle: &str) {
        let deadline = Instant::now() + WAIT;
        loop {
            let output: Vec<u8> = self.got[start..]
                .iter()
                .filter_map(|got| match got {
                    Got::Output(of, bytes) if *of == watch => Some(bytes.to_vec()),
                    _ => None,
                })
                .flatten()
                .collect();
            if contains(&output, needle) {
                return;
            }
            let left = deadline.saturating_duration_since(Instant::now());
            assert!(!left.is_zero(), "no {needle:?} within {WAIT:?}");
            self.next(left).await;
        }
    }
}

fn decode(frame: hub::Frame) -> Got {
    match frame {
        hub::Frame::Text(text) => Got::Json(serde_json::from_str(&text).expect("JSON")),
        hub::Frame::Binary(bytes) => match frames::decode(&bytes).expect("a frame") {
            Binary::Output { watch, bytes } => Got::Output(watch, bytes),
            Binary::Snapshot {
                watch,
                size,
                restore,
            } => Got::Snapshot(watch, size, restore),
        },
    }
}

fn contains(haystack: &[u8], needle: &str) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle.as_bytes())
}

fn start(server: &Server) -> HubHandle {
    let (hub, _task) = hub::spawn(
        Endpoints {
            main: server.endpoint(),
        },
        DEFAULT_CAPS.control_clients,
        "test-host".to_owned(),
    );
    hub
}

#[tokio::test]
async fn a_watch_echoes_input_and_a_rewatch_snapshots_what_it_showed() {
    let Some((_serial, server)) = setup("echo").await else {
        return;
    };
    let name = server_name(&server);
    let hub = start(&server);
    let mut conn = Conn::open(&hub).await;
    conn.watch(1, &name, 0).await;
    let watching = conn.wait_json(0, "watching", |_| true).await;
    assert_eq!(watching["data"]["session"]["session"], 0);
    assert_eq!(watching["data"]["pane"], 0);
    let (size, _) = conn.wait_snapshot(0, 1).await;
    assert_eq!(size, Size { cols: 80, rows: 24 });
    // The cwd subscription reports within about a second.
    let temp = std::fs::canonicalize("/tmp")
        .expect("canonical temporary directory")
        .to_string_lossy()
        .into_owned();
    conn.wait_json(0, "watching", |value| value["data"]["cwd"] == temp)
        .await;

    let mark = conn.got.len();
    conn.input(1, "echo tether-$((6*7))").await;
    conn.wait_output(mark, 1, "tether-42").await;

    conn.send(json!({"type": "unwatch", "data": {"watch": 1}}))
        .await;
    let mark = conn.got.len();
    conn.watch(2, &name, 0).await;
    conn.wait_json(mark, "watching", |value| value["data"]["watch"] == 2)
        .await;
    let (_, restore) = conn.wait_snapshot(mark, 2).await;
    assert!(
        contains(&restore, "tether-42"),
        "the snapshot shows the echo"
    );
}

#[tokio::test]
async fn a_moved_window_rehomes_its_watch_and_a_closed_one_is_broadcast() {
    let Some((_serial, server)) = setup("move").await else {
        return;
    };
    let name = server_name(&server);
    server
        .run(&["new-window", "-d", "-t", tmux_server::SESSION])
        .expect("a second window");
    server
        .run(&["new-session", "-d", "-s", "other", "-x", "80", "-y", "24"])
        .expect("a second session");
    let other = server
        .run(&["display-message", "-p", "-t", "other", "#{session_id}"])
        .expect("its id");
    let other: u32 = other.trim().trim_start_matches('$').parse().expect("an id");
    let hub = start(&server);
    let mut conn = Conn::open(&hub).await;
    conn.watch(1, &name, 1).await;
    conn.wait_json(0, "watching", |value| {
        value["data"]["session"]["session"] == 0
    })
    .await;
    conn.wait_snapshot(0, 1).await;

    let mark = conn.got.len();
    server
        .run(&["move-window", "-s", "@1", "-t", "other:"])
        .expect("move the window");
    conn.wait_json(mark, "watching", |value| {
        value["data"]["session"]["session"] == other
    })
    .await;
    conn.wait_snapshot(mark, 1).await;
    // Output now comes from the new owner.
    let mark = conn.got.len();
    conn.input(1, "echo moved-$((2+2))").await;
    conn.wait_output(mark, 1, "moved-4").await;

    let mark = conn.got.len();
    server
        .run(&["kill-window", "-t", "@1"])
        .expect("kill the window");
    conn.wait_json(mark, "windowClosed", |value| {
        value["data"]["window"] == json!({"server": name, "window": 1})
    })
    .await;
}

#[tokio::test]
async fn new_windows_and_sessions_reach_the_window_list() {
    let Some((_serial, server)) = setup("new-window-list").await else {
        return;
    };
    let name = server_name(&server);
    let hub = start(&server);
    let mut conn = Conn::open(&hub).await;
    conn.watch(1, &name, 0).await;
    conn.wait_json(0, "watching", |_| true).await;
    conn.wait_snapshot(0, 1).await;

    for (args, label) in [
        (
            &["new-window", "-d", "-t", tmux_server::SESSION][..],
            "detached window",
        ),
        (
            &["new-window", "-t", tmux_server::SESSION][..],
            "foreground window",
        ),
        (
            &["new-session", "-d", "-s", "other", "-x", "80", "-y", "24"][..],
            "detached session",
        ),
    ] {
        let mark = conn.got.len();
        server
            .run(args)
            .unwrap_or_else(|_| panic!("create {label}"));
        conn.wait_json(mark, "sessionsChanged", |_| true).await;
    }
}

#[tokio::test]
async fn kill_server_closes_every_tab_on_it() {
    let Some((_serial, server)) = setup("kill").await else {
        return;
    };
    let name = server_name(&server);
    let hub = start(&server);
    let (mut conn, mut idle) = (Conn::open(&hub).await, Conn::open(&hub).await);
    conn.watch(1, &name, 0).await;
    conn.wait_snapshot(0, 1).await;
    server.run(&["kill-server"]).expect("kill the server");
    conn.wait_json(0, "serverExited", |value| value["data"]["server"] == name)
        .await;
    idle.wait_json(0, "serverExited", |value| value["data"]["server"] == name)
        .await;
    // The tab's server is gone for good: watching it again closes it at once.
    let mark = conn.got.len();
    conn.watch(2, &name, 0).await;
    conn.wait_json(mark, "serverExited", |_| true).await;
}
