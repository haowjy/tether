//! Desired state (daemon-core.md §4.4): after every input, compare what tmux should be
//! doing for the current watches with what the hub has sent, and send the difference
//! as far as capacity allows. Releases, cleared votes and unsubscribes go first, then
//! Locates and session checks, subscriptions, votes, and snapshots. Maintenance may
//! fill a control client's in-flight cap; nothing goes to a client before it is ready.

use std::collections::{BTreeMap, BTreeSet};

use super::state::{ClientPhase, Inflight, OneShotWork, Phase, State, WatchKey, WinKey, Work};
use super::{CAPTURE_RESERVATION, CAPTURE_SLOTS, LINGER, SNAPSHOT_SPACING};
use crate::tmux::{
    ClientId, MAX_IN_FLIGHT, OneShotCmd, Op, PaneId, SessionId, Size, Tag, WindowId,
};

impl State {
    pub(super) fn reconcile(&mut self) {
        self.update_lingers();
        let ready: Vec<ClientId> = self
            .clients
            .iter()
            .filter(|(_, client)| matches!(client.phase, ClientPhase::Ready { .. }))
            .map(|(id, _)| *id)
            .collect();
        for &client in &ready {
            self.withdraw(client);
        }
        self.locates();
        self.session_checks();
        for &client in &ready {
            self.subscribe_and_vote(client);
        }
        self.snapshots();
    }

    /// A client that owns no watched window, and none is waiting for, lingers.
    fn update_lingers(&mut self) {
        let used: BTreeSet<ClientId> = self
            .windows
            .values()
            .filter_map(|window| match window.phase {
                Phase::Bound { owner, .. } => Some(owner),
                Phase::Starting { client } => Some(client),
                Phase::Locating { .. } => window.locate.on,
                Phase::Orphaned { .. } => None,
            })
            .collect();
        let until = self.now + LINGER;
        for (id, client) in &mut self.clients {
            if used.contains(id) {
                client.linger = None;
            } else if client.linger.is_none() {
                client.linger = Some(until);
            }
        }
    }

    /// What the client owns: each bound window's id, pane and vote.
    fn owned_windows(&self, client: ClientId) -> BTreeMap<WindowId, (PaneId, Size)> {
        self.windows
            .iter()
            .filter_map(|(key, window)| match window.phase {
                Phase::Bound { owner, pane, .. } if owner == client => {
                    Some((key.window, (pane, window.vote)))
                }
                _ => None,
            })
            .collect()
    }

    /// Releases panes, clears votes and unsubscribes windows the client no longer owns.
    fn withdraw(&mut self, client: ClientId) {
        let owned = self.owned_windows(client);
        let Some(record) = self.clients.get(&client) else {
            return;
        };
        let shown: BTreeSet<PaneId> = owned.values().map(|(pane, _)| *pane).collect();
        let releases: Vec<(PaneId, Vec<Tag>)> = record
            .ready()
            .into_iter()
            .flat_map(|tmux| tmux.wanted())
            .filter(|pane| !shown.contains(pane))
            .map(|pane| {
                // The Release invalidates these; they answer nothing.
                let invalidated = record
                    .pending
                    .iter()
                    .filter(
                        |(_, work)| matches!(work, Work::Snapshot { pane: of, .. } if *of == pane),
                    )
                    .map(|(tag, _)| *tag)
                    .collect();
                (pane, invalidated)
            })
            .collect();
        let clears: Vec<WindowId> = record
            .votes
            .keys()
            .filter(|window| !owned.contains_key(window))
            .copied()
            .collect();
        let unsubscribes: Vec<WindowId> = record
            .subscriptions
            .iter()
            .filter(|window| !owned.contains_key(window))
            .copied()
            .collect();
        for (pane, invalidates) in releases {
            if !self.room(client, MAX_IN_FLIGHT) {
                return;
            }
            for tag in &invalidates {
                self.forget_snapshot(client, *tag);
            }
            let tag = self.next_tag();
            self.request(
                client,
                tag,
                Op::Release { pane },
                Work::Release { invalidates },
            );
        }
        for window in clears {
            if !self.room(client, MAX_IN_FLIGHT) {
                return;
            }
            if let Some(record) = self.clients.get_mut(&client) {
                record.votes.remove(&window);
            }
            let tag = self.next_tag();
            self.request(client, tag, Op::ClearVote { window }, Work::Maintenance);
        }
        for window in unsubscribes {
            if !self.room(client, MAX_IN_FLIGHT) {
                return;
            }
            if let Some(record) = self.clients.get_mut(&client) {
                record.subscriptions.remove(&window);
            }
            let tag = self.next_tag();
            self.request(client, tag, Op::Unsubscribe { window }, Work::Maintenance);
        }
    }

