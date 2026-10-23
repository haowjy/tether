//! The tmux bridge against a real tmux (daemon-core.md §8): `Session` fed by the real
//! pump, and the one-shots. The snapshot boundary at full output speed, snapshots torn
//! by a waiting hook, a Gap with a terminal client attached, and what the hub sees for
//! each way a control client ends. Each test starts its own private server (`-L`,
//! `nice -n 10`). They run only with `TETHER_TMUX_TESTS=1`, one at a time (floods would
//! skew each other's timing); `TETHER_TMUX` picks the tmux binary.

#[path = "support/terminal.rs"]
mod terminal;
#[path = "support/tmux_server.rs"]
mod tmux_server;

use std::env;
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use bytes::Bytes;
use tether::hub::INBOX;
use tether::tmux::{
    ClientId, Created, Endpoint, Event, Found, Location, OneShotCmd, Op, PaneId, PumpMsg, Reply,
    ServerInstance, Session, SessionId, SessionLocation, Size, Socket, Step, Tag, TmuxError,
    TmuxVersion, WindowId, oneshot, pump,
};
use tokio::sync::mpsc::{self, error::TrySendError};
use tokio::task::JoinHandle;

use terminal::terminal;
use tmux_server::{SESSION, Server, setup, socket, tmux};

const WAIT: Duration = Duration::from_secs(10);
const QUIET: Duration = Duration::from_millis(150);
/// Snapshots taken under each flood.
const SNAPSHOTS: usize = 200;
/// Every this many snapshots, one is fed all the output after it, not only the output
/// up to the next snapshot.
const SAMPLE: usize = 25;

/// The hub's side of one control client: a `Session` fed by the real pump.
struct Client {
    session: Session,
    lines: Option<mpsc::Sender<String>>,
    inbox: mpsc::Receiver<(ClientId, PumpMsg)>,
    pump: JoinHandle<()>,
    events: Vec<Event>,
    /// Every line the session wrote, in order.
    sent: Vec<String>,
    /// The pump's `Exited`, once it came.
    exited: Option<String>,
    next_tag: u64,
}

impl Client {
    fn spawn(endpoint: &Endpoint, session: SessionId) -> Self {
        let (out, inbox) = mpsc::channel(INBOX);
        let (lines, pump) = pump::spawn(endpoint, session, ClientId(7), out);
        let (session, step) = Session::new();
        let mut client = Self {
            session,
            lines: Some(lines),
            inbox,
            pump,
            events: Vec::new(),
            sent: Vec::new(),
            exited: None,
            next_tag: 1,
        };
        client.apply(step);
        client
    }

    async fn attach(server: &Server, session: SessionId) -> Self {
        let mut client = Self::spawn(&server.endpoint(), session);
        client
            .wait_for("Ready", |event| matches!(event, Event::Ready { .. }))
            .await;
        client
    }

    fn apply(&mut self, step: Step) {
        for line in step.lines {
            self.sent.push(line.clone());
            if let Some(lines) = &self.lines {
                match lines.try_send(line) {
                    // Closed: the pump has ended, and its Exited is on the way.
                    Ok(()) | Err(TrySendError::Closed(_)) => {}
                    Err(TrySendError::Full(_)) => panic!("the line channel is full"),
                }
            }
        }
        for event in &step.events {
            assert!(!matches!(event, Event::Fatal(_)), "{event:?}");
        }
        self.events.extend(step.events);
    }

    /// Feeds the pump's next message if one comes within `wait`; false on a timeout and
    /// once the pump has exited.
    async fn next(&mut self, wait: Duration) -> bool {
        if self.exited.is_some() {
            return false;
        }
        match tokio::time::timeout(wait, self.inbox.recv()).await {
            Ok(Some((client, message))) => {
                assert_eq!(client, ClientId(7));
                match message {
                    PumpMsg::Bytes(bytes) => {
                        let step = self.session.feed(&bytes);
                        self.apply(step);
                        true
                    }
                    PumpMsg::Exited { stderr_tail } => {
                        self.exited = Some(stderr_tail);
                        false
                    }
                }
            }
            Ok(None) => panic!("the pump ended without Exited"),
            Err(_) => false,
        }
    }

    async fn wait_from(
        &mut self,
        start: usize,
        what: &str,
        mut found: impl FnMut(&Event) -> bool,
    ) -> Event {
        let deadline = Instant::now() + WAIT;
        let mut checked = start;
        loop {
            if let Some(event) = self.events[checked..].iter().find(|event| found(event)) {
                return event.clone();
            }
            checked = self.events.len();
            let left = deadline.saturating_duration_since(Instant::now());
            assert!(!left.is_zero(), "no {what} within {WAIT:?}");
            assert!(self.exited.is_none(), "the client exited before {what}");
            self.next(left).await;
        }
    }

    async fn wait_for(&mut self, what: &str, found: impl FnMut(&Event) -> bool) -> Event {
        self.wait_from(self.events.len(), what, found).await
    }

    /// Feeds until nothing arrives for `QUIET`.
    async fn settle(&mut self) {
        while self.next(QUIET).await {}
    }

