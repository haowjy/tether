//! `fs::open` (fs.md "Path resolution"): canonicalize, check the scope, open without
//! following a last-component link or blocking on a FIFO, then check the scope again on
//! the path of the descriptor actually opened. Callers get the descriptor, never a path
//! to open again. Also `check_dir`, the `newWindow`/`newSession` `dir` check.

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

/// A descriptor inside the scope.
#[derive(Debug)]
pub struct Opened {
    pub file: File,
    /// Canonical: the descriptor's own path.
    pub path: String,
    /// The scope entry it is under: an index into `Scope::dir`.
    pub root: usize,
    /// From the `fstat` after opening.
    pub meta: Metadata,
}

/// The canonical directories a request may reach: the effective roots, or `$HOME` for
/// the picker.
#[derive(Debug, Clone)]
pub struct Scope {
    dirs: Vec<PathBuf>,
    picker: bool,
}

impl Scope {
    pub(super) fn roots(dirs: Vec<PathBuf>) -> Self {
        Self {
            dirs,
            picker: false,
        }
    }

    pub(super) fn home(home: PathBuf) -> Self {
        Self {
            dirs: vec![home],
            picker: true,
        }
    }

    /// `/`: path completion lists names, never contents, in any directory Jimmy can
    /// read (complete.md "Paths").
    pub fn everything() -> Self {
        Self::roots(vec![PathBuf::from("/")])
    }

    /// The longest entry `path` equals or sits below, compared component by component,
    /// so `/a/repo2` is not under `/a/repo`.
    pub fn find(&self, path: &Path) -> Option<usize> {
        let below = self
            .dirs
            .iter()
            .enumerate()
            .filter(|(_, dir)| path.starts_with(dir));
        below
            .max_by_key(|(_, dir)| dir.as_os_str().len())
            .map(|(index, _)| index)
    }

    pub fn dir(&self, index: usize) -> &Path {
        &self.dirs[index]
    }

    fn outside(&self) -> FsError {
        if self.picker {
            FsError::OutsideHome
        } else {
            FsError::OutsideRoots
        }
    }
}

/// Resolves `path` and opens it, checked against `scope` before and after opening.
/// Blocks: run it on a lane (`crate::blocking`).
pub fn open(scope: &Scope, path: &str, want: Want) -> Result<Opened, FsError> {
    let canonical = resolve(scope, path)?;
    open_resolved(scope, &canonical, want)
}

/// Steps 1 to 3: shape, `realpath`, scope.
fn resolve(scope: &Scope, path: &str) -> Result<PathBuf, FsError> {
    check_shape(path).map_err(|_| FsError::BadRequest)?;
    let canonical = std::fs::canonicalize(path).map_err(FsError::io)?;
    if canonical.to_str().is_none() {
        return Err(FsError::BadRequest);
    }
    scope.find(&canonical).ok_or_else(|| scope.outside())?;
    Ok(canonical)
}

