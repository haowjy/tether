//! The control-client protocol as a pure state machine (daemon-core.md §3.3): bytes
//! and requests in, events and command lines out. No I/O, no clock.

use std::collections::{BTreeSet, VecDeque};

use bytes::Bytes;

use super::command::{self, Group};
use super::parse::{Line, Notification, NotificationKind, Parser};
use super::snapshot::{self, Rows};
use super::{
    Event, Found, Location, Op, PaneId, Reply, ServerInstance, SessionError, SessionId,
    SessionLocation, Size, Tag, TmuxError, TmuxVersion, WindowId, layout,
};

/// Groups written and not yet answered, at most. The pump's line channel is this deep.
pub const MAX_IN_FLIGHT: usize = 32;
/// Reply bytes one group may hold; past it the group fails `TooLarge`.
pub const MAX_REPLY: usize = 1024 * 1024;
/// Sends of one snapshot list before it fails `Torn`.
const SNAPSHOT_ATTEMPTS: u8 = 3;

/// What one call produced: events for the hub, lines for the pump, both in order.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Step {
    pub events: Vec<Event>,
    pub lines: Vec<String>,
}

pub struct Session {
    parser: Parser,
    phase: Phase,
    pending: VecDeque<Pending>,
    block: Block,
    wanted: BTreeSet<PaneId>,
    /// Panes this client paused or tmux paused while unwanted: their output is
    /// dropped without pausing again. Holds only panes that printed while unwanted.
    paused: BTreeSet<PaneId>,
    /// Pauses waiting for room under `MAX_IN_FLIGHT`.
    deferred_pauses: VecDeque<PaneId>,
    exit_seen: bool,
}

/// The reply block open in the stream, if any.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Block {
    None,
    /// A reply to the oldest pending group.
    Ours,
    /// The attach reply or a hook's output.
    Theirs,
}

enum Phase {
    Starting,
    SizingClient {
        server: ServerInstance,
        version: TmuxVersion,
    },
    Ready,
    /// Reported `Fatal`; everything after is ignored.
    Dead,
}

struct Pending {
    purpose: Purpose,
    commands: usize,
    /// Reply bodies so far; while a block is open, the last one is being filled.
    replies: Vec<Rows>,
    bytes: usize,
    too_large: bool,
    torn: bool,
}

/// How a group ended.
struct Outcome {
    replies: Vec<Rows>,
    /// `%error`'s message.
    failure: Option<String>,
    too_large: bool,
    torn: bool,
}

enum Purpose {
    Startup,
    ClientSize,
    /// This session's own pause of an unwanted pane.
    Pause,
    Request {
        tag: Tag,
        request: Request,
    },
}

enum Request {
    Locate,
    LocateSession,
    Snapshot {
        pane: PaneId,
        group: Group,
        attempt: u8,
    },
    History,
    Plain,
}

impl Session {
    /// A session for a freshly attached control client, and its startup line.
    pub fn new() -> (Self, Step) {
        let mut this = Self {
            parser: Parser::default(),
            phase: Phase::Starting,
            pending: VecDeque::new(),
            block: Block::None,
            wanted: BTreeSet::new(),
            paused: BTreeSet::new(),
            deferred_pauses: VecDeque::new(),
            exit_seen: false,
        };
        let mut step = Step::default();
        this.send(command::startup(), Purpose::Startup, &mut step);
        (this, step)
    }

    /// Groups written and not yet answered.
    pub fn in_flight(&self) -> usize {
        self.pending.len()
    }

