//! The hub task (daemon-core.md §2): waits on its two inboxes and its timer, feeds each
//! input to `State`, and executes the effects. It owns the pumps' line senders, the
//! connections' channels and the one-shot tasks; it never waits on any of them.

use std::collections::{BTreeMap, VecDeque};
use std::time::Instant;

use tokio::sync::mpsc::{self, error::TrySendError};
use tracing::{error, warn};

use super::state::{Effect, Input, State};
use super::{CONN_CHANNEL, ConnId, FromConn, HubMsg, INBOX, ToConn};
use crate::tmux::{ClientId, PumpMsg, oneshot, pump};

struct Io {
    lines: BTreeMap<ClientId, mpsc::Sender<String>>,
    conns: BTreeMap<ConnId, mpsc::Sender<ToConn>>,
    pumps: mpsc::Sender<(ClientId, PumpMsg)>,
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
        inbox: weak_inbox,
        next_conn: 1,
    };
    loop {
        let deadline = state.next_deadline().map(tokio::time::Instant::from_std);
        let input = tokio::select! {
            Some((client, msg)) = pump_out.recv() => Input::Pump(client, msg),
            msg = inbox.recv() => match msg {
                None => break,
                Some(HubMsg::Connect(reply)) => {
                    let conn = ConnId(io.next_conn);
                    io.next_conn += 1;
                    let (sender, receiver) = mpsc::channel(CONN_CHANNEL);
                    io.conns.insert(conn, sender);
                    // A connection that gave up waiting shows up as a closed channel.
                    let _ = reply.send((conn, receiver));
                    Input::Connected(conn)
                }
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
    // Dropping the line senders closes every control client's stdin; tmux is
    // unaffected. Dropping the connections' channels ends them.
}

async fn sleep_until(deadline: Option<tokio::time::Instant>) {
    match deadline {
        Some(deadline) => tokio::time::sleep_until(deadline).await,
        None => std::future::pending().await,
    }
}

impl Io {
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
                // The pump's last message is `Exited`, unless its task panicked.
                let pumps = self.pumps.clone();
                tokio::spawn(async move {
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
