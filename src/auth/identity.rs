//! Tailnet identity, its shared state cell, and Serve-origin calculation.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::str::FromStr as _;
use std::sync::Arc;
use std::time::Duration;

use axum::http::HeaderMap;
#[cfg(target_os = "macos")]
use axum::http::{HeaderValue, header};
#[cfg(target_os = "macos")]
use bytes::Bytes;
#[cfg(target_os = "macos")]
use http_body_util::{BodyExt as _, Full, Limited};
#[cfg(target_os = "macos")]
use hyper::Request;
#[cfg(target_os = "macos")]
use hyper_util::rt::TokioIo;
use serde::Deserialize;
use serde_json::{Map, Value};
use thiserror::Error;

use super::localapi::{LocalApi, LocalApiError};
use super::mac_front::MacFront;
#[cfg(target_os = "macos")]
use tokio::net::UnixStream;
use tokio::sync::{Mutex, Notify};
use tokio::time::Instant;

pub const LOGIN_HEADER: &str = "tailscale-user-login";
pub const FUNNEL_HEADER: &str = "tailscale-funnel-request";

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

#[derive(Debug, Clone)]
pub struct TailnetState {
    pub self_id: String,
    pub owner_login: Option<String>,
    pub dns_name: String,
    pub serve: ServeConfig,
}