    /// Panes this client wants output from: each `Snapshot` until its `Release`.
    pub fn wanted(&self) -> impl Iterator<Item = PaneId> + '_ {
        self.wanted.iter().copied()
    }

    /// Whether tmux said `%exit`. A client that ends without it crashed or was killed;
    /// with it, it was detached, or its session or server ended.
    pub fn exit_seen(&self) -> bool {
        self.exit_seen
    }

    /// Bytes from the control client's stdout, in order.
    pub fn feed(&mut self, bytes: &[u8]) -> Step {
        let mut step = Step::default();
        if matches!(self.phase, Phase::Dead) {
            return step;
        }
        let mut lines = Vec::new();
        self.parser.push(bytes, &mut lines);
        for line in lines {
            self.line(line, &mut step);
            if matches!(self.phase, Phase::Dead) {
                break;
            }
        }
        step
    }

    /// Runs `op`. The caller keeps `in_flight()` under `MAX_IN_FLIGHT`.
    pub fn request(&mut self, tag: Tag, op: Op) -> Step {
        let mut step = Step::default();
        if matches!(self.phase, Phase::Dead) {
            return step;
        }
        debug_assert!(self.pending.len() < MAX_IN_FLIGHT, "request over capacity");
        let group = match command::op(&op, tag) {
            Ok(group) => group,
            Err(error) => {
                step.events.push(Event::Done {
                    tag,
                    result: Err(error),
                });
                return step;
            }
        };
        let request = match op {
            Op::Locate { .. } => Request::Locate,
            Op::LocateSession { .. } => Request::LocateSession,
            Op::Snapshot { pane } => {
                self.wanted.insert(pane);
                self.paused.remove(&pane);
                self.deferred_pauses.retain(|deferred| *deferred != pane);
                Request::Snapshot {
                    pane,
                    group: group.clone(),
                    attempt: 1,
                }
            }
            Op::Release { pane } => {
                self.wanted.remove(&pane);
                self.paused.insert(pane);
                self.deferred_pauses.retain(|deferred| *deferred != pane);
                Request::Plain
            }
            Op::History { .. } => Request::History,
            Op::Vote { .. }
            | Op::ClearVote { .. }
            | Op::Subscribe { .. }
            | Op::Unsubscribe { .. }
            | Op::Input { .. }
            | Op::Paste { .. } => Request::Plain,
        };
        self.send(group, Purpose::Request { tag, request }, &mut step);
        step
    }

    fn send(&mut self, group: Group, purpose: Purpose, step: &mut Step) {
        self.pending.push_back(Pending {
            purpose,
            commands: group.commands,
            replies: Vec::with_capacity(group.commands),
            bytes: 0,
            too_large: false,
            torn: false,
        });
        step.lines.push(group.line);
    }

    fn line(&mut self, line: Line, step: &mut Step) {
        match line {
            Line::Begin { flag: 1 } => match self.pending.front_mut() {
                Some(front) => {
                    front.replies.push(Vec::new());
                    self.block = Block::Ours;
                }
                None => self.fatal(SessionError::UnexpectedReply, step),
            },
            Line::Begin { .. } => self.block = Block::Theirs,
            Line::Body(row) => {
                if let (Block::Ours, Some(front)) = (self.block, self.pending.front_mut()) {
                    front.add_row(row);
                }
            }
            Line::TooLong => {
                if let (Block::Ours, Some(front)) = (self.block, self.pending.front_mut()) {
                    front.overflow();
                }
            }
            Line::End { error } => {
                if std::mem::replace(&mut self.block, Block::None) == Block::Ours {
                    self.reply_ended(error, step);
                }
            }
            Line::Output { pane, data } => self.output(pane, data, step),
            Line::Notification(notification) => self.notification(notification, step),
            Line::Unknown { .. } => {}
        }
    }

    fn output(&mut self, pane: PaneId, data: Bytes, step: &mut Step) {
        // Between a snapshot's first and last reply, its pane's output is outside both
        // the capture and the live stream: a waiting hook let tmux read the pane.
        if let Some(front) = self.pending.front_mut() {
            if !front.replies.is_empty() && front.snapshot_pane() == Some(pane) {
                front.torn = true;
            }
        }
        if self.wanted.contains(&pane) {
            step.events.push(Event::Output { pane, bytes: data });
        } else if self.paused.insert(pane) {
            if self.pending.len() < MAX_IN_FLIGHT {
                self.send(command::pause(pane), Purpose::Pause, step);
            } else {
                self.deferred_pauses.push_back(pane);
            }
        }
    }

    fn notification(&mut self, notification: Notification, step: &mut Step) {
        let args = &notification.args[..];
        let mut fields = args.splitn(2, |byte| *byte == b' ');
        let first = fields.next().unwrap_or_default();
        let rest = fields.next().unwrap_or_default();
        let event = match notification.kind {
            NotificationKind::Pause => {
                let Some(pane) = PaneId::parse(first) else {
                    return;
                };
                // On 3.4 a pause tether asked for is inside its reply block, so a
                // top-level one is tmux's own: pause-after dropped queued output.
                if self.wanted.contains(&pane) {
                    Event::Gap { pane }
                } else {
                    self.paused.insert(pane);
                    self.deferred_pauses.retain(|deferred| *deferred != pane);
                    return;
                }
            }
            NotificationKind::Continue => return,
            NotificationKind::LayoutChange => {
                let Some(window) = WindowId::parse(first) else {
                    return;
                };
                // `layout visible_layout flags`: the visible layout has the sizes the
                // panes really have, a zoomed pane at full size.
                let mut layouts = rest.split(|byte| *byte == b' ');
                let window_layout = layouts.next().unwrap_or_default();
                let visible = layouts.next().unwrap_or(window_layout);
                let Some(panes) = layout::panes(visible) else {
                    return;
                };
                Event::Layout { window, panes }
            }
            NotificationKind::WindowClose | NotificationKind::UnlinkedWindowClose => {
                let Some(window) = WindowId::parse(first) else {
                    return;
                };
                Event::WindowUnlinked { window }
            }
            NotificationKind::WindowRenamed | NotificationKind::UnlinkedWindowRenamed => {
                let Some(window) = WindowId::parse(first) else {
                    return;
                };
                Event::WindowRenamed {
                    window,
                    name: String::from_utf8_lossy(rest).into_owned(),
                }
            }
            NotificationKind::WindowPaneChanged => {
                let (Some(window), Some(pane)) = (WindowId::parse(first), PaneId::parse(rest))
                else {
                    return;
                };
                Event::ActivePane { window, pane }
            }
            NotificationKind::SessionsChanged | NotificationKind::SessionRenamed => {
                Event::SessionsChanged
            }
            NotificationKind::SubscriptionChanged => {
                // `w<W> $S @W <index> - : <value>`
                let Some(window) = first
                    .strip_prefix(b"w")
                    .and_then(|digits| WindowId::parse(&[b"@", digits].concat()))
                else {
                    return;
                };
                let Some(marker) = rest.windows(3).position(|window| window == b" : ") else {
                    return;
                };
                Event::Cwd {
                    window,
                    path: String::from_utf8_lossy(&rest[marker + 3..]).into_owned(),
                }
            }
            NotificationKind::Exit => {
                self.exit_seen = true;
                return;
            }
        };
        step.events.push(event);
    }

    fn reply_ended(&mut self, error: bool, step: &mut Step) {
        let Some(front) = self.pending.front() else {
            return;
        };
        if !error && front.replies.len() < front.commands {
            return;
        }
        let Some(Pending {
            purpose,
            mut replies,
            too_large,
            torn,
            ..
        }) = self.pending.pop_front()
        else {
            return;
        };
        // tmux skips the rest of a list after an error, so `%error` ends the group.
        let failure = error.then(|| {
            let message = replies.pop().unwrap_or_default();
            let message = message.first().cloned().unwrap_or_default();
            String::from_utf8_lossy(&message).into_owned()
        });
        let outcome = Outcome {
            replies,
            failure,
            too_large,
            torn,
        };
        match purpose {
            Purpose::Startup => self.started(outcome, step),
            Purpose::ClientSize => {
                let phase = std::mem::replace(&mut self.phase, Phase::Ready);
                match (outcome.failure, phase) {
                    (None, Phase::SizingClient { server, version }) => {
                        step.events.push(Event::Ready { server, version });
                    }
                    _ => self.fatal(SessionError::Startup, step),
                }
            }
            Purpose::Pause => {}
            Purpose::Request { tag, request } => self.answered(tag, request, outcome, step),
        }
        // A slot this freed (a torn retry reuses its own) goes to the oldest deferred
        // pause at once, so the lines written never depend on how bytes were chunked.
        if self.pending.len() < MAX_IN_FLIGHT && !matches!(self.phase, Phase::Dead) {
            if let Some(pane) = self.deferred_pauses.pop_front() {
                self.send(command::pause(pane), Purpose::Pause, step);
            }
        }
    }

    fn answered(&mut self, tag: Tag, request: Request, done: Outcome, step: &mut Step) {
        let first_row = |replies: &[Rows]| replies.first()?.first().cloned();
        let result = if done.too_large {
            Err(TmuxError::TooLarge)
        } else if let Some(message) = done.failure {
            match request {
                Request::Snapshot { pane, .. } if snapshot::pane_gone(&done.replies) => {
                    self.wanted.remove(&pane);
                    Err(TmuxError::PaneGone)
                }
                _ => Err(TmuxError::Command(message)),
            }
        } else {
            match request {
                Request::Snapshot {
                    pane,
                    group,
                    attempt,
                } if done.torn => {
                    if attempt < SNAPSHOT_ATTEMPTS {
                        let request = Request::Snapshot {
                            pane,
                            group: group.clone(),
                            attempt: attempt + 1,
                        };
                        return self.send(group, Purpose::Request { tag, request }, step);
                    }
                    Err(TmuxError::Torn)
                }
                Request::Snapshot { pane, .. } => match snapshot::from_replies(done.replies) {
                    Ok(snapshot) => {
                        return step.events.push(Event::Snapshot {
                            tag,
                            pane,
                            snapshot,
                        });
                    }
                    Err(error) => Err(error),
                },
                Request::Locate => first_row(&done.replies)
                    .and_then(|row| parse_location(&row))
                    .map(Reply::Location)
                    .ok_or(TmuxError::BadReply),
                Request::LocateSession => first_row(&done.replies)
                    .and_then(|row| parse_session_location(&row))
                    .map(Reply::SessionLocation)
                    .ok_or(TmuxError::BadReply),
                Request::History => Ok(Reply::History(
                    done.replies.into_iter().next().unwrap_or_default(),
                )),
                Request::Plain => Ok(Reply::Ok),
            }
        };
        step.events.push(Event::Done { tag, result });
    }

    fn started(&mut self, done: Outcome, step: &mut Step) {
        let row = done.replies.first().and_then(|rows| rows.first());
        let parsed = match (done.failure, done.too_large, row) {
            (None, false, Some(row)) => parse_startup(row),
            _ => None,
        };
        let Some((version, server, size)) = parsed else {
            return self.fatal(SessionError::Startup, step);
        };
        if !version.is_supported() {
            return self.fatal(SessionError::TmuxTooOld(version), step);
        }
        self.phase = Phase::SizingClient { server, version };
        self.send(command::client_size(size), Purpose::ClientSize, step);
    }

    fn fatal(&mut self, error: SessionError, step: &mut Step) {
        self.phase = Phase::Dead;
        step.events.push(Event::Fatal(error));
    }
}

