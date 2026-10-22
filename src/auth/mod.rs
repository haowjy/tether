//! Who may use the daemon (auth.md): the Tailscale login check, and a device token on
//! every route but the two enrolment routes. Plain functions over the state file: no
//! task, no cache. `http/` calls `identity` and `check` from its middleware, and each
//! connection calls `still_enrolled` on its own timer.

use std::net::SocketAddr;

use axum::http::{HeaderMap, header};
use thiserror::Error;

pub mod identity;
pub mod store;
pub mod token;

pub use identity::IdentityError;
pub use store::{Device, Store, StoreError};

/// The subprotocol that carries the token on a WebSocket: `tether.auth.<token>`.
pub const SUBPROTOCOL_PREFIX: &str = "tether.auth.";

#[derive(Debug, Error)]
pub enum AuthError {
    #[error("no device token")]
    NoToken,
    #[error("unknown or revoked device token")]
    Unknown,
    /// The file is unreadable or doesn't parse: every token check fails until it does.
    #[error(transparent)]
    Store(#[from] StoreError),
}

pub struct Auth {
    store: Store,
    allow: Vec<String>,
}

impl Auth {
    /// `allow`: the Tailscale logins let through.
    pub fn new(store: Store, allow: Vec<String>) -> Self {
        Self { store, allow }
    }

    pub fn store(&self) -> &Store {
        &self.store
    }

    /// The Tailscale check, on every route: returns the login.
    pub fn identity(&self, peer: SocketAddr, headers: &HeaderMap) -> Result<String, IdentityError> {
        identity::check(&self.allow, peer, headers)
    }

    /// The device check: the token from `Authorization: Bearer`, or on a WebSocket
    /// upgrade from the `tether.auth.<token>` subprotocol, against `auth.toml` as it is
    /// on disk now.
    pub async fn check(&self, headers: &HeaderMap) -> Result<Device, AuthError> {
        let token = presented(headers).ok_or(AuthError::NoToken)?;
        let hash = token::hash(token);
        let file = self.store.read_async().await?;
        token::find(&file.devices, &hash)
            .cloned()
            .ok_or(AuthError::Unknown)
    }

    /// Whether `device`'s token is still enrolled: a live socket's re-check.
    pub async fn still_enrolled(&self, device: &Device) -> Result<bool, StoreError> {
        let file = self.store.read_async().await?;
        Ok(file
            .devices
            .iter()
            .any(|enrolled| enrolled.token_sha256 == device.token_sha256))
    }
}

fn presented(headers: &HeaderMap) -> Option<&str> {
    let bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    let subprotocol = || {
        headers
            .get_all(header::SEC_WEBSOCKET_PROTOCOL)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .flat_map(|value| value.split(','))
            .find_map(|protocol| protocol.trim().strip_prefix(SUBPROTOCOL_PREFIX))
    };
    bearer
        .or_else(subprotocol)
        .filter(|token| !token.is_empty())
}