pub(crate) const RETRY_INITIAL: Duration = Duration::from_secs(2);
pub(crate) const RETRY_MAX: Duration = Duration::from_secs(30);
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
                retry_delay: RETRY_INITIAL,
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
            let _ = cell.refresh().await;
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
            tokio::spawn(async move {
                let _ = cell.refresh().await;
            });
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

    async fn refresh(&self) -> Result<TailnetState, LocalApiError> {
        let result = tailnet_state(&self.api).await;
        if matches!(
            self.complete(result.clone()).await,
            Completion::Failed { start_retry: true }
        ) {
            let cell = self.clone();
            tokio::spawn(async move { cell.retry().await });
        }
        result
    }

    /// Forces a post-publication read after any earlier cell read has completed.
    pub async fn refresh_after_write(&self) -> Result<TailnetState, LocalApiError> {
        loop {
            let notified = self.changed.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            let mut state = self.state.lock().await;
            if state.in_flight {
                drop(state);
                notified.await;
                continue;
            }
            state.in_flight = true;
            drop(state);
            return self.refresh().await;
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
            let result = tailnet_state(&self.api).await;
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
                    state.retry_delay = RETRY_INITIAL;
                    Completion::Succeeded
                }
                Err(_) => {
                    let start_retry = !state.retrying;
                    state.retrying = true;
                    if !start_retry {
                        state.retry_delay = (state.retry_delay * 2).min(RETRY_MAX);
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

pub async fn tailnet_state(api: &LocalApi) -> Result<TailnetState, LocalApiError> {
    let status = api.status().await?;
    let mut serve = api.serve_config().await?;
    let serve = ServeConfig::parse(&mut serve).map_err(|error| LocalApiError::Json {
        path: "/localapi/v0/serve-config",
        error: error.to_string(),
    })?;
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
        serve,
    })
}

impl TailnetState {
    pub fn machine_name(&self) -> &str {
        self.dns_name.split('.').next().unwrap_or_default()
    }
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

#[cfg(target_os = "macos")]
pub async fn read_auth_info(socket: &Path, api: &LocalApi) -> Result<serde_json::Value, String> {
    let stream = UnixStream::connect(socket)
        .await
        .map_err(|_| "tether isn't running".to_owned())?;
    let state = tailnet_state(api)
        .await
        .map_err(|error| format!("tailnet identity is unavailable ({error})"))?;
    let login = state
        .owner_login
        .ok_or_else(|| "Tailscale didn't report an owner login".to_owned())?;
    let (mut sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(stream))
        .await
        .map_err(|error| error.to_string())?;
    tokio::spawn(async move {
        let _ = connection.await;
    });
    let mut request = Request::builder()
        .method("GET")
        .uri("/auth/info")
        .body(Full::new(Bytes::new()))
        .map_err(|error| error.to_string())?;
    request
        .headers_mut()
        .insert(header::HOST, HeaderValue::from_static("localhost"));
    request
        .headers_mut()
        .insert("tailscale-user-login", login_header(&login)?);
    let response = sender
        .send_request(request)
        .await
        .map_err(|error| error.to_string())?;
    let (parts, body) = response.into_parts();
    let body = Limited::new(body, 64 * 1024)
        .collect()
        .await
        .map_err(|error| error.to_string())?
        .to_bytes();
    if !parts.status.is_success() {
        return Err(format!("tether's /auth/info: {}", parts.status));
    }
    serde_json::from_slice(&body).map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn login_header(login: &str) -> Result<axum::http::HeaderValue, String> {
    let encoded = if login.is_ascii() {
        login.to_owned()
    } else {
        let mut output = String::from("=?UTF-8?Q?");
        for byte in login.bytes() {
            match byte {
                b' ' => output.push('_'),
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'!' | b'*' | b'+' | b'-' | b'/' => {
                    output.push(char::from(byte));
                }
                _ => output.push_str(&format!("={byte:02X}")),
            }
        }
        output.push_str("?=");
        output
    };
    axum::http::HeaderValue::from_str(&encoded).map_err(|error| error.to_string())
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
    #[serde(flatten)]
    other: HashMap<String, serde_json::Value>,
}

impl TcpHandler {
    fn is_https_only(&self) -> bool {
        self.https && self.tcp_forward.is_empty() && self.other.is_empty()
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
struct WebServer {
    #[serde(rename = "Handlers", default)]
    handlers: HashMap<String, Handler>,
    #[serde(rename = "HTTPS", default)]
    https: bool,
}

#[derive(Clone, Default, Deserialize)]
struct Handler {
    #[serde(rename = "Proxy", default)]
    proxy: String,
}

impl std::fmt::Debug for Handler {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Handler")
            .field("proxy", &"<redacted>")
            .finish()
    }
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
    /// Parses LocalAPI's JSON view; a never-configured Tailscale profile returns null.
    pub(super) fn parse(value: &mut Value) -> Result<Self, serde_json::Error> {
        if value.is_null() {
            *value = Value::Object(Map::new());
        }
        serde_json::from_value(value.clone())
    }

    pub fn canonical_origin(&self, target: &ServeTarget) -> Result<CanonicalOrigin, OriginRefusal> {
        let mut references = Vec::new();
        self.collect_references("serve", target, &mut references);
        if references.is_empty() {
            let reason = self
                .old_default_target()
                .map(|entry| OriginRefusalReason::OldDefaultTarget { entry })
                .unwrap_or(OriginRefusalReason::NoReference);
            return Err(OriginRefusal::for_target(reason, target));
        }
        if references.len() != 1 {
            references.sort_by(|left, right| left.label.cmp(&right.label));
            let offender = references
                .iter()
                .find(|reference| !reference.is_canonical_candidate(target))
                .or_else(|| references.get(1))
                .expect("more than one reference");
            let reason = if offender.is_canonical_candidate(target) {
                OriginRefusalReason::MultipleReferences {
                    entry: offender.label.clone(),
                }
            } else {
                offender.refusal_reason(target)
            };
            return Err(OriginRefusal::for_target(reason, target));
        }
        let reference = &references[0];
        if !reference.is_canonical_candidate(target) {
            return Err(OriginRefusal::for_target(
                reference.refusal_reason(target),
                target,
            ));
        }
        let SocketRefKind::Web { host_port, .. } = &reference.kind else {
            unreachable!("a canonical candidate is a Web handler")
        };
        let (host, port) =
            parse_host_port(host_port).expect("a canonical candidate has a valid authority");
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
        target: &ServeTarget,
        out: &mut Vec<SocketRef<'a>>,
    ) {
        for (port, handler) in &self.tcp {
            if target.names(&handler.tcp_forward) {
                out.push(SocketRef {
                    label: format!("{scope} TCP {port}"),
                    kind: SocketRefKind::Tcp { port },
                });
            }
        }
        self.collect_web(scope, target, out, &self.web, &self.tcp, &self.allow_funnel);
        for (name, config) in &self.foreground {
            config.collect_references(&format!("{scope} Foreground {name}"), target, out);
        }
        for (name, service) in &self.services {
            for (port, handler) in &service.tcp {
                if target.names(&handler.tcp_forward) {
                    out.push(SocketRef {
                        label: format!("{scope} Service {name} TCP {port}"),
                        kind: SocketRefKind::Tcp { port },
                    });
                }
            }
            self.collect_web(
                &format!("{scope} Service {name}"),
                target,
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
        target: &ServeTarget,
        out: &mut Vec<SocketRef<'a>>,
        web: &'a HashMap<String, WebServer>,
        tcp: &'a HashMap<String, TcpHandler>,
        funnel: &'a HashMap<String, bool>,
    ) {
        for (host_port, server) in web {
            for (mount, handler) in &server.handlers {
                if !target.names(&handler.proxy) {
                    continue;
                }
                let port = parse_host_port(host_port).map(|(_, port)| port);
                let https = server.https
                    || port.is_some_and(|port| {
                        tcp.get(&port.to_string())
                            .is_some_and(|handler| handler.https)
                    });
                let tcp_refusal = port.and_then(|port| {
                    tcp.get(&port.to_string())
                        .filter(|handler| !handler.is_https_only())
                        .map(|_| format!("{scope} TCP {port}"))
                });
                out.push(SocketRef {
                    label: format!("{scope} Web {host_port}"),
                    kind: SocketRefKind::Web {
                        host_port,
                        mount,
                        web: server,
                        funnel: funnel.get(host_port).copied().unwrap_or(false),
                        https,
                        tcp_refusal,
                    },
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
    pub reason: OriginRefusalReason,
    pub message: String,
}

impl OriginRefusal {
    fn for_target(reason: OriginRefusalReason, target: &ServeTarget) -> Self {
        let message = reason.message(target);
        Self { reason, message }
    }

    fn no_front() -> Self {
        Self {
            reason: OriginRefusalReason::NoServeFront,
            message: "tether has no bound Serve front".to_owned(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OriginRefusalReason {
    NoServeFront,
    NoReference,
    OldDefaultTarget { entry: String },
    MultipleReferences { entry: String },
    TcpForward { entry: String, port: String },
    Funnel { entry: String },
    IncompatibleTcp { entry: String, tcp_entry: String },
    SharedHandler { entry: String, mount: String },
    NonRootMount { entry: String, mount: String },
    NotHttps { entry: String },
    WrongProxy { entry: String },
    InvalidHost { entry: String },
}

impl OriginRefusalReason {
    fn message(&self, target: &ServeTarget) -> String {
        let publish = match target {
            ServeTarget::Unix { path, .. } => format!(
                "publish tether with: sudo tailscale serve --bg --https=443 unix:{}",
                path.display()
            ),
            ServeTarget::Loopback(_) => "restart tether to republish".to_owned(),
        };
        match self {
            Self::NoServeFront => "tether has no bound Serve front".to_owned(),
            Self::NoReference => match target {
                ServeTarget::Unix { .. } => {
                    format!("no Tailscale Serve entry names tether's serve.sock; {publish}")
                }
                ServeTarget::Loopback(front) => format!(
                    "no Tailscale Serve entry names tether's Mac front on port {}; start tether with --publish",
                    front.port()
                ),
            },
            Self::OldDefaultTarget { entry } => match target {
                ServeTarget::Unix { path, .. } => format!(
                    "{entry} still proxies to tether's old 127.0.0.1:7850 listener; replace it with: sudo tailscale serve --bg --https=443 unix:{}",
                    path.display()
                ),
                ServeTarget::Loopback(_) => format!(
                    "{entry} still proxies to tether's old 127.0.0.1:7850 listener; remove the stale handler and {publish}"
                ),
            },
            Self::MultipleReferences { entry } => format!(
                "Tailscale Serve reference {entry} is a second reference to tether's front; remove the duplicate reference and {publish}"
            ),
            Self::TcpForward { entry, port } => format!(
                "Tailscale Serve entry {entry} forwards TCP to tether's front on port {port}; remove that TCP forward and {publish}"
            ),
            Self::Funnel { entry } => {
                format!("Tailscale Funnel is enabled for {entry}; turn Funnel off, then {publish}")
            }
            Self::IncompatibleTcp { entry, tcp_entry } => format!(
                "Tailscale Serve TCP entry {tcp_entry} is not the plain HTTPS entry required by {entry}; remove it or replace it with `{{HTTPS: true}}`, then {publish}"
            ),
            Self::SharedHandler { entry, mount } => format!(
                "Tailscale Serve entry {entry} also serves another handler at {mount}; remove that handler and {publish}"
            ),
            Self::NonRootMount { entry, mount } => format!(
                "Tailscale Serve entry {entry} mounts tether at {mount}, not /; move tether to / and {publish}"
            ),
            Self::NotHttps { entry } => {
                format!("Tailscale Serve entry {entry} is not HTTPS; enable HTTPS and {publish}")
            }
            Self::WrongProxy { entry } => format!(
                "Tailscale Serve entry {entry} does not use tether's exact Mac front; remove the stale handler and {publish}"
            ),
            Self::InvalidHost { entry } => format!(
                "Tailscale Serve entry {entry} has an invalid host or port; correct it and {publish}"
            ),
        }
    }
}

/// Resolves the browser origin for a configured Serve target, including no-target
/// daemons so callers share one refusal rule.
pub(super) fn origin(
    target: Option<&ServeTarget>,
    serve: &ServeConfig,
) -> Result<CanonicalOrigin, OriginRefusal> {
    match target {
        Some(target) => serve.canonical_origin(target),
        None => Err(OriginRefusal::no_front()),
    }
}

enum SocketRefKind<'a> {
    Tcp {
        port: &'a String,
    },
    Web {
        host_port: &'a String,
        mount: &'a String,
        web: &'a WebServer,
        funnel: bool,
        https: bool,
        tcp_refusal: Option<String>,
    },
}

struct SocketRef<'a> {
    label: String,
    kind: SocketRefKind<'a>,
}

impl SocketRef<'_> {
    fn is_canonical_candidate(&self, target: &ServeTarget) -> bool {
        let SocketRefKind::Web {
            host_port,
            mount,
            web,
            funnel,
            https,
            tcp_refusal,
        } = &self.kind
        else {
            return false;
        };
        let canonical_host = parse_host_port(host_port)
            .is_some_and(|(host, _)| !host.is_empty() && !host.ends_with('.'));
        web.handlers.len() == 1
            && mount.as_str() == "/"
            && *https
            && tcp_refusal.is_none()
            && !*funnel
            && canonical_host
            && web
                .handlers
                .get(mount.as_str())
                .is_some_and(|handler| target.is_canonical_proxy(&handler.proxy))
    }

    fn refusal_reason(&self, target: &ServeTarget) -> OriginRefusalReason {
        match &self.kind {
            SocketRefKind::Tcp { port } => OriginRefusalReason::TcpForward {
                entry: self.label.clone(),
                port: (**port).clone(),
            },
            SocketRefKind::Web {
                mount,
                web,
                funnel,
                https,
                tcp_refusal,
                ..
            } => {
                if *funnel {
                    return OriginRefusalReason::Funnel {
                        entry: self.label.clone(),
                    };
                }
                if let Some(tcp_entry) = tcp_refusal {
                    return OriginRefusalReason::IncompatibleTcp {
                        entry: self.label.clone(),
                        tcp_entry: tcp_entry.clone(),
                    };
                }
                if web.handlers.len() != 1 {
                    if let Some(other_mount) = web
                        .handlers
                        .iter()
                        .filter(|(other_mount, _)| other_mount.as_str() != mount.as_str())
                        .map(|(other_mount, _)| other_mount)
                        .min()
                    {
                        return OriginRefusalReason::SharedHandler {
                            entry: self.label.clone(),
                            mount: other_mount.clone(),
                        };
                    }
                }
                if mount.as_str() != "/" {
                    return OriginRefusalReason::NonRootMount {
                        entry: self.label.clone(),
                        mount: (*mount).clone(),
                    };
                }
                if !https {
                    return OriginRefusalReason::NotHttps {
                        entry: self.label.clone(),
                    };
                }
                if !web
                    .handlers
                    .get(mount.as_str())
                    .is_some_and(|handler| target.is_canonical_proxy(&handler.proxy))
                {
                    return OriginRefusalReason::WrongProxy {
                        entry: self.label.clone(),
                    };
                }
                OriginRefusalReason::InvalidHost {
                    entry: self.label.clone(),
                }
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SocketIdentity {
    device: u64,
    inode: u64,
}

#[derive(Clone)]
pub enum ServeTarget {
    Unix {
        identity: SocketIdentity,
        path: PathBuf,
    },
    Loopback(MacFront),
}

impl std::fmt::Debug for ServeTarget {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unix { identity, path } => formatter
                .debug_struct("Unix")
                .field("identity", identity)
                .field("path", path)
                .finish(),
            Self::Loopback(front) => formatter.debug_tuple("Loopback").field(front).finish(),
        }
    }
}

impl ServeTarget {
    pub fn unix(path: impl Into<PathBuf>) -> std::io::Result<Self> {
        let path = path.into();
        let identity = socket_identity(&path)?;
        Ok(Self::Unix { identity, path })
    }

    pub fn loopback(front: MacFront) -> Self {
        Self::Loopback(front)
    }

    fn names(&self, proxy: &str) -> bool {
        match self {
            Self::Unix { identity, .. } => {
                let Some(path) = proxy.strip_prefix("unix:") else {
                    return false;
                };
                socket_identity(Path::new(path)).is_ok_and(|found| found == *identity)
            }
            Self::Loopback(front) => front.references_port(proxy),
        }
    }

    fn is_canonical_proxy(&self, proxy: &str) -> bool {
        match self {
            Self::Unix { .. } => self.names(proxy),
            Self::Loopback(front) => proxy == front.proxy_url(),
        }
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

#[cfg(test)]
mod tests {
    use super::{ServeConfig, ServeTarget};
    use crate::auth::MacFront;

    const SECRET: &str = "tether-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    fn serve(proxy: &str) -> ServeConfig {
        serde_json::from_value(serde_json::json!({
            "Web": {
                "devbox.ts.net:443": {
                    "HTTPS": true,
                    "Handlers": { "/": { "Proxy": proxy } }
                }
            },
            "AllowFunnel": { "devbox.ts.net:443": false }
        }))
        .expect("Serve config")
    }

    #[test]
    fn loopback_origin_requires_its_exact_proxy_url() {
        let target = ServeTarget::loopback(MacFront::new(7851, SECRET));
        let config = serve(&format!("http://127.0.0.1:7851/{SECRET}"));
        let origin = config.canonical_origin(&target).expect("origin");
        assert_eq!(origin.origin, "https://devbox.ts.net");
        assert_eq!(origin.authority, "devbox.ts.net");

        for proxy in [
            "http://0.0.0.0:7851/tether-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "http://127.0.0.1:7851/not-the-secret",
            "http://127.0.0.1:7852/tether-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        ] {
            assert!(serve(proxy).canonical_origin(&target).is_err(), "{proxy}");
        }

        let forwarded: ServeConfig = serde_json::from_value(serde_json::json!({
            "Web": {
                "devbox.ts.net:443": {
                    "HTTPS": true,
                    "Handlers": { "/": { "Proxy": format!("http://127.0.0.1:7851/{SECRET}") } }
                }
            },
            "TCP": { "2222": { "TCPForward": "127.0.0.1:7851" } },
            "AllowFunnel": { "devbox.ts.net:443": false }
        }))
        .expect("Serve config with a TCP forward");
        assert!(forwarded.canonical_origin(&target).is_err());
    }

    #[test]
    fn serve_target_and_config_debug_redact_loopback_secret() {
        let target = ServeTarget::loopback(MacFront::new(7851, SECRET));
        let config = serve(&format!("http://127.0.0.1:7851/{SECRET}"));
        assert!(!format!("{target:?}").contains(SECRET));
        assert!(!format!("{config:?}").contains(SECRET));
    }
}
