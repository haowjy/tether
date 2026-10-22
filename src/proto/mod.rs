//! The wire protocol (daemon-core.md §5): JSON messages in text frames, pane bytes in
//! binary frames, and the version range. A leaf: it names no other tether module.
//! The TypeScript types in `web/proto/generated/` are rendered from these.

pub mod auth;
pub mod frames;
mod messages;
#[cfg(test)]
mod typescript;

pub use messages::*;

/// The protocol this daemon speaks; the newest a client may speak.
pub const PROTOCOL_VERSION: u32 = 1;
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
}

impl CloseCode {
    pub const ALL: [Self; 8] = [
        Self::Idle,
        Self::Incompatible,
        Self::Wedged,
        Self::ProtocolViolation,
        Self::Shutdown,
        Self::OverCap,
        Self::TooLarge,
        Self::BadToken,
    ];

    pub fn code(self) -> u16 {
        self as u16
    }
}
