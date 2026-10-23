//! One WebSocket connection (daemon-core.md §4.6–4.7, §5.2, §6; auth.md "Carrying the
//! token"): the handshake, the timer that enforces the idle timeout and re-checks the
//! device, pastes written to files, the `dir` check on new windows and sessions, and
//! the hub's `ToConn` moved through an `Outbox` onto the socket, every charge returned
//! as `FromConn::Credit`.
//!
//! One task per socket, one `select!` loop. The frame being written and the charges
//! not yet flushed live in `Conn`, not in the write future, so `select!` may drop that
//! future at any await and the next turn picks the write up where it stopped.

use std::collections::VecDeque;
use std::future::poll_fn;
use std::io::{self, Write as _};
use std::os::unix::fs::OpenOptionsExt as _;
use std::path::Path;
use std::sync::Arc;
use std::task::ready;
use std::time::{Duration, Instant};

use axum::extract::ws::{CloseFrame, Message, Utf8Bytes, WebSocket, WebSocketUpgrade};
use axum::extract::{Extension, State};
use axum::response::Response;
use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt as _, StreamExt as _};
use tokio::sync::{OwnedSemaphorePermit, mpsc, watch};
use tokio::time::sleep_until;
use tracing::{debug, error, info, warn};

use super::Ctx;
use crate::auth::{AuthError, Device, Session};
use crate::hub::{ConnId, Frame, FromConn, Next, Outbox, PasteFile, ToConn};
use crate::proto::{
    self, ClientMsg, CloseCode, DaemonInfo, Decoded, ErrorCode, MIN_PROTOCOL, PROTOCOL_VERSION,
    ServerMsg,
};

/// The subprotocol the daemon answers; the token rides beside it.
const PROTOCOL: &str = "tether.v1";
/// Paste files waiting for tmux, daemon-wide: they sit on tmpfs, in tether's memory.
pub(super) const PASTE_SLOTS: usize = 4;
/// Larger inbound messages close the socket with 4009.
const MAX_INBOUND: usize = 512 * 1024;
const MAX_PASTE: usize = 256 * 1024;
const HELLO_DEADLINE: Duration = Duration::from_secs(10);
/// The timer that re-checks the device...
const RECHECK: Duration = Duration::from_secs(10);
/// ...and closes a socket the client has been silent on for this long.
const IDLE: Duration = Duration::from_secs(25);
/// How long a close waits for the client's answering close.
const CLOSE_WAIT: Duration = Duration::from_secs(1);
/// The connection's own replies (pong, a paste's refusal) waiting to be written. While
/// this many wait, the socket isn't read, so a client that pings without reading
/// can't grow the queue.
const OWN_QUEUE: usize = 16;
/// Client-supplied strings (build, unknown message types) are cut to this in logs.
const LOG_TEXT: usize = 64;
const VERSION: &str = env!("CARGO_PKG_VERSION");

type Sink = SplitSink<WebSocket, Message>;
type Stream = SplitStream<WebSocket>;

/// `GET /ws`, after both checks.
pub(super) async fn upgrade(
    State(ctx): State<Arc<Ctx>>,
    Extension(session): Extension<Session>,
    upgrade: WebSocketUpgrade,
) -> Response {
    let Some(device) = session.device().cloned() else {
        return refuse(upgrade, CloseCode::BadToken);
    };
    match ctx.conns.clone().try_acquire_owned() {
        Ok(slot) => {
            configure(upgrade).on_upgrade(move |socket| run(socket, ctx, session, device, slot))
        }
        Err(_) => {
            warn!(device = %device.name, "over the connection cap");
            refuse(upgrade, CloseCode::OverCap)
        }
    }
}

/// Completes the upgrade and closes at once with `code`, reading nothing: a browser
/// can't see a refused upgrade's status.
pub(super) fn refuse(upgrade: WebSocketUpgrade, code: CloseCode) -> Response {
    configure(upgrade).on_upgrade(move |socket| async move {
        let (mut sink, mut stream) = socket.split();
        close(&mut sink, &mut stream, Some(code)).await;
    })
}

