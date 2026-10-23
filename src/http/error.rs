//! Every HTTP refusal (fs.md "Errors", auth.md "Endpoints"): an `HttpError` in the JSON
//! error body, with its status and the headers `busy` and `bad_range` carry. Built from
//! a code, a JSON body axum refused, an `FsError` or an `AuthError`.

use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};

use crate::auth::AuthError;
use crate::fs::FsError;
use crate::proto::{CloseCode, ErrorBody, ErrorNode, HttpError};

#[derive(Debug)]
pub(super) struct Refusal {
    status: StatusCode,
    error: HttpError,
    reason: Option<String>,
    node: Option<ErrorNode>,
    /// A 416's file size, for `Content-Range: bytes */<size>`.
    size: Option<u64>,
}

/// The code, with its status.
impl From<HttpError> for Refusal {
    fn from(error: HttpError) -> Self {
        use HttpError::*;
        let status = match error {
            BadRequest => StatusCode::BAD_REQUEST,
            AuthRequired | NotEnrolled => StatusCode::UNAUTHORIZED,
            Forbidden | BadOrigin | NodeRefused | BadCode | OutsideRoots | OutsideHome | Denied => {
                StatusCode::FORBIDDEN
            }
            NotFound => StatusCode::NOT_FOUND,
            NotADirectory | NotAFile | MemoryBacked | ConfigReadOnly => StatusCode::CONFLICT,
            TooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            BadRange => StatusCode::RANGE_NOT_SATISFIABLE,
            Busy | AuthUnavailable | IdentityUnavailable | ConfigUnavailable => {
                StatusCode::SERVICE_UNAVAILABLE
            }
            NoSpace => StatusCode::INSUFFICIENT_STORAGE,
            Internal => StatusCode::INTERNAL_SERVER_ERROR,
        };
        Self {
            status,
            error,
            reason: None,
            node: None,
            size: None,
        }
    }
}

/// A body over the route's cap is `too_large`; any other that isn't the route's JSON is
/// `bad_request`, with axum's status (415 for no JSON content type, 400 or 422 for JSON
/// that doesn't parse or doesn't fit).
impl From<JsonRejection> for Refusal {
    fn from(rejection: JsonRejection) -> Self {
        let status = rejection.status();
        let error = if status == StatusCode::PAYLOAD_TOO_LARGE {
            HttpError::TooLarge
        } else {
            HttpError::BadRequest
        };
        Self {
            status,
            error,
            reason: None,
            node: None,
            size: None,
        }
    }
}

impl From<FsError> for Refusal {
    fn from(refused: FsError) -> Self {
        let size = match refused {
            FsError::BadRange { size } => Some(size),
            _ => None,
        };
        Self {
            size,
            ..Self::from(HttpError::from(&refused))
        }
    }
}

impl From<&FsError> for HttpError {
    fn from(refused: &FsError) -> Self {
        match refused {
            FsError::BadRequest => Self::BadRequest,
            FsError::OutsideRoots => Self::OutsideRoots,
            FsError::OutsideHome => Self::OutsideHome,
            FsError::Denied => Self::Denied,
            FsError::NotFound => Self::NotFound,
            FsError::NotADirectory => Self::NotADirectory,
            FsError::NotAFile => Self::NotAFile,
            FsError::MemoryBacked => Self::MemoryBacked,
            FsError::ConfigReadOnly(_) => Self::ConfigReadOnly,
            FsError::TooLarge => Self::TooLarge,
            FsError::BadRange { .. } => Self::BadRange,
            FsError::Busy => Self::Busy,
            FsError::ConfigUnavailable(_) => Self::ConfigUnavailable,
            FsError::NoSpace => Self::NoSpace,
            FsError::Internal(_) => Self::Internal,
        }
    }
}

/// A failed device check over HTTP; a socket gets `CloseCode::from` instead.
impl From<&AuthError> for Refusal {
    fn from(refused: &AuthError) -> Self {
        let mut response = Self::from(HttpError::from(refused));
        match refused {
            AuthError::NodeRefused(reason) => {
                response.reason = Some(reason.as_str().to_owned());
            }
            AuthError::NotEnrolled { node_name } => {
                response.node = Some(ErrorNode {
                    name: node_name.clone(),
                });
            }
            _ => {}
        }
        response
    }
}

impl From<&AuthError> for HttpError {
    fn from(refused: &AuthError) -> Self {
        match refused {
            AuthError::NoToken | AuthError::Ambiguous | AuthError::Unknown => Self::AuthRequired,
            AuthError::BadOrigin => Self::BadOrigin,
            AuthError::Forbidden => Self::Forbidden,
            AuthError::NodeRefused(_) => Self::NodeRefused,
            AuthError::NotEnrolled { .. } => Self::NotEnrolled,
            AuthError::IdentityUnavailable(_) => Self::IdentityUnavailable,
            AuthError::Store(_) | AuthError::Busy => Self::AuthUnavailable,
        }
    }
}

/// A failed device check on a socket: a browser can't see a refused upgrade's status.
impl From<&AuthError> for CloseCode {
    fn from(refused: &AuthError) -> Self {
        match refused {
            AuthError::Store(_) | AuthError::Busy | AuthError::IdentityUnavailable(_) => {
                Self::AuthUnavailable
            }
            AuthError::NoToken
            | AuthError::Ambiguous
            | AuthError::Unknown
            | AuthError::BadOrigin
            | AuthError::Forbidden
            | AuthError::NodeRefused(_)
            | AuthError::NotEnrolled { .. } => Self::BadToken,
        }
    }
}

impl IntoResponse for Refusal {
    fn into_response(self) -> Response {
        let mut response = (
            self.status,
            Json(ErrorBody {
                error: self.error,
                reason: self.reason,
                node: self.node,
            }),
        )
            .into_response();
        let headers = response.headers_mut();
        if self.error == HttpError::Busy {
            headers.insert(header::RETRY_AFTER, HeaderValue::from_static("1"));
        }
        if let Some(range) = self
            .size
            .and_then(|size| HeaderValue::from_str(&format!("bytes */{size}")).ok())
        {
            headers.insert(header::CONTENT_RANGE, range);
        }
        response
    }
}
