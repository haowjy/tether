//! Bell attention (daemon-core.md §4.8): the poll, the baseline every listing answer is
//! diffed against, and the `bell` message. The source is tmux's own `alert-bell` hook,
//! which counts a session's bells in a user option; the listing carries the count (the
//! mark) and tmux's verdict on whether the session's bells reach the hook. The devices
//! keep "seen" themselves.

use std::collections::BTreeMap;
use std::time::Instant;

use super::BELL_POLL;
use super::state::{MAIN, OneShotWork, State};
use crate::proto::{BellChange, ServerMsg};
use crate::tmux::{Bell, Listing, OneShotCmd, ServerInstance, SessionId};

/// What the hub knows of the bell poll. All of it is dropped with the last connection.
#[derive(Default)]
pub(super) struct BellPoll {
    /// When the next poll is due: 5 s after the last listing answer, whoever asked,
    /// and at once for the first connection. `None` with no connection.
    pub(super) due: Option<Instant>,
    /// The last answer. The first one after polling started only becomes this.
    baseline: Option<Baseline>,
    /// The last listing failed (not `NoServer`), and the devices were told.
    unavailable: bool,
}

struct Baseline {
    server: ServerInstance,
    sessions: BTreeMap<SessionId, Bell>,
}

impl State {
    /// The first connection starts the poll at once; the last ends it and forgets the
    /// baseline.
    pub(super) fn bell_connections_changed(&mut self) {
        self.bell = BellPoll {
            due: (!self.conns.is_empty()).then_some(self.now),
            ..BellPoll::default()
        };
    }

    /// Runs the poll when it is due and the one-shot slot is free; whatever frees the
    /// slot reconciles, so a due poll needs no deadline of its own.
    pub(super) fn poll_bell(&mut self) {
        if self.oneshot.is_none() && self.bell.due.is_some_and(|due| due <= self.now) {
            self.bell.due = None;
            self.run_oneshot(
                MAIN,
                OneShotCmd::List,
                OneShotWork::List {
                    waiters: Vec::new(),
                },
            );
        }
    }

    /// A listing answer came back, from the poll or a user: the next poll is 5 s after
    /// it, if anyone is connected.
    pub(super) fn bell_restart_clock(&mut self) {
        self.bell.due = (!self.conns.is_empty()).then(|| self.now + BELL_POLL);
    }

    /// No tmux server: nothing to diff, and the server-level failure, if any, is over.
    pub(super) fn bell_no_server(&mut self) {
        self.bell.baseline = None;
        if std::mem::take(&mut self.bell.unavailable) {
            self.broadcast(&self.bell_message(true, Vec::new()));
        }
    }

    /// Any other failure is one server-level fact, told once until a listing works.
    pub(super) fn bell_failed(&mut self) {
        if !self.conns.is_empty() && !std::mem::replace(&mut self.bell.unavailable, true) {
            self.broadcast(&self.bell_message(false, Vec::new()));
        }
    }

    /// Diffs `listing` against the baseline and tells every connection what changed.
    pub(super) fn bell_read(&mut self, listing: &Listing) {
        if self.conns.is_empty() {
            return;
        }
        let now: BTreeMap<SessionId, Bell> = listing
            .sessions
            .iter()
            .map(|session| (session.id, session.bell))
            .collect();
        let changed = match &self.bell.baseline {
            Some(old) if old.server == listing.server => now
                .iter()
                .filter(|(id, bell)| old.sessions.get(id) != Some(bell))
                .map(|(id, bell)| BellChange {
                    session: id.0,
                    mark: bell.mark,
                    covered: bell.covered,
                })
                .collect(),
            _ => Vec::new(),
        };
        self.bell.baseline = Some(Baseline {
            server: listing.server,
            sessions: now,
        });
        let recovered = std::mem::take(&mut self.bell.unavailable);
        if recovered || !changed.is_empty() {
            self.broadcast(&self.bell_message(true, changed));
        }
    }

    fn bell_message(&self, available: bool, sessions: Vec<BellChange>) -> ServerMsg {
        let server = match self.endpoints[MAIN].live {
            Some(live) => self.server_name(MAIN, live),
            None => self.endpoints[MAIN].name.to_owned(),
        };
        ServerMsg::Bell {
            server,
            available,
            sessions,
        }
    }
}
