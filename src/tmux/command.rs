//! Typed command builders (daemon-core.md §3.4, §3.8): lines for a control client and
//! arguments for `tmux` itself. Nothing else writes tmux commands, and none of them
//! waits: a waiting command would stall every later reply.

use std::fmt::Write as _;
use std::path::Path;

use super::history::STATE_FORMAT as HISTORY_STATE_FORMAT;
use super::reply::{
    CREATED_FORMAT, LISTING_CLIENT_FORMAT, LISTING_SERVER_FORMAT, LISTING_WINDOW_FORMAT,
    LOCATE_FORMAT, LOCATE_SESSION_FORMAT, STARTUP_FORMAT,
};
use super::snapshot::STATE_FORMAT;
use super::{
    InputItem, OneShotCmd, Op, PaneId, ServerInstance, SessionId, Size, Tag, TmuxError, WindowId,
};

/// One line for a control client: commands joined by ` ; `, answered by one reply
/// block per command that runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Group {
    pub line: String,
    pub commands: usize,
}

impl Group {
    fn of(commands: &[String]) -> Self {
        Self {
            line: commands.join(" ; "),
            commands: commands.len(),
        }
    }

    fn one(command: String) -> Self {
        Self {
            line: command,
            commands: 1,
        }
    }
}

/// Bytes per `send-keys -H` command.
const HEX_CHUNK: usize = 512;

/// Not a tmux command: `only_on`'s branch, which fails to parse. tmux names it in its
/// error, which is how `oneshot` tells this failure from others.
pub(super) const SERVER_CHANGED: &str = "tether-server-changed";

/// The control client's first line (`reply::STARTUP_FORMAT`).
pub fn startup() -> Group {
    Group::one(format!("display-message -p '{STARTUP_FORMAT}'"))
}

/// Sets the client size. It takes no format, so it can't share the startup line.
pub fn client_size(size: Size) -> Group {
    Group::one(format!("refresh-client -C {}x{}", size.cols, size.rows))
}

/// Pauses a pane for this client only. Never `off`: it crashes tmux 3.2a–3.6b when
/// output is queued.
pub fn pause(pane: PaneId) -> Group {
    Group::one(format!("refresh-client -A '{pane}:pause'"))
}

/// The atomic snapshot list (§3.5). `continue` goes first. The state is read before
/// the captures and again after them: a hook run between two commands can change the
/// pane without printing, and two different reads show it. The paired active-grid
/// captures provide wraps; the saved grid stays a visual-only restore. The alternate
/// capture has `-q`, so a pane without one doesn't abort the list.
pub fn snapshot(pane: PaneId) -> Group {
    let state = format!("display-message -p -t {pane} '{STATE_FORMAT}'");
    Group::of(&[
        format!("refresh-client -A '{pane}:continue'"),
        state.clone(),
        format!("capture-pane -p -e -N -t {pane}"),
        format!("capture-pane -p -N -T -t {pane}"),
        format!("capture-pane -p -J -t {pane}"),
        format!("capture-pane -p -P -C -t {pane}"),
        format!("capture-pane -p -e -N -a -q -t {pane}"),
        state,
    ])
}

