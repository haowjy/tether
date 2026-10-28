//! The hub task (daemon-core.md §2): waits on its two inboxes and its timer, feeds each
//! input to `State`, and executes the effects. It owns the pumps' line senders, the
//! connections' channels and the one-shot tasks; it never waits on any of them, except
//! for the pumps at shutdown.

use std::collections::{BTreeMap, VecDeque};
use std::time::{Duration, Instant};

use tokio::sync::mpsc::{self, error::TrySendError};
use tokio::task::JoinSet;
use tracing::{error, warn};

use super::state::{Effect, Input, MAIN, State};
use super::{CONN_CHANNEL, ConnId, ConnectReply, FromConn, HubMsg, INBOX, ToConn};
use crate::blocking::Busy;
use crate::tmux::{ClientId, Endpoint, OneShotCmd, PumpMsg, TmuxError, oneshot, pump};

/// How long a stop waits for the one-shot in flight and the hook's removal: under the
/// daemon's 2 s wait for the hub (`HUB_WAIT`), with room for the pumps to end.
const BELL_STOP_WAIT: Duration = Duration::from_millis(1500);

/// What the executor holds for `State`. Its maps mirror the state's: an entry goes when
/// the state's `CloseClient` or `DropConn` says so, or when its channel fails first.
struct Io {
    lines: BTreeMap<ClientId, mpsc::Sender<String>>,
    conns: BTreeMap<ConnId, mpsc::Sender<ToConn>>,
    pumps: mpsc::Sender<(ClientId, PumpMsg)>,
    /// One task per pump, ending with it: a pump that panicked still gets its `Exited`
    /// here. Finished ones are reaped at the next spawn.
    pump_tasks: JoinSet<()>,
    /// The one-shot tasks, so a stop can wait for the one in flight.
    oneshots: JoinSet<()>,
    /// Weak, so the hub ends once every `HubHandle` is dropped.
    inbox: mpsc::WeakSender<HubMsg>,
    next_conn: u64,
}

pub(super) async fn run(
    mut state: State,
    mut inbox: mpsc::Receiver<HubMsg>,
    weak_inbox: mpsc::WeakSender<HubMsg>,
) {
    let (pumps, mut pump_out) = mpsc::channel(INBOX);
    let mut io = Io {
        lines: BTreeMap::new(),
        conns: BTreeMap::new(),
        pumps,
        pump_tasks: JoinSet::new(),
        oneshots: JoinSet::new(),
        inbox: weak_inbox,
        next_conn: 1,
    };
    // Once at start, before any connection: an older build's hook entry is rewritten.
    bell_hook(&state.endpoints[MAIN].endpoint, OneShotCmd::AdoptBellHook).await;
    loop {
        let deadline = state.next_deadline().map(tokio::time::Instant::from_std);
        let input = tokio::select! {
            Some((client, msg)) = pump_out.recv() => Input::Pump(client, msg),
            msg = inbox.recv() => match msg {
                None | Some(HubMsg::Stop) => break,
                Some(HubMsg::Connect(reply)) => match io.connect(reply) {
                    Some(conn) => Input::Connected(conn),
                    None => continue,
                },
                Some(HubMsg::Conn(conn, msg)) => Input::Conn(conn, msg),
                Some(HubMsg::OneShot(tag, result)) => Input::OneShot(tag, result),
            },
            () = sleep_until(deadline) => Input::Tick,
        };
        let mut inputs = VecDeque::from([input]);
        while let Some(input) = inputs.pop_front() {
            for effect in state.handle(input, Instant::now()) {
                io.execute(effect, &mut inputs);
            }
        }
    }
    // Nothing reads the inbox past here: closing it makes a late one-shot's send fail at once
    // instead of waiting on a full inbox, which would hold the hook removal to its timeout.
    drop(inbox);
    io.shut_down(pump_out, &state.endpoints[MAIN].endpoint)
        .await;
}

/// Adopts or removes tether's `alert-bell` entry (daemon-core.md §4.8) outside the hub's
/// one-shot slot: nothing else runs yet or any more. A failure costs only the entry's
/// tidiness, and no tmux server is not one.
async fn bell_hook(endpoint: &Endpoint, cmd: OneShotCmd) {
    match oneshot::run(endpoint, &cmd).await {
        Ok(_) | Err(TmuxError::NoServer) => {}
        Err(error) => warn!(?cmd, %error, "can't update the tmux bell hook"),
    }
}

async fn sleep_until(deadline: Option<tokio::time::Instant>) {
    match deadline {
        Some(deadline) => tokio::time::sleep_until(deadline).await,
        None => std::future::pending().await,
    }
}

impl Io {
    /// Registers a connection, unless it stopped waiting for the answer: then nothing
    /// is kept for it.
    fn connect(&mut self, reply: ConnectReply) -> Option<ConnId> {
        let conn = ConnId(self.next_conn);
        self.next_conn += 1;
        let (sender, receiver) = mpsc::channel(CONN_CHANNEL);
        reply.send((conn, receiver)).ok()?;
        self.conns.insert(conn, sender);
        Some(conn)
    }