    /// Feeds for `duration`, however busy the stream is.
    async fn feed_for(&mut self, duration: Duration) {
        let deadline = Instant::now() + duration;
        while self.exited.is_none() {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return;
            }
            self.next(left).await;
        }
    }

    /// Feeds until `pane`'s output from event `start` on contains `needle`.
    async fn wait_for_output(&mut self, start: usize, pane: PaneId, needle: &[u8]) {
        let deadline = Instant::now() + WAIT;
        let mut checked = start;
        let mut window = Vec::new();
        loop {
            for event in &self.events[checked..] {
                if let Event::Output { pane: from, bytes } = event {
                    if *from != pane {
                        continue;
                    }
                    window.extend_from_slice(bytes);
                    if window.windows(needle.len()).any(|bytes| bytes == needle) {
                        return;
                    }
                    let keep = window.len().saturating_sub(needle.len());
                    window.drain(..keep);
                }
            }
            checked = self.events.len();
            let left = deadline.saturating_duration_since(Instant::now());
            assert!(
                !left.is_zero(),
                "no {:?} within {WAIT:?}",
                String::from_utf8_lossy(needle)
            );
            assert!(self.exited.is_none(), "the client exited");
            self.next(left).await;
        }
    }

    fn request(&mut self, op: Op) -> Tag {
        let tag = Tag(self.next_tag);
        self.next_tag += 1;
        let step = self.session.request(tag, op);
        self.apply(step);
        tag
    }

    /// Requests `op` and feeds until its `Done` or `Snapshot`.
    async fn run(&mut self, op: Op) -> Event {
        let start = self.events.len();
        let tag = self.request(op);
        self.wait_from(start, "an answer", |event| match event {
            Event::Done { tag: done, .. } | Event::Snapshot { tag: done, .. } => *done == tag,
            _ => false,
        })
        .await
    }

    async fn snapshot(&mut self, pane: PaneId) -> Event {
        let event = self.run(Op::Snapshot { pane }).await;
        assert!(matches!(event, Event::Snapshot { .. }), "{event:?}");
        event
    }

    /// Feeds until the pump's `Exited`; its stderr tail.
    async fn exit(&mut self) -> String {
        let deadline = Instant::now() + WAIT;
        while self.exited.is_none() {
            let left = deadline.saturating_duration_since(Instant::now());
            assert!(!left.is_zero(), "the pump didn't exit within {WAIT:?}");
            self.next(left).await;
        }
        assert!(self.inbox.recv().await.is_none(), "a message after Exited");
        (&mut self.pump).await.expect("the pump task ends cleanly");
        self.exited.clone().unwrap_or_default()
    }

    fn server(&self) -> ServerInstance {
        self.events
            .iter()
            .find_map(|event| match event {
                Event::Ready { server, .. } => Some(*server),
                _ => None,
            })
            .expect("Ready")
    }
}

/// A snapshot of a run: its size, restore bytes, and how many bytes of the pane's
/// output came before it.
struct Snap {
    size: Size,
    restore: Bytes,
    offset: usize,
}

impl Snap {
    fn restored(&self) -> vt100::Parser {
        let mut term = terminal(self.size);
        term.process(&self.restore);
        term
    }
}

/// `pane`'s snapshots in `events`, and all of its output.
fn snaps(events: &[Event], pane: PaneId) -> (Vec<Snap>, Vec<u8>) {
    let mut snaps = Vec::new();
    let mut output = Vec::new();
    for event in events {
        match event {
            Event::Output { pane: from, bytes } if *from == pane => {
                output.extend_from_slice(bytes);
            }
            Event::Snapshot {
                pane: of,
                size,
                restore,
                ..
            } if *of == pane => snaps.push(Snap {
                size: *size,
                restore: restore.clone(),
                offset: output.len(),
            }),
            _ => {}
        }
    }
    (snaps, output)
}

/// The boundary promise for every snapshot of a run whose last snapshot was taken once
/// the pane was quiet: a restore plus every later byte ends as that last one. Checked
/// link by link (a restore plus the output up to the next snapshot is the next
/// restore), and from every `SAMPLE`th snapshot through all the output after it.
/// Returns how many snapshots had output between them and the next.
fn check_restores(snaps: &[Snap], output: &[u8], name: &str) -> usize {
    let mut live = 0;
    for (index, pair) in snaps.windows(2).enumerate() {
        let between = &output[pair[0].offset..pair[1].offset];
        live += usize::from(!between.is_empty());
        let mut continued = pair[0].restored();
        continued.process(between);
        let expected = pair[1].restored();
        assert_eq!(
            screen_text(&continued, pair[0].size),
            screen_text(&expected, pair[1].size),
            "{name}: snapshot {index} plus its output isn't the next snapshot"
        );
    }
    let last = snaps.last().expect("a final snapshot");
    let last_look = screen_text(&last.restored(), last.size);
    for (index, snap) in snaps.iter().enumerate().step_by(SAMPLE) {
        let mut continued = snap.restored();
        continued.process(&output[snap.offset..]);
        assert_eq!(
            screen_text(&continued, snap.size),
            last_look,
            "{name}: snapshot {index} plus every later byte isn't the final screen"
        );
    }
    live
}

/// Cell text, cursor, (hidden cursor, alternate screen), (application cursor, keypad),
/// and the mouse protocol.
type ScreenText = (
    Vec<String>,
    (u16, u16),
    (bool, bool),
    (bool, bool),
    (vt100::MouseProtocolMode, vt100::MouseProtocolEncoding),
);

/// Text, foreground, background, bold, dim, italic, underline, inverse.
type CellStyle = (
    String,
    vt100::Color,
    vt100::Color,
    bool,
    bool,
    bool,
    bool,
    bool,
);

/// The captured screen and modes. The SGR pen is not part of tmux's snapshot state,
/// so styling after replaying output across a snapshot boundary is not comparable.
fn screen_text(term: &vt100::Parser, size: Size) -> ScreenText {
    let screen = term.screen();
    let cells = (0..size.rows)
        .flat_map(|row| (0..size.cols).map(move |col| (row, col)))
        .map(|(row, col)| {
            let contents = screen.cell(row, col).expect("cell in bounds").contents();
            if contents.is_empty() {
                " ".to_owned()
            } else {
                contents.to_owned()
            }
        })
        .collect();
    (
        cells,
        screen.cursor_position(),
        (screen.hide_cursor(), screen.alternate_screen()),
        (screen.application_cursor(), screen.application_keypad()),
        (
            screen.mouse_protocol_mode(),
            screen.mouse_protocol_encoding(),
        ),
    )
}

/// Cell styling is still part of each captured snapshot; compare it against tmux at
/// the same boundary, separately from replay where the unreported pen can matter.
fn screen_styles(term: &vt100::Parser, size: Size) -> Vec<CellStyle> {
    let screen = term.screen();
    (0..size.rows)
        .flat_map(|row| (0..size.cols).map(move |col| (row, col)))
        .map(|(row, col)| {
            let cell = screen.cell(row, col).expect("cell in bounds");
            let blank = cell.contents().is_empty() || cell.contents() == " ";
            (
                cell.contents().to_owned(),
                if blank {
                    vt100::Color::Default
                } else {
                    cell.fgcolor()
                },
                cell.bgcolor(),
                cell.bold(),
                cell.dim(),
                cell.italic(),
                cell.underline(),
                cell.inverse(),
            )
        })
        .collect()
}

