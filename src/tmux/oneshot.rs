//! One-shot `tmux -N` commands (daemon-core.md §3.8): the session sheet's listing,
//! Locates when no control client is ready, and new windows and sessions. Each is one
//! short process that never attaches, killed at the timeout.

use std::collections::BTreeSet;
use std::process::ExitStatus;
use std::time::Duration;

use tokio::io::AsyncReadExt;
use tokio::process::{ChildStderr, ChildStdout};

use super::session::{MAX_REPLY, parse_location, parse_server, parse_session_location};
use super::{
    Created, Endpoint, ListedSession, ListedWindow, Listing, OneShotCmd, Reply, SessionId,
    TmuxError, TmuxVersion, WindowId, command,
};

/// How long a one-shot may run before it is killed.
pub const TIMEOUT: Duration = Duration::from_secs(2);
/// How much of tmux's stderr is kept for the error message.
const MAX_ERROR: u64 = 4 * 1024;

/// Runs `cmd` once on `endpoint`. The caller runs one at a time.
pub async fn run(endpoint: &Endpoint, cmd: &OneShotCmd) -> Result<Reply, TmuxError> {
    let mut tmux = endpoint.command();
    tmux.args(command::oneshot(cmd)?);
    // Dropping the child at the timeout kills it.
    let (stdout, stderr, status) = tokio::time::timeout(TIMEOUT, async {
        let mut child = tmux.spawn().map_err(spawn_error)?;
        let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
            return Err(TmuxError::Spawn(
                "tmux started without its pipes".to_owned(),
            ));
        };
        let (stdout, stderr) = tokio::try_join!(read_capped(stdout), read_head(stderr))?;
        let status = child.wait().await.map_err(spawn_error)?;
        Ok((stdout, stderr, status))
    })
    .await
    .map_err(|_| TmuxError::Timeout)??;
    if !status.success() {
        return Err(failure(&stderr, status));
    }
    let first_line = stdout
        .split(|byte| *byte == b'\n')
        .next()
        .unwrap_or_default();
    match cmd {
        OneShotCmd::List => listing(&stdout).map(Reply::Listing),
        OneShotCmd::Locate { .. } => parse_location(first_line).map(Reply::Location),
        OneShotCmd::LocateSession { .. } => {
            parse_session_location(first_line).map(Reply::SessionLocation)
        }
        OneShotCmd::NewWindow { .. } | OneShotCmd::NewSession { .. } => {
            created(first_line).map(Reply::Created)
        }
    }
    .ok_or(TmuxError::BadReply)
}

fn spawn_error(error: std::io::Error) -> TmuxError {
    TmuxError::Spawn(error.to_string())
}

/// All of stdout, or `TooLarge` past the reply cap; returning early drops the child,
/// which kills it.
async fn read_capped(stdout: ChildStdout) -> Result<Vec<u8>, TmuxError> {
    let mut bytes = Vec::new();
    stdout
        .take(MAX_REPLY as u64 + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(spawn_error)?;
    if bytes.len() > MAX_REPLY {
        return Err(TmuxError::TooLarge);
    }
    Ok(bytes)
}

/// The start of stderr; tmux prints one line per failure.
async fn read_head(stderr: ChildStderr) -> Result<Vec<u8>, TmuxError> {
    let mut bytes = Vec::new();
    stderr
        .take(MAX_ERROR)
        .read_to_end(&mut bytes)
        .await
        .map_err(spawn_error)?;
    Ok(bytes)
}

/// Why tmux failed. With `-N` and no server, a stale socket is refused and a missing
/// one is absent; both mean no server, as does another instance than the one-shot was
/// for (`command::SERVER_CHANGED`).
fn failure(stderr: &[u8], status: ExitStatus) -> TmuxError {
    let message = String::from_utf8_lossy(stderr).trim().to_owned();
    let absent = message.starts_with("error connecting to ")
        && message.ends_with("(No such file or directory)");
    if message.starts_with("no server running on ")
        || absent
        || message.contains(command::SERVER_CHANGED)
    {
        TmuxError::NoServer
    } else if message.is_empty() {
        TmuxError::Command(format!("tmux {status}"))
    } else {
        TmuxError::Command(message)
    }
}

/// `pid start_time session_id window_id`.
fn created(row: &[u8]) -> Option<Created> {
    let row = std::str::from_utf8(row).ok()?;
    let [pid, start_time, session, window] = row.split('\t').collect::<Vec<_>>()[..] else {
        return None;
    };
    Some(Created {
        server: parse_server(pid, start_time)?,
        session: SessionId::parse(session.as_bytes())?,
        window: WindowId::parse(window.as_bytes())?,
    })
}

/// The server line, then a line per client, then a line per window, sessions in order
/// (`command::oneshot`). A line that fits neither shape comes from a window name with a
/// line break in it, and is skipped.
fn listing(stdout: &[u8]) -> Option<Listing> {
    let text = String::from_utf8_lossy(stdout);
    let mut lines = text.split('\n');
    let [version, pid, start_time] = lines.next()?.split('\t').collect::<Vec<_>>()[..] else {
        return None;
    };
    let mut listing = Listing {
        server: parse_server(pid, start_time)?,
        version: TmuxVersion::parse(version),
        sessions: Vec::new(),
    };
    let mut attached = BTreeSet::new();
    for line in lines {
        match line.splitn(7, '\t').collect::<Vec<_>>()[..] {
            [session, "0"] if listing.sessions.is_empty() => {
                attached.extend(SessionId::parse(session.as_bytes()));
            }
            [session, window, index, active, activity, session_name, name] => {
                let (Some(session), Some(id), Ok(index), Ok(activity)) = (
                    SessionId::parse(session.as_bytes()),
                    WindowId::parse(window.as_bytes()),
                    index.parse(),
                    activity.parse(),
                ) else {
                    continue;
                };
                if listing
                    .sessions
                    .last()
                    .is_none_or(|last| last.id != session)
                {
                    listing.sessions.push(ListedSession {
                        id: session,
                        name: session_name.to_owned(),
                        attached_elsewhere: attached.contains(&session),
                        windows: Vec::new(),
                    });
                }
                if let Some(last) = listing.sessions.last_mut() {
                    last.windows.push(ListedWindow {
                        id,
                        index,
                        name: name.to_owned(),
                        active: active == "1",
                        activity,
                    });
                }
            }
            _ => {}
        }
    }
    Some(listing)
}
