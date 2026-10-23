//! Completion (complete.md): the suggestion strip's chips for what is typed at the
//! shell prompt, from history, commands on `PATH`, carapace and directory listings.
//! Knows nothing of axum; `http/complete.rs` parses the body, takes an in-flight
//! permit and calls `Completer::complete`. Never touches tmux or the hub. Every index
//! and cache is built on first use, revalidated with a `stat` per request, and freed
//! together five idle minutes after the last request. Never logs typed text, history
//! or chips.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, Weak};
use std::time::Duration;

use tokio::time::Instant;
use tracing::{debug, warn};

use crate::blocking::{Lane, Lanes};
use crate::config;
use crate::proto::complete::{Chip, ChipSource, CompleteRequest, Completion};

mod carapace;
mod commands;
mod context;
mod history;
mod packed;
mod paths;
mod runner;

use carapace::{Binary, Key, Outcome, Shared};
use commands::Commands;
use context::Word;
use history::History;
use paths::{Listing, Target};
use runner::{Launch, Runner};

/// Chips per response...
const CHIPS: usize = 20;
/// ...of which history's.
const HISTORY_CHIPS: usize = 3;
/// A description is cut to this many bytes.
const DESCRIPTION: usize = 100;
/// Everything is freed this long after the last request.
const IDLE: Duration = Duration::from_secs(5 * 60);

/// What completion reads of the daemon's environment: the daemon's own, or a test's.
#[derive(Debug, Clone, Default)]
pub struct Environment {
    pub home: PathBuf,
    /// `PATH`.
    pub path: Option<OsString>,
    /// `XDG_DATA_HOME`, where fish keeps its history; a relative one is ignored.
    pub data_home: Option<PathBuf>,
    /// `INVOCATION_ID` is set: the daemon runs under systemd.
    pub systemd: bool,
}

impl Environment {
    /// The daemon's, with `home` as `$HOME`.
    pub fn current(home: &Path) -> Self {
        Self {
            home: home.to_owned(),
            path: std::env::var_os("PATH"),
            data_home: std::env::var_os("XDG_DATA_HOME").map(PathBuf::from),
            systemd: std::env::var_os("INVOCATION_ID").is_some(),
        }
    }
}

/// `[complete]` and the environment, resolved once.
#[derive(Debug, Clone)]
pub struct Settings {
    /// `$HOME`, for `~/` in what is typed.
    home: PathBuf,
    /// `[complete] history`; else the newest of zsh's, bash's and fish's.
    history: history::Source,
    /// The commands index's `PATH`, and carapace's.
    path: OsString,
    /// `[complete] carapace`; else `carapace` on `path`.
    carapace: Option<PathBuf>,
    /// Under systemd: carapace runs in its own scope.
    scoped: bool,
}

impl Settings {
    pub fn new(config: &config::Complete, env: Environment) -> Self {
        let home = env.home;
        let file = |key: &str, entry: &Option<String>| {
            let entry = entry.as_deref()?;
            let path = crate::fs::expand(entry, &home);
            if path.is_none() {
                warn!(key, %entry, "a [complete] path in config.toml isn't absolute or ~/: ignored");
            }
            path
        };
        let history = file("history", &config.history);
        if let Some(path) = history.as_ref().filter(|path| !path.is_file()) {
            warn!(path = %path.display(), "the [complete] history file isn't there: no history chips until it is");
        }
        let data_home = env
            .data_home
            .filter(|dir| dir.is_absolute())
            .unwrap_or_else(|| home.join(".local/share"));
        let history = history::Source {
            configured: history,
            defaults: [
                home.join(".zsh_history"),
                home.join(".bash_history"),
                data_home.join("fish/fish_history"),
            ],
        };
        Self {
            history,
            path: config
                .path
                .clone()
                .map(OsString::from)
                .or(env.path)
                .unwrap_or_default(),
            carapace: file("carapace", &config.carapace),
            scoped: env.systemd,
            home,
        }
    }
}

