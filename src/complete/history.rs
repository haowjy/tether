//! Shell history (complete.md "History"): one file, its last 1 MiB parsed into its
//! 10,000 best distinct lines, ranked by recency and frequency with no timestamps.
//! The parsers and the index are pure; `load` stats the file and re-parses it when it
//! changed. History is never logged: not lines, not counts per line.

use std::collections::HashMap;
use std::fs::{File, Metadata};
use std::io;
use std::os::unix::fs::{FileExt as _, MetadataExt as _};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use rustix::fs::{Mode, OFlags};
use tracing::warn;

use super::packed::Packed;

/// Only the file's last this many bytes are read.
const READ: u64 = 1 << 20;
/// Distinct lines kept, best first.
const KEEP: usize = 10_000;
/// Distinct lines scored. Entries are read newest first, and once this many distinct
/// lines are scored, later entries only add to those: that bounds the dedup map
/// whatever the file holds, and changes nothing kept. A line left out is, at its
/// newest, at least 2,000 entries older than each of the first 10,000 lines scored at
/// theirs; a line's weights sum to at most 289 times its newest one (the geometric
/// series of a 200-entry half-life); and 289 × 2^(-2000/200) < 1, so each of those
/// 10,000 outscores it.
const SCORED: usize = KEEP + 2_000;
/// An occurrence this many entries old counts half.
const HALF_LIFE: f64 = 200.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Bash,
    Zsh,
    Fish,
}

impl Format {
    /// From the file's name: the daemon can't ask the shell.
    pub fn of(path: &Path) -> Self {
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        if name == "fish_history" {
            Self::Fish
        } else if name.contains("zsh") || name.contains(".histfile") {
            Self::Zsh
        } else {
            Self::Bash
        }
    }
}

/// Which file an index was parsed from, and its state then.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Stamp {
    path: PathBuf,
    dev: u64,
    ino: u64,
    size: u64,
    mtime: (i64, i64),
}

impl Stamp {
    fn of(path: PathBuf, meta: &Metadata) -> Self {
        Self {
            path,
            dev: meta.dev(),
            ino: meta.ino(),
            size: meta.size(),
            mtime: (meta.mtime(), meta.mtime_nsec()),
        }
    }
}

/// The best lines in one buffer, and each first word's summed score.
#[derive(Debug, Default)]
pub struct History {
    stamp: Option<Stamp>,
    /// Best first.
    lines: Packed,
    /// One per distinct first word of `lines`, sorted by it: a line that starts with
    /// the word, and the summed score of every line that does.
    words: Vec<(u32, f32)>,
}

impl History {
    /// `bytes` from `from`, the first whole line, in `format`. Decodes in place.
    pub fn parse(mut bytes: Vec<u8>, from: usize, format: Format) -> Self {
        let len = decode(&mut bytes, from, format);
        Self::build(&bytes[..len])
    }

    /// Lines that start with `before` and are longer, leading whitespace ignored on
    /// both, best first: `(line, the rest of it)`.
    pub fn matching<'a>(&'a self, before: &'a str) -> impl Iterator<Item = (&'a str, &'a str)> {
        let typed = before.trim_start();
        self.lines.iter().filter_map(move |line| {
            let rest = line.trim_start().strip_prefix(typed)?;
            (!rest.is_empty()).then_some((line, rest))
        })
    }

    /// The summed score of the kept lines whose first word is `word`: commands rank by
    /// it.
    pub fn score(&self, word: &str) -> f32 {
        let found = self
            .words
            .binary_search_by(|&(line, _)| self.word(line).cmp(word));
        found.map_or(0.0, |at| self.words[at].1)
    }

    /// The first word of line `line`.
    fn word(&self, line: u32) -> &str {
        let line = self.lines.get(line as usize);
        line.split_whitespace().next().unwrap_or_default()
    }

    /// `entries` holds one valid entry per `\n`-terminated line, oldest first.
    fn build(entries: &[u8]) -> Self {
        let count = entries.iter().filter(|&&b| b == b'\n').count();
        let mut scores: HashMap<&str, f64> = HashMap::with_capacity(count.min(SCORED));
        let mut lines = entries.split(|&b| b == b'\n').rev();
        // The empty piece after the last newline.
        lines.next();
        for (age, line) in lines.enumerate() {
            // `decode` kept only UTF-8.
            let line = std::str::from_utf8(line).unwrap_or_default();
            let weight = 0.5f64.powf(age as f64 / HALF_LIFE);
            if let Some(score) = scores.get_mut(line) {
                *score += weight;
            } else if scores.len() < SCORED {
                scores.insert(line, weight);
            }
        }
        let mut best: Vec<(&str, f64)> = scores.into_iter().collect();
        let rank = |a: &(&str, f64), b: &(&str, f64)| b.1.total_cmp(&a.1).then(a.0.cmp(b.0));
        if best.len() > KEEP {
            best.select_nth_unstable_by(KEEP - 1, rank);
            best.truncate(KEEP);
        }
        best.sort_unstable_by(rank);
        let bytes = best.iter().map(|(line, _)| line.len()).sum();
        let mut lines = Packed::with_capacity(bytes, best.len());
        for (line, _) in &best {
            lines.push(line);
        }
        let mut index = Self {
            stamp: None,
            lines,
            words: Vec::new(),
        };
        // `KEEP` fits a `u32`.
        let mut words: Vec<(u32, f32)> = (0..best.len() as u32)
            .zip(best.iter().map(|&(_, score)| score as f32))
            .collect();
        words.sort_unstable_by(|a, b| index.word(a.0).cmp(index.word(b.0)));
        words.dedup_by(|later, kept| {
            let same = index.word(later.0) == index.word(kept.0);
            if same {
                kept.1 += later.1;
            }
            same
        });
        index.words = words;
        index
    }
}

