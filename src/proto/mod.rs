//! The wire protocol (daemon-core.md §5): JSON messages in text frames, pane bytes in
//! binary frames, and the version range. A leaf: it names no other tether module.
//! The TypeScript types in `web/proto/generated/` are rendered from these.

pub mod auth;
pub mod complete;
mod error;
pub mod frames;
pub mod fs;
mod messages;
#[cfg(test)]
mod typescript;

pub use error::{ErrorBody, ErrorNode, HttpError};
pub use messages::*;

/// The protocol this daemon speaks; the newest a client may speak.
pub const PROTOCOL_VERSION: u32 = 2;
/// The oldest protocol a client may speak.
pub const MIN_PROTOCOL: u32 = 1;

/// Whether a client speaking `protocol` gets `welcome` (else `incompatible`, 4001).
pub fn accepts(protocol: u32) -> bool {
    (MIN_PROTOCOL..=PROTOCOL_VERSION).contains(&protocol)
}

/// WebSocket close codes (§5.2). The client reconnects after any of them except
/// `Incompatible` and `BadToken`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u16)]
pub enum CloseCode {
    Idle = 4000,
    Incompatible = 4001,
    /// The hub's channel to the connection filled, or control JSON passed its overdraft.
    Wedged = 4002,
    /// Including no `hello` in time.
    ProtocolViolation = 4003,
    Shutdown = 4004,
    OverCap = 4005,
    TooLarge = 4009,
    BadToken = 4401,
    /// The daemon can't read its device list, so it can't check the token: the token
    /// isn't refused, and the client keeps it and retries.
    AuthUnavailable = 4503,
}

impl CloseCode {
    pub const ALL: [Self; 9] = [
        Self::Idle,
        Self::Incompatible,
        Self::Wedged,
        Self::ProtocolViolation,
        Self::Shutdown,
        Self::OverCap,
        Self::TooLarge,
        Self::BadToken,
        Self::AuthUnavailable,
    ];

    pub fn code(self) -> u16 {
        self as u16
    }
}