impl Pending {
    fn snapshot_pane(&self) -> Option<PaneId> {
        match &self.purpose {
            Purpose::Request {
                request: Request::Snapshot { pane, .. },
                ..
            } => Some(*pane),
            _ => None,
        }
    }

    fn add_row(&mut self, row: Bytes) {
        if self.too_large {
            return;
        }
        self.bytes += row.len() + 1;
        if self.bytes > MAX_REPLY {
            return self.overflow();
        }
        if let Some(reply) = self.replies.last_mut() {
            reply.push(row);
        }
    }

    /// Past the reply cap: drop what is held, keep counting replies.
    fn overflow(&mut self) {
        self.too_large = true;
        self.replies.iter_mut().for_each(Vec::clear);
    }
}

fn tab_fields(row: &[u8]) -> Option<Vec<&str>> {
    Some(std::str::from_utf8(row).ok()?.split('\t').collect())
}

fn parse_server(pid: &str, start_time: &str) -> Option<ServerInstance> {
    Some(ServerInstance {
        pid: pid.parse().ok()?,
        start_time: start_time.parse().ok()?,
    })
}

fn parse_size(cols: &str, rows: &str) -> Option<Size> {
    Some(Size {
        cols: cols.parse().ok()?,
        rows: rows.parse().ok()?,
    })
}

