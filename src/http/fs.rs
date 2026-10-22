//! The `/fs/*` routes (fs.md "Routes"): thin handlers that parse the request, take
//! slots, call into `crate::fs` and build responses. They sit in the `devices` router,
//! behind both auth layers. A path rides in the URL path, percent-encoded per segment;
//! the daemon decodes it and prepends `/`.

use std::path::Path as FilePath;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::rejection::{JsonRejection, PathRejection, QueryRejection};
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse as _, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use tracing::{debug, error, info, warn};

use super::{Ctx, refusal};
use crate::fs::config_write::{self, Change};
use crate::fs::list::{self, Filter};
use crate::fs::raw::{self, Span};
use crate::fs::upload::{self, MAX_UPLOAD};
use crate::fs::{FsError, Roots, Want, mime};
use crate::proto::fs::PathBody;

/// `/fs/roots/*` and `/fs/uploads-dir` bodies are one path.
const JSON_BODY: usize = 4 * 1024;

pub(super) fn routes() -> Router<Arc<Ctx>> {
    let path_body = || DefaultBodyLimit::max(JSON_BODY);
    Router::new()
        .route("/fs/roots", get(roots))
        .route("/fs/roots/add", post(add_root).layer(path_body()))
        .route("/fs/roots/remove", post(remove_root).layer(path_body()))
        .route("/fs/uploads-dir", post(uploads_dir).layer(path_body()))
        // `{*path}` doesn't match an empty path: `/` is its own route.
        .route("/fs/list/", get(list_slash))
        .route("/fs/list/{*path}", get(list))
        .route("/fs/dirs/", get(dirs_slash))
        .route("/fs/dirs/{*path}", get(dirs))
        .route("/fs/raw/{*path}", get(raw))
        // The handler checks the cap itself, up front and as the body arrives.
        .route(
            "/fs/upload",
            post(upload).layer(DefaultBodyLimit::disable()),
        )
}

#[derive(Debug, Deserialize)]
struct ListQuery {
    #[serde(default)]
    offset: u32,
    /// `0` or `1`.
    #[serde(default)]
    hidden: u8,
}

#[derive(Debug, Deserialize)]
struct UploadQuery {
    /// The client's file name: only its extension is used.
    #[serde(default)]
    name: String,
}

async fn roots(State(ctx): State<Arc<Ctx>>) -> Response {
    let app = ctx.clone();
    let loaded = ctx.fs.blocking(move || app.roots()).await;
    respond(
        "",
        loaded.map(|roots| Json(roots.to_wire()).into_response()),
    )
}

async fn add_root(
    State(ctx): State<Arc<Ctx>>,
    body: Result<Json<PathBody>, JsonRejection>,
) -> Response {
    change(ctx, body, Change::AddRoot).await
}

async fn remove_root(
    State(ctx): State<Arc<Ctx>>,
    body: Result<Json<PathBody>, JsonRejection>,
) -> Response {
    change(ctx, body, Change::RemoveRoot).await
}

async fn uploads_dir(
    State(ctx): State<Arc<Ctx>>,
    body: Result<Json<PathBody>, JsonRejection>,
) -> Response {
    change(ctx, body, Change::UploadsDir).await
}

/// A Settings change, then the roots as they are after it.
async fn change(
    ctx: Arc<Ctx>,
    body: Result<Json<PathBody>, JsonRejection>,
    make: fn(String) -> Change,
) -> Response {
    let path = match body {
        Ok(Json(PathBody { path })) => path,
        Err(rejection) if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE => {
            return refusal(rejection.status(), "too_large");
        }
        Err(rejection) => return refusal(rejection.status(), "bad_request"),
    };
    let app = ctx.clone();
    let requested = make(path.clone());
    let changed = ctx
        .fs
        .blocking(move || {
            let file = &app.app.config;
            config_write::apply(file, app.app.auth.store(), &app.app.home, requested)?;
            app.roots()
        })
        .await;
    respond(
        &path,
        changed.map(|roots| Json(roots.to_wire()).into_response()),
    )
}

