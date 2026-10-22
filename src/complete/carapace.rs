//! carapace (complete.md "carapace"): subcommands, flags and values for the commands
//! `carapace --list` covers. Stems, argv and the JSON are pure; the runner is one task
//! that owns the child process, one run at a time, the latest key winning; results
//! are cached 30 s in a small LRU. Under systemd each run gets its own transient
//! scope, outside tether's memory limit. Arguments and output are never logged.

use std::collections::BTreeMap;
use std::ffi::{OsStr, OsString};
use std::io;
use std::os::unix::fs::MetadataExt as _;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::process::{ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Deserialize;
use serde::de::IgnoredAny;
use tokio::io::{AsyncRead, AsyncReadExt as _};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot};
use tokio::time::Instant;
use tracing::{debug, info, warn};

use super::packed::Packed;
use super::{CHIPS, chip, lock};
use crate::proto::complete::{Chip, ChipSource};

/// A run, and `carapace --list`, from spawn to the end of its output.
const RUN_TIMEOUT: Duration = Duration::from_millis(300);
/// More stdout than this kills the run, as a failure.
const MAX_OUTPUT: usize = 1 << 20;
/// Only this much of stderr is kept, its end.
const STDERR_TAIL: usize = 4 * 1024;
/// Every result is cached this long, failures and timeouts included.
const TTL: Duration = Duration::from_secs(30);
const CACHE_ENTRIES: usize = 64;
const CACHE_BYTES: usize = 1 << 20;
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

static MISSING_LOGGED: AtomicBool = AtomicBool::new(false);
static LIST_WARNED: AtomicBool = AtomicBool::new(false);

/// `cur` through its last `/ = : , @ +`; else `-` for a flag; else empty. carapace
/// gets the stem and tether filters by `cur`, so one run serves each keystroke until
/// the stem changes.
pub fn stem(cur: &str) -> &str {
    match cur.rfind(['/', '=', ':', ',', '@', '+']) {
        Some(at) => &cur[..=at],
        None if cur.starts_with('-') => "-",
        None => "",
    }
}

/// What a run is for: equal keys share one run and one cache entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Key {
    List,
    /// `cmd`, its arguments before the current word, then the stem.
    Values {
        cwd: String,
        words: Vec<String>,
    },
}

impl Key {
    fn argv(&self, binary: &Path) -> (Vec<OsString>, Option<&str>) {
        let mut argv = vec![binary.as_os_str().to_owned()];
        match self {
            Self::List => {
                argv.push("--list".into());
                (argv, None)
            }
            Self::Values { cwd, words } => {
                let (cmd, rest) = match words.split_first() {
                    Some((cmd, rest)) => (cmd.as_str(), rest),
                    None => ("", &[][..]),
                };
                argv.extend([cmd, "export", ""].map(OsString::from));
                argv.extend(rest.iter().map(OsString::from));
                (argv, Some(cwd))
            }
        }
    }

    fn bytes(&self) -> usize {
        match self {
            Self::List => 0,
            Self::Values { cwd, words } => cwd.len() + words.iter().map(String::len).sum::<usize>(),
        }
    }
}

/// One run's candidates, in carapace's order: value, display and description for each.
#[derive(Debug, Default)]
pub struct Values {
    nospace: String,
    /// Three pieces per value.
    pieces: Packed,
}

#[derive(Deserialize)]
struct Export {
    #[serde(default)]
    nospace: String,
    #[serde(default)]
    values: Option<Vec<Value>>,
}

#[derive(Deserialize)]
struct Value {
    value: String,
    #[serde(default)]
    display: String,
    #[serde(default)]
    description: Option<String>,
}