/// Steps 4 and 5: open the canonical path, check its kind, and check the scope again on
/// the descriptor's own path, which catches a component swapped for a symlink since
/// `resolve`.
fn open_resolved(scope: &Scope, canonical: &Path, want: Want) -> Result<Opened, FsError> {
    let mut flags =
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC | OFlags::NOCTTY;
    if want == Want::Dir {
        flags |= OFlags::DIRECTORY;
    }
    let fd = rustix::fs::open(canonical, flags, Mode::empty()).map_err(|errno| match errno {
        // The last component became a symlink after `resolve`.
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
    let real = fd_path(&file).map_err(FsError::Internal)?;
    let root = scope.find(&real).ok_or_else(|| scope.outside())?;
    let path = real
        .into_os_string()
        .into_string()
        .map_err(|_| FsError::BadRequest)?;
    Ok(Opened {
        file,
        path,
        root,
        meta,
    })
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
/// a directory once links are followed. Not the roots, and no config. Blocks on a
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
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt as _;
    use std::os::unix::fs::symlink;
    use std::time::{Duration, Instant};

    use super::*;
    use crate::fs::test_tree::Tree;

    /// `root`, `other` and `root/nested` are roots; `outside` and `root2` aren't.
    fn tree() -> (Tree, Scope) {
        let tree = Tree::new("open");
        for dir in ["root/d", "root/nested", "other", "outside/d", "root2"] {
            tree.mkdir(dir);
        }
        for file in [
            "root/d/f",
            "root/g",
            "root/nested/n",
            "other/o",
            "outside/d/f",
        ] {
            tree.write(file, b"x");
        }
        tree.write("outside/secret", b"secret");
        tree.write("root2/f", b"x");
        let scope = Scope::roots(vec![
            tree.path("root"),
            tree.path("other"),
            tree.path("root/nested"),
        ]);
        (tree, scope)
    }

    fn opened(scope: &Scope, path: &Path, want: Want) -> Result<Opened, FsError> {
        open(scope, path.to_str().expect("UTF-8"), want)
    }

    #[test]
    fn a_file_in_a_root_opens_under_its_longest_root() {
        let (tree, scope) = tree();
        let file = opened(&scope, &tree.path("root/d/f"), Want::File).expect("opened");
        assert_eq!((file.root, file.path), (0, tree.str("root/d/f")));
        let nested = opened(&scope, &tree.path("root/nested/n"), Want::File).expect("opened");
        assert_eq!(nested.root, 2);
        let dir = opened(&scope, &tree.path("root"), Want::Dir).expect("opened");
        assert!(dir.meta.is_dir());
    }

    #[test]
    fn paths_that_escape_the_roots_are_refused() {
        let (tree, scope) = tree();
        symlink(tree.path("outside"), tree.path("root/out-dir")).expect("a link");
        symlink(tree.path("outside/secret"), tree.path("root/out-file")).expect("a link");
        symlink("../outside/secret", tree.path("root/out-relative")).expect("a link");
        for path in [
            format!("{}/root/../outside/secret", tree.str("")),
            format!("{}/root/d/../../outside/secret", tree.str("")),
            format!("{}/root/out-dir/secret", tree.str("")),
            format!("{}/root/out-file", tree.str("")),
            format!("{}/root/out-relative", tree.str("")),
            format!("{}/root2/f", tree.str("")),
            "/etc/passwd".to_owned(),
        ] {
            let refused = open(&scope, &path, Want::File);
            assert!(
                matches!(refused, Err(FsError::OutsideRoots)),
                "{path}: {refused:?}"
            );
        }
        // `..` that stays inside is fine: realpath resolves it.
        let inside = format!("{}/root/d/../g", tree.str(""));
        assert!(open(&scope, &inside, Want::File).is_ok());
    }

    #[test]
    fn links_into_another_root_are_followed_and_symlinked_roots_resolve() {
        let (tree, scope) = tree();
        symlink(tree.path("other"), tree.path("root/to-other")).expect("a link");
        let file = opened(&scope, &tree.path("root/to-other/o"), Want::File).expect("opened");
        assert_eq!((file.root, file.path), (1, tree.str("other/o")));

        // A root that is itself a symlink scopes its target.
        symlink(tree.path("outside"), tree.path("link-root")).expect("a link");
        let config = crate::config::Config {
            roots: vec![tree.str("link-root")],
            uploads_dir: tree.str("none"),
            ..Default::default()
        };
        let roots = crate::fs::Roots::resolve(&config, &tree.path("")).expect("roots");
        let scope = roots.scope();
        let file = opened(&scope, &tree.path("link-root/secret"), Want::File).expect("opened");
        assert_eq!(file.path, tree.str("outside/secret"));
    }

    #[test]
    fn bad_shapes_and_wrong_kinds_are_refused() {
        let (tree, scope) = tree();
        let long = format!("/{}", "a".repeat(MAX_PATH));
        for path in ["relative/path", "", "/a\0b", long.as_str()] {
            let refused = open(&scope, path, Want::File);
            assert!(matches!(refused, Err(FsError::BadRequest)), "{path:?}");
        }
        let missing = opened(&scope, &tree.path("root/missing"), Want::File);
        assert!(matches!(missing, Err(FsError::NotFound)));
        let not_file = opened(&scope, &tree.path("root/d"), Want::File);
        assert!(matches!(not_file, Err(FsError::NotAFile)));
        let not_dir = opened(&scope, &tree.path("root/g"), Want::Dir);
        assert!(matches!(not_dir, Err(FsError::NotADirectory)));
    }

    #[test]
    fn a_fifo_is_not_a_file_and_doesnt_block() {
        let (tree, scope) = tree();
        let fifo = tree.path("root/fifo");
        let made = std::process::Command::new("mkfifo").arg(&fifo).status();
        assert!(made.expect("mkfifo ran").success());
        let started = Instant::now();
        let refused = opened(&scope, &fifo, Want::File);
        assert!(matches!(refused, Err(FsError::NotAFile)), "{refused:?}");
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn a_link_to_a_name_that_isnt_utf8_is_a_bad_request() {
        let (tree, scope) = tree();
        let bad = tree.path("root").join(OsStr::from_bytes(b"bad\xff"));
        std::fs::write(&bad, b"x").expect("written");
        symlink(&bad, tree.path("root/to-bad")).expect("a link");
        let refused = opened(&scope, &tree.path("root/to-bad"), Want::File);
        assert!(matches!(refused, Err(FsError::BadRequest)), "{refused:?}");
    }

    #[test]
    fn a_component_swapped_for_a_symlink_after_the_check_is_caught() {
        let (tree, scope) = tree();
        // A directory in the path becomes a link out of the roots between steps 2 and 4.
        let canonical = resolve(&scope, &tree.str("root/d/f")).expect("resolved");
        std::fs::rename(tree.path("root/d"), tree.path("root/d-old")).expect("moved");
        symlink(tree.path("outside/d"), tree.path("root/d")).expect("a link");
        let refused = open_resolved(&scope, &canonical, Want::File);
        assert!(matches!(refused, Err(FsError::OutsideRoots)), "{refused:?}");

        // The last component becomes a link: O_NOFOLLOW refuses it.
        let canonical = resolve(&scope, &tree.str("root/g")).expect("resolved");
        std::fs::remove_file(tree.path("root/g")).expect("removed");
        symlink(tree.path("outside/secret"), tree.path("root/g")).expect("a link");
        let refused = open_resolved(&scope, &canonical, Want::File);
        assert!(matches!(refused, Err(FsError::NotFound)), "{refused:?}");
    }

    #[test]
    fn check_dir_takes_any_existing_directory_and_names_the_cause() {
        let (tree, _) = tree();
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
