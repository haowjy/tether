//! A connection's delivery queue (daemon-core.md §4.6), owned by its connection task.
//! It orders, replaces and coalesces what the hub sent, and holds no limit of its own:
//! the hub's credit bounds everything in it. Every charge it was handed goes back,
//! as written or discarded, through `take_credit`.
//!
//! The connection moves each `ToConn` in with `push` as it arrives, tells it about the
//! client's `unwatch`, writes the frames `next` hands out, reports each with `written`
//! once the socket has taken it, and sends `FromConn::Credit` whenever `take_credit`
//! is non-zero.

use std::collections::{BTreeMap, VecDeque};
use std::time::Instant;

use bytes::Bytes;

use super::{COALESCE, MAX_FRAME, ToConn};
use crate::proto::{self, frames};

#[derive(Default)]
pub struct Outbox {
    /// Control JSON, written before any pane frame.
    json: VecDeque<(String, u32)>,
    watches: BTreeMap<u32, Queue>,
    returned: u64,
}

#[derive(Default)]
struct Queue {
    items: VecDeque<Item>,
    last_frame: Option<Instant>,
}

enum Item {
    Output {
        bytes: Bytes,
        charge: u32,
    },
    Snapshot {
        size: proto::Size,
        restore: Bytes,
        charge: u32,
    },
}

impl Item {
    fn charge(&self) -> u32 {
        match self {
            Self::Output { charge, .. } | Self::Snapshot { charge, .. } => *charge,
        }
    }
}

/// A WebSocket message to write.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Frame {
    Text(String),
    Binary(Vec<u8>),
}

#[derive(Debug, PartialEq, Eq)]
pub enum Next {
    /// Write this, then report `charge` with `written`.
    Frame {
        frame: Frame,
        charge: u32,
    },
    /// Output is coalescing: nothing to write before then.
    WaitUntil(Instant),
    Idle,
}