/// Rewrites `bytes[from..]` in place as the valid entries, oldest first, each ended by
/// `\n`, starting at index 0; returns their length. An entry that isn't UTF-8, holds a
/// control character (so every multi-line one) or is blank is dropped.
fn decode(bytes: &mut Vec<u8>, from: usize, format: Format) -> usize {
    if bytes.last().is_some_and(|&b| b != b'\n') {
        bytes.push(b'\n');
    }
    let mut read = from.min(bytes.len());
    let mut write = 0;
    // zsh: the entry being read continues on the next line.
    let mut continued = false;
    while read < bytes.len() {
        let end = bytes[read..]
            .iter()
            .position(|&b| b == b'\n')
            .map_or(bytes.len(), |at| read + at);
        let line = read..end;
        read = end + 1;
        let start = write;
        let kept = match format {
            Format::Bash => {
                let text = &bytes[line.clone()];
                let timestamp =
                    text.len() > 1 && text[0] == b'#' && text[1..].iter().all(u8::is_ascii_digit);
                if !timestamp {
                    write += line.len();
                    bytes.copy_within(line, start);
                }
                !timestamp
            }
            Format::Zsh => {
                let was_continued = continued;
                continued = bytes[line.clone()].ends_with(b"\\");
                if was_continued || continued {
                    false
                } else {
                    let command = extended(&bytes[line.clone()], line.start);
                    write = unmetafy(bytes, command, end, write);
                    true
                }
            }
            Format::Fish => match bytes[line.clone()].strip_prefix(b"- cmd: ") {
                Some(_) => {
                    write = unescape_fish(bytes, line.start + 7, end, write);
                    true
                }
                None => false,
            },
        };
        if kept && valid(&bytes[start..write]) {
            bytes[write] = b'\n';
            write += 1;
        } else {
            write = start;
        }
    }
    write
}

/// Where the command starts in a zsh line: after `: <start>:<elapsed>;` if it has one.
fn extended(line: &[u8], at: usize) -> usize {
    let Some(rest) = line.strip_prefix(b": ") else {
        return at;
    };
    let digits = |s: &[u8]| s.iter().take_while(|b| b.is_ascii_digit()).count();
    let start = digits(rest);
    let Some(rest) = rest[start..].strip_prefix(b":") else {
        return at;
    };
    let elapsed = digits(rest);
    match rest[elapsed..].first() {
        Some(b';') if start > 0 && elapsed > 0 => at + 2 + start + 1 + elapsed + 1,
        _ => at,
    }
}

/// zsh's metafied bytes: `0x83` then `b ^ 0x20`. Copies `bytes[from..end]` to `write`.
fn unmetafy(bytes: &mut [u8], from: usize, end: usize, mut write: usize) -> usize {
    let mut read = from;
    while read < end {
        let mut b = bytes[read];
        if b == 0x83 && read + 1 < end {
            read += 1;
            b = bytes[read] ^ 0x20;
        }
        bytes[write] = b;
        write += 1;
        read += 1;
    }
    write
}