async fn list(
    State(ctx): State<Arc<Ctx>>,
    path: Result<Path<String>, PathRejection>,
    query: Result<Query<ListQuery>, QueryRejection>,
) -> Response {
    listing(ctx, wire_path(path), query, false).await
}

async fn list_slash(
    State(ctx): State<Arc<Ctx>>,
    query: Result<Query<ListQuery>, QueryRejection>,
) -> Response {
    listing(ctx, Some("/".to_owned()), query, false).await
}

async fn dirs(
    State(ctx): State<Arc<Ctx>>,
    path: Result<Path<String>, PathRejection>,
    query: Result<Query<ListQuery>, QueryRejection>,
) -> Response {
    listing(ctx, wire_path(path), query, true).await
}

async fn dirs_slash(
    State(ctx): State<Arc<Ctx>>,
    query: Result<Query<ListQuery>, QueryRejection>,
) -> Response {
    listing(ctx, Some("/".to_owned()), query, true).await
}

/// A page of a directory under the roots, or for the picker (`dirs_only`) under
/// `$HOME`, holding the scan slot.
async fn listing(
    ctx: Arc<Ctx>,
    path: Option<String>,
    query: Result<Query<ListQuery>, QueryRejection>,
    dirs_only: bool,
) -> Response {
    let (Some(path), Ok(Query(query))) = (path, query) else {
        return respond("", Err(FsError::BadRequest));
    };
    if query.hidden > 1 {
        return respond(&path, Err(FsError::BadRequest));
    }
    let filter = Filter {
        hidden: query.hidden == 1,
        dirs_only,
    };
    let listed = async {
        let _scan = ctx.fs.scan().await?;
        let app = ctx.clone();
        let asked = path.clone();
        ctx.fs
            .blocking(move || {
                let roots = app.roots()?;
                let scope = if dirs_only {
                    roots.home_scope()
                } else {
                    roots.scope()
                };
                let dir = crate::fs::open(&scope, &asked, Want::Dir)?;
                list::list(&dir, &scope, filter, query.offset).map_err(FsError::io)
            })
            .await
    }
    .await;
    debug!(%path, offset = query.offset, ok = listed.is_ok(), "listed");
    respond(&path, listed.map(|listing| Json(listing).into_response()))
}

/// A file's bytes, or one range of them, holding a raw-response slot until the body
/// is sent or aborted.
async fn raw(
    State(ctx): State<Arc<Ctx>>,
    path: Result<Path<String>, PathRejection>,
    headers: HeaderMap,
) -> Response {
    let Some(path) = wire_path(path) else {
        return respond("", Err(FsError::BadRequest));
    };
    let sent = async {
        let slot = ctx.fs.raw().await?;
        let app = ctx.clone();
        let asked = path.clone();
        let opened = ctx
            .fs
            .blocking(move || crate::fs::open(&app.roots()?.scope(), &asked, Want::File))
            .await?;
        let size = opened.meta.len();
        let etag = raw::etag(&opened.meta);
        let header = |name| headers.get(name).and_then(|value| value.to_str().ok());
        let range = header(header::RANGE);
        let (status, start, len) = match raw::span(range, header(header::IF_RANGE), &etag, size) {
            Span::Whole => (StatusCode::OK, 0, size),
            Span::Part { start, end } => (StatusCode::PARTIAL_CONTENT, start, end - start + 1),
            Span::Unsatisfiable => return Err(FsError::BadRange { size }),
        };
        debug!(%path, ?range, status = status.as_u16(), "raw");
        let name = FilePath::new(&path).file_name().unwrap_or_default();
        let mime = mime::for_name(&name.to_string_lossy());
        let mut chunks = raw::stream(ctx.fs.clone(), opened, start, len, slot);
        let body = futures_util::stream::poll_fn(move |cx| chunks.poll_recv(cx));
        let mut response = Response::builder()
            .status(status)
            .header(header::CONTENT_TYPE, mime)
            // Exactly this many bytes, or the response is aborted.
            .header(header::CONTENT_LENGTH, len)
            .header(header::ETAG, etag)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CACHE_CONTROL, "private, no-cache")
            // The native player fetches without the scheme handler, which adds these too.
            .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
            .header(header::CONTENT_SECURITY_POLICY, "sandbox");
        if status == StatusCode::PARTIAL_CONTENT {
            let end = start + len - 1;
            response =
                response.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"));
        }
        response
            .body(Body::from_stream(body))
            .map_err(|cause| FsError::Internal(std::io::Error::other(cause)))
    }
    .await;
    respond(&path, sent)
}

