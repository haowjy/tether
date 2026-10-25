//! `config.toml` and the XDG paths (plan.md "Long-term": unknown keys are ignored, so
//! an older daemon reads a newer config). A missing default file means every default.
//! The daemon reads the file once at startup, except `roots` and `uploads_dir`, which
//! fs re-reads through the same `ConfigFile` on every request (fs.md "Roots").

use std::env;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use thiserror::Error;

use crate::tmux::{Endpoint, Socket};

pub const DEFAULT_MEMORY_BUDGET_MIB: u64 = 72;
const DEFAULT_UPLOADS: &str = "~/tether-uploads";

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct Config {
    /// The host's name in the app; default: the machine's MagicDNS name.
    pub name: Option<String>,
    /// The daemon's memory budget, in MiB; daemon-core.md §6 derives its caps from it.
    pub memory_budget_mib: u64,
    pub tmux: Tmux,
    /// The file API's roots, absolute or `~/`, as written (fs.md "Roots").
    pub roots: Vec<String>,
    /// Where uploads land; a root too.
    pub uploads_dir: String,
    pub complete: Complete,
}

/// `[complete]` (complete.md): what the daemon can't see of the interactive shell.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct Complete {
    /// The history file, absolute or `~/`; default: the most recently modified of
    /// zsh's, bash's and fish's.
    pub history: Option<String>,
    /// The interactive shell's `PATH`; default: the daemon's own.
    pub path: Option<String>,
    /// The carapace binary, absolute or `~/`; default: `carapace` on that `PATH`.
    pub carapace: Option<String>,
}

/// Which tmux server is `main`. tether never starts it.
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct Tmux {
    pub program: PathBuf,
    /// `tmux -L <name>`.
    pub socket_name: Option<String>,
    /// `tmux -S <path>`.
    pub socket_path: Option<PathBuf>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            name: None,
            memory_budget_mib: DEFAULT_MEMORY_BUDGET_MIB,
            tmux: Tmux::default(),
            roots: Vec::new(),
            uploads_dir: DEFAULT_UPLOADS.to_owned(),
            complete: Complete::default(),
        }
    }
}

impl Default for Tmux {
    fn default() -> Self {
        Self {
            program: PathBuf::from("tmux"),
            socket_name: None,
            socket_path: None,
        }
    }
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("{}: {source}", path.display())]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    /// Only the position: the file isn't logged (fs.md "Logging").
    #[error("{} doesn't parse (line {line})", path.display())]
    Parse { path: PathBuf, line: usize },
    #[error("{}: set tmux.socket_name or tmux.socket_path, not both", path.display())]
    TwoSockets { path: PathBuf },
    #[error("neither $HOME nor ${0} is set")]
    NoHome(&'static str),
    #[error("$HOME isn't an absolute path")]
    NoHomeDir,
    #[error("on Linux, publish with `sudo tailscale serve …`")]
    PublishOnLinux,
}

/// Where `config.toml` is: resolved once at startup, read again by each fs request.
#[derive(Debug, Clone)]
pub struct ConfigFile {
    pub path: PathBuf,
    /// A file asked for by path must exist; the default one may not.
    required: bool,
}

impl ConfigFile {
    /// `path`, or `$XDG_CONFIG_HOME/tether/config.toml`.
    pub fn resolve(path: Option<&Path>) -> Result<Self, ConfigError> {
        Ok(match path {
            Some(path) => Self {
                path: path.to_owned(),
                required: true,
            },
            None => Self {
                path: xdg("XDG_CONFIG_HOME", ".config")?.join("tether/config.toml"),
                required: false,
            },
        })
    }

    pub fn load(&self) -> Result<Config, ConfigError> {
        let path = &self.path;
        match std::fs::read_to_string(path) {
            Ok(text) => Config::parse(path, &text),
            Err(error) if !self.required && error.kind() == std::io::ErrorKind::NotFound => {
                Ok(Config::default())
            }
            Err(source) => Err(ConfigError::Io {
                path: path.clone(),
                source,
            }),
        }
    }
}

impl Config {
    /// The text of the file at `path`, as `load` would take it.
    pub fn parse(path: &Path, text: &str) -> Result<Self, ConfigError> {
        let config: Self = toml::from_str(text).map_err(|error| ConfigError::Parse {
            path: path.to_owned(),
            line: crate::files::toml_line(text, &error),
        })?;
        if config.tmux.socket_name.is_some() && config.tmux.socket_path.is_some() {
            return Err(ConfigError::TwoSockets {
                path: path.to_owned(),
            });
        }
        Ok(config)
    }

