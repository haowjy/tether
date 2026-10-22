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

use std::env;
use std::error::Error;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant};

use bytes::Bytes;
use tether::tmux::{
    Event, InputItem, Op, PaneId, Reply, Session, SessionId, Size, Tag, TmuxError, WindowId,
};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

const WAIT: Duration = Duration::from_secs(5);
const QUIET: Duration = Duration::from_millis(150);
const SESSION: &str = "fixture";

type Scenario = fn(&mut Recorder) -> Result<()>;

const SCENARIOS: &[(&str, Scenario)] = &[
    ("startup", startup),
    ("unwanted-output", unwanted_output),
    ("pause-at-cap", pause_at_cap),
    ("snapshot-boundary", snapshot_boundary),
    ("snapshot-alternate", snapshot_alternate),
    ("snapshot-gone", snapshot_gone),
    ("hooks", hooks),
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
        let server = Server::start(&tmux, index)?;
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

/// A private tmux server, killed and its socket removed on drop.
struct Server {
    tmux: PathBuf,
    socket: String,
}

impl Server {
    fn start(tmux: &Path, index: usize) -> Result<Self> {
        let server = Self {
            tmux: tmux.to_owned(),
            socket: format!("tether-fixture-{}-{index}", std::process::id()),
        };
        // The recorder may start a server; the daemon never does (it always passes -N).
        server.run_starting(&[
            "new-session",
            "-d",
            "-s",
            SESSION,
            "-x",
            "80",
            "-y",
            "24",
            "-c",
            "/tmp",
            "/bin/sh",
        ])?;
        server.run(&["set-option", "-g", "default-shell", "/bin/sh"])?;
        Ok(server)
    }

    fn command(&self) -> Command {
        let mut command = Command::new("nice");
        command
            .args(["-n", "10"])
            .arg(&self.tmux)
            .args(["-L", &self.socket, "-f", "/dev/null"])
            .env("PS1", "$ ")
            .env_remove("TMUX");
        command
    }

    fn run_starting(&self, args: &[&str]) -> Result<String> {
        let output = self.command().args(args).output()?;
        if !output.status.success() {
            return Err(format!(
                "tmux {args:?}: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )
            .into());
        }
        Ok(String::from_utf8(output.stdout)?)
    }

    /// A one-shot command that never starts a server.
    fn run(&self, args: &[&str]) -> Result<String> {
        let mut with_n = vec!["-N"];
        with_n.extend_from_slice(args);
        self.run_starting(&with_n)
    }

    /// A terminal client attached to the session, in a pty from `script`.
    fn attach_terminal(&self) -> Result<Child> {
        let tmux = format!(
            "nice -n 10 {} -N -L {} attach-session -t {SESSION}",
            self.tmux.display(),
            self.socket
        );
        let mut script = Command::new("script");
        if cfg!(target_os = "macos") {
            script.args(["-q", "/dev/null", "sh", "-c", &tmux]);
        } else {
            script.args(["-qfec", &tmux, "/dev/null"]);
        }
        let child = script
            .env_remove("TMUX")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
        thread::sleep(Duration::from_millis(300));
        Ok(child)
    }

    /// Types a shell line into a pane, outside the control client.
    fn type_line(&self, pane: &str, line: &str) -> Result<()> {
        self.run(&["send-keys", "-t", pane, "-l", line])?;
        self.run(&["send-keys", "-t", pane, "Enter"])?;
        Ok(())
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.command().arg("-N").arg("kill-server").output();
        if let Ok(uid) = Command::new("id").arg("-u").output() {
            let uid = String::from_utf8_lossy(&uid.stdout).trim().to_owned();
            let dir = env::var_os("TMUX_TMPDIR").unwrap_or_else(|| "/tmp".into());
            let _ = fs::remove_file(
                PathBuf::from(dir)
                    .join(format!("tmux-{uid}"))
                    .join(&self.socket),
            );
        }
    }
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
            .args([
                "-N",
                "-C",
                "attach-session",
                "-t",
                "$0",
                "-f",
                "pause-after=3",
            ])
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
    r.server.type_line("%0", "cd /")?;
    r.wait_for(|event| matches!(event, Event::Cwd { path, .. } if path == "/"))?;
    expect_ok(r.run(Op::Unsubscribe {
        window: WindowId(0),
    })?)?;
    r.server.type_line("%0", "cd /tmp")?;
    r.pump_for(Duration::from_millis(1300))?;
    r.settle()
}

/// A paste through a path tmux would otherwise parse, a missing file, a gone window.
fn paste(r: &mut Recorder) -> Result<()> {
    let dir = env::temp_dir().join(format!("tether-fixture-{}", std::process::id()));
    fs::create_dir_all(&dir)?;
    let path = dir.join("we ird'#{pane_id}$HOME;~.txt");
    fs::write(&path, "echo PASTED-OK\n")?;
    r.run(Op::Snapshot { pane: PaneId(0) })?;
    let pasted = r.run(Op::Paste {
        window: WindowId(0),
        path: path.clone(),
    });
    let missing = r.run(Op::Paste {
        window: WindowId(0),
        path: dir.join("missing.txt"),
    });
    let gone = r.run(Op::Paste {
        window: WindowId(99),
        path: path.clone(),
    });
    let _ = fs::remove_dir_all(&dir);
    expect_ok(pasted?)?;
    missing?;
    gone?;
    r.wait_for_output(b"PASTED-OK\r\n")?;
    let buffers = r.server.run(&["list-buffers", "-F", "#{buffer_name}"])?;
    if !buffers.trim().is_empty() {
        return Err(format!("paste left tmux buffers behind: {buffers}").into());
    }
    r.settle()
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
        items: vec![text("od -An -tx1"), key("Enter")],
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
    r.wait_for_output(b"61 62 02 1b 78 c3 a9 0a")?;
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
