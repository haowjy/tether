//! LaunchAgent inspection and command execution.

use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::auth::identity::ServeTargetMatcher;

use super::checks::PlatformFacts;
use super::install::{self, FileState, LaunchAgentAction, ServiceState};
use super::{PlanError, SetupError};

const LABEL: &str = "com.jimmyyao.tether";
const UNLOAD_TIMEOUT: Duration = Duration::from_secs(5);
pub(super) const KIND: super::report::ServiceKind = super::report::ServiceKind {
    name: "LaunchAgent",
    startup: "started when you log in",
};
pub(super) const STOPPED: &str = "Stopped tether's LaunchAgent.";

pub(super) struct Host {
    pub platform: PlatformFacts,
    pub home: PathBuf,
    pub service_env: HashMap<String, std::ffi::OsString>,
    pub service_path: std::ffi::OsString,
    pub service_file: PathBuf,
    pub file_state: FileState,
    pub expected_file: Vec<u8>,
    pub service_state: ServiceState,
    pub runtime_dir: PathBuf,
    domain: String,
}

pub(super) struct TeardownHost {
    pub service_file: PathBuf,
    pub loaded: bool,
    domain: String,
    port: u16,
}

pub(super) fn inspect() -> Result<Host, SetupError> {
    let user = super::command_text("/usr/bin/id", &["-un"])?;
    let uid = rustix::process::geteuid().as_raw();
    let home = super::config::home()?;
    let domain = format!("gui/{uid}");
    let gui_session = launchctl(&["print", &domain]).is_ok();
    let loaded = launchctl(&["print", &format!("{domain}/{LABEL}")]).is_ok();
    let disabled_label = format!("\"{LABEL}\" =>");
    let disabled = launchctl(&["print-disabled", &domain])
        .ok()
        .is_some_and(|output| {
            String::from_utf8_lossy(&output.stdout).lines().any(|line| {
                line.trim_start()
                    .strip_prefix(&disabled_label)
                    .is_some_and(|value| matches!(value.trim(), "disabled" | "true"))
            })
        });
    let other_account = other_account(&user)?;
    let path = std::env::var_os("PATH").unwrap_or_default();
    let service_file = home.join("Library/LaunchAgents/com.jimmyyao.tether.plist");
    let installed_port = read_port(&service_file);
    let port_available =
        loaded || TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 7851)).is_ok();
    let runtime_root = super::command_text("getconf", &["DARWIN_USER_TEMP_DIR"])?;
    let runtime_dir = PathBuf::from(runtime_root).join("tether");
    let expected_file =
        install::launch_agent(&home.to_string_lossy(), &path.to_string_lossy()).into_bytes();
    let previous_file = match std::fs::read(&service_file) {
        Ok(contents) => Some(contents),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(SetupError::new(format!(
                "{}: {error}",
                service_file.display()
            )));
        }
    };
    let file_state = install::file_state(previous_file, &expected_file);
    Ok(Host {
        platform: PlatformFacts::Mac {
            other_account,
            gui_session,
            installed_port,
            port_available,
        },
        home,
        service_env: HashMap::new(),
        service_path: path,
        service_file,
        file_state,
        expected_file,
        service_state: ServiceState { loaded, disabled },
        runtime_dir,
        domain,
    })
}

pub(super) fn inspect_teardown() -> Result<TeardownHost, SetupError> {
    let uid = rustix::process::geteuid().as_raw();
    let home = super::config::home()?;
    let domain = format!("gui/{uid}");
    let loaded = launchctl(&["print", &format!("{domain}/{LABEL}")]).is_ok();
    let service_file = home.join("Library/LaunchAgents/com.jimmyyao.tether.plist");
    let port = read_port(&service_file).ok().flatten().unwrap_or(7851);
    Ok(TeardownHost {
        service_file,
        loaded,
        domain,
        port,
    })
}