/// Daemon-wide; cheap to clone.
#[derive(Debug, Clone)]
pub struct Completer {
    inner: Arc<Inner>,
}

#[derive(Debug)]
struct Inner {
    settings: Settings,
    /// History, the `PATH` index and finding carapace.
    index: Lane,
    /// `check_dir` and listings: a lane of their own, so a hung mount stops only these.
    dir: Lane,
    /// The indexes, each an `Arc` snapshot swapped whole.
    state: Mutex<State>,
    carapace: Arc<Mutex<Shared>>,
    runner: Runner,
    idle: Mutex<Idle>,
}

#[derive(Debug, Default)]
struct State {
    history: Option<Arc<History>>,
    commands: Option<Arc<Commands>>,
    /// The last directory listed.
    listing: Option<Arc<Listing>>,
}

#[derive(Debug)]
struct Idle {
    last: Instant,
    /// The drop timer is running.
    armed: bool,
}

impl Completer {
    /// Spawns the carapace runner: call it inside the runtime.
    pub fn new(settings: Settings, lanes: &Lanes) -> Self {
        let carapace = Arc::new(Mutex::new(Shared::default()));
        let launch = Launch {
            path: settings.path.clone(),
            scoped: settings.scoped,
        };
        let runner = Runner::spawn(carapace.clone(), launch);
        Self {
            inner: Arc::new(Inner {
                settings,
                index: lanes.index.clone(),
                dir: lanes.dir.clone(),
                state: Mutex::new(State::default()),
                carapace,
                runner,
                idle: Mutex::new(Idle {
                    last: Instant::now(),
                    armed: false,
                }),
            }),
        }
    }

    /// The chips for one request. A source that fails, times out or is missing adds
    /// none; nothing here is an error. `cwd`, if any, is absolute (the route checks).
    pub async fn complete(&self, request: CompleteRequest) -> Completion {
        self.touch();
        let started = Instant::now();
        let query = context::context(&request.before, &request.after);
        let cwd = request.cwd.as_deref();
        let wants_commands = matches!(query.word, Some(Word::Command(_)));
        // Commands rank by history, so either needs it.
        let (history, commands) = if query.history || wants_commands {
            self.indexes(wants_commands).await
        } else {
            (None, None)
        };
        let mut chips = Vec::new();
        if query.history {
            if let Some(history) = &history {
                let lines = history
                    .matching(&request.before)
                    .filter_map(|(line, rest)| {
                        chip(ChipSource::History, rest, "", line.to_owned(), None)
                    });
                chips.extend(lines.take(HISTORY_CHIPS));
            }
        }
        let from_history = chips.len();
        match &query.word {
            None => {}
            Some(Word::Command(prefix)) => {
                if let Some(commands) = &commands {
                    let score = |name: &str| history.as_ref().map_or(0.0, |h| h.score(name));
                    let names = commands.matching(prefix, score).into_iter();
                    let found = names.filter_map(|name| {
                        let rest = &name[prefix.len()..];
                        chip(ChipSource::Command, rest, " ", name.to_owned(), None)
                    });
                    chips.extend(found.take(CHIPS));
                }
            }
            Some(Word::Path(value)) => chips.extend(self.paths(value, cwd).await),
            Some(Word::Arg { cmd, args, cur }) => {
                let values = self.carapace(cwd, cmd, args, cur).await;
                if values.is_empty() {
                    chips.extend(self.paths(cur, cwd).await);
                } else {
                    chips.extend(values);
                }
            }
        }
        let chips = merge(chips);
        debug!(
            history = from_history,
            word = query.word.as_ref().map(Word::kind),
            chips = chips.len(),
            ms = started.elapsed().as_millis() as u64,
            "completed"
        );
        Completion { chips }
    }

