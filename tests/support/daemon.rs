//! A daemon on private Unix sockets for the HTTP tests. A loopback relay gives legacy
//! native-route tests an easy client while preserving the daemon's `local.sock` front.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use bytes::Bytes;
use http_body_util::{BodyExt as _, Full};
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use tether::auth::MacFront;
use tether::auth::identity::ServeTarget;
use tether::auth::localapi::LocalApi;
use tether::auth::{Auth, Store};
use tether::blocking::Lanes;
use tether::budget::DEFAULT_CAPS;
use tether::complete;
use tether::config::ConfigFile;
use tether::http::{self, App, Front, Listener};
use tether::hub::{self, Endpoints};
use tether::proto::HostInfo;
use tether::tmux::{Endpoint, Socket};
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::{TcpListener, TcpStream, UnixListener, UnixStream};
use tokio::sync::Notify;
use tokio::task::JoinHandle;

pub const LOGIN: &str = "jimmy@github";
pub const WAIT: Duration = Duration::from_secs(5);
pub const LOOPBACK_SECRET: &str = "tether-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const FAKE_LOCALAPI_TOKEN: &str = "fake-localapi-token";

pub struct Daemon {
    /// Test relay to `local.sock` for native clients.
    pub port: u16,
    /// Test relay to `serve.sock` for Serve-header acceptance checks.
    pub serve_port: u16,
    pub store: Store,
    pub dir: PathBuf,
    /// Canonical.
    pub home: PathBuf,
    pub config: PathBuf,
    pub serve_socket: PathBuf,
    pub local_socket: PathBuf,
    server: JoinHandle<std::io::Result<()>>,
    proxy: JoinHandle<()>,
    serve_proxy: JoinHandle<()>,
    fake_api: JoinHandle<()>,
    pub fake: FakeLocalApi,
}

#[derive(Clone, Default)]
pub struct FakeLocalApi {
    pub whois_available: Arc<AtomicBool>,
    pub whois_answer: Arc<Mutex<serde_json::Value>>,
    pub status_answer: Arc<Mutex<serde_json::Value>>,
    pub serve_config: Arc<Mutex<serde_json::Value>>,
    pub whois_calls: Arc<AtomicUsize>,
    pub whois_queries: Arc<Mutex<Vec<String>>>,
    pub hold_whois: Arc<AtomicBool>,
    pub release_whois: Arc<Notify>,
    pub whois_delay: Arc<Mutex<Duration>>,
    pub expected_authorization: Arc<Mutex<Option<String>>>,
    pub serve_etag: Arc<AtomicUsize>,
    pub conflict_next_serve_write: Arc<AtomicBool>,
}

impl FakeLocalApi {
    pub fn allow_whois(&self, allowed: bool) {
        self.whois_available.store(allowed, Ordering::SeqCst);
    }

    pub fn set_whois_answer(&self, answer: serde_json::Value) {
        *self.whois_answer.lock().expect("whois answer lock") = answer;
    }

    pub fn set_status_answer(&self, answer: serde_json::Value) {
        *self.status_answer.lock().expect("status answer lock") = answer;
    }

    pub fn set_serve_config(&self, config: serde_json::Value) {
        *self.serve_config.lock().expect("serve config lock") = config;
    }

    pub fn hold_whois(&self, hold: bool) {
        self.hold_whois.store(hold, Ordering::SeqCst);
    }

    pub fn release_whois(&self) {
        self.hold_whois(false);
        self.release_whois.notify_waiters();
    }

    pub fn set_whois_delay(&self, delay: Duration) {
        *self.whois_delay.lock().expect("whois delay lock") = delay;
    }
}

