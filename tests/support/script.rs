//! The `.script` fixture format, shared by `examples/record-tmux-fixtures.rs` and the
//! replay tests. One request per line: `<offset> <tag> <op>`, where `offset` is how
//! many `.out` bytes the session had been fed when the request was made. Free text
//! (input text and bytes, paste paths) is hex.
#![allow(dead_code)]

use std::fmt::Write as _;
use std::path::PathBuf;

use bytes::Bytes;
use tether::tmux::{InputItem, Op, PaneId, SessionId, Size, Tag, WindowId};

#[derive(Debug)]
pub struct Request {
    pub offset: usize,
    pub tag: Tag,
    pub op: Op,
}

pub fn encode(offset: usize, tag: Tag, op: &Op) -> String {
    let op = match op {
        Op::Locate { session } => format!("locate {session}"),
        Op::Snapshot { pane } => format!("snapshot {pane}"),
        Op::Release { pane } => format!("release {pane}"),
        Op::Vote { window, size, take } => format!(
            "vote {window} {}x{}{}",
            size.cols,
            size.rows,
            if *take { " take" } else { "" }
        ),
        Op::ClearVote { window } => format!("clear-vote {window}"),
        Op::Subscribe { window } => format!("subscribe {window}"),
        Op::Unsubscribe { window } => format!("unsubscribe {window}"),
        Op::History { pane, start, end } => format!("history {pane} {start} {end}"),
        Op::Input { window, items } => {
            let mut line = format!("input {window}");
            for item in items {
                match item {
                    InputItem::Text(text) => write!(line, " text:{}", hex(text.as_bytes())),
                    InputItem::Bytes(bytes) => write!(line, " bytes:{}", hex(bytes)),
                    InputItem::Key(name) => write!(line, " key:{name}"),
                }
                .expect("write to a String");
            }
            line
        }
        Op::Paste {
            window,
            path,
            enter,
        } => format!(
            "paste {window} {}{}",
            hex(path.to_str().expect("UTF-8 paste path").as_bytes()),
            if *enter { " enter" } else { "" }
        ),
        _ => panic!("unexpected operation in a fixture script"),
    };
    format!("{offset} {} {op}", tag.0)
}

pub fn decode(line: &str) -> Request {
    let mut words = line.split(' ');
    let mut next = || {
        words
            .next()
            .unwrap_or_else(|| panic!("short script line: {line}"))
    };
    let offset = next().parse().expect("script offset");
    let tag = Tag(next().parse().expect("script tag"));
    let kind = next();
    let window = |word: &str| WindowId::parse(word.as_bytes()).expect("window id");
    let pane = |word: &str| PaneId::parse(word.as_bytes()).expect("pane id");
    let op = match kind {
        "locate" => Op::Locate {
            session: SessionId::parse(next().as_bytes()).expect("session id"),
        },
        "snapshot" => Op::Snapshot { pane: pane(next()) },
        "release" => Op::Release { pane: pane(next()) },
        "vote" => {
            let window = window(next());
            let (cols, rows) = next().split_once('x').expect("CxR");
            let take = words.next() == Some("take");
            Op::Vote {
                window,
                size: Size {
                    cols: cols.parse().expect("cols"),
                    rows: rows.parse().expect("rows"),
                },
                take,
            }
        }
        "clear-vote" => Op::ClearVote {
            window: window(next()),
        },
        "subscribe" => Op::Subscribe {
            window: window(next()),
        },
        "unsubscribe" => Op::Unsubscribe {
            window: window(next()),
        },
        "history" => Op::History {
            pane: pane(next()),
            start: next().parse().expect("start"),
            end: next().parse().expect("end"),
        },
        "input" => {
            let window = window(next());
            let items = words
                .map(|word| match word.split_once(':').expect("input item") {
                    ("text", text) => {
                        InputItem::Text(String::from_utf8(unhex(text)).expect("UTF-8 text"))
                    }
                    ("bytes", bytes) => InputItem::Bytes(Bytes::from(unhex(bytes))),
                    ("key", name) => InputItem::Key(name.to_owned()),
                    (other, _) => panic!("unknown input item {other}"),
                })
                .collect();
            Op::Input { window, items }
        }
        "paste" => {
            let window = window(next());
            let path = PathBuf::from(String::from_utf8(unhex(next())).expect("UTF-8 path"));
            let enter = words.next() == Some("enter");
            Op::Paste {
                window,
                path,
                enter,
            }
        }
        other => panic!("unknown script op {other}"),
    };
    Request { offset, tag, op }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn unhex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&text[index..index + 2], 16).expect("hex byte"))
        .collect()
}
