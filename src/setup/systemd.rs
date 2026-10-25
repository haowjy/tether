//! systemd user-manager inspection and command execution.

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::{Command, Output};

use super::checks::PlatformFacts;
use super::install::{self, Action, Platform, ServiceState};
use super::{Host, SetupError, command_text};

const DEFAULT_PATH: &str = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

pub(super) fn inspect() -> Result<Host, SetupError> {
    let user = command_text("/usr/bin/id", &["-un"])?;
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
    let platform = PlatformFacts::Linux {
        username: user.clone(),
        systemd_present,
        user_manager_present,
        systemd_version,
        missing_controllers,
    };
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
    let (file_state, previous_file) =
        install::file_state(previous_file, install::SYSTEMD_UNIT.as_bytes());
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
        platform,
        user,
        uid,
        home: home.clone(),
        service_env,
        service_path,
        service_file,
        file_state,
        previous_file,
        expected_file: install::SYSTEMD_UNIT.as_bytes().to_vec(),
        service_state: ServiceState {
            loaded: manager_command_for_uid(uid, "is-active", &["tether"]).is_ok(),
            disabled: false,
        },
        runtime_dir: manager_dir.join("tether"),
        serve_socket: manager_dir.join("tether/serve.sock"),
        linger,
        dropins,
    })
}

pub(super) fn inspect_teardown() -> Result<super::TeardownHost, SetupError> {
    let home = super::config::home()?;
    let uid = rustix::process::geteuid().as_raw();
    let service_file = home.join(".config/systemd/user/tether.service");
    let manager_dir = PathBuf::from(format!("/run/user/{uid}"));
    let loaded = manager_command_for_uid(uid, "is-active", &["tether"]).is_ok();
    Ok(super::TeardownHost {
        service_file,
        loaded,
        uid,
        serve_socket: manager_dir.join("tether/serve.sock"),
    })
}

pub(super) fn grant_linger(host: &Host) -> Result<(), SetupError> {
    if host.linger {
        return Ok(());
    }
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

pub(super) fn grant_operator(host: &Host) -> Result<(), SetupError> {
    let command = format!("sudo tailscale set --operator={}", host.user);
    println!("Tailscale must let your account change its Serve config. Running: {command}");
    let status = Command::new("sudo")
        .args(["tailscale", "set", &format!("--operator={}", host.user)])
        .status()
        .map_err(|error| SetupError::new(format!("{command}: {error}")))?;
    if status.success() {
        Ok(())
    } else {
        Err(SetupError::new(format!("{command} exited with {status}")))
    }
}

pub(super) fn apply(host: &Host) -> Result<Vec<String>, SetupError> {
    let mut changes = Vec::new();
    for action in install::plan(Platform::Systemd, host.file_state, host.service_state) {
        match action {
            Action::Install => super::write_file(host)?,
            Action::BackupReplace => {
                let backup = super::backup_file(host)?;
                super::write_file(host)?;
                changes.push(format!(
                    "Replaced tether.service, which differed from this tether's; the old copy is {}.",
                    backup.display()
                ));
            }
            Action::DaemonReload => run_manager(host, "daemon-reload", &[])?,
            Action::Enable => run_manager(host, "enable", &["tether"])?,
            Action::Restart => run_manager(host, "restart", &["tether"]).map_err(with_journal)?,
            Action::EnableJob | Action::Bootout | Action::Bootstrap | Action::Kickstart => {
                unreachable!("LaunchAgent action on systemd")
            }
        }
    }
    Ok(changes)
}

pub(super) fn restart(host: &Host) -> Result<(), SetupError> {
    run_manager(host, "restart", &["tether"]).map_err(with_journal)
}

pub(super) fn stop_teardown(host: &super::TeardownHost) -> Result<(), SetupError> {
    if !host.service_file.exists() && !host.loaded {
        return Ok(());
    }
    if host.service_file.exists() {
        run_manager_for_uid(host.uid, "disable", &["--now", "tether"])
    } else {
        run_manager_for_uid(host.uid, "stop", &["tether"])
    }
}

pub(super) fn remove_teardown(host: &super::TeardownHost) -> Result<(), SetupError> {
    if !host.service_file.exists() {
        return Ok(());
    }
    std::fs::remove_file(&host.service_file)
        .map_err(|error| SetupError::new(format!("{}: {error}", host.service_file.display())))?;
    run_manager_for_uid(host.uid, "daemon-reload", &[])
}

pub(super) fn dropins(host: &Host) -> &[PathBuf] {
    &host.dropins
}

pub(super) fn logs() -> String {
    Command::new("journalctl")
        .args(["--user", "-u", "tether", "-n", "20", "--no-pager"])
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
        .unwrap_or_else(|error| format!("Can't read tether journal: {error}"))
}

fn run_manager(host: &Host, verb: &str, args: &[&str]) -> Result<(), SetupError> {
    println!("Running: systemctl --user {verb} {}", args.join(" ").trim());
    manager_command_for_uid(host.uid, verb, args)
        .map(|_| ())
        .map_err(|error| SetupError::new(format!("systemctl --user {verb}: {error}")))
}

fn run_manager_for_uid(uid: u32, verb: &str, args: &[&str]) -> Result<(), SetupError> {
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

fn with_journal(error: SetupError) -> SetupError {
    let logs = logs();
    SetupError::new(format!("{error}\nLast 20 tether journal lines:\n{logs}"))
}
