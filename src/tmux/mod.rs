//! The tmux bridge: ids, the work a control client or a one-shot runs, and what tmux
//! answers. `Session` is the sans-IO control client; `pump` and `oneshot` are the only
//! files that run tmux. See daemon-core.md §3.

use std::fmt;
use std::path::PathBuf;
use std::process::Stdio;

use bytes::Bytes;
use thiserror::Error;

pub mod command;
pub mod layout;
pub mod oneshot;
pub mod parse;
pub mod pump;
pub mod session;
pub mod snapshot;

pub use pump::PumpMsg;
pub use session::{MAX_IN_FLIGHT, Session, Step};

macro_rules! tmux_id {
    ($(#[$doc:meta])* $name:ident, $sigil:literal) => {
        $(#[$doc])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name(pub u32);

        impl $name {
            /// Parses tmux's spelling, sigil included.
            pub fn parse(text: &[u8]) -> Option<Self> {
                let digits = text.strip_prefix($sigil.as_bytes())?;
                parse_decimal(digits).map(Self)
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, concat!($sigil, "{}"), self.0)
            }
        }
    };
}

tmux_id!(
    /// A tmux session, `$N`.
    SessionId,
    "$"
);
tmux_id!(
    /// A tmux window, `@N`.
    WindowId,
    "@"
);
tmux_id!(
    /// A tmux pane, `%N`.
    PaneId,
    "%"
);

fn parse_decimal<T: std::str::FromStr>(digits: &[u8]) -> Option<T> {
    if digits.is_empty() || !digits.iter().all(u8::is_ascii_digit) {
        return None;
    }
    std::str::from_utf8(digits).ok()?.parse().ok()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Size {
    pub cols: u16,
    pub rows: u16,
}

/// The caller's name for one request; returned in the request's `Done` or `Snapshot`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Tag(pub u64);

/// The caller's name for one control client; tags everything its pump sends.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ClientId(pub u64);

/// A tmux server tether talks to (§3.8): the tmux executable and the server's socket.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoint {
    pub program: PathBuf,
    pub socket: Socket,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Socket {
    /// tmux's default socket.
    Default,
    /// `-L name`: a socket of that name in tmux's socket directory.
    Name(String),
    /// `-S path`.
    Path(PathBuf),
}

impl Endpoint {
    /// `tmux -u -N` on this endpoint's socket, which `pump` and `oneshot` give their
    /// arguments and run: piped stdout and stderr, stdin closed, killed when dropped.
    ///
    /// - `-N`: with no server running, every command fails instead of starting one.
    /// - `-u`: tmux replaces non-ASCII in formats (names, paths) with `_` for a client
    ///   whose locale doesn't say UTF-8, and a systemd unit's may not.
    /// - No `TMUX`: it would choose the socket when none is configured.
    fn command(&self) -> tokio::process::Command {
        let mut command = tokio::process::Command::new(&self.program);
        command.args(["-u", "-N"]);
        match &self.socket {
            Socket::Default => {}
            Socket::Name(name) => {
                command.arg("-L").arg(name);
            }
            Socket::Path(path) => {
                command.arg("-S").arg(path);
            }
        }
        command
            .env_remove("TMUX")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        command
    }
}

/// One run of a tmux server: `"<pid>-<start_time>"`. A restarted server reuses ids, so
/// every id is only meaningful together with the instance it came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ServerInstance {
    pub pid: u32,
    pub start_time: u64,
}

impl fmt::Display for ServerInstance {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}-{}", self.pid, self.start_time)
    }
}

/// `#{version}`: an optional `name-` prefix, `MAJOR.MINOR`, an optional letter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TmuxVersion {
    Known {
        major: u16,
        minor: u16,
        letter: Option<char>,
    },
    /// Not in a recognised shape; treated as the newest known version. The caller
    /// logs a warning.
    Unrecognised(String),
}

impl TmuxVersion {
    pub const MINIMUM: (u16, u16) = (3, 4);