    /// Closes every control client's stdin and waits for each pump to see its tmux
    /// exit, reading and dropping what tmux still writes. Returning sooner would leave
    /// the pumps to the runtime's end, which kills `tmux -C` (`kill_on_drop`). tmux
    /// itself is unaffected either way. Meanwhile tether's `alert-bell` entry is removed,
    /// once the one-shot in flight has finished: its install could land after the
    /// removal otherwise. That wait is cut short to stay inside the daemon's wait for the
    /// hub; a leftover entry is adopted at the next start.
    async fn shut_down(
        mut self,
        mut pump_out: mpsc::Receiver<(ClientId, PumpMsg)>,
        tmux: &Endpoint,
    ) {
        self.lines.clear();
        self.conns.clear();
        let remove_hook = async {
            while self.oneshots.join_next().await.is_some() {}
            bell_hook(tmux, OneShotCmd::RemoveBellHook).await;
        };
        let remove_hook = tokio::time::timeout(BELL_STOP_WAIT, remove_hook);
        let drain_pumps = async {
            loop {
                tokio::select! {
                    joined = self.pump_tasks.join_next() => if joined.is_none() {
                        return;
                    },
                    // `self.pumps` keeps this open, so it never resolves to `None`.
                    _ = pump_out.recv() => {}
                }
            }
        };
        // A timeout only means the entry stays.
        let _ = tokio::join!(remove_hook, drain_pumps);
    }

    /// Runs one effect. A failure the state must hear about becomes a follow-up input.
    fn execute(&mut self, effect: Effect, inputs: &mut VecDeque<Input>) {
        match effect {
            Effect::SpawnClient {
                client,
                endpoint,
                session,
            } => {
                let (lines, task) = pump::spawn(&endpoint, session, client, self.pumps.clone());
                self.lines.insert(client, lines);
                while self.pump_tasks.try_join_next().is_some() {}
                // The pump's last message is `Exited`, unless its task panicked.
                let pumps = self.pumps.clone();
                self.pump_tasks.spawn(async move {
                    if task.await.is_err() {
                        let stderr_tail = "the tmux pump task panicked".to_owned();
                        let _ = pumps.send((client, PumpMsg::Exited { stderr_tail })).await;
                    }
                });
            }
            Effect::Write { client, lines } => {
                let Some(sender) = self.lines.get(&client) else {
                    return;
                };
                for line in lines {
                    match sender.try_send(line) {
                        // Closed: the pump has ended and its `Exited` is on the way.
                        Ok(()) | Err(TrySendError::Closed(_)) => {}
                        Err(TrySendError::Full(_)) => {
                            // The channel is as deep as the in-flight cap, so this is a
                            // bug: end the client like a crash.
                            error!(
                                client = client.0,
                                "tmux line channel full; closing the client"
                            );
                            self.lines.remove(&client);
                            let stderr_tail = "the hub's line channel filled".to_owned();
                            inputs.push_back(Input::Pump(client, PumpMsg::Exited { stderr_tail }));
                            return;
                        }
                    }
                }
            }
            Effect::CloseClient { client } => {
                self.lines.remove(&client);
            }
            Effect::OneShot { tag, endpoint, cmd } => {
                let Some(inbox) = self.inbox.upgrade() else {
                    return;
                };
                while self.oneshots.try_join_next().is_some() {}
                self.oneshots.spawn(async move {
                    let result = oneshot::run(&endpoint, &cmd).await;
                    let _ = inbox.send(HubMsg::OneShot(tag, result)).await;
                });
            }
            Effect::Send { conn, msg } => {
                let Some(sender) = self.conns.get(&conn) else {
                    return;
                };
                match sender.try_send(msg) {
                    Ok(()) => {}
                    Err(TrySendError::Full(_)) => {
                        warn!(conn = conn.0, "connection channel full: wedged");
                        self.conns.remove(&conn);
                        inputs.push_back(Input::Conn(conn, FromConn::Closed));
                    }
                    Err(TrySendError::Closed(_)) => {
                        self.conns.remove(&conn);
                        inputs.push_back(Input::Conn(conn, FromConn::Closed));
                    }
                }
            }
            Effect::DropConn { conn } => {
                self.conns.remove(&conn);
            }
            Effect::RemoveFile { file } => {
                tokio::spawn(async move {
                    let path = file.path.clone();
                    match file.lane.run(move || std::fs::remove_file(path)).await {
                        Ok(Ok(())) => {}
                        Ok(Err(error)) => {
                            warn!(path = %file.path.display(), %error, "can't remove a paste file");
                        }
                        Err(Busy) => {
                            warn!(path = %file.path.display(), "no thread to remove a paste file")
                        }
                    }
                    // Dropping it frees its paste slot.
                    drop(file);
                });
            }
        }
    }
}
