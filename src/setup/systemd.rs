//! systemd user-manager inspection and command execution.

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::{Command, Output};
use std::time::Duration;

use super::checks::PlatformFacts;
use super::install::{self, FileState, ServiceState, SystemdAction};
use super::{SetupError, command_text};
use crate::auth::identity::ServeTargetMatcher;

pub(super) const KIND: super::report::ServiceKind = super::report::ServiceKind {
    name: "systemd user service",
    startup: "starts at boot",
};
pub(super) const STOPPED: &str = "Stopped the running tether service.";

pub(super) struct Host {
    pub home: PathBuf,
    pub service_env: HashMap<String, OsString>,
    pub service_path: OsString,
    pub service_file: PathBuf,
    pub file_state: FileState,
    pub expected_file: Vec<u8>,
    pub service_state: ServiceState,
    pub runtime_dir: PathBuf,
    user: String,
    uid: u32,
    systemd_present: bool,
    user_manager_present: bool,
    systemd_version: Option<Result<u32, String>>,
    missing_controllers: Vec<String>,
    linger: bool,
    dropins: Vec<PathBuf>,
}

pub(super) struct TeardownHost {
    pub service_file: PathBuf,
    pub loaded: bool,
    pub runtime_dir: PathBuf,
    uid: u32,
    linger: bool,
}

const DEFAULT_PATH: &str = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