impl Values {
    /// carapace's `export` JSON, read loosely: unknown fields ignored.
    pub fn parse(json: &[u8]) -> Result<Self, serde_json::Error> {
        let export: Export = serde_json::from_slice(json)?;
        let values = export.values.unwrap_or_default();
        let bytes = values
            .iter()
            .map(|v| {
                v.value.len() + v.display.len() + v.description.as_ref().map_or(0, String::len)
            })
            .sum();
        let mut pieces = Packed::with_capacity(bytes, values.len() * 3);
        for value in &values {
            pieces.push(&value.value);
            pieces.push(&value.display);
            pieces.push(value.description.as_deref().unwrap_or_default());
        }
        Ok(Self {
            nospace: export.nospace,
            pieces,
        })
    }

    /// The values starting with `cur`, as chips: the rest of each, escaped, then a
    /// space unless carapace's `nospace` says otherwise.
    pub fn chips(&self, cur: &str) -> Vec<Chip> {
        (0..self.pieces.len() / 3)
            .filter_map(|i| {
                let value = self.pieces.get(i * 3);
                let rest = value.strip_prefix(cur)?;
                let last = value.chars().next_back()?;
                let spaced = self.nospace != "*" && !self.nospace.contains(last);
                let end = if spaced { " " } else { "" };
                let display = self.pieces.get(i * 3 + 1);
                let label = if display.is_empty() { value } else { display };
                let description = Some(self.pieces.get(i * 3 + 2));
                chip(
                    ChipSource::Carapace,
                    rest,
                    end,
                    label.to_owned(),
                    description,
                )
            })
            .take(CHIPS)
            .collect()
    }

    fn bytes(&self) -> usize {
        self.nospace.len() + self.pieces.bytes()
    }
}

/// The commands carapace covers, sorted: the keys of `carapace --list`'s JSON.
pub fn parse_list(json: &[u8]) -> Result<Packed, serde_json::Error> {
    let commands: BTreeMap<String, IgnoredAny> = serde_json::from_slice(json)?;
    let bytes = commands.keys().map(String::len).sum();
    let mut packed = Packed::with_capacity(bytes, commands.len());
    for command in commands.keys() {
        packed.push(command);
    }
    Ok(packed)
}

/// The binary, `configured` or `carapace` on `path`, if it is an executable file;
/// logged once per process when it isn't. Blocks: a `stat` per `PATH` directory.
pub fn resolve(configured: Option<&Path>, path: &OsStr) -> Option<PathBuf> {
    let executable = |file: &Path| {
        std::fs::metadata(file).is_ok_and(|meta| meta.is_file() && meta.mode() & 0o111 != 0)
    };
    let found = match configured {
        Some(file) => executable(file).then(|| file.to_owned()),
        None => std::env::split_paths(path)
            .filter(|dir| dir.is_absolute())
            .map(|dir| dir.join("carapace"))
            .find(|file| executable(file)),
    };
    if found.is_none() && !MISSING_LOGGED.swap(true, Ordering::Relaxed) {
        info!("carapace not found: no subcommand, flag or value chips");
    }
    found
}

#[derive(Debug, Clone, Default)]
pub enum Binary {
    #[default]
    Unknown,
    /// Remembered until the idle drop.
    Missing,
    Found(PathBuf),
}

#[derive(Debug)]
enum Listed {
    Known(Arc<Packed>),
    /// Retried 30 s later.
    Failed(Instant),
}

/// What the request side and the runner share; the idle drop resets it whole.
#[derive(Debug, Default)]
pub struct Shared {
    pub binary: Binary,
    list: Option<Listed>,
    cache: Lru,
}

/// What a run's waiters get.
#[derive(Debug, Clone)]
pub enum Outcome {
    /// `None`: the list failed.
    List(Option<Arc<Packed>>),
    Values(Arc<Values>),
    /// Killed for a newer key; not cached.
    Superseded,
}

impl Shared {
    /// An answer for `key` without a run, if there is one now.
    pub fn cached(&mut self, key: &Key, now: Instant) -> Option<Outcome> {
        match key {
            Key::List => match &self.list {
                Some(Listed::Known(list)) => Some(Outcome::List(Some(list.clone()))),
                Some(Listed::Failed(at)) if now.duration_since(*at) < TTL => {
                    Some(Outcome::List(None))
                }
                _ => None,
            },
            Key::Values { .. } => self.cache.get(key, now).map(Outcome::Values),
        }
    }