/// The line for a hub op. `tag` names the paste buffer, so concurrent pastes on
/// different control clients can't collide.
pub fn op(op: &Op, tag: Tag) -> Result<Group, TmuxError> {
    Ok(match op {
        Op::Locate { window } => locate(*window),
        Op::LocateSession { session } => locate_session(*session),
        Op::Snapshot { pane } => snapshot(*pane),
        Op::Release { pane } => pause(*pane),
        Op::Vote { window, size } => Group::one(format!(
            "refresh-client -C '{window}:{}x{}'",
            size.cols, size.rows
        )),
        Op::ClearVote { window } => Group::one(format!("refresh-client -C '{window}:'")),
        Op::Subscribe { window } => Group::one(format!(
            "refresh-client -B '{}:{window}:#{{pane_current_path}}'",
            subscription_name(*window)
        )),
        Op::Unsubscribe { window } => Group::one(format!(
            "refresh-client -B '{}'",
            subscription_name(*window)
        )),
        Op::History { pane, start, end } => history(*pane, *start, *end)?,
        Op::Input { window, items } => input(*window, items)?,
        Op::Paste {
            window,
            path,
            enter,
        } => {
            let path = path
                .to_str()
                .ok_or(TmuxError::BadRequest("paste path is not UTF-8"))?;
            let path = quote(path)?;
            let buffer = paste_buffer(tag);
            // `-d` deletes the buffer only when the paste succeeds; after a failure
            // the session sends `delete_paste_buffer`.
            let mut commands = Vec::new();
            if *enter {
                // Enter would otherwise be handled by copy mode instead of the pane's program.
                commands.push(format!("copy-mode -q -t {window}"));
            }
            commands.extend([
                format!("load-buffer -b {buffer} {path}"),
                format!("paste-buffer -p -d -b {buffer} -t {window}"),
            ]);
            if *enter {
                commands.push(format!("send-keys -t {window} Enter"));
            }
            Group::of(&commands)
        }
    })
}

/// Brackets a history capture with the values that define tmux's line-number range.
/// The history size changes when output scrolls its top; the pane height changes the
/// last visible line. One command list makes the pair a tear check for this capture.
fn history(pane: PaneId, start: i32, end: i32) -> Result<Group, TmuxError> {
    if end < start {
        return Err(TmuxError::BadRequest("history end is before its start"));
    }
    let state = format!("display-message -p -t {pane} '{HISTORY_STATE_FORMAT}'");
    let wrap_end = end.saturating_add(1);
    Ok(Group::of(&[
        state.clone(),
        format!("capture-pane -p -e -N -T -t {pane} -S {start} -E {wrap_end}"),
        format!("capture-pane -p -J -t {pane} -S {start} -E {wrap_end}"),
        state,
    ]))
}

/// Deletes what a failed paste left in tmux's buffers. Commands after a failure in a
/// list never run, so this is a group of its own; it fails harmlessly when no buffer
/// was made.
pub fn delete_paste_buffer(tag: Tag) -> Group {
    Group::one(format!("delete-buffer -b {}", paste_buffer(tag)))
}

fn paste_buffer(tag: Tag) -> String {
    format!("tether-{}", tag.0)
}

/// `w<W>`: the subscription that reports window `@W`'s active pane's cwd.
pub fn subscription_name(window: WindowId) -> String {
    format!("w{}", window.0)
}

fn locate(window: WindowId) -> Group {
    Group::one(format!("display-message -p -t {window} '{LOCATE_FORMAT}'"))
}

fn locate_session(session: SessionId) -> Group {
    Group::one(format!(
        "display-message -p -t '{session}' '{LOCATE_SESSION_FORMAT}'"
    ))
}

/// A control client's arguments after `tmux -u -N <socket>` (§3.1). `pause-after`
/// bounds what tmux queues for a client that falls behind.
pub fn attach(session: SessionId) -> Vec<String> {
    let session = session.to_string();
    owned(&[
        "-C",
        "attach-session",
        "-t",
        &session,
        "-f",
        "pause-after=3",
    ])
}

