//! Records `tmux::Session` fixtures against a real tmux (daemon-core.md §8).
//!
//! Each scenario starts a private server (`-L tether-fixture-<pid>-<n>`, `nice -n
//! 10`), attaches a control client exactly as the daemon does, and drives a real
//! `Session` over its pipes. Set-up the daemon would never do (splits, hooks, moves)
//! goes through one-shot `tmux` commands, outside the client's stream. It writes:
//!
//! - `<name>.out`: the client's raw stdout;
//! - `<name>.script`: each request and the stdout offset it was made at;
//! - `<name>.in`: every line the session wrote, for the replay to reproduce.
//!
//! `cargo run --example record-tmux-fixtures -- --out tests/fixtures/tmux/3.4 [name…]`

#[path = "../tests/support/script.rs"]
mod script;
#[path = "../tests/support/tmux_server.rs"]
mod tmux_server;

use tmux_server::{SESSION, Server};

use std::env;
use std::error::Error;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant};

use bytes::Bytes;
use tether::tmux::{
    Event, InputItem, Op, PaneId, Reply, Session, SessionId, Size, Tag, TmuxError, WindowId,
    command,
};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

const WAIT: Duration = Duration::from_secs(5);
const QUIET: Duration = Duration::from_millis(150);

type Scenario = fn(&mut Recorder) -> Result<()>;

const SCENARIOS: &[(&str, Scenario)] = &[
    ("startup", startup),
    ("unwanted-output", unwanted_output),
    ("pause-at-cap", pause_at_cap),
    ("snapshot-boundary", snapshot_boundary),
    ("snapshot-alternate", snapshot_alternate),
    ("snapshot-styled", snapshot_styled),
    ("snapshot-region", snapshot_region),
    ("snapshot-tui", snapshot_tui),
    ("snapshot-gone", snapshot_gone),
    ("hooks", hooks),
    ("snapshot-resized", snapshot_resized),
    ("snapshot-released", snapshot_released),
    ("gap", gap),
    ("layout", layout),
    ("windows", windows),
    ("locate", locate),
    ("subscription", subscription),
    ("paste", paste),
    ("input", input),
    ("history", history),
    ("detach", detach),
    ("kill-server", kill_server),
];

fn main() -> Result<()> {
    let mut args = env::args().skip(1);
    let mut tmux = PathBuf::from("tmux");
    let mut out = None;
    let mut only = Vec::new();
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--tmux" => tmux = args.next().ok_or("--tmux needs a path")?.into(),
            "--out" => out = Some(PathBuf::from(args.next().ok_or("--out needs a directory")?)),
            "--help" | "-h" => {
                println!("Usage: record-tmux-fixtures [--tmux PATH] --out DIRECTORY [SCENARIO…]");
                return Ok(());
            }
            name => only.push(name.to_owned()),
        }
    }
    let out = out.ok_or("--out is required")?;
    fs::create_dir_all(&out)?;
    for (index, (name, scenario)) in SCENARIOS.iter().enumerate() {
        if !only.is_empty() && !only.iter().any(|wanted| wanted == name) {
            continue;
        }
        eprintln!("recording {name}");
        let server = Server::start(
            &tmux,
            format!("tether-fixture-{}-{index}", std::process::id()),
        )?;
        let mut recorder = Recorder::attach(&server)?;
        if let Err(error) = scenario(&mut recorder) {
            // Keep what tmux sent, to see why.
            fs::write(out.join(format!("{name}.failed.out")), &recorder.raw)?;
            return Err(format!("{name}: {error}").into());
        }
        recorder.finish(&out, name)?;
    }
    Ok(())
}

struct Recorder<'a> {
    server: &'a Server,
    child: Child,
    stdin: Option<ChildStdin>,
    chunks: Receiver<Vec<u8>>,
    stalled: Arc<AtomicBool>,
    session: Session,
    raw: Vec<u8>,
    script: String,
    sent: String,
    events: Vec<Event>,
    next_tag: u64,
}

