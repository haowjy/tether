//! Bounded, embedded delivery of the browser shell. Only files in the build-time
//! manifest can be served; unknown API paths are never rewritten to `index.html`.

use std::convert::Infallible;
use std::io::Write as _;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, Method, StatusCode, header};
use axum::response::{IntoResponse as _, Response};
use axum::routing::get;
use axum::{Json, Router};
use bytes::Bytes;
use flate2::Compression;
use flate2::write::GzEncoder;
use tokio::sync::OwnedSemaphorePermit;

use super::server::{ShellStall, ShellStallGuard};
use super::{Ctx, Refusal};
use crate::proto::HttpError;

#[derive(Clone, Copy)]
struct Asset {
    path: &'static str,
    raw: &'static [u8],
    gzip: &'static [u8],
}

mod embedded {
    use super::Asset;
    include!(concat!(env!("OUT_DIR"), "/shell_assets.rs"));
}

const CHUNK: usize = 16 * 1024;

pub(super) fn routes() -> Router<Arc<Ctx>> {
    Router::new()
        .route("/", get(asset))
        .route("/manifest.webmanifest", get(asset))
        .route("/sw.js", get(asset))
        .route("/apple-touch-icon.png", get(asset))
        .route("/favicon.ico", get(asset))
        .route("/icons/{*path}", get(asset))
        .route("/assets/{*path}", get(asset))
}

pub(super) fn is_shell_path(path: &str) -> bool {
    matches!(
        path,
        "/" | "/manifest.webmanifest" | "/sw.js" | "/apple-touch-icon.png" | "/favicon.ico"
    ) || path.starts_with("/icons/")
        || path.starts_with("/assets/")
}

pub(super) async fn fallback(request: Request) -> Response {
    if (request.method() == Method::GET || request.method() == Method::HEAD)
        && ["/auth/", "/ws", "/fs/", "/complete", "/debug"]
            .iter()
            .any(|prefix| {
                request.uri().path() == *prefix || request.uri().path().starts_with(prefix)
            })
    {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "not_found" })),
        )
            .into_response();
    }
    StatusCode::NOT_FOUND.into_response()
}

async fn asset(State(ctx): State<Arc<Ctx>>, request: Request) -> Response {
    let slot = match ctx.shell.clone().try_acquire_owned() {
        Ok(slot) => slot,
        Err(_) => {
            let waiter = match ctx.shell_waiters.clone().try_acquire_owned() {
                Ok(waiter) => waiter,
                Err(_) => return Refusal::from(HttpError::Busy).into_response(),
            };
            let slot = match ctx.shell.clone().acquire_owned().await {
                Ok(slot) => slot,
                Err(_) => return Refusal::from(HttpError::Busy).into_response(),
            };
            drop(waiter);
            slot
        }
    };
    let path = if request.uri().path() == "/" {
        "/index.html"
    } else {
        request.uri().path()
    };
    let stall = request.extensions().get::<Arc<ShellStall>>().cloned();
    let is_manifest = path == "/manifest.webmanifest";
    let (raw, gzip, etag) = if is_manifest {
        let host = ctx.app.auth.machine_name(&ctx.app.host.name).await;
        let raw = Bytes::from(manifest(&host));
        let compressed = Bytes::from(gzip(&raw));
        let tag = etag(&raw);
        (raw, compressed, tag)
    } else if let Some(asset) = embedded::ASSETS.iter().find(|asset| asset.path == path) {
        (
            Bytes::from_static(asset.raw),
            Bytes::from_static(asset.gzip),
            etag(asset.raw),
        )
    } else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let conditional = request
        .headers()
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok());
    let mut response = if is_versioned(path) {
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
    } else {
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CACHE_CONTROL, "no-cache")
            .header(header::ETAG, &etag)
    };
    response = response
        .header(header::CONTENT_TYPE, mime(path))
        .header(header::CONTENT_SECURITY_POLICY, csp(&ctx).await)
        .header(header::REFERRER_POLICY, "no-referrer")
        .header(header::VARY, "Accept-Encoding")
        .header("cross-origin-opener-policy", "same-origin")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff");

    if !is_versioned(path) && conditional.is_some_and(|value| value == "*" || value == etag) {
        drop(slot);
        return response
            .status(StatusCode::NOT_MODIFIED)
            .body(Body::empty())
            .expect("shell response");
    }

    let use_gzip = accepts_gzip(request.headers());
    let bytes = if use_gzip {
        response = response.header(header::CONTENT_ENCODING, "gzip");
        gzip
    } else {
        raw
    };
    response = response.header(header::CONTENT_LENGTH, bytes.len().to_string());
    if request.method() == Method::HEAD {
        drop(slot);
        return response.body(Body::empty()).expect("shell response");
    }
    response
        .body(body(bytes, slot, stall))
        .expect("shell response")
}

