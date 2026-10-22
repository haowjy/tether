//! A private tmux server for the fixture recorder and the real-tmux tests: its own
//! `-L` socket, `nice -n 10`, no config, `/bin/sh` everywhere, and one 80×24 session
//! `SESSION` (`$0`, window `@0`, pane `%0`). Killed, its socket removed, on drop.
#![allow(dead_code)]

use std::env;
use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::Duration;

use tether::tmux::{Endpoint, Socket};
use tokio::sync::{Mutex, MutexGuard};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

pub const SESSION: &str = "fixture";

static SERIAL: Mutex<()> = Mutex::const_new(());

/// The tmux the tests run: `TETHER_TMUX`, else `tmux` on the path.
pub fn tmux() -> PathBuf {
    env::var_os("TETHER_TMUX").map_or_else(|| PathBuf::from("tmux"), PathBuf::from)
}

/// A socket name for this test process's server `name`.
pub fn socket(name: &str) -> String {
    format!("tether-test-{}-{name}", std::process::id())
}

/// A private server for a real-tmux test, or `None` unless `TETHER_TMUX_TESTS=1`; the
/// guard runs the tests one at a time, so floods don't skew each other's timing.
pub async fn setup(name: &str) -> Option<(MutexGuard<'static, ()>, Server)> {
    if env::var_os("TETHER_TMUX_TESTS").is_none_or(|value| value != "1") {
        eprintln!("skipped: set TETHER_TMUX_TESTS=1 to run against a real tmux");
        return None;
    }
    let serial = SERIAL.lock().await;
    let server = Server::start(&tmux(), socket(name)).expect("start a private tmux server");
    Some((serial, server))
}

pub struct Server {
    pub tmux: PathBuf,
    pub socket: String,
}

impl Server {
    pub fn start(tmux: &Path, socket: String) -> Result<Self> {
        let server = Self {
            tmux: tmux.to_owned(),
            socket,
        };
        // Only tests start a server; the daemon never does (it always passes -N).
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

    /// The endpoint the daemon would be configured with for this server.
    pub fn endpoint(&self) -> Endpoint {
        Endpoint {
            program: self.tmux.clone(),
            socket: Socket::Name(self.socket.clone()),
        }
    }

    /// `tmux -u` on this server's socket, under `nice -n 10`. `-u`, as the daemon
    /// passes it: without a UTF-8 locale tmux replaces what isn't ASCII, line breaks
    /// included, in what it prints.
    pub fn command(&self) -> Command {
        let mut command = Command::new("nice");
        command
            .args(["-n", "10"])
            .arg(&self.tmux)
            .args(["-u", "-L", &self.socket, "-f", "/dev/null"])
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
    pub fn run(&self, args: &[&str]) -> Result<String> {
        let mut with_n = vec!["-N"];
        with_n.extend_from_slice(args);
        self.run_starting(&with_n)
    }

    /// A terminal client attached to the session, in a pty from `script`.
    pub fn attach_terminal(&self) -> Result<Child> {
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
    pub fn type_line(&self, pane: &str, line: &str) -> Result<()> {
        self.run(&["send-keys", "-t", pane, "-l", line])?;
        self.run(&["send-keys", "-t", pane, "Enter"])?;
        Ok(())
    }

    /// Runs `body` as a shell script in a pane; the file goes when the guard drops.
    pub fn start_script(&self, pane: &str, body: &str) -> Result<TempScript> {
        let path = env::temp_dir().join(format!("{}.sh", self.socket));
        fs::write(&path, body)?;
        self.type_line(pane, &format!("sh {}", path.display()))?;
        Ok(TempScript(path))
    }
}

pub struct TempScript(PathBuf);

impl Drop for TempScript {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
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