/// `201 { path, size }`: the body, as is, into `uploads_dir` under a name the daemon
/// picks. One upload at a time; a second is `busy` at once.
async fn upload(
    State(ctx): State<Arc<Ctx>>,
    query: Result<Query<UploadQuery>, QueryRejection>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    let Ok(Query(query)) = query else {
        return respond("", Err(FsError::BadRequest));
    };
    let declared = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    if declared.is_some_and(|len| len > MAX_UPLOAD) {
        return respond("", Err(FsError::TooLarge));
    }
    let uploaded = async {
        let _slot = ctx.fs.upload()?;
        let app = ctx.clone();
        let dir = ctx
            .fs
            .blocking(move || upload::open_dir(&app.app.config, &app.app.home))
            .await?;
        let body = body.into_data_stream();
        upload::receive(&ctx.fs, dir, &query.name, MAX_UPLOAD, body).await
    }
    .await;
    match uploaded {
        Ok(uploaded) => {
            info!(path = %uploaded.path, size = uploaded.size, "uploaded a file");
            (StatusCode::CREATED, Json(uploaded)).into_response()
        }
        Err(refused) => respond("", Err(refused)),
    }
}

impl Ctx {
    /// The roots as `config.toml` names them now. Blocks.
    fn roots(&self) -> Result<Roots, FsError> {
        Roots::load(&self.app.config, &self.app.home)
    }
}

/// `{*path}` decoded, with its `/`; `None` if it doesn't decode.
fn wire_path(path: Result<Path<String>, PathRejection>) -> Option<String> {
    path.ok().map(|Path(path)| format!("/{path}"))
}

/// The response, or the refusal in the JSON error shape, logged by fs.md's rules.
/// `asked` is the path the client sent, if any.
fn respond(asked: &str, result: Result<Response, FsError>) -> Response {
    let refused = match result {
        Ok(response) => return response,
        Err(refused) => refused,
    };
    match &refused {
        FsError::OutsideRoots | FsError::OutsideHome | FsError::Denied => {
            warn!(
                path = asked,
                code = refused.code(),
                "refused a file request"
            );
        }
        FsError::ConfigUnavailable(cause) => {
            error!(%cause, "can't read config.toml: every file request fails");
        }
        FsError::ConfigReadOnly(cause) => {
            warn!(%cause, path = asked, "config.toml can't be written: refused");
        }
        FsError::Internal(cause) => error!(%cause, path = asked, "a file request failed"),
        _ => debug!(
            path = asked,
            code = refused.code(),
            "refused a file request"
        ),
    }
    let status =
        StatusCode::from_u16(refused.status()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let mut response = refusal(status, refused.code());
    let headers = response.headers_mut();
    match refused {
        FsError::Busy => {
            headers.insert(header::RETRY_AFTER, HeaderValue::from_static("1"));
        }
        FsError::BadRange { size } => {
            if let Ok(range) = HeaderValue::from_str(&format!("bytes */{size}")) {
                headers.insert(header::CONTENT_RANGE, range);
            }
        }
        _ => {}
    }
    response
}
