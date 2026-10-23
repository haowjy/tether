//! The daemon's HTTP surface (plan.md "Security", auth.md "Endpoints"): axum on
//! `127.0.0.1` only, published by `tailscale serve`. Two layers guard it. The Tailscale
//! check runs on every route, the fallback included; the device check runs on every
//! route but `/auth/info` and `/auth/enroll`, so a route added beside `/ws` is guarded
//! without asking. `http/` drives the hub through `HubHandle` and never names a tmux
//! type. Every accepted socket gets 64 KiB kernel buffers (fs.md "Constants"): each is
//! the loopback hop from `tailscale serve`, and the unit is charged for its buffers.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::Router;
use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{ConnectInfo, DefaultBodyLimit, FromRequestParts as _, Request, State};
use axum::middleware::{Next, from_fn_with_state};
use axum::response::{IntoResponse as _, Response};
use axum::routing::{get, post};
use tokio::sync::{Semaphore, watch};
use tracing::{error, warn};

use crate::auth::{Auth, AuthError};
use crate::blocking::Lanes;
use crate::budget::Caps;
use crate::config::ConfigFile;
use crate::fs::Slots;
use crate::hub::HubHandle;
use crate::proto::{CloseCode, HostInfo, HttpError};
use error::Refusal;

mod complete;
mod enroll;
mod error;
mod fs;
mod server;
mod ws;

pub use server::serve;

/// `POST /auth/enroll` bodies are a code and a device name.
const ENROLL_BODY: usize = 4 * 1024;

/// What the routes need.
pub struct App {
    pub auth: Auth,
    pub hub: HubHandle,
    /// `welcome.host` and `/auth/info`.
    pub host: HostInfo,
    /// Paste files wait here for tmux (0700, emptied at startup by the caller).
    pub paste_dir: PathBuf,
    /// Re-read by every fs request for `roots` and `uploads_dir`.
    pub config: ConfigFile,
    /// `$HOME`: the picker's scope, and what `~/` in the roots means.
    pub home: PathBuf,
    /// `[complete]` and what completion reads of the environment.
    pub complete: crate::complete::Settings,
    /// Startup-selected caps from the effective memory budget.
    pub caps: Caps,
    /// The runtime's blocking threads: every blocking call runs on one of these.
    pub lanes: Lanes,
}

/// `App` plus the daemon-wide limits the connections share.
struct Ctx {
    app: App,
    /// Accepted HTTP connections, including sockets transferred to WebSockets.
    accepts: Arc<Semaphore>,
    /// WebSockets from the upgrade (daemon-core.md §6).
    conns: Arc<Semaphore>,
    /// Paste files waiting for tmux, daemon-wide.
    pastes: Arc<Semaphore>,
    /// The file API's lane, scans, raw responses and uploads.
    fs: Slots,
    /// Absent when the selected memory tier disables completion.
    complete: Option<crate::complete::Completer>,
    /// `/complete` requests in flight.
    completing: Arc<Semaphore>,
    /// Becomes true on shutdown: every socket closes with 4004.
    shutdown: watch::Receiver<bool>,
}

/// The Tailscale login of the request, set by the Tailscale check.
#[derive(Debug, Clone)]
struct Login(String);

fn router(ctx: Arc<Ctx>) -> Router {
    let devices = Router::new()
        .route("/ws", get(ws::upgrade))
        .merge(fs::routes())
        .merge(complete::routes())
        .route_layer(from_fn_with_state(ctx.clone(), device_check));
    Router::new()
        .route("/auth/info", get(enroll::info))
        .route(
            "/auth/enroll",
            post(enroll::enroll).layer(DefaultBodyLimit::max(ENROLL_BODY)),
        )
        .merge(devices)
        .layer(from_fn_with_state(ctx.clone(), tailscale_check))
        .with_state(ctx)
}

/// Every route: a loopback peer and an allowed `Tailscale-User-Login`, else a plain
/// 403, even on a WebSocket upgrade.
async fn tailscale_check(
    State(ctx): State<Arc<Ctx>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    mut request: Request,
    next: Next,
) -> Response {
    match ctx.app.auth.identity(peer, request.headers()) {
        Ok(login) => {
            request.extensions_mut().insert(Login(login));
            next.run(request).await
        }
        Err(refused) => {
            warn!(%refused, path = request.uri().path(), "refused by the Tailscale check");
            Refusal::from(HttpError::Forbidden).into_response()
        }
    }
}

/// Every route but the enrolment routes: a device token in `auth.toml`. Without one,
/// HTTP gets `401 auth_required`; a WebSocket upgrade completes and closes with 4401,
/// since a browser can't see a refused upgrade's status (auth.md "Carrying the token").
/// An `auth.toml` that can't be read or parsed fails closed, but as `503
/// auth_unavailable` or close 4503, which the app retries with the token it has.
async fn device_check(State(ctx): State<Arc<Ctx>>, mut request: Request, next: Next) -> Response {
    let refused = match ctx.app.auth.check(request.headers()).await {
        Ok(device) => {
            request.extensions_mut().insert(device);
            return next.run(request).await;
        }
        Err(refused) => refused,
    };
    match &refused {
        AuthError::Store(_) | AuthError::Busy => {
            error!(cause = %refused, "can't read auth.toml: every token fails");
        }
        AuthError::NoToken | AuthError::Unknown => {
            warn!(%refused, path = request.uri().path(), "refused by the device check");
        }
    }
    let (mut parts, _) = request.into_parts();
    match WebSocketUpgrade::from_request_parts(&mut parts, &()).await {
        Ok(upgrade) => ws::refuse(upgrade, CloseCode::from(&refused)),
        Err(_) => Refusal::from(&refused).into_response(),
    }
}