/// A restore against tmux's own capture of the pane: text, styling, cursor, alternate screen.
fn check_against_tmux(server: &Server, snap: &Snap, pane: &str) {
    let restored = snap.restored();
    let screen = restored.screen();
    let trimmed = |rows: Vec<String>| {
        let mut rows: Vec<String> = rows.iter().map(|row| row.trim_end().to_owned()).collect();
        while rows.last().is_some_and(String::is_empty) {
            rows.pop();
        }
        rows
    };
    let captured = server
        .run(&["capture-pane", "-e", "-p", "-t", pane])
        .expect("styled capture-pane");
    let mut tmux_screen = terminal(snap.size);
    for (row, line) in captured
        .lines()
        .enumerate()
        .take(usize::from(snap.size.rows))
    {
        tmux_screen.process(format!("\x1b[{};1H", row + 1).as_bytes());
        tmux_screen.process(line.trim_end_matches('\r').as_bytes());
    }
    let tmux = tmux_screen.screen();
    let ours = trimmed(screen.rows(0, snap.size.cols).collect());
    let captured = trimmed(tmux.rows(0, snap.size.cols).collect());
    let ours_styles = screen_styles(&restored, snap.size);
    let tmux_styles = screen_styles(&tmux_screen, snap.size);
    let mismatches: Vec<_> = ours_styles
        .iter()
        .zip(&tmux_styles)
        .enumerate()
        .filter(|(_, (ours, tmux))| !tmux.0.is_empty() && ours != tmux)
        .take(12)
        .collect();
    assert!(mismatches.is_empty(), "style mismatches: {mismatches:?}");
    assert_eq!(ours, captured, "the restored screen isn't tmux's");
    let state = server
        .run(&[
            "display-message",
            "-p",
            "-t",
            pane,
            "#{cursor_x} #{cursor_y} #{alternate_on}",
        ])
        .expect("display-message");
    let fields: Vec<u16> = state
        .split_whitespace()
        .map(|field| field.parse().expect("a number"))
        .collect();
    let [x, y, alternate] = fields[..] else {
        panic!("state: {state:?}");
    };
    // A pending wrap reports the column past the last; restore can't express it.
    let x = x.min(snap.size.cols - 1);
    assert_eq!(screen.cursor_position(), (y, x), "cursor");
    assert_eq!(
        screen.alternate_screen(),
        alternate == 1,
        "alternate screen"
    );
}

/// The number of an `L<n>` line, `\r` and all.
fn numbered(line: &[u8]) -> Option<u32> {
    let digits = line.strip_prefix(b"L")?;
    let digits = digits.strip_suffix(b"\r").unwrap_or(digits);
    if digits.is_empty() || !digits.iter().all(u8::is_ascii_digit) {
        return None;
    }
    std::str::from_utf8(digits).ok()?.parse().ok()
}

/// The numbered lines of each snapshot's screen followed by all the output after it
/// are `L<a>`..`L<last>`, each once and in order. Computed from one pass over the
/// output: per snapshot, only its screen and the line it was half-way through are new.
fn check_numbered_once(snaps: &[Snap], output: &[u8]) {
    // Every complete line of the output: where its `\n` is, and its number.
    let mut lines = Vec::new();
    let mut start = 0;
    for (at, byte) in output.iter().enumerate() {
        if *byte == b'\n' {
            lines.push((at, numbered(&output[start..at])));
            start = at + 1;
        }
    }
    let last = lines
        .iter()
        .rev()
        .find_map(|(_, number)| *number)
        .expect("numbered output");
    // From line `i` on: the first numbered line, and whether they count up to `last`.
    let mut first_from = vec![None; lines.len() + 1];
    let mut counts_up_from = vec![true; lines.len() + 1];
    for i in (0..lines.len()).rev() {
        let next = first_from[i + 1];
        first_from[i] = lines[i].1.or(next);
        counts_up_from[i] = counts_up_from[i + 1]
            && lines[i]
                .1
                .is_none_or(|number| next.map_or(number == last, |next| number + 1 == next));
    }
    assert!(counts_up_from[0], "the live output skips or repeats a line");
    for (index, snap) in snaps.iter().enumerate() {
        let restored = snap.restored();
        let rows: Vec<String> = restored.screen().rows(0, snap.size.cols).collect();
        let cursor_row = usize::from(restored.screen().cursor_position().0);
        let mut numbers: Vec<u32> = rows[..cursor_row]
            .iter()
            .filter_map(|row| numbered(row.trim_end().as_bytes()))
            .collect();
        // The cursor row may hold the line the pane was half-way through printing.
        let after = lines.partition_point(|(end, _)| *end < snap.offset);
        let rest_of_line = match lines.get(after) {
            Some((end, _)) => &output[snap.offset..*end],
            None => &output[snap.offset..],
        };
        let mut junction = rows[cursor_row].trim_end().as_bytes().to_vec();
        junction.extend_from_slice(rest_of_line);
        numbers.extend(numbered(&junction));
        numbers.extend(first_from.get(after + 1).copied().flatten());
        let Some(&end) = numbers.last() else {
            continue;
        };
        let first = numbers[0];
        assert_eq!(
            numbers,
            (first..=end).collect::<Vec<_>>(),
            "snapshot {index}: a numbered line is lost or repeated at the boundary"
        );
        assert!(counts_up_from[(after + 1).min(lines.len())]);
        if first_from.get(after + 1).copied().flatten().is_none() {
            assert_eq!(end, last, "snapshot {index}: lines after it are missing");
        }
    }
}

/// A shell loop in pane `%0` that runs until `stop`; `$STOP` in its body is the file
/// whose existence ends it.
struct Flood {
    stop: PathBuf,
    _script: tmux_server::TempScript,
}

impl Flood {
    fn start(server: &Server, body: &str) -> Self {
        let stop = env::temp_dir().join(format!("{}.stop", server.socket));
        let _ = std::fs::remove_file(&stop);
        let script = server
            .start_script("%0", &body.replace("$STOP", &stop.display().to_string()))
            .expect("start the flood");
        Self {
            stop,
            _script: script,
        }
    }

