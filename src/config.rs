//! `config.toml` and the XDG paths (plan.md "Long-term": unknown keys are ignored, so
//! an older daemon reads a newer config). A missing default file means every default.
//! The daemon reads the file once at startup, except `roots` and `uploads_dir`, which
//! fs re-reads through the same `ConfigFile` on every request (fs.md "Roots").

use std::env;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use thiserror::Error;

use crate::tmux::{Endpoint, Socket};

pub const DEFAULT_PORT: u16 = 7850;
const DEFAULT_UPLOADS: &str = "~/tether-uploads";

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct Config {
    /// The daemon listens on `127.0.0.1:port`; `tailscale serve` proxies to it.
    pub port: u16,
    /// The host's name in the app; default: the machine's MagicDNS name.
    pub name: Option<String>,
    pub tmux: Tmux,
    /// The file API's roots, absolute or `~/`, as written (fs.md "Roots").
    pub roots: Vec<String>,
    /// Where uploads land; a root too.
    pub uploads_dir: String,
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
            roots: Vec::new(),
            uploads_dir: DEFAULT_UPLOADS.to_owned(),
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
            line: error.span().map_or(0, |span| {
                text.get(..span.start)
                    .map_or(0, |head| head.matches('\n').count() + 1)
            }),
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
