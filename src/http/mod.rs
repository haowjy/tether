//! HTTP routes and admission layers. Each listener supplies its `Front`, which gates
//! requests before routing and chooses the credential lanes available to them.

use std::path::PathBuf;
use std::sync::Arc;

use axum::Router;
use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{DefaultBodyLimit, FromRequestParts as _, Request, State};
use axum::http::header;
use axum::middleware::{Next, from_fn_with_state};
use axum::response::{IntoResponse as _, Response};
use axum::routing::{get, post};
use tokio::sync::{Semaphore, watch};
use tracing::{error, warn};

use crate::auth::{Auth, AuthError, NodeLane, Session};
use crate::blocking::{Lanes, PermitPool};
use crate::budget::Caps;
use crate::config::ConfigFile;
use crate::fs::Slots;
use crate::hub::HubHandle;
use crate::proto::{CloseCode, HostInfo, HttpError};
use error::Refusal;

mod complete;
mod enroll;
mod error;
mod front;
mod fs;
mod node_auth;
mod server;
mod shell;
mod ws;

pub use front::Front;
pub use server::{Listener, serve};

const ENROLL_BODY: usize = 4 * 1024;

pub struct App {
    pub auth: Auth,
    pub hub: HubHandle,
    pub host: HostInfo,
    pub paste_dir: PathBuf,
    pub config: ConfigFile,
    pub home: PathBuf,
    pub complete: crate::complete::Settings,
    pub caps: Caps,
    pub lanes: Lanes,
}

struct Ctx {
    app: App,
    accepts: Arc<Semaphore>,
    shell: PermitPool,
    conns: Arc<Semaphore>,
    pastes: Arc<Semaphore>,
    fs: Slots,
    complete: Option<crate::complete::Completer>,
    completing: Arc<Semaphore>,
    shutdown: watch::Receiver<bool>,
}

#[derive(Debug, Clone)]
struct Login(String);

fn router(ctx: Arc<Ctx>) -> Router {
    let devices = Router::new()
        .route("/ws", get(ws::upgrade))
        .merge(fs::routes())
        .merge(complete::routes())
        .route_layer(from_fn_with_state(ctx.clone(), device_check));
    let node_routes = Router::new()
        .route("/auth/node/session", get(node_auth::session))
        .route(
            "/auth/node/enroll",
            post(node_auth::enroll).layer(DefaultBodyLimit::max(ENROLL_BODY)),
        )
        .route(
            "/auth/node/remove",
            post(node_auth::remove).layer(DefaultBodyLimit::max(ENROLL_BODY)),
        )
        .route_layer(from_fn_with_state(ctx.clone(), node_check));
    Router::new()
        .route("/auth/info", get(enroll::info))
        .route(
            "/auth/enroll",
            post(enroll::enroll).layer(DefaultBodyLimit::max(ENROLL_BODY)),
        )
        .merge(node_routes)
        .merge(devices)
        .merge(shell::routes())
        .fallback(shell::fallback)
        .layer(from_fn_with_state(ctx.clone(), tailscale_check))
        .with_state(ctx)
}

/// Every request that passes its front's gate requires an allowed Serve login. Serve
/// rewrites Host to localhost for Unix targets; the browser's actual authority is in
/// its forwarded host and is checked later on the node lane.
async fn tailscale_check(
    State(ctx): State<Arc<Ctx>>,
    mut request: Request,
    next: Next,
) -> Response {
    let shell_path = shell::is_shell_path(request.uri().path());
    let mut response = match ctx.app.auth.identity(request.headers()).await {
        Ok(login) => {
            request.extensions_mut().insert(Login(login));
            next.run(request).await
        }
        Err(refused) => {
            warn!(%refused, path = request.uri().path(), "refused by the Tailscale check");
            match refused {
                crate::auth::IdentityError::Unavailable(_) => {
                    Refusal::from(HttpError::IdentityUnavailable).into_response()
                }
                _ => Refusal::from(HttpError::Forbidden).into_response(),
            }
        }
    };
    common_headers(&mut response, shell_path);
    response
}

async fn device_check(State(ctx): State<Arc<Ctx>>, mut request: Request, next: Next) -> Response {
    let node_lane = request
        .extensions()
        .get::<NodeLane>()
        .copied()
        .unwrap_or(NodeLane::Refused);
    let login = request
        .extensions()
        .get::<Login>()
        .map_or("", |login| login.0.as_str());
    let upgrade = request
        .headers()
        .get(header::UPGRADE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("websocket"));
    match ctx
        .app
        .auth
        .check(
            node_lane,
            request.method(),
            request.headers(),
            upgrade,
            login,
            false,
        )
        .await
    {
        Ok(session) => {
            request.extensions_mut().insert(session);
            next.run(request).await
        }
        Err(refused) => {
            match &refused {
                AuthError::Store(_) | AuthError::IdentityUnavailable(_) => {
                    error!(cause = %refused, path = request.uri().path(), "device check unavailable");
                }
                _ => warn!(%refused, path = request.uri().path(), "device check refused request"),
            }
            auth_refusal(request, refused).await
        }
    }
}

async fn node_check(State(ctx): State<Arc<Ctx>>, mut request: Request, next: Next) -> Response {
    let node_lane = request
        .extensions()
        .get::<NodeLane>()
        .copied()
        .unwrap_or(NodeLane::Refused);
    let login = request
        .extensions()
        .get::<Login>()
        .map_or("", |login| login.0.as_str());
    let allow_unenrolled = matches!(
        request.uri().path(),
        "/auth/node/enroll" | "/auth/node/remove"
    );
    let upgrade = request
        .headers()
        .get(header::UPGRADE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("websocket"));
    match ctx
        .app
        .auth
        .check(
            node_lane,
            request.method(),
            request.headers(),
            upgrade,
            login,
            allow_unenrolled,
        )
        .await
    {
        Ok(session @ (Session::Node { .. } | Session::NodeUnenrolled { .. })) => {
            request.extensions_mut().insert(session);
            next.run(request).await
        }
        Ok(Session::Native(_)) => Refusal::from(HttpError::BadRequest).into_response(),
        Err(refused) => auth_refusal(request, refused).await,
    }
}

async fn auth_refusal(request: Request, refused: AuthError) -> Response {
    let upgrade = request
        .headers()
        .get(header::UPGRADE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("websocket"));
    if upgrade {
        let (mut parts, _) = request.into_parts();
        if let Ok(upgrade) = WebSocketUpgrade::from_request_parts(&mut parts, &()).await {
            if matches!(&refused, AuthError::BadOrigin | AuthError::Forbidden) {
                return Refusal::from(&refused).into_response();
            }
            return ws::refuse(upgrade, CloseCode::from(&refused));
        }
    }
    Refusal::from(&refused).into_response()
}

fn common_headers(response: &mut Response, shell: bool) {
    let headers = response.headers_mut();
    if !shell || !headers.contains_key(header::CACHE_CONTROL) {
        headers.insert(header::CACHE_CONTROL, "no-store".parse().expect("header"));
        headers.insert(
            "cross-origin-resource-policy",
            "same-origin".parse().expect("header"),
        );
    }
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        "nosniff".parse().expect("header"),
    );
}