    fn stop(&self) {
        std::fs::write(&self.stop, "").expect("stop the flood");
    }
}

impl Drop for Flood {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.stop);
    }
}

/// Takes `SNAPSHOTS` snapshots of `%0` while it floods, `spacing` apart, stops the
/// flood, waits for `done` and quiet, and takes a final snapshot.
async fn snapshots_under_flood(
    client: &mut Client,
    server: &Server,
    body: &str,
    spacing: Duration,
    flowing: &[u8],
    done: &[u8],
) -> (Vec<Snap>, Vec<u8>) {
    client.snapshot(PaneId(0)).await;
    client.settle().await;
    let start = client.events.len();
    let flood = Flood::start(server, body);
    client.wait_for_output(start, PaneId(0), flowing).await;
    let began = Instant::now();
    for _ in 0..SNAPSHOTS {
        client.snapshot(PaneId(0)).await;
        client.feed_for(spacing).await;
    }
    let took = began.elapsed();
    flood.stop();
    client.wait_for_output(start, PaneId(0), done).await;
    client.settle().await;
    client.snapshot(PaneId(0)).await;
    let (snaps, output) = snaps(&client.events, PaneId(0));
    eprintln!(
        "{SNAPSHOTS} snapshots in {took:?}; {} bytes of output",
        output.len()
    );
    (snaps, output)
}

const NUMBERED: &str =
    "stty -echo\ni=0\nwhile [ ! -e $STOP ]; do i=$((i+1)); echo L$i; done\necho FLOW-DONE\n";

#[tokio::test]
async fn history_ranges_clamp_and_snapshots_restore_soft_wraps() {
    let Some((_serial, server)) = setup("history-wrap").await else {
        return;
    };
    server
        .run(&["set-option", "-g", "history-limit", "40"])
        .expect("set history limit");
    server
        .run(&["resize-window", "-t", "@0", "-x", "12", "-y", "3"])
        .expect("set a narrow pane");
    let mut client = Client::attach(&server, SessionId(0)).await;
    client.snapshot(PaneId(0)).await;
    server
        .type_line("%0", "stty -echo; printf 'READY\\n'")
        .expect("disable echo");
    client.wait_for_output(0, PaneId(0), b"READY\r\n").await;
    client.settle().await;

    let marker = b"WRAP-ABCDEFGHIJKLMNO";
    let mut output_start = client.events.len();
    server
        .type_line(
            "%0",
            "printf 'before\\nWRAP-ABCDEFGHIJKLMNO\\nafter-one\\nafter-two\\nhistory-done\\n'",
        )
        .expect("write wrapped history");
    client
        .wait_for_output(output_start, PaneId(0), b"history-done\r\n")
        .await;
    client.settle().await;

    let bounds = server
        .run(&[
            "display-message",
            "-p",
            "-t",
            "%0",
            "#{history_size} #{pane_height}",
        ])
        .expect("read bounds");
    let [history_size, pane_height] = bounds
        .split_whitespace()
        .map(|value| value.parse::<u32>().expect("numeric bounds"))
        .collect::<Vec<_>>()[..]
    else {
        panic!("bounds: {bounds:?}");
    };
    let top = -(history_size as i32);
    let history = match client
        .run(Op::History {
            pane: PaneId(0),
            start: -10_000,
            end: 10,
        })
        .await
    {
        Event::Done {
            result: Ok(Reply::History(history)),
            ..
        } => history,
        event => panic!("history capture: {event:?}"),
    };
    assert_eq!(history.start, top);
    assert_eq!(history.rows.len(), (history_size + pane_height) as usize);
    let joined = history.rows.windows(2).enumerate().find(|(index, pair)| {
        let mut text = pair[0].to_vec();
        text.extend_from_slice(&pair[1]);
        text.windows(marker.len()).any(|part| part == marker)
            && history
                .wraps
                .get(index / 8)
                .is_some_and(|bits| bits & (1 << (index % 8)) != 0)
    });
    assert!(
        joined.is_some(),
        "history omitted the wrapped marker or its bit"
    );

    let empty = match client
        .run(Op::History {
            pane: PaneId(0),
            start: top - 10,
            end: top - 1,
        })
        .await
    {
        Event::Done {
            result: Ok(Reply::History(history)),
            ..
        } => history,
        event => panic!("above-top history capture: {event:?}"),
    };
    assert_eq!(empty.start, top);
    assert!(empty.rows.is_empty());

    output_start = client.events.len();
    server
        .type_line("%0", "printf '\\033[2J\\033[HWRAP-ABCDEFGHIJKLMNO\\n'")
        .expect("write wrapped active screen");
    client
        .wait_for_output(output_start, PaneId(0), marker)
        .await;
    client.settle().await;
    let snapshot = match client.snapshot(PaneId(0)).await {
        Event::Snapshot { size, restore, .. } => (size, restore),
        event => panic!("snapshot: {event:?}"),
    };
    let copied = Command::new("node")
        .current_dir("web")
        .args([
            "--input-type=module",
            "-e",
            r#"
import pkg from '@xterm/headless';
const { Terminal } = pkg;
const [encoded, cols, rows] = process.argv.slice(1);
const terminal = new Terminal({ cols: Number(cols), rows: Number(rows), scrollback: 0, allowProposedApi: true });
await new Promise((resolve) => terminal.write(Buffer.from(encoded, 'base64'), resolve));
const buffer = terminal.buffer.active;
let copied = '';
let wrapped = false;
for (let row = 0; row < buffer.length; row++) {
  const line = buffer.getLine(row);
  if (!line) continue;
  wrapped ||= line.isWrapped;
  copied += line.translateToString(true);
  if (!buffer.getLine(row + 1)?.isWrapped) copied += '\n';
}
terminal.dispose();
if (!wrapped || !copied.includes('WRAP-ABCDEFGHIJKLMNO')) {
  console.error(JSON.stringify({ wrapped, copied }));
  process.exitCode = 1;
}
"#,
            &STANDARD.encode(&snapshot.1),
            &snapshot.0.cols.to_string(),
            &snapshot.0.rows.to_string(),
        ])
        .output()
        .expect("run the headless xterm copy check");
    let diagnostic = String::from_utf8_lossy(&copied.stderr)
        .lines()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");
    assert!(
        copied.status.success(),
        "headless xterm didn't copy the wrapped line ({:?}): {diagnostic}",
        copied.status
    );

    let output_start = client.events.len();
    let flood = Flood::start(&server, TICKS);
    client
        .wait_for_output(output_start, PaneId(0), b"L20\r\n")
        .await;
    server
        .run(&[
            "set-hook",
            "-g",
            "after-display-message",
            "run-shell 'sleep 0.3'",
        ])
        .expect("install a waiting hook");
    assert!(matches!(
        client
            .run(Op::History {
                pane: PaneId(0),
                start: -10,
                end: -1,
            })
            .await,
        Event::Done {
            result: Err(TmuxError::Torn),
            ..
        }
    ));
    server
        .run(&["set-hook", "-gu", "after-display-message"])
        .expect("remove the waiting hook");
    flood.stop();
    client
        .wait_for_output(output_start, PaneId(0), b"FLOW-DONE\r\n")
        .await;
}