/// fish's `\\` and `\n`. Copies `bytes[from..end]` to `write`.
fn unescape_fish(bytes: &mut [u8], from: usize, end: usize, mut write: usize) -> usize {
    let mut read = from;
    while read < end {
        let mut b = bytes[read];
        if b == b'\\' && read + 1 < end {
            match bytes[read + 1] {
                b'\\' => read += 1,
                b'n' => {
                    read += 1;
                    b = b'\n';
                }
                _ => {}
            }
        }
        bytes[write] = b;
        write += 1;
        read += 1;
    }
    write
}

/// UTF-8, not blank, and no control character (C0, DEL, C1).
fn valid(entry: &[u8]) -> bool {
    std::str::from_utf8(entry)
        .is_ok_and(|text| !text.trim().is_empty() && !text.chars().any(char::is_control))
}

/// Where history comes from: a configured file, else the newest of the defaults.
#[derive(Debug, Clone)]
pub struct Source {
    pub configured: Option<PathBuf>,
    /// `~/.zsh_history`, `~/.bash_history`, `$XDG_DATA_HOME/fish/fish_history`.
    pub defaults: [PathBuf; 3],
}

impl Source {
    /// The file to read now, and its `stat`. Blocks.
    fn choose(&self) -> Option<(PathBuf, Metadata)> {
        let stat = |path: &PathBuf| {
            let meta = std::fs::metadata(path).ok().filter(Metadata::is_file)?;
            Some((path.clone(), meta))
        };
        match &self.configured {
            Some(path) => stat(path),
            None => self
                .defaults
                .iter()
                .filter_map(stat)
                .max_by_key(|(_, meta)| (meta.mtime(), meta.mtime_nsec())),
        }
    }
}

/// `current` while its file is unchanged, else the file parsed again: `None` when
/// there is no history file. A file that can't be read gives an empty index, so it is
/// tried again (and warned of again) only once it changes. Blocks.
pub fn load(source: &Source, current: Option<Arc<History>>) -> Option<Arc<History>> {
    let (path, meta) = source.choose()?;
    let stamp = Stamp::of(path, &meta);
    if let Some(current) = current.filter(|index| index.stamp.as_ref() == Some(&stamp)) {
        return Some(current);
    }
    let format = Format::of(&stamp.path);
    let mut index = match read(&stamp.path) {
        Ok((bytes, from)) => History::parse(bytes, from, format),
        Err((offset, cause)) => {
            warn!(path = %stamp.path.display(), offset, %cause, "can't read the history file");
            History::default()
        }
    };
    index.stamp = Some(stamp);
    Some(Arc::new(index))
}

