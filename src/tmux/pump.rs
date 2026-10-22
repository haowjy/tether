//! A control client's I/O (daemon-core.md §2, §3.1): one task per `tmux -C` process
//! moves its stdout to the hub as raw bytes and the hub's lines to its stdin. It never
//! parses or decides; the hub's `Session` does.

use std::collections::VecDeque;
use std::fs::File;
use std::io::{self, ErrorKind, Read};
use std::pin::pin;
use std::process::Stdio;
use std::time::Duration;

use bytes::Bytes;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::unix::pipe::Receiver;
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::{Instant, sleep_until};

use super::{ClientId, Endpoint, MAX_IN_FLIGHT, SessionId, command};

/// Bytes per stdout read, so the most one `PumpMsg::Bytes` holds.
pub const READ_SIZE: usize = 16 * 1024;
/// Bytes one read turn takes at most, the default pipe's size, so a turn ends while
/// tmux keeps the pipe full.
const TURN_BYTES: usize = 64 * 1024;
/// At most `TURNS` read turns per `GATE`. More than one, because tmux writes a
/// command's reply and the output it causes separately: a keystroke's echo is the
/// second turn, and must not wait out the gate.
const TURNS: usize = 4;
const GATE: Duration = Duration::from_millis(2);
/// How much of tmux's stderr is kept for the log.
const STDERR_TAIL: usize = 4 * 1024;
/// How long an ending client gets to exit before it is killed.
const CLOSE_WAIT: Duration = Duration::from_secs(1);

/// What a pump tells the hub, in the order it happened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PumpMsg {
    /// The next bytes of the client's stdout.
    Bytes(Bytes),
    /// The process has ended, or never started; always the pump's last message. The
    /// tail of tmux's stderr is tmux's own messages, for the log.
    Exited { stderr_tail: String },
}

/// Starts a control client attached to `session`, and the task that pumps it.
///
/// Each line sent on the returned channel goes to tmux's stdin with a line end. The
/// channel holds `MAX_IN_FLIGHT` lines, as many as `Session` lets be unanswered, so
/// `try_send` can't find it full. Dropping the sender closes the client: stdin closes,
/// and tmux gets a second to exit before it is killed. A closed channel means the pump
/// has ended and its `Exited` is on the way.
///
/// Sending to `out` waits for room, and meanwhile no stdout is read, so tmux holds
/// back; lines keep going to stdin. Must be called inside the tokio runtime.
pub fn spawn(
    endpoint: &Endpoint,
    session: SessionId,
    client: ClientId,
    out: mpsc::Sender<(ClientId, PumpMsg)>,
) -> (mpsc::Sender<String>, JoinHandle<()>) {
    let mut tmux = endpoint.command();
    tmux.args(command::attach(session)).stdin(Stdio::piped());
    let (lines, receiver) = mpsc::channel(MAX_IN_FLIGHT);
    let task = tokio::spawn(async move {
        let stderr_tail = match tmux.spawn() {
            Ok(child) => run(child, client, receiver, &out).await,
            Err(error) => format!("can't run tmux: {error}"),
        };
        // Fails only when the hub has gone, and then nobody is left to tell.
        let _ = out.send((client, PumpMsg::Exited { stderr_tail })).await;
    });
    (lines, task)
}

/// Pumps until the client has ended and its process is gone; returns its stderr tail.
async fn run(
    mut child: Child,
    client: ClientId,
    lines: mpsc::Receiver<String>,
    out: &mpsc::Sender<(ClientId, PumpMsg)>,
) -> String {
    let (Some(stdin), Some(stdout), Some(stderr)) =
        (child.stdin.take(), child.stdout.take(), child.stderr.take())
    else {
        return "tmux started without its pipes".to_owned();
    };
    let pump = async {
        let mut reading = pin!(forward(stdout, client, out));
        // Until tmux ends the client (stdout ends or fails), the hub closes it or has
        // gone, or stdin breaks. Whichever side is left drops here, closing stdin.
        let ended = tokio::select! {
            _ = &mut reading => true,
            () = write(stdin, lines) => false,
        };
        let exit = async {
            if !ended {
                let _ = reading.await;
            }
            child.wait().await
        };
        if tokio::time::timeout(CLOSE_WAIT, exit).await.is_err() {
            let _ = child.kill().await;
        }
    };
    let ((), stderr_tail) = tokio::join!(pump, tail(stderr));
    stderr_tail
}

