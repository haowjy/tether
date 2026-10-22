//! tether's own whole-file writes, below both the file API (`fs`) and `auth`: a file's
//! `Stamp`, the state directory's lock, and `Temp`, the one way a file is written whole.
//! Every name is relative to an open directory (`Dir`), so a path component swapped
//! after the directory was opened can't redirect a write. Everything here blocks: call
//! it on a lane (`crate::blocking`).

use std::ffi::OsStr;
use std::fs::{File, Metadata, OpenOptions};
use std::io::{self, Write as _};
use std::os::unix::fs::{MetadataExt as _, OpenOptionsExt as _, PermissionsExt as _};
use std::path::Path;
use std::sync::Arc;

use rustix::fs::{AtFlags, Mode, OFlags, RenameFlags};
use rustix::io::Errno;

/// The state directory's lock file.
const LOCK: &str = "lock";

/// What changes when a file is saved or replaced: device, inode, size and mtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stamp {
    dev: u64,
    ino: u64,
    size: u64,
    mtime_ns: i128,
}

impl Stamp {
    pub fn of(meta: &Metadata) -> Self {
        Self {
            dev: meta.dev(),
            ino: meta.ino(),
            size: meta.size(),
            mtime_ns: i128::from(meta.mtime()) * 1_000_000_000 + i128::from(meta.mtime_nsec()),
        }
    }

    /// `of`, from a `stat` that isn't a `Metadata`: the same fields, cast as std casts
    /// them, so the two compare equal.
    #[allow(
        clippy::unnecessary_cast,
        reason = "the field types differ by platform"
    )]
    fn from_stat(stat: &rustix::fs::Stat) -> Self {
        Self {
            dev: stat.st_dev as u64,
            ino: stat.st_ino as u64,
            size: stat.st_size as u64,
            mtime_ns: i128::from(stat.st_mtime as i64) * 1_000_000_000
                + i128::from(stat.st_mtime_nsec as i64),
        }
    }

    /// Strong: `"<ino>-<size>-<mtime_ns>"` in hex (fs.md "Raw reads"). It changes when
    /// the file does and stays put while it doesn't, which AVFoundation relies on across
    /// its range requests.
    pub fn etag(&self) -> String {
        format!("\"{:x}-{:x}-{:x}\"", self.ino, self.size, self.mtime_ns)
    }
}

/// The state directory's `flock`, held until dropped: every tether writer holds it for
/// its read-modify-write, of `auth.toml` and of `config.toml`, the CLI's included.
pub fn lock(state_dir: &Path) -> io::Result<File> {
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .mode(0o600)
        .open(state_dir.join(LOCK))?;
    rustix::fs::flock(&file, rustix::fs::FlockOperation::LockExclusive)?;
    Ok(file)
}

/// The 1-based line of a toml parse error, 0 if it has no position: what a log may say
/// of it, since its message quotes the file.
pub fn toml_line(text: &str, error: &toml::de::Error) -> usize {
    error.span().map_or(0, |span| {
        text.get(..span.start)
            .map_or(0, |head| head.matches('\n').count() + 1)
    })
}

/// An open directory; cheap to clone.
#[derive(Debug, Clone)]
pub struct Dir(Arc<File>);

impl Dir {
    pub fn open(path: &Path) -> io::Result<Self> {
        let flags = OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC;
        Ok(Self(Arc::new(File::from(rustix::fs::open(
            path,
            flags,
            Mode::empty(),
        )?))))
    }

    /// `name` in the directory, opened for reading, links followed; `None` if missing.
    pub fn read(&self, name: &OsStr) -> io::Result<Option<File>> {
        let flags = OFlags::RDONLY | OFlags::NONBLOCK | OFlags::CLOEXEC | OFlags::NOCTTY;
        match rustix::fs::openat(&*self.0, name, flags, Mode::empty()) {
            Ok(fd) => Ok(Some(File::from(fd))),
            Err(Errno::NOENT) => Ok(None),
            Err(errno) => Err(errno.into()),
        }
    }

    /// The stamp of the entry `name` itself (a link isn't followed); `None` if missing.
    fn stamp(&self, name: &OsStr) -> io::Result<Option<Stamp>> {
        match rustix::fs::statat(&*self.0, name, AtFlags::SYMLINK_NOFOLLOW) {
            Ok(stat) => Ok(Some(Stamp::from_stat(&stat))),
            Err(Errno::NOENT) => Ok(None),
            Err(errno) => Err(errno.into()),
        }
    }

    fn sync(&self) -> io::Result<()> {
        self.0.sync_all()
    }
}

impl From<File> for Dir {
    fn from(dir: File) -> Self {
        Self(Arc::new(dir))
    }
}

/// A file being written in a directory, under a temporary name until it lands. Not
/// deleted on drop: a drop can happen on the runtime thread, and a delete can block on
/// the disk. Each landing deletes it on its own failure; otherwise call `discard`, on a
/// lane. One left by a crash is removed by the next `create` of its name, or swept.
#[derive(Debug)]
pub struct Temp {
    dir: Dir,
    name: Box<OsStr>,
    file: Arc<File>,
}