    pub fn parse(text: &str) -> Self {
        let numeric = match text.split_once('-') {
            Some((name, rest)) if !name.starts_with(|c: char| c.is_ascii_digit()) => rest,
            _ => text,
        };
        let unrecognised = || Self::Unrecognised(text.to_owned());
        let Some((major, rest)) = numeric.split_once('.') else {
            return unrecognised();
        };
        let digits_end = rest
            .find(|c: char| !c.is_ascii_digit())
            .unwrap_or(rest.len());
        let (minor, suffix) = rest.split_at(digits_end);
        let mut suffix = suffix.chars();
        let letter = suffix.next();
        let (Some(major), Some(minor)) = (
            parse_decimal::<u16>(major.as_bytes()),
            parse_decimal::<u16>(minor.as_bytes()),
        ) else {
            return unrecognised();
        };
        if suffix.next().is_some() || letter.is_some_and(|c| !c.is_ascii_lowercase()) {
            return unrecognised();
        }
        Self::Known {
            major,
            minor,
            letter,
        }
    }

    pub fn is_supported(&self) -> bool {
        match self {
            Self::Known { major, minor, .. } => (*major, *minor) >= Self::MINIMUM,
            Self::Unrecognised(_) => true,
        }
    }
}

impl fmt::Display for TmuxVersion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Known {
                major,
                minor,
                letter,
            } => {
                write!(f, "{major}.{minor}")?;
                if let Some(letter) = letter {
                    write!(f, "{letter}")?;
                }
                Ok(())
            }
            Self::Unrecognised(text) => f.write_str(text),
        }
    }
}

/// Work a control client runs for the hub (daemon-core.md §3.4).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Op {
    Locate {
        window: WindowId,
    },
    LocateSession {
        session: SessionId,
    },
    /// Makes the pane wanted and captures it; answered by `Event::Snapshot`.
    Snapshot {
        pane: PaneId,
    },
    /// Unwants and pauses the pane. Its snapshots still in flight answer nothing.
    Release {
        pane: PaneId,
    },
    Vote {
        window: WindowId,
        size: Size,
    },
    ClearVote {
        window: WindowId,
    },
    Subscribe {
        window: WindowId,
    },
    Unsubscribe {
        window: WindowId,
    },
    History {
        pane: PaneId,
        start: i32,
        end: i32,
    },
    Input {
        window: WindowId,
        items: Vec<InputItem>,
    },
    Paste {
        window: WindowId,
        path: PathBuf,
    },
}

