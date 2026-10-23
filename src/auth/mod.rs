//! Request admission over the two daemon fronts (auth.md). The socket selects the
//! native or node lane; `admit` is the one post-lookup policy for both.

use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use axum::http::{HeaderMap, Method, header};
use thiserror::Error;
use tracing::{info, warn};

use crate::blocking::{Busy, Lane};

pub mod identity;
pub mod node;
pub mod store;
pub mod token;

pub use identity::{CanonicalOrigin, IdentityError};
pub use store::{AuthFile, Device, DeviceKind, Store, StoreError};

/// The subprotocol that carries a native token on a WebSocket.
pub const SUBPROTOCOL_PREFIX: &str = "tether.auth.";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Front {
    Serve,
    Local,
}

#[derive(Debug, Error)]
pub enum AuthError {
    #[error("no device token")]
    NoToken,
    #[error("ambiguous device credentials")]
    Ambiguous,
    #[error("unknown or revoked device")]
    Unknown,
    #[error("browser origin is not admitted")]
    BadOrigin,
    #[error("request headers do not describe a tailnet node")]
    Forbidden,
    #[error("node refused: {0}")]
    NodeRefused(node::Reason),
    #[error("node {node_name} is not enrolled")]
    NotEnrolled { node_name: String },
    #[error("tailnet identity is unavailable: {0}")]
    IdentityUnavailable(String),
    /// The file is unreadable or doesn't parse: every device check fails until it does.
    #[error(transparent)]
    Store(#[from] StoreError),
    /// A bounded lane or the whois queue gave no capacity in time.
    #[error("auth check is busy")]
    Busy,
}

impl From<Busy> for AuthError {
    fn from(_: Busy) -> Self {
        Self::Busy
    }
}

#[derive(Debug, Clone)]
pub enum Session {
    Native(Device),
    Node {
        device: Device,
        node: node::Node,
        origin: CanonicalOrigin,
    },
    NodeUnenrolled {
        node: node::Node,
        origin: CanonicalOrigin,
    },
}

impl Session {
    pub fn device(&self) -> Option<&Device> {
        match self {
            Self::Native(device) | Self::Node { device, .. } => Some(device),
            Self::NodeUnenrolled { .. } => None,
        }
    }
}

/// The policy seam shared by initial checks and live-socket re-checks. This phase
/// grants full access to every valid device row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Grant {
    Full,
}

pub fn admit(device: &Device, _now: std::time::SystemTime) -> Result<Grant, AuthError> {
    if device.valid() {
        Ok(Grant::Full)
    } else {
        Err(AuthError::Unknown)
    }
}

#[derive(Clone)]
pub struct Auth {
    store: Store,
    allow: Vec<String>,
    explicit_allow: bool,
    lane: Lane,
    api: identity::LocalApi,
    state: identity::TailnetStateCell,
    serve_socket: Option<identity::SocketIdentity>,
    serve_path: Option<PathBuf>,
    logged_origin: Arc<Mutex<Option<String>>>,
}

impl Auth {
    pub fn with_local_api(
        store: Store,
        allow: Vec<String>,
        lane: Lane,
        api: identity::LocalApi,
        serve_socket: Option<&Path>,
    ) -> Self {
        let serve_path = serve_socket.map(Path::to_owned);
        let serve_socket = serve_path
            .as_deref()
            .and_then(|path| identity::SocketIdentity::of(path).ok());
        let logged_origin = Arc::new(Mutex::new(None));
        let observed_path = serve_path.clone();
        let observed_origin = logged_origin.clone();
        let state = identity::TailnetStateCell::new(api.clone(), move |result| match result {
            Ok(state) => {
                let origin = serve_socket.zip(observed_path.as_deref()).map_or_else(
                    || {
                        Err(identity::OriginRefusal {
                            message: "tether's serve.sock is not bound".to_owned(),
                        })
                    },
                    |(socket, path)| state.serve.canonical_origin(socket, path),
                );
                log_origin(&observed_origin, origin);
            }
            Err(error) => log_unavailable(&observed_origin, error.to_string()),
        });
        Self {
            store,
            explicit_allow: !allow.is_empty(),
            allow,
            lane,
            api,
            state,
            serve_socket,
            serve_path,
            logged_origin,
        }
    }

    pub fn start(&self) {
        self.state.start();
    }

    pub fn store(&self) -> &Store {
        &self.store
    }

    pub async fn tailnet_state(&self) -> Result<identity::TailnetState, AuthError> {
        self.state
            .get()
            .await
            .map_err(|error| AuthError::IdentityUnavailable(error.to_string()))
    }

