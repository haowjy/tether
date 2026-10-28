//! The error body every HTTP route shares (fs.md "Errors", auth.md "Endpoints",
//! complete.md "Request and response"): `{"error": "<code>"}`. Swift mirrors it by hand.

use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Every HTTP error body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ErrorBody {
    pub error: HttpError,
    /// Present for `node_refused`, so the browser can explain the permanent refusal.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reason: Option<String>,
    /// Present for `not_enrolled`, so the browser can name the node to enrol.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub node: Option<ErrorNode>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ErrorNode {
    pub name: String,
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
    /// The browser request did not match the published Serve origin.
    BadOrigin,
    /// The Tailscale node cannot be enrolled.
    NodeRefused,
    /// The Tailscale node has not been enrolled.
    NotEnrolled,
    /// A wrong, expired or used enrolment code.
    BadCode,
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
    /// LocalAPI could not resolve the current Tailscale identity.
    IdentityUnavailable,
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