fn read_port(service_file: &std::path::Path) -> Result<Option<u16>, String> {
    match std::fs::metadata(service_file) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("{}: {error}", service_file.display())),
    }
    let output = Command::new("plutil")
        .args([
            "-extract",
            "Sockets.Listener.SockServiceName",
            "raw",
            "-o",
            "-",
        ])
        .arg(service_file)
        .output()
        .map_err(|error| format!("plutil: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "{}: can't read launchd socket port: {}",
            service_file.display(),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let port = String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<u16>()
        .map_err(|error| format!("{}: invalid launchd port: {error}", service_file.display()))?;
    Ok(Some(port))
}

pub(super) fn apply(host: &Host) -> Result<Vec<String>, SetupError> {
    let mut changes = Vec::new();
    for action in install::plan_launch_agent(&host.file_state, host.service_state) {
        match action {
            LaunchAgentAction::Install => super::write_file(host)?,
            LaunchAgentAction::BackupReplace(contents) => {
                let backup = super::backup_file(host, &contents)?;
                super::write_file(host)?;
                changes.push(format!(
                    "Replaced {}, which differed from this tether's; the old copy is {}.",
                    host.service_file
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy(),
                    backup.display()
                ));
            }
            LaunchAgentAction::EnableJob => {
                run("enable", &[&format!("{}/{LABEL}", host.domain)])?;
                changes.push("Enabled tether in Login Items".to_owned());
            }
            LaunchAgentAction::Bootout => {
                run("bootout", &[&format!("{}/{LABEL}", host.domain)])?;
                wait_until_unloaded(&host.domain)?;
            }
            LaunchAgentAction::Bootstrap => {
                run(
                    "bootstrap",
                    &[&host.domain, &host.service_file.display().to_string()],
                )?;
            }
            LaunchAgentAction::Kickstart => {
                run("kickstart", &["-k", &format!("{}/{LABEL}", host.domain)])?
            }
        }
    }
    Ok(changes)
}

pub(super) async fn publish_background(
    _host: &Host,
    _api: &crate::auth::localapi::LocalApi,
    _tailnet: &super::checks::Tailnet,
    _changes: &mut Vec<String>,
) -> Result<bool, SetupError> {
    Ok(false)
}

fn wait_until_unloaded(domain: &str) -> Result<(), SetupError> {
    let target = format!("{domain}/{LABEL}");
    let deadline = Instant::now() + UNLOAD_TIMEOUT;
    loop {
        if launchctl(&["print", &target]).is_err() {
            return Ok(());
        }
        let now = Instant::now();
        if now >= deadline {
            return Err(SetupError::new(format!(
                "launchd still reports {target} loaded after bootout"
            )));
        }
        let remaining = deadline.duration_since(now);
        std::thread::sleep(super::POLL_INTERVAL.min(remaining));
    }
}

pub(super) fn stop_teardown(host: &TeardownHost) -> Result<(), SetupError> {
    if host.loaded {
        run("bootout", &[&format!("{}/{LABEL}", host.domain)])?;
    }
    Ok(())
}

pub(super) fn remove_teardown(host: &TeardownHost) -> Result<(), SetupError> {
    if host.service_file.exists() {
        std::fs::remove_file(&host.service_file).map_err(|error| {
            SetupError::new(format!("{}: {error}", host.service_file.display()))
        })?;
    }
    Ok(())
}

pub(super) fn teardown_notes(_host: &TeardownHost) -> Vec<String> {
    Vec::new()
}

pub(super) fn grant_setup(
    _host: &Host,
    _background: bool,
    _operator_needed: bool,
    _changes: &mut Vec<String>,
) -> Result<(), SetupError> {
    Ok(())
}

pub(super) fn after_install(_host: &Host, _notes: &mut Vec<String>) {}

pub(super) fn after_publish(_host: &Host, _changed: bool) -> Result<(), SetupError> {
    Ok(())
}

pub(super) fn matcher(host: &TeardownHost) -> ServeTargetMatcher {
    ServeTargetMatcher::loopback_port(host.port)
}

pub(super) async fn before_teardown(
    host: &TeardownHost,
    api: &crate::auth::localapi::LocalApi,
) -> Result<(), SetupError> {
    if host.loaded {
        api.serve_config_raw().await.map_err(|error| {
            SetupError::new(format!(
                "Can't reach Tailscale to remove tether's Serve entry; open the Tailscale app and rerun. ({error})"
            ))
        })?;
    }
    Ok(())
}

pub(super) fn teardown_withdraw_failed(
    host: &TeardownHost,
    error: &PlanError,
    version: &str,
) -> Option<SetupError> {
    eprintln!(
        "Serve still points at 127.0.0.1:{}, which any process can now bind. Remove it now: `tailscale serve --https=443 off`, or rerun tether teardown once Tailscale answers",
        host.port
    );
    Some(SetupError::new(format!(
        "{}\n{error}",
        super::write_error(error, version, super::WriteOperation::Teardown)
    )))
}

pub(super) fn logs(host: &Host) -> String {
    let path = host.home.join("Library/Logs/tether.log");
    std::fs::read_to_string(&path)
        .map(|text| {
            text.lines()
                .rev()
                .take(20)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_else(|error| format!("Can't read {}: {error}", path.display()))
}

pub(super) fn last_exit(host: &Host) -> String {
    launchctl(&["print", &format!("{}/{LABEL}", host.domain)])
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .find(|line| line.trim_start().starts_with("last exit code"))
                .unwrap_or("launchctl reported no last exit code")
                .trim()
                .to_owned()
        })
        .unwrap_or_else(|error| error.to_string())
}

fn other_account(current: &str) -> Result<Option<String>, SetupError> {
    let output = Command::new("dscl")
        .args([".", "-list", "/Users", "UniqueID"])
        .output()
        .map_err(|error| SetupError::new(format!("dscl: {error}")))?;
    if !output.status.success() {
        return Err(SetupError::new(format!(
            "dscl . -list /Users UniqueID: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let name = parts.next()?;
            let uid = parts.next()?.parse::<u32>().ok()?;
            (uid >= 501 && name != current).then(|| name.to_owned())
        })
        .next())
}

fn launchctl(args: &[&str]) -> Result<std::process::Output, SetupError> {
    let output = Command::new("launchctl")
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| SetupError::new(format!("launchctl {}: {error}", args.join(" "))))?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(SetupError::new(format!(
            "launchctl {}: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        )))
    }
}

fn run(action: &str, args: &[&str]) -> Result<(), SetupError> {
    println!("Running: launchctl {action} {}", args.join(" "));
    launchctl(&args_with_action(action, args)).map(|_| ()).map_err(|error| {
        if action == "bootstrap" {
        SetupError::new(format!(
            "{error}\nIf tether is off under System Settings → General → Login Items, turn it on and rerun."
        ))
        } else {
            error
        }
    })
}

fn args_with_action<'a>(action: &'a str, args: &'a [&'a str]) -> Vec<&'a str> {
    std::iter::once(action)
        .chain(args.iter().copied())
        .collect()
}
