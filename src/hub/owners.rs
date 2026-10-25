//! Session view ownership and control-client lifecycle (daemon-core.md §4.2, §4.5).

use std::time::Instant;

use tracing::{info, warn};

use super::names::cut;
use super::state::{Client, ClientPhase, Effect, Exit, ExitCheck, State};
use super::view::{Locate, ShownWindow, ViewKey, ViewPhase};
use super::{CRASH_WINDOW, RESPAWN_DELAY};
use crate::proto::{ServerMsg, WatchEndReason};
use crate::tmux::{
    ClientId, Found, PaneId, Reply, ServerInstance, Session, SessionId, Tag, TmuxError,
    TmuxVersion, WindowId,
};

impl State {
    /// Every control client gets each rename and session change, so only the
    /// endpoint's oldest ready one reports listing changes.
    pub(super) fn reporter(&self, client: ClientId) -> Option<(usize, ServerInstance)> {
        let record = self.clients.get(&client)?;
        let server = record.server()?;
        let first = self
            .clients
            .iter()
            .find(|(_, other)| other.endpoint == record.endpoint && other.server().is_some())
            .map(|(id, _)| *id);
        (first == Some(client)).then_some((record.endpoint, server))
    }

    pub(super) fn client_ready(
        &mut self,
        client: ClientId,
        server: ServerInstance,
        version: &TmuxVersion,
    ) {
        if let TmuxVersion::Unrecognised(text) = version {
            warn!(client = client.0, version = %text, "unrecognised tmux version, treated as the newest");
        }
        let Some(record) = self.clients.get_mut(&client) else {
            return;
        };
        let phase = std::mem::replace(&mut record.phase, ClientPhase::Delayed { until: self.now });
        record.phase = match phase {
            ClientPhase::Starting(tmux) => ClientPhase::Ready { tmux, server },
            other => other,
        };
        let endpoint = record.endpoint;
        info!(client = client.0, session = %record.session, %server, "tmux control client ready");
        self.learned(endpoint, server);
    }

    /// The current window shown by an owner's session.
    pub(super) fn owned(&self, client: ClientId, window: WindowId) -> Option<ViewKey> {
        let record = self.clients.get(&client)?;
        self.views
            .iter()
            .find(|(key, view)| {
                key.endpoint == record.endpoint
                    && key.session == record.session
                    && view.shown.as_ref().is_some_and(|shown| shown.id == window)
                    && matches!(view.phase, ViewPhase::Bound { owner, .. } if owner == client)
            })
            .map(|(key, _)| *key)
    }

    pub(super) fn owned_pane(&self, client: ClientId, pane: PaneId) -> Option<ViewKey> {
        self.views
            .iter()
            .find(|(_, view)| {
                matches!(view.phase, ViewPhase::Bound { owner, pane: shown } if owner == client && shown == pane)
            })
            .map(|(key, _)| *key)
    }

    /// The target window can change before its shown pane is refreshed by Locate.
    pub(super) fn targeted(&self, client: ClientId, window: WindowId) -> Option<ViewKey> {
        self.views
            .iter()
            .find(|(_, view)| view.client() == Some(client) && view.target() == Some(window))
            .map(|(key, _)| *key)
    }