/// `version pid start_time window_width window_height`.
fn parse_startup(row: &[u8]) -> Option<(TmuxVersion, ServerInstance, Size)> {
    let [version, pid, start_time, cols, rows] = tab_fields(row)?[..] else {
        return None;
    };
    Some((
        TmuxVersion::parse(version),
        parse_server(pid, start_time)?,
        parse_size(cols, rows)?,
    ))
}

/// `pid start_time session_id window_id pane_id pane_width pane_height`; the target
/// fields are empty for a window that is gone.
fn parse_location(row: &[u8]) -> Option<Location> {
    let [pid, start_time, session, _window, pane, cols, rows] = tab_fields(row)?[..] else {
        return None;
    };
    let server = parse_server(pid, start_time)?;
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
            size: parse_size(cols, rows)?,
        }),
    })
}

/// `pid start_time session_id`, the id empty for a session that is gone.
fn parse_session_location(row: &[u8]) -> Option<SessionLocation> {
    let [pid, start_time, session] = tab_fields(row)?[..] else {
        return None;
    };
    Some(SessionLocation {
        server: parse_server(pid, start_time)?,
        exists: !session.is_empty(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A session past startup on tmux `version`, and the events startup produced.
    fn started(version: &str) -> (Session, Vec<Event>) {
        let (mut session, _) = Session::new();
        let mut events = session
            .feed(format!("%begin 1 1 1\n{version}\t42\t7\t80\t24\n%end 1 1 1\n").as_bytes())
            .events;
        events.extend(session.feed(b"%begin 1 2 1\n%end 1 2 1\n").events);
        (session, events)
    }

    #[test]
    fn an_oversized_reply_fails_its_group_and_later_replies_still_match() {
        let (mut session, _) = started("3.4");
        session.request(
            Tag(1),
            Op::History {
                pane: PaneId(0),
                start: -9999,
                end: 0,
            },
        );
        session.request(
            Tag(2),
            Op::Locate {
                window: WindowId(0),
            },
        );
        let mut stream = b"%begin 1 3 1\n".to_vec();
        let row = [b'x'; 1000];
        for _ in 0..=MAX_REPLY / row.len() {
            stream.extend_from_slice(&row);
            stream.push(b'\n');
        }
        stream.extend_from_slice(
            b"%end 1 3 1\n%begin 1 4 1\n42\t7\t$0\t@0\t%0\t80\t24\n%end 1 4 1\n",
        );
        let events = session.feed(&stream).events;
        assert_eq!(
            events[0],
            Event::Done {
                tag: Tag(1),
                result: Err(TmuxError::TooLarge)
            }
        );
        assert!(matches!(
            &events[1],
            Event::Done { tag: Tag(2), result: Ok(Reply::Location(location)) }
                if location.found.is_some()
        ));
        assert_eq!(session.in_flight(), 0);
    }

    #[test]
    fn startup_stops_on_tmux_older_than_3_4() {
        let (_, events) = started("3.3a");
        assert_eq!(
            events,
            [Event::Fatal(SessionError::TmuxTooOld(TmuxVersion::parse(
                "3.3a"
            )))]
        );
    }

    #[test]
    fn a_reply_with_nothing_pending_is_fatal() {
        let (mut session, _) = started("3.4");
        let events = session.feed(b"%begin 1 3 1\n%end 1 3 1\n").events;
        assert_eq!(events, [Event::Fatal(SessionError::UnexpectedReply)]);
        assert_eq!(session.feed(b"%output %0 x\n"), Step::default());
    }
}
