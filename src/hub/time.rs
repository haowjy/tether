//! What waits on time (daemon-core.md §4.1, §4.5, §4.6): the control clients' respawns,
//! lingers and reply deadlines, and starved watches' snapshot spacing. Time comes in
//! with each input; nothing here reads a clock.

use std::time::Instant;

use tracing::warn;

use super::state::{ClientPhase, State, Watch};
use super::{REPLY_TIMEOUT, SNAPSHOT_SPACING};
use crate::tmux::ClientId;

impl State {
    /// When `handle(Input::Tick, …)` is next due: a control client's timer (`due`), or
    /// a starved watch's snapshot spacing. `None`: nothing is waiting on time. A
    /// deadline is reported until an input comes at or after it, which handles it, so
    /// one that can't be acted on then (no credit, no capture slot) can't spin.
    pub fn next_deadline(&self) -> Option<Instant> {
        // Spacing has no timer: `handle` treats the input that passes it as dirty, and
        // reconcile snapshots the watch.
        let spacing = self
            .conns
            .values()
            .flat_map(|conn| conn.watches.values())
            .filter_map(Watch::spaced_until);
        self.due()
            .map(|(at, ..)| at)
            .chain(spacing)
            .filter(|at| *at > self.now)
            .min()
    }

    /// The control clients' timers: when each is due, and what for.
    fn due(&self) -> impl Iterator<Item = (Instant, ClientId, Due)> + '_ {
        self.clients.iter().flat_map(|(&id, client)| {
            let respawn = match client.phase {
                ClientPhase::Delayed { until } => Some((until, id, Due::Respawn)),
                _ => None,
            };
            let linger = client.linger.map(|until| (until, id, Due::Linger));
            let reply = client
                .tmux()
                .filter(|tmux| tmux.in_flight() > 0)
                .map(|_| (client.progress + REPLY_TIMEOUT, id, Due::Timeout));
            [respawn, linger, reply].into_iter().flatten()
        })
    }

    pub(super) fn timers(&mut self) {
        let now = self.now;
        let due: Vec<(ClientId, Due)> = self
            .due()
            .filter(|(at, ..)| *at <= now)
            .map(|(_, client, due)| (client, due))
            .collect();
        self.dirty |= !due.is_empty();
        // A client may have several due: once a Linger or Timeout ends it, the rest find
        // it gone. A respawn can't meet a passed linger (LINGER > RESPAWN_DELAY).
        for (client, due) in due {
            match due {
                Due::Respawn => {
                    let awaited = self
                        .views
                        .values()
                        .any(|window| window.client() == Some(client));
                    if awaited {
                        self.start(client);
                    } else {
                        self.clients.remove(&client);
                    }
                }
                Due::Linger => self.close_client(client),
                Due::Timeout => {
                    let reason = format!("tmux didn't answer for {} s", REPLY_TIMEOUT.as_secs());
                    warn!(client = client.0, "{reason}");
                    self.client_exited(client, reason, true);
                }
            }
        }
    }
}

enum Due {
    Respawn,
    Linger,
    Timeout,
}

impl Watch {
    /// When a starved watch may be snapshotted again.
    pub(super) fn spaced_until(&self) -> Option<Instant> {
        let last = self
            .last_snapshot
            .filter(|_| self.awaiting && self.starved)?;
        Some(last + SNAPSHOT_SPACING)
    }
}
