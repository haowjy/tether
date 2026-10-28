//! `fs::open` (fs.md "Path resolution"): canonicalize, open without following a
//! last-component link or blocking on a FIFO, then read the path of the descriptor
//! actually opened. Callers get the descriptor, never a path to open again. Also
//! `check_dir`, the `newWindow`/`newSession` `dir` check.

use std::fs::{File, Metadata};
use std::io;
use std::path::{Path, PathBuf};

use rustix::fs::{Mode, OFlags};
use rustix::io::Errno;

use super::{FsError, MAX_PATH};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Want {
    Dir,
    File,
}

#[derive(Debug)]
pub struct Opened {
    pub file: File,
    /// Canonical: the descriptor's own path.
    pub path: String,
    /// From the `fstat` after opening.
    pub meta: Metadata,
}

/// Resolves `path` and opens it. Any path the daemon's user can read: there is no scope.
/// Blocks: run it on a lane (`crate::blocking`).
pub fn open(path: &str, want: Want) -> Result<Opened, FsError> {
    check_shape(path).map_err(|_| FsError::BadRequest)?;
    let canonical = std::fs::canonicalize(path).map_err(FsError::io)?;
    if canonical.to_str().is_none() {
        return Err(FsError::BadRequest);
    }
    open_resolved(&canonical, want)
}

/// Opens the canonical path, checks its kind, and takes the descriptor's own path, which
/// is where the file really is if a component was swapped for a symlink since `open`
/// resolved it.
fn open_resolved(canonical: &Path, want: Want) -> Result<Opened, FsError> {
    // Opening a device can act on it (a serial port's DTR toggles), so the kind is
    // checked by `lstat` first; the `fstat` below still catches a swap in between.
    let kind = std::fs::symlink_metadata(canonical)
        .map_err(FsError::io)?
        .file_type();
    if kind.is_symlink() {
        return Err(FsError::NotFound);
    }
    match want {
        Want::Dir if !kind.is_dir() => return Err(FsError::NotADirectory),
        Want::File if !kind.is_file() => return Err(FsError::NotAFile),
        _ => {}
    }
    let mut flags =
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC | OFlags::NOCTTY;
    if want == Want::Dir {
        flags |= OFlags::DIRECTORY;
    }
    let fd = rustix::fs::open(canonical, flags, Mode::empty()).map_err(|errno| match errno {
        // The last component became a symlink after `canonicalize`.
        Errno::LOOP => FsError::NotFound,
        Errno::NOTDIR if want == Want::Dir => FsError::NotADirectory,
        errno => FsError::io(errno.into()),
    })?;
    let file = File::from(fd);
    let meta = file.metadata().map_err(FsError::Internal)?;
    match want {
        Want::Dir if !meta.is_dir() => return Err(FsError::NotADirectory),
        Want::File if !meta.is_file() => return Err(FsError::NotAFile),
        _ => {}
    }
    let path = fd_path(&file)
        .map_err(FsError::Internal)?
        .into_os_string()
        .into_string()
        .map_err(|_| FsError::BadRequest)?;
    Ok(Opened { file, path, meta })
}

/// The path the kernel holds for an open descriptor.
#[cfg(target_os = "linux")]
fn fd_path(file: &File) -> io::Result<PathBuf> {
    use std::os::fd::AsRawFd as _;
    std::fs::read_link(format!("/proc/self/fd/{}", file.as_raw_fd()))
}

/// `fcntl(F_GETPATH)`.
#[cfg(target_vendor = "apple")]
fn fd_path(file: &File) -> io::Result<PathBuf> {
    use std::os::unix::ffi::OsStringExt as _;
    let path = rustix::fs::getpath(file)?;
    Ok(PathBuf::from(std::ffi::OsString::from_vec(
        path.into_bytes(),
    )))
}

/// Fails closed where there is no way to ask.
#[cfg(not(any(target_os = "linux", target_vendor = "apple")))]
fn fd_path(_: &File) -> io::Result<PathBuf> {
    Err(io::ErrorKind::Unsupported.into())
}

/// `newWindow` and `newSession` `dir` (fs.md "Path resolution"): the shape rules, then
/// a directory once links are followed. No config. Blocks on a
/// `stat`. The refusal names the cause, for `error { badRequest }`.
pub fn check_dir(dir: &str) -> Result<(), &'static str> {
    check_shape(dir)?;
    match std::fs::metadata(dir) {
        Ok(meta) if meta.is_dir() => Ok(()),
        Ok(_) => Err("not a directory"),
        Err(error) => Err(match error.kind() {
            io::ErrorKind::NotFound | io::ErrorKind::NotADirectory => "no such directory",
            io::ErrorKind::PermissionDenied => "permission denied",
            _ => "can't read the directory",
        }),
    }
}

