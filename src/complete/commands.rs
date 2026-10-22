//! Commands on `PATH` (complete.md "Commands on PATH"): every executable name in the
//! `PATH` directories, in one sorted buffer. Built on first use; each request that
//! needs it `stat`s the directories and rebuilds it whole when any mtime changed.

use std::ffi::{OsStr, OsString};
use std::os::unix::ffi::OsStrExt as _;
use std::os::unix::fs::MetadataExt as _;
use std::path::PathBuf;
use std::sync::Arc;

use rustix::fs::{AtFlags, Dir, FileType, Mode, OFlags};

use super::packed::Packed;

/// The index stops at this many names...
const MAX_NAMES: usize = 20_000;
/// ...or this many bytes of them.
const MAX_BYTES: usize = 256 * 1024;

/// One `PATH` directory's mtime when the index was built; `None`: it couldn't be read.
type Seen = (PathBuf, Option<(i64, i64)>);

#[derive(Debug, Default)]
pub struct Commands {
    dirs: Vec<Seen>,
    /// Sorted, distinct.
    names: Packed,
}

impl Commands {
    /// `current` while no `PATH` directory changed, else a new index. Blocks.
    pub fn load(path: &OsStr, current: Option<Arc<Self>>) -> Arc<Self> {
        let dirs = seen(path);
        match current {
            Some(current) if current.dirs == dirs => current,
            _ => Arc::new(Self::build(dirs)),
        }
    }

    /// Names starting with `prefix`, best first: by `score`, then shorter, then by name.
    pub fn matching(&self, prefix: &str, score: impl Fn(&str) -> f32) -> Vec<&str> {
        let names = &self.names;
        let mut found: Vec<(&str, f32)> = (names.lower_bound(prefix)..names.len())
            .map(|i| names.get(i))
            .take_while(|name| name.starts_with(prefix))
            .map(|name| (name, score(name)))
            .collect();
        found.sort_unstable_by(|a, b| {
            b.1.total_cmp(&a.1)
                .then(a.0.len().cmp(&b.0.len()))
                .then(a.0.cmp(b.0))
        });
        found.into_iter().map(|(name, _)| name).collect()
    }

    fn build(dirs: Vec<Seen>) -> Self {
        let mut found: Vec<Vec<u8>> = Vec::new();
        let mut bytes = 0;
        'dirs: for (dir, _) in &dirs {
            let Ok(fd) = rustix::fs::open(
                dir,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC,
                Mode::empty(),
            ) else {
                continue;
            };
            let Ok(mut entries) = Dir::read_from(&fd) else {
                continue;
            };
            while let Some(Ok(entry)) = entries.read() {
                let name = entry.file_name();
                let kind = entry.file_type();
                if !matches!(
                    kind,
                    FileType::RegularFile | FileType::Symlink | FileType::Unknown
                ) || !usable(name.to_bytes())
                {
                    continue;
                }
                // Following links: a link to an executable file counts.
                let Ok(stat) = rustix::fs::statat(&fd, name, AtFlags::empty()) else {
                    continue;
                };
                let executable = stat.st_mode & 0o111 != 0;
                if FileType::from_raw_mode(stat.st_mode) != FileType::RegularFile || !executable {
                    continue;
                }
                if found.len() == MAX_NAMES || bytes + name.to_bytes().len() > MAX_BYTES {
                    break 'dirs;
                }
                bytes += name.to_bytes().len();
                found.push(name.to_bytes().to_vec());
            }
        }
        found.sort_unstable();
        found.dedup();
        let mut names = Packed::with_capacity(bytes, found.len());
        for name in &found {
            // `usable` checked it is UTF-8.
            names.push(std::str::from_utf8(name).unwrap_or_default());
        }
        Self { dirs, names }
    }
}

/// UTF-8 with no control character: a chip can type it.
fn usable(name: &[u8]) -> bool {
    std::str::from_utf8(name).is_ok_and(|name| !name.chars().any(char::is_control))
}

/// The absolute, distinct directories of `path`, with their mtimes now. Blocks.
fn seen(path: &OsStr) -> Vec<Seen> {
    let mut dirs: Vec<Seen> = Vec::new();
    for dir in path.as_bytes().split(|&b| b == b':') {
        let dir = PathBuf::from(OsString::from(OsStr::from_bytes(dir)));
        if !dir.is_absolute() || dirs.iter().any(|(seen, _)| *seen == dir) {
            continue;
        }
        let mtime = std::fs::metadata(&dir)
            .ok()
            .map(|meta| (meta.mtime(), meta.mtime_nsec()));
        dirs.push((dir, mtime));
    }
    dirs
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::{PermissionsExt as _, symlink};

    use super::*;
    use crate::fs::test_tree::Tree;

    fn executable(tree: &Tree, relative: &str) {
        tree.write(relative, b"#!/bin/sh\n");
        let mode = std::fs::Permissions::from_mode(0o755);
        std::fs::set_permissions(tree.path(relative), mode).expect("chmod");
    }

    #[test]
    fn the_index_holds_executables_and_rebuilds_when_a_directory_changes() {
        let tree = Tree::new("commands");
        tree.mkdir("bin");
        tree.mkdir("more");
        executable(&tree, "bin/cargo");
        executable(&tree, "bin/cat");
        tree.write("bin/notes", b"not executable");
        tree.mkdir("bin/dir");
        executable(&tree, "more/cat");
        symlink(tree.path("bin/cargo"), tree.path("more/car")).expect("a link");
        let path = format!("{}:relative:{}", tree.str("bin"), tree.str("more"));
        let path = OsStr::new(&path);

        let index = Commands::load(path, None);
        assert_eq!(index.matching("", |_| 0.0), ["car", "cat", "cargo"]);
        // History ranks first, then length, then name.
        let ranked = index.matching("ca", |name| if name == "cargo" { 1.0 } else { 0.0 });
        assert_eq!(ranked, ["cargo", "car", "cat"]);
        assert!(index.matching("x", |_| 0.0).is_empty());

        // Unchanged directories: the same index.
        let same = Commands::load(path, Some(index.clone()));
        assert!(Arc::ptr_eq(&same, &index));
        // A new executable changes its directory's mtime: rebuilt.
        std::thread::sleep(std::time::Duration::from_millis(10));
        executable(&tree, "more/caddy");
        let rebuilt = Commands::load(path, Some(index.clone()));
        assert!(!Arc::ptr_eq(&rebuilt, &index));
        assert_eq!(rebuilt.matching("cad", |_| 0.0), ["caddy"]);
    }
}