fn body(bytes: Bytes, slot: OwnedSemaphorePermit, stall: Option<Arc<ShellStall>>) -> Body {
    let chunks = (0..bytes.len())
        .step_by(CHUNK)
        .map(|start| bytes.slice(start..(start + CHUNK).min(bytes.len())))
        .map(Ok::<Bytes, Infallible>)
        .collect::<Vec<_>>()
        .into_iter();
    let stall_guard: Option<ShellStallGuard> = stall.map(|stall| stall.begin());
    let stream = futures_util::stream::unfold(
        (chunks, Some(slot), stall_guard),
        |(mut chunks, slot, stall_guard)| async move {
            chunks
                .next()
                .map(|chunk| (chunk, (chunks, slot, stall_guard)))
        },
    );
    Body::from_stream(stream)
}

fn manifest(host: &str) -> Vec<u8> {
    let mut value = embedded::ASSETS
        .iter()
        .find(|asset| asset.path == "/manifest.webmanifest")
        .and_then(|asset| serde_json::from_slice::<serde_json::Value>(asset.raw).ok())
        .filter(serde_json::Value::is_object)
        .unwrap_or_else(|| serde_json::json!({ "short_name": "tether", "start_url": "/", "display": "standalone" }));
    let object = value.as_object_mut().expect("manifest object");
    object.insert(
        "name".to_owned(),
        serde_json::Value::String(format!("tether {host}")),
    );
    object.insert(
        "short_name".to_owned(),
        serde_json::Value::String("tether".to_owned()),
    );
    serde_json::to_vec(&value).expect("manifest JSON")
}

fn gzip(bytes: &[u8]) -> Vec<u8> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(bytes).expect("gzip manifest");
    encoder.finish().expect("finish gzip manifest")
}

fn etag(bytes: &[u8]) -> String {
    format!(
        "\"{}\"",
        crate::auth::token::hex(&crate::auth::token::hash_bytes(bytes))
    )
}

fn is_versioned(path: &str) -> bool {
    path.starts_with("/assets/")
        && path
            .rsplit('/')
            .next()
            .is_some_and(|name| name.contains('-'))
}

fn accepts_gzip(headers: &HeaderMap) -> bool {
    headers
        .get(header::ACCEPT_ENCODING)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value.split(',').any(|encoding| {
                let mut pieces = encoding.trim().split(';');
                let name = pieces.next().unwrap_or_default().trim();
                name.eq_ignore_ascii_case("gzip")
                    && !pieces.any(|parameter| parameter.trim().eq_ignore_ascii_case("q=0"))
            })
        })
}

fn mime(path: &str) -> &'static str {
    match path.rsplit_once('.').map(|(_, extension)| extension) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("webmanifest") => "application/manifest+json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("ico") => "image/x-icon",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}

async fn csp(ctx: &Ctx) -> String {
    let connect = ctx
        .app
        .auth
        .cached_browser_origin()
        .await
        .map(|origin| format!("'self' wss://{}", origin.authority))
        .unwrap_or_else(|| "'self'".to_owned());
    format!(
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self'; connect-src {connect}; manifest-src 'self'; worker-src 'self'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
    )
}
