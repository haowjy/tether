//! The private runtime directory and the daemon's two HTTP fronts.

use std::fs::File;
use std::io;
#[cfg(target_os = "macos")]
use std::net::{Ipv4Addr, TcpListener as StdTcpListener};
use std::os::unix::fs::{FileTypeExt as _, PermissionsExt as _};
use std::path::{Path, PathBuf};

use rustix::fs::{Mode, OFlags};
use thiserror::Error;
#[cfg(target_os = "macos")]
use tokio::net::TcpListener;
use tokio::net::UnixListener;

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error(transparent)]
    Directory(#[from] crate::config::RuntimeDirError),
    #[error("tether is already running")]
    AlreadyRunning,
    #[error("no launchd socket `Listener`")]
    NoLaunchdSocket,
    #[error("launchd couldn't bind the Mac front's port; another process holds it")]
    MacFrontNotBound,
    #[error("{path}: {source}")]
    Io { path: PathBuf, source: io::Error },
}

pub struct Runtime {
    /// Keeping this descriptor open holds the daemon-wide lock until shutdown.
    _lock: File,
    pub serve: ServeFront,
    pub local: UnixListener,
    pub local_path: PathBuf,
    pub paste_dir: PathBuf,
}

#[cfg(not(target_os = "macos"))]
pub struct ServeFront {
    pub listener: UnixListener,
    pub path: PathBuf,
}

#[cfg(target_os = "macos")]
pub struct ServeFront {
    pub listener: Option<TcpListener>,
}

impl Runtime {
    /// Directory check, lock, stale socket replacement, binds, then paste cleanup.
    pub fn open(dir: PathBuf, publish: bool) -> Result<Self, RuntimeError> {
        #[cfg(not(target_os = "macos"))]
        let _ = publish;
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
        #[cfg(not(target_os = "macos"))]
        let serve = ServeFront {
            listener: bind(&serve_path)?,
            path: serve_path.clone(),
        };
        #[cfg(target_os = "macos")]
        let serve = if publish {
            ServeFront {
                listener: Some(launchd_listener()?),
            }
        } else {
            ServeFront { listener: None }
        };
        let local = bind(&local_path)?;

        let paste_dir = dir.join("paste");
        empty_directory(&paste_dir)?;
        Ok(Self {
            _lock: lock,
            serve,
            local,
            local_path,
            paste_dir,
        })
    }
}

#[cfg(target_os = "macos")]
fn launchd_listener() -> Result<TcpListener, RuntimeError> {
    use std::os::fd::OwnedFd;

    let mut descriptors =
        crate::launchd::activate_socket("Listener").map_err(|_| RuntimeError::NoLaunchdSocket)?;
    if descriptors.len() != 1 {
        return Err(RuntimeError::NoLaunchdSocket);
    }
    let descriptor: OwnedFd = descriptors.pop().expect("one descriptor");
    rustix::io::fcntl_setfd(&descriptor, rustix::io::FdFlags::CLOEXEC)
        .map_err(|_| RuntimeError::NoLaunchdSocket)?;
    let listener = StdTcpListener::from(descriptor);
    listener
        .set_nonblocking(true)
        .map_err(|_| RuntimeError::NoLaunchdSocket)?;
    let address = listener
        .local_addr()
        .map_err(|_| RuntimeError::NoLaunchdSocket)?;
    if address.ip() != Ipv4Addr::LOCALHOST || address.port() == 0 {
        return Err(RuntimeError::MacFrontNotBound);
    }
    let listener = TcpListener::from_std(listener).map_err(|_| RuntimeError::NoLaunchdSocket)?;
    Ok(listener)
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
