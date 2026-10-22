//! `config.toml` and the XDG paths (plan.md "Long-term": unknown keys are ignored, so
//! an older daemon reads a newer config). A missing file means every default.

use std::env;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use thiserror::Error;

use crate::tmux::{Endpoint, Socket};

pub const DEFAULT_PORT: u16 = 7850;

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct Config {
    /// The daemon listens on `127.0.0.1:port`; `tailscale serve` proxies to it.
    pub port: u16,
    /// The host's name in the app; default: the machine's MagicDNS name.
    pub name: Option<String>,
    pub tmux: Tmux,
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
            port: DEFAULT_PORT,
            name: None,
            tmux: Tmux::default(),
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
    #[error("{}: {source}", path.display())]
    Parse {
        path: PathBuf,
        source: Box<toml::de::Error>,
    },
    #[error("{}: set tmux.socket_name or tmux.socket_path, not both", path.display())]
    TwoSockets { path: PathBuf },
    #[error("neither $HOME nor ${0} is set")]
    NoHome(&'static str),
}

impl Config {
    /// `path`, or `$XDG_CONFIG_HOME/tether/config.toml`. A file that was asked for by
    /// path must exist; the default one may not.
    pub fn load(path: Option<&Path>) -> Result<Self, ConfigError> {
        let (path, required) = match path {
            Some(path) => (path.to_owned(), true),
            None => (
                xdg("XDG_CONFIG_HOME", ".config")?.join("tether/config.toml"),
                false,
            ),
        };
        let text = match std::fs::read_to_string(&path) {
            Ok(text) => text,
            Err(error) if !required && error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::default());
            }
            Err(source) => return Err(ConfigError::Io { path, source }),
        };
        let config: Self = toml::from_str(&text).map_err(|source| ConfigError::Parse {
            path: path.clone(),
            source: Box::new(source),
        })?;
        if config.tmux.socket_name.is_some() && config.tmux.socket_path.is_some() {
            return Err(ConfigError::TwoSockets { path });
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

/// Where paste files wait for tmux: `$XDG_RUNTIME_DIR/tether` (tmpfs), or a per-user
/// directory under the temp dir where there is no runtime dir (macOS).
pub fn runtime_dir() -> PathBuf {
    match env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from) {
        Some(dir) if dir.is_absolute() => dir.join("tether"),
        _ => env::temp_dir().join(format!("tether-{}", rustix::process::getuid().as_raw())),
    }
}

/// An XDG base directory: the variable if it holds an absolute path (the spec ignores
/// relative ones), else `$HOME/<fallback>`.
fn xdg(var: &'static str, fallback: &str) -> Result<PathBuf, ConfigError> {
    match env::var_os(var).map(PathBuf::from) {
        Some(dir) if dir.is_absolute() => Ok(dir),
        _ => env::var_os("HOME")
            .map(|home| PathBuf::from(home).join(fallback))
            .ok_or(ConfigError::NoHome(var)),
    }
}