/// Work for a one-shot `tmux -N` (§3.8): when no control client can run it, or when it
/// must not run on one. Answered with a `Reply` like an `Op`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OneShotCmd {
    /// The session sheet: answered by `Reply::Listing`.
    List,
    Locate {
        window: WindowId,
    },
    LocateSession {
        session: SessionId,
    },
    /// Answered by `Reply::Created`, or `NoServer` if the server running isn't
    /// `server`: tmux checks that before it creates anything, since a session id from
    /// another run of the server names some other session.
    NewWindow {
        server: ServerInstance,
        session: SessionId,
        name: Option<String>,
        dir: Option<PathBuf>,
    },
    /// Answered by `Reply::Created`.
    NewSession {
        name: Option<String>,
        dir: Option<PathBuf>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InputItem {
    Text(String),
    Bytes(Bytes),
    /// A tmux key name; must pass `command::is_key_name`.
    Key(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    /// The startup line and the client size are done; requests may follow.
    Ready {
        server: ServerInstance,
        version: TmuxVersion,
    },
    /// Output from a wanted pane.
    Output {
        pane: PaneId,
        bytes: Bytes,
    },
    /// A snapshot, at its boundary: output before this event is inside `restore`, which
    /// rebuilds the pane in a reset terminal of `size`.
    Snapshot {
        tag: Tag,
        pane: PaneId,
        size: Size,
        restore: Bytes,
    },
    Done {
        tag: Tag,
        result: Result<Reply, TmuxError>,
    },
    /// tmux paused a wanted pane on its own and dropped its queued output.
    Gap {
        pane: PaneId,
    },
    Layout {
        window: WindowId,
        panes: Vec<(PaneId, Size)>,
    },
    ActivePane {
        window: WindowId,
        pane: PaneId,
    },
    /// The window left some session: closed, or moved.
    WindowUnlinked {
        window: WindowId,
    },
    WindowRenamed {
        window: WindowId,
        name: String,
    },
    SessionsChanged,
    Cwd {
        window: WindowId,
        path: String,
    },
    /// The control client can't continue; the caller closes it.
    Fatal(SessionError),
}

/// What tmux answered for an `Op` or a `OneShotCmd`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reply {
    Ok,
    Location(Location),
    SessionLocation(SessionLocation),
    /// `capture-pane -e` rows, without line ends.
    History(Vec<Bytes>),
    Listing(Listing),
    Created(Created),
}

/// Every session and its windows, for the session sheet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Listing {
    pub server: ServerInstance,
    pub version: TmuxVersion,
    pub sessions: Vec<ListedSession>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListedSession {
    pub id: SessionId,
    pub name: String,
    /// A client other than a control client is attached: someone's terminal.
    pub attached_elsewhere: bool,
    pub windows: Vec<ListedWindow>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListedWindow {
    pub id: WindowId,
    pub index: u32,
    pub name: String,
    /// The session's current window.
    pub active: bool,
    /// Last activity, in unix seconds.
    pub activity: u64,
}

/// A window tether created, alone or as a new session's first.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Created {
    pub server: ServerInstance,
    pub session: SessionId,
    pub window: WindowId,
}

/// Where a window is. `found` is `None` when the window is gone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Location {
    pub server: ServerInstance,
    pub found: Option<Found>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Found {
    pub session: SessionId,
    pub pane: PaneId,
    pub size: Size,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionLocation {
    pub server: ServerInstance,
    pub exists: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum TmuxError {
    /// tmux refused a command; its message.
    #[error("tmux: {0}")]
    Command(String),
    /// The snapshot's pane no longer exists.
    #[error("pane gone")]
    PaneGone,
    /// A tmux hook changed every attempt mid-list: a waiting one let pane output in,
    /// or one changed the pane's state between its two reads.
    #[error("snapshot torn by a tmux hook")]
    Torn,
    /// The group's replies, or a one-shot's output, exceeded the reply cap.
    #[error("reply too large")]
    TooLarge,
    /// The request can't be expressed as a safe command.
    #[error("bad request: {0}")]
    BadRequest(&'static str),
    /// tmux answered in a shape tether doesn't understand.
    #[error("unexpected reply from tmux")]
    BadReply,
    /// No tmux server is running on the endpoint, or not the instance a one-shot was
    /// for (a one-shot's answer).
    #[error("no tmux server running")]
    NoServer,
    /// A one-shot didn't finish within its timeout and was killed.
    #[error("tmux timed out")]
    Timeout,
    /// tmux couldn't be run.
    #[error("can't run tmux: {0}")]
    Spawn(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum SessionError {
    #[error("tmux {0} is older than 3.4")]
    TmuxTooOld(TmuxVersion),
    #[error("tmux control-client startup failed")]
    Startup,
    #[error("tmux sent a reply with no command pending")]
    UnexpectedReply,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_parse_and_gate_at_3_4() {
        let known = |text: &str| match TmuxVersion::parse(text) {
            TmuxVersion::Known {
                major,
                minor,
                letter,
            } => (major, minor, letter),
            other => panic!("{text}: {other:?}"),
        };
        assert_eq!(known("3.4"), (3, 4, None));
        assert_eq!(known("3.7b"), (3, 7, Some('b')));
        assert_eq!(known("next-3.6"), (3, 6, None));
        assert!(!TmuxVersion::parse("3.3a").is_supported());
        assert!(TmuxVersion::parse("3.4").is_supported());
        assert!(TmuxVersion::parse("10.0").is_supported());
        let odd = TmuxVersion::parse("master");
        assert_eq!(odd, TmuxVersion::Unrecognised("master".into()));
        assert!(odd.is_supported());
    }

    #[test]
    fn ids_round_trip_with_their_sigils() {
        assert_eq!(PaneId::parse(b"%12"), Some(PaneId(12)));
        assert_eq!(
            WindowId::parse(b"@3").map(|id| id.to_string()),
            Some("@3".into())
        );
        assert_eq!(
            SessionId::parse(b"$0").map(|id| id.to_string()),
            Some("$0".into())
        );
        assert_eq!(PaneId::parse(b"%"), None);
        assert_eq!(PaneId::parse(b"@1"), None);
        assert_eq!(PaneId::parse(b"%1x"), None);
    }
}
