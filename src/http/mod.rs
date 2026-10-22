//! The daemon's HTTP surface (plan.md "Security", auth.md "Endpoints"): axum on
//! `127.0.0.1` only, published by `tailscale serve`. Two layers guard it. The Tailscale
//! check runs on every route, the fallback included; the device check runs on every
//! route but `/auth/info` and `/auth/enroll`, so a route added beside `/ws` is guarded
//! without asking. `http/` drives the hub through `HubHandle` and never names a tmux
//! type.

use std::future::Future;
use std::io;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{ConnectInfo, DefaultBodyLimit, FromRequestParts as _, Request, State};
use axum::http::StatusCode;
use axum::middleware::{Next, from_fn_with_state};
use axum::response::{IntoResponse as _, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use tokio::net::TcpListener;
use tokio::sync::{Semaphore, watch};
use tracing::{error, warn};

use crate::auth::{Auth, AuthError};
use crate::hub::HubHandle;
use crate::proto::auth::ErrorBody;
use crate::proto::{CloseCode, HostInfo};

mod enroll;
mod ws;

/// How long shutdown waits for sockets to take their 4004 close.
const SHUTDOWN_WAIT: Duration = Duration::from_secs(2);
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
}

/// `App` plus the daemon-wide limits the connections share.
struct Ctx {
    app: App,
    /// Sockets from the upgrade (daemon-core.md §6).
    conns: Arc<Semaphore>,
    /// Paste files waiting for tmux, daemon-wide.
    pastes: Arc<Semaphore>,
    /// Becomes true on shutdown: every socket closes with 4004.
    shutdown: watch::Receiver<bool>,
}

/// The Tailscale login of the request, set by the Tailscale check.
#[derive(Debug, Clone)]
struct Login(String);

/// Serves `listener` until `signal` resolves, then closes every socket with 4004 and
/// waits briefly for them.
pub async fn serve(
    listener: TcpListener,
    app: App,
    signal: impl Future<Output = ()> + Send + 'static,
) -> io::Result<()> {
    let (stop, shutdown) = watch::channel(false);
    let ctx = Arc::new(Ctx {
        app,
        conns: Arc::new(Semaphore::new(ws::MAX_CONNS)),
        pastes: Arc::new(Semaphore::new(ws::PASTE_SLOTS)),
        shutdown,
    });
    let service = router(ctx.clone()).into_make_service_with_connect_info::<SocketAddr>();
    axum::serve(listener, service)
        .with_graceful_shutdown(async move {
            signal.await;
            // Upgraded sockets are no longer the server's: they close on this.
            let _ = stop.send(true);
        })
        .await?;
    // Each socket holds a connection slot until its task ends.
    let all = u32::try_from(ws::MAX_CONNS).unwrap_or(u32::MAX);
    let _ = tokio::time::timeout(SHUTDOWN_WAIT, ctx.conns.acquire_many(all)).await;
    Ok(())
}

fn router(ctx: Arc<Ctx>) -> Router {
    let devices = Router::new()
        .route("/ws", get(ws::upgrade))
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
            refusal(StatusCode::FORBIDDEN, "forbidden")
        }
    }
}

/// Every route but the enrolment routes: a device token in `auth.toml`. Without one,
/// HTTP gets `401 auth_required`; a WebSocket upgrade completes and closes with 4401,
/// since a browser can't see a refused upgrade's status (auth.md "Carrying the token").
async fn device_check(State(ctx): State<Arc<Ctx>>, mut request: Request, next: Next) -> Response {
    let refused = match ctx.app.auth.check(request.headers()).await {
        Ok(device) => {
            request.extensions_mut().insert(device);
            return next.run(request).await;
        }
        Err(refused) => refused,
    };
    match &refused {
        AuthError::Store(cause) => error!(%cause, "can't read auth.toml: every token fails"),
        _ => warn!(%refused, path = request.uri().path(), "refused by the device check"),
    }
    let (mut parts, _) = request.into_parts();
    match WebSocketUpgrade::from_request_parts(&mut parts, &()).await {
        Ok(upgrade) => ws::refuse(upgrade, CloseCode::BadToken),
        Err(_) => refusal(StatusCode::UNAUTHORIZED, "auth_required"),
    }
}

fn refusal(status: StatusCode, code: &str) -> Response {
    let body = ErrorBody {
        error: code.to_owned(),
    };
    (status, Json(body)).into_response()
}
