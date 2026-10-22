//! carapace (complete.md "carapace"): subcommands, flags and values for the commands
//! `carapace --list` covers. Stems, argv and the JSON are pure; results are cached 30 s
//! in a small LRU, which the runner (`runner.rs`) fills. Arguments and output are never
//! logged.

use std::collections::BTreeMap;
use std::ffi::{OsStr, OsString};
use std::io;
use std::os::unix::fs::MetadataExt as _;
use std::path::{Path, PathBuf};
use std::process::ExitStatus;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Deserialize;
use serde::de::IgnoredAny;
use tokio::time::Instant;
use tracing::{debug, info, warn};

use super::packed::Packed;
use super::{CHIPS, chip};
use crate::proto::complete::{Chip, ChipSource};

/// Every result is cached this long, failures and timeouts included.
const TTL: Duration = Duration::from_secs(30);
const CACHE_ENTRIES: usize = 64;
const CACHE_BYTES: usize = 1 << 20;
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
    pub(super) fn argv(&self, binary: &Path) -> (Vec<OsString>, Option<&str>) {
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
    pub(super) fn store(
        &mut self,
        key: Key,
        result: Result<Vec<u8>, Failure>,
        now: Instant,
    ) -> Outcome {
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

/// Why a run gave no result: the runner's, or the JSON's.
#[derive(Debug, thiserror::Error)]
pub(super) enum Failure {
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