    pub fn endpoint(&self) -> Endpoint {
        let socket = match (&self.tmux.socket_name, &self.tmux.socket_path) {
            (Some(name), _) => Socket::Name(name.clone()),
            (None, Some(path)) => Socket::Path(path.clone()),
            (None, None) => Socket::Default,
        };
        Endpoint {
            program: self.tmux.program.clone(),
            socket,
        }
    }
}

/// `$XDG_STATE_HOME/tether`: `auth.toml`, `host_id`, `lock`.
pub fn state_dir() -> Result<PathBuf, ConfigError> {
    Ok(xdg("XDG_STATE_HOME", ".local/state")?.join("tether"))
}

/// `$HOME`, which `~/` in `roots` and `uploads_dir` stands for.
pub fn home() -> Result<PathBuf, ConfigError> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|home| home.is_absolute())
        .ok_or(ConfigError::NoHomeDir)
}

/// `$XDG_RUNTIME_DIR/tether`, the private directory for sockets and pastes.
/// `TMPDIR` on macOS is the per-user directory supplied by launchd.
pub fn runtime_dir() -> Result<PathBuf, RuntimeDirError> {
    let base = if cfg!(target_os = "macos") {
        env::var_os("TMPDIR")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .ok_or(RuntimeDirError::NoRuntimeDir)?
    } else {
        env::var_os("XDG_RUNTIME_DIR")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .ok_or(RuntimeDirError::NoRuntimeDir)?
    };
    Ok(base.join("tether"))
}

/// Creates the runtime directory once, then refuses any path shape or ownership that
/// would let another user plant a socket target.
pub fn prepare_runtime_dir(path: &Path) -> Result<(), RuntimeDirError> {
    use std::os::unix::fs::{DirBuilderExt as _, MetadataExt as _, PermissionsExt as _};

    match std::fs::symlink_metadata(path) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut builder = std::fs::DirBuilder::new();
            builder.mode(0o700);
            match builder.create(path) {
                Ok(()) => {
                    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
                        .map_err(|source| RuntimeDirError::Io {
                            path: path.to_owned(),
                            source,
                        })?;
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(source) => {
                    return Err(RuntimeDirError::Io {
                        path: path.to_owned(),
                        source,
                    });
                }
            }
        }
        Err(source) => {
            return Err(RuntimeDirError::Io {
                path: path.to_owned(),
                source,
            });
        }
    }

    let metadata = std::fs::symlink_metadata(path).map_err(|source| RuntimeDirError::Io {
        path: path.to_owned(),
        source,
    })?;
    let cause = if metadata.file_type().is_symlink() || !metadata.is_dir() {
        Some("must be a real directory, not a symlink")
    } else if metadata.uid() != rustix::process::getuid().as_raw() {
        Some("must be owned by the daemon user")
    } else if metadata.mode() & 0o7777 != 0o700 {
        Some("must have mode 0700")
    } else {
        None
    };
    if let Some(cause) = cause {
        return Err(RuntimeDirError::Unsafe {
            path: path.to_owned(),
            cause,
        });
    }
    Ok(())
}

#[derive(Debug, Error)]
pub enum RuntimeDirError {
    #[error("XDG_RUNTIME_DIR is required on Linux or TMPDIR on macOS (no /tmp fallback)")]
    NoRuntimeDir,
    #[error("{path}: {cause}")]
    Unsafe { path: PathBuf, cause: &'static str },
    #[error("{path}: {source}")]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
}

/// An XDG base directory: the variable if it holds an absolute path (the spec ignores
/// relative ones), else `$HOME/<fallback>`.
fn xdg(var: &'static str, fallback: &str) -> Result<PathBuf, ConfigError> {
    xdg_from(
        var,
        env::var_os(var).as_deref(),
        env::var_os("HOME").as_deref(),
        fallback,
    )
}

/// Resolves an XDG directory from a process environment snapshot. Setup compares the
/// invoking shell with the service manager, whose environment is read separately.
pub(crate) fn xdg_from(
    var: &'static str,
    value: Option<&std::ffi::OsStr>,
    home: Option<&std::ffi::OsStr>,
    fallback: &str,
) -> Result<PathBuf, ConfigError> {
    match value.map(PathBuf::from) {
        Some(dir) if dir.is_absolute() => Ok(dir),
        _ => home
            .map(|home| PathBuf::from(home).join(fallback))
            .ok_or(ConfigError::NoHome(var)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_old_port_setting_is_ignored() {
        let config = Config::parse(Path::new("config.toml"), "port = 7850\n")
            .expect("legacy config remains readable");
        assert_eq!(config.memory_budget_mib, DEFAULT_MEMORY_BUDGET_MIB);
    }
}