#[tokio::test]
async fn numbered_lines_at_full_speed_cross_every_snapshot_boundary_once() {
    let Some((_serial, server)) = setup("lines").await else {
        return;
    };
    let mut client = Client::attach(&server, SessionId(0)).await;
    let (snaps, output) = snapshots_under_flood(
        &mut client,
        &server,
        NUMBERED,
        Duration::from_millis(5),
        b"L1000\r\n",
        b"FLOW-DONE\r\n",
    )
    .await;
    // The first snapshot came before the flood; the last, after it.
    let flooded = &snaps[1..];
    let live = check_restores(flooded, &output, "numbered lines");
    assert!(
        live > SNAPSHOTS / 2,
        "only {live} snapshots had output after them"
    );
    check_numbered_once(flooded, &output);
    check_against_tmux(&server, snaps.last().expect("final"), "%0");
}

/// A full-screen program redrawing as fast as it can: a header and status row, a
/// scrolling region of coloured rows, application keys, button mouse tracking and a
/// hidden cursor, on the alternate screen over a primary with content.
const TUI: &str = r#"stty -echo
printf 'primary one\nprimary two\n'
printf '\033[?1049h\033[H\033[2J\033[?1h\033=\033[?1002h\033[?1006h\033[?25l'
printf '\033[1;7m tui header \033[K\033[0m\033[24;1H\033[44;37m status \033[K\033[0m\033[2;23r'
i=0
while [ ! -e $STOP ]; do
  i=$((i+1))
  printf '\033[1;20H\033[1;7m%d\033[0m\033[23;1H\n\033[3%dmrow %d\033[0m \033[4munder\033[0m\033[24;20H\033[44;37m%d\033[0m' $i $((i%7+1)) $i $i
done
printf '\033[24;40H\033[44;37mTUI-DONE\033[0m'
read a
printf '\033[?1049l\033[r\033[?25h\033[?1l\033>\033[?1002l\033[?1006l'
"#;

#[tokio::test]
async fn an_alternate_screen_tui_at_full_speed_restores_at_every_snapshot() {
    let Some((_serial, server)) = setup("tui").await else {
        return;
    };
    let mut client = Client::attach(&server, SessionId(0)).await;
    let (snaps, output) = snapshots_under_flood(
        &mut client,
        &server,
        TUI,
        Duration::ZERO,
        b"row 1000",
        b"TUI-DONE",
    )
    .await;
    let flooded = &snaps[1..];
    let live = check_restores(flooded, &output, "tui");
    assert!(
        live > SNAPSHOTS / 2,
        "only {live} snapshots had output after them"
    );
    let last = snaps.last().expect("final");
    assert!(last.restored().screen().alternate_screen());
    check_against_tmux(&server, last, "%0");
    server
        .run(&["send-keys", "-t", "%0", "Enter"])
        .expect("end the tui");
}

/// Numbered lines every few milliseconds, until the stop file exists.
const TICKS: &str = "stty -echo\ni=0\nwhile [ ! -e $STOP ]; do i=$((i+1)); echo L$i; sleep 0.005; done\necho FLOW-DONE\n";

#[tokio::test]
async fn a_waiting_hook_tears_every_snapshot_and_a_non_waiting_one_none() {
    let Some((_serial, server)) = setup("torn").await else {
        return;
    };
    let mut client = Client::attach(&server, SessionId(0)).await;
    client.snapshot(PaneId(0)).await;
    let start = client.events.len();
    let flood = Flood::start(&server, TICKS);
    client.wait_for_output(start, PaneId(0), b"L20\r\n").await;

    // A hook that doesn't wait only adds a block between the replies.
    let hook = |command: &str| {
        server
            .run(&["set-hook", "-g", "after-display-message", command])
            .expect("set-hook");
    };
    hook("display-message -p HOOKED");
    for _ in 0..5 {
        client.snapshot(PaneId(0)).await;
    }

    // A waiting one lets the pane's output in mid-list: every attempt is torn.
    hook("run-shell 'sleep 0.3'");
    let sent_before = client.sent.len();
    let events_before = client.events.len();
    for _ in 0..2 {
        let event = client.run(Op::Snapshot { pane: PaneId(0) }).await;
        assert!(
            matches!(
                event,
                Event::Done {
                    result: Err(TmuxError::Torn),
                    ..
                }
            ),
            "{event:?}"
        );
    }
    let attempts = client.sent[sent_before..]
        .iter()
        .filter(|line| line.starts_with("refresh-client -A '%0:continue'"))
        .count();
    assert_eq!(attempts, 6, "3 attempts per snapshot");
    assert!(
        !client.events[events_before..]
            .iter()
            .any(|event| matches!(event, Event::Snapshot { .. })),
        "a torn snapshot was delivered"
    );

    server
        .run(&["set-hook", "-gu", "after-display-message"])
        .expect("unset the hook");
    flood.stop();
    client
        .wait_for_output(start, PaneId(0), b"FLOW-DONE\r\n")
        .await;
    client.settle().await;
    client.snapshot(PaneId(0)).await;
    let (snaps, output) = snaps(&client.events, PaneId(0));
    assert_eq!(snaps.len(), 7, "every whole snapshot was delivered");
    check_restores(&snaps[1..], &output, "hooks");
    check_numbered_once(&snaps[1..], &output);
}

