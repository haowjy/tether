//! Tailscale LocalAPI and request identity. LocalAPI answers are bounded and reused;
//! whois is deliberately not cached between requests.

use std::collections::{HashMap, VecDeque};
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::str::FromStr as _;
use std::sync::Arc;
use std::time::Duration;

use axum::http::{HeaderMap, Request, header};
use bytes::Bytes;
use http_body_util::{BodyExt as _, Empty, Limited};
use hyper::client::conn::http1::SendRequest;
use hyper_util::rt::TokioIo;
use serde::Deserialize;
use thiserror::Error;
use tokio::net::UnixStream;
use tokio::sync::{Mutex, Notify, watch};
use tokio::time::Instant;

pub const LOGIN_HEADER: &str = "tailscale-user-login";
pub const FUNNEL_HEADER: &str = "tailscale-funnel-request";
const SOCKETS: [&str; 2] = [
    "/var/run/tailscale/tailscaled.sock",
    "/var/run/tailscaled.socket",
];
pub const LOCALAPI_TIMEOUT: Duration = Duration::from_secs(2);
pub const LOCALAPI_MAX_BODY: usize = 64 * 1024;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum IdentityError {
    #[error("Funnel requests are refused")]
    Funnel,
    #[error("no Tailscale-User-Login header: not through tailscale serve")]
    NoLogin,
    #[error("login {0} isn't allowed")]
    NotAllowed(String),
    #[error("can't read tailnet identity: {0}")]
    Unavailable(String),
}

#[derive(Debug, Error, Clone)]
pub enum LocalApiError {
    #[error("no tailscaled LocalAPI socket at {0}")]
    NoSocket(String),
    #[error("can't reach tailscaled: {0}")]
    Io(String),
    #[error("tailscaled's LocalAPI: {0}")]
    Http(String),
    #[error("tailscaled didn't answer within {LOCALAPI_TIMEOUT:?}")]
    Timeout,
    #[error("tailscaled has no node for this address")]
    NoPeer,
    #[error("whois queue is full")]
    Busy,
    #[error("tailnet identity is unavailable")]
    Unavailable,
    #[error("tailscaled's LocalAPI answer exceeds {LOCALAPI_MAX_BODY} bytes")]
    TooLarge,
    #[error("tailscaled's {path} isn't the expected JSON: {error}")]
    Json { path: &'static str, error: String },
}

#[derive(Debug, Clone)]
pub struct TailnetState {
    pub self_id: String,
    pub owner_login: Option<String>,
    pub dns_name: String,
    pub serve: ServeConfig,
}

const STATE_MAX_AGE: Duration = Duration::from_secs(10);
const STATE_MAX_HOLD: Duration = Duration::from_secs(30);

type CellObserver = dyn Fn(&Result<TailnetState, LocalApiError>) + Send + Sync;

/// A shared, age-bounded view of the self node and Serve config.
#[derive(Clone)]
pub struct TailnetStateCell {
    api: LocalApi,
    state: Arc<Mutex<CellState>>,
    changed: Arc<Notify>,
    observe: Arc<CellObserver>,
}

struct CellState {
    value: Option<(Instant, TailnetState)>,
    in_flight: bool,
    retrying: bool,
    retry_delay: Duration,
}

impl TailnetStateCell {
    pub fn new(
        api: LocalApi,
        observe: impl Fn(&Result<TailnetState, LocalApiError>) + Send + Sync + 'static,
    ) -> Self {
        Self {
            api,
            state: Arc::new(Mutex::new(CellState {
                value: None,
                in_flight: false,
                retrying: false,
                retry_delay: Duration::from_secs(2),
            })),
            changed: Arc::new(Notify::new()),
            observe: Arc::new(observe),
        }
    }

    /// Starts the initial fill without making LocalAPI availability a startup gate.
    pub fn start(&self) {
        let cell = self.clone();
        tokio::spawn(async move {
            let mut state = cell.state.lock().await;
            if state.in_flight || state.value.is_some() {
                return;
            }
            state.in_flight = true;
            drop(state);
            cell.refresh().await;
        });
    }