fn configure(upgrade: WebSocketUpgrade) -> WebSocketUpgrade {
    upgrade
        .protocols([PROTOCOL])
        .max_message_size(MAX_INBOUND)
        .max_frame_size(MAX_INBOUND)
}

/// How a connection ends.
#[derive(Debug)]
enum End {
    /// Close the socket with this code.
    Close(CloseCode),
    /// The client closed it; answer its close.
    ClientClosed,
    /// The socket is gone, or the hub is.
    Gone,
}

async fn run(
    socket: WebSocket,
    ctx: Arc<Ctx>,
    session: Session,
    device: Device,
    _slot: OwnedSemaphorePermit,
) {
    let (mut sink, mut stream) = socket.split();
    let end = match handshake(&mut sink, &mut stream, &device).await {
        Err(end) => end,
        Ok(protocol) => match ctx.app.hub.connect().await {
            Err(_) => End::Gone,
            Ok((id, channel)) => {
                let mut host = ctx.app.host.clone();
                if host.name == "tether" {
                    host.name = ctx.app.auth.machine_name("tether").await;
                }
                let welcome = ServerMsg::Welcome {
                    protocol,
                    daemon: DaemonInfo {
                        version: VERSION.to_owned(),
                        completion: ctx.app.caps.completion,
                    },
                    host,
                };
                let now = Instant::now();
                let mut conn = Conn {
                    ctx: &ctx,
                    session: &session,
                    device: &device,
                    id,
                    sink: &mut sink,
                    stream: &mut stream,
                    channel,
                    outbox: Outbox::new(),
                    own: VecDeque::from([encode(&welcome)]),
                    current: None,
                    unflushed: 0,
                    heard: now,
                    checked: now,
                    identity_failures: 0,
                    pastes: 0,
                };
                let end = conn.serve(ctx.shutdown.clone()).await;
                // Its watches end; a hub that already dropped it ignores this.
                let _ = ctx.app.hub.send(id, FromConn::Closed).await;
                info!(conn = id.0, device = %device.name, ?end, "disconnected");
                end
            }
        },
    };
    match end {
        End::Close(code) => close(&mut sink, &mut stream, Some(code)).await,
        End::ClientClosed => close(&mut sink, &mut stream, None).await,
        End::Gone => {}
    }
}

/// Waits for `hello`, the only message accepted before `welcome`. Returns the
/// client's protocol, or how the socket ends.
async fn handshake(sink: &mut Sink, stream: &mut Stream, device: &Device) -> Result<u32, End> {
    let hello = tokio::time::timeout(HELLO_DEADLINE, async {
        loop {
            if let Some(decoded) = read(stream.next().await)? {
                return Ok(decoded);
            }
        }
    })
    .await
    .map_err(|_| End::Close(CloseCode::ProtocolViolation))??;
    let Decoded::Msg(ClientMsg::Hello { protocol, client }) = hello else {
        return Err(End::Close(CloseCode::ProtocolViolation));
    };
    if !proto::accepts(protocol) {
        info!(device = %device.name, protocol, "incompatible client");
        let incompatible = ServerMsg::Incompatible {
            min: MIN_PROTOCOL,
            max: PROTOCOL_VERSION,
            daemon_version: VERSION.to_owned(),
        };
        let _ =
            tokio::time::timeout(CLOSE_WAIT, sink.send(Message::Text(encode(&incompatible)))).await;
        return Err(End::Close(CloseCode::Incompatible));
    }
    let build: String = client.build.chars().take(LOG_TEXT).collect();
    info!(device = %device.name, kind = ?client.kind, %build, protocol, "connected");
    Ok(protocol)
}

struct Conn<'a> {
    ctx: &'a Ctx,
    session: &'a Session,
    device: &'a Device,
    id: ConnId,
    sink: &'a mut Sink,
    stream: &'a mut Stream,
    channel: mpsc::Receiver<ToConn>,
    outbox: Outbox,
    /// The connection's own JSON (welcome, pong, a paste's refusal): never charged to
    /// the hub's credit, and written before the outbox's frames.
    own: VecDeque<Utf8Bytes>,
    /// The next frame for the socket, with its charge.
    current: Option<(Message, u32)>,
    /// Charges of frames handed to the socket and not yet flushed.
    unflushed: u32,
    /// When the client last sent anything.
    heard: Instant,
    /// When the device was last re-checked.
    checked: Instant,
    identity_failures: u8,
    /// Paste files written, to name the next.
    pastes: u64,
}