    /// A finished run's result, stored; what its waiters get.
    fn store(&mut self, key: Key, result: Result<Vec<u8>, Failure>, now: Instant) -> Outcome {
        match key {
            Key::List => {
                let list = result.and_then(|json| parse_list(&json).map_err(Failure::from));
                match list {
                    Ok(list) => {
                        let list = Arc::new(list);
                        self.list = Some(Listed::Known(list.clone()));
                        Outcome::List(Some(list))
                    }
                    Err(failure) => {
                        if !LIST_WARNED.swap(true, Ordering::Relaxed) {
                            let stderr = String::from_utf8_lossy(failure.stderr());
                            warn!(%failure, %stderr, "carapace --list failed: no carapace chips for now");
                        }
                        self.list = Some(Listed::Failed(now));
                        Outcome::List(None)
                    }
                }
            }
            Key::Values { .. } => {
                let values = result.and_then(|json| Values::parse(&json).map_err(Failure::from));
                let values = values.unwrap_or_else(|failure| {
                    debug!(%failure, "a carapace run failed");
                    Values::default()
                });
                let values = Arc::new(values);
                self.cache.insert(key, values.clone(), now);
                Outcome::Values(values)
            }
        }
    }
}

/// Least recently used first; at most 64 entries or 1 MiB.
#[derive(Debug, Default)]
struct Lru {
    entries: Vec<Entry>,
    bytes: usize,
}

#[derive(Debug)]
struct Entry {
    key: Key,
    values: Arc<Values>,
    at: Instant,
    bytes: usize,
}

impl Lru {
    fn get(&mut self, key: &Key, now: Instant) -> Option<Arc<Values>> {
        let at = self.entries.iter().position(|entry| entry.key == *key)?;
        let entry = self.entries.remove(at);
        if now.duration_since(entry.at) >= TTL {
            self.bytes -= entry.bytes;
            return None;
        }
        let values = entry.values.clone();
        self.entries.push(entry);
        Some(values)
    }

    fn insert(&mut self, key: Key, values: Arc<Values>, now: Instant) {
        if let Some(at) = self.entries.iter().position(|entry| entry.key == key) {
            self.bytes -= self.entries.remove(at).bytes;
        }
        let bytes = key.bytes() + values.bytes();
        self.entries.push(Entry {
            key,
            values,
            at: now,
            bytes,
        });
        self.bytes += bytes;
        while self.entries.len() > CACHE_ENTRIES || self.bytes > CACHE_BYTES {
            self.bytes -= self.entries.remove(0).bytes;
        }
    }
}

#[derive(Debug, thiserror::Error)]
enum Failure {
    #[error("can't start it: {0}")]
    Spawn(io::Error),
    #[error("timed out")]
    Timeout,
    #[error("its output passed 1 MiB")]
    TooLarge,
    #[error("{status}")]
    Exit { status: ExitStatus, stderr: Vec<u8> },
    #[error("reading its output: {0}")]
    Io(io::Error),
    /// Only where, never serde's message: it quotes the output, which can echo the
    /// words typed.
    #[error("its JSON doesn't parse: {kind} at line {line}, column {column}")]
    Json {
        kind: &'static str,
        line: usize,
        column: usize,
    },
}

impl From<serde_json::Error> for Failure {
    fn from(error: serde_json::Error) -> Self {
        use serde_json::error::Category;
        let kind = match error.classify() {
            Category::Io => "a read error",
            Category::Syntax => "bad syntax",
            Category::Data => "an unexpected shape",
            Category::Eof => "cut short",
        };
        Self::Json {
            kind,
            line: error.line(),
            column: error.column(),
        }
    }
}