    pub async fn machine_name(&self, fallback: &str) -> String {
        self.state
            .get()
            .await
            .ok()
            .or(self.state.last_known().await)
            .map(|state| state.machine_name().to_owned())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| fallback.to_owned())
    }

    pub async fn browser_origin(&self) -> Result<Result<CanonicalOrigin, String>, AuthError> {
        let state = self.tailnet_state().await?;
        let Some(socket) = self.serve_socket else {
            return Ok(Err("tether's serve.sock is not bound".to_owned()));
        };
        let path = self
            .serve_path
            .as_deref()
            .unwrap_or(Path::new("serve.sock"));
        let origin = state.serve.canonical_origin(socket, path);
        log_origin(&self.logged_origin, origin.clone());
        Ok(origin.map_err(|refusal| refusal.message))
    }

    pub async fn cached_browser_origin(&self) -> Option<CanonicalOrigin> {
        let state = self
            .state
            .get()
            .await
            .ok()
            .or(self.state.last_known().await)?;
        let socket = self.serve_socket?;
        let path = self
            .serve_path
            .as_deref()
            .unwrap_or(Path::new("serve.sock"));
        state.serve.canonical_origin(socket, path).ok()
    }

    /// The Tailscale check, on every route of both fronts.
    pub async fn identity(&self, headers: &HeaderMap) -> Result<String, IdentityError> {
        let state = if self.explicit_allow {
            None
        } else {
            Some(
                self.state
                    .get()
                    .await
                    .map_err(|error| IdentityError::Unavailable(error.to_string()))?,
            )
        };
        identity::check_login(&self.allow, self.explicit_allow, state.as_ref(), headers)
    }

    /// Authenticates one request after the Tailscale login check. Credentials always
    /// select native, even when invalid; only a request with no credential may try the
    /// node lane, and that lane exists on `serve.sock` only.
    pub async fn check(
        &self,
        front: Front,
        method: &Method,
        headers: &HeaderMap,
        upgrade: bool,
        login: &str,
        allow_unenrolled: bool,
    ) -> Result<Session, AuthError> {
        match presented(headers)? {
            Some(token) => self.check_native(token).await.map(Session::Native),
            None if front == Front::Local => Err(AuthError::NoToken),
            None => {
                self.check_node(method, headers, upgrade, login, allow_unenrolled)
                    .await
            }
        }
    }

    async fn check_native(&self, presented: &str) -> Result<Device, AuthError> {
        let hash = token::hash(presented);
        let file = self.read().await?;
        let device = token::find(&file.devices, &hash)
            .filter(|device| device.kind == DeviceKind::Native)
            .cloned()
            .ok_or(AuthError::Unknown)?;
        admit(&device, std::time::SystemTime::now())?;
        Ok(device)
    }

    async fn check_node(
        &self,
        method: &Method,
        headers: &HeaderMap,
        upgrade: bool,
        login: &str,
        allow_unenrolled: bool,
    ) -> Result<Session, AuthError> {
        let state = self.tailnet_state().await?;
        let origin = self.canonical_origin(&state)?;
        node::admission(method, upgrade, headers, &origin).map_err(map_node_error)?;
        let address = node::forwarded_addr(headers).map_err(map_node_error)?;
        let whois = self.whois(address).await?;
        let node = match node::node_rules(&whois, address, login, &state.self_id) {
            Ok(node) => node,
            Err(error) => {
                let stable_id = whois
                    .node
                    .as_ref()
                    .map_or("unknown", |node| node.stable_id.as_str());
                warn!(stable_id, %error, "refused a Tailscale node");
                return Err(map_node_error(error));
            }
        };
        let file = self.read().await?;
        let device = file
            .devices
            .iter()
            .find(|device| {
                device.kind == DeviceKind::Node
                    && device.node_id.as_deref() == Some(node.id.as_str())
                    && device.login.as_deref() == Some(node.login.as_str())
            })
            .cloned();
        let Some(device) = device else {
            warn!(stable_id = %node.id, "Tailscale node is not enrolled");
            return if allow_unenrolled {
                Ok(Session::NodeUnenrolled { node, origin })
            } else {
                Err(AuthError::NotEnrolled {
                    node_name: node.name,
                })
            };
        };
        admit(&device, std::time::SystemTime::now())?;
        Ok(Session::Node {
            device,
            node,
            origin,
        })
    }

    pub async fn recheck(&self, session: &Session) -> Result<(), AuthError> {
        match session {
            Session::Native(device) => {
                let hash = device
                    .token_sha256
                    .as_deref()
                    .filter(|_| device.kind == DeviceKind::Native)
                    .and_then(token::unhex)
                    .ok_or(AuthError::Unknown)?;
                let file = self.read().await?;
                let current = token::find(&file.devices, &hash).ok_or(AuthError::Unknown)?;
                admit(current, std::time::SystemTime::now())?;
                Ok(())
            }
            Session::Node {
                device,
                node,
                origin,
            } => {
                let file = self.read().await?;
                let current = file.devices.iter().find(|current| {
                    current.kind == DeviceKind::Node
                        && current.node_id == device.node_id
                        && current.login == device.login
                });
                let Some(current) = current else {
                    return Err(AuthError::Unknown);
                };
                admit(current, std::time::SystemTime::now())?;
                let state = self.tailnet_state().await?;
                match self.canonical_origin(&state) {
                    Ok(current) if current == *origin => {}
                    _ => return Err(AuthError::Unknown),
                }
                let whois = self
                    .whois(node.address)
                    .await
                    .map_err(|error| match error {
                        AuthError::Busy => {
                            AuthError::IdentityUnavailable("whois queue is full".into())
                        }
                        other => other,
                    })?;
                let current = node::node_rules(&whois, node.address, &node.login, &state.self_id)
                    .map_err(|_| AuthError::Unknown)?;
                if current.id != node.id || current.login != node.login {
                    return Err(AuthError::Unknown);
                }
                Ok(())
            }
            Session::NodeUnenrolled { .. } => Err(AuthError::Unknown),
        }
    }

    async fn whois(&self, address: IpAddr) -> Result<identity::Whois, AuthError> {
        self.api.whois(address).await.map_err(|error| match error {
            identity::LocalApiError::Busy => AuthError::Busy,
            identity::LocalApiError::NoPeer => AuthError::NodeRefused(node::Reason::UnknownNode),
            other => AuthError::IdentityUnavailable(other.to_string()),
        })
    }

    fn canonical_origin(
        &self,
        state: &identity::TailnetState,
    ) -> Result<CanonicalOrigin, AuthError> {
        let socket = self.serve_socket.ok_or(AuthError::BadOrigin)?;
        let path = self
            .serve_path
            .as_deref()
            .unwrap_or(Path::new("serve.sock"));
        let result = state
            .serve
            .canonical_origin(socket, path)
            .map_err(|refusal| {
                log_origin(&self.logged_origin, Err(refusal.clone()));
                AuthError::BadOrigin
            });
        if let Ok(origin) = &result {
            log_origin(&self.logged_origin, Ok(origin.clone()));
        }
        result
    }

    /// `auth.toml` as it is now, read on the auth lane.
    async fn read(&self) -> Result<AuthFile, AuthError> {
        let store = self.store.clone();
        Ok(self.lane.run(move || store.read()).await??)
    }
}

