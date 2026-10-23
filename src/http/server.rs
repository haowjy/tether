//! The bounded HTTP/1 accept loop (daemon-core.md §6.4). Each accepted transport owns
//! its permit, including after hyper transfers it into an upgraded WebSocket.

use std::convert::Infallible;
use std::future::Future;
use std::io::{self, IoSlice};
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::task::{Context, Poll};
use std::time::Duration;

use axum::Router;
use axum::body::Body;
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::{TokioIo, TokioTimer};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{OwnedSemaphorePermit, watch};
use tokio::task::JoinSet;
use tokio::time::{Instant, Sleep, sleep, sleep_until, timeout_at};
use tower::ServiceExt as _;
use tracing::{debug, warn};

use super::{App, Ctx, Front, router, ws};
use crate::budget::ACCEPTED_CONNECTIONS;
use crate::complete::Completer;
use crate::fs::Slots;

const HYPER_BUFFER: usize = 16 * 1024;
const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(100);
const SHUTDOWN_WAIT: Duration = Duration::from_secs(2);
const SOCKET_BUFFER: usize = 64 * 1024;
const SHELL_STALL: Duration = Duration::from_secs(30);

/// Shared with a shell body so its accepted transport can enforce a write-progress
/// deadline without timing ordinary idle keep-alive connections.
#[derive(Default)]
pub(super) struct ShellStall {
    active: AtomicBool,
    generation: AtomicU64,
}

impl ShellStall {
    pub fn begin(self: &Arc<Self>) -> ShellStallGuard {
        self.active.store(true, Ordering::SeqCst);
        self.generation.fetch_add(1, Ordering::SeqCst);
        ShellStallGuard(self.clone())
    }
}

pub(super) struct ShellStallGuard(Arc<ShellStall>);

impl Drop for ShellStallGuard {
    fn drop(&mut self) {
        self.0.active.store(false, Ordering::SeqCst);
        self.0.generation.fetch_add(1, Ordering::SeqCst);
    }
}

/// Serves until shutdown, then gives requests and upgraded sockets a bounded grace.
pub async fn serve(
    serve_listener: UnixListener,
    local_listener: UnixListener,
    app: App,
    signal: impl Future<Output = ()> + Send + 'static,
) -> io::Result<()> {
    app.auth.start();
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
        accepts: Arc::new(tokio::sync::Semaphore::new(ACCEPTED_CONNECTIONS)),
        shell: Arc::new(tokio::sync::Semaphore::new(4)),
        shell_waiters: Arc::new(tokio::sync::Semaphore::new(16)),
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
            accepted = async {
                tokio::select! {
                    accepted = serve_listener.accept() => accepted.map(|(stream, _)| (stream, Front::Serve)),
                    accepted = local_listener.accept() => accepted.map(|(stream, _)| (stream, Front::Local)),
                }
            } => accepted,
        };
        let (stream, front) = match accepted {
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
        spawn_and_reap(
            &mut connections,
            connection(stream, front, permit, routes.clone(), shutdown.clone()),
        );
    }

    drop(serve_listener);
    drop(local_listener);
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
    let permits = u32::try_from(ACCEPTED_CONNECTIONS).unwrap_or(u32::MAX);
    let _ = timeout_at(deadline, ctx.accepts.acquire_many(permits)).await;
    Ok(())
}

fn spawn_and_reap(connections: &mut JoinSet<()>, task: impl Future<Output = ()> + Send + 'static) {
    connections.spawn(task);
    while let Some(result) = connections.try_join_next() {
        if let Err(error) = result {
            warn!(%error, "HTTP connection task failed");
        }
    }
}

fn small_buffers(stream: &UnixStream) -> io::Result<()> {
    rustix::net::sockopt::set_socket_send_buffer_size(stream, SOCKET_BUFFER)?;
    rustix::net::sockopt::set_socket_recv_buffer_size(stream, SOCKET_BUFFER)?;
    Ok(())
}

async fn connection(
    stream: UnixStream,
    front: Front,
    permit: OwnedSemaphorePermit,
    routes: Router,
    mut shutdown: watch::Receiver<bool>,
) {
    let stall = Arc::new(ShellStall::default());
    let service_stall = stall.clone();
    let service = service_fn(move |mut request: Request<Incoming>| {
        let routes = routes.clone();
        let stall = service_stall.clone();
        async move {
            request.extensions_mut().insert(front);
            request.extensions_mut().insert(stall);
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
        stall,
        stall_generation: 0,
        stall_deadline: Box::pin(sleep_until(Instant::now() + SHELL_STALL)),
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
    stream: UnixStream,
    _permit: OwnedSemaphorePermit,
    stall: Arc<ShellStall>,
    stall_generation: u64,
    stall_deadline: Pin<Box<Sleep>>,
}

impl AcceptedStream {
    fn poll_stall(&mut self, cx: &mut Context<'_>) -> bool {
        if !self.stall.active.load(Ordering::SeqCst) {
            return false;
        }
        let generation = self.stall.generation.load(Ordering::SeqCst);
        if generation != self.stall_generation {
            self.stall_generation = generation;
            self.stall_deadline
                .as_mut()
                .reset(Instant::now() + SHELL_STALL);
        }
        self.stall_deadline.as_mut().poll(cx).is_ready()
    }

    fn wrote(&mut self, count: usize) {
        if count > 0 && self.stall.active.load(Ordering::SeqCst) {
            self.stall_deadline
                .as_mut()
                .reset(Instant::now() + SHELL_STALL);
        }
    }
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
        let this = self.get_mut();
        if this.poll_stall(cx) {
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "shell response stalled",
            )));
        }
        let result = Pin::new(&mut this.stream).poll_write(cx, buf);
        if let Poll::Ready(Ok(count)) = &result {
            this.wrote(*count);
        }
        result
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
        let this = self.get_mut();
        if this.poll_stall(cx) {
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "shell response stalled",
            )));
        }
        let result = Pin::new(&mut this.stream).poll_write_vectored(cx, bufs);
        if let Poll::Ready(Ok(count)) = &result {
            this.wrote(*count);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::spawn_and_reap;
    use tokio::task::JoinSet;

    #[tokio::test]
    async fn finished_connections_do_not_accumulate_in_the_join_set() {
        let mut connections = JoinSet::new();
        for _ in 0..10_000 {
            spawn_and_reap(&mut connections, async {});
            tokio::task::yield_now().await;
            assert!(connections.len() <= 1);
        }
        spawn_and_reap(&mut connections, async {});
        tokio::task::yield_now().await;
        spawn_and_reap(&mut connections, async {});
        assert_eq!(connections.len(), 1);
    }
}