    pub async fn get(&self) -> Result<TailnetState, LocalApiError> {
        loop {
            let notified = self.changed.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            let mut state = self.state.lock().await;
            let now = Instant::now();
            if state.retrying && state.value.is_none() {
                return Err(LocalApiError::Unavailable);
            }
            if let Some((at, value)) = &state.value {
                let age = now.duration_since(*at);
                if age <= STATE_MAX_AGE {
                    return Ok(value.clone());
                }
                if state.retrying {
                    return if age <= STATE_MAX_HOLD {
                        Ok(value.clone())
                    } else {
                        Err(LocalApiError::Unavailable)
                    };
                }
            }
            if state.in_flight {
                if state.retrying {
                    return Err(LocalApiError::Unavailable);
                }
                drop(state);
                notified.await;
                continue;
            }
            state.in_flight = true;
            drop(state);
            let cell = self.clone();
            tokio::spawn(async move { cell.refresh().await });
            notified.await;
        }
    }

    /// The last successful value, even when it is too old to make an auth decision.
    pub async fn last_known(&self) -> Option<TailnetState> {
        self.state
            .lock()
            .await
            .value
            .as_ref()
            .map(|(_, value)| value.clone())
    }

    async fn refresh(&self) {
        let result = self.api.tailnet_state().await;
        if matches!(
            self.complete(result).await,
            Completion::Failed { start_retry: true }
        ) {
            let cell = self.clone();
            tokio::spawn(async move { cell.retry().await });
        }
    }

    async fn retry(&self) {
        loop {
            let delay = {
                let state = self.state.lock().await;
                if !state.retrying {
                    return;
                }
                state.retry_delay
            };
            tokio::time::sleep(delay).await;
            {
                let mut state = self.state.lock().await;
                if !state.retrying {
                    return;
                }
                state.in_flight = true;
            }
            let result = self.api.tailnet_state().await;
            if matches!(self.complete(result).await, Completion::Succeeded) {
                return;
            }
        }
    }