impl<'a> Recorder<'a> {
    fn attach(server: &'a Server) -> Result<Self> {
        // As the daemon spawns it (§3.1), on the private socket.
        let mut child = server
            .command()
            .arg("-N")
            .args(command::attach(SessionId(0)))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        let stdin = child.stdin.take().ok_or("stdin not piped")?;
        let mut stdout = child.stdout.take().ok_or("stdout not piped")?;
        let stalled = Arc::new(AtomicBool::new(false));
        let reader_stalled = Arc::clone(&stalled);
        let (tx, chunks) = mpsc::channel();
        thread::spawn(move || {
            let mut buffer = vec![0; 16 * 1024];
            loop {
                while reader_stalled.load(Ordering::Relaxed) {
                    thread::sleep(Duration::from_millis(10));
                }
                match stdout.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(count) => {
                        if tx.send(buffer[..count].to_vec()).is_err() {
                            break;
                        }
                    }
                }
            }
        });
        let (session, step) = Session::new();
        let mut recorder = Self {
            server,
            child,
            stdin: Some(stdin),
            chunks,
            stalled,
            session,
            raw: Vec::new(),
            script: String::new(),
            sent: String::new(),
            events: Vec::new(),
            next_tag: 1,
        };
        recorder.apply(step.lines, step.events)?;
        recorder.wait_for(|event| matches!(event, Event::Ready { .. }))?;
        Ok(recorder)
    }

    fn apply(&mut self, lines: Vec<String>, events: Vec<Event>) -> Result<()> {
        for line in lines {
            let stdin = self.stdin.as_mut().ok_or("stdin closed")?;
            stdin.write_all(line.as_bytes())?;
            stdin.write_all(b"\n")?;
            stdin.flush()?;
            self.sent.push_str(&line);
            self.sent.push('\n');
        }
        for event in &events {
            if let Event::Fatal(error) = event {
                return Err(format!("session fatal: {error}").into());
            }
        }
        self.events.extend(events);
        Ok(())
    }

    /// Feeds one chunk if it arrives within `timeout`; false on timeout or EOF.
    fn pump_once(&mut self, timeout: Duration) -> Result<bool> {
        match self.chunks.recv_timeout(timeout) {
            Ok(chunk) => {
                self.raw.extend_from_slice(&chunk);
                let step = self.session.feed(&chunk);
                self.apply(step.lines, step.events)?;
                Ok(true)
            }
            Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => Ok(false),
        }
    }

    /// Pumps until an event from now on matches, or fails after `WAIT`.
    fn wait_for(&mut self, found: impl FnMut(&Event) -> bool) -> Result<Event> {
        self.wait_from(self.events.len(), found)
    }

    fn wait_from(&mut self, start: usize, mut found: impl FnMut(&Event) -> bool) -> Result<Event> {
        let deadline = Instant::now() + WAIT;
        loop {
            if let Some(event) = self.events[start..].iter().find(|event| found(event)) {
                return Ok(event.clone());
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err("timed out waiting for an event".into());
            }
            self.pump_once(left)?;
        }
    }

    /// Pumps until nothing arrives for `QUIET`.
    fn settle(&mut self) -> Result<()> {
        while self.pump_once(QUIET)? {}
        Ok(())
    }

    /// Pumps for `duration`, however busy the stream is.
    fn pump_for(&mut self, duration: Duration) -> Result<()> {
        let deadline = Instant::now() + duration;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Ok(());
            }
            self.pump_once(left)?;
        }
    }

    fn request(&mut self, op: Op) -> Result<Tag> {
        let tag = Tag(self.next_tag);
        self.next_tag += 1;
        self.script
            .push_str(&script::encode(self.raw.len(), tag, &op));
        self.script.push('\n');
        let step = self.session.request(tag, op);
        self.apply(step.lines, step.events)?;
        Ok(tag)
    }

    /// Requests `op` and pumps until its `Done` or `Snapshot`.
    fn run(&mut self, op: Op) -> Result<Event> {
        let start = self.events.len();
        let tag = self.request(op)?;
        self.wait_from(start, |event| match event {
            Event::Done { tag: done, .. } | Event::Snapshot { tag: done, .. } => *done == tag,
            _ => false,
        })
    }

    fn output_contains(&self, needle: &[u8]) -> bool {
        let mut output = Vec::new();
        for event in &self.events {
            if let Event::Output { bytes, .. } = event {
                output.extend_from_slice(bytes);
            }
        }
        output.windows(needle.len()).any(|window| window == needle)
    }

    fn wait_for_output(&mut self, needle: &[u8]) -> Result<()> {
        let deadline = Instant::now() + WAIT;
        while !self.output_contains(needle) {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err(format!(
                    "timed out waiting for {:?}",
                    String::from_utf8_lossy(needle)
                )
                .into());
            }
            self.pump_once(left)?;
        }
        Ok(())
    }

    fn stall(&self, stalled: bool) {
        self.stalled.store(stalled, Ordering::Relaxed);
    }

    /// Closes stdin as the daemon does and records everything up to EOF.
    fn finish(mut self, out: &Path, name: &str) -> Result<()> {
        self.settle()?;
        self.stdin = None;
        let deadline = Instant::now() + WAIT;
        while Instant::now() < deadline {
            match self.chunks.recv_timeout(deadline - Instant::now()) {
                Ok(chunk) => {
                    self.raw.extend_from_slice(&chunk);
                    // Lines can no longer reach tmux, but the replay must see them.
                    let step = self.session.feed(&chunk);
                    self.events.extend(step.events);
                    for line in step.lines {
                        self.sent.push_str(&line);
                        self.sent.push('\n');
                    }
                }
                Err(_) => break,
            }
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
        fs::write(out.join(format!("{name}.out")), &self.raw)?;
        fs::write(out.join(format!("{name}.in")), &self.sent)?;
        fs::write(out.join(format!("{name}.script")), &self.script)?;
        Ok(())
    }
}

