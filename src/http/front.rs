//! A listener's trust boundary: its available lanes and the gate before routing.

use axum::http::{Request, header};
use axum::response::{IntoResponse as _, Response};

use super::{common_headers, error::Refusal, shell};
use crate::auth::NodeLane;
use crate::proto::HttpError;

#[derive(Debug)]
pub enum Front {
    UnixServe,
    Local,
}

impl Front {
    pub(super) const fn node_lane(&self) -> NodeLane {
        match self {
            Self::UnixServe => NodeLane::Allowed,
            Self::Local => NodeLane::Refused,
        }
    }

    /// Runs before routing so even fallback and shell paths pass the listener's gate.
    pub(super) fn gate<B>(&self, request: &mut Request<B>) -> Option<Response> {
        match self {
            Self::Local => None,
            Self::UnixServe
                if request
                    .headers()
                    .get(header::HOST)
                    .and_then(|value| value.to_str().ok())
                    == Some("localhost") =>
            {
                None
            }
            Self::UnixServe => {
                let shell_path = shell::is_shell_path(request.uri().path());
                let mut response = Refusal::from(HttpError::Forbidden).into_response();
                common_headers(&mut response, shell_path);
                Some(response)
            }
        }
    }
}
