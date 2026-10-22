//! The hub task (daemon-core.md §2): waits on its two inboxes and its timer, feeds each
//! input to `State`, and executes the effects. It owns the pumps' line senders, the
//! connections' channels and the one-shot tasks; it never waits on any of them, except
//! for the pumps at shutdown.

use std::collections::{BTreeMap, VecDeque};
use std::time::Instant;

use tokio::sync::mpsc::{self, error::TrySendError};
use tokio::task::JoinSet;
use tracing::{error, warn};

use super::state::{Effect, Input, State};
use super::{CONN_CHANNEL, ConnId, ConnectReply, FromConn, HubMsg, INBOX, ToConn};
use crate::tmux::{ClientId, PumpMsg, oneshot, pump};

/// What the executor holds for `State`. Its maps mirror the state's: an entry goes when
/// the state's `CloseClient` or `DropConn` says so, or when its channel fails first.
struct Io {
    lines: BTreeMap<ClientId, mpsc::Sender<String>>,
    conns: BTreeMap<ConnId, mpsc::Sender<ToConn>>,
    pumps: mpsc::Sender<(ClientId, PumpMsg)>,
    /// One task per pump, ending with it: a pump that panicked still gets its `Exited`
    /// here. Finished ones are reaped at the next spawn.
    pump_tasks: JoinSet<()>,
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
        inbox: weak_inbox,
        next_conn: 1,
    };
    loop {
        let deadline = state.next_deadline().map(tokio::time::Instant::from_std);
        let input = tokio::select! {
            Some((client, msg)) = pump_out.recv() => Input::Pump(client, msg),
            msg = inbox.recv() => match msg {
                None => break,
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
    io.shut_down(pump_out).await;
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
    /// itself is unaffected either way.
    async fn shut_down(mut self, mut pump_out: mpsc::Receiver<(ClientId, PumpMsg)>) {
        self.lines.clear();
        self.conns.clear();
        loop {
            tokio::select! {
                joined = self.pump_tasks.join_next() => if joined.is_none() {
                    return;
                },
                // `self.pumps` keeps this open, so it never resolves to `None`.
                _ = pump_out.recv() => {}
            }
        }
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
                tokio::spawn(async move {
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
                    if let Err(error) = tokio::fs::remove_file(&file.path).await {
                        warn!(path = %file.path.display(), %error, "can't remove a paste file");
                    }
                    // Dropping it frees its paste slot.
                    drop(file);
                });
            }
        }
    }
}
