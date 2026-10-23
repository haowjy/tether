//! The error body every HTTP route shares (fs.md "Errors", auth.md "Endpoints",
//! complete.md "Request and response"): `{"error": "<code>"}`. Swift mirrors it by hand.

use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Every HTTP error body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ErrorBody {
    pub error: HttpError,
}

/// Every code an HTTP route answers with. Each has one status (`src/http/error.rs`),
/// except `bad_request` for a body that isn't the route's JSON, which takes axum's.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum HttpError {
    BadRequest,
    /// No device token, or one `auth.toml` doesn't hold: the app drops its token.
    AuthRequired,
    /// The Tailscale check failed.
    Forbidden,
    /// A wrong, expired or used enrolment code.
    BadCode,
    OutsideRoots,
    OutsideHome,
    Denied,
    NotFound,
    NotADirectory,
    NotAFile,
    /// Upload target is backed by tmpfs or ramfs.
    MemoryBacked,
    ConfigReadOnly,
    TooLarge,
    BadRange,
    /// Retry after the `Retry-After` header's seconds.
    Busy,
    /// `auth.toml` can't be read: the token isn't refused, and the app retries with it.
    AuthUnavailable,
    ConfigUnavailable,
    NoSpace,
    /// Logged, never described.
    Internal,
}

/// The code as on the wire, for logs.
impl fmt::Display for HttpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.serialize(f)
    }
}