pub(super) fn inspect() -> Result<Host, SetupError> {
    let user = username()?;
    let uid = rustix::process::geteuid().as_raw();
    let home = super::config::home()?;
    let manager_dir = PathBuf::from(format!("/run/user/{uid}"));
    let private = manager_dir.join("systemd/private");
    let systemd_present = std::path::Path::new("/run/systemd/system").exists();
    let user_manager_present = private.exists();

    let systemd_version = systemd_present.then(|| {
        Command::new("systemctl")
            .arg("--version")
            .output()
            .map_err(|error| error.to_string())
            .and_then(|output| {
                if !output.status.success() {
                    return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
                }
                String::from_utf8_lossy(&output.stdout)
                    .split_whitespace()
                    .nth(1)
                    .ok_or_else(|| "systemctl --version returned no version".to_owned())?
                    .parse::<u32>()
                    .map_err(|_| "systemctl --version returned an invalid version".to_owned())
            })
    });
    let env_output = Command::new("systemctl")
        .args(["--user", "show-environment"])
        .env("XDG_RUNTIME_DIR", &manager_dir)
        .output()
        .ok()
        .filter(|output| output.status.success());
    let service_env = env_output
        .as_ref()
        .map(|output| parse_environment(&String::from_utf8_lossy(&output.stdout)))
        .unwrap_or_default();
    let service_path = service_env
        .get("PATH")
        .cloned()
        .unwrap_or_else(|| OsString::from(DEFAULT_PATH));
    let cgroup_file = PathBuf::from("/sys/fs/cgroup/user.slice").join(format!(
        "user-{uid}.slice/user@{uid}.service/cgroup.controllers"
    ));
    let controllers = std::fs::read_to_string(cgroup_file).unwrap_or_default();
    let missing_controllers = ["cpu", "memory"]
        .into_iter()
        .filter(|controller| {
            !controllers
                .split_whitespace()
                .any(|found| found == *controller)
        })
        .map(str::to_owned)
        .collect();
    let service_file = home.join(".config/systemd/user/tether.service");
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
    let file_state = install::file_state(previous_file, install::SYSTEMD_UNIT.as_bytes());
    let linger = command_text("loginctl", &["show-user", &user, "-p", "Linger"])
        .ok()
        .is_some_and(|value| value.trim() == "Linger=yes");
    let dropins_dir = service_file.with_extension("service.d");
    let dropins = std::fs::read_dir(&dropins_dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .collect();
    Ok(Host {
        home: home.clone(),
        service_env,
        service_path,
        service_file,
        file_state,
        expected_file: install::SYSTEMD_UNIT.as_bytes().to_vec(),
        service_state: ServiceState {
            loaded: manager_command_for_uid(uid, "is-active", &["tether"]).is_ok(),
            disabled: false,
        },
        runtime_dir: manager_dir.join("tether"),
        user,
        uid,
        systemd_present,
        user_manager_present,
        systemd_version,
        missing_controllers,
        linger,
        dropins,
    })
}

pub(super) fn username() -> Result<String, SetupError> {
    command_text("/usr/bin/id", &["-un"])
}

pub(super) fn service_active() -> bool {
    let uid = rustix::process::geteuid().as_raw();
    manager_command_for_uid(uid, "is-active", &["tether"]).is_ok()
}

pub(super) fn facts(host: &Host, operator_user: Result<String, String>) -> PlatformFacts {
    PlatformFacts::Linux {
        username: host.user.clone(),
        systemd_present: host.systemd_present,
        user_manager_present: host.user_manager_present,
        systemd_version: host.systemd_version.clone(),
        missing_controllers: host.missing_controllers.clone(),
        operator_user,
    }
}

pub(super) fn teardown_notes(host: &TeardownHost) -> Vec<String> {
    let mut notes = Vec::new();
    if host.linger {
        notes.push("Linger remains enabled; undo it with `sudo loginctl disable-linger $USER` (this also stops other user units while logged out).".to_owned());
    }
    notes.push(
        "Tailscale's operator grant remains; undo it with `sudo tailscale set --operator=`."
            .to_owned(),
    );
    notes
}

pub(super) fn inspect_teardown() -> Result<TeardownHost, SetupError> {
    let home = super::config::home()?;
    let uid = rustix::process::geteuid().as_raw();
    let service_file = home.join(".config/systemd/user/tether.service");
    let manager_dir = PathBuf::from(format!("/run/user/{uid}"));
    let loaded = manager_command_for_uid(uid, "is-active", &["tether"]).is_ok();
    let user = username()?;
    let linger = command_text("loginctl", &["show-user", &user, "-p", "Linger"])
        .ok()
        .is_some_and(|value| value.trim() == "Linger=yes");
    let runtime_dir = manager_dir.join("tether");
    Ok(TeardownHost {
        service_file,
        loaded,
        uid,
        runtime_dir,
        linger,
    })
}

fn grant_linger(host: &Host) -> Result<(), SetupError> {
    println!("Running: loginctl enable-linger");
    let granted = Command::new("loginctl")
        .arg("enable-linger")
        .status()
        .is_ok_and(|status| status.success());
    if granted {
        return Ok(());
    }
    let command = format!("sudo loginctl enable-linger {}", host.user);
    println!("Running: {command}");
    let status = Command::new("sudo")
        .args(["loginctl", "enable-linger", &host.user])
        .status()
        .map_err(|error| SetupError::new(format!("{command}: {error}")))?;
    if status.success() {
        Ok(())
    } else {
        Err(SetupError::new(format!("{command} exited with {status}")))
    }
}

fn grant_operator(user: &str) -> Result<(), SetupError> {
    let command = format!("sudo tailscale set --operator={user}");
    println!("Tailscale must let your account change its Serve config. Running: {command}");
    let status = Command::new("sudo")
        .args(["tailscale", "set", &format!("--operator={user}")])
        .status()
        .map_err(|error| SetupError::new(format!("{command}: {error}")))?;
    if status.success() {
        Ok(())
    } else {
        Err(SetupError::new(format!("{command} exited with {status}")))
    }
}

pub(super) fn grant_foreground(
    user: &str,
    operator_needed: bool,
    changes: &mut Vec<String>,
) -> Result<(), SetupError> {
    super::require_terminal_for_grants(false, operator_needed, user, "tether setup")?;
    grant_operator_if_needed(user, operator_needed, changes)
}

pub(super) fn grant_setup(
    host: &Host,
    operator_needed: bool,
    changes: &mut Vec<String>,
) -> Result<(), SetupError> {
    let needs_linger = !host.linger;
    super::require_terminal_for_grants(
        needs_linger,
        operator_needed,
        &host.user,
        "tether setup --background",
    )?;
    if needs_linger {
        grant_linger(host)?;
        changes.push("Enabled linger".to_owned());
    }
    grant_operator_if_needed(&host.user, operator_needed, changes)
}

fn grant_operator_if_needed(
    user: &str,
    operator_needed: bool,
    changes: &mut Vec<String>,
) -> Result<(), SetupError> {
    if operator_needed {
        grant_operator(user)?;
        changes.push(format!("Set Tailscale's operator to {user}"));
    }
    Ok(())
}

pub(super) fn after_install(host: &Host, notes: &mut Vec<String>) {
    notes.extend(
        host.dropins
            .iter()
            .map(|path| format!("Left systemd drop-in in place: {}", path.display())),
    );
}

pub(super) async fn before_teardown(
    _host: &TeardownHost,
    _api: &crate::auth::localapi::LocalApi,
) -> Result<(), SetupError> {
    Ok(())
}

pub(super) fn last_exit(_host: &Host) -> String {
    String::new()
}

pub(super) fn matcher(host: &TeardownHost) -> ServeTargetMatcher {
    ServeTargetMatcher::unix(host.runtime_dir.join("serve.sock"))
}

pub(super) fn teardown_withdraw_failed(
    _host: &TeardownHost,
    _error: &super::PlanError,
    _version: &str,
) -> Option<SetupError> {
    None
}

pub(super) fn apply(host: &Host) -> Result<Vec<String>, SetupError> {
    let mut changes = Vec::new();
    for action in install::plan_systemd(&host.file_state) {
        match action {
            SystemdAction::Install => super::write_file(host)?,
            SystemdAction::BackupReplace(contents) => {
                let backup = super::backup_file(host, &contents)?;
                super::write_file(host)?;
                changes.push(format!(
                    "Replaced tether.service, which differed from this tether's; the old copy is {}.",
                    backup.display()
                ));
            }
            SystemdAction::DaemonReload => run_manager(host.uid, "daemon-reload", &[])?,
            SystemdAction::Enable => run_manager(host.uid, "enable", &["tether"])?,
            SystemdAction::Restart => run_manager(host.uid, "restart", &["tether"])
                .map_err(|error| with_journal(error, host))?,
        }
    }
    Ok(changes)
}

pub(super) async fn publish_background(
    host: &Host,
    api: &crate::auth::localapi::LocalApi,
    tailnet: &super::checks::Tailnet,
    changes: &mut Vec<String>,
) -> Result<(), SetupError> {
    super::wait_for_socket(
        &host.runtime_dir.join("serve.sock"),
        Duration::from_secs(10),
    )
    .await?;
    let target = crate::auth::identity::ServeTarget::unix(host.runtime_dir.join("serve.sock"))
        .map_err(|error| {
            SetupError::new(format!(
                "{}: {error}",
                host.runtime_dir.join("serve.sock").display()
            ))
        })?;
    let (_, plan) = crate::auth::publish::publish_target(api, &tailnet.dns_name, &target)
        .await
        .map_err(|error| {
            super::write_error(
                &error,
                &tailnet.version,
                super::WriteOperation::BackgroundSetup,
            )
        })?;
    changes.extend(super::removed_handler_changes(&plan));
    if plan.changed {
        run_manager(host.uid, "restart", &["tether"]).map_err(|error| with_journal(error, host))?;
    }
    Ok(())
}

pub(super) fn stop_teardown(host: &TeardownHost) -> Result<(), SetupError> {
    if !host.service_file.exists() && !host.loaded {
        return Ok(());
    }
    if host.service_file.exists() {
        run_manager(host.uid, "disable", &["--now", "tether"])
    } else {
        run_manager(host.uid, "stop", &["tether"])
    }
}

pub(super) fn remove_teardown(host: &TeardownHost) -> Result<(), SetupError> {
    if !host.service_file.exists() {
        return Ok(());
    }
    std::fs::remove_file(&host.service_file)
        .map_err(|error| SetupError::new(format!("{}: {error}", host.service_file.display())))?;
    run_manager(host.uid, "daemon-reload", &[])
}

pub(super) fn logs(_host: &Host) -> String {
    Command::new("journalctl")
        .args(["--user", "-u", "tether", "-n", "20", "--no-pager"])
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
        .unwrap_or_else(|error| format!("Can't read tether journal: {error}"))
}

fn run_manager(uid: u32, verb: &str, args: &[&str]) -> Result<(), SetupError> {
    println!("Running: systemctl --user {verb} {}", args.join(" ").trim());
    manager_command_for_uid(uid, verb, args)
        .map(|_| ())
        .map_err(|error| SetupError::new(format!("systemctl --user {verb}: {error}")))
}

fn manager_command_for_uid(uid: u32, verb: &str, args: &[&str]) -> Result<Output, SetupError> {
    let mut command = Command::new("systemctl");
    command.arg("--user").arg(verb).args(args);
    if std::env::var_os("XDG_RUNTIME_DIR").is_none() {
        command.env("XDG_RUNTIME_DIR", format!("/run/user/{uid}"));
    }
    let output = command
        .output()
        .map_err(|error| SetupError::new(format!("systemctl --user {verb}: {error}")))?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(SetupError::new(format!(
            "systemctl --user {verb} {}: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        )))
    }
}

fn parse_environment(text: &str) -> HashMap<String, OsString> {
    text.lines()
        .filter_map(|line| line.split_once('='))
        .map(|(key, value)| (key.to_owned(), OsString::from(value)))
        .collect()
}

fn with_journal(error: SetupError, host: &Host) -> SetupError {
    let logs = logs(host);
    SetupError::new(format!("{error}\nLast 20 tether journal lines:\n{logs}"))
}