impl Outbox {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, msg: ToConn) {
        let charge = msg.charge();
        match msg {
            ToConn::Msg { json, ends } => {
                self.json.push_back((json.into_string(), charge));
                if let Some(watch) = ends {
                    self.unwatch(watch);
                }
            }
            ToConn::Snapshot {
                watch,
                size,
                restore,
            } => {
                // It holds everything the queued frames would have shown.
                let queue = self.watches.entry(watch).or_default();
                let replaced: u64 = queue
                    .items
                    .drain(..)
                    .map(|item| u64::from(item.charge()))
                    .sum();
                queue.items.push_back(Item::Snapshot {
                    size,
                    restore,
                    charge,
                });
                self.returned += replaced;
            }
            ToConn::Output { watch, bytes } => {
                let item = Item::Output { bytes, charge };
                self.watches.entry(watch).or_default().items.push_back(item);
            }
        }
    }

    /// The client's `unwatch` (or the hub's `watchEnded`): the watch's frames are
    /// discarded. Frames for it that arrive later are still written; the client drops
    /// frames for a watch it no longer has.
    pub fn unwatch(&mut self, watch: u32) {
        if let Some(queue) = self.watches.remove(&watch) {
            self.returned += queue
                .items
                .iter()
                .map(|item| u64::from(item.charge()))
                .sum::<u64>();
        }
    }

    /// The next frame to write. JSON goes first; a watch's output goes at once if its
    /// last frame left at least `COALESCE` ago, else merged when the interval ends.
    pub fn next(&mut self, now: Instant) -> Next {
        if let Some((text, charge)) = self.json.pop_front() {
            return Next::Frame {
                frame: Frame::Text(text),
                charge,
            };
        }
        // Queues are kept only while they hold frames or their interval runs.
        self.watches.retain(|_, queue| {
            !queue.items.is_empty() || queue.last_frame.is_some_and(|at| now < at + COALESCE)
        });
        let ready = |queue: &Queue| match queue.items.front() {
            Some(Item::Snapshot { .. }) => true,
            Some(Item::Output { .. }) => queue.last_frame.is_none_or(|at| now >= at + COALESCE),
            None => false,
        };
        let pick = self
            .watches
            .iter()
            .filter(|(_, queue)| ready(queue))
            .min_by_key(|(_, queue)| queue.last_frame)
            .map(|(watch, _)| *watch);
        let Some(watch) = pick else {
            return self
                .watches
                .values()
                .filter(|queue| !queue.items.is_empty())
                .filter_map(|queue| queue.last_frame.map(|at| at + COALESCE))
                .min()
                .map_or(Next::Idle, Next::WaitUntil);
        };
        let Some(queue) = self.watches.get_mut(&watch) else {
            return Next::Idle;
        };
        queue.last_frame = Some(now);
        match queue.items.pop_front() {
            Some(Item::Snapshot {
                size,
                restore,
                charge,
            }) => Next::Frame {
                frame: Frame::Binary(frames::snapshot(watch, size, &restore)),
                charge,
            },
            Some(Item::Output { bytes, charge }) => {
                let mut length = bytes.len();
                let mut chunks = vec![bytes];
                let mut charge = charge;
                while let Some(Item::Output { bytes, .. }) = queue.items.front() {
                    if length + bytes.len() > MAX_FRAME {
                        break;
                    }
                    let Some(Item::Output {
                        bytes,
                        charge: more,
                    }) = queue.items.pop_front()
                    else {
                        break;
                    };
                    length += bytes.len();
                    charge += more;
                    chunks.push(bytes);
                }
                Next::Frame {
                    frame: Frame::Binary(frames::output(watch, &chunks)),
                    charge,
                }
            }
            None => Next::Idle,
        }
    }

    /// The socket has taken a frame `next` handed out.
    pub fn written(&mut self, charge: u32) {
        self.returned += u64::from(charge);
    }

    /// Charged bytes written or discarded since the last call: send them as
    /// `FromConn::Credit` when non-zero.
    pub fn take_credit(&mut self) -> u32 {
        let credit = u32::try_from(self.returned).unwrap_or(u32::MAX);
        self.returned -= u64::from(credit);
        credit
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::proto::{ServerMsg, frames};

    fn output(watch: u32, text: &'static str) -> ToConn {
        ToConn::Output {
            watch,
            bytes: Bytes::from_static(text.as_bytes()),
        }
    }

    /// Writes everything due at `now`: the frames, and the charges returned.
    fn drain(outbox: &mut Outbox, now: Instant) -> Vec<frames::Frame> {
        let mut written = Vec::new();
        while let Next::Frame { frame, charge } = outbox.next(now) {
            outbox.written(charge);
            match frame {
                Frame::Binary(bytes) => written.push(frames::decode(&bytes).expect("a frame")),
                Frame::Text(_) => {}
            }
        }
        written
    }

    #[test]
    fn output_coalesces_snapshots_replace_and_every_charge_comes_back() {
        let start = Instant::now();
        let mut outbox = Outbox::new();
        let mut charged = 0;
        let mut push = |outbox: &mut Outbox, msg: ToConn| {
            charged += u64::from(msg.charge());
            outbox.push(msg);
        };
        // Leading edge: the first output goes at once.
        push(&mut outbox, output(1, "a"));
        let first = drain(&mut outbox, start);
        assert_eq!(
            first,
            [frames::Frame::Output {
                watch: 1,
                bytes: Bytes::from_static(b"a")
            }]
        );
        // Within the interval, output waits and merges into one frame.
        push(&mut outbox, output(1, "b"));
        push(&mut outbox, output(1, "c"));
        assert_eq!(outbox.next(start), Next::WaitUntil(start + COALESCE));
        let merged = drain(&mut outbox, start + COALESCE);
        assert_eq!(
            merged,
            [frames::Frame::Output {
                watch: 1,
                bytes: Bytes::from_static(b"bc")
            }]
        );
        // A snapshot replaces what is queued; JSON goes before any pane frame.
        let later = start + Duration::from_secs(1);
        push(&mut outbox, output(1, "stale"));
        let size = proto::Size { cols: 80, rows: 24 };
        let restore = Bytes::from_static(b"screen");
        push(
            &mut outbox,
            ToConn::Snapshot {
                watch: 1,
                size,
                restore: restore.clone(),
            },
        );
        let json = ServerMsg::SessionsChanged.encode();
        push(&mut outbox, ToConn::Msg { json, ends: None });
        let Next::Frame {
            frame: Frame::Text(_),
            charge,
        } = outbox.next(later)
        else {
            panic!("JSON goes first");
        };
        outbox.written(charge);
        let snapshot = drain(&mut outbox, later);
        assert_eq!(
            snapshot,
            [frames::Frame::Snapshot {
                watch: 1,
                size,
                restore
            }]
        );
        // An unwatch discards the watch's queue.
        push(&mut outbox, output(1, "late"));
        push(&mut outbox, output(2, "other"));
        outbox.unwatch(1);
        assert_eq!(drain(&mut outbox, later + COALESCE).len(), 1);
        assert_eq!(u64::from(outbox.take_credit()), charged);
        assert_eq!(outbox.take_credit(), 0);
    }
}