    /// A snapshot tag a Release is about to invalidate: if a stream still waits for it,
    /// it stops waiting.
    fn forget_snapshot(&mut self, client: ClientId, tag: Tag) {
        let Some(Work::Snapshot {
            window: Some(key), ..
        }) = self
            .clients
            .get(&client)
            .and_then(|record| record.pending.get(&tag))
        else {
            return;
        };
        let key = *key;
        let inflight = self.windows.get_mut(&key).and_then(|window| {
            window
                .stream
                .inflight
                .take_if(|inflight| inflight.tag == tag)
        });
        if let Some(inflight) = inflight {
            self.abandon(inflight);
        }
    }

    /// Locates on the window's owner (or the client it is to bind to), else on any
    /// ready client of its endpoint, else as the one-shot.
    fn locates(&mut self) {
        let needed: Vec<(WinKey, Option<ClientId>)> = self
            .windows
            .iter()
            .filter(|(_, window)| window.locate.needed && window.locate.in_flight.is_none())
            .map(|(key, window)| {
                let owner = match window.phase {
                    Phase::Bound { owner, .. } => Some(owner),
                    _ => None,
                };
                (*key, window.locate.on.or(owner))
            })
            .collect();
        for (key, target) in needed {
            let runner = match target {
                Some(client) if self.room(client, MAX_IN_FLIGHT) => Some(client),
                Some(_) => continue,
                None => self.any_ready(key.endpoint),
            };
            if runner.is_none() && self.oneshot.is_some() {
                continue;
            }
            match runner {
                Some(client) => {
                    let tag = self.next_tag();
                    self.mark_locating(key, tag);
                    let op = Op::Locate { window: key.window };
                    self.request(client, tag, op, Work::Locate { window: key });
                }
                None => {
                    let cmd = OneShotCmd::Locate { window: key.window };
                    let work = OneShotWork::Locate { window: key };
                    let tag = self.run_oneshot(key.endpoint, cmd, work);
                    self.mark_locating(key, tag);
                }
            }
        }
    }

    fn mark_locating(&mut self, key: WinKey, tag: Tag) {
        if let Some(window) = self.windows.get_mut(&key) {
            window.locate.needed = false;
            window.locate.in_flight = Some(tag);
        }
    }

    /// `LocateSession` for exited clients, the same way as Locates.
    fn session_checks(&mut self) {
        let needed: Vec<(ClientId, usize, SessionId)> = self
            .exits
            .iter()
            .filter(|(_, check)| check.in_flight.is_none())
            .map(|(id, check)| (*id, check.exit.endpoint, check.exit.session))
            .collect();
        for (exited, endpoint, session) in needed {
            match self.any_ready(endpoint) {
                Some(client) => {
                    let tag = self.next_tag();
                    self.mark_checking(exited, tag);
                    let op = Op::LocateSession { session };
                    self.request(client, tag, op, Work::SessionCheck { exited });
                }
                None if self.oneshot.is_none() => {
                    let cmd = OneShotCmd::LocateSession { session };
                    let work = OneShotWork::SessionCheck { exited };
                    let tag = self.run_oneshot(endpoint, cmd, work);
                    self.mark_checking(exited, tag);
                }
                None => {}
            }
        }
    }