fn log_origin(
    logged: &Arc<Mutex<Option<String>>>,
    origin: Result<CanonicalOrigin, identity::OriginRefusal>,
) {
    let (description, refused) = match origin {
        Ok(origin) => (format!("canonical origin {}", origin.origin), false),
        Err(refusal) => (refusal.message, true),
    };
    let Ok(mut previous) = logged.lock() else {
        return;
    };
    if previous.as_deref() == Some(&description) {
        return;
    }
    if refused {
        warn!(message = %description, "browser origin is unavailable");
    } else {
        info!(message = %description, "browser origin is configured");
    }
    *previous = Some(description);
}

fn log_unavailable(logged: &Arc<Mutex<Option<String>>>, message: String) {
    let Ok(mut previous) = logged.lock() else {
        return;
    };
    if previous.as_deref() != Some("tailnet state unavailable") {
        warn!(%message, "tailnet state unavailable");
        *previous = Some("tailnet state unavailable".to_owned());
    }
}

fn map_node_error(error: node::Error) -> AuthError {
    match error {
        node::Error::BadOrigin => AuthError::BadOrigin,
        node::Error::ForwardedAddress => AuthError::Forbidden,
        node::Error::Refused(reason) => AuthError::NodeRefused(reason),
    }
}

/// `None` means there was no credential and the caller may try the node lane. Any
/// malformed or ambiguous credential is a native-lane refusal, never a fallback.
fn presented(headers: &HeaderMap) -> Result<Option<&str>, AuthError> {
    let auth = headers.get_all(header::AUTHORIZATION);
    let auth_count = auth.iter().count();
    let subprotocol_values = headers.get_all(header::SEC_WEBSOCKET_PROTOCOL);
    let has_subprotocol_token = subprotocol_values.iter().any(|value| {
        value.to_str().is_ok_and(|value| {
            value
                .split(',')
                .any(|part| part.trim().starts_with(SUBPROTOCOL_PREFIX))
        })
    });
    let mut subprotocols = headers
        .get_all(header::SEC_WEBSOCKET_PROTOCOL)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .filter_map(|value| value.trim().strip_prefix(SUBPROTOCOL_PREFIX));
    let token = subprotocols.next();
    if auth_count > 1
        || token.is_some() && subprotocols.next().is_some()
        || auth_count > 0 && has_subprotocol_token
    {
        return Err(AuthError::Ambiguous);
    }
    if auth_count == 1 {
        let value = auth.iter().next().and_then(|value| value.to_str().ok());
        let token = value
            .and_then(|value| {
                let (scheme, token) = value.split_once(' ')?;
                scheme.eq_ignore_ascii_case("bearer").then_some(token)
            })
            .filter(|token| !token.is_empty())
            .ok_or(AuthError::NoToken)?;
        return Ok(Some(token));
    }
    if has_subprotocol_token && token.is_none() {
        return Err(AuthError::NoToken);
    }
    Ok(match token {
        Some("") => return Err(AuthError::NoToken),
        other => other,
    })
}