/// A one-shot's arguments after `tmux -u -N <socket>` (§3.8). tmux takes each
/// argument as it is, with no quoting, except that one ending in `;` ends a command.
pub fn oneshot(cmd: &OneShotCmd) -> Result<Vec<String>, TmuxError> {
    Ok(match cmd {
        // Clients before windows: a window name with a line break in it can then only
        // garble window lines.
        OneShotCmd::List => owned(&[
            "display-message",
            "-p",
            LISTING_SERVER_FORMAT,
            ";",
            "list-clients",
            "-F",
            LISTING_CLIENT_FORMAT,
            ";",
            "list-windows",
            "-a",
            "-F",
            LISTING_WINDOW_FORMAT,
        ]),
        OneShotCmd::Locate { window } => owned(&[
            "display-message",
            "-p",
            "-t",
            &window.to_string(),
            LOCATE_FORMAT,
        ]),
        OneShotCmd::LocateSession { session } => owned(&[
            "display-message",
            "-p",
            "-t",
            &session.to_string(),
            LOCATE_SESSION_FORMAT,
        ]),
        OneShotCmd::NewWindow {
            server,
            session,
            name,
            dir,
        } => {
            let mut args = only_on(*server);
            args.extend(owned(&["new-window", "-d", "-t", &session.to_string()]));
            named(&mut args, "-n", name.as_deref())?;
            named(&mut args, "-c", dir.as_deref().map(path).transpose()?)?;
            args.extend(owned(&["-P", "-F", CREATED_FORMAT]));
            args
        }
        OneShotCmd::NewSession { name, dir } => {
            let mut args = owned(&["new-session", "-d"]);
            named(&mut args, "-s", name.as_deref())?;
            named(&mut args, "-c", dir.as_deref().map(path).transpose()?)?;
            args.extend(owned(&["-P", "-F", CREATED_FORMAT]));
            args
        }
    })
}

/// A first command that stops the rest of a one-shot's list unless the server is
/// `server`. On another instance `if-shell` takes its branch, which fails to parse, so
/// `if-shell` itself fails, and tmux skips the commands after a failure in a list.
fn only_on(server: ServerInstance) -> Vec<String> {
    let other = format!("#{{!=:#{{pid}}-#{{start_time}},{server}}}");
    owned(&["if-shell", "-F", &other, SERVER_CHANGED, ";"])
}

fn owned(args: &[&str]) -> Vec<String> {
    args.iter().map(|arg| (*arg).to_owned()).collect()
}

fn path(path: &Path) -> Result<&str, TmuxError> {
    path.to_str()
        .ok_or(TmuxError::BadRequest("directory is not UTF-8"))
}

/// Adds `flag value` for a user's value (`literal`), with a final `;` sent as `\;`,
/// which tmux reads back as `;` rather than the end of the command.
fn named(args: &mut Vec<String>, flag: &str, value: Option<&str>) -> Result<(), TmuxError> {
    let Some(value) = value else {
        return Ok(());
    };
    let mut value = literal(value)?;
    if value.ends_with(';') {
        value.insert(value.len() - 1, '\\');
    }
    args.extend([flag.to_owned(), value]);
    Ok(())
}

/// Text and bytes go as `-H` hex (no quoting, any byte, never a key name); keys go by
/// name so tmux encodes them for the pane's modes. Targets the window, so tmux
/// resolves its active pane and keys can't race an active-pane change.
fn input(window: WindowId, items: &[InputItem]) -> Result<Group, TmuxError> {
    let mut commands = Vec::new();
    let mut bytes = Vec::new();
    for item in items {
        match item {
            InputItem::Text(text) => bytes.extend_from_slice(text.as_bytes()),
            InputItem::Bytes(raw) => bytes.extend_from_slice(raw),
            InputItem::Key(name) => {
                if !is_key_name(name) {
                    return Err(TmuxError::BadRequest("unknown key name"));
                }
                hex_commands(window, &std::mem::take(&mut bytes), &mut commands);
                commands.push(format!("send-keys -t {window} {name}"));
            }
        }
    }
    hex_commands(window, &bytes, &mut commands);
    if commands.is_empty() {
        return Err(TmuxError::BadRequest("empty input"));
    }
    Ok(Group::of(&commands))
}

fn hex_commands(window: WindowId, bytes: &[u8], commands: &mut Vec<String>) {
    for chunk in bytes.chunks(HEX_CHUNK) {
        let mut command = format!("send-keys -t {window} -H");
        for byte in chunk {
            let _ = write!(command, " {byte:02x}");
        }
        commands.push(command);
    }
}

/// A user argument for tmux's parser (`literal`), wrapped in single quotes with `'` as
/// `'\''`.
pub fn quote(argument: &str) -> Result<String, TmuxError> {
    Ok(format!("'{}'", literal(argument)?.replace('\'', "'\\''")))
}