fn window(text: &str) -> WindowId {
    WindowId::parse(text.trim().as_bytes()).expect("tmux printed a window id")
}

fn expect_ok(event: Event) -> Result<()> {
    match event {
        Event::Done {
            result: Ok(Reply::Ok),
            ..
        } => Ok(()),
        other => Err(format!("expected Ok, got {other:?}").into()),
    }
}

fn startup(_: &mut Recorder) -> Result<()> {
    Ok(())
}

/// Output from panes nobody wants pauses each once, including a pane created later.
fn unwanted_output(r: &mut Recorder) -> Result<()> {
    r.server.type_line("%0", "echo one; echo two")?;
    r.settle()?;
    r.server.run(&["split-window", "-d", "-t", "%0"])?;
    r.settle()?;
    r.server.type_line("%0", "echo three")?;
    r.settle()
}

/// A pause beyond the in-flight cap waits for a reply.
fn pause_at_cap(r: &mut Recorder) -> Result<()> {
    r.stall(true);
    r.server.type_line("%0", "echo unwanted")?;
    thread::sleep(Duration::from_millis(300));
    while r.session.in_flight() < tether::tmux::MAX_IN_FLIGHT {
        r.request(Op::Locate {
            window: WindowId(0),
        })?;
    }
    r.stall(false);
    r.settle()
}

/// Numbered lines flowing through a snapshot: the boundary sits between them.
fn snapshot_boundary(r: &mut Recorder) -> Result<()> {
    r.run(Op::Snapshot { pane: PaneId(0) })?;
    r.settle()?;
    r.server.type_line(
        "%0",
        "i=0; while [ $i -lt 3000 ]; do i=$((i+1)); echo L$i; done; echo FLOW-DONE",
    )?;
    r.wait_for_output(b"L300\r\n")?;
    r.run(Op::Snapshot { pane: PaneId(0) })?;
    r.wait_for_output(b"FLOW-DONE\r\n")?;
    r.settle()
}

/// The alternate screen, modes, a scroll region and an unfinished escape sequence.
fn snapshot_alternate(r: &mut Recorder) -> Result<()> {
    r.server.type_line(
        "%0",
        "printf 'PRIMARY\\n\\033[?1049h\\033[2;3HALT\\033[?1h\\033=\\033[4h\\033[?1000h\\033[?1006h\\033[3;20r\\033[1m\\033[3'; sleep 30",
    )?;
    thread::sleep(Duration::from_millis(300));
    r.settle()?;
    r.run(Op::Snapshot { pane: PaneId(0) })?;
    expect_ok(r.run(Op::Release { pane: PaneId(0) })?)?;
    r.server.run(&["send-keys", "-t", "%0", "C-c"])?;
    r.settle()
}