/// Step 1: absolute, at most `MAX_PATH` bytes, no NUL. Also `/complete`'s `cwd`.
pub fn check_shape(path: &str) -> Result<(), &'static str> {
    if path.len() > MAX_PATH {
        Err("the path is longer than 4096 bytes")
    } else if path.contains('\0') {
        Err("the path contains a NUL")
    } else if !path.starts_with('/') {
        Err("not an absolute path")
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "linux")]
    use std::ffi::OsStr;
    #[cfg(target_os = "linux")]
    use std::os::unix::ffi::OsStrExt as _;
    use std::os::unix::fs::symlink;
    use std::time::{Duration, Instant};

    use super::*;
    use crate::fs::test_tree::Tree;

    fn tree() -> Tree {
        let tree = Tree::new("open");
        for dir in ["root/d", "outside/d"] {
            tree.mkdir(dir);
        }
        tree.write("root/d/f", b"x");
        tree.write("root/g", b"x");
        tree.write("outside/secret", b"secret");
        tree
    }

    fn opened(path: &Path, want: Want) -> Result<Opened, FsError> {
        open(path.to_str().expect("UTF-8"), want)
    }

    #[test]
    fn any_readable_path_opens_at_its_canonical_path() {
        let tree = tree();
        symlink(tree.path("outside"), tree.path("root/out-dir")).expect("a link");
        symlink("../outside/secret", tree.path("root/out-relative")).expect("a link");
        let file = opened(&tree.path("root/d/f"), Want::File).expect("opened");
        assert_eq!(file.path, tree.str("root/d/f"));
        assert!(
            opened(&tree.path("root"), Want::Dir)
                .expect("opened")
                .meta
                .is_dir()
        );
        // Links and `..` are followed, as the terminal would: the path is where it lands.
        for (path, canonical) in [
            (tree.str("root/out-dir/secret"), tree.str("outside/secret")),
            (tree.str("root/out-relative"), tree.str("outside/secret")),
            (
                tree.str("root/../outside/secret"),
                tree.str("outside/secret"),
            ),
            (tree.str("root/d/../g"), tree.str("root/g")),
        ] {
            let file = open(&path, Want::File).expect("opened");
            assert_eq!(file.path, canonical, "{path}");
        }
        assert!(open("/", Want::Dir).is_ok());
    }

    #[test]
    fn bad_shapes_and_wrong_kinds_are_refused() {
        let tree = tree();
        let long = format!("/{}", "a".repeat(MAX_PATH));
        for path in ["relative/path", "", "/a\0b", long.as_str()] {
            let refused = open(path, Want::File);
            assert!(matches!(refused, Err(FsError::BadRequest)), "{path:?}");
        }
        let missing = opened(&tree.path("root/missing"), Want::File);
        assert!(matches!(missing, Err(FsError::NotFound)));
        let not_file = opened(&tree.path("root/d"), Want::File);
        assert!(matches!(not_file, Err(FsError::NotAFile)));
        let not_dir = opened(&tree.path("root/g"), Want::Dir);
        assert!(matches!(not_dir, Err(FsError::NotADirectory)));
    }

    #[test]
    fn a_fifo_is_not_a_file_and_doesnt_block() {
        let tree = tree();
        let fifo = tree.path("root/fifo");
        let made = std::process::Command::new("mkfifo").arg(&fifo).status();
        assert!(made.expect("mkfifo ran").success());
        let started = Instant::now();
        let refused = opened(&fifo, Want::File);
        assert!(matches!(refused, Err(FsError::NotAFile)), "{refused:?}");
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_link_to_a_name_that_isnt_utf8_is_a_bad_request() {
        let tree = tree();
        let bad = tree.path("root").join(OsStr::from_bytes(b"bad\xff"));
        std::fs::write(&bad, b"x").expect("written");
        symlink(&bad, tree.path("root/to-bad")).expect("a link");
        let refused = opened(&tree.path("root/to-bad"), Want::File);
        assert!(matches!(refused, Err(FsError::BadRequest)), "{refused:?}");
    }

    #[test]
    fn a_component_swapped_for_a_symlink_after_resolving_is_reported_where_it_lands() {
        let tree = tree();
        let canonical = tree.path("root/d/f");
        std::fs::rename(tree.path("root/d"), tree.path("root/d-old")).expect("moved");
        symlink(tree.path("outside/d"), tree.path("root/d")).expect("a link");
        tree.write("outside/d/f", b"y");
        let file = open_resolved(&canonical, Want::File).expect("opened");
        assert_eq!(file.path, tree.str("outside/d/f"));

        // The last component becomes a link: O_NOFOLLOW refuses it.
        let canonical = tree.path("root/g");
        std::fs::remove_file(&canonical).expect("removed");
        symlink(tree.path("outside/secret"), &canonical).expect("a link");
        let refused = open_resolved(&canonical, Want::File);
        assert!(matches!(refused, Err(FsError::NotFound)), "{refused:?}");
    }

    #[test]
    fn check_dir_takes_any_existing_directory_and_names_the_cause() {
        let tree = tree();
        symlink(tree.path("outside"), tree.path("dir-link")).expect("a link");
        assert_eq!(check_dir(&tree.str("outside")), Ok(()));
        assert_eq!(check_dir(&tree.str("dir-link")), Ok(()));
        assert_eq!(check_dir("relative"), Err("not an absolute path"));
        assert_eq!(check_dir(&tree.str("missing")), Err("no such directory"));
        assert_eq!(
            check_dir(&tree.str("outside/secret")),
            Err("not a directory")
        );
    }
}