/// Starts a full-speed numbered flood in `%0` on a client that wants the pane, and
/// stalls for `stall` without reading the pump, then catches up for a second.
async fn stall_under_flood(server: &Server, stall: Duration) -> (Client, Flood) {
    let mut client = Client::attach(server, SessionId(0)).await;
    client.snapshot(PaneId(0)).await;
    client.settle().await;
    let start = client.events.len();
    let flood = Flood::start(server, NUMBERED);
    client.wait_for_output(start, PaneId(0), b"L1000\r\n").await;
    // The pump fills the hub's channel, then stops reading; tmux queues behind it.
    tokio::time::sleep(stall).await;
    client.feed_for(Duration::from_secs(1)).await;
    (client, flood)
}

#[tokio::test]
async fn a_stalled_client_gets_a_gap_with_a_terminal_client_attached() {
    let Some((_serial, server)) = setup("gap").await else {
        return;
    };
    let mut laptop = server.attach_terminal().expect("attach a terminal client");
    let (mut client, flood) = stall_under_flood(&server, Duration::from_secs(7)).await;
    client
        .wait_from(0, "a Gap", |event| matches!(event, Event::Gap { .. }))
        .await;
    // The next snapshot resumes the pane and is its catch-up.
    let start = client.events.len();
    client.snapshot(PaneId(0)).await;
    flood.stop();
    client
        .wait_for_output(start, PaneId(0), b"FLOW-DONE\r\n")
        .await;
    client.settle().await;
    client.snapshot(PaneId(0)).await;
    let _ = laptop.kill();
    let _ = laptop.wait();
    let (snaps, output) = snaps(&client.events[start..], PaneId(0));
    check_restores(&snaps, &output, "after a gap");
    check_numbered_once(&snaps, &output);
}

#[tokio::test]
async fn a_stall_shorter_than_pause_after_loses_nothing_with_only_control_clients() {
    let Some((_serial, server)) = setup("no-gap").await else {
        return;
    };
    let (mut client, flood) = stall_under_flood(&server, Duration::from_secs(2)).await;
    flood.stop();
    client.wait_for_output(0, PaneId(0), b"FLOW-DONE\r\n").await;
    client.settle().await;
    client.snapshot(PaneId(0)).await;
    assert!(
        !client
            .events
            .iter()
            .any(|event| matches!(event, Event::Gap { .. })),
        "a Gap with only control clients attached"
    );
    let (snaps, output) = snaps(&client.events, PaneId(0));
    check_numbered_once(&snaps[1..], &output);
}

async fn locate_session(endpoint: &Endpoint, session: SessionId) -> Result<Reply, TmuxError> {
    oneshot::run(endpoint, &OneShotCmd::LocateSession { session }).await
}

#[tokio::test]
async fn kill_server_ends_the_client_with_exit_and_then_there_is_no_server() {
    let Some((_serial, server)) = setup("kill-server").await else {
        return;
    };
    let mut client = Client::attach(&server, SessionId(0)).await;
    server.run(&["kill-server"]).expect("kill-server");
    client.exit().await;
    assert!(client.session.exit_seen());
    assert_eq!(
        locate_session(&server.endpoint(), SessionId(0)).await,
        Err(TmuxError::NoServer)
    );
}

#[tokio::test]
async fn kill_session_ends_the_client_with_exit_and_the_session_is_gone() {
    let Some((_serial, server)) = setup("kill-session").await else {
        return;
    };
    server
        .run(&["new-session", "-d", "-s", "other"])
        .expect("another session keeps the server up");
    let mut client = Client::attach(&server, SessionId(0)).await;
    server
        .run(&["kill-session", "-t", SESSION])
        .expect("kill-session");
    client.exit().await;
    assert!(client.session.exit_seen());
    assert_eq!(
        locate_session(&server.endpoint(), SessionId(0)).await,
        Ok(Reply::SessionLocation(SessionLocation {
            server: client.server(),
            exists: false
        }))
    );
}

#[tokio::test]
async fn a_detached_client_ends_with_exit_and_its_session_lives() {
    let Some((_serial, server)) = setup("detach").await else {
        return;
    };
    let mut client = Client::attach(&server, SessionId(0)).await;
    server
        .run(&["detach-client", "-s", SESSION])
        .expect("detach-client");
    client.exit().await;
    assert!(client.session.exit_seen());
    assert_eq!(
        locate_session(&server.endpoint(), SessionId(0)).await,
        Ok(Reply::SessionLocation(SessionLocation {
            server: client.server(),
            exists: true
        }))
    );
}

#[tokio::test]
async fn a_killed_control_client_ends_without_exit_and_its_session_lives() {
    let Some((_serial, server)) = setup("sigkill").await else {
        return;
    };
    let mut client = Client::attach(&server, SessionId(0)).await;
    let clients = server
        .run(&["list-clients", "-F", "#{client_pid} #{client_control_mode}"])
        .expect("list-clients");
    let pid = clients
        .lines()
        .find_map(|line| line.strip_suffix(" 1"))
        .expect("the control client");
    let killed = Command::new("kill")
        .args(["-KILL", pid])
        .status()
        .expect("kill");
    assert!(killed.success());
    client.exit().await;
    assert!(!client.session.exit_seen(), "a crash has no %exit");
    assert_eq!(
        locate_session(&server.endpoint(), SessionId(0)).await,
        Ok(Reply::SessionLocation(SessionLocation {
            server: client.server(),
            exists: true
        }))
    );
}

#[tokio::test]
async fn dropping_the_line_sender_closes_the_client_within_a_second() {
    let Some((_serial, server)) = setup("close").await else {
        return;
    };
    let mut client = Client::attach(&server, SessionId(0)).await;
    let began = Instant::now();
    client.lines = None;
    let stderr_tail = client.exit().await;
    assert!(
        began.elapsed() < Duration::from_secs(1),
        "{:?}",
        began.elapsed()
    );
    assert_eq!(stderr_tail, "");
    let clients = server
        .run(&["list-clients", "-F", "#{client_pid}"])
        .expect("list-clients");
    assert_eq!(clients.trim(), "", "the control client is gone");
    assert!(server.run(&["has-session", "-t", SESSION]).is_ok());
}