impl Failure {
    fn stderr(&self) -> &[u8] {
        match self {
            Self::Exit { stderr, .. } => stderr,
            _ => &[],
        }
    }
}

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

    fn golden(name: &str) -> Values {
        let path = format!(
            "{}/tests/fixtures/carapace/{name}",
            env!("CARGO_MANIFEST_DIR")
        );
        Values::parse(&std::fs::read(path).expect("a fixture")).expect("parsed")
    }

    fn inserts(chips: &[Chip]) -> Vec<(&str, &str)> {
        chips
            .iter()
            .map(|c| (c.insert.as_str(), c.label.as_str()))
            .collect()
    }

    #[test]
    fn stems_cut_the_word_back_to_what_carapace_completes_from() {
        let cases = [
            ("", ""),
            ("ch", ""),
            ("-", "-"),
            ("--conf", "-"),
            ("--conflict=me", "--conflict="),
            ("origin/m", "origin/"),
            ("u+", "u+"),
            ("user@ho", "user@"),
            ("a,b", "a,"),
            ("host:pa", "host:"),
        ];
        for (cur, stem_of) in cases {
            assert_eq!(stem(cur), stem_of, "{cur:?}");
        }
    }

    /// Golden output from carapace-bin 1.8.0; rerun them against a new pin first.
    #[test]
    fn the_parser_reads_the_pinned_binarys_output() {
        let git = golden("git-checkout-dash.json");
        assert_eq!(git.pieces.len() / 3, 40);
        let force = git.chips("--f");
        assert_eq!(inserts(&force), [("orce ", "--force")]);
        assert_eq!(
            force[0].description.as_deref(),
            Some("force checkout (throw away local modifications)")
        );
        assert_eq!(git.chips("-").len(), CHIPS);

        let cargo = golden("cargo-build-dash.json");
        let names: Vec<_> = cargo.chips("--f").into_iter().map(|c| c.label).collect();
        assert_eq!(
            names,
            ["--features", "--frozen", "--future-incompat-report"]
        );

        // Descriptions are cut to 100 bytes.
        let docker = golden("docker-run-dash.json");
        let health = docker.chips("--health-start-p");
        assert_eq!(inserts(&health), [("eriod ", "--health-start-period")]);
        assert_eq!(health[0].description.as_deref().map(str::len), Some(100));
        assert_eq!(docker.chips("--memory").len(), 4);

        // `nospace: "*"`: a mode goes on, so no space; the display is the label.
        let chmod = golden("chmod-u-plus.json");
        let modes = chmod.chips("u+");
        assert_eq!(inserts(&modes)[..2], [("X", "X"), ("r", "r")]);
        assert!(chmod.chips("u+x").iter().all(|c| c.insert != "x"));
    }

    #[test]
    fn loose_json_is_read_and_bad_json_fails() {
        // Missing optional fields, unknown ones, a path carapace says needs no space,
        // and a value with a newline, which is dropped.
        let json = br#"{"nospace":"/","values":[
            {"value":"src/auth/","display":"auth/","style":"blue","tag":"files"},
            {"value":"src/my file.rs"},
            {"value":"src/two\nlines"}],"usage":""}"#;
        let values = Values::parse(json).expect("parsed");
        assert_eq!(
            inserts(&values.chips("src/")),
            [("auth/", "auth/"), ("my\\ file.rs ", "src/my file.rs")]
        );
        assert!(Values::parse(br#"{"values":[{"display":"no value"}]}"#).is_err());
        assert!(Values::parse(b"not json").is_err());
        assert_eq!(
            Values::parse(br#"{"values":null}"#)
                .expect("parsed")
                .chips("")
                .len(),
            0
        );
        let list = parse_list(br#"{"git":[{"name":"git"}],"cargo":[]}"#).expect("parsed");
        assert_eq!(list.find("git"), Some(1));
        assert_eq!(list.find("gi"), None);
    }

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
        assert_eq!(inserts(&values.chips("--f")), [("orce ", "--force")]);
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
