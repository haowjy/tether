//! A daemon on a loopback port for the HTTP tests: its own state directory, `$HOME`
//! and `config.toml` under one temp directory, removed on drop. No tmux server is ever
//! asked for. Requests are written by hand, one per connection.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use tether::auth::{Auth, Store};
use tether::blocking::Lanes;
use tether::complete;
use tether::config::ConfigFile;
use tether::http::{self, App};
use tether::hub::{self, Endpoints};
use tether::proto::HostInfo;
use tether::tmux::{Endpoint, Socket};
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::{TcpListener, TcpStream};

pub const LOGIN: &str = "jimmy@github";
pub const WAIT: Duration = Duration::from_secs(5);

pub struct Daemon {
    pub port: u16,
    pub store: Store,
    pub dir: PathBuf,
    /// Canonical.
    pub home: PathBuf,
    pub config: PathBuf,
}

impl Drop for Daemon {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

impl Daemon {
    /// Enrolls a device: the headers that pass both checks.
    pub fn device(&self) -> Vec<(String, String)> {
        let added = self
            .store
            .add_device("phone", SystemTime::now())
            .expect("a device");
        vec![
            ("Tailscale-User-Login".to_owned(), LOGIN.to_owned()),
            (
                "Authorization".to_owned(),
                format!("Bearer {}", added.token),
            ),
        ]
    }

    /// `relative` under `$HOME`.
    pub fn home(&self, relative: &str) -> PathBuf {
        self.home.join(relative)
    }
}

pub async fn start(name: &str) -> Daemon {
    let dir = std::env::temp_dir().join(format!("tether-http-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let store = Store::open(dir.join("state")).expect("a state dir");
    let paste_dir = dir.join("paste");
    std::fs::create_dir_all(&paste_dir).expect("a paste dir");
    let home = dir.join("home");
    std::fs::create_dir_all(&home).expect("a home");
    let home = std::fs::canonicalize(home).expect("canonical");
    let config = dir.join("config.toml");
    std::fs::write(&config, "").expect("a config");
    let endpoint = Endpoint {
        program: PathBuf::from("tmux"),
        socket: Socket::Name(format!("tether-http-test-{}", std::process::id())),
    };
    let (hub, _task) = hub::spawn(Endpoints { main: endpoint });
    let lanes = Lanes::default();
    let app = App {
        auth: Auth::new(store.clone(), vec![LOGIN.to_owned()], lanes.auth.clone()),
        hub,
        host: HostInfo {
            id: store.host_id().expect("a host id"),
            name: "test".to_owned(),
        },
        paste_dir,
        config: ConfigFile::resolve(Some(&config)).expect("a config path"),
        // No history, no PATH, no carapace: only paths complete.
        complete: complete::Settings::new(
            &Default::default(),
            complete::Environment {
                home: home.clone(),
                ..Default::default()
            },
        ),
        home: home.clone(),
        lanes,
    };
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("a port");
    let port = listener.local_addr().expect("an address").port();
    tokio::spawn(http::serve(listener, app, std::future::pending()));
    Daemon {
        port,
        store,
        dir,
        home,
        config,
    }
}

pub struct Reply {
    pub status: u16,
    /// The status line and headers.
    pub head: String,
    pub body: Vec<u8>,
}

impl Reply {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.head.lines().skip(1).find_map(|line| {
            let (key, value) = line.split_once(':')?;
            key.eq_ignore_ascii_case(name).then(|| value.trim())
        })
    }

    pub fn text(&self) -> &str {
        std::str::from_utf8(&self.body).expect("UTF-8")
    }

    pub fn json(&self) -> serde_json::Value {
        serde_json::from_slice(&self.body).expect("JSON")
    }
}

/// One HTTP/1.1 request, read to the end.
pub async fn send(
    port: u16,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: &[u8],
) -> Reply {
    let mut stream = TcpStream::connect(("127.0.0.1", port))
        .await
        .expect("connected");
    let mut head = format!("{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n");
    for (name, value) in headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    if !body.is_empty() || method == "POST" {
        head.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes()).await.expect("sent");
    stream.write_all(body).await.expect("sent");
    let mut response = Vec::new();
    tokio::time::timeout(WAIT, stream.read_to_end(&mut response))
        .await
        .expect("an answer in time")
        .expect("read");
    let split = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .expect("a head");
    let head = String::from_utf8(response[..split].to_vec()).expect("an ASCII head");
    let status = head[9..12].parse().expect("a status");
    Reply {
        status,
        head,
        body: response[split + 4..].to_vec(),
    }
}

/// A JSON request (or none, with an empty body): the status and the body as text.
pub async fn request(
    port: u16,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: &str,
) -> (u16, String) {
    let mut headers = headers.to_vec();
    if !body.is_empty() {
        headers.push(("Content-Type", "application/json"));
    }
    let reply = send(port, method, path, &headers, body.as_bytes()).await;
    let text = String::from_utf8_lossy(&reply.body).into_owned();
    (reply.status, text)
}

/// `path` with each segment percent-encoded where needed, as the client sends it.
pub fn url(route: &str, path: &Path) -> String {
    let mut url = route.to_owned();
    for (i, segment) in path.to_str().expect("UTF-8").split('/').skip(1).enumerate() {
        if i > 0 {
            url.push('/');
        }
        for byte in segment.bytes() {
            if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
                url.push(char::from(byte));
            } else {
                url.push_str(&format!("%{byte:02X}"));
            }
        }
    }
    url
}
