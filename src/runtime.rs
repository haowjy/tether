//! The private runtime directory and the daemon's two HTTP fronts.

use std::fs::File;
use std::io;
use std::os::unix::fs::{FileTypeExt as _, PermissionsExt as _};
use std::path::{Path, PathBuf};

use rustix::fs::{Mode, OFlags};
use thiserror::Error;
use tokio::net::UnixListener;

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error(transparent)]
    Directory(#[from] crate::config::RuntimeDirError),
    #[error("tether is already running")]
    AlreadyRunning,
    #[error("{path}: {source}")]
    Io { path: PathBuf, source: io::Error },
}

pub struct Runtime {
    /// Keeping this descriptor open holds the daemon-wide lock until shutdown.
    _lock: File,
    pub serve: UnixListener,
    pub local: UnixListener,
    pub serve_path: PathBuf,
    pub local_path: PathBuf,
    pub paste_dir: PathBuf,
}

impl Runtime {
    /// Directory check, lock, stale socket replacement, binds, then paste cleanup.
    pub fn open(dir: PathBuf) -> Result<Self, RuntimeError> {
        crate::config::prepare_runtime_dir(&dir)?;
        let lock_path = dir.join("lock");
        let lock = rustix::fs::open(
            &lock_path,
            OFlags::RDWR | OFlags::CREATE | OFlags::CLOEXEC | OFlags::NOFOLLOW,
            Mode::from(0o600),
        )
        .map(File::from)
        .map_err(|source| io_at(&lock_path, source))?;
        rustix::fs::fchmod(&lock, Mode::from(0o600)).map_err(|source| io_at(&lock_path, source))?;
        match rustix::fs::flock(&lock, rustix::fs::FlockOperation::NonBlockingLockExclusive) {
            Ok(()) => {}
            // EAGAIN and EWOULDBLOCK are the same value on supported platforms.
            Err(rustix::io::Errno::AGAIN) => {
                return Err(RuntimeError::AlreadyRunning);
            }
            Err(source) => return Err(io_at(&lock_path, source)),
        }

        let serve_path = dir.join("serve.sock");
        let local_path = dir.join("local.sock");
        unlink_stale(&serve_path)?;
        unlink_stale(&local_path)?;
        let serve = bind(&serve_path)?;
        let local = bind(&local_path)?;

        let paste_dir = dir.join("paste");
        empty_directory(&paste_dir)?;
        Ok(Self {
            _lock: lock,
            serve,
            local,
            serve_path,
            local_path,
            paste_dir,
        })
    }
}

fn unlink_stale(path: &Path) -> Result<(), RuntimeError> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_socket() => {}
        Ok(_) => {
            return Err(RuntimeError::Io {
                path: path.to_owned(),
                source: io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "refusing to replace a non-socket runtime path",
                ),
            });
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(source) => return Err(io_at(path, source)),
    }
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(source) => Err(io_at(path, source)),
    }
}

fn bind(path: &Path) -> Result<UnixListener, RuntimeError> {
    let listener = UnixListener::bind(path).map_err(|source| io_at(path, source))?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|source| io_at(path, source))?;
    Ok(listener)
}

fn empty_directory(path: &Path) -> Result<(), RuntimeError> {
    match std::fs::remove_dir_all(path) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(source) => return Err(io_at(path, source)),
    }
    std::fs::create_dir(path).map_err(|source| io_at(path, source))?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
        .map_err(|source| io_at(path, source))?;
    Ok(())
}

fn io_at(path: &Path, source: impl Into<io::Error>) -> RuntimeError {
    RuntimeError::Io {
        path: path.to_owned(),
        source: source.into(),
    }
}
