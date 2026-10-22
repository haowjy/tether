use std::env;
use std::error::Error;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant};

const WAIT: Duration = Duration::from_secs(5);

type Result<T> = std::result::Result<T, Box<dyn Error>>;

struct Options {
    tmux: PathBuf,
    out: PathBuf,
}

struct Control {
    child: Child,
    input: ChildStdin,
    chunks: Receiver<io::Result<Vec<u8>>>,
    raw: Vec<u8>,
    sent: Vec<u8>,
}

struct ServerGuard<'a> {
    tmux: &'a Path,
    socket: String,
    socket_path: PathBuf,
    active: bool,
}

impl Drop for ServerGuard<'_> {
    fn drop(&mut self) {
        if self.active {
            let _ = tmux_command(self.tmux)
                .args(["-L", &self.socket, "-f", "/dev/null", "kill-server"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        let _ = fs::remove_file(&self.socket_path);
    }
}

impl Drop for Control {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Control {
    fn attach(tmux: &Path, socket: &str, session: &str) -> Result<Self> {
        let mut child = tmux_command(tmux)
            .args([
                "-L",
                socket,
                "-f",
                "/dev/null",
                "-C",
                "attach-session",
                "-t",
                session,
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        let input = child.stdin.take().ok_or("control stdin was not piped")?;
        let mut stdout = child.stdout.take().ok_or("control stdout was not piped")?;
        let (tx, chunks) = mpsc::channel();
        thread::spawn(move || {
            loop {
                let mut buffer = vec![0; 8192];
                match stdout.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(count) => {
                        buffer.truncate(count);
                        if tx.send(Ok(buffer)).is_err() {
                            break;
                        }
                    }
                    Err(error) => {
                        let _ = tx.send(Err(error));
                        break;
                    }
                }
            }
        });
        let mut control = Self {
            child,
            input,
            chunks,
            raw: Vec::new(),
            sent: Vec::new(),
        };
        control.wait_for_from(0, b"%session-changed ")?;
        Ok(control)
    }

    fn send_line(&mut self, line: &str) -> Result<usize> {
        let start = self.raw.len();
        self.input.write_all(line.as_bytes())?;
        self.input.write_all(b"\n")?;
        self.input.flush()?;
        self.sent.extend_from_slice(line.as_bytes());
        self.sent.push(b'\n');
        Ok(start)
    }

    fn run_group(&mut self, commands: &str, marker: &str) -> Result<usize> {
        let line = format!("{commands} ; display-message -p '{marker}'");
        let start = self.send_line(&line)?;
        if let Err(error) = self.wait_for_from(start, marker.as_bytes()) {
            let has_error = self.raw[start..]
                .split(|byte| *byte == b'\n')
                .any(|line| line.starts_with(b"%error ") && line.ends_with(b" 1"));
            if has_error {
                return Err(format!("tmux command group failed before marker {marker}").into());
            }
            return Err(format!("waiting for marker {marker}: {error}").into());
        }
        Ok(start)
    }

    fn run_error_group(&mut self, commands: &str) -> Result<usize> {
        let start = self.send_line(commands)?;
        self.wait_for_error_from(start)?;
        Ok(start)
    }

    fn wait_for_from(&mut self, start: usize, needle: &[u8]) -> Result<()> {
        self.wait_until(|bytes| contains(&bytes[start..], needle))
            .map_err(|error| {
                format!(
                    "waiting for control-mode marker {needle:?}: {error}; events: {}",
                    protocol_summary(&self.raw[start..])
                )
            })?;
        Ok(())
    }

    fn wait_for_error_from(&mut self, start: usize) -> Result<()> {
        self.wait_until(|bytes| {
            bytes[start..]
                .split(|byte| *byte == b'\n')
                .any(|line| line.starts_with(b"%error ") && line.ends_with(b" 1"))
        })
    }

    fn wait_for_notification_id(&mut self, start: usize, name: &str) -> Result<String> {
        let prefix = format!("{name} ");
        self.wait_until(|bytes| {
            bytes[start..]
                .split(|byte| *byte == b'\n')
                .any(|line| line.starts_with(prefix.as_bytes()) && line.len() > prefix.len())
        })?;
        let line = self.raw[start..]
            .split(|byte| *byte == b'\n')
            .find(|line| line.starts_with(prefix.as_bytes()) && line.len() > prefix.len())
            .ok_or("notification line disappeared")?;
        let id = line[prefix.len()..]
            .split(|byte| byte.is_ascii_whitespace())
            .next()
            .ok_or("notification has no object ID")?;
        Ok(std::str::from_utf8(id)?.to_owned())
    }

    fn wait_for_any_from(&mut self, start: usize, needles: &[&[u8]]) -> Result<()> {
        self.wait_until(|bytes| {
            needles
                .iter()
                .any(|needle| contains(&bytes[start..], needle))
        })
    }

    fn wait_until(&mut self, mut ready: impl FnMut(&[u8]) -> bool) -> Result<()> {
        let deadline = Instant::now() + WAIT;
        while !ready(&self.raw) {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err("timed out waiting for a tmux control-mode reply".into());
            }
            match self.chunks.recv_timeout(remaining) {
                Ok(Ok(chunk)) => self.raw.extend_from_slice(&chunk),
                Ok(Err(error)) => return Err(error.into()),
                Err(RecvTimeoutError::Timeout) => {
                    return Err("timed out waiting for a tmux control-mode reply".into());
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err("tmux control-mode output closed unexpectedly".into());
                }
            }
        }
        Ok(())
    }

    fn settle(&mut self) -> Result<()> {
        loop {
            match self.chunks.recv_timeout(Duration::from_millis(100)) {
                Ok(Ok(chunk)) => self.raw.extend_from_slice(&chunk),
                Ok(Err(error)) => return Err(error.into()),
                Err(RecvTimeoutError::Timeout) => return Ok(()),
                Err(RecvTimeoutError::Disconnected) => return Ok(()),
            }
        }
    }

    fn write_fixture(
        &mut self,
        out: &Path,
        name: &str,
        from: usize,
        input_from: usize,
    ) -> Result<()> {
        self.settle()?;
        fs::write(out.join(format!("{name}.in")), &self.sent[input_from..])?;
        fs::write(out.join(format!("{name}.out")), &self.raw[from..])?;
        self.sent.truncate(input_from);
        Ok(())
    }

    fn stop_after_server_exit(&mut self) -> Result<()> {
        let deadline = Instant::now() + WAIT;
        loop {
            match self
                .chunks
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            {
                Ok(Ok(chunk)) => self.raw.extend_from_slice(&chunk),
                Ok(Err(error)) => return Err(error.into()),
                Err(RecvTimeoutError::Timeout) => {
                    return Err("timed out waiting for kill-server".into());
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
        self.input.flush()?;
        let status = self.child.wait()?;
        if !status.success() {
            return Err(format!("tmux control client exited with {status}").into());
        }
        Ok(())
    }
}

fn main() -> Result<()> {
    let options = parse_args()?;
    fs::create_dir_all(&options.out)?;
    let socket = format!("tether-fixture-{}", std::process::id());
    let session = "tether-fixture";
    let socket_path = tmux_socket_path(&socket)?;
    let mut server = ServerGuard {
        tmux: &options.tmux,
        socket: socket.clone(),
        socket_path: socket_path.clone(),
        active: true,
    };
    let _ = fs::remove_file(&socket_path);

    run_tmux(
        &options.tmux,
        &[
            "-L",
            &socket,
            "-f",
            "/dev/null",
            "new-session",
            "-d",
            "-s",
            session,
            "-x",
            "80",
            "-y",
            "24",
            "/bin/sh",
        ],
    )?;
    let mut control = Control::attach(&options.tmux, &socket, session)?;
    let mut raw_at = 0;
    let mut input_at = 0;

    control.write_fixture(&options.out, "attach-startup", raw_at, input_at)?;
    raw_at = control.raw.len();
    input_at = control.sent.len();

    let c0s = (0..=31)
        .map(|byte| format!("\\{byte:03o}"))
        .collect::<String>();
    let shell = format!("stty -opost; printf '{c0s}\\\\\\\\\\200\\377'");
    let send = send_keys_hex(&shell);
    let start = control.send_line(&send)?;
    control.wait_for_from(start, b"%end ")?;
    thread::sleep(Duration::from_millis(200));
    control.run_group("display-message -p OUTPUT_C0_DONE", "OUTPUT_C0_DONE")?;
    control.write_fixture(&options.out, "output-c0", raw_at, input_at)?;
    raw_at = control.raw.len();
    input_at = control.sent.len();

    let start = control.send_line(&send_keys_hex("yes | head -c 8192"))?;
    control.wait_for_from(start, b"%end ")?;
    thread::sleep(Duration::from_millis(200));
    control.run_group("display-message -p FLOOD_DONE", "FLOOD_DONE")?;
    control.write_fixture(&options.out, "yes-flood", raw_at, input_at)?;
    raw_at = control.raw.len();
    input_at = control.sent.len();

    control.run_error_group(
        "display-message -p BEFORE_MIDDLE_ERROR ; capture-pane -p -t %99999 ; display-message -p SKIPPED_MIDDLE",
    )?;
    control.write_fixture(&options.out, "error-middle", raw_at, input_at)?;
    raw_at = control.raw.len();
    input_at = control.sent.len();

    control.run_error_group("capture-pane -p -t %99999 ; display-message -p SKIPPED_START")?;
    control.run_group("display-message -p AFTER_START_ERROR", "AFTER_START_ERROR")?;
    control.write_fixture(&options.out, "error-start", raw_at, input_at)?;
    raw_at = control.raw.len();
    input_at = control.sent.len();

    control.send_line(
        "set-hook -g after-split-window 'display-message -p HOOK_FLAG_ZERO' ; split-window -d -t %0 ; display-message -p HOOK_TRIGGERED",
    )?;
    control.wait_for_from(raw_at, b"HOOK_FLAG_ZERO")?;
    control.run_group("set-hook -gu after-split-window", "HOOK_REMOVED")?;
    control.write_fixture(&options.out, "hook-flag0", raw_at, input_at)?;
    raw_at = control.raw.len();
    input_at = control.sent.len();

    let screen =
        "printf '\\033c'; printf '%s\\r\\n' '%begin 123 456 1' '%output %1 fake' '%end 123 456 1'";
    control.send_line(&send_keys_hex(screen))?;
    thread::sleep(Duration::from_millis(200));
    control.run_group("capture-pane -p -t %0", "CAPTURE_PERCENT_DONE")?;
    control.write_fixture(&options.out, "capture-percent-lines", raw_at, input_at)?;
    raw_at = control.raw.len();
    input_at = control.sent.len();

    control.run_group("refresh-client -A '%0:pause'", "PAUSE_DONE")?;
    control.run_group("refresh-client -A '%0:continue'", "CONTINUE_DONE")?;
    control.write_fixture(&options.out, "pause-continue", raw_at, input_at)?;
    raw_at = control.raw.len();
    input_at = control.sent.len();

    control.run_group("split-window -d -t %0", "LAYOUT_SPLIT_DONE")?;
    control.wait_for_from(raw_at, b"%layout-change ")?;
    control.write_fixture(&options.out, "layout-split", raw_at, input_at)?;
    raw_at = control.raw.len();
    input_at = control.sent.len();

    let add_start =
        control.run_group("new-window -d -t '$0' -n fixture-window", "WINDOW_ADD_DONE")?;
    let window_id = control.wait_for_notification_id(add_start, "%window-add")?;
    control.run_group(
        &format!("rename-window -t {window_id} fixture-renamed"),
        "WINDOW_RENAME_DONE",
    )?;
    control.wait_for_from(raw_at, b"%window-renamed ")?;
    control.run_group(&format!("kill-window -t {window_id}"), "WINDOW_CLOSE_DONE")?;
    control.wait_for_any_from(raw_at, &[b"%window-close ", b"%unlinked-window-close "])?;
    control.write_fixture(&options.out, "window-add-rename-close", raw_at, input_at)?;
    raw_at = control.raw.len();
    input_at = control.sent.len();

    control.run_group(
        "rename-session -t '$0' fixture-renamed",
        "SESSION_RENAME_DONE",
    )?;
    control.wait_for_from(raw_at, b"%session-renamed ")?;
    control.write_fixture(&options.out, "session-rename", raw_at, input_at)?;
    raw_at = control.raw.len();
    input_at = control.sent.len();

    control.run_group(
        "refresh-client -B 'fixture-sub::#{session_name}'",
        "SUBSCRIBE_DONE",
    )?;
    thread::sleep(Duration::from_millis(1100));
    control.settle()?;
    let subscription_at = control.raw.len();
    control.run_group(
        "rename-session -t '$0' fixture-subscribed",
        "SUBSCRIPTION_RENAME_DONE",
    )?;
    control.wait_for_from(subscription_at, b" : fixture-subscribed")?;
    control.write_fixture(&options.out, "subscription-changed", raw_at, input_at)?;
    raw_at = control.raw.len();

    run_tmux(
        &options.tmux,
        &["-L", &socket, "-f", "/dev/null", "kill-server"],
    )?;
    control.stop_after_server_exit()?;
    server.active = false;
    let _ = fs::remove_file(&socket_path);
    fs::write(options.out.join("kill-server.in"), b"")?;
    fs::write(options.out.join("kill-server.out"), &control.raw[raw_at..])?;
    Ok(())
}

fn parse_args() -> Result<Options> {
    let mut args = env::args().skip(1);
    let mut tmux = PathBuf::from("tmux");
    let mut out = None;
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--tmux" => tmux = args.next().ok_or("--tmux needs a path")?.into(),
            "--out" => out = Some(PathBuf::from(args.next().ok_or("--out needs a directory")?)),
            "--help" | "-h" => {
                println!("Usage: record-tmux-fixtures [--tmux PATH] --out DIRECTORY");
                std::process::exit(0);
            }
            other => return Err(format!("unknown argument: {other}").into()),
        }
    }
    Ok(Options {
        tmux,
        out: out.ok_or("--out is required")?,
    })
}

fn tmux_command(tmux: &Path) -> Command {
    let mut command = Command::new("nice");
    command.args(["-n", "10"]).arg(tmux);
    command
}

fn tmux_socket_path(socket: &str) -> Result<PathBuf> {
    let uid = Command::new("id").arg("-u").output()?;
    if !uid.status.success() {
        return Err("id -u failed while locating tmux's private socket".into());
    }
    let uid = String::from_utf8(uid.stdout)?;
    let directory = env::var_os("TMUX_TMPDIR").unwrap_or_else(|| "/tmp".into());
    Ok(PathBuf::from(directory)
        .join(format!("tmux-{}", uid.trim()))
        .join(socket))
}

fn run_tmux(tmux: &Path, args: &[&str]) -> Result<()> {
    let output = tmux_command(tmux).args(args).output()?;
    if !output.status.success() {
        return Err(format!(
            "tmux command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }
    Ok(())
}

fn send_keys_hex(command: &str) -> String {
    let hex = command
        .as_bytes()
        .iter()
        .chain(std::iter::once(&b'\n'))
        .map(|byte| format!("{byte:02x}"))
        .collect::<Vec<_>>()
        .join(" ");
    format!("send-keys -t %0 -H {hex}")
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

fn protocol_summary(bytes: &[u8]) -> String {
    let mut counts = std::collections::BTreeMap::<String, usize>::new();
    for line in bytes
        .split(|byte| *byte == b'\n')
        .filter(|line| line.starts_with(b"%"))
    {
        let end = line
            .iter()
            .position(|byte| *byte == b' ')
            .unwrap_or(line.len());
        let kind = String::from_utf8_lossy(&line[..end]).into_owned();
        *counts.entry(kind).or_default() += 1;
    }
    if counts.is_empty() {
        "none".to_owned()
    } else {
        counts
            .into_iter()
            .map(|(kind, count)| format!("{kind}:{count}"))
            .collect::<Vec<_>>()
            .join(",")
    }
}
