//! The `/auth/*` bodies (auth.md "Endpoints"). The web never sends them, so they have
//! no TypeScript; Swift mirrors them by hand.

use serde::{Deserialize, Serialize};

/// `GET /auth/info`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthInfo {
    pub host_id: String,
    pub name: String,
    pub daemon_version: String,
    pub protocol: ProtocolRange,
}

/// The protocol versions the daemon accepts, as in `hello`'s check.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProtocolRange {
    pub min: u32,
    pub max: u32,
}

/// `POST /auth/enroll`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollRequest {
    pub code: String,
    pub device_name: String,
}

/// The token is shown once; the daemon keeps only its hash. `device_name` is the name
/// the device got, which may carry a `-2` suffix.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollResponse {
    pub token: String,
    pub device_name: String,
}

/// Every HTTP error body: `{"error": "<code>"}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ErrorBody {
    pub error: String,
}