/// SGR styles (one carried from a row to the next), bg-filled and full-width rows, wide and combining characters, a link,
/// custom tab stops, wrap off, a hidden cursor and bracketed paste (not in the state).
const STYLED: &str = r#"stty -echo
printf '\033[2J\033[H'
printf '\033[1;31mbold red\033[0m plain \033[4;38;5;33munderline 256\033[0m \033[7mreverse\033[0m\n'
printf '\033[38;2;10;200;30mtruecolor\033[48;2;40;40;90m bg\033[0m \033[2mdim\033[0m\n'
printf '\033[44m\033[Kblue bar to the end of the line\r\nand the pen carries to the next row\033[K\033[0m\n'
printf 'wide: \346\274\242\345\255\227\343\201\213\343\201\252 \360\237\230\200 e\314\201 end\n'
printf '0123456789012345678901234567890123456789012345678901234567890123456789012345678\033[31m9\033[0m\n'
printf '\033[3mitalic \033[9mstrike\033[0m \033]8;;http://x.example\033\\link\033]8;;\033\\ done\n'
printf '\033[3g\033[5G\033H\033[11G\033H'
printf '\033[?7l\033[?25l\033[?2004h\033[7;10H'
sleep 30
"#;

/// Origin mode inside a scroll region, any-motion mouse tracking, then output that
/// scrolls the region.
const REGION: &str = r#"stty -echo
printf '\033[2J\033[H'
i=1; while [ $i -le 23 ]; do printf 'line %02d\r\n' $i; i=$((i+1)); done; printf 'line 24'
printf '\033[5;15r\033[?6h\033[?1003h\033[?1006h'
printf '\033[3;7H\033[1mregion 3;7\033[0m\033[4;1H'
read a
printf '\033[1;1H\033[32mrelative top\033[0m\033[11;1Hbottom\r\nscrolled\r\n'
printf '\033[38;5;208mtwo\033[0m\r\nlines'
printf '\033[2;4HPART2-DONE'
read a
"#;

/// A full-screen program on the alternate screen over a primary with content: header
/// and status rows, a scrolling body region, hidden cursor, application keys, button
/// mouse tracking.
const TUI: &str = r#"stty -echo
printf '\033[2J\033[Hprimary one\nprimary two \033[32mgreen\033[0m\n$ '
printf '\033[?1049h\033[H\033[2J'
printf '\033[1;7m tui header \033[K\033[0m'
printf '\033[24;1H\033[44;37m status \033[K\033[0m'
printf '\033[2;23r\033[2;1H'
i=1; while [ $i -le 30 ]; do printf 'row %02d \033[3%dmcolor\033[0m\r\n' $i $((i%7+1)); i=$((i+1)); done
printf '\033[?1h\033=\033[?1002h\033[?1006h\033[?25l\033[10;5H'
read a
printf '\033[23;1H\r\nmore\r\nbody lines\033[24;1H\033[44;37m status 2 PART2-DONE\033[K\033[0m\033[10;5H*'
read a
printf '\033[?1049l\033[?1l\033>\033[?1002l\033[?1006l\033[?25h\033[r'
"#;

/// One snapshot of `STYLED`.
fn snapshot_styled(r: &mut Recorder) -> Result<()> {
    let _script = r.server.start_script("%0", STYLED)?;
    thread::sleep(Duration::from_millis(300));
    r.settle()?;
    r.run(Op::Snapshot { pane: PaneId(0) })?;
    expect_ok(r.run(Op::Release { pane: PaneId(0) })?)?;
    r.server.run(&["send-keys", "-t", "%0", "C-c"])?;
    r.settle()
}

/// A script stopped at its `read`s: a snapshot at each, with the output of the part in
/// between live. Enter releases a `read`.
fn two_part_script(r: &mut Recorder, script: &str) -> Result<()> {
    let _script = r.server.start_script("%0", script)?;
    thread::sleep(Duration::from_millis(300));
    r.settle()?;
    r.run(Op::Snapshot { pane: PaneId(0) })?;
    r.settle()?;
    r.server.run(&["send-keys", "-t", "%0", "Enter"])?;
    r.wait_for_output(b"PART2-DONE")?;
    r.settle()?;
    r.run(Op::Snapshot { pane: PaneId(0) })?;
    r.server.run(&["send-keys", "-t", "%0", "Enter"])?;
    r.settle()
}

fn snapshot_region(r: &mut Recorder) -> Result<()> {
    two_part_script(r, REGION)
}

fn snapshot_tui(r: &mut Recorder) -> Result<()> {
    two_part_script(r, TUI)
}

/// A snapshot of a pane that is gone fails mid-list; history of one fails at once.
fn snapshot_gone(r: &mut Recorder) -> Result<()> {
    r.run(Op::Snapshot { pane: PaneId(99) })?;
    r.run(Op::History {
        pane: PaneId(99),
        start: -5,
        end: 5,
    })?;
    r.settle()
}

