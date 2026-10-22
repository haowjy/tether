//! Who may use the daemon (auth.md): the Tailscale login check, and a device token on
//! every route but the two enrolment routes. Plain functions over the state file: no
//! task, no cache. `http/` calls `identity` and `check` from its middleware, and each
//! connection calls `recheck` on its own timer.

use std::net::SocketAddr;

use axum::http::{HeaderMap, header};
use thiserror::Error;

use crate::blocking::{Busy, Lane};

pub mod identity;
pub mod store;
pub mod token;

pub use identity::IdentityError;
pub use store::{AuthFile, Device, Store, StoreError};

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
    /// The auth lane gave no thread in time: fails like `Store`.
    #[error("auth.toml wasn't read in time")]
    Busy,
}

impl From<Busy> for AuthError {
    fn from(Busy: Busy) -> Self {
        Self::Busy
    }
}

pub struct Auth {
    store: Store,
    allow: Vec<String>,
    /// The auth lane, for the reads.
    lane: Lane,
}

impl Auth {
    /// `allow`: the Tailscale logins let through. `lane`: the auth lane.
    pub fn new(store: Store, allow: Vec<String>, lane: Lane) -> Self {
        Self { store, allow, lane }
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
        let file = self.read().await?;
        token::find(&file.devices, &hash)
            .cloned()
            .ok_or(AuthError::Unknown)
    }

    /// `check` again for the device it let in: a live socket's re-check. `Unknown` once
    /// the device is removed.
    pub async fn recheck(&self, device: &Device) -> Result<(), AuthError> {
        let hash = token::unhex(&device.token_sha256).ok_or(AuthError::Unknown)?;
        let file = self.read().await?;
        token::find(&file.devices, &hash)
            .map(drop)
            .ok_or(AuthError::Unknown)
    }

    /// `auth.toml` as it is now, read on the auth lane.
    async fn read(&self) -> Result<AuthFile, AuthError> {
        let store = self.store.clone();
        Ok(self.lane.run(move || store.read()).await??)
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
