//! Who owns each watched window (daemon-core.md §4.2, §4.5): Locate answers, binding,
//! the control clients' lives, and what an exit or a dead server means for the
//! windows.

use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::time::Instant;

use tracing::{info, warn};

use super::names::cut;
use super::state::{
    Client, ClientPhase, Effect, Exit, ExitCheck, Locate, Phase, State, WinKey, Window,
};
use super::{CRASH_WINDOW, RESPAWN_DELAY};
use crate::proto::{ServerMsg, WatchEndReason};
use crate::tmux::{
    ClientId, Found, PaneId, Reply, ServerInstance, Session, SessionId, Tag, TmuxError,
    TmuxVersion, WindowId,
};

impl State {
    /// Every control client gets each rename and session change, so only the
    /// endpoint's oldest ready one reports them.
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
        // Reconcile now locates the windows waiting for it; `learned` ends any other
        // run of the server, with its windows.
        self.learned(endpoint, server);
    }

    /// The window a client owns by id.
    pub(super) fn owned(&self, client: ClientId, window: WindowId) -> Option<WinKey> {
        self.windows
            .iter()
            .find(|(key, watched)| {
                key.window == window
                    && matches!(watched.phase, Phase::Bound { owner, .. } if owner == client)
            })
            .map(|(key, _)| *key)
    }

    /// The window whose pane a client's output belongs to.
    pub(super) fn owned_pane(&self, client: ClientId, pane: PaneId) -> Option<WinKey> {
        self.windows
            .iter()
            .find(|(_, watched)| {
                matches!(watched.phase, Phase::Bound { owner, pane: shown, .. } if owner == client && shown == pane)
            })
            .map(|(key, _)| *key)
    }

    pub(super) fn located(
        &mut self,
        key: WinKey,
        tag: Tag,
        source: Option<ClientId>,
        result: Result<Reply, TmuxError>,
    ) {
        let Some(window) = self.windows.get_mut(&key) else {
            return;
        };
        if window.locate.in_flight != Some(tag) {
            return;
        }
        window.locate.in_flight = None;
        if window.locate.needed {
            // Triggered again while in flight: this answer may predate the cause.
            return;
        }
        let location = match result {
            Ok(Reply::Location(location)) => location,
            Err(TmuxError::NoServer) => return self.server_gone(key.endpoint, key.server),
            Err(error) => {
                let message = cut(format!("can't find the window: {error}"));
                return self.end_window(key, WatchEndReason::Error, Some(message));
            }
            Ok(_) => {
                let message = "can't find the window: unexpected reply".to_owned();
                return self.end_window(key, WatchEndReason::Error, Some(message));
            }
        };
        if location.server != key.server {
            self.server_gone(key.endpoint, key.server);
            return self.learned(key.endpoint, location.server);
        }
        self.learned(key.endpoint, location.server);
        match location.found {
            None => {
                let window = self.window_ref(key.endpoint, key.server, key.window);
                self.broadcast(&ServerMsg::WindowClosed { window });
                self.drop_window(key);
            }
            Some(found) => self.found(key, source, found),
        }
    }

    pub(super) fn found(&mut self, key: WinKey, source: Option<ClientId>, found: Found) {
        let Some(window) = self.windows.get_mut(&key) else {
            return;
        };
        if let Phase::Locating { after, .. } = &mut window.phase {
            if let Some(mut exit) = after.take() {
                if exit.session == found.session {
                    exit.session_name.clone_from(&found.session_name);
                    return self.after_exit(key, exit);
                }
            }
        }
        let client = match self.client_for(key.endpoint, found.session) {
            Some(client) => {
                if let Some(record) = self.clients.get_mut(&client) {
                    record.session_name.clone_from(&found.session_name);
                }
                client
            }
            None => match self.spawn_client(
                key.endpoint,
                found.session,
                found.session_name.clone(),
                None,
            ) {
                Some(client) => client,
                None => {
                    let message = self.session_limit_message();
                    return self.end_window(key, WatchEndReason::Limit, Some(message));
                }
            },
        };
        if source == Some(client) {
            self.bind(key, client, found);
        } else {
            self.join(key, client);
        }
    }

    /// The window is still in the session its owner was attached to (§4.5).
    pub(super) fn after_exit(&mut self, key: WinKey, exit: Exit) {
        if exit.detached {
            return self.end_window(key, WatchEndReason::Detached, None);
        }
        let again = exit
            .last_crash
            .is_some_and(|first| exit.at.saturating_duration_since(first) < CRASH_WINDOW);
        if again {
            let message = cut(format!(
                "the tmux control client failed twice: {}",
                exit.reason
            ));
            return self.end_window(key, WatchEndReason::Error, Some(message));
        }
        let client = match self.client_for(exit.endpoint, exit.session) {
            Some(client) => client,
            None => {
                let respawn = Some((exit.at + RESPAWN_DELAY, exit.at));
                match self.spawn_client(
                    exit.endpoint,
                    exit.session,
                    exit.session_name.clone(),
                    respawn,
                ) {
                    Some(client) => client,
                    None => {
                        let message = self.session_limit_message();
                        return self.end_window(key, WatchEndReason::Limit, Some(message));
                    }
                }
            }
        };
        self.join(key, client);
    }

    /// The window will be owned by `client`: located on it once it is ready.
    pub(super) fn join(&mut self, key: WinKey, client: ClientId) {
        let phase = Phase::Locating {
            after: None,
            on: Some(client),
        };
        self.set_phase(key, phase);
        if let Some(window) = self.windows.get_mut(&key) {
            window.locate.needed = true;
        }
    }

    pub(super) fn bind(&mut self, key: WinKey, owner: ClientId, found: Found) {
        let Some(window) = self.windows.get_mut(&key) else {
            return;
        };
        let phase = Phase::Bound {
            owner,
            session: found.session,
            pane: found.pane,
        };
        if matches!(window.phase, Phase::Bound { owner: o, session: s, pane: p }
            if o == owner && s == found.session && p == found.pane)
        {
            return;
        }
        window.phase = phase;
        window.stream.size = found.size;
        self.break_stream(key);
        self.tell(key);
    }

    /// Leaves `Bound` (or stays out of it): the stream can't be live without an owner.
    pub(super) fn set_phase(&mut self, key: WinKey, phase: Phase) {
        if let Some(window) = self.windows.get_mut(&key) {
            window.phase = phase;
            self.break_stream(key);
        }
    }

    pub(super) fn client_for(&self, endpoint: usize, session: SessionId) -> Option<ClientId> {
        self.clients
            .iter()
            .find(|(_, client)| client.endpoint == endpoint && client.session == session)
            .map(|(id, _)| *id)
    }

    /// A control client for `session`, started now or, for a crash respawn, at
    /// `respawn.0` (the crash being at `respawn.1`). `None` at the cap with none
    /// lingering.
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
                votes: BTreeMap::new(),
                subscriptions: BTreeSet::new(),
                pending: BTreeMap::new(),
                progress: self.now,
                linger: None,
                last_crash: respawn.map(|(_, crash)| crash),
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
        let (tmux, step) = Session::new();
        record.phase = ClientPhase::Starting(tmux);
        info!(client = client.0, session = %record.session, "starting tmux control client");
        self.effects.push(Effect::SpawnClient {
            client,
            endpoint: self.endpoints[record.endpoint].endpoint.clone(),
            session: record.session,
        });
        self.apply(client, 0, step);
    }

    /// Room under the control-client cap, closing the client that has lingered
    /// longest if needed.
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

    /// Names the live session slots using names from Locate. This path must not issue
    /// a one-shot just to render the refusal.
    pub(super) fn session_limit_message(&self) -> String {
        let sessions = self
            .clients
            .values()
            .map(|client| client.session_name.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>()
            .join(", ");
        cut(format!(
            "tether on {} allows {} tmux sessions at a time; open now: {sessions}",
            self.host_name, self.max_clients
        ))
    }

    /// The hub ends a control client: no session check follows.
    pub(super) fn close_client(&mut self, client: ClientId) {
        let Some(record) = self.clients.remove(&client) else {
            return;
        };
        if record.tmux().is_some() {
            self.effects.push(Effect::CloseClient { client });
        }
        self.release_windows(client, |window| {
            window.phase = Phase::Locating {
                after: None,
                on: None,
            };
            window.locate.needed = true;
        });
        for (tag, work) in record.pending {
            self.settle(client, tag, work);
        }
    }

    /// Moves every window that is, or was about to be, the client's to another phase
    /// with `to`.
    pub(super) fn release_windows(&mut self, client: ClientId, to: impl Fn(&mut Window)) {
        let keys: Vec<WinKey> = self
            .windows
            .iter()
            .filter(|(_, window)| window.client() == Some(client))
            .map(|(key, _)| *key)
            .collect();
        for key in keys {
            if let Some(window) = self.windows.get_mut(&key) {
                to(window);
            }
            self.break_stream(key);
        }
    }

    /// A control client ended on its own (`killed`: the hub killed it for a fatal error
    /// or a reply timeout). Its windows wait for a check of its session (§4.5).
    pub(super) fn client_exited(&mut self, client: ClientId, reason: String, killed: bool) {
        let Some(record) = self.clients.remove(&client) else {
            return;
        };
        self.effects.push(Effect::CloseClient { client });
        let detached = !killed && record.tmux().is_some_and(Session::exit_seen);
        info!(client = client.0, session = %record.session, detached, reason = %reason, "tmux control client ended");
        let server = record.server().or(self.endpoints[record.endpoint].live);
        self.release_windows(client, |window| {
            window.phase = Phase::Orphaned { client };
            window.locate = Locate::default();
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

    /// The answer to an exited client's session check.
    pub(super) fn checked(&mut self, exited: ClientId, tag: Tag, result: Result<Reply, TmuxError>) {
        let Some(check) = self.exits.get_mut(&exited) else {
            return;
        };
        if check.in_flight != Some(tag) {
            return;
        }
        check.in_flight = None;
        let (endpoint, server) = (check.exit.endpoint, check.server);
        let answer = match result {
            Ok(Reply::SessionLocation(answer)) => answer,
            Err(TmuxError::NoServer) => {
                if let Some(server) = server.or(self.endpoints[endpoint].live) {
                    self.server_gone(endpoint, server);
                }
                // Windows of another instance than the one that died find out themselves.
                return self.relocate_orphans(exited, None);
            }
            other => {
                let error = other.err().unwrap_or(TmuxError::BadReply);
                let message = cut(format!("can't check the tmux session: {error}"));
                self.exits.remove(&exited);
                let orphans = self.orphans(exited);
                for key in orphans {
                    self.end_window(key, WatchEndReason::Error, Some(message.clone()));
                }
                return;
            }
        };
        if let Some(old) = server.filter(|old| *old != answer.server) {
            self.server_gone(endpoint, old);
        }
        self.learned(endpoint, answer.server);
        let Some(check) = self.exits.get(&exited) else {
            return;
        };
        if !answer.exists {
            let session = self.session_ref(endpoint, answer.server, check.exit.session);
            self.broadcast(&ServerMsg::SessionClosed { session });
        }
        let exit = self.exits.get(&exited).map(|check| check.exit.clone());
        self.relocate_orphans(exited, exit);
    }

    pub(super) fn orphans(&self, exited: ClientId) -> Vec<WinKey> {
        self.windows
            .iter()
            .filter(|(_, window)| matches!(window.phase, Phase::Orphaned { client } if client == exited))
            .map(|(key, _)| *key)
            .collect()
    }

    pub(super) fn relocate_orphans(&mut self, exited: ClientId, exit: Option<Exit>) {
        self.exits.remove(&exited);
        for key in self.orphans(exited) {
            if let Some(window) = self.windows.get_mut(&key) {
                window.phase = Phase::Locating {
                    after: exit.clone(),
                    on: None,
                };
                window.locate.needed = true;
            }
        }
    }

    /// The endpoint's server is running as `server`; any other instance seen before
    /// is gone.
    pub(super) fn learned(&mut self, endpoint: usize, server: ServerInstance) {
        if let Some(old) = self.endpoints[endpoint].live.filter(|old| *old != server) {
            self.server_gone(endpoint, old);
        }
        self.endpoints[endpoint].live = Some(server);
    }

    /// Everything on that run of the server is gone: `serverExited` closes its tabs.
    pub(super) fn server_gone(&mut self, endpoint: usize, server: ServerInstance) {
        info!(endpoint = self.endpoints[endpoint].name, %server, "tmux server gone");
        let name = self.server_name(endpoint, server);
        self.broadcast(&ServerMsg::ServerExited { server: name });
        let windows: Vec<WinKey> = self
            .windows
            .keys()
            .filter(|key| key.endpoint == endpoint && key.server == server)
            .copied()
            .collect();
        for key in windows {
            self.drop_window(key);
        }
        let clients: Vec<ClientId> = self
            .clients
            .iter()
            .filter(|(_, client)| client.endpoint == endpoint && client.server() == Some(server))
            .map(|(id, _)| *id)
            .collect();
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
