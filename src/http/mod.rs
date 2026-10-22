//! The daemon's HTTP surface (plan.md "Security", auth.md "Endpoints"): axum on
//! `127.0.0.1` only, published by `tailscale serve`. Two layers guard it. The Tailscale
//! check runs on every route, the fallback included; the device check runs on every
//! route but `/auth/info` and `/auth/enroll`, so a route added beside `/ws` is guarded
//! without asking. `http/` drives the hub through `HubHandle` and never names a tmux
//! type. Every accepted socket gets 64 KiB kernel buffers (fs.md "Constants"): each is
//! the loopback hop from `tailscale serve`, and the unit is charged for its buffers.

use std::future::{Future, IntoFuture as _};
use std::io;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{ConnectInfo, DefaultBodyLimit, FromRequestParts as _, Request, State};
use axum::middleware::{Next, from_fn_with_state};
use axum::response::{IntoResponse as _, Response};
use axum::routing::{get, post};
use axum::serve::ListenerExt as _;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Semaphore, watch};
use tokio::time::{Instant, timeout_at};
use tracing::{debug, error, warn};

use crate::auth::{Auth, AuthError};
use crate::blocking::Lanes;
use crate::complete::Completer;
use crate::config::ConfigFile;
use crate::fs::Slots;
use crate::hub::HubHandle;
use crate::proto::{CloseCode, HostInfo, HttpError};
use error::Refusal;

mod complete;
mod enroll;
mod error;
mod fs;
mod ws;

/// How long shutdown waits for requests to finish and sockets to take their 4004
/// close: a stalled raw response mustn't hold it.
const SHUTDOWN_WAIT: Duration = Duration::from_secs(2);
/// `SO_SNDBUF` and `SO_RCVBUF` on every accepted socket; Linux doubles them.
const SOCKET_BUFFER: usize = 64 * 1024;
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
    /// The runtime's blocking threads: every blocking call runs on one of these.
    pub lanes: Lanes,
}

/// `App` plus the daemon-wide limits the connections share.
struct Ctx {
    app: App,
    /// Sockets from the upgrade (daemon-core.md §6).
    conns: Arc<Semaphore>,
    /// Paste files waiting for tmux, daemon-wide.
    pastes: Arc<Semaphore>,
    /// The file API's lane, scans, raw responses and uploads.
    fs: Slots,
    complete: Completer,
    /// `/complete` requests in flight.
    completing: Arc<Semaphore>,
    /// Becomes true on shutdown: every socket closes with 4004.
    shutdown: watch::Receiver<bool>,
}

/// The Tailscale login of the request, set by the Tailscale check.
#[derive(Debug, Clone)]
struct Login(String);

/// Serves `listener` until `signal` resolves, then closes every socket with 4004 and
/// waits briefly for requests and sockets to finish.
pub async fn serve(
    listener: TcpListener,
    app: App,
    signal: impl Future<Output = ()> + Send + 'static,
) -> io::Result<()> {
    let (stop, shutdown) = watch::channel(false);
    let mut stopping = shutdown.clone();
    let completer = Completer::new(app.complete.clone(), &app.lanes);
    let fs = Slots::new(app.lanes.fs.clone());
    let ctx = Arc::new(Ctx {
        app,
        conns: Arc::new(Semaphore::new(ws::MAX_CONNS)),
        pastes: Arc::new(Semaphore::new(ws::PASTE_SLOTS)),
        fs,
        complete: completer,
        completing: Arc::new(Semaphore::new(complete::IN_FLIGHT)),
        shutdown,
    });
    let listener = listener.tap_io(|socket| {
        if let Err(cause) = small_buffers(socket) {
            debug!(%cause, "can't size a socket's buffers");
        }
    });
    let service = router(ctx.clone()).into_make_service_with_connect_info::<SocketAddr>();
    let served = axum::serve(listener, service)
        .with_graceful_shutdown(async move {
            signal.await;
            // Upgraded sockets are no longer the server's: they close on this.
            let _ = stop.send(true);
        })
        .into_future();
    let mut served = std::pin::pin!(served);
    let ended = tokio::select! {
        ended = &mut served => Some(ended),
        () = ws::stopped(&mut stopping) => None,
    };
    let deadline = Instant::now() + SHUTDOWN_WAIT;
    let ended = match ended {
        Some(ended) => ended,
        // Graceful shutdown waits for every response, a stalled one too.
        None => timeout_at(deadline, served.as_mut())
            .await
            .unwrap_or_else(|_| {
                warn!("requests still open at shutdown: dropped");
                Ok(())
            }),
    };
    // Each socket holds a connection slot until its task ends.
    let all = u32::try_from(ws::MAX_CONNS).unwrap_or(u32::MAX);
    let _ = timeout_at(deadline, ctx.conns.acquire_many(all)).await;
    ended
}

fn small_buffers(socket: &TcpStream) -> io::Result<()> {
    rustix::net::sockopt::set_socket_send_buffer_size(socket, SOCKET_BUFFER)?;
    rustix::net::sockopt::set_socket_recv_buffer_size(socket, SOCKET_BUFFER)?;
    Ok(())
}

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