impl Temp {
    /// A new file `name` in `dir` with exactly `mode` (the umask doesn't apply):
    /// `openat` with `O_EXCL`, never through a link. A leftover of the same name, from a
    /// writer that died, is removed first: the caller holds the lock or picked a random
    /// name.
    pub fn create(dir: &Dir, name: &OsStr, mode: u32) -> io::Result<Self> {
        match rustix::fs::unlinkat(&*dir.0, name, AtFlags::empty()) {
            Ok(()) | Err(Errno::NOENT) => {}
            Err(errno) => return Err(errno.into()),
        }
        let flags = OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW;
        let fd = rustix::fs::openat(&*dir.0, name, flags | OFlags::CLOEXEC, Mode::from(0o600))?;
        let temp = Self {
            dir: dir.clone(),
            name: name.into(),
            file: Arc::new(File::from(fd)),
        };
        match temp
            .file
            .set_permissions(std::fs::Permissions::from_mode(mode))
        {
            Ok(()) => Ok(temp),
            Err(error) => Err(temp.failed(error)),
        }
    }

    /// For writing in place, as an upload's chunks are.
    pub fn file(&self) -> &Arc<File> {
        &self.file
    }

    /// `text`, `fsync`, renamed over `target`, the directory `fsync`ed: a reader sees the
    /// old file or the new one, and a crash leaves one of them.
    pub fn replace(self, target: &OsStr, text: &[u8]) -> io::Result<()> {
        self.commit(target, text, None).map(drop)
    }

    /// `replace`, only if `target` still has the stamp `expected` (`None`: still
    /// missing). False, with the temporary file deleted, if it changed.
    pub fn replace_if(
        self,
        target: &OsStr,
        text: &[u8],
        expected: Option<Stamp>,
    ) -> io::Result<bool> {
        self.commit(target, text, Some(expected))
    }

    fn commit(
        self,
        target: &OsStr,
        text: &[u8],
        expected: Option<Option<Stamp>>,
    ) -> io::Result<bool> {
        let written = (&*self.file)
            .write_all(text)
            .and_then(|()| self.file.sync_all());
        if let Err(error) = written {
            return Err(self.failed(error));
        }
        match expected.map(|expected| self.dir.stamp(target).map(|now| now == expected)) {
            Some(Ok(false)) => {
                self.discard();
                return Ok(false);
            }
            Some(Err(error)) => return Err(self.failed(error)),
            None | Some(Ok(true)) => {}
        }
        if let Err(errno) = rustix::fs::renameat(&*self.dir.0, &*self.name, &*self.dir.0, target) {
            return Err(self.failed(errno.into()));
        }
        self.dir.sync()?;
        Ok(true)
    }

    /// Renames to the first of `names` that doesn't exist yet, never replacing a file.
    /// No `fsync`: an upload lost to a power cut is sent again (fs.md "Uploads").
    pub fn land(self, names: impl IntoIterator<Item = io::Result<String>>) -> io::Result<String> {
        for name in names {
            let name = match name {
                Ok(name) => name,
                Err(error) => return Err(self.failed(error)),
            };
            let dir = &*self.dir.0;
            match rustix::fs::renameat_with(dir, &*self.name, dir, &name, RenameFlags::NOREPLACE) {
                Ok(()) => return Ok(name),
                Err(Errno::EXIST) => continue,
                Err(errno) => return Err(self.failed(errno.into())),
            }
        }
        let exhausted = io::Error::new(io::ErrorKind::AlreadyExists, "every name tried exists");
        Err(self.failed(exhausted))
    }

    /// Deletes the file.
    pub fn discard(self) {
        let _ = rustix::fs::unlinkat(&*self.dir.0, &*self.name, AtFlags::empty());
    }

    fn failed(self, error: io::Error) -> io::Error {
        self.discard();
        error
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::FileExt as _;

    use super::*;
    use crate::fs::test_tree::Tree;

    #[test]
    fn the_etag_changes_with_the_file_and_only_then() {
        let tree = Tree::new("etag");
        let path = tree.path("f");
        std::fs::write(&path, b"one").expect("written");
        let tag = || Stamp::of(&std::fs::metadata(&path).expect("stat")).etag();
        let first = tag();
        assert!(first.starts_with('"') && first.ends_with('"'), "{first}");
        assert_eq!(tag(), first);
        std::fs::write(&path, b"two!").expect("rewritten");
        assert_ne!(tag(), first);
    }

    #[test]
    fn landing_never_replaces_a_file() {
        let tree = Tree::new("land");
        tree.write("taken.jpg", b"the original");
        let dir = Dir::open(tree.root()).expect("the folder");
        let temp = Temp::create(&dir, "a.part".as_ref(), 0o600).expect("a temp file");
        temp.file().write_all_at(b"new", 0).expect("written");
        let tries = ["taken.jpg", "free.jpg"].map(|name| Ok(name.to_owned()));
        assert_eq!(temp.land(tries).expect("renamed"), "free.jpg");
        let read = |name| std::fs::read(tree.path(name)).expect("read");
        assert_eq!(
            (read("taken.jpg"), read("free.jpg")),
            (b"the original".to_vec(), b"new".to_vec())
        );
        let mut names: Vec<_> = std::fs::read_dir(tree.root())
            .expect("the folder")
            .map(|entry| entry.expect("an entry").file_name())
            .collect();
        names.sort();
        assert_eq!(names, ["free.jpg", "taken.jpg"]);
    }
}
