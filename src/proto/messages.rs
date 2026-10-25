//! JSON messages (§5.3): adjacently tagged, `{"type": "<name>", "data": {...}}`,
//! camelCase. Optional fields and new message types need no version bump: unknown
//! fields are ignored, and `ClientMsg::decode` reports an unknown type rather than
//! failing.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use bytes::Bytes;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use ts_rs::TS;

/// A window on one run of a tmux server. `server` is `"<endpoint>:<pid>-<start_time>"`,
/// so a tab saved before a tmux restart never binds to the new server's `@N`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
pub struct WindowRef {
    pub server: String,
    /// `@N`.
    pub window: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionRef {
    pub server: String,
    /// `$N`.
    pub session: u32,
}

/// A terminal size; the daemon clamps what clients send (daemon-core.md §6).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Size {
    pub cols: u16,
    pub rows: u16,
}

/// Bytes carried in JSON as standard base64.
#[derive(Debug, Clone, PartialEq, Eq, Default, TS)]
#[ts(type = "string")]
pub struct Base64(pub Bytes);

impl Serialize for Base64 {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&STANDARD.encode(&self.0))
    }
}

impl<'de> Deserialize<'de> for Base64 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = <&str>::deserialize(deserializer)?;
        STANDARD
            .decode(text)
            .map(|bytes| Self(Bytes::from(bytes)))
            .map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    content = "data",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ClientMsg {
    Hello {
        protocol: u32,
        client: ClientInfo,
    },
    /// On the ping interval while connected; `t` comes back in `pong`.
    Ping {
        t: u64,
    },
    /// The tab came on screen. The id is the client's, never reused on a connection.
    Watch {
        watch: u32,
        window: WindowRef,
        size: Size,
        /// Automatic re-watches don't claim the window again.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        claim: Option<bool>,
    },
    /// The tab left the screen or closed.
    Unwatch {
        watch: u32,
    },
    /// Rotation or a font change.
    Resize {
        watch: u32,
        size: Size,
    },
    /// A fresh snapshot is needed (the renderer was recreated).
    Resync {
        watch: u32,
    },
    /// To the window's active pane, in order. Refused with `busy` before `watching`.
    Input {
        watch: u32,
        items: Vec<InputItem>,
    },
    /// Through `paste-buffer -p`, which brackets it if the pane asked for that.
    Paste {
        req: u32,
        watch: u32,
        text: String,
        /// Run Enter after the paste in the same tmux command group.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        enter: Option<bool>,
    },
    /// Scrollback rows by tmux line number (negative is history).
    History {
        req: u32,
        watch: u32,
        start: i32,
        end: i32,
    },
    ListSessions {
        req: u32,
    },
    NewWindow {
        req: u32,
        session: SessionRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        name: Option<String>,
        /// Absolute and a directory, checked by the connection (fs.md "Path
        /// resolution"); not checked against the file roots.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        dir: Option<String>,
    },
    NewSession {
        req: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        name: Option<String>,
        /// As `newWindow`'s.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        dir: Option<String>,
        /// A scratch shell (after the core MVP).
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        scratch: bool,
    },
    /// A type this daemon doesn't know; `decode` reports it and nothing else does.
    #[serde(other)]
    #[ts(skip)]
    Unknown,
}

/// What `ClientMsg::decode` made of one text frame.
#[derive(Debug, PartialEq, Eq)]
pub enum Decoded {
    Msg(ClientMsg),
    /// A newer client's message type: ignored, with a log.
    Unknown {
        kind: String,
    },
}

impl ClientMsg {
    /// Parses one text frame. A type this daemon doesn't know is `Unknown`, not an
    /// error; a known type with bad data, or text that isn't a message, is an error
    /// (a protocol violation, 4003).
    pub fn decode(text: &str) -> Result<Decoded, serde_json::Error> {
        let error = match serde_json::from_str(text) {
            Ok(Self::Unknown) => return Ok(Decoded::Unknown { kind: kind(text)? }),
            Ok(msg) => return Ok(Decoded::Msg(msg)),
            Err(error) => error,
        };
        // serde's catch-all variant only matches a type without data, so retry with
        // the data dropped to tell an unknown type from a known one gone wrong.
        let kind = kind(text)?;
        match serde_json::from_value(serde_json::json!({ "type": kind })) {
            Ok(Self::Unknown) => Ok(Decoded::Unknown { kind }),
            _ => Err(error),
        }
    }
}