#[tokio::test]
async fn a_moved_window_is_unlinked_and_found_in_its_new_session() {
    let Some((_serial, server)) = setup("move").await else {
        return;
    };
    let endpoint = server.endpoint();
    let id = |text: String| WindowId::parse(text.trim().as_bytes()).expect("a window id");
    server
        .run(&["new-session", "-d", "-s", "other"])
        .expect("new-session");
    let moved = id(server
        .run(&[
            "new-window",
            "-d",
            "-t",
            SESSION,
            "-P",
            "-F",
            "#{window_id}",
        ])
        .expect("new-window"));
    let mut client = Client::attach(&server, SessionId(0)).await;
    server
        .run(&["move-window", "-s", &moved.to_string(), "-t", "other:"])
        .expect("move-window");
    client
        .wait_for("WindowUnlinked", |event| {
            *event == Event::WindowUnlinked { window: moved }
        })
        .await;
    let found = |reply: Event| match reply {
        Event::Done {
            result:
                Ok(Reply::Location(Location {
                    found: Some(Found { session, .. }),
                    ..
                })),
            ..
        } => session,
        other => panic!("{other:?}"),
    };
    assert_eq!(
        found(client.run(Op::Locate { window: moved }).await),
        SessionId(1)
    );

    // A session's last window: moving it out ends the session and its client.
    let solo = id(server
        .run(&[
            "new-session",
            "-d",
            "-s",
            "solo",
            "-P",
            "-F",
            "#{window_id}",
        ])
        .expect("new-session"));
    let mut solo_client = Client::attach(&server, SessionId(2)).await;
    server
        .run(&["move-window", "-s", &solo.to_string(), "-t", "other:"])
        .expect("move-window");
    solo_client.exit().await;
    assert!(solo_client.session.exit_seen());
    assert_eq!(
        locate_session(&endpoint, SessionId(2)).await,
        Ok(Reply::SessionLocation(SessionLocation {
            server: client.server(),
            exists: false
        }))
    );
    let location = oneshot::run(&endpoint, &OneShotCmd::Locate { window: solo }).await;
    assert!(
        matches!(
            location,
            Ok(Reply::Location(Location {
                found: Some(Found {
                    session: SessionId(1),
                    ..
                }),
                ..
            }))
        ),
        "{location:?}"
    );
    // The first client is untouched.
    assert!(client.exited.is_none());
}

#[tokio::test]
async fn with_no_server_neither_the_pump_nor_a_one_shot_starts_one() {
    let Some((_serial, server)) = setup("no-server").await else {
        return;
    };
    // A stale socket: the server died without removing it.
    let pid = server
        .run(&["display-message", "-p", "#{pid}"])
        .expect("pid");
    let killed = Command::new("kill")
        .args(["-KILL", pid.trim()])
        .status()
        .expect("kill");
    assert!(killed.success());
    // And a socket that was never there.
    let missing = Endpoint {
        program: tmux(),
        socket: Socket::Name(socket("never")),
    };
    for endpoint in [server.endpoint(), missing] {
        let mut client = Client::spawn(&endpoint, SessionId(0));
        let stderr_tail = client.exit().await;
        assert!(client.events.is_empty(), "{:?}", client.events);
        assert!(
            stderr_tail.starts_with("no server running on ")
                || stderr_tail.starts_with("error connecting to "),
            "{stderr_tail}"
        );
        for cmd in [
            OneShotCmd::List,
            OneShotCmd::LocateSession {
                session: SessionId(0),
            },
            OneShotCmd::NewSession {
                name: None,
                dir: None,
            },
        ] {
            assert_eq!(
                oneshot::run(&endpoint, &cmd).await,
                Err(TmuxError::NoServer),
                "{cmd:?}"
            );
        }
        let Socket::Name(name) = &endpoint.socket else {
            unreachable!()
        };
        let alive = Command::new(tmux())
            .args(["-N", "-L", name, "has-session"])
            .output()
            .expect("tmux");
        assert!(!alive.status.success(), "a server started on {name}");
    }
}

#[tokio::test]
async fn the_listing_names_sessions_windows_and_terminal_clients() {
    let Some((_serial, server)) = setup("list").await else {
        return;
    };
    let endpoint = server.endpoint();
    let version = TmuxVersion::parse(
        server
            .run(&["display-message", "-p", "#{version}"])
            .expect("tmux version")
            .trim(),
    );
    let tab_name = match version {
        // tmux 3.7b rejects control characters in names; 3.4 remains the version
        // that exercises a tab inside the listing's tab-delimited window name.
        TmuxVersion::Known {
            major: 3, minor: 4, ..
        } => "tab\there 中",
        _ => "tab here 中",
    };
    server
        .run(&["new-session", "-d", "-s", "watched", "-n", tab_name])
        .expect("new-session");
    server
        .run(&["new-window", "-d", "-t", "watched", "-n", "second"])
        .expect("new-window");
    let mut laptop = server.attach_terminal().expect("attach a terminal client");
    let mut client = Client::attach(&server, SessionId(1)).await;
    let reply = oneshot::run(&endpoint, &OneShotCmd::List).await;
    let _ = laptop.kill();
    let _ = laptop.wait();
    let Ok(Reply::Listing(listing)) = reply else {
        panic!("{reply:?}");
    };
    assert_eq!(listing.server, client.server());
    assert!(listing.version.is_supported());
    let sessions: Vec<_> = listing
        .sessions
        .iter()
        .map(|session| {
            (
                session.id,
                session.name.as_str(),
                session.attached_elsewhere,
                session
                    .windows
                    .iter()
                    .map(|window| (window.index, window.name.as_str(), window.active))
                    .collect::<Vec<_>>(),
            )
        })
        .collect();
    assert_eq!(sessions.len(), 2);
    assert_eq!(sessions[0].0, SessionId(0));
    assert_eq!(sessions[0].1, SESSION);
    assert!(sessions[0].2);
    assert_eq!(sessions[0].3.len(), 1);
    assert_eq!(sessions[0].3[0].0, 0);
    assert!(sessions[0].3[0].2);
    assert_eq!(
        sessions[1],
        (
            SessionId(1),
            "watched",
            false,
            vec![(0, tab_name, true), (1, "second", false)]
        )
    );
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_secs();
    assert!(listing.sessions[1].windows[0].activity.abs_diff(now) < 60);
    client.lines = None;
    client.exit().await;
}