    pub(super) fn located(
        &mut self,
        key: ViewKey,
        tag: Tag,
        source: Option<ClientId>,
        result: Result<Reply, TmuxError>,
    ) {
        let Some(view) = self.views.get_mut(&key) else {
            return;
        };
        if view.locate.in_flight != Some(tag) {
            return;
        }
        view.locate.in_flight = None;
        if view.locate.needed {
            return;
        }
        let location = match result {
            Ok(Reply::Location(location)) => location,
            Err(TmuxError::NoServer) => return self.server_gone(key.endpoint, key.server),
            Err(error) => {
                let message = cut(format!("can't find the session: {error}"));
                return self.end_view(key, WatchEndReason::Error, Some(message));
            }
            Ok(_) => {
                return self.end_view(
                    key,
                    WatchEndReason::Error,
                    Some("can't find the session: unexpected reply".to_owned()),
                );
            }
        };
        if location.server != key.server {
            self.server_gone(key.endpoint, key.server);
            return self.learned(key.endpoint, location.server);
        }
        self.learned(key.endpoint, location.server);
        let Some(found) = location.found else {
            let session = self.session_ref(key.endpoint, key.server, key.session);
            self.broadcast(&ServerMsg::SessionClosed { session });
            self.drop_view(key);
            return;
        };
        if found.session != key.session {
            return self.end_view(
                key,
                WatchEndReason::Error,
                Some("tmux located a different session".to_owned()),
            );
        }
        let Some(owner) = self.client_for(key.endpoint, key.session) else {
            let session_name = found.session_name.clone();
            if self
                .spawn_client(key.endpoint, key.session, session_name, None)
                .is_none()
            {
                let message = self.session_limit_message();
                return self.end_view(key, WatchEndReason::Limit, Some(message));
            }
            if let Some(view) = self.views.get_mut(&key) {
                view.phase = ViewPhase::Checking;
                view.locate.needed = true;
            }
            return;
        };
        if source != Some(owner) {
            if let Some(record) = self.clients.get_mut(&owner) {
                record.session_name.clone_from(&found.session_name);
            }
            if let Some(view) = self.views.get_mut(&key) {
                view.phase = ViewPhase::Locating { owner };
                view.locate.needed = true;
            }
            return;
        }
        self.found(key, owner, found);
    }

    fn found(&mut self, key: ViewKey, owner: ClientId, found: Found) {
        if let Some(client) = self.clients.get_mut(&owner) {
            client.session_name.clone_from(&found.session_name);
        }
        let shown = ShownWindow {
            id: found.window,
            index: found.index,
            name: cut(found.name),
            size: found.window_size,
        };
        let Some(view) = self.views.get_mut(&key) else {
            return;
        };
        let (changed, pane_changed) = view.located(owner, found.pane, shown);
        view.stream.size = found.size;
        if changed || pane_changed {
            self.break_stream(key);
        }
        self.tell(key);
    }

    pub(super) fn current_window(&mut self, client: ClientId, window: WindowId) {
        let session = match self.clients.get(&client) {
            Some(record) => record.session,
            None => return,
        };
        let Some(key) = self
            .views
            .keys()
            .find(|key| {
                key.session == session
                    && self
                        .views
                        .get(key)
                        .is_some_and(|view| view.client() == Some(client))
            })
            .copied()
        else {
            return;
        };
        if let Some(view) = self.views.get_mut(&key) {
            if view.window_reported(window) {
                view.locate.needed = true;
            }
        }
    }

    pub(super) fn owner_moved(&mut self, client: ClientId) {
        if let Some(record) = self.clients.get_mut(&client) {
            record.moved = true;
        }
        self.client_exited(
            client,
            "tmux moved the control client to another session".to_owned(),
            false,
        );
    }

    pub(super) fn client_for(&self, endpoint: usize, session: SessionId) -> Option<ClientId> {
        self.clients
            .iter()
            .find(|(_, client)| client.endpoint == endpoint && client.session == session)
            .map(|(id, _)| *id)
    }

    pub(super) fn spawn_client(
        &mut self,
        endpoint: usize,
        session: SessionId,
        session_name: String,
        respawn: Option<(Instant, Instant)>,
    ) -> Option<ClientId> {
        if !self.make_room() {
            return None;
        }
        let client = ClientId(self.next_client);
        self.next_client += 1;
        self.clients.insert(
            client,
            Client {
                endpoint,
                session,
                session_name,
                phase: ClientPhase::Delayed { until: self.now },
                votes: Default::default(),
                subscriptions: Default::default(),
                current_subscribed: false,
                pending: Default::default(),
                progress: self.now,
                linger: None,
                last_crash: respawn.map(|(_, crash)| crash),
                moved: false,
            },
        );
        match respawn {
            Some((until, _)) if until > self.now => {
                if let Some(record) = self.clients.get_mut(&client) {
                    record.phase = ClientPhase::Delayed { until };
                }
            }
            _ => self.start(client),
        }
        Some(client)
    }

