//! Each connection's credit (daemon-core.md §4.6): what output may use, the
//! reservations captures and listings hold, and sending control JSON, which is never
//! refused but wedges a connection past the overdraft.

use tracing::warn;

#[cfg(debug_assertions)]
use super::LISTING_RESERVATION;
use super::names::cut;
use super::state::{Effect, State};
#[cfg(debug_assertions)]
use super::state::{OneShotWork, Work};
use super::view::{ViewKey, WatchKey};
use super::{CAPTURE_RESERVATION, CREDIT, ConnId, OVERDRAFT, ToConn, charge};
use crate::proto::{Encoded, ErrorCode, ServerMsg};
use crate::tmux::TmuxError;

impl State {
    /// Credit output may use: while one of the connection's watches waits for a
    /// snapshot it hasn't reserved yet, output fits only above that reservation.
    pub(super) fn output_room(&self, conn: ConnId) -> u64 {
        let Some(state) = self.conns.get(&conn) else {
            return 0;
        };
        let waiting = state.watches.iter().any(|(id, watch)| {
            watch.awaiting && !self.reserved_for(WatchKey { conn, watch: *id }, watch.view)
        });
        let hold = if waiting { CAPTURE_RESERVATION } else { 0 };
        CREDIT.saturating_sub(state.outstanding + state.reserved + hold)
    }

    fn reserved_for(&self, watch: WatchKey, key: ViewKey) -> bool {
        self.views
            .get(&key)
            .and_then(|window| window.stream.inflight.as_ref())
            .is_some_and(|inflight| inflight.reserved.contains(&watch))
    }

    pub(super) fn can_reserve(&self, conn: ConnId, amount: u64) -> bool {
        self.conns
            .get(&conn)
            .is_some_and(|state| state.outstanding + state.reserved + amount <= CREDIT)
    }

    pub(super) fn reserve(&mut self, conn: ConnId, amount: u64) {
        if let Some(state) = self.conns.get_mut(&conn) {
            state.reserved += amount;
        }
    }

    pub(super) fn unreserve(&mut self, conn: ConnId, amount: u64) {
        if let Some(state) = self.conns.get_mut(&conn) {
            state.reserved = state.reserved.saturating_sub(amount);
        }
    }

    /// `Conn::reserved` is a counter, since deriving it on the output path costs too
    /// much; debug builds check it against the work in flight after every input.
    #[cfg(debug_assertions)]
    pub(super) fn check_reservations(&self) {
        for (&id, conn) in &self.conns {
            debug_assert_eq!(conn.reserved, self.reservations_in_flight(id), "{id:?}");
        }
    }

    /// What `Conn::reserved` must be: a capture reservation per watch a snapshot in
    /// flight reserved for and per history capture in flight, and the listing's.
    #[cfg(debug_assertions)]
    fn reservations_in_flight(&self, conn: ConnId) -> u64 {
        let snapshots = self
            .views
            .values()
            .filter_map(|window| window.stream.inflight.as_ref())
            .flat_map(|inflight| &inflight.reserved)
            .filter(|watch| watch.conn == conn)
            .count();
        let histories = self
            .clients
            .values()
            .flat_map(|client| client.pending.values())
            .filter(|work| matches!(work, Work::History { conn: of, .. } if *of == conn))
            .count();
        let listings = match &self.oneshot {
            Some((_, OneShotWork::List { waiters })) => {
                waiters.iter().filter(|(of, _)| *of == conn).count()
            }
            _ => 0,
        };
        (snapshots + histories) as u64 * CAPTURE_RESERVATION + listings as u64 * LISTING_RESERVATION
    }

    pub(super) fn send(&mut self, conn: ConnId, msg: &ServerMsg, ends: Option<u32>) {
        self.send_encoded(conn, msg.encode(), ends);
    }

    /// Control JSON is never refused; past the overdraft the connection is wedged.
    pub(super) fn send_encoded(&mut self, conn: ConnId, json: Encoded, ends: Option<u32>) {
        let Some(state) = self.conns.get_mut(&conn) else {
            return;
        };
        state.outstanding += u64::from(charge(json.len()));
        let wedged = state.outstanding + state.reserved > CREDIT + OVERDRAFT;
        self.effects.push(Effect::Send {
            conn,
            msg: ToConn::Msg { json, ends },
        });
        if wedged {
            warn!(
                conn = conn.0,
                "connection wedged: control messages past the overdraft"
            );
            self.closed(conn);
        }
    }

    pub(super) fn broadcast(&mut self, msg: &ServerMsg) {
        let json = msg.encode();
        let conns: Vec<ConnId> = self.conns.keys().copied().collect();
        for conn in conns {
            self.send_encoded(conn, json.clone(), None);
        }
    }

    pub(super) fn refuse(
        &mut self,
        conn: ConnId,
        req: Option<u32>,
        watch: Option<u32>,
        code: ErrorCode,
        message: &str,
    ) {
        let msg = ServerMsg::Error {
            req,
            watch,
            code,
            message: cut(message.to_owned()),
        };
        self.send(conn, &msg, None);
    }

    pub(super) fn refuse_tmux(
        &mut self,
        conn: ConnId,
        req: Option<u32>,
        watch: Option<u32>,
        error: &TmuxError,
    ) {
        let code = match error {
            TmuxError::BadRequest(_) => ErrorCode::BadRequest,
            TmuxError::NoServer => ErrorCode::NoServer,
            _ => ErrorCode::Tmux,
        };
        self.refuse(conn, req, watch, code, &error.to_string());
    }
}
