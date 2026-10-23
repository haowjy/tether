//! What tmux prints for tether's formats, each format beside the parser of its rows
//! (daemon-core.md §3.4, §3.8). `command.rs` puts the formats in commands; `session.rs`
//! and `oneshot.rs` parse the answers. The snapshot's `STATE_FORMAT` lives with its
//! parser in `snapshot.rs`.

use std::collections::BTreeSet;

use super::{
    Created, Found, ListedSession, ListedWindow, Listing, Location, PaneId, ServerInstance,
    SessionId, SessionLocation, Size, TmuxVersion, WindowId,
};

/// The control client's first reply: version, server instance, and the size of the
/// session's current window.
pub(super) const STARTUP_FORMAT: &str =
    "#{version}\t#{pid}\t#{start_time}\t#{window_width}\t#{window_height}";

pub(super) fn startup(row: &[u8]) -> Option<(TmuxVersion, ServerInstance, Size)> {
    let [version, pid, start_time, cols, rows] = tab_fields(row)?[..] else {
        return None;
    };
    Some((
        TmuxVersion::parse(version),
        ServerInstance::from_fields(pid, start_time)?,
        size(cols, rows)?,
    ))
}

/// Where a window is: server instance, then its session, active pane and that pane's
/// size and session name. tmux leaves the target fields empty for a window that is
/// gone.
pub(super) const LOCATE_FORMAT: &str = "#{pid}\t#{start_time}\t#{session_id}\t#{window_id}\t#{pane_id}\t#{pane_width}\t#{pane_height}\t#{session_name}";

pub(super) fn location(row: &[u8]) -> Option<Location> {
    let [
        pid,
        start_time,
        session,
        _window,
        pane,
        cols,
        rows,
        session_name,
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
            pane: PaneId::parse(pane.as_bytes())?,
            size: size(cols, rows)?,
            session_name: session_name.to_owned(),
        }),
    })
}

/// Server instance and session id, the id empty for a session that is gone.
pub(super) const LOCATE_SESSION_FORMAT: &str = "#{pid}\t#{start_time}\t#{session_id}";

pub(super) fn session_location(row: &[u8]) -> Option<SessionLocation> {
    let [pid, start_time, session] = tab_fields(row)?[..] else {
        return None;
    };
    Some(SessionLocation {
        server: ServerInstance::from_fields(pid, start_time)?,
        exists: !session.is_empty(),
    })
}

/// The listing's first line.
pub(super) const LISTING_SERVER_FORMAT: &str = "#{version}\t#{pid}\t#{start_time}";
/// One line per client: its session and whether it is a control client.
pub(super) const LISTING_CLIENT_FORMAT: &str = "#{session_id}\t#{client_control_mode}";
/// One line per window. A window name can hold a tab, so it goes last; a session name
/// can't (tmux escapes it).
pub(super) const LISTING_WINDOW_FORMAT: &str = "#{session_id}\t#{window_id}\t#{window_index}\t#{window_active}\t#{window_activity}\t#{session_name}\t#{window_name}";

/// The server line, then a line per client, then a line per window, sessions in order
/// (`command::oneshot`). A line that fits neither shape comes from a window name with a
/// line break in it, and is skipped.
pub(super) fn listing(stdout: &[u8]) -> Option<Listing> {
    let text = String::from_utf8_lossy(stdout);
    let mut lines = text.split('\n');
    let [version, pid, start_time] = lines.next()?.split('\t').collect::<Vec<_>>()[..] else {
        return None;
    };
    let mut listing = Listing {
        server: ServerInstance::from_fields(pid, start_time)?,
        version: TmuxVersion::parse(version),
        sessions: Vec::new(),
    };
    let mut attached = BTreeSet::new();
    for line in lines {
        match line.splitn(7, '\t').collect::<Vec<_>>()[..] {
            [session, "0"] if listing.sessions.is_empty() => {
                attached.extend(SessionId::parse(session.as_bytes()));
            }
            [session, window, index, active, activity, session_name, name] => {
                let (Some(session), Some(id), Ok(index), Ok(activity)) = (
                    SessionId::parse(session.as_bytes()),
                    WindowId::parse(window.as_bytes()),
                    index.parse(),
                    activity.parse(),
                ) else {
                    continue;
                };
                if listing
                    .sessions
                    .last()
                    .is_none_or(|last| last.id != session)
                {
                    listing.sessions.push(ListedSession {
                        id: session,
                        name: session_name.to_owned(),
                        attached_elsewhere: attached.contains(&session),
                        windows: Vec::new(),
                    });
                }
                if let Some(last) = listing.sessions.last_mut() {
                    last.windows.push(ListedWindow {
                        id,
                        index,
                        name: name.to_owned(),
                        active: active == "1",
                        activity,
                    });
                }
            }
            _ => {}
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