    fn mark_checking(&mut self, exited: ClientId, tag: Tag) {
        if let Some(check) = self.exits.get_mut(&exited) {
            check.in_flight = Some(tag);
        }
    }

    fn any_ready(&self, endpoint: usize) -> Option<ClientId> {
        self.clients
            .iter()
            .find(|(id, client)| client.endpoint == endpoint && self.room(**id, MAX_IN_FLIGHT))
            .map(|(id, _)| *id)
    }

    /// A cwd subscription and a size vote on every window the client owns.
    fn subscribe_and_vote(&mut self, client: ClientId) {
        let owned = self.owned_windows(client);
        for &window in owned.keys() {
            let subscribed = self
                .clients
                .get(&client)
                .is_some_and(|record| record.subscriptions.contains(&window));
            if subscribed {
                continue;
            }
            if !self.room(client, MAX_IN_FLIGHT) {
                return;
            }
            if let Some(record) = self.clients.get_mut(&client) {
                record.subscriptions.insert(window);
            }
            let tag = self.next_tag();
            self.request(client, tag, Op::Subscribe { window }, Work::Maintenance);
        }
        for (&window, &(_, size)) in &owned {
            let applied = self
                .clients
                .get(&client)
                .and_then(|record| record.votes.get(&window))
                == Some(&size);
            if applied {
                continue;
            }
            if !self.room(client, MAX_IN_FLIGHT) {
                return;
            }
            if let Some(record) = self.clients.get_mut(&client) {
                record.votes.insert(window, size);
            }
            let tag = self.next_tag();
            self.request(client, tag, Op::Vote { window, size }, Work::Maintenance);
        }
    }

    /// A snapshot for each bound stream with watches awaiting one, when a capture slot,
    /// room on the owner and credit for at least one of those watches allow. Watches
    /// whose connection can't reserve wait for a later one.
    fn snapshots(&mut self) {
        let mut slots = CAPTURE_SLOTS.saturating_sub(self.captures());
        let candidates: Vec<(WinKey, ClientId, PaneId, Vec<WatchKey>)> = self
            .windows
            .iter()
            .filter(|(_, window)| window.stream.inflight.is_none())
            .filter_map(|(key, window)| match window.phase {
                Phase::Bound { owner, pane, .. } => {
                    let watches = window.watches.iter().copied().collect();
                    Some((*key, owner, pane, watches))
                }
                _ => None,
            })
            .collect();
        for (key, owner, pane, watches) in candidates {
            if slots == 0 {
                return;
            }
            if !self.room(owner, MAX_IN_FLIGHT) {
                continue;
            }
            let mut reserved = BTreeSet::new();
            for watch in watches {
                let eligible = self
                    .conns
                    .get(&watch.conn)
                    .and_then(|conn| conn.watches.get(&watch.watch))
                    .is_some_and(|state| {
                        state.awaiting
                            && (!state.starved
                                || state
                                    .last_snapshot
                                    .is_none_or(|at| self.now >= at + SNAPSHOT_SPACING))
                    });
                if eligible && self.can_reserve(watch.conn, CAPTURE_RESERVATION) {
                    self.reserve(watch.conn, CAPTURE_RESERVATION);
                    reserved.insert(watch);
                }
            }
            if reserved.is_empty() {
                continue;
            }
            let tag = self.next_tag();
            if let Some(window) = self.windows.get_mut(&key) {
                window.stream.inflight = Some(Inflight {
                    tag,
                    client: owner,
                    reserved,
                });
            }
            let work = Work::Snapshot {
                window: Some(key),
                pane,
            };
            self.request(owner, tag, Op::Snapshot { pane }, work);
            slots -= 1;
        }
    }
}