/// Sends stdout to the hub until it ends, a read fails, or the hub has gone.
///
/// tmux writes each `%output` line separately, so reading whenever stdout is readable
/// wakes the task once per line. Instead each turn drains the pipe, and past `TURNS`
/// turns in `GATE` the reader takes stdout out of epoll and waits out the gate, so
/// tmux's writes wake nothing and a flood is read in batches. A quiet pipe is waited on
/// in epoll, so the first bytes after a quiet spell are read at once.
async fn forward(
    stdout: ChildStdout,
    client: ClientId,
    out: &mpsc::Sender<(ClientId, PumpMsg)>,
) -> io::Result<()> {
    // `into_owned_fd` hands back a blocking fd, which would stall the runtime;
    // `from_owned_fd` makes it non-blocking.
    let mut stdout = Stdout::Polled(Receiver::from_owned_fd(stdout.into_owned_fd()?)?);
    let mut buffer = vec![0; READ_SIZE];
    // When the last `TURNS` turns that read anything ended, oldest first.
    let mut turns = VecDeque::with_capacity(TURNS);
    loop {
        if turns.len() == TURNS {
            let open = turns[0] + GATE;
            if open > Instant::now() {
                stdout = stdout.unpolled()?;
                sleep_until(open).await;
            }
        }
        let mut turn = 0;
        while turn < TURN_BYTES {
            let read = match stdout.read(&mut buffer) {
                Ok(0) => return Ok(()),
                Ok(read) => read,
                Err(error) if error.kind() == ErrorKind::WouldBlock => break,
                Err(error) => return Err(error),
            };
            let bytes = Bytes::copy_from_slice(&buffer[..read]);
            if out.send((client, PumpMsg::Bytes(bytes))).await.is_err() {
                return Ok(());
            }
            turn += read;
            // A short read emptied the pipe.
            if read < READ_SIZE {
                break;
            }
        }
        if turn == 0 {
            stdout = stdout.readable().await?;
        } else {
            if turns.len() == TURNS {
                turns.pop_front();
            }
            turns.push_back(Instant::now());
        }
    }
}

/// A control client's non-blocking stdout: in epoll while the reader waits for tmux to
/// write, out of it while the gate holds reads back.
enum Stdout {
    Polled(Receiver),
    Unpolled(File),
}

impl Stdout {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        match self {
            // Through tokio, so that running dry clears the readiness it saw.
            Self::Polled(pipe) => pipe.try_read(buffer),
            Self::Unpolled(file) => file.read(buffer),
        }
    }

    fn unpolled(self) -> io::Result<Self> {
        Ok(match self {
            Self::Polled(pipe) => Self::Unpolled(pipe.into_nonblocking_fd()?.into()),
            unpolled @ Self::Unpolled(_) => unpolled,
        })
    }

    /// Waits in epoll until there is something to read or stdout has ended.
    async fn readable(self) -> io::Result<Self> {
        let pipe = match self {
            Self::Polled(pipe) => pipe,
            Self::Unpolled(file) => Receiver::from_file(file)?,
        };
        pipe.readable().await?;
        Ok(Self::Polled(pipe))
    }
}

/// Writes the hub's lines to stdin until the hub drops its sender or stdin breaks.
async fn write(mut stdin: ChildStdin, mut lines: mpsc::Receiver<String>) {
    while let Some(line) = lines.recv().await {
        // An empty line detaches the client, and a line end would split the group.
        debug_assert!(!line.is_empty() && !line.contains(['\n', '\r']), "bad line");
        let mut bytes = line.into_bytes();
        bytes.push(b'\n');
        if stdin.write_all(&bytes).await.is_err() {
            return;
        }
    }
}

/// The last `STDERR_TAIL` bytes of stderr, read until it closes.
async fn tail(mut stderr: ChildStderr) -> String {
    let mut tail = Vec::new();
    let mut buffer = [0; 1024];
    while let Ok(read @ 1..) = stderr.read(&mut buffer).await {
        tail.extend_from_slice(&buffer[..read]);
        let excess = tail.len().saturating_sub(STDERR_TAIL);
        tail.drain(..excess);
    }
    String::from_utf8_lossy(&tail).trim_end().to_owned()
}