/// A non-waiting hook between the replies leaves a snapshot whole; a waiting one with
/// the pane printing tears every attempt.
fn hooks(r: &mut Recorder) -> Result<()> {
    r.server.run(&[
        "set-hook",
        "-g",
        "after-display-message",
        "display-message -p HOOKED",
    ])?;
    r.run(Op::Snapshot { pane: PaneId(0) })?;
    r.server.run(&[
        "set-hook",
        "-g",
        "after-display-message",
        "run-shell 'sleep 0.3'",
    ])?;
    r.server
        .type_line("%0", "while :; do echo tick; sleep 0.01; done")?;
    r.wait_for_output(b"tick\r\n")?;
    match r.run(Op::Snapshot { pane: PaneId(0) })? {
        Event::Done {
            result: Err(TmuxError::Torn),
            ..
        } => {}
        other => return Err(format!("expected Torn, got {other:?}").into()),
    }
    r.server
        .run(&["set-hook", "-gu", "after-display-message"])?;
    r.server.run(&["send-keys", "-t", "%0", "C-c"])?;
    r.settle()
}

/// A hook that resizes the window after the snapshot's state read changes the pane
/// without printing: the state read again at the end differs, so the list goes again,
/// and the snapshot has the size tmux captured at.
fn snapshot_resized(r: &mut Recorder) -> Result<()> {
    r.server.run(&[
        "set-hook",
        "-g",
        "after-display-message",
        "resize-window -t @0 -x 100 -y 30",
    ])?;
    let snapshot = r.run(Op::Snapshot { pane: PaneId(0) })?;
    r.server
        .run(&["set-hook", "-gu", "after-display-message"])?;
    let real = r.server.run(&[
        "display-message",
        "-p",
        "-t",
        "%0",
        "#{pane_width}x#{pane_height}",
    ])?;
    match snapshot {
        Event::Snapshot { size, .. }
            if real.trim() == "100x30" && real.trim() == format!("{}x{}", size.cols, size.rows) => {
        }
        other => return Err(format!("expected a {} snapshot, got {other:?}", real.trim()).into()),
    }
    r.settle()
}

/// A snapshot torn by a waiting hook, released before its reply: it answers nothing
/// and isn't sent again, so once the release is answered tmux sends nothing more from
/// the pane.
fn snapshot_released(r: &mut Recorder) -> Result<()> {
    r.server.run(&[
        "set-hook",
        "-g",
        "after-display-message",
        "run-shell 'sleep 0.3'",
    ])?;
    r.server
        .type_line("%0", "while :; do echo tick; sleep 0.01; done")?;
    // The session pauses the unwanted pane on its first tick.
    thread::sleep(Duration::from_millis(200));
    r.settle()?;
    let start = r.events.len();
    let snapshot = r.request(Op::Snapshot { pane: PaneId(0) })?;
    let release = r.request(Op::Release { pane: PaneId(0) })?;
    expect_ok(r.wait_from(
        start,
        |event| matches!(event, Event::Done { tag, .. } if *tag == release),
    )?)?;
    let released_at = r.raw.len();
    r.pump_for(Duration::from_millis(500))?;
    let answers: Vec<&Event> = r.events[start..]
        .iter()
        .filter(|event| {
            matches!(event, Event::Done { tag, .. } | Event::Snapshot { tag, .. } if *tag == snapshot)
        })
        .collect();
    let released = Event::Done {
        tag: snapshot,
        result: Err(TmuxError::Released),
    };
    if answers != [&released] {
        return Err(format!("the released snapshot answered {answers:?}").into());
    }
    let after = &r.raw[released_at..];
    let streaming = [&b"%output %0 "[..], b"%extended-output %0 "]
        .iter()
        .any(|line| after.windows(line.len()).any(|window| window == *line));
    if streaming {
        return Err("the released pane still streams".into());
    }
    r.server
        .run(&["set-hook", "-gu", "after-display-message"])?;
    r.server.run(&["send-keys", "-t", "%0", "C-c"])?;
    r.settle()
}

/// tmux pauses a wanted pane after pause-after: a gap, healed by the next snapshot.
/// A terminal client stays attached, as the laptop would: with only control clients
/// behind, tmux stops reading the pane instead of pausing it.
fn gap(r: &mut Recorder) -> Result<()> {
    let mut laptop = r.server.attach_terminal()?;
    let result = gap_with_laptop(r);
    let _ = laptop.kill();
    let _ = laptop.wait();
    result
}

