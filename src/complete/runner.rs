//! carapace's runner (complete.md "carapace"): one task that owns the child process, one
//! run at a time, the latest key winning. Every finished run's result goes into
//! `carapace::Shared`, whether anyone still waits or not. Under systemd each run gets
//! its own transient scope, outside tether's memory limit. Arguments and output are
//! never logged.

use std::ffi::OsString;
use std::path::PathBuf;
use std::pin::Pin;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt as _};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot};
use tokio::time::Instant;
use tracing::debug;

use super::carapace::{Failure, Key, Outcome, Shared};
use super::lock;

/// A run, and `carapace --list`, from spawn to the end of its output.
const RUN_TIMEOUT: Duration = Duration::from_millis(300);
/// More stdout than this kills the run, as a failure.
const MAX_OUTPUT: usize = 1 << 20;
/// Only this much of stderr is kept, its end.
const STDERR_TAIL: usize = 4 * 1024;
/// `systemd-run`'s arguments before carapace's. `--description` replaces the default,
/// the command line, which would put the words typed in the user journal.
/// `RuntimeMaxSec` ends a scope a kill left empty before `systemd-run` exec'd.
const SCOPE: [&str; 15] = [
    "--user",
    "--scope",
    "--quiet",
    "--collect",
    "--description=tether completion",
    "-p",
    "MemoryMax=128M",
    "-p",
    "TasksMax=64",
    "-p",
    "CPUWeight=20",
    "-p",
    "IOWeight=10",
    "-p",
    "RuntimeMaxSec=2",
];

struct Ask {
    key: Key,
    binary: PathBuf,
    reply: oneshot::Sender<Outcome>,
}

/// The runner task's address. The task ends when the last `Runner` is dropped, and a
/// run still going is killed then.
#[derive(Debug, Clone)]
pub struct Runner {
    asks: mpsc::Sender<Ask>,
}

/// How runs are started.
#[derive(Debug, Clone)]
pub struct Launch {
    /// carapace's `PATH`, so the helpers it starts resolve as the shell's would.
    pub path: OsString,
    /// Under systemd: each run in its own transient scope.
    pub scoped: bool,
}

impl Runner {
    pub fn spawn(shared: Arc<Mutex<Shared>>, launch: Launch) -> Self {
        // Requests are capped at 4 in flight; each sends one ask at a time.
        let (asks, inbox) = mpsc::channel(8);
        tokio::spawn(serve(inbox, shared, launch));
        Self { asks }
    }

    /// The outcome of the run for `key`, joining one in flight for the same key. A
    /// caller that stops waiting kills nothing.
    pub async fn ask(&self, key: Key, binary: PathBuf) -> Outcome {
        let (reply, answer) = oneshot::channel();
        let ask = Ask { key, binary, reply };
        if self.asks.send(ask).await.is_err() {
            return Outcome::Superseded;
        }
        answer.await.unwrap_or(Outcome::Superseded)
    }
}

type Running = Pin<Box<dyn Future<Output = Result<Vec<u8>, Failure>> + Send>>;

struct Current {
    key: Key,
    waiters: Vec<oneshot::Sender<Outcome>>,
    run: Running,
}

enum Event {
    Ask(Option<Ask>),
    Done(Result<Vec<u8>, Failure>),
}

async fn serve(mut inbox: mpsc::Receiver<Ask>, shared: Arc<Mutex<Shared>>, launch: Launch) {
    let mut current: Option<Current> = None;
    loop {
        let event = match current.as_mut() {
            None => Event::Ask(inbox.recv().await),
            Some(running) => tokio::select! {
                ask = inbox.recv() => Event::Ask(ask),
                done = &mut running.run => Event::Done(done),
            },
        };
        match event {
            Event::Ask(None) => return,
            Event::Ask(Some(ask)) => {
                if let Some(outcome) = lock(&shared).cached(&ask.key, Instant::now()) {
                    let _ = ask.reply.send(outcome);
                    continue;
                }
                if let Some(running) = current.as_mut().filter(|running| running.key == ask.key) {
                    running.waiters.push(ask.reply);
                    continue;
                }
                if let Some(stale) = current.take() {
                    // Dropping the run kills its process group.
                    debug!("a carapace run killed for a newer key");
                    for waiter in stale.waiters {
                        let _ = waiter.send(Outcome::Superseded);
                    }
                }
                let (argv, cwd) = ask.key.argv(&ask.binary);
                let run = Box::pin(execute(argv, cwd.map(PathBuf::from), launch.clone()));
                current = Some(Current {
                    key: ask.key,
                    waiters: vec![ask.reply],
                    run,
                });
            }
            Event::Done(result) => {
                let Some(done) = current.take() else {
                    continue;
                };
                // Cached even when nobody waits any more.
                let outcome = lock(&shared).store(done.key, result, Instant::now());
                for waiter in done.waiters {
                    let _ = waiter.send(outcome.clone());
                }
            }
        }
    }
}