impl Conn<'_> {
    async fn serve(&mut self, mut shutdown: watch::Receiver<bool>) -> End {
        let mut tick = std::pin::pin!(sleep_until(self.next_tick().into()));
        let mut coalesce = std::pin::pin!(sleep_until(Instant::now().into()));
        let mut armed = None;
        loop {
            let wake = self.fill();
            if let Some(at) = wake.filter(|at| armed != Some(*at)) {
                coalesce.as_mut().reset(at.into());
                armed = Some(at);
            }
            let writing = self.current.is_some() || self.unflushed > 0;
            tokio::select! {
                biased;
                () = stopped(&mut shutdown) => return End::Close(CloseCode::Shutdown),
                msg = self.channel.recv() => match msg {
                    Some(msg) => {
                        self.outbox.push(msg);
                        // The rest of what is queued, in one turn: the credit bounds it.
                        while let Ok(msg) = self.channel.try_recv() {
                            self.outbox.push(msg);
                        }
                    }
                    // The hub dropped this connection as wedged.
                    None => return End::Close(CloseCode::Wedged),
                },
                incoming = self.stream.next(), if self.own.len() < OWN_QUEUE => {
                    if let Err(end) = self.receive(incoming).await {
                        return end;
                    }
                }
                written = write(self.sink, &mut self.current, &mut self.unflushed), if writing => {
                    if written.is_err() {
                        return End::Gone;
                    }
                    self.outbox.written(std::mem::take(&mut self.unflushed));
                }
                () = &mut coalesce, if wake.is_some() => {}
                () = &mut tick => match self.tick().await {
                    Ok(next) => tick.as_mut().reset(next.into()),
                    Err(end) => return end,
                },
            }
            // Credit freed by a write, or by a push or unwatch that discarded frames.
            let bytes = self.outbox.take_credit();
            if bytes > 0 {
                if let Err(end) = self.hub(FromConn::Credit { bytes }).await {
                    return end;
                }
            }
        }
    }

    /// Takes the next frame to write if none is waiting. Returns when coalescing
    /// output is due, if that is all there is.
    fn fill(&mut self) -> Option<Instant> {
        if self.current.is_some() {
            return None;
        }
        if let Some(text) = self.own.pop_front() {
            self.current = Some((Message::Text(text), 0));
            return None;
        }
        match self.outbox.next(Instant::now()) {
            Next::Frame { frame, charge } => {
                let message = match frame {
                    Frame::Text(text) => Message::Text(text.into()),
                    Frame::Binary(bytes) => Message::Binary(bytes.into()),
                };
                self.current = Some((message, charge));
                None
            }
            Next::WaitUntil(at) => Some(at),
            Next::Idle => None,
        }
    }

    async fn receive(&mut self, incoming: Option<Result<Message, axum::Error>>) -> Result<(), End> {
        self.heard = Instant::now();
        let msg = match read(incoming)? {
            None => return Ok(()),
            Some(Decoded::Msg(msg)) => msg,
            Some(Decoded::Unknown { kind }) => {
                let kind: String = kind.chars().take(LOG_TEXT).collect();
                debug!(conn = self.id.0, %kind, "ignored an unknown message type");
                return Ok(());
            }
        };
        match msg {
            // Only the first counts.
            ClientMsg::Hello { .. } => Ok(()),
            ClientMsg::Ping { t } => {
                self.own.push_back(encode(&ServerMsg::Pong { t }));
                Ok(())
            }
            ClientMsg::Paste { watch, text } => self.paste(watch, text).await,
            msg => {
                if let Some((req, dir)) = start_dir(&msg) {
                    if let Err(cause) = self.check_dir(dir.to_owned()).await {
                        self.refuse(Some(req), None, ErrorCode::BadRequest, cause);
                        return Ok(());
                    }
                }
                if let ClientMsg::Unwatch { watch } = &msg {
                    self.outbox.unwatch(*watch);
                }
                self.hub(FromConn::Client(msg)).await
            }
        }
    }

    /// Writes the text to a 0600 file under a paste slot, on the auth lane, so the hub
    /// holds a path, not the text (daemon-core.md §3.4). The hub deletes the file, which
    /// frees the slot.
    async fn paste(&mut self, watch: u32, text: String) -> Result<(), End> {
        if text.len() > MAX_PASTE {
            self.refuse(
                None,
                Some(watch),
                ErrorCode::InputTooLarge,
                "a paste is at most 256 KiB",
            );
            return Ok(());
        }
        let Ok(slot) = self.ctx.pastes.clone().try_acquire_owned() else {
            self.refuse(
                None,
                Some(watch),
                ErrorCode::Busy,
                "too many pastes are waiting for tmux",
            );
            return Ok(());
        };
        self.pastes += 1;
        let name = format!("paste-{}-{}", self.id.0, self.pastes);
        let path = self.ctx.app.paste_dir.join(name);
        let file = path.clone();
        let lanes = &self.ctx.app.lanes;
        let written = lanes.auth.run(move || write_private(&file, &text)).await;
        if let Err(cause) = written.unwrap_or_else(|busy| Err(io::Error::other(busy))) {
            warn!(%cause, path = %path.display(), "can't write a paste file");
            self.refuse(
                None,
                Some(watch),
                ErrorCode::Busy,
                "can't write the paste file",
            );
            return Ok(());
        }
        let file = PasteFile::new(path, slot, lanes.auth.clone());
        self.hub(FromConn::Paste { watch, file }).await
    }

    /// The timer: closes a silent socket, and re-checks the device every `RECHECK`.
    /// Returns when it next fires.
    async fn tick(&mut self) -> Result<Instant, End> {
        let now = Instant::now();
        if now >= self.heard + IDLE {
            return Err(End::Close(CloseCode::Idle));
        }
        if now >= self.checked + RECHECK {
            self.checked = now;
            if let Err(refused) = self.ctx.app.auth.recheck(self.session).await {
                let (conn, device) = (self.id.0, &self.device.name);
                if matches!(self.session, Session::Node { .. })
                    && matches!(&refused, AuthError::IdentityUnavailable(_))
                {
                    self.identity_failures = self.identity_failures.saturating_add(1);
                    if self.identity_failures < 3 {
                        warn!(
                            conn,
                            %device,
                            failures = self.identity_failures,
                            cause = %refused,
                            "node identity check unavailable; keeping socket"
                        );
                        return Ok(self.next_tick());
                    }
                }
                match &refused {
                    AuthError::NoToken | AuthError::Unknown | AuthError::NotEnrolled { .. } => {
                        info!(conn, %device, "the device was removed");
                    }
                    AuthError::Store(_) | AuthError::Busy | AuthError::IdentityUnavailable(_) => {
                        error!(conn, %device, cause = %refused, "can't re-check the device");
                    }
                    AuthError::Ambiguous
                    | AuthError::WrongFront
                    | AuthError::BadOrigin
                    | AuthError::Forbidden
                    | AuthError::NodeRefused(_) => {
                        info!(conn, %device, cause = %refused, "node identity was revoked");
                    }
                }
                return Err(End::Close(CloseCode::from(&refused)));
            }
            self.identity_failures = 0;
        }
        Ok(self.next_tick())
    }

    fn next_tick(&self) -> Instant {
        (self.heard + IDLE).min(self.checked + RECHECK)
    }

    /// `fs::check_dir` on the dir lane: a `stat`, and no config, so a broken
    /// `config.toml` never blocks a new window, and a hung mount stops only the lane.
    /// tmux gets `dir` as given.
    async fn check_dir(&self, dir: String) -> Result<(), &'static str> {
        let lane = &self.ctx.app.lanes.dir;
        let checked = lane.run(move || crate::fs::check_dir(&dir)).await;
        checked.unwrap_or(Err("can't check the directory"))
    }

    /// The connection's own `error`, uncharged.
    fn refuse(&mut self, req: Option<u32>, watch: Option<u32>, code: ErrorCode, message: &str) {
        self.own.push_back(encode(&ServerMsg::Error {
            req,
            watch,
            code,
            message: message.to_owned(),
        }));
    }

    async fn hub(&self, msg: FromConn) -> Result<(), End> {
        self.ctx
            .app
            .hub
            .send(self.id, msg)
            .await
            .map_err(|_| End::Gone)
    }
}