fn gap_with_laptop(r: &mut Recorder) -> Result<()> {
    r.run(Op::Snapshot { pane: PaneId(0) })?;
    r.settle()?;
    r.server
        .type_line("%0", "while :; do yes | head -c 50000; sleep 0.05; done")?;
    r.wait_for_output(b"y\r\n")?;
    r.stall(true);
    thread::sleep(Duration::from_millis(4500));
    r.stall(false);
    r.wait_for(|event| matches!(event, Event::Gap { .. }))?;
    r.server.run(&["send-keys", "-t", "%0", "C-c"])?;
    r.server.run(&["send-keys", "-t", "%0", "C-c"])?;
    r.pump_for(Duration::from_millis(300))?;
    r.run(Op::Snapshot { pane: PaneId(0) })?;
    r.settle()
}

/// A vote resizes, a split adds a pane, select-pane moves the active pane, zoom shows
/// the visible layout, clearing the vote restores the size.
fn layout(r: &mut Recorder) -> Result<()> {
    r.run(Op::Snapshot { pane: PaneId(0) })?;
    expect_ok(r.run(Op::Vote {
        window: WindowId(0),
        size: Size { cols: 60, rows: 20 },
    })?)?;
    r.settle()?;
    let new_pane = r
        .server
        .run(&["split-window", "-d", "-t", "%0", "-P", "-F", "#{pane_id}"])?;
    r.settle()?;
    r.server.run(&["select-pane", "-t", new_pane.trim()])?;
    r.settle()?;
    r.server
        .run(&["resize-pane", "-Z", "-t", new_pane.trim()])?;
    r.settle()?;
    r.server
        .run(&["resize-pane", "-Z", "-t", new_pane.trim()])?;
    r.settle()?;
    expect_ok(r.run(Op::ClearVote {
        window: WindowId(0),
    })?)?;
    r.settle()
}

/// Windows renamed, moved out and back, killed; sessions created, renamed, killed.
fn windows(r: &mut Recorder) -> Result<()> {
    r.server
        .run(&["new-session", "-d", "-s", "other", "-c", "/tmp"])?;
    r.settle()?;
    let id = r
        .server
        .run(&["new-window", "-d", "-t", "$0", "-P", "-F", "#{window_id}"])?;
    let id = id.trim().to_owned();
    r.settle()?;
    r.server
        .run(&["rename-window", "-t", &id, "name with spaces #x"])?;
    r.settle()?;
    r.server.run(&["move-window", "-s", &id, "-t", "other:"])?;
    r.settle()?;
    r.server.run(&["rename-window", "-t", &id, "elsewhere"])?;
    r.settle()?;
    r.server.run(&["move-window", "-s", &id, "-t", "$0:"])?;
    r.settle()?;
    r.server.run(&["kill-window", "-t", &id])?;
    r.settle()?;
    r.server
        .run(&["rename-session", "-t", "other", "renamed"])?;
    r.settle()?;
    r.server.run(&["kill-session", "-t", "renamed"])?;
    r.settle()
}

/// Locate a live window, one in another session, one killed and one moved; check
/// sessions alive and killed.
fn locate(r: &mut Recorder) -> Result<()> {
    r.server
        .run(&["new-session", "-d", "-s", "other", "-c", "/tmp"])?;
    let other = window(
        &r.server
            .run(&["display-message", "-p", "-t", "other", "#{window_id}"])?,
    );
    let killed =
        window(
            &r.server
                .run(&["new-window", "-d", "-t", "$0", "-P", "-F", "#{window_id}"])?,
        );
    let moved =
        window(
            &r.server
                .run(&["new-window", "-d", "-t", "$0", "-P", "-F", "#{window_id}"])?,
        );
    r.settle()?;
    r.run(Op::Locate {
        window: WindowId(0),
    })?;
    r.run(Op::Locate { window: other })?;
    r.server.run(&["kill-window", "-t", &killed.to_string()])?;
    r.server
        .run(&["move-window", "-s", &moved.to_string(), "-t", "other:"])?;
    r.settle()?;
    r.run(Op::Locate { window: killed })?;
    r.run(Op::Locate { window: moved })?;
    r.run(Op::LocateSession {
        session: SessionId(0),
    })?;
    r.server.run(&["kill-session", "-t", "other"])?;
    r.settle()?;
    r.run(Op::LocateSession {
        session: SessionId(1),
    })?;
    r.settle()
}