async fn execute(
    argv: Vec<OsString>,
    cwd: Option<PathBuf>,
    launch: Launch,
) -> Result<Vec<u8>, Failure> {
    match tokio::time::timeout(RUN_TIMEOUT, run(argv, cwd, launch)).await {
        Ok(result) => result,
        Err(_) => Err(Failure::Timeout),
    }
}

/// One run to its end. Dropped early (a timeout, a newer key, the output cap), it kills
/// the run's process group.
async fn run(
    argv: Vec<OsString>,
    cwd: Option<PathBuf>,
    launch: Launch,
) -> Result<Vec<u8>, Failure> {
    let mut command = if launch.scoped {
        let mut command = Command::new("systemd-run");
        command.args(SCOPE).arg("--").args(&argv);
        command
    } else {
        let mut command = Command::new(&argv[0]);
        command.args(&argv[1..]);
        command
    };
    command
        .env("PATH", &launch.path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // `systemd-run` keeps its PID and group when it execs carapace, so a kill of
        // the group reaches carapace and the helpers it starts.
        .process_group(0);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    let mut child = command.spawn().map_err(Failure::Spawn)?;
    let mut group = Group(child.id());
    let stdout = read_capped(child.stdout.take());
    let stderr = read_tail(child.stderr.take());
    let (stdout, stderr) = tokio::try_join!(stdout, stderr)?;
    let status = child.wait().await.map_err(Failure::Io)?;
    group.0 = None;
    if !status.success() {
        return Err(Failure::Exit { status, stderr });
    }
    Ok(stdout)
}

/// A process group, killed on drop unless the run ended.
struct Group(Option<u32>);

impl Drop for Group {
    fn drop(&mut self) {
        let pid = self
            .0
            .and_then(|pid| rustix::process::Pid::from_raw(pid as i32));
        if let Some(pid) = pid {
            // The child is reaped by tokio once it is dropped.
            let _ = rustix::process::kill_process_group(pid, rustix::process::Signal::KILL);
        }
    }
}

async fn read_capped(pipe: Option<impl AsyncRead + Unpin>) -> Result<Vec<u8>, Failure> {
    let Some(pipe) = pipe else {
        return Ok(Vec::new());
    };
    // Mapped, not touched: only what is written becomes resident.
    let mut output = Vec::with_capacity(MAX_OUTPUT + 1);
    pipe.take(MAX_OUTPUT as u64 + 1)
        .read_to_end(&mut output)
        .await
        .map_err(Failure::Io)?;
    if output.len() > MAX_OUTPUT {
        return Err(Failure::TooLarge);
    }
    Ok(output)
}

async fn read_tail(pipe: Option<impl AsyncRead + Unpin>) -> Result<Vec<u8>, Failure> {
    let Some(mut pipe) = pipe else {
        return Ok(Vec::new());
    };
    let mut tail = Vec::new();
    let mut chunk = [0; 1024];
    loop {
        let n = pipe.read(&mut chunk).await.map_err(Failure::Io)?;
        if n == 0 {
            return Ok(tail);
        }
        tail.extend_from_slice(&chunk[..n]);
        if tail.len() > STDERR_TAIL {
            tail.drain(..tail.len() - STDERR_TAIL);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt as _;

    use super::*;
    use crate::fs::test_tree::Tree;

    /// A stand-in for carapace: `slow` sleeps, `forks` leaves a child in its group,
    /// `git` answers; each run appends its arguments to `runs`.
    fn fake_carapace(tree: &Tree) -> PathBuf {
        let script = format!(
            r#"#!/bin/sh
dir={dir}
if [ "$1" = --list ]; then
  echo '{{"git":[],"slow":[],"forks":[]}}'
  exit 0
fi
echo "$@" >> "$dir/runs"
case "$1" in
  git) cat <<'JSON'
{{"nospace":".","values":[{{"value":"--force","display":"--force"}},{{"value":"--detach","display":"--detach"}}]}}
JSON
  ;;
  slow) echo $$ > "$dir/slow.pid"; sleep 5 ;;
  forks) sleep 30 & echo $! > "$dir/fork.pid"; wait ;;
esac
"#,
            dir = tree.str("")
        );
        let path = tree.path("carapace");
        std::fs::write(&path, script).expect("written");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).expect("chmod");
        path
    }

    fn key(tree: &Tree, cmd: &str, stem: &str) -> Key {
        Key::Values {
            cwd: tree.str(""),
            words: vec![cmd.to_owned(), stem.to_owned()],
        }
    }

    fn runner() -> (Runner, Arc<Mutex<Shared>>) {
        let shared = Arc::new(Mutex::new(Shared::default()));
        let launch = Launch {
            path: std::env::var_os("PATH").unwrap_or_default(),
            scoped: false,
        };
        (Runner::spawn(shared.clone(), launch), shared)
    }

    fn runs(tree: &Tree) -> usize {
        std::fs::read_to_string(tree.path("runs")).map_or(0, |runs| runs.lines().count())
    }

    /// The pid in `file`, once the script has written it.
    async fn pid(tree: &Tree, file: &str) -> rustix::process::Pid {
        for _ in 0..200 {
            let written = std::fs::read_to_string(tree.path(file)).unwrap_or_default();
            if let Some(pid) = written
                .trim()
                .parse()
                .ok()
                .and_then(rustix::process::Pid::from_raw)
            {
                return pid;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("no {file}");
    }

    /// Gone, or a zombie waiting to be reaped.
    async fn dies(pid: rustix::process::Pid) -> bool {
        for _ in 0..200 {
            let stat = std::fs::read_to_string(format!("/proc/{}/stat", pid.as_raw_nonzero()));
            let zombie = stat.as_deref().is_ok_and(|stat| {
                stat.rsplit_once(") ")
                    .is_some_and(|(_, rest)| rest.starts_with('Z'))
            });
            if zombie || rustix::process::test_kill_process(pid).is_err() {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        false
    }

    #[tokio::test]
    async fn a_run_times_out_its_group_is_killed_and_the_failure_is_cached() {
        let tree = Tree::new("carapace-timeout");
        let binary = fake_carapace(&tree);
        let (runner, shared) = runner();
        let started = std::time::Instant::now();
        let outcome = runner.ask(key(&tree, "forks", ""), binary.clone()).await;
        let elapsed = started.elapsed();
        let Outcome::Values(values) = outcome else {
            panic!("{outcome:?}");
        };
        assert!(values.chips("").is_empty());
        assert!(
            elapsed >= RUN_TIMEOUT && elapsed < Duration::from_secs(2),
            "{elapsed:?}"
        );
        // The child the script left in its group is killed with it.
        assert!(dies(pid(&tree, "fork.pid").await).await);
        // Cached as empty: the next keystroke doesn't run it again.
        let again = runner.ask(key(&tree, "forks", ""), binary).await;
        assert!(matches!(again, Outcome::Values(_)));
        assert_eq!(runs(&tree), 1);
        let cached = lock(&shared).cached(&key(&tree, "forks", ""), Instant::now());
        assert!(cached.is_some());
    }

    #[tokio::test]
    async fn a_newer_key_kills_the_run_in_flight_and_it_isnt_cached() {
        let tree = Tree::new("carapace-newer");
        let binary = fake_carapace(&tree);
        let (runner, shared) = runner();
        let slow = tokio::spawn({
            let (runner, binary, key) = (runner.clone(), binary.clone(), key(&tree, "slow", ""));
            async move { runner.ask(key, binary).await }
        });
        let slow_pid = pid(&tree, "slow.pid").await;
        // The same key joins the run; another key kills it. Polled once, the joining
        // request is in the runner's inbox, ahead of the newer key.
        let mut joined = Box::pin(runner.ask(key(&tree, "slow", ""), binary.clone()));
        tokio::select! {
            biased;
            _ = &mut joined => panic!("answered before the run ended"),
            () = std::future::ready(()) => {}
        }
        let newer = runner.ask(key(&tree, "git", "-"), binary).await;
        let Outcome::Values(values) = newer else {
            panic!("{newer:?}");
        };
        let chips = values.chips("--f");
        let inserts: Vec<_> = chips.iter().map(|c| (&*c.insert, &*c.label)).collect();
        assert_eq!(inserts, [("orce ", "--force")]);
        assert!(matches!(slow.await.expect("joined"), Outcome::Superseded));
        assert!(matches!(joined.await, Outcome::Superseded));
        assert!(dies(slow_pid).await);
        assert_eq!(runs(&tree), 2);
        let stale = lock(&shared).cached(&key(&tree, "slow", ""), Instant::now());
        assert!(stale.is_none());
    }

    #[tokio::test]
    async fn an_abandoned_request_kills_nothing_and_its_result_is_cached() {
        let tree = Tree::new("carapace-abandoned");
        let binary = fake_carapace(&tree);
        let (runner, shared) = runner();
        // The phone aborts the request as soon as it is sent.
        let asked = runner.ask(key(&tree, "git", "-"), binary.clone());
        let _ = tokio::time::timeout(Duration::from_millis(1), asked).await;
        let mut cached = None;
        for _ in 0..200 {
            cached = lock(&shared).cached(&key(&tree, "git", "-"), Instant::now());
            if cached.is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let Some(Outcome::Values(values)) = cached else {
            panic!("not cached: {cached:?}");
        };
        assert_eq!(values.chips("--").len(), 2);
        // The list is a run like the others, and is kept once it parses.
        let list = runner.ask(Key::List, binary).await;
        let Outcome::List(Some(list)) = list else {
            panic!("{list:?}");
        };
        assert!(list.find("git").is_some() && list.find("ls").is_none());
        assert_eq!(runs(&tree), 1);
    }
}
