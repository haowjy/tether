//! The bounded HTTP/1 accept loop (daemon-core.md §6.4). Each accepted transport owns
//! its permit, including after hyper transfers it into an upgraded WebSocket.

use std::convert::Infallible;
use std::future::Future;
use std::io::{self, IoSlice};
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::extract::ConnectInfo;
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::{TokioIo, TokioTimer};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{OwnedSemaphorePermit, watch};
use tokio::task::JoinSet;
use tokio::time::{Instant, sleep, timeout_at};
use tower::ServiceExt as _;
use tracing::{debug, warn};

use super::{App, Ctx, router, ws};
use crate::complete::Completer;
use crate::fs::Slots;

const CONNECTIONS: usize = 64;
const HYPER_BUFFER: usize = 16 * 1024;
const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(100);
const SHUTDOWN_WAIT: Duration = Duration::from_secs(2);
const SOCKET_BUFFER: usize = 64 * 1024;

/// Serves until shutdown, then gives requests and upgraded sockets a bounded grace.
pub async fn serve(
    listener: TcpListener,
    app: App,
    signal: impl Future<Output = ()> + Send + 'static,
) -> io::Result<()> {
    let (stop, shutdown) = watch::channel(false);
    tokio::spawn(async move {
        signal.await;
        let _ = stop.send(true);
    });

    let caps = app.caps;
    let completer = caps
        .completion
        .then(|| Completer::new(app.complete.clone(), &app.lanes));
    let fs = Slots::new(app.lanes.fs.clone());
    let ctx = Arc::new(Ctx {
        app,
        accepts: Arc::new(tokio::sync::Semaphore::new(CONNECTIONS)),
        conns: Arc::new(tokio::sync::Semaphore::new(caps.sockets)),
        pastes: Arc::new(tokio::sync::Semaphore::new(ws::PASTE_SLOTS)),
        fs,
        complete: completer,
        completing: Arc::new(tokio::sync::Semaphore::new(super::complete::IN_FLIGHT)),
        shutdown: shutdown.clone(),
    });
    let routes = router(ctx.clone());
    let mut stopping = shutdown.clone();
    let mut connections = JoinSet::new();

    loop {
        let permit = tokio::select! {
            biased;
            () = ws::stopped(&mut stopping) => break,
            permit = ctx.accepts.clone().acquire_owned() => match permit {
                Ok(permit) => permit,
                Err(_) => break,
            },
        };
        let accepted = tokio::select! {
            biased;
            () = ws::stopped(&mut stopping) => {
                drop(permit);
                break;
            }
            accepted = listener.accept() => accepted,
        };
        let (stream, peer) = match accepted {
            Ok(accepted) => accepted,
            Err(error) => {
                drop(permit);
                warn!(%error, "HTTP accept failed");
                tokio::select! {
                    () = ws::stopped(&mut stopping) => break,
                    () = sleep(Duration::from_secs(1)) => {},
                }
                continue;
            }
        };
        if let Err(error) = small_buffers(&stream) {
            debug!(%error, "can't size an accepted socket's buffers");
        }
        connections.spawn(connection(
            stream,
            peer,
            permit,
            routes.clone(),
            shutdown.clone(),
        ));
    }

    drop(listener);
    let deadline = Instant::now() + SHUTDOWN_WAIT;
    while !connections.is_empty() {
        match timeout_at(deadline, connections.join_next()).await {
            Ok(Some(Ok(()))) => {}
            Ok(Some(Err(error))) => warn!(%error, "HTTP connection task failed"),
            Ok(None) => break,
            Err(_) => {
                warn!("HTTP requests still open at shutdown: dropped");
                connections.abort_all();
                while connections.join_next().await.is_some() {}
                break;
            }
        }
    }
    // The permit travels through hyper's Upgraded transport, so this includes WebSockets.
    let permits = u32::try_from(CONNECTIONS).unwrap_or(u32::MAX);
    let _ = timeout_at(deadline, ctx.accepts.acquire_many(permits)).await;
    Ok(())
}

fn small_buffers(stream: &TcpStream) -> io::Result<()> {
    rustix::net::sockopt::set_socket_send_buffer_size(stream, SOCKET_BUFFER)?;
    rustix::net::sockopt::set_socket_recv_buffer_size(stream, SOCKET_BUFFER)?;
    Ok(())
}

async fn connection(
    stream: TcpStream,
    peer: SocketAddr,
    permit: OwnedSemaphorePermit,
    routes: Router,
    mut shutdown: watch::Receiver<bool>,
) {
    let service = service_fn(move |mut request: Request<Incoming>| {
        let routes = routes.clone();
        async move {
            request.extensions_mut().insert(ConnectInfo(peer));
            let response = match routes.oneshot(request.map(Body::new)).await {
                Ok(response) => response,
                Err(never) => match never {},
            };
            Ok::<Response<Body>, Infallible>(response)
        }
    });
    let io = TokioIo::new(AcceptedStream {
        stream,
        _permit: permit,
    });
    let mut builder = http1::Builder::new();
    builder
        .timer(TokioTimer::new())
        .max_buf_size(HYPER_BUFFER)
        .header_read_timeout(HEADER_READ_TIMEOUT);
    let mut connection = std::pin::pin!(builder.serve_connection(io, service).with_upgrades());
    tokio::select! {
        result = connection.as_mut() => {
            if let Err(error) = result {
                debug!(%error, "HTTP connection ended");
            }
        }
        () = ws::stopped(&mut shutdown) => {
            connection.as_mut().graceful_shutdown();
            if timeout_at(Instant::now() + SHUTDOWN_WAIT, connection.as_mut()).await.is_err() {
                debug!("HTTP connection exceeded its shutdown grace");
            }
        }
    }
}

/// Hyper transfers this I/O object to `Upgraded` on a WebSocket upgrade. Keeping the
/// permit inside it makes the 64-connection backstop count upgraded sockets too.
struct AcceptedStream {
    stream: TcpStream,
    _permit: OwnedSemaphorePermit,
}

impl AsyncRead for AcceptedStream {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().stream).poll_read(cx, buf)
    }
}

impl AsyncWrite for AcceptedStream {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.get_mut().stream).poll_write(cx, buf)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().stream).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().stream).poll_shutdown(cx)
    }

    fn is_write_vectored(&self) -> bool {
        self.stream.is_write_vectored()
    }

    fn poll_write_vectored(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bufs: &[IoSlice<'_>],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.get_mut().stream).poll_write_vectored(cx, bufs)
    }
}