/// The first cwd arrives by itself, then one per change, none after unsubscribing.
fn subscription(r: &mut Recorder) -> Result<()> {
    expect_ok(r.run(Op::Subscribe {
        window: WindowId(0),
    })?)?;
    r.wait_for(|event| matches!(event, Event::Cwd { .. }))?;
    let mut laptop = r.server.attach_terminal()?;
    r.wait_for(|event| {
        matches!(
            event,
            Event::Acted {
                window: WindowId(0)
            }
        )
    })?;
    laptop
        .stdin
        .as_mut()
        .ok_or("laptop stdin is closed")?
        .write_all(b"cd /\n")?;
    r.wait_for(|event| matches!(event, Event::Cwd { path, .. } if path == "/"))?;

    // Switching away removes the laptop's entry; returning is a new act. The
    // second window is setup only, and is never itself subscribed.
    r.server.run(&["new-window", "-d", "-t", "$0"])?;
    r.settle()?;
    let acts_before_switch = r
        .events
        .iter()
        .filter(|event| {
            matches!(
                event,
                Event::Acted {
                    window: WindowId(0)
                }
            )
        })
        .count();
    laptop
        .stdin
        .as_mut()
        .ok_or("laptop stdin is closed")?
        .write_all(b"\x02n")?;
    r.pump_for(Duration::from_millis(1100))?;
    let acts_after_leaving = r
        .events
        .iter()
        .filter(|event| {
            matches!(
                event,
                Event::Acted {
                    window: WindowId(0)
                }
            )
        })
        .count();
    if acts_after_leaving != acts_before_switch {
        return Err("leaving the subscribed window was reported as an act".into());
    }
    laptop
        .stdin
        .as_mut()
        .ok_or("laptop stdin is closed")?
        .write_all(b"\x02p")?;
    r.wait_for(|event| {
        matches!(
            event,
            Event::Acted {
                window: WindowId(0)
            }
        )
    })?;

    let clients = r.server.run(&[
        "list-clients",
        "-F",
        "#{client_control_mode}\t#{client_name}",
    ])?;
    let laptop_name = clients
        .lines()
        .filter_map(|line| line.split_once('\t'))
        .find_map(|(control, name)| (control == "0").then_some(name))
        .ok_or("the pty laptop client is missing")?;
    r.server.resize_terminal(laptop_name, 90, 35)?;
    r.wait_for(|event| {
        matches!(
            event,
            Event::Acted {
                window: WindowId(0)
            }
        )
    })?;
    let acts_after_resize = r
        .events
        .iter()
        .filter(|event| {
            matches!(
                event,
                Event::Acted {
                    window: WindowId(0)
                }
            )
        })
        .count();
    r.pump_for(Duration::from_millis(1200))?;
    let acts_while_idle = r
        .events
        .iter()
        .filter(|event| {
            matches!(
                event,
                Event::Acted {
                    window: WindowId(0)
                }
            )
        })
        .count();
    if acts_while_idle != acts_after_resize {
        return Err("the idle client produced an extra act".into());
    }
    laptop.kill()?;
    let _ = laptop.wait()?;
    r.settle()?;

    expect_ok(r.run(Op::Unsubscribe {
        window: WindowId(0),
    })?)?;
    r.server.type_line("%0", "cd /tmp")?;
    r.pump_for(Duration::from_millis(1300))?;
    r.settle()
}

/// A paste through a path tmux would otherwise parse, a missing file, a gone window,
/// and a window a hook kills between `load-buffer` and `paste-buffer`. No paste leaves
/// its buffer in tmux.
fn paste(r: &mut Recorder) -> Result<()> {
    let dir = env::temp_dir().join(format!("tether-fixture-{}", std::process::id()));
    fs::create_dir_all(&dir)?;
    let result = paste_from(r, &dir);
    let _ = fs::remove_dir_all(&dir);
    result
}

