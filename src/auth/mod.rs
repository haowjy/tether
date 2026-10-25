//! Request admission over the two daemon fronts (auth.md). The socket selects the
//! native or node lane; `admit` is the one post-lookup policy for both.

use std::net::IpAddr;
use std::sync::{Arc, Mutex};

use axum::http::{HeaderMap, Method, header};
use thiserror::Error;
use tracing::{info, warn};

use crate::blocking::{Busy, Lane};

pub mod identity;
pub mod localapi;
pub mod mac_front;
pub mod node;
pub mod publish;
pub mod store;
pub mod token;

pub use identity::{CanonicalOrigin, IdentityError};
pub use mac_front::MacFront;
pub use store::{AuthFile, Device, DeviceKind, Store, StoreError};

/// The subprotocol that carries a native token on a WebSocket.
pub const SUBPROTOCOL_PREFIX: &str = "tether.auth.";

/// Whether a listener permits tokenless browser-node authentication.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeLane {
    Allowed,
    Refused,
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
    api: localapi::LocalApi,
    state: identity::TailnetStateCell,
    serve_target: Option<identity::ServeTarget>,
    publication: Option<publish::Publication>,
    logged_origin: Arc<Mutex<Option<String>>>,
}

impl Auth {
    pub fn with_local_api(
        store: Store,
        allow: Vec<String>,
        lane: Lane,
        api: localapi::LocalApi,
        serve_target: Option<identity::ServeTarget>,
        publication: Option<publish::Publication>,
    ) -> Self {
        let logged_origin = Arc::new(Mutex::new(None));
        let observed_target = serve_target.clone();
        let observed_origin = logged_origin.clone();
        let observed_publication = publication
            .as_ref()
            .map(|publication| publication.state().clone());
        let state = identity::TailnetStateCell::new(api.clone(), move |result| match result {
            Ok(state) => {
                if observed_publication.as_ref().is_some_and(|publication| {
                    !matches!(
                        &*publication.borrow(),
                        publish::PublicationState::Published(_)
                    )
                }) {
                    return;
                }
                let origin = identity::origin(observed_target.as_ref(), &state.serve);
                log_origin(&observed_origin, origin);
            }
            Err(error) => {
                if observed_publication.as_ref().is_none_or(|publication| {
                    matches!(
                        &*publication.borrow(),
                        publish::PublicationState::Published(_)
                    )
                }) {
                    log_unavailable(&observed_origin, error.to_string());
                }
            }
        });
        Self {
            store,
            explicit_allow: !allow.is_empty(),
            allow,
            lane,
            api,
            state,
            serve_target,
            publication,
            logged_origin,
        }
    }

    pub fn start(&self) {
        self.state.start();
        if let Some(publication) = self.publication.clone() {
            let api = self.api.clone();
            let state = self.state.clone();
            let target = self.serve_target.clone();
            let logged = self.logged_origin.clone();
            tokio::spawn(async move {
                let on_published = move |state: &identity::TailnetState| {
                    log_origin(&logged, identity::origin(target.as_ref(), &state.serve));
                };
                publish::run(api, state, publication, on_published).await;
            });
        }
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
            .last_known()
            .await
            .map(|state| state.machine_name().to_owned())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| fallback.to_owned())
    }

    pub async fn browser_origin(
        &self,
    ) -> Result<(Result<CanonicalOrigin, String>, bool), AuthError> {
        if let Some(publication) = &self.publication {
            match &*publication.state().borrow() {
                publish::PublicationState::Waiting { last_error } => {
                    return Ok((
                        Err(last_error
                            .as_deref()
                            .unwrap_or("waiting for tether's Serve publication")
                            .to_owned()),
                        true,
                    ));
                }
                publish::PublicationState::Refused(message) => {
                    return Ok((Err(message.clone()), false));
                }
                publish::PublicationState::Published(_) => {}
            }
        }
        let state = self.tailnet_state().await?;
        let origin = identity::origin(self.serve_target.as_ref(), &state.serve);
        log_origin(&self.logged_origin, origin.clone());
        Ok((origin.map_err(|refusal| refusal.message), false))
    }

    /// Whether this daemon sits behind Tailscale serve, so the browser's origin is knowable.
    pub fn serves_origin(&self) -> bool {
        self.serve_target.is_some()
    }

    pub async fn cached_browser_origin(&self) -> Option<CanonicalOrigin> {
        if let Some(publication) = &self.publication {
            if !matches!(
                &*publication.state().borrow(),
                publish::PublicationState::Published(_)
            ) {
                return None;
            }
        }
        let state = self
            .state
            .get()
            .await
            .ok()
            .or(self.state.last_known().await)?;
        identity::origin(self.serve_target.as_ref(), &state.serve).ok()
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
    /// node lane, which the HTTP front's lane view enables only on Serve listeners.
    pub async fn check(
        &self,
        node_lane: NodeLane,
        method: &Method,
        headers: &HeaderMap,
        upgrade: bool,
        login: &str,
        allow_unenrolled: bool,
    ) -> Result<Session, AuthError> {
        match presented(headers)? {
            Some(token) => self.check_native(token).await.map(Session::Native),
            None if node_lane == NodeLane::Refused => Err(AuthError::NoToken),
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

    async fn whois(&self, address: IpAddr) -> Result<localapi::Whois, AuthError> {
        self.api.whois(address).await.map_err(|error| match error {
            localapi::LocalApiError::Busy => AuthError::Busy,
            localapi::LocalApiError::NoPeer => AuthError::NodeRefused(node::Reason::UnknownNode),
            other => AuthError::IdentityUnavailable(other.to_string()),
        })
    }

    fn canonical_origin(
        &self,
        state: &identity::TailnetState,
    ) -> Result<CanonicalOrigin, AuthError> {
        let result =
            identity::origin(self.serve_target.as_ref(), &state.serve).map_err(|refusal| {
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