    /// History, and the `PATH` index if `commands`, current, on the index lane.
    async fn indexes(&self, commands: bool) -> (Option<Arc<History>>, Option<Arc<Commands>>) {
        let inner = self.inner.clone();
        let loaded = self.inner.index.run(move || {
            let (history, index) = {
                let state = lock(&inner.state);
                (state.history.clone(), state.commands.clone())
            };
            let history = history::load(&inner.settings.history, history);
            let index = commands.then(|| Commands::load(&inner.settings.path, index));
            let mut state = lock(&inner.state);
            state.history = history.clone();
            if index.is_some() {
                state.commands = index.clone();
            }
            (history, index)
        });
        loaded.await.unwrap_or_default()
    }

    /// Path chips for the word `value`.
    async fn paths(&self, value: &str, cwd: Option<&str>) -> Vec<Chip> {
        let (dir, prefix) = match paths::split(value, cwd, &self.inner.settings.home) {
            None => return Vec::new(),
            Some(Target::Tilde) => return paths::tilde(),
            Some(Target::Dir { dir, prefix }) => (dir, prefix),
        };
        let inner = self.inner.clone();
        let listing = self.inner.dir.run(move || {
            let cached = lock(&inner.state).listing.clone();
            let listing = Listing::load(&dir, cached).ok()?;
            lock(&inner.state).listing = Some(listing.clone());
            Some(listing)
        });
        match listing.await.ok().flatten() {
            Some(listing) => listing.chips(&prefix),
            None => Vec::new(),
        }
    }

    /// carapace's chips for the word `cur` of `cmd`; none when carapace is missing,
    /// doesn't cover `cmd`, or fails.
    async fn carapace(
        &self,
        cwd: Option<&str>,
        cmd: &str,
        args: &[String],
        cur: &str,
    ) -> Vec<Chip> {
        let Some(binary) = self.carapace_binary().await else {
            return Vec::new();
        };
        // The runner answers from its cache when it can, so the list costs a run only
        // on first use and 30 s after a failure.
        let list = self.inner.runner.ask(Key::List, binary.clone()).await;
        let covered = match list {
            Outcome::List(Some(list)) => list.find(cmd).is_some(),
            _ => false,
        };
        if !covered {
            return Vec::new();
        }
        let Some(cwd) = cwd else {
            return Vec::new();
        };
        let mut words = Vec::with_capacity(args.len() + 2);
        words.push(cmd.to_owned());
        words.extend(args.iter().cloned());
        words.push(carapace::stem(cur).to_owned());
        let key = Key::Values {
            cwd: cwd.to_owned(),
            words,
        };
        let cached = lock(&self.inner.carapace).cached(&key, Instant::now());
        let outcome = match cached {
            Some(outcome) => outcome,
            None => {
                // Only before a run: a cache hit needs no directory.
                let dir = cwd.to_owned();
                let checked = self.inner.dir.run(move || crate::fs::check_dir(&dir));
                if !matches!(checked.await, Ok(Ok(()))) {
                    return Vec::new();
                }
                self.inner.runner.ask(key, binary).await
            }
        };
        match outcome {
            Outcome::Values(values) => values.chips(cur),
            _ => Vec::new(),
        }
    }

    /// The carapace binary, resolved on first use on the index lane.
    async fn carapace_binary(&self) -> Option<PathBuf> {
        let known = lock(&self.inner.carapace).binary.clone();
        match known {
            Binary::Found(binary) => return Some(binary),
            Binary::Missing => return None,
            Binary::Unknown => {}
        }
        let settings = &self.inner.settings;
        let (configured, path) = (settings.carapace.clone(), settings.path.clone());
        let found = self
            .inner
            .index
            .run(move || carapace::resolve(configured.as_deref(), &path));
        // No thread in time: try again on the next request.
        let found = found.await.ok()?;
        lock(&self.inner.carapace).binary = match &found {
            Some(binary) => Binary::Found(binary.clone()),
            None => Binary::Missing,
        };
        found
    }

    /// Re-arms the idle drop: one timer, which wakes once per idle period.
    fn touch(&self) {
        let mut idle = lock(&self.inner.idle);
        idle.last = Instant::now();
        if !idle.armed {
            idle.armed = true;
            tokio::spawn(drop_when_idle(Arc::downgrade(&self.inner)));
        }
    }
}