    pub(super) fn start(&mut self, client: ClientId) {
        let Some(record) = self.clients.get_mut(&client) else {
            return;
        };
        let session = record.session;
        let endpoint = record.endpoint;
        let (tmux, step) = Session::new(session);
        record.phase = ClientPhase::Starting(tmux);
        info!(client = client.0, %session, "starting tmux control client");
        self.effects.push(Effect::SpawnClient {
            client,
            endpoint: self.endpoints[endpoint].endpoint.clone(),
            session,
        });
        self.apply(client, 0, step);
    }

    pub(super) fn make_room(&mut self) -> bool {
        if self.clients.len() < self.max_clients {
            return true;
        }
        let lingering = self
            .clients
            .iter()
            .filter_map(|(id, client)| client.linger.map(|until| (until, *id)))
            .min();
        match lingering {
            Some((_, client)) => {
                self.close_client(client);
                true
            }
            None => false,
        }
    }

    pub(super) fn session_limit_message(&self) -> String {
        let sessions = self
            .clients
            .values()
            .map(|client| client.session_name.clone())
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>()
            .join(", ");
        let noun = if self.max_clients == 1 {
            "session"
        } else {
            "sessions"
        };
        cut(format!(
            "tether on {} allows {} tmux {noun} at a time; open now: {sessions}",
            self.host_name, self.max_clients
        ))
    }

    pub(super) fn close_client(&mut self, client: ClientId) {
        let Some(record) = self.clients.remove(&client) else {
            return;
        };
        if record.tmux().is_some() {
            self.effects.push(Effect::CloseClient { client });
        }
        self.release_views(client, |view| {
            view.phase = ViewPhase::Checking;
            view.locate.needed = true;
        });
        for (tag, work) in record.pending {
            self.settle(client, tag, work);
        }
    }

    fn release_views(&mut self, client: ClientId, to: impl Fn(&mut super::view::View)) {
        let keys = self
            .views
            .iter()
            .filter(|(_, view)| view.client() == Some(client))
            .map(|(key, _)| *key)
            .collect::<Vec<_>>();
        for key in keys {
            if let Some(view) = self.views.get_mut(&key) {
                to(view);
            }
            self.break_stream(key);
        }
    }

    pub(super) fn client_exited(&mut self, client: ClientId, reason: String, killed: bool) {
        let Some(record) = self.clients.remove(&client) else {
            return;
        };
        self.effects.push(Effect::CloseClient { client });
        let detached = !killed && (record.moved || record.tmux().is_some_and(Session::exit_seen));
        info!(client = client.0, session = %record.session, detached, %reason, "tmux control client ended");
        let server = record.server().or(self.endpoints[record.endpoint].live);
        self.release_views(client, |view| {
            view.phase = ViewPhase::Orphaned { client };
            view.locate = Locate::default();
        });
        for (tag, work) in record.pending {
            self.settle(client, tag, work);
        }
        let exit = Exit {
            endpoint: record.endpoint,
            session: record.session,
            session_name: record.session_name,
            detached,
            at: self.now,
            last_crash: record.last_crash,
            reason,
        };
        self.exits.insert(
            client,
            ExitCheck {
                exit,
                server,
                in_flight: None,
            },
        );
    }

