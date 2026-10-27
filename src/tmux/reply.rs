//! What tmux prints for tether's formats, each format beside the parser of its rows
//! (daemon-core.md §3.4, §3.8). `command.rs` puts the formats in commands; `session.rs`
//! and `oneshot.rs` parse the answers. The snapshot's `STATE_FORMAT` lives with its
//! parser in `snapshot.rs`.

use super::{
    Bell, Created, Found, ListedSession, ListedWindow, Listing, Location, PaneId, ServerInstance,
    SessionId, Size, TmuxVersion, WindowId,
};

/// The control client's first reply: version, server instance, and the size of the
/// session's current window.
pub(super) const STARTUP_FORMAT: &str =
    "#{version}\t#{pid}\t#{start_time}\t#{window_width}\t#{window_height}\t#{client_name}";

pub(super) fn startup(row: &[u8]) -> Option<(TmuxVersion, ServerInstance, Size, String)> {
    let [version, pid, start_time, cols, rows, client_name] = tab_fields(row)?[..] else {
        return None;
    };
    Some((
        TmuxVersion::parse(version),
        ServerInstance::from_fields(pid, start_time)?,
        size(cols, rows)?,
        (!client_name.is_empty()).then(|| client_name.to_owned())?,
    ))
}

/// A session's current window. tmux leaves the target fields empty when it is gone.
pub(super) const LOCATE_FORMAT: &str = "#{pid}\t#{start_time}\t#{session_id}\t#{window_id}\t#{window_index}\t#{pane_id}\t#{pane_width}\t#{pane_height}\t#{window_width}\t#{window_height}\t#{session_name}\t#{window_name}";

pub(super) fn location(row: &[u8]) -> Option<Location> {
    let [
        pid,
        start_time,
        session,
        window,
        index,
        pane,
        cols,
        rows,
        window_cols,
        window_rows,
        session_name,
        name,
    ] = tab_fields(row)?[..]
    else {
        return None;
    };
    let server = ServerInstance::from_fields(pid, start_time)?;
    if session.is_empty() {
        return Some(Location {
            server,
            found: None,
        });
    }
    Some(Location {
        server,
        found: Some(Found {
            session: SessionId::parse(session.as_bytes())?,
            window: WindowId::parse(window.as_bytes())?,
            index: index.parse().ok()?,
            pane: PaneId::parse(pane.as_bytes())?,
            size: size(cols, rows)?,
            window_size: size(window_cols, window_rows)?,
            name: name.to_owned(),
            session_name: session_name.to_owned(),
        }),
    })
}

/// The listing's first line.
pub(super) const LISTING_SERVER_FORMAT: &str = "#{version}\t#{pid}\t#{start_time}";
/// The server-global `alert-bell` entry tether owns (daemon-core.md §4.8).
pub(super) const BELL_HOOK_INDEX: u32 = 9100;
/// True while nothing is at tether's index.
pub(super) const BELL_EMPTY: &str = "#{==:#{alert-bell[9100]},}";
/// True while the entry at tether's index starts with tether's hook text, whatever
/// build wrote it. A session resolves the entry, so a session-level `alert-bell` hook
/// (which shadows the global array) breaks it.
pub(super) const BELL_OURS: &str = "#{m:set-option -F @tether-bell*,#{alert-bell[9100]}}";

/// One line per window, and no field can hold a line break: the ids and numbers are
/// tmux's own, `@tether-bell` goes through arithmetic (a user can set it to any text),
/// tmux refuses a line break in a session name on 3.8 and stores it escaped on 3.4,
/// and the window name, which 3.4 lets `-n` store raw, prints a line break as `\n`
/// (`#{s/<LF>/\\n/:…}`; the argv holds a literal line feed). The name goes last
/// because it can still hold a tab. The sixth field is the session's bell counter,
/// the seventh whether this window's bells reach the hook: tmux's own verdict on what
/// `list` can't see from outside (§4.8).
pub(super) fn listing_window_format() -> String {
    format!(
        "#{{session_id}}\t#{{window_id}}\t#{{window_index}}\t#{{window_active}}\t#{{window_activity}}\t\
         #{{e|+:#{{@tether-bell}},0}}\t\
         #{{&&:#{{&&:{BELL_OURS},#{{monitor-bell}}}},#{{==:#{{bell-action}},any}}}}\t\
         #{{session_name}}\t#{{s/\n/\\\\n/:window_name}}"
    )
}

/// The server line, then a line per window, sessions in order (`command::oneshot`).
/// Every line is a record; one that doesn't parse makes the whole reply bad.
pub(super) fn listing(stdout: &[u8]) -> Option<Listing> {
    let text = std::str::from_utf8(stdout).ok()?;
    let mut lines = text.strip_suffix('\n')?.split('\n');
    let [version, pid, start_time] = lines.next()?.split('\t').collect::<Vec<_>>()[..] else {
        return None;
    };
    let mut listing = Listing {
        server: ServerInstance::from_fields(pid, start_time)?,
        version: TmuxVersion::parse(version),
        sessions: Vec::new(),
    };
    for line in lines {
        let [
            session,
            window,
            index,
            active,
            activity,
            mark,
            covered,
            session_name,
            name,
        ] = line.splitn(9, '\t').collect::<Vec<_>>()[..]
        else {
            return None;
        };
        let session = SessionId::parse(session.as_bytes())?;
        let window = ListedWindow {
            id: WindowId::parse(window.as_bytes())?,
            index: index.parse().ok()?,
            name: name.to_owned(),
            active: active == "1",
            activity: activity.parse().ok()?,
        };
        let covered = covered == "1";
        match listing.sessions.last_mut() {
            Some(last) if last.id == session => {
                last.bell.covered &= covered;
                last.windows.push(window);
            }
            _ => listing.sessions.push(ListedSession {
                id: session,
                name: session_name.to_owned(),
                // The arithmetic leaves a number, or nothing for text a user set.
                bell: Bell {
                    mark: mark.parse().unwrap_or(0),
                    covered,
                },
                windows: vec![window],
            }),
        }
    }
    Some(listing)
}

/// A created window, with the server instance that names it.
pub(super) const CREATED_FORMAT: &str = "#{pid}\t#{start_time}\t#{session_id}\t#{window_id}";

pub(super) fn created(row: &[u8]) -> Option<Created> {
    let [pid, start_time, session, window] = tab_fields(row)?[..] else {
        return None;
    };
    Some(Created {
        server: ServerInstance::from_fields(pid, start_time)?,
        session: SessionId::parse(session.as_bytes())?,
        window: WindowId::parse(window.as_bytes())?,
    })
}

fn tab_fields(row: &[u8]) -> Option<Vec<&str>> {
    Some(std::str::from_utf8(row).ok()?.split('\t').collect())
}

fn size(cols: &str, rows: &str) -> Option<Size> {
    Some(Size {
        cols: cols.parse().ok()?,
        rows: rows.parse().ok()?,
    })
}