/// Frees every index and cache `IDLE` after the last request, then ends.
async fn drop_when_idle(inner: Weak<Inner>) {
    loop {
        let Some(due) = inner.upgrade().map(|inner| lock(&inner.idle).last + IDLE) else {
            return;
        };
        tokio::time::sleep_until(due).await;
        let Some(inner) = inner.upgrade() else {
            return;
        };
        let mut idle = lock(&inner.idle);
        if idle.last + IDLE <= Instant::now() {
            idle.armed = false;
            drop(idle);
            *lock(&inner.state) = State::default();
            *lock(&inner.carapace) = Shared::default();
            debug!("completion idle: indexes and caches freed");
            return;
        }
    }
}

/// A chip that types `rest`, then `end`. History's `rest` is typed as it is: a line
/// Jimmy wrote, in shell syntax he chose. Every other source's is a name or value, which
/// `context::literal` escapes so the shell reads back exactly it. `None` when that is
/// empty or `rest` holds a control character: a chip can never press Enter or send an
/// escape sequence.
fn chip(
    source: ChipSource,
    rest: &str,
    end: &str,
    label: String,
    description: Option<&str>,
) -> Option<Chip> {
    if rest.chars().any(char::is_control) {
        return None;
    }
    let mut insert = match source {
        ChipSource::History => rest.to_owned(),
        _ => context::literal(rest),
    };
    insert.push_str(end);
    if insert.is_empty() {
        return None;
    }
    let description = description.filter(|text| !text.is_empty()).map(|text| {
        let mut end = text.len().min(DESCRIPTION);
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text[..end].to_owned()
    });
    Some(Chip {
        insert,
        label,
        source,
        description,
    })
}

/// In order, without a second chip for the same insert (a trailing space ignored), cut
/// at the cap.
fn merge(chips: Vec<Chip>) -> Vec<Chip> {
    let mut kept: Vec<Chip> = Vec::with_capacity(CHIPS.min(chips.len()));
    for chip in chips {
        let same =
            |a: &str, b: &str| a.strip_suffix(' ').unwrap_or(a) == b.strip_suffix(' ').unwrap_or(b);
        if kept.iter().any(|kept| same(&kept.insert, &chip.insert)) {
            continue;
        }
        kept.push(chip);
        if kept.len() == CHIPS {
            break;
        }
    }
    kept
}

/// A panic elsewhere mustn't stop completion for good.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt as _;

    use super::*;
    use crate::fs::test_tree::Tree;

    fn executable(path: &Path, text: &str) {
        std::fs::write(path, text).expect("written");
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    }

    /// `$HOME` with a bash history, a `PATH` of three commands, a repo, and a fake
    /// carapace that covers `git`.
    fn tree() -> Tree {
        let tree = Tree::new("completer");
        for dir in ["home", "bin", "repo/src"] {
            tree.mkdir(dir);
        }
        let history = "grep -r foo\nls -la\ngit stash pop\necho \x1b]0;title\x07\ngit status\n";
        tree.write("home/.bash_history", history.as_bytes());
        for name in ["git", "gitk", "grep"] {
            executable(&tree.path(&format!("bin/{name}")), "#!/bin/sh\n");
        }
        tree.write("repo/README.md", b"");
        tree.write("repo/src/main.rs", b"");
        let carapace = r#"#!/bin/sh
[ "$1" = --list ] && { echo '{"git":[]}'; exit 0; }
for last; do :; done
case "$last" in
  -) echo '{"values":[{"value":"--force","display":"--force"},{"value":"--detach","display":"--detach"}]}' ;;
  *) echo '{"values":[{"value":"status"},{"value":"stash"},{"value":"switch"}]}' ;;