fn paste_from(r: &mut Recorder, dir: &Path) -> Result<()> {
    let path = dir.join("we ird'#{pane_id}$HOME;~.txt");
    fs::write(&path, "printf PASTED-ENTER")?;
    r.run(Op::Snapshot { pane: PaneId(0) })?;
    r.server.run(&["copy-mode", "-t", "@0"])?;
    expect_ok(r.run(Op::Paste {
        window: WindowId(0),
        path: path.clone(),
        enter: true,
    })?)?;
    let pane_in_mode = r
        .server
        .run(&["display-message", "-p", "-t", "@0", "#{pane_in_mode}"])?;
    if pane_in_mode.trim() != "0" {
        return Err(
            format!("paste with Enter left the pane in copy mode: {pane_in_mode:?}").into(),
        );
    }
    r.wait_for_output(b"PASTED-ENTER\r\n")?;
    r.run(Op::Paste {
        window: WindowId(0),
        path: dir.join("missing.txt"),
        enter: true,
    })?;
    r.run(Op::Paste {
        window: WindowId(99),
        path: path.clone(),
        enter: true,
    })?;
    let secret = dir.join("secret.txt");
    fs::write(&secret, "SECRET\n")?;
    // A spare window keeps the session alive without @0.
    r.server.run(&["new-window", "-d", "-t", "$0"])?;
    r.server
        .run(&["set-hook", "-g", "after-load-buffer", "kill-window -t @0"])?;
    let killed = r.run(Op::Paste {
        window: WindowId(0),
        path: secret,
        enter: true,
    })?;
    r.server.run(&["set-hook", "-gu", "after-load-buffer"])?;
    if !matches!(
        killed,
        Event::Done {
            result: Err(TmuxError::Command(_)),
            ..
        }
    ) {
        return Err(format!("expected the killed window's paste to fail: {killed:?}").into());
    }
    r.settle()?;
    let buffers = r.server.run(&["list-buffers", "-F", "#{buffer_name}"])?;
    if !buffers.trim().is_empty() {
        return Err(format!("paste left tmux buffers behind: {buffers}").into());
    }
    Ok(())
}

/// Text as hex, keys by name (C-b reaches the pane past the prefix), raw bytes, every
/// C0 byte back through `%output`, a refused key name, a gone window.
fn input(r: &mut Recorder) -> Result<()> {
    r.run(Op::Snapshot { pane: PaneId(0) })?;
    r.settle()?;
    let text = |text: &str| InputItem::Text(text.to_owned());
    let key = |name: &str| InputItem::Key(name.to_owned());
    expect_ok(r.run(Op::Input {
        window: WindowId(0),
        items: vec![text("od -An -v -tx1 | tr -d ' \\n'"), key("Enter")],
    })?)?;
    r.settle()?;
    expect_ok(r.run(Op::Input {
        window: WindowId(0),
        items: vec![
            text("ab"),
            key("C-b"),
            key("Escape"),
            text("x"),
            InputItem::Bytes(Bytes::from_static(&[0xc3, 0xa9])),
            key("Enter"),
            key("C-d"),
        ],
    })?)?;
    r.wait_for_output(b"6162021b78c3a90a")?;
    r.settle()?;
    let c0: String = (0u8..32).map(|byte| format!("\\{byte:03o}")).collect();
    expect_ok(r.run(Op::Input {
        window: WindowId(0),
        items: vec![
            text(&format!(
                "stty -opost; printf '{c0}\\\\\\200\\377C0-DONE'; stty opost; echo"
            )),
            key("Enter"),
        ],
    })?)?;
    r.wait_for_output(b"C0-DONE")?;
    r.run(Op::Input {
        window: WindowId(0),
        items: vec![key("S-Enter")],
    })?;
    r.run(Op::Input {
        window: WindowId(99),
        items: vec![key("Enter")],
    })?;
    r.settle()
}

/// Scrollback rows, including ones that look like control-mode lines.
fn history(r: &mut Recorder) -> Result<()> {
    r.server.type_line(
        "%0",
        "printf '%s\\n' '%begin 123 456 1' '%output %1 fake' '%end 123 456 1' 'last'",
    )?;
    thread::sleep(Duration::from_millis(200));
    r.settle()?;
    r.run(Op::History {
        pane: PaneId(0),
        start: 0,
        end: 6,
    })?;
    r.settle()
}

/// Detached by another client: `%exit`, then EOF.
fn detach(r: &mut Recorder) -> Result<()> {
    r.server.run(&["detach-client", "-s", SESSION])?;
    r.settle()
}

/// The server killed under the client.
fn kill_server(r: &mut Recorder) -> Result<()> {
    r.server.run(&["kill-server"])?;
    r.settle()
}