impl Drop for Daemon {
    fn drop(&mut self) {
        self.server.abort();
        self.proxy.abort();
        self.serve_proxy.abort();
        self.fake_api.abort();
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
    start_with_fake(name, false, false, true).await
}

pub async fn start_with_fake(
    name: &str,
    extra_handler: bool,
    tcp_forward: bool,
    whois_available: bool,
) -> Daemon {
    start_as(name, LOGIN, extra_handler, tcp_forward, whois_available).await
}

pub async fn start_as(
    name: &str,
    login: &str,
    extra_handler: bool,
    tcp_forward: bool,
    whois_available: bool,
) -> Daemon {
    start_as_with_allowlist(
        name,
        login,
        extra_handler,
        tcp_forward,
        whois_available,
        true,
    )
    .await
}

/// Starts the production default-allowlist path, where the owner's login comes from
/// the tailnet-state cell instead of `--allow-login`.
pub async fn start_without_allow_login(name: &str) -> Daemon {
    start_as_with_allowlist(name, LOGIN, false, false, true, false).await
}

/// Starts the Mac Loopback front against a TCP fake LocalAPI that requires Basic auth.
pub async fn start_loopback(name: &str) -> Daemon {
    start_loopback_with_serve_config(
        name,
        serde_json::json!({
            "UnknownRoot": { "keep": true }
        }),
    )
    .await
}

/// Starts a Loopback front with the given initial Serve-config response.
pub async fn start_loopback_with_serve_config(
    name: &str,
    initial_serve_config: serde_json::Value,
) -> Daemon {
    use base64::Engine as _;

    let dir = std::env::temp_dir().join(format!("tether-http-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let store = Store::open(dir.join("state")).expect("a state dir");
    let serve_socket = dir.join("serve.sock");
    let local_socket = dir.join("local.sock");
    let front_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("front listener");
    let front_port = front_listener.local_addr().expect("front address").port();
    let local_listener = UnixListener::bind(&local_socket).expect("local socket");
    let fake_api_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("fake LocalAPI listener");
    let fake_api_address = fake_api_listener
        .local_addr()
        .expect("fake LocalAPI address");
    let fake = FakeLocalApi {
        whois_available: Arc::new(AtomicBool::new(true)),
        whois_answer: Arc::new(Mutex::new(serde_json::json!({
            "Node": {
                "StableID": "nLAPTOP0123456789CNTRL",
                "Tags": [],
                "Sharer": 0,
                "Addresses": ["100.101.102.103/32"],
                "AllowedIPs": ["100.101.102.103/32"],
                "DNSName": "laptop.ts.net."
            },
            "UserProfile": { "LoginName": LOGIN }
        }))),
        status_answer: Arc::new(Mutex::new(serde_json::json!({
            "BackendState": "Running",
            "Self": {
                "ID": "nSELF0123456789CNTRL",
                "UserID": 1,
                "DNSName": "devbox.ts.net."
            },
            "User": { "1": { "LoginName": LOGIN } },
            "Peer": {}
        }))),
        serve_config: Arc::new(Mutex::new(initial_serve_config)),
        conflict_next_serve_write: Arc::new(AtomicBool::new(true)),
        expected_authorization: Arc::new(Mutex::new(Some(format!(
            "Basic {}",
            base64::engine::general_purpose::STANDARD.encode(format!(":{FAKE_LOCALAPI_TOKEN}"))
        )))),
        ..FakeLocalApi::default()
    };
    let fake_api = tokio::spawn(serve_fake_localapi_tcp(fake_api_listener, fake.clone()));

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
    let (hub, _task) = hub::spawn(
        Endpoints { main: endpoint },
        DEFAULT_CAPS.control_clients,
        "test".to_owned(),
    );
    let lanes = Lanes::default();
    let api = LocalApi::at_tcp(fake_api_address, FAKE_LOCALAPI_TOKEN);
    let (target, publication, gate) = MacFront::new(front_port, LOOPBACK_SECRET).into_parts();
    let auth = Auth::with_local_api(
        store.clone(),
        vec![LOGIN.to_owned()],
        lanes.auth.clone(),
        api,
        Some(target),
        Some(publication),
    );
    let app = App {
        auth,
        hub,
        host: HostInfo {
            id: store.host_id().expect("a host id"),
            name: "test".to_owned(),
        },
        paste_dir,
        config: ConfigFile::resolve(Some(&config)).expect("a config path"),
        complete: complete::Settings::new(
            &Default::default(),
            complete::Environment {
                home: home.clone(),
                ..Default::default()
            },
        ),
        caps: DEFAULT_CAPS,
        home: home.clone(),
        lanes,
    };
    let server = tokio::spawn(http::serve(
        vec![
            (Listener::Tcp(front_listener), gate),
            (Listener::Unix(local_listener), Front::Local),
        ],
        app,
        std::future::pending(),
    ));
    let local_relay = TcpListener::bind("127.0.0.1:0").await.expect("local relay");
    let local_port = local_relay
        .local_addr()
        .expect("local relay address")
        .port();
    let proxy = tokio::spawn(relay_local(local_relay, local_socket.clone()));
    let serve_proxy = tokio::spawn(async {});
    Daemon {
        port: local_port,
        serve_port: front_port,
        store,
        dir,
        home,
        config,
        serve_socket,
        local_socket,
        server,
        proxy,
        serve_proxy,
        fake_api,
        fake,
    }
}

async fn start_as_with_allowlist(
    name: &str,
    login: &str,
    extra_handler: bool,
    tcp_forward: bool,
    whois_available: bool,
    explicit_allowlist: bool,
) -> Daemon {
    let dir = std::env::temp_dir().join(format!("tether-http-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let store = Store::open(dir.join("state")).expect("a state dir");
    let serve_socket = dir.join("serve.sock");
    let local_socket = dir.join("local.sock");
    let api_socket = dir.join("tailscaled.sock");
    let serve_listener = UnixListener::bind(&serve_socket).expect("serve socket");
    let local_listener = UnixListener::bind(&local_socket).expect("local socket");
    let fake_api_listener = UnixListener::bind(&api_socket).expect("fake LocalAPI socket");
    let mut serve_config = serde_json::json!({
        "Web": {
            "devbox.ts.net:443": {
                "HTTPS": true,
                "Handlers": {
                    "/": { "Proxy": format!("unix:{}", serve_socket.display()) }
                }
            }
        },
        "AllowFunnel": { "devbox.ts.net:443": false }
    });
    if extra_handler {
        serve_config["Web"]["devbox.ts.net:443"]["Handlers"]["/grafana"] =
            serde_json::json!({ "Proxy": "http://127.0.0.1:3000" });
    }
    if tcp_forward {
        serve_config["TCP"] = serde_json::json!({
            "2222": { "TCPForward": format!("unix:{}", serve_socket.display()) }
        });
    }
    let fake = FakeLocalApi {
        whois_available: Arc::new(AtomicBool::new(whois_available)),
        whois_answer: Arc::new(Mutex::new(serde_json::json!({
            "Node": {
                "StableID": "nLAPTOP0123456789CNTRL",
                "Tags": [],
                "Sharer": 0,
                "Addresses": ["100.101.102.103/32"],
                "AllowedIPs": ["100.101.102.103/32"],
                "DNSName": "laptop.ts.net."
            },
            "UserProfile": { "LoginName": login }
        }))),
        status_answer: Arc::new(Mutex::new(serde_json::json!({
            "BackendState": "Running",
            "Self": {
                "ID": "nSELF0123456789CNTRL",
                "UserID": 1,
                "DNSName": "devbox.ts.net."
            },
            "User": { "1": { "LoginName": login } },
            "Peer": {}
        }))),
        serve_config: Arc::new(Mutex::new(serve_config)),
        whois_calls: Arc::new(AtomicUsize::new(0)),
        whois_queries: Arc::new(Mutex::new(Vec::new())),
        hold_whois: Arc::new(AtomicBool::new(false)),
        release_whois: Arc::new(Notify::new()),
        whois_delay: Arc::new(Mutex::new(Duration::ZERO)),
        expected_authorization: Arc::new(Mutex::new(None)),
        serve_etag: Arc::new(AtomicUsize::new(0)),
        conflict_next_serve_write: Arc::new(AtomicBool::new(false)),
    };
    let fake_api = tokio::spawn(serve_fake_localapi(fake_api_listener, fake.clone()));

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
    let (hub, _task) = hub::spawn(
        Endpoints { main: endpoint },
        DEFAULT_CAPS.control_clients,
        "test".to_owned(),
    );
    let lanes = Lanes::default();
    let app = App {
        auth: Auth::with_local_api(
            store.clone(),
            if explicit_allowlist {
                vec![login.to_owned()]
            } else {
                Vec::new()
            },
            lanes.auth.clone(),
            LocalApi::at(api_socket),
            Some(ServeTarget::unix(serve_socket.clone()).expect("serve socket identity")),
            None,
        ),
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
        caps: DEFAULT_CAPS,
        home: home.clone(),
        lanes,
    };
    let server = tokio::spawn(http::serve(
        vec![
            (Listener::Unix(serve_listener), Front::UnixServe),
            (Listener::Unix(local_listener), Front::Local),
        ],
        app,
        std::future::pending(),
    ));
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("a port");
    let port = listener.local_addr().expect("an address").port();
    let proxy = tokio::spawn(relay_local(listener, local_socket.clone()));
    let serve_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("a Serve test port");
    let serve_port = serve_listener.local_addr().expect("an address").port();
    let serve_proxy = tokio::spawn(relay_local(serve_listener, serve_socket.clone()));
    Daemon {
        port,
        serve_port,
        store,
        dir,
        home,
        config,
        serve_socket,
        local_socket,
        server,
        proxy,
        serve_proxy,
        fake_api,
        fake,
    }
}

async fn relay_local(listener: TcpListener, socket: PathBuf) {
    loop {
        let Ok((mut tcp, _)) = listener.accept().await else {
            break;
        };
        let socket = socket.clone();
        tokio::spawn(async move {
            let Ok(mut unix) = UnixStream::connect(socket).await else {
                return;
            };
            let _ = tokio::io::copy_bidirectional(&mut tcp, &mut unix).await;
        });
    }
}

async fn serve_fake_localapi(listener: UnixListener, fake: FakeLocalApi) {
    loop {
        let Ok((stream, _)) = listener.accept().await else {
            break;
        };
        let fake = fake.clone();
        tokio::spawn(serve_fake_localapi_connection(stream, fake));
    }
}

async fn serve_fake_localapi_tcp(listener: TcpListener, fake: FakeLocalApi) {
    loop {
        let Ok((stream, _)) = listener.accept().await else {
            break;
        };
        tokio::spawn(serve_fake_localapi_connection(stream, fake.clone()));
    }
}

async fn serve_fake_localapi_connection<S>(stream: S, fake: FakeLocalApi)
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let service = service_fn(move |request: Request<Incoming>| {
        let fake = fake.clone();
        async move {
            let expected = fake
                .expected_authorization
                .lock()
                .expect("expected authorization")
                .clone();
            let authorized = expected.as_ref().is_none_or(|expected| {
                request
                    .headers()
                    .get("authorization")
                    .and_then(|value| value.to_str().ok())
                    == Some(expected.as_str())
            });
            let path = request.uri().path().to_owned();
            let method = request.method().clone();
            let (status, answer) = if !authorized {
                (401, serde_json::json!({}))
            } else if method == "POST" && path == "/localapi/v0/serve-config" {
                let revision = fake.serve_etag.load(Ordering::SeqCst);
                let current = format!("\"fake-{revision}\"");
                let matches = request
                    .headers()
                    .get("if-match")
                    .and_then(|value| value.to_str().ok())
                    == Some(current.as_str());
                if !matches {
                    (412, serde_json::json!({ "Error": "etag mismatch" }))
                } else if fake.conflict_next_serve_write.swap(false, Ordering::SeqCst) {
                    let mut config = fake.serve_config.lock().expect("Serve config");
                    if let Some(config) = config.as_object_mut() {
                        config.insert("ConcurrentEdit".to_owned(), serde_json::json!("kept"));
                    } else {
                        *config = serde_json::json!({ "ConcurrentEdit": "kept" });
                    }
                    fake.serve_etag.fetch_add(1, Ordering::SeqCst);
                    (412, serde_json::json!({ "Error": "concurrent Serve edit" }))
                } else {
                    match request.into_body().collect().await {
                        Ok(body) => match serde_json::from_slice(body.to_bytes().as_ref()) {
                            Ok(config) => {
                                *fake.serve_config.lock().expect("serve config") = config;
                                fake.serve_etag.fetch_add(1, Ordering::SeqCst);
                                (200, serde_json::json!({}))
                            }
                            Err(_) => (400, serde_json::json!({ "Error": "bad JSON" })),
                        },
                        Err(_) => (400, serde_json::json!({ "Error": "bad body" })),
                    }
                }
            } else {
                match path.as_str() {
                    "/localapi/v0/status" => (
                        200,
                        fake.status_answer.lock().expect("status answer").clone(),
                    ),
                    "/localapi/v0/serve-config" => {
                        (200, fake.serve_config.lock().expect("serve config").clone())
                    }
                    "/localapi/v0/whois" => {
                        fake.whois_calls.fetch_add(1, Ordering::SeqCst);
                        fake.whois_queries
                            .lock()
                            .expect("whois query lock")
                            .push(request.uri().to_string());
                        let delay = *fake.whois_delay.lock().expect("whois delay lock");
                        tokio::time::sleep(delay).await;
                        if fake.hold_whois.load(Ordering::SeqCst) {
                            fake.release_whois.notified().await;
                        }
                        if !fake.whois_available.load(Ordering::SeqCst) {
                            (503, serde_json::json!({ "Error": "unavailable" }))
                        } else {
                            (200, fake.whois_answer.lock().expect("whois answer").clone())
                        }
                    }
                    _ => (404, serde_json::json!({})),
                }
            };
            let etag = format!("\"fake-{}\"", fake.serve_etag.load(Ordering::SeqCst));
            let body = serde_json::to_vec(&answer).expect("fake JSON");
            Ok::<_, std::convert::Infallible>(
                Response::builder()
                    .status(status)
                    .header("content-type", "application/json")
                    .header("Etag", etag)
                    .body(Full::new(Bytes::from(body)))
                    .expect("fake response"),
            )
        }
    });
    let _ = http1::Builder::new()
        .serve_connection(TokioIo::new(stream), service)
        .await;
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
    send_with_host(port, "localhost", method, path, headers, body).await
}

pub async fn send_with_host(
    port: u16,
    host: &str,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: &[u8],
) -> Reply {
    let mut stream = TcpStream::connect(("127.0.0.1", port))
        .await
        .expect("connected");
    let mut head = format!("{method} {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n");
    for (name, value) in headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    if !body.is_empty() || method == "POST" {
        head.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    head.push_str("\r\n");
    let mut request = head.into_bytes();
    request.extend_from_slice(body);
    stream.write_all(&request).await.expect("sent");
    let mut response = Vec::new();
    let reset = match tokio::time::timeout(WAIT, stream.read_to_end(&mut response))
        .await
        .expect("an answer in time")
    {
        Ok(_) => false,
        // Keep bytes already read: a rejected request may close with an unread body.
        Err(error) if error.kind() == std::io::ErrorKind::ConnectionReset => true,
        Err(error) => panic!("read: {error}"),
    };
    let split = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .expect("a head");
    let head = String::from_utf8(response[..split].to_vec()).expect("an ASCII head");
    let status = head[9..12].parse().expect("a status");
    let reply = Reply {
        status,
        head,
        body: response[split + 4..].to_vec(),
    };
    if reset {
        let length = reply
            .header("content-length")
            .expect("a reset followed a complete HTTP response")
            .parse::<usize>()
            .expect("a content length");
        assert_eq!(reply.body.len(), length, "response body truncated by reset");
    }
    reply
}

pub async fn send_owned(
    port: u16,
    method: &str,
    path: &str,
    headers: &[(String, String)],
    body: &[u8],
) -> Reply {
    let headers = headers
        .iter()
        .map(|(name, value)| (name.as_str(), value.as_str()))
        .collect::<Vec<_>>();
    send(port, method, path, &headers, body).await
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
