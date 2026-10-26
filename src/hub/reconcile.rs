//! Reconcile the session views' desired tmux state within bounded capacity.

use std::collections::{BTreeMap, BTreeSet};

use super::state::{ClientPhase, OneShotWork, State, Work};
use super::view::{Inflight, Take, ViewKey, ViewPhase, vote_plan};
use super::{CAPTURE_RESERVATION, CAPTURE_SLOTS, LINGER};
use crate::tmux::{ClientId, MAX_IN_FLIGHT, OneShotCmd, Op, PaneId, Size, Tag, WindowId};

impl State {
    pub(super) fn reconcile(&mut self) {
        self.update_lingers();
        let ready = self
            .clients
            .iter()
            .filter(|(_, client)| matches!(client.phase, ClientPhase::Ready { .. }))
            .map(|(id, _)| *id)
            .collect::<Vec<_>>();
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

    fn update_lingers(&mut self) {
        let used = self
            .views
            .values()
            .filter_map(|view| view.client())
            .collect::<BTreeSet<_>>();
        let until = self.now + LINGER;
        for (id, client) in &mut self.clients {
            if used.contains(id) {
                client.linger = None;
            } else if client.linger.is_none() {
                client.linger = Some(until);
            }
        }
    }

    fn owned_panes(&self, client: ClientId) -> BTreeSet<PaneId> {
        self.views
            .values()
            .filter_map(|view| match view.phase {
                ViewPhase::Bound { owner, pane } if owner == client => Some(pane),
                _ => None,
            })
            .collect()
    }

    fn owned_windows(&self, client: ClientId) -> BTreeSet<WindowId> {
        self.views
            .values()
            .filter(|view| view.client() == Some(client))
            .flat_map(|view| {
                view.shown
                    .iter()
                    .map(|shown| shown.id)
                    .chain(view.next)
                    .chain(view.target())
            })
            .collect()
    }

    fn claimed_windows(&self, client: ClientId) -> BTreeMap<WindowId, (Size, Take, ViewKey)> {
        self.views
            .iter()
            .filter(|(_, view)| view.client() == Some(client))
            .filter_map(|(key, view)| {
                let claim = view.claim.as_ref()?;
                let window = view.target()?;
                let size = self
                    .conns
                    .get(&claim.watch.conn)?
                    .watches
                    .get(&claim.watch.watch)?
                    .size;
                Some((window, (size, claim.take, *key)))
            })
            .collect()
    }

    fn withdraw(&mut self, client: ClientId) {
        let owned_panes = self.owned_panes(client);
        let owned_windows = self.owned_windows(client);
        let claimed = self.claimed_windows(client);
        let has_view = self
            .views
            .values()
            .any(|view| view.client() == Some(client));
        let Some(record) = self.clients.get(&client) else {
            return;
        };
        let releases = record
            .ready()
            .into_iter()
            .flat_map(|tmux| tmux.wanted())
            .filter(|pane| !owned_panes.contains(pane))
            .collect::<Vec<_>>();
        let clears = record
            .votes
            .keys()
            .filter(|window| !claimed.contains_key(window))
            .copied()
            .collect::<Vec<_>>();
        let unsubscribes = record
            .subscriptions
            .iter()
            .filter(|window| !owned_windows.contains(window))
            .copied()
            .collect::<Vec<_>>();
        let unwatch_current = record.current_subscribed && !has_view;

        for pane in releases {
            if !self.room(client, MAX_IN_FLIGHT) {
                return;
            }
            let tag = self.next_tag();
            self.request(client, tag, Op::Release { pane }, Work::Maintenance);
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
        if unwatch_current && self.room(client, MAX_IN_FLIGHT) {
            if let Some(record) = self.clients.get_mut(&client) {
                record.current_subscribed = false;
            }
            let tag = self.next_tag();
            self.request(client, tag, Op::UnwatchCurrent, Work::Maintenance);
        }
    }

    fn locates(&mut self) {
        let needed = self
            .views
            .iter()
            .filter(|(_, view)| {
                // The ExitCheck owns an orphan's Locate and must gate respawn; a parallel
                // view Locate could spawn a client before the crash count is evaluated.
                view.locate.needed
                    && view.locate.in_flight.is_none()
                    && !matches!(view.phase, ViewPhase::Orphaned { .. })
            })
            .map(|(key, view)| (*key, view.client()))
            .collect::<Vec<_>>();
        for (key, known_owner) in needed {
            let owner = known_owner.or_else(|| self.client_for(key.endpoint, key.session));
            let runner = match owner {
                Some(owner) if self.room(owner, MAX_IN_FLIGHT) => Some(owner),
                Some(_) => continue,
                None => self.any_ready(key.endpoint),
            };
            if runner.is_none() && self.oneshot.is_some() {
                continue;
            }
            match runner {
                Some(client) => {
                    let tag = self.next_tag();
                    self.mark_locating(key, tag, owner.filter(|owner| *owner == client));
                    self.request(
                        client,
                        tag,
                        Op::Locate {
                            session: key.session,
                        },
                        Work::Locate { view: key },
                    );
                }
                None => {
                    let tag = self.run_oneshot(
                        key.endpoint,
                        OneShotCmd::Locate {
                            session: key.session,
                        },
                        OneShotWork::Locate { view: key },
                    );
                    self.mark_locating(key, tag, None);
                }
            }
        }
    }

    fn mark_locating(&mut self, key: ViewKey, tag: Tag, owner: Option<ClientId>) {
        if let Some(view) = self.views.get_mut(&key) {
            view.locate.needed = false;
            view.locate.in_flight = Some(tag);
            if let Some(owner) = owner {
                if !matches!(view.phase, ViewPhase::Bound { owner: current, .. } if current == owner)
                {
                    view.phase = ViewPhase::Locating { owner };
                }
            }
        }
    }

    fn session_checks(&mut self) {
        let needed = self
            .exits
            .iter()
            .filter(|(_, check)| check.in_flight.is_none())
            .map(|(id, check)| (*id, check.exit.endpoint, check.exit.session))
            .collect::<Vec<_>>();
        for (exited, endpoint, session) in needed {
            match self.any_ready(endpoint) {
                Some(client) => {
                    let tag = self.next_tag();
                    if let Some(check) = self.exits.get_mut(&exited) {
                        check.in_flight = Some(tag);
                    }
                    self.request(
                        client,
                        tag,
                        Op::Locate { session },
                        Work::SessionCheck { exited },
                    );
                }
                None if self.oneshot.is_none() => {
                    let tag = self.run_oneshot(
                        endpoint,
                        OneShotCmd::Locate { session },
                        OneShotWork::SessionCheck { exited },
                    );
                    if let Some(check) = self.exits.get_mut(&exited) {
                        check.in_flight = Some(tag);
                    }
                }
                None => {}
            }
        }
    }

    fn any_ready(&self, endpoint: usize) -> Option<ClientId> {
        self.clients
            .iter()
            .find(|(id, client)| client.endpoint == endpoint && self.room(**id, MAX_IN_FLIGHT))
            .map(|(id, _)| *id)
    }

    fn subscribe_and_vote(&mut self, client: ClientId) {
        let windows = self.owned_windows(client);
        for &window in &windows {
            if self
                .clients
                .get(&client)
                .is_some_and(|record| record.subscriptions.contains(&window))
            {
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
        let has_view = self
            .views
            .values()
            .any(|view| view.client() == Some(client));
        let subscribed = self
            .clients
            .get(&client)
            .is_some_and(|record| record.current_subscribed);
        if has_view && !subscribed {
            if !self.room(client, MAX_IN_FLIGHT) {
                return;
            }
            if let Some(record) = self.clients.get_mut(&client) {
                record.current_subscribed = true;
            }
            let tag = self.next_tag();
            self.request(client, tag, Op::WatchCurrent, Work::Maintenance);
        }

        for (window, (size, requested_take, key)) in self.claimed_windows(client) {
            let previous = self
                .clients
                .get(&client)
                .and_then(|record| record.votes.get(&window));
            let plan = vote_plan(previous, size, requested_take);
            if let Some(take) = plan {
                if !self.room(client, MAX_IN_FLIGHT) {
                    return;
                }
                self.record_vote(client, window, size, take);
            }
            if requested_take != Take::None {
                if let Some(claim) = self
                    .views
                    .get_mut(&key)
                    .and_then(|view| view.claim.as_mut())
                {
                    claim.take = Take::None;
                }
            }
        }
    }

    fn snapshots(&mut self) {
        let mut slots = CAPTURE_SLOTS.saturating_sub(self.captures());
        let candidates = self
            .views
            .iter()
            .filter(|(_, view)| view.stream.inflight.is_none())
            .filter_map(|(key, view)| match view.phase {
                ViewPhase::Bound { owner, pane } => Some((
                    *key,
                    owner,
                    pane,
                    view.watches.iter().copied().collect::<Vec<_>>(),
                )),
                _ => None,
            })
            .collect::<Vec<_>>();
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
                        state.awaiting && state.spaced_until().is_none_or(|at| self.now >= at)
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
            if let Some(view) = self.views.get_mut(&key) {
                view.stream.inflight = Some(Inflight { tag, reserved });
            }
            self.request(
                owner,
                tag,
                Op::Snapshot { pane },
                Work::Snapshot { view: key },
            );
            slots -= 1;
        }
    }
}