esac
"#;
        executable(&tree.path("carapace"), carapace);
        tree
    }

    fn completer(tree: &Tree, carapace: &str) -> Completer {
        let config = config::Complete {
            history: None,
            path: Some(tree.str("bin")),
            carapace: Some(tree.str(carapace)),
        };
        let env = Environment {
            home: tree.path("home"),
            ..Environment::default()
        };
        Completer::new(Settings::new(&config, env), &Lanes::default())
    }

    async fn ask(completer: &Completer, tree: &Tree, before: &str) -> Vec<Chip> {
        let request = CompleteRequest {
            before: before.to_owned(),
            after: String::new(),
            cwd: Some(tree.str("repo")),
        };
        completer.complete(request).await.chips
    }

    /// `(source, insert)` pairs, after checking that each chip only extends what is
    /// typed: the label is the typed text, or its current word, plus the insert.
    fn extending(before: &str, chips: &[Chip]) -> Vec<(ChipSource, String)> {
        let word = before.rsplit(' ').next().unwrap_or_default();
        for chip in chips {
            let insert = chip.insert.replace('\\', "");
            let extended = match chip.source {
                ChipSource::History => format!("{}{}", before.trim_start(), chip.insert),
                ChipSource::Command | ChipSource::Carapace => format!("{word}{insert}"),
                ChipSource::Path => {
                    let name = word.rsplit('/').next().unwrap_or_default();
                    format!("{name}{insert}")
                }
            };
            assert_eq!(extended.trim_end(), chip.label, "{chip:?}");
            assert!(!chip.insert.chars().any(char::is_control), "{chip:?}");
        }
        chips.iter().map(|c| (c.source, c.insert.clone())).collect()
    }

    #[tokio::test]
    async fn every_chip_only_extends_what_is_typed() {
        use ChipSource::*;
        let tree = tree();
        let completer = completer(&tree, "carapace");
        let pair = |source, insert: &str| (source, insert.to_owned());

        let chips = ask(&completer, &tree, "gi").await;
        assert_eq!(
            extending("gi", &chips),
            [
                pair(History, "t status"),
                pair(History, "t stash pop"),
                pair(Command, "t "),
                pair(Command, "tk "),
            ]
        );
        // The history line and carapace's `status ` are the same chip: history's kept.
        let chips = ask(&completer, &tree, "git st").await;
        assert_eq!(
            extending("git st", &chips),
            [
                pair(History, "atus"),
                pair(History, "ash pop"),
                pair(Carapace, "ash ")
            ]
        );
        let chips = ask(&completer, &tree, "git --f").await;
        assert_eq!(extending("git --f", &chips), [pair(Carapace, "orce ")]);
        // `cat` isn't carapace's: paths.
        let chips = ask(&completer, &tree, "cat sr").await;
        assert_eq!(extending("cat sr", &chips), [pair(Path, "c/")]);
        let chips = ask(&completer, &tree, "cat src/").await;
        assert_eq!(extending("cat src/", &chips), [pair(Path, "main.rs ")]);
        let chips = ask(&completer, &tree, "ls > RE").await;
        assert_eq!(extending("ls > RE", &chips), [pair(Path, "ADME.md ")]);
        // The history entry with an escape sequence is never offered.
        assert!(ask(&completer, &tree, "ec").await.is_empty());
    }

    /// Names a shell reads as syntax or expands, unless each character is escaped.
    const HOSTILE: [&str; 24] = [
        "a b",
        "x;printf INJECTED",
        "$(printf INJECTED)",
        "`printf INJECTED`",
        "${HOME}",
        "*",
        "?x",
        "[ab]",
        "{a,b}",
        "!x",
        "'q'",
        "\"q\"",
        "#x",
        "a&b",
        "a|b",
        "<x",
        "\\x",
        "~",
        "~root",
        "=ls",
        "a=~root",
        "x=a:~root",
        "-n",
        "caf\u{e9} \u{fc}",
    ];

    /// What bash prints for `line`, where `cat` and `git` print each argument and a NUL.
    fn bash(line: &str, cwd: &Path, path: &Path) -> String {
        let path = path.to_str().expect("UTF-8");
        let print = "{ printf '%s\\0' \"$@\"; }";
        let script = format!("PATH='{path}'\ncat() {print}\ngit() {print}\n{line}");
        let ran = std::process::Command::new("bash")
            .args(["-c", &script])
            .current_dir(cwd)
            .env("HOME", cwd)
            .output()
            .expect("bash ran");
        assert!(ran.stderr.is_empty(), "{line:?}: {ran:?}");
        String::from_utf8(ran.stdout).expect("UTF-8")
    }

    /// The chip labelled `label` that `before` gets.
    async fn labelled(completer: &Completer, before: &str, cwd: &Path, label: &str) -> Chip {
        let request = CompleteRequest {
            before: before.to_owned(),
            after: String::new(),
            cwd: Some(cwd.to_str().expect("UTF-8").to_owned()),
        };
        let chips = completer.complete(request).await.chips;
        let chip = chips.iter().find(|chip| chip.label == label);
        chip.unwrap_or_else(|| panic!("{before:?} gets no {label:?}: {chips:?}"))
            .clone()
    }

    #[tokio::test]
    async fn bash_reads_every_completed_name_back_as_itself() {
        let tree = Tree::new("completer-hostile");
        for (i, &name) in HOSTILE.iter().enumerate() {
            // Each name alone in its directory, on its `PATH` and in carapace's answer.
            let (cwd, bin) = (
                tree.path(&format!("{i}/cwd")),
                tree.path(&format!("{i}/bin")),
            );
            tree.mkdir(&format!("{i}/cwd"));
            tree.mkdir(&format!("{i}/bin"));
            std::fs::write(cwd.join(name), b"").expect("written");
            let values = serde_json::json!({ "values": [{ "value": name }] });
            let own_name = "#!/bin/sh\nprintf '%s\\0' \"${0##*/}\"\n";
            executable(&bin.join(name), own_name);
            let config = config::Complete {
                history: None,
                path: Some(bin.to_str().expect("UTF-8").to_owned()),
                carapace: None,
            };
            let env = Environment {
                home: cwd.clone(),
                ..Environment::default()
            };
            let completer = Completer::new(Settings::new(&config, env), &Lanes::default());
            let read = format!("{name}\0");

            let chip = labelled(&completer, "", &cwd, name).await;
            assert_eq!(chip.source, ChipSource::Command);
            assert_eq!(bash(&chip.insert, &cwd, &bin), read, "{chip:?}");

            // A path from the word's start, and after its first character, as a chip
            // would have typed it: the lexer reads the escape back.
            let first = name.chars().next().expect("a name");
            for typed in [String::new(), context::literal(&first.to_string())] {
                let before = format!("cat {typed}");
                let chip = labelled(&completer, &before, &cwd, name).await;
                assert_eq!(chip.source, ChipSource::Path);
                let line = format!("{before}{}", chip.insert);
                assert_eq!(bash(&line, &cwd, &bin), read, "{chip:?}");
            }

            // Carapace is deliberately best-effort with a 300 ms subprocess deadline.
            // Exercise its chip encoder directly so host load cannot turn this into the
            // valid path fallback and make the escaping test flaky.
            let json = values.to_string();
            let chips = carapace::Values::parse(json.as_bytes())
                .expect("carapace values parsed")
                .chips("");
            let chip = chips
                .iter()
                .find(|chip| chip.label == name)
                .expect("carapace chip")
                .clone();
            assert_eq!(chip.source, ChipSource::Carapace);
            let line = format!("git {}", chip.insert);
            assert_eq!(bash(&line, &cwd, &bin), read, "{chip:?}");
        }
    }

    #[tokio::test]
    async fn without_carapace_later_words_complete_as_paths() {
        use ChipSource::*;
        let tree = tree();
        let completer = completer(&tree, "no-such-carapace");
        let chips = ask(&completer, &tree, "git s").await;
        assert_eq!(
            extending("git s", &chips),
            [
                (History, "tatus".to_owned()),
                (History, "tash pop".to_owned()),
                (Path, "rc/".to_owned()),
            ]
        );
        let binary = lock(&completer.inner.carapace).binary.clone();
        assert!(matches!(binary, Binary::Missing), "{binary:?}");
        assert!(ask(&completer, &tree, "git --f").await.is_empty());
    }
}