#[tokio::test]
async fn new_windows_and_sessions_take_names_and_directories_as_given() {
    let Some((_serial, server)) = setup("create").await else {
        return;
    };
    let endpoint = server.endpoint();
    let dir = env::temp_dir().join(format!("{}-we ird'#{{pane_id}};", server.socket));
    std::fs::create_dir_all(&dir).expect("create the directory");
    let dir = std::fs::canonicalize(dir).expect("canonical temporary directory");
    /// Removes the directory even if the test fails.
    struct Remove(PathBuf);
    impl Drop for Remove {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let _remove = Remove(dir.clone());
    // tmux itself writes `$HOME` in a name as `\$HOME`, so the name has no `$`.
    let name = "we ird'#{pane_id};";
    let server_instance = || {
        let text = server
            .run(&["display-message", "-p", "#{pid} #{start_time}"])
            .expect("server");
        let (pid, start_time) = text.trim().split_once(' ').expect("two fields");
        ServerInstance {
            pid: pid.parse().expect("pid"),
            start_time: start_time.parse().expect("start time"),
        }
    };
    let check = |created: Result<Reply, TmuxError>| {
        let Ok(Reply::Created(Created {
            server: instance,
            session,
            window,
        })) = created
        else {
            panic!("{created:?}");
        };
        assert_eq!(instance, server_instance());
        let text = server
            .run(&[
                "display-message",
                "-p",
                "-t",
                &window.to_string(),
                "#{session_id}\n#{window_name}\n#{pane_current_path}",
            ])
            .expect("display-message");
        let fields: Vec<&str> = text.trim_end().split('\n').collect();
        assert_eq!(fields[0], session.to_string());
        (fields[1].to_owned(), fields[2].to_owned(), session)
    };
    // A session id from another run of the server names some other session: tmux
    // checks the instance before it creates anything.
    let windows = || server.run(&["list-windows", "-a"]).expect("list-windows");
    let before = windows();
    let other_run = ServerInstance {
        pid: server_instance().pid,
        start_time: server_instance().start_time - 1,
    };
    assert_eq!(
        oneshot::run(
            &endpoint,
            &OneShotCmd::NewWindow {
                server: other_run,
                session: SessionId(0),
                name: Some(name.to_owned()),
                dir: None,
            },
        )
        .await,
        Err(TmuxError::NoServer)
    );
    assert_eq!(windows(), before, "a window was created");
    let window = oneshot::run(
        &endpoint,
        &OneShotCmd::NewWindow {
            server: server_instance(),
            session: SessionId(0),
            name: Some(name.to_owned()),
            dir: Some(dir.clone()),
        },
    )
    .await;
    let (window_name, path, session) = check(window);
    assert_eq!(
        (window_name.as_str(), PathBuf::from(path), session),
        (name, dir.clone(), SessionId(0))
    );
    let created = oneshot::run(
        &endpoint,
        &OneShotCmd::NewSession {
            name: Some("x;".to_owned()),
            dir: Some(dir.clone()),
        },
    )
    .await;
    let (_window_name, path, session) = check(created);
    assert_eq!(PathBuf::from(path), dir.clone());
    let session_name = server
        .run(&[
            "display-message",
            "-p",
            "-t",
            &session.to_string(),
            "#{session_name}",
        ])
        .expect("session name");
    assert_eq!(session_name.trim_end(), "x;");
    assert_eq!(
        oneshot::run(
            &endpoint,
            &OneShotCmd::NewWindow {
                server: server_instance(),
                session: SessionId(99),
                name: None,
                dir: None,
            },
        )
        .await,
        Err(TmuxError::Command("can't find session: $99".to_owned()))
    );
    assert!(matches!(
        oneshot::run(
            &endpoint,
            &OneShotCmd::NewSession {
                name: Some("a\nb".to_owned()),
                dir: None,
            },
        )
        .await,
        Err(TmuxError::BadRequest(_))
    ));
    let gone = oneshot::run(
        &endpoint,
        &OneShotCmd::Locate {
            window: WindowId(99),
        },
    )
    .await;
    assert!(
        matches!(gone, Ok(Reply::Location(Location { found: None, .. }))),
        "{gone:?}"
    );
}

#[tokio::test]
async fn a_one_shot_that_hangs_is_killed_at_the_timeout() {
    let Some((_serial, server)) = setup("timeout").await else {
        return;
    };
    let pid = server
        .run(&["display-message", "-p", "#{pid}"])
        .expect("pid")
        .trim()
        .to_owned();
    let signal = |name: &str| {
        let status = Command::new("kill")
            .args([name, &pid])
            .status()
            .expect("kill");
        assert!(status.success());
    };
    /// Wakes the server even if the test fails, so it can be killed.
    struct Resume<F: Fn(&str)>(F);
    impl<F: Fn(&str)> Drop for Resume<F> {
        fn drop(&mut self) {
            (self.0)("-CONT");
        }
    }
    signal("-STOP");
    let _resume = Resume(signal);
    let began = Instant::now();
    let result = oneshot::run(&server.endpoint(), &OneShotCmd::List).await;
    let took = began.elapsed();
    assert_eq!(result, Err(TmuxError::Timeout));
    assert!(took >= oneshot::TIMEOUT && took < oneshot::TIMEOUT + Duration::from_millis(500));
    // The killed tmux is reaped: no child of ours is left.
    tokio::time::sleep(Duration::from_millis(200)).await;
    let children = Command::new("pgrep")
        .args(["-P", &std::process::id().to_string()])
        .output()
        .expect("pgrep");
    assert_eq!(String::from_utf8_lossy(&children.stdout).trim(), "");
}
