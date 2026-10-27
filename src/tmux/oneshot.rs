//! One-shot `tmux -N` commands (daemon-core.md §3.8): the session sheet's listing,
//! Locates when no control client is ready, and new windows and sessions. Each is one
//! short process that never attaches, killed at the timeout.

use std::path::Path;
use std::process::{ExitStatus, Stdio};
use std::time::Duration;

use tokio::io::AsyncReadExt;
use tokio::process::{ChildStderr, ChildStdout, Command};
use tracing::warn;

use super::session::MAX_REPLY;
use super::{Endpoint, OneShotCmd, Reply, TmuxError, TmuxVersion, command, reply};

/// How long a one-shot may run before it is killed.
pub const TIMEOUT: Duration = Duration::from_secs(2);
/// `tmux -V` is one line; reject unexpectedly large output from a configured program.
const MAX_VERSION_OUTPUT: usize = 128;
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
        OneShotCmd::List => reply::listing(&stdout).map(Reply::Listing),
        OneShotCmd::AdoptBellHook | OneShotCmd::RemoveBellHook => Some(Reply::Ok),
        OneShotCmd::Locate { .. } => reply::location(first_line).map(Reply::Location),
        OneShotCmd::NewWindow { .. } | OneShotCmd::NewSession { .. } => {
            reply::created(first_line).map(Reply::Created)
        }
    }
    .ok_or(TmuxError::BadReply)
}

/// Reads the configured binary's version once at daemon startup. A failed or malformed
/// query leaves version diagnostics unavailable, but must not stop the daemon serving.
pub async fn program_version(program: &Path) -> Option<TmuxVersion> {
    let mut command = Command::new(program);
    command
        .arg("-V")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let output = tokio::time::timeout(TIMEOUT, async {
        let mut child = command.spawn().ok()?;
        let stdout = child.stdout.take()?;
        let mut bytes = Vec::new();
        stdout
            .take((MAX_VERSION_OUTPUT + 1) as u64)
            .read_to_end(&mut bytes)
            .await
            .ok()?;
        if bytes.len() > MAX_VERSION_OUTPUT {
            let _ = child.kill().await;
            return None;
        }
        let status = child.wait().await.ok()?;
        status.success().then_some(bytes)
    })
    .await
    .ok()
    .flatten();
    let version = output
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .and_then(|output| {
            let version = output.trim().strip_prefix("tmux ").unwrap_or(output.trim());
            if version.is_empty() {
                return None;
            }
            match TmuxVersion::parse(version) {
                version @ TmuxVersion::Known { .. } => Some(version),
                TmuxVersion::Unrecognised(_) => None,
            }
        });
    if version.is_none() {
        warn!(program = %program.display(), "could not read configured tmux program version");
    }
    version
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