fn kind(text: &str) -> Result<String, serde_json::Error> {
    #[derive(Deserialize)]
    struct Envelope {
        r#type: String,
    }
    serde_json::from_str::<Envelope>(text).map(|envelope| envelope.r#type)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ClientInfo {
    pub kind: ClientKind,
    pub build: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum ClientKind {
    Ios,
    Web,
}

/// One input item: text and bytes go to the pane as they are, a key by its tmux name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum InputItem {
    Text(String),
    Key(String),
    Bytes(Base64),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    content = "data",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ServerMsg {
    Welcome {
        protocol: u32,
        daemon: DaemonInfo,
        host: HostInfo,
    },
    /// The client's protocol is out of range; close 4001 follows.
    Incompatible {
        min: u32,
        max: u32,
        daemon_version: String,
    },
    Pong {
        t: u64,
    },
    /// The watch is bound; re-sent when its session, pane or cwd changes.
    Watching {
        watch: u32,
        window: WindowRef,
        session: SessionRef,
        pane: u32,
        /// Null until tmux first reports it.
        cwd: Option<String>,
    },
    /// The only way a watch ends from the daemon's side, apart from the closure
    /// broadcasts. Retryable: a tap sends a new `watch`.
    WatchEnded {
        watch: u32,
        reason: WatchEndReason,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        message: Option<String>,
    },
    /// Closes every tab on the window, watched or not.
    WindowClosed {
        window: WindowRef,
    },
    /// The session is gone. Closes no tab: its windows may have moved.
    SessionClosed {
        session: SessionRef,
    },
    /// Closes every tab on that server.
    ServerExited {
        server: String,
    },
    WindowRenamed {
        window: WindowRef,
        name: String,
    },
    /// The listing changed (sessions, or a window no watch is on closed or moved):
    /// refetch it if the sheet is open, and prune tabs against it.
    SessionsChanged,
    /// The session sheet; `tmux` is null when no tmux server is running.
    Sessions {
        req: u32,
        tmux: Option<TmuxListing>,
    },
    /// `capture-pane -e` bytes per physical row; `start` is the true tmux line number
    /// of `lines[0]`. May hold fewer rows than asked, or be empty above history.
    HistoryChunk {
        req: u32,
        watch: u32,
        start: i32,
        /// Retained row count at capture time; optional for protocol v1 compatibility.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        history_size: Option<u32>,
        lines: Vec<Base64>,
        /// Packed bits: line `i` wraps forward into line `i + 1`.
        wraps: Base64,
    },
    Created {
        req: u32,
        window: WindowRef,
        session: SessionRef,
    },
    /// tmux ran a paste and its optional Enter.
    Pasted {
        req: u32,
        watch: u32,
    },
    /// Refuses one request. A watch it names stays as it was.
    Error {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        req: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        watch: Option<u32>,
        code: ErrorCode,
        message: String,
    },
}

/// A `ServerMsg` as JSON text, encoded once by the hub. Its length is its charge
/// against the connection's credit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Encoded(String);

impl Encoded {
    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn into_string(self) -> String {
        self.0
    }
}

impl ServerMsg {
    pub fn encode(&self) -> Encoded {
        // These types hold only strings, numbers and lists, which always serialize.
        Encoded(serde_json::to_string(self).unwrap_or_default())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct DaemonInfo {
    pub version: String,
    pub completion: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct HostInfo {
    /// The persistent host id (auth.md).
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum WatchEndReason {
    /// Another tmux client detached tether's control client.
    Detached,
    Error,
    /// The memory tier's control-client cap is full.
    Limit,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TmuxListing {
    pub server: String,
    pub version: String,
    pub sessions: Vec<SessionListing>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SessionListing {
    /// `$N`.
    pub id: u32,
    pub name: String,
    pub windows: Vec<WindowListing>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WindowListing {
    /// `@N`.
    pub id: u32,
    pub index: u32,
    pub name: String,
    /// The session's current window.
    pub active: bool,
    /// Last activity, in unix seconds.
    pub activity: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    BadRequest,
    NoServer,
    TooManySessions,
    InputTooLarge,
    Busy,
    Tmux,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paste_messages_match_the_protocol_fixture() {
        // Rust serde round-trips only; web consumes the generated types, not this fixture.
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../tests/fixtures/proto/messages.json"))
                .expect("message fixtures are JSON");
        for value in fixture["client"].as_array().expect("client messages") {
            let msg: ClientMsg = serde_json::from_value(value.clone()).expect("client message");
            assert_eq!(
                serde_json::to_value(msg).expect("serialize client message"),
                *value
            );
        }
        for value in fixture["server"].as_array().expect("server messages") {
            let msg: ServerMsg = serde_json::from_value(value.clone()).expect("server message");
            assert_eq!(
                serde_json::to_value(msg).expect("serialize server message"),
                *value
            );
        }
        assert!(ClientMsg::decode(r#"{"type":"paste","data":{"watch":1,"text":"x"}}"#).is_err());
    }

    #[test]
    fn unknown_types_are_reported_and_bad_known_ones_fail() {
        let decode = ClientMsg::decode;
        assert_eq!(
            decode(r#"{"type":"zap","data":{"a":1}}"#).ok(),
            Some(Decoded::Unknown { kind: "zap".into() })
        );
        assert_eq!(
            decode(r#"{"type":"zap"}"#).ok(),
            Some(Decoded::Unknown { kind: "zap".into() })
        );
        assert!(decode(r#"{"type":"watch","data":{"watch":"x"}}"#).is_err());
        assert!(decode(r#"{"data":{}}"#).is_err());
        assert_eq!(
            decode(r#"{"type":"input","data":{"watch":1,"items":[{"text":"a"},{"bytes":"AAE="},{"key":"Enter"}],"later":0}}"#).ok(),
            Some(Decoded::Msg(ClientMsg::Input {
                watch: 1,
                items: vec![
                    InputItem::Text("a".into()),
                    InputItem::Bytes(Base64(Bytes::from_static(&[0, 1]))),
                    InputItem::Key("Enter".into()),
                ],
            }))
        );
    }
}