/// The file's last `READ` bytes, and where its first whole line starts in them.
fn read(path: &Path) -> Result<(Vec<u8>, usize), (u64, io::Error)> {
    let flags = OFlags::RDONLY | OFlags::NONBLOCK | OFlags::CLOEXEC | OFlags::NOCTTY;
    let fd = rustix::fs::open(path, flags, Mode::empty()).map_err(|errno| (0, errno.into()))?;
    let file = File::from(fd);
    let size = file.metadata().map_err(|cause| (0, cause))?.len();
    // One byte more, to see whether the window starts a line.
    let start = size.saturating_sub(READ + 1);
    let len = usize::try_from(size - start).unwrap_or(0);
    let mut bytes = Vec::with_capacity(len + 1);
    bytes.resize(len, 0);
    let mut filled = 0;
    while filled < len {
        match file.read_at(&mut bytes[filled..], start + filled as u64) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(cause) if cause.kind() == io::ErrorKind::Interrupted => {}
            Err(cause) => return Err((start + filled as u64, cause)),
        }
    }
    bytes.truncate(filled);
    let from = if start == 0 {
        0
    } else {
        bytes
            .iter()
            .position(|&b| b == b'\n')
            .map_or(bytes.len(), |at| at + 1)
    };
    Ok((bytes, from))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fs::test_tree::Tree;

    fn parsed(bytes: &[u8], format: Format) -> History {
        History::parse(bytes.to_vec(), 0, format)
    }

    fn lines(history: &History) -> Vec<&str> {
        history.lines.iter().collect()
    }

    #[test]
    fn each_format_parses_to_its_commands() {
        let bash = parsed(
            b"#1700000000\nls\n#1700000001\ngit status\n#nope\n",
            Format::Bash,
        );
        assert_eq!(lines(&bash), ["#nope", "git status", "ls"]);

        // Extended lines, metafied bytes (U+65E5 is e6 97 a5, and 0x97 is metafied),
        // and a multi-line entry, dropped whole with its continuation lines.
        let zsh = b": 1700000000:0;git log\n\
                    echo \xe6\x83\xb7\xa5\n\
                    : 1700000001:3;for x in a b; do\\\necho $x\\\ndone\n\
                    : 1700000002:0;ls -la\n";
        assert_eq!(
            lines(&parsed(zsh, Format::Zsh)),
            ["ls -la", "echo \u{65e5}", "git log"]
        );

        let fish = b"- cmd: git status\n  when: 1700000000\n\
                     - cmd: echo a\\\\b\n  when: 1700000001\n  paths:\n    - /tmp\n\
                     - cmd: printf x\\ny\n  when: 1700000002\n";
        assert_eq!(
            lines(&parsed(fish, Format::Fish)),
            ["echo a\\b", "git status"]
        );

        assert_eq!(Format::of(Path::new("/h/.zsh_history")), Format::Zsh);
        assert_eq!(Format::of(Path::new("/h/.histfile")), Format::Zsh);
        assert_eq!(Format::of(Path::new("/h/fish/fish_history")), Format::Fish);
        assert_eq!(Format::of(Path::new("/h/.bash_history")), Format::Bash);
        assert_eq!(Format::of(Path::new("/h/.history")), Format::Bash);
    }

    #[test]
    fn entries_with_control_characters_or_bad_utf8_are_dropped() {
        let bash = b"echo \x1b[31mred\nprintf 'a\tb'\nbad \xff byte\nC1 \xc2\x9b\n  \nok\n";
        assert_eq!(lines(&parsed(bash, Format::Bash)), ["ok"]);
    }

    #[test]
    fn recent_and_frequent_lines_rank_first() {
        let mut bash = String::new();
        // `old` three times, a thousand entries ago: 3 × 0.5^5 ≈ 0.09.
        bash.push_str("old\nold\nold\n");
        for i in 0..1000 {
            bash.push_str(&format!("filler {i}\n"));
        }
        // `often` three times recently beats `once`, though `once` is the newest.
        bash.push_str("often x\noften x\noften x\nonce\n");
        let history = parsed(bash.as_bytes(), Format::Bash);
        let ranked = lines(&history);
        assert_eq!(&ranked[..2], ["often x", "once"]);
        assert!(
            ranked.iter().position(|l| *l == "old")
                > ranked.iter().position(|l| *l == "filler 990")
        );
        // Matching: leading whitespace ignored, the rest is the insert, longer only.
        let matched: Vec<_> = history.matching("  of").collect();
        assert_eq!(matched, [("often x", "ten x")]);
        assert_eq!(history.matching("once").count(), 0);
        // First words carry their lines' scores, for ranking commands.
        assert!(history.score("often") > history.score("once"));
        assert!(history.score("filler") > history.score("often"));
        assert_eq!(history.score("nothing"), 0.0);
    }

    #[test]
    fn only_the_tail_is_read_and_a_change_is_reparsed() {
        let tree = Tree::new("history");
        let file = tree.path(".bash_history");
        // The read window starts inside this line, which is skipped.
        let mut bytes = vec![b'a'; READ as usize + 100];
        bytes.extend_from_slice(b"\nls\n");
        std::fs::write(&file, &bytes).expect("written");
        let source = Source {
            configured: None,
            defaults: [
                tree.path(".zsh_history"),
                file.clone(),
                tree.path("fish_history"),
            ],
        };
        let index = load(&source, None).expect("an index");
        assert_eq!(lines(&index), ["ls"]);
        // Unchanged: the same index, without a parse.
        let same = load(&source, Some(index.clone())).expect("an index");
        assert!(Arc::ptr_eq(&index, &same));
        // A command appended: parsed again.
        bytes.extend_from_slice(b"git push\n");
        std::fs::write(&file, &bytes).expect("written");
        let changed = load(&source, Some(index.clone())).expect("an index");
        assert_eq!(lines(&changed), ["git push", "ls"]);
        // The most recently modified default wins.
        std::thread::sleep(std::time::Duration::from_millis(10));
        std::fs::write(tree.path(".zsh_history"), b": 1:0;make\n").expect("written");
        let zsh = load(&source, Some(changed)).expect("an index");
        assert_eq!(lines(&zsh), ["make"]);
    }
}