/// Resolves on shutdown, or if the sender is gone. Its guard on the value never
/// outlives it, which keeps the connection's future `Send`.
pub(super) async fn stopped(shutdown: &mut watch::Receiver<bool>) {
    let _ = shutdown.wait_for(|stop| *stop).await;
}

/// The `dir` of a `newWindow` or `newSession`, with its `req`.
fn start_dir(msg: &ClientMsg) -> Option<(u32, &str)> {
    match msg {
        ClientMsg::NewWindow {
            req,
            dir: Some(dir),
            ..
        }
        | ClientMsg::NewSession {
            req,
            dir: Some(dir),
            ..
        } => Some((*req, dir)),
        _ => None,
    }
}

/// One read from the socket: a decoded text message, nothing (a control frame), or how
/// the socket ends.
fn read(incoming: Option<Result<Message, axum::Error>>) -> Result<Option<Decoded>, End> {
    let text = match incoming {
        None => return Err(End::Gone),
        Some(Err(error)) => {
            // axum boxes tungstenite's error; a message over the limit is its Capacity.
            let too_large = error
                .into_inner()
                .downcast::<tungstenite::Error>()
                .is_ok_and(|error| matches!(*error, tungstenite::Error::Capacity(_)));
            return Err(if too_large {
                End::Close(CloseCode::TooLarge)
            } else {
                End::Gone
            });
        }
        Some(Ok(Message::Text(text))) => text,
        Some(Ok(Message::Close(_))) => return Err(End::ClientClosed),
        Some(Ok(Message::Ping(_) | Message::Pong(_))) => return Ok(None),
        // Clients send no binary frames.
        Some(Ok(Message::Binary(_))) => return Err(End::Close(CloseCode::ProtocolViolation)),
    };
    ClientMsg::decode(text.as_str())
        .map(Some)
        .map_err(|_| End::Close(CloseCode::ProtocolViolation))
}