/// A user's text that tmux must take as it is: `#` doubled, since tmux
/// format-expands names, directories and `load-buffer`'s path. Control characters
/// can't be expressed on one line and are refused.
fn literal(text: &str) -> Result<String, TmuxError> {
    if text.chars().any(char::is_control) {
        return Err(TmuxError::BadRequest("control character in argument"));
    }
    Ok(text.replace('#', "##"))
}

/// The key-name allowlist:
/// `^(?:[CM]-)*(?:(?:S-)?(?:Up|Down|Left|Right|Home|End|PageUp|PageDown|IC|DC|F(?:[1-9]|1[0-2]))|[A-Za-z0-9]|Enter|Escape|Tab|BTab|BSpace|Space)$`.
/// `S-Enter` is out: tmux 3.4 types it as literal text.
pub fn is_key_name(name: &str) -> bool {
    let mut key = name;
    while let Some(rest) = key.strip_prefix("C-").or_else(|| key.strip_prefix("M-")) {
        key = rest;
    }
    const NAMED: [&str; 6] = ["Enter", "Escape", "Tab", "BTab", "BSpace", "Space"];
    const SHIFTABLE: [&str; 10] = [
        "Up", "Down", "Left", "Right", "Home", "End", "PageUp", "PageDown", "IC", "DC",
    ];
    if NAMED.contains(&key) || (key.len() == 1 && key.as_bytes()[0].is_ascii_alphanumeric()) {
        return true;
    }
    let key = key.strip_prefix("S-").unwrap_or(key);
    let function_key =
        |number: &str| matches!(number.as_bytes(), [b'1'..=b'9'] | [b'1', b'0'..=b'2']);
    SHIFTABLE.contains(&key) || key.strip_prefix('F').is_some_and(function_key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_key_name_the_clients_send_is_allowed() {
        let fixture = include_str!("../../tests/fixtures/proto/keys.json");
        let keys: Vec<String> = serde_json::from_str(fixture).expect("keys.json is a string array");
        assert!(!keys.is_empty());
        for key in keys {
            assert!(is_key_name(&key), "{key} is not an allowed key name");
        }
    }

    #[test]
    fn key_names_outside_the_allowlist_are_refused() {
        for key in [
            "", "S-Enter", "S-a", "S-C-Up", "C-", "F0", "F13", "F01", "F+1", "ab", "enter",
            "Enter;", "C-Enter ", "-", ";", "Up Down", "C-é", "M-S-Tab",
        ] {
            assert!(!is_key_name(key), "{key:?} should be refused");
        }
        for key in [
            "C-S-Up",
            "M-C-x",
            "S-F12",
            "C-M-BSpace",
            "F10",
            "IC",
            "S-DC",
            "7",
        ] {
            assert!(is_key_name(key), "{key:?} should be allowed");
        }
    }

    #[test]
    fn quoting_neutralises_tmux_syntax() {
        assert_eq!(
            quote("we ird'#{pane_id}$HOME;~").as_deref(),
            Ok("'we ird'\\''##{pane_id}$HOME;~'")
        );
        assert!(quote("a\nb").is_err());
        assert!(quote("a\tb").is_err());
    }

    #[test]
    fn input_splits_hex_and_keeps_item_order() {
        let items = [
            InputItem::Text("ab".into()),
            InputItem::Key("C-b".into()),
            InputItem::Bytes(bytes::Bytes::from(vec![0xff; HEX_CHUNK + 1])),
            InputItem::Key("Enter".into()),
        ];
        let group = input(WindowId(3), &items).expect("valid input");
        let commands: Vec<&str> = group.line.split(" ; ").collect();
        assert_eq!(group.commands, commands.len());
        assert_eq!(commands[0], "send-keys -t @3 -H 61 62");
        assert_eq!(commands[1], "send-keys -t @3 C-b");
        assert_eq!(commands[2].matches(" ff").count(), HEX_CHUNK);
        assert_eq!(commands[3], "send-keys -t @3 -H ff");
        assert_eq!(commands[4], "send-keys -t @3 Enter");
        assert!(input(WindowId(3), &[InputItem::Key("S-Enter".into())]).is_err());
        assert!(input(WindowId(3), &[]).is_err());
    }
}
