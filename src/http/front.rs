//! A listener's trust boundary: its available lanes and the gate before routing.

use std::fmt;

use axum::body::Body;
use axum::http::{HeaderMap, Request, StatusCode, Uri, header};
use axum::response::{IntoResponse as _, Response};
use subtle::ConstantTimeEq as _;
use tokio::sync::watch;

use super::{common_headers, error::Refusal, shell};
use crate::auth::NodeLane;
use crate::auth::publish::PublicationState;
use crate::proto::HttpError;

pub enum Front {
    UnixServe,
    Local,
    Loopback {
        secret_prefix: Box<[u8]>,
        publication: watch::Receiver<PublicationState>,
    },
}

impl fmt::Debug for Front {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnixServe => formatter.write_str("UnixServe"),
            Self::Local => formatter.write_str("Local"),
            Self::Loopback { .. } => formatter
                .debug_struct("Loopback")
                .field("secret", &"<redacted>")
                .field("authority", &"<published authority>")
                .finish(),
        }
    }
}

impl Front {
    pub fn loopback(secret: &str, publication: watch::Receiver<PublicationState>) -> Self {
        let prefix = format!("/{secret}/").into_bytes().into_boxed_slice();
        Self::Loopback {
            secret_prefix: prefix,
            publication,
        }
    }

    pub(super) const fn node_lane(&self) -> NodeLane {
        match self {
            Self::UnixServe | Self::Loopback { .. } => NodeLane::Allowed,
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
                Some(refusal(HttpError::Forbidden, shell_path))
            }
            Self::Loopback {
                secret_prefix,
                publication,
            } => loopback_gate(request, secret_prefix, publication),
        }
    }
}

fn loopback_gate<B>(
    request: &mut Request<B>,
    secret_prefix: &[u8],
    publication: &watch::Receiver<PublicationState>,
) -> Option<Response> {
    let uri = request.uri();
    if uri.scheme().is_some() || uri.authority().is_some() {
        return Some(empty_not_found());
    }
    let raw_target = uri
        .path_and_query()
        .map(|path| path.as_str())
        .unwrap_or("/");
    let target = raw_target.as_bytes();
    let matches = target
        .get(..secret_prefix.len())
        .is_some_and(|candidate| bool::from(candidate.ct_eq(secret_prefix)));
    if !matches {
        return Some(empty_not_found());
    }

    let remainder = &raw_target[secret_prefix.len()..];
    let (path, query) = remainder.split_once('?').unwrap_or((remainder, ""));
    let mut rewritten = if path.is_empty() {
        "/".to_owned()
    } else {
        format!("/{path}")
    };
    if !query.is_empty() || remainder.ends_with('?') {
        rewritten.push('?');
        rewritten.push_str(query);
    }
    let Ok(uri) = rewritten.parse::<Uri>() else {
        return Some(empty_not_found());
    };
    *request.uri_mut() = uri;

    let shell_path = shell::is_shell_path(request.uri().path());
    let host = one_header(request.headers(), "host");
    let forwarded = one_header(request.headers(), "x-forwarded-host");
    let published = match &*publication.borrow() {
        PublicationState::Waiting { .. } | PublicationState::Refused(_) => {
            return Some(refusal(HttpError::IdentityUnavailable, shell_path));
        }
        PublicationState::Published(authority) => authority.clone(),
    };
    let allowed = host.zip(forwarded).is_some_and(|(host, forwarded)| {
        host.eq_ignore_ascii_case(forwarded) && authority_matches(host, &published)
    });
    if allowed {
        None
    } else {
        Some(refusal(HttpError::Forbidden, shell_path))
    }
}

fn one_header<'a>(headers: &'a HeaderMap, name: &'static str) -> Option<&'a str> {
    let mut values = headers.get_all(name).iter();
    let value = values.next()?;
    if values.next().is_some() {
        return None;
    }
    value.to_str().ok()
}

fn authority_matches(candidate: &str, expected: &str) -> bool {
    let expected_host = expected.strip_suffix(":443").unwrap_or(expected);
    let candidate_host = candidate.strip_suffix(":443").unwrap_or(candidate);
    candidate_host.eq_ignore_ascii_case(expected_host)
}

fn refusal(error: HttpError, shell_path: bool) -> Response {
    let mut response = Refusal::from(error).into_response();
    common_headers(&mut response, shell_path);
    response
}

fn empty_not_found() -> Response {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Body::empty())
        .expect("a static 404 response is valid")
}

#[cfg(test)]
mod tests {
    use axum::body::to_bytes;
    use axum::http::{HeaderValue, Request, StatusCode};
    use std::sync::Arc;
    use tokio::sync::watch;

    use crate::auth::publish::PublicationState;

    use super::Front;

    const SECRET: &str = "tether-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const AUTHORITY: &str = "devbox.ts.net:443";

    fn front(authority: Option<&str>) -> Front {
        let state = authority.map_or_else(
            || PublicationState::Waiting { last_error: None },
            |authority| PublicationState::Published(Arc::<str>::from(authority)),
        );
        let (_tx, rx) = watch::channel(state);
        Front::loopback(SECRET, rx)
    }

    fn request(target: &str) -> Request<()> {
        Request::builder()
            .uri(target)
            .header("Host", AUTHORITY)
            .header("X-Forwarded-Host", AUTHORITY)
            .body(())
            .expect("request")
    }

    #[test]
    fn secret_gate_rewrites_path_and_preserves_query() {
        let front = front(Some(AUTHORITY));
        let mut request = request(&format!("/{SECRET}/fs/favorites?q=one"));
        assert!(front.gate(&mut request).is_none());
        assert_eq!(request.uri().to_string(), "/fs/favorites?q=one");
    }

    #[tokio::test]
    async fn mismatch_and_absolute_form_are_empty_404_before_headers() {
        let front = front(Some(AUTHORITY));
        for target in [
            "/not-the-secret/auth/info",
            "http://devbox.ts.net/tether-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/auth/info",
        ] {
            let mut request = request(target);
            let response = front.gate(&mut request).expect("refused");
            assert_eq!(response.status(), StatusCode::NOT_FOUND);
            assert!(response.headers().is_empty());
            assert!(
                to_bytes(response.into_body(), usize::MAX)
                    .await
                    .expect("body")
                    .is_empty()
            );
        }
    }

    #[test]
    fn duplicate_authorities_and_unpublished_front_fail_closed() {
        let loopback = front(Some(AUTHORITY));
        let mut req = request(&format!("/{SECRET}/auth/info"));
        req.headers_mut()
            .append("Host", HeaderValue::from_static(AUTHORITY));
        let response = loopback.gate(&mut req).expect("duplicate Host refused");
        assert_eq!(response.status(), StatusCode::FORBIDDEN);

        let loopback = front(Some(AUTHORITY));
        let mut req = request(&format!("/{SECRET}/auth/info"));
        req.headers_mut()
            .append("X-Forwarded-Host", HeaderValue::from_static(AUTHORITY));
        let response = loopback
            .gate(&mut req)
            .expect("duplicate forwarded host refused");
        assert_eq!(response.status(), StatusCode::FORBIDDEN);

        let loopback = front(None);
        let mut req = request(&format!("/{SECRET}/auth/info"));
        let response = loopback
            .gate(&mut req)
            .expect("unpublished authority refused");
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }
}