/// Hands `current` to the socket once it has room, then flushes everything handed
/// over. Its state is all in the arguments, so dropping it mid-way loses nothing.
async fn write(
    sink: &mut Sink,
    current: &mut Option<(Message, u32)>,
    unflushed: &mut u32,
) -> Result<(), axum::Error> {
    poll_fn(|cx| {
        if current.is_some() {
            ready!(sink.poll_ready_unpin(cx))?;
            if let Some((message, charge)) = current.take() {
                sink.start_send_unpin(message)?;
                *unflushed += charge;
            }
        }
        sink.poll_flush_unpin(cx)
    })
    .await
}

/// Sends a close with `code`, or flushes the answer to the client's close, then waits
/// briefly for the client to finish so the TCP close comes after it. Reads nothing.
async fn close(sink: &mut Sink, stream: &mut Stream, code: Option<CloseCode>) {
    let _ = tokio::time::timeout(CLOSE_WAIT, async {
        let sent = match code {
            Some(code) => {
                let frame = CloseFrame {
                    code: code.code(),
                    reason: Utf8Bytes::default(),
                };
                sink.send(Message::Close(Some(frame))).await
            }
            None => sink.flush().await,
        };
        if sent.is_ok() {
            while let Some(Ok(_)) = stream.next().await {}
        }
    })
    .await;
}

/// A new 0600 file holding `text`, or none: a partial one is removed.
fn write_private(path: &Path, text: &str) -> io::Result<()> {
    let written = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .and_then(|mut file| file.write_all(text.as_bytes()));
    if written.is_err() {
        let _ = std::fs::remove_file(path);
    }
    written
}

fn encode(msg: &ServerMsg) -> Utf8Bytes {
    msg.encode().into_string().into()
}