    pub(super) fn checked(&mut self, exited: ClientId, tag: Tag, result: Result<Reply, TmuxError>) {
        let Some(check) = self.exits.get_mut(&exited) else {
            return;
        };
        if check.in_flight != Some(tag) {
            return;
        }
        check.in_flight = None;
        let (endpoint, server) = (check.exit.endpoint, check.server);
        let location = match result {
            Ok(Reply::Location(location)) => location,
            Err(TmuxError::NoServer) => {
                if let Some(server) = server.or(self.endpoints[endpoint].live) {
                    self.server_gone(endpoint, server);
                }
                return self.relocate_orphans(exited, None);
            }
            other => {
                let error = other.err().unwrap_or(TmuxError::BadReply);
                let message = cut(format!("can't check the tmux session: {error}"));
                self.exits.remove(&exited);
                for key in self.orphans(exited) {
                    self.end_view(key, WatchEndReason::Error, Some(message.clone()));
                }
                return;
            }
        };
        if let Some(old) = server.filter(|old| *old != location.server) {
            self.server_gone(endpoint, old);
        }
        self.learned(endpoint, location.server);
        let Some(exit) = self.exits.get(&exited).map(|check| check.exit.clone()) else {
            return;
        };
        if location.found.is_none() {
            let session = self.session_ref(endpoint, location.server, exit.session);
            self.broadcast(&ServerMsg::SessionClosed { session });
            for key in self.orphans(exited) {
                self.drop_view(key);
            }
        }
        self.relocate_orphans(exited, location.found.map(|_| exit));
    }

    fn orphans(&self, exited: ClientId) -> Vec<ViewKey> {
        self.views
            .iter()
            .filter(|(_, view)| matches!(view.phase, ViewPhase::Orphaned { client } if client == exited))
            .map(|(key, _)| *key)
            .collect()
    }

    fn relocate_orphans(&mut self, exited: ClientId, exit: Option<Exit>) {
        self.exits.remove(&exited);
        let Some(exit) = exit else {
            return;
        };
        let orphans = self.orphans(exited);
        if exit.detached {
            for key in orphans {
                self.end_view(key, WatchEndReason::Detached, None);
            }
            return;
        }
        let crash_twice = exit
            .last_crash
            .is_some_and(|first| exit.at.saturating_duration_since(first) < CRASH_WINDOW);
        if crash_twice {
            let message = cut(format!(
                "the tmux control client failed twice: {}",
                exit.reason
            ));
            for key in orphans {
                self.end_view(key, WatchEndReason::Error, Some(message.clone()));
            }
            return;
        }
        if orphans.is_empty() {
            return;
        }
        let owner = match self.client_for(exit.endpoint, exit.session) {
            Some(client) => client,
            None => match self.spawn_client(
                exit.endpoint,
                exit.session,
                exit.session_name.clone(),
                Some((exit.at + RESPAWN_DELAY, exit.at)),
            ) {
                Some(client) => client,
                None => {
                    let message = self.session_limit_message();
                    for key in orphans {
                        self.end_view(key, WatchEndReason::Limit, Some(message.clone()));
                    }
                    return;
                }
            },
        };
        for key in orphans {
            if let Some(view) = self.views.get_mut(&key) {
                view.phase = ViewPhase::Locating { owner };
                view.locate.needed = true;
            }
        }
    }

    pub(super) fn learned(&mut self, endpoint: usize, server: ServerInstance) {
        if let Some(old) = self.endpoints[endpoint].live.filter(|old| *old != server) {
            self.server_gone(endpoint, old);
        }
        self.endpoints[endpoint].live = Some(server);
    }

    pub(super) fn server_gone(&mut self, endpoint: usize, server: ServerInstance) {
        info!(endpoint = self.endpoints[endpoint].name, %server, "tmux server gone");
        let name = self.server_name(endpoint, server);
        self.broadcast(&ServerMsg::ServerExited { server: name });
        let views = self
            .views
            .keys()
            .filter(|key| key.endpoint == endpoint && key.server == server)
            .copied()
            .collect::<Vec<_>>();
        for key in views {
            self.drop_view(key);
        }
        let clients = self
            .clients
            .iter()
            .filter(|(_, client)| client.endpoint == endpoint && client.server() == Some(server))
            .map(|(id, _)| *id)
            .collect::<Vec<_>>();
        for client in clients {
            self.close_client(client);
        }
        self.exits
            .retain(|_, check| !(check.exit.endpoint == endpoint && check.server == Some(server)));
        if self.endpoints[endpoint].live == Some(server) {
            self.endpoints[endpoint].live = None;
        }
    }
}