    async fn complete(&self, result: Result<TailnetState, LocalApiError>) -> Completion {
        let completion = {
            let mut state = self.state.lock().await;
            state.in_flight = false;
            match &result {
                Ok(value) => {
                    state.value = Some((Instant::now(), value.clone()));
                    state.retrying = false;
                    state.retry_delay = Duration::from_secs(2);
                    Completion::Succeeded
                }
                Err(_) => {
                    let start_retry = !state.retrying;
                    state.retrying = true;
                    if !start_retry {
                        state.retry_delay = (state.retry_delay * 2).min(Duration::from_secs(30));
                    }
                    Completion::Failed { start_retry }
                }
            }
        };
        (self.observe)(&result);
        self.changed.notify_waiters();
        completion
    }
}

enum Completion {
    Succeeded,
    Failed { start_retry: bool },
}

impl TailnetState {
    pub fn machine_name(&self) -> &str {
        self.dns_name.split('.').next().unwrap_or_default()
    }
}

/// A parsed whois answer sufficient for the browser node rules.
#[derive(Debug, Clone, Deserialize)]
pub struct Whois {
    #[serde(rename = "Node")]
    pub node: Option<WhoisNode>,
    #[serde(rename = "UserProfile")]
    pub user_profile: Option<UserProfile>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WhoisNode {
    #[serde(rename = "StableID", default)]
    pub stable_id: String,
    #[serde(rename = "Tags", default)]
    pub tags: Vec<String>,
    #[serde(rename = "Sharer", default)]
    pub sharer: u64,
    #[serde(rename = "Addresses", default)]
    pub addresses: Vec<String>,
    #[serde(rename = "AllowedIPs", default)]
    pub allowed_ips: Vec<String>,
    #[serde(rename = "DNSName", default)]
    pub dns_name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UserProfile {
    #[serde(rename = "LoginName", default)]
    pub login_name: String,
}

/// The one LocalAPI owner. A cell client is separate from the two whois connections.
#[derive(Clone)]
pub struct LocalApi {
    socket: Option<PathBuf>,
    cell: Arc<Client>,
    whois: Arc<[Client; 2]>,
    whois_state: Arc<Mutex<WhoisState>>,
}

struct WhoisState {
    free_clients: Vec<usize>,
    waiting: VecDeque<(IpAddr, Arc<WhoisFlight>)>,
    flights: HashMap<IpAddr, Arc<WhoisFlight>>,
}

struct WhoisFlight {
    start: watch::Receiver<Option<usize>>,
    start_tx: watch::Sender<Option<usize>>,
    result: watch::Receiver<Option<Result<Whois, LocalApiError>>>,
    result_tx: watch::Sender<Option<Result<Whois, LocalApiError>>>,
}

impl WhoisFlight {
    fn new() -> Arc<Self> {
        let (start_tx, start) = watch::channel(None);
        let (result_tx, result) = watch::channel(None);
        Arc::new(Self {
            start,
            start_tx,
            result,
            result_tx,
        })
    }
}

impl LocalApi {
    /// Uses tailscaled's standard socket search order.
    pub fn system() -> Self {
        Self::new(None)
    }

    /// Uses a fixed LocalAPI socket; public so integration tests can run a fake daemon.
    pub fn at(socket: PathBuf) -> Self {
        Self::new(Some(socket))
    }

    fn new(socket: Option<PathBuf>) -> Self {
        Self {
            socket,
            cell: Arc::new(Client::new()),
            whois: Arc::new([Client::new(), Client::new()]),
            whois_state: Arc::new(Mutex::new(WhoisState {
                free_clients: vec![0, 1],
                waiting: VecDeque::new(),
                flights: HashMap::new(),
            })),
        }
    }

    fn socket_path(&self) -> Result<PathBuf, LocalApiError> {
        self.socket.clone().map_or_else(
            || {
                SOCKETS
                    .iter()
                    .map(PathBuf::from)
                    .find(|path| path.exists())
                    .ok_or_else(|| LocalApiError::NoSocket(SOCKETS.join(" or ")))
            },
            Ok,
        )
    }

    /// The status and serve config are read as one answer for the tailnet-state cell.
    pub async fn tailnet_state(&self) -> Result<TailnetState, LocalApiError> {
        #[derive(Deserialize)]
        struct Status {
            #[serde(rename = "Self")]
            this: Option<SelfNode>,
            #[serde(rename = "User", default)]
            users: HashMap<String, User>,
        }
        #[derive(Deserialize)]
        struct SelfNode {
            #[serde(rename = "StableID", default)]
            stable_id: String,
            #[serde(rename = "UserID", default)]
            user_id: u64,
            #[serde(rename = "DNSName", default)]
            dns_name: String,
        }
        #[derive(Deserialize)]
        struct User {
            #[serde(rename = "LoginName", default)]
            login_name: String,
        }

        let socket = self.socket_path()?;
        let status_bytes = self
            .cell
            .get(&socket, "/localapi/v0/status?peers=false")
            .await?;
        let serve_bytes = self.cell.get(&socket, "/localapi/v0/serve-config").await?;
        let status: Status = parse_json("/localapi/v0/status?peers=false", &status_bytes)?;
        let serve: Option<ServeConfig> = parse_json("/localapi/v0/serve-config", &serve_bytes)?;
        let this = status
            .this
            .filter(|node| !node.stable_id.is_empty())
            .ok_or(LocalApiError::Unavailable)?;
        let owner_login = status
            .users
            .get(&this.user_id.to_string())
            .map(|user| user.login_name.clone())
            .filter(|login| !login.is_empty());
        Ok(TailnetState {
            self_id: this.stable_id,
            owner_login,
            dns_name: this.dns_name.trim_end_matches('.').to_owned(),
            serve: serve.unwrap_or_default(),
        })
    }

    pub async fn whois(&self, address: IpAddr) -> Result<Whois, LocalApiError> {
        let (flight, start) = {
            let mut state = self.whois_state.lock().await;
            if let Some(flight) = state.flights.get(&address) {
                (flight.clone(), false)
            } else {
                if state.free_clients.is_empty() && state.waiting.len() >= 16 {
                    return Err(LocalApiError::Busy);
                }
                let flight = WhoisFlight::new();
                state.flights.insert(address, flight.clone());
                if let Some(index) = state.free_clients.pop() {
                    let _ = flight.start_tx.send(Some(index));
                    (flight, true)
                } else {
                    state.waiting.push_back((address, flight.clone()));
                    // The dequeued flight gets its worker only when a client is assigned.
                    (flight, false)
                }
            }
        };
        if start {
            self.run_whois(address, flight.clone());
        }
        let mut result = flight.result.clone();
        loop {
            if let Some(result) = result.borrow().clone() {
                return result;
            }
            result.changed().await.map_err(|_| {
                LocalApiError::Http("whois worker stopped without a result".to_owned())
            })?;
        }
    }

    fn run_whois(&self, address: IpAddr, flight: Arc<WhoisFlight>) {
        let api = self.clone();
        tokio::spawn(async move {
            let mut start = flight.start.clone();
            let index = loop {
                if let Some(index) = *start.borrow() {
                    break index;
                }
                if start.changed().await.is_err() {
                    return;
                }
            };
            let path = format!("/localapi/v0/whois?addr={address}");
            let result = match api.socket_path() {
                Ok(socket) => api.whois[index]
                    .get(&socket, &path)
                    .await
                    .and_then(|bytes| parse_json("/localapi/v0/whois", &bytes)),
                Err(error) => Err(error),
            };

            let next = {
                let mut state = api.whois_state.lock().await;
                state.flights.remove(&address);
                state.free_clients.push(index);
                if let Some((next_address, next_flight)) = state.waiting.pop_front() {
                    state.free_clients.pop().map(|next_index| {
                        let _ = next_flight.start_tx.send(Some(next_index));
                        (next_address, next_flight)
                    })
                } else {
                    None
                }
            };
            let _ = flight.result_tx.send(Some(result));
            if let Some((next_address, next_flight)) = next {
                api.run_whois(next_address, next_flight);
            }
        });
    }
}

type RequestSender = SendRequest<Empty<Bytes>>;

struct Client {
    sender: Mutex<Option<RequestSender>>,
}

impl Client {
    fn new() -> Self {
        Self {
            sender: Mutex::new(None),
        }
    }

    async fn get(&self, socket: &Path, path: &str) -> Result<Bytes, LocalApiError> {
        tokio::time::timeout(LOCALAPI_TIMEOUT, self.request(socket, path))
            .await
            .map_err(|_| LocalApiError::Timeout)?
    }

    async fn request(&self, socket: &Path, path: &str) -> Result<Bytes, LocalApiError> {
        let mut current = self.sender.lock().await;
        if current.is_none() {
            *current = Some(connect(socket).await?);
        }
        let response = match current
            .as_mut()
            .expect("connected")
            .send_request(request(path)?)
            .await
        {
            Ok(response) => response,
            Err(first) => {
                *current = None;
                let mut sender = connect(socket).await?;
                let response = sender
                    .send_request(request(path)?)
                    .await
                    .map_err(|error| LocalApiError::Http(error.to_string()))?;
                *current = Some(sender);
                let _ = first;
                response
            }
        };
        if response.status() == hyper::StatusCode::NOT_FOUND {
            return Err(LocalApiError::NoPeer);
        }
        if !response.status().is_success() {
            return Err(LocalApiError::Http(format!(
                "{path}: {}",
                response.status()
            )));
        }
        Limited::new(response.into_body(), LOCALAPI_MAX_BODY)
            .collect()
            .await
            .map(|body| body.to_bytes())
            .map_err(|error| {
                if error.to_string().contains("length limit") {
                    LocalApiError::TooLarge
                } else {
                    LocalApiError::Http(error.to_string())
                }
            })
    }
}

async fn connect(socket: &Path) -> Result<RequestSender, LocalApiError> {
    let stream = UnixStream::connect(socket)
        .await
        .map_err(|error| LocalApiError::Io(error.to_string()))?;
    let (sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(stream))
        .await
        .map_err(|error| LocalApiError::Http(error.to_string()))?;
    tokio::spawn(connection);
    Ok(sender)
}

fn request(path: &str) -> Result<Request<Empty<Bytes>>, LocalApiError> {
    Request::get(path)
        .header(header::HOST, "local-tailscaled.sock")
        .body(Empty::<Bytes>::new())
        .map_err(|error| LocalApiError::Http(error.to_string()))
}

fn parse_json<T: serde::de::DeserializeOwned>(
    path: &'static str,
    bytes: &[u8],
) -> Result<T, LocalApiError> {
    serde_json::from_slice(bytes).map_err(|error| LocalApiError::Json {
        path,
        error: error.to_string(),
    })
}

/// A login decoded by Serve, checked against either the explicit or default allowlist.
pub fn check_login(
    allow: &[String],
    explicit: bool,
    state: Option<&TailnetState>,
    headers: &HeaderMap,
) -> Result<String, IdentityError> {
    if headers.contains_key(FUNNEL_HEADER) {
        return Err(IdentityError::Funnel);
    }
    let value = headers
        .get_all(LOGIN_HEADER)
        .iter()
        .next()
        .filter(|_| headers.get_all(LOGIN_HEADER).iter().count() == 1)
        .ok_or(IdentityError::NoLogin)?;
    let login = decode_login(value).ok_or(IdentityError::NoLogin)?;
    if explicit {
        if allow.iter().any(|allowed| allowed == &login) {
            Ok(login)
        } else {
            Err(IdentityError::NotAllowed(login))
        }
    } else {
        let allowed = state
            .and_then(|state| state.owner_login.as_deref())
            .ok_or_else(|| IdentityError::Unavailable("owner login is unavailable".into()))?;
        if allowed == login {
            Ok(login)
        } else {
            Err(IdentityError::NotAllowed(login))
        }
    }
}

/// Serve Q-encodes non-ASCII logins as an RFC 2047 encoded word.
pub fn decode_login(value: &axum::http::HeaderValue) -> Option<String> {
    let raw = value.to_str().ok()?;
    if !raw.starts_with("=?") {
        return Some(raw.to_owned());
    }
    let input = raw.as_bytes();
    let mut offset = 0;
    let mut decoded = Vec::with_capacity(input.len());
    while offset < input.len() {
        if input[offset..].starts_with(b"=?") {
            let (word, next) = decode_word(input, offset)?;
            decoded.extend(word);
            offset = next;
            let mut after_whitespace = offset;
            while input
                .get(after_whitespace)
                .is_some_and(|byte| matches!(byte, b' ' | b'\t' | b'\r' | b'\n'))
            {
                after_whitespace += 1;
            }
            if input[after_whitespace..].starts_with(b"=?") {
                offset = after_whitespace;
            }
        } else {
            let next = input[offset..]
                .windows(2)
                .position(|pair| pair == b"=?")
                .map_or(input.len(), |next| offset + next);
            decoded.extend_from_slice(&input[offset..next]);
            offset = next;
        }
    }
    String::from_utf8(decoded).ok()
}

fn decode_word(input: &[u8], start: usize) -> Option<(Vec<u8>, usize)> {
    if !input[start..].starts_with(b"=?") {
        return None;
    }
    let charset_start = start + 2;
    let charset_end = charset_start + input[charset_start..].iter().position(|b| *b == b'?')?;
    let charset = std::str::from_utf8(&input[charset_start..charset_end]).ok()?;
    let encoding_start = charset_end + 1;
    let encoding_end = encoding_start + input[encoding_start..].iter().position(|b| *b == b'?')?;
    let encoding = std::str::from_utf8(&input[encoding_start..encoding_end]).ok()?;
    let payload_start = encoding_end + 1;
    let payload_end = payload_start
        + input[payload_start..]
            .windows(2)
            .position(|pair| pair == b"?=")?;
    if !charset.eq_ignore_ascii_case("utf-8") || !encoding.eq_ignore_ascii_case("q") {
        return None;
    }
    let mut decoded = Vec::with_capacity(payload_end - payload_start);
    let mut payload = input[payload_start..payload_end].iter().copied();
    while let Some(byte) = payload.next() {
        match byte {
            b'_' => decoded.push(b' '),
            b'=' => {
                let high = hex(payload.next()?)?;
                let low = hex(payload.next()?)?;
                decoded.push(high * 16 + low);
            }
            byte => decoded.push(byte),
        }
    }
    Some((decoded, payload_end + 2))
}

fn hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ServeConfig {
    #[serde(rename = "TCP", default)]
    tcp: HashMap<String, TcpHandler>,
    #[serde(rename = "Web", default)]
    web: HashMap<String, WebServer>,
    #[serde(rename = "AllowFunnel", default)]
    allow_funnel: HashMap<String, bool>,
    #[serde(rename = "Foreground", default)]
    foreground: HashMap<String, ServeConfig>,
    #[serde(rename = "Services", default)]
    services: HashMap<String, Service>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct TcpHandler {
    #[serde(rename = "TCPForward", default)]
    tcp_forward: String,
    #[serde(rename = "HTTPS", default)]
    https: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct WebServer {
    #[serde(rename = "Handlers", default)]
    handlers: HashMap<String, Handler>,
    #[serde(rename = "HTTPS", default)]
    https: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct Handler {
    #[serde(rename = "Proxy", default)]
    proxy: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct Service {
    #[serde(rename = "TCP", default)]
    tcp: HashMap<String, TcpHandler>,
    #[serde(rename = "Web", default)]
    web: HashMap<String, WebServer>,
    #[serde(rename = "AllowFunnel", default)]
    allow_funnel: HashMap<String, bool>,
}

impl ServeConfig {
    pub fn canonical_origin(
        &self,
        wanted: SocketIdentity,
        serve_socket: &Path,
    ) -> Result<CanonicalOrigin, OriginRefusal> {
        if wanted == SocketIdentity::default() {
            return Err(OriginRefusal::new("tether's serve.sock is not bound"));
        }
        let mut references = Vec::new();
        self.collect_references("serve", wanted, &mut references);
        if references.len() != 1 {
            let offender = references
                .get(1)
                .or_else(|| references.first())
                .map_or_else(
                    || "no Serve entry names serve.sock".to_owned(),
                    |r| r.label.clone(),
                );
            return Err(self.refusal(&offender, serve_socket));
        }
        let reference = &references[0];
        let Some((host_port, mount, web, service_funnel, https)) = &reference.web else {
            return Err(self.refusal(&reference.label, serve_socket));
        };
        if web.handlers.len() != 1 || mount.as_str() != "/" || !https || *service_funnel {
            return Err(self.refusal(&reference.label, serve_socket));
        }
        let (host, port) = parse_host_port(host_port)
            .ok_or_else(|| self.refusal(&reference.label, serve_socket))?;
        if host.is_empty() || host.ends_with('.') {
            return Err(self.refusal(&reference.label, serve_socket));
        }
        let host = host.to_ascii_lowercase();
        let host = if host.contains(':') {
            format!("[{host}]")
        } else {
            host
        };
        let authority = if port == 443 {
            host
        } else {
            format!("{host}:{port}")
        };
        Ok(CanonicalOrigin {
            origin: format!("https://{authority}"),
            authority,
        })
    }

    fn refusal(&self, entry: &str, serve_socket: &Path) -> OriginRefusal {
        if let Some(old) = self.old_default_target() {
            return OriginRefusal::new(&format!(
                "{old} still proxies to tether's old 127.0.0.1:7850 listener. Replace it with: sudo tailscale serve --bg --https=443 unix:{}",
                serve_socket.display()
            ));
        }
        OriginRefusal::new(&format!(
            "Tailscale Serve entry {entry} is not tether's sole HTTPS handler. Publish tether with: sudo tailscale serve --bg --https=443 unix:{}",
            serve_socket.display()
        ))
    }

    fn old_default_target(&self) -> Option<String> {
        fn find(config: &ServeConfig) -> Option<String> {
            for (host_port, web) in &config.web {
                if web
                    .handlers
                    .values()
                    .any(|handler| handler.proxy == "http://127.0.0.1:7850")
                {
                    return Some(host_port.clone());
                }
            }
            for (name, service) in &config.services {
                for (host_port, web) in &service.web {
                    if web
                        .handlers
                        .values()
                        .any(|handler| handler.proxy == "http://127.0.0.1:7850")
                    {
                        return Some(format!("Service {name} {host_port}"));
                    }
                }
            }
            config.foreground.iter().find_map(|(name, config)| {
                find(config).map(|entry| format!("Foreground {name} {entry}"))
            })
        }
        find(self)
    }

    fn collect_references<'a>(
        &'a self,
        scope: &str,
        wanted: SocketIdentity,
        out: &mut Vec<SocketRef<'a>>,
    ) {
        for (port, handler) in &self.tcp {
            if same_socket(&handler.tcp_forward, wanted) {
                out.push(SocketRef {
                    label: format!("{scope} TCP {port}"),
                    web: None,
                });
            }
        }
        self.collect_web(scope, wanted, out, &self.web, &self.tcp, &self.allow_funnel);
        for (name, config) in &self.foreground {
            config.collect_references(&format!("{scope} Foreground {name}"), wanted, out);
        }
        for (name, service) in &self.services {
            for (port, handler) in &service.tcp {
                if same_socket(&handler.tcp_forward, wanted) {
                    out.push(SocketRef {
                        label: format!("{scope} Service {name} TCP {port}"),
                        web: None,
                    });
                }
            }
            self.collect_web(
                &format!("{scope} Service {name}"),
                wanted,
                out,
                &service.web,
                &service.tcp,
                &service.allow_funnel,
            );
        }
    }

    fn collect_web<'a>(
        &'a self,
        scope: &str,
        wanted: SocketIdentity,
        out: &mut Vec<SocketRef<'a>>,
        web: &'a HashMap<String, WebServer>,
        tcp: &'a HashMap<String, TcpHandler>,
        funnel: &'a HashMap<String, bool>,
    ) {
        for (host_port, server) in web {
            for (mount, handler) in &server.handlers {
                if !same_socket(&handler.proxy, wanted) {
                    continue;
                }
                let port = parse_host_port(host_port).map(|(_, port)| port);
                let https = server.https
                    || port.is_some_and(|port| {
                        tcp.get(&port.to_string())
                            .is_some_and(|handler| handler.https)
                    });
                out.push(SocketRef {
                    label: format!("{scope} Web {host_port} {mount}"),
                    web: Some((
                        host_port,
                        mount,
                        server,
                        funnel.get(host_port).copied().unwrap_or(false),
                        https,
                    )),
                });
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanonicalOrigin {
    pub origin: String,
    pub authority: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OriginRefusal {
    pub message: String,
}

impl OriginRefusal {
    fn new(message: &str) -> Self {
        Self {
            message: message.to_owned(),
        }
    }
}

struct SocketRef<'a> {
    label: String,
    web: Option<(&'a String, &'a String, &'a WebServer, bool, bool)>,
}

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub struct SocketIdentity {
    device: u64,
    inode: u64,
}

impl SocketIdentity {
    pub fn of(path: &Path) -> std::io::Result<Self> {
        socket_identity(path)
    }
}

fn socket_identity(path: &Path) -> std::io::Result<SocketIdentity> {
    use std::os::unix::fs::MetadataExt as _;
    let metadata = std::fs::metadata(path)?;
    Ok(SocketIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    })
}

fn same_socket(target: &str, wanted: SocketIdentity) -> bool {
    let Some(path) = target.strip_prefix("unix:") else {
        return false;
    };
    socket_identity(Path::new(path)).is_ok_and(|identity| identity == wanted)
}

fn parse_host_port(host_port: &str) -> Option<(String, u16)> {
    let authority = axum::http::uri::Authority::from_str(host_port).ok()?;
    let port = authority.port_u16()?;
    if port == 0 {
        return None;
    }
    let host = authority.host();
    let host = host
        .strip_prefix('[')
        .and_then(|host| host.strip_suffix(']'))
        .unwrap_or(host);
    Some((host.to_owned(), port))
}
