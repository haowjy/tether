//! Pure setup checks: gathered machine facts in, complete user-facing findings out.

use std::ffi::OsString;
#[cfg(any(target_os = "linux", test))]
use std::path::Path;
use std::path::PathBuf;

use crate::config::{self, ConfigError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Level {
    Error,
    Warning,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Finding {
    pub level: Level,
    pub message: String,
}

#[derive(Debug, Clone)]
pub(crate) struct Facts {
    pub is_root: bool,
    pub default_config: bool,
    pub binary: BinaryFacts,
    pub directories: Vec<DirectoryMismatch>,
    pub tmux_tmpdir_without_socket: bool,
    pub tmux_on_service_path: Option<PathBuf>,
    pub tmux_on_setup_path: Option<PathBuf>,
    pub tailscale: TailnetFacts,
    pub platform: PlatformFacts,
}

#[derive(Debug, Clone)]
pub(crate) struct BinaryFacts {
    pub current_canonical: PathBuf,
    pub installed_canonical: Option<PathBuf>,
    pub cargo_home_other: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DirectoryMismatch {
    pub variable: String,
    pub value: Option<String>,
    pub setup_directory: PathBuf,
    pub service_directory: PathBuf,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct DirectoryEnvironment {
    pub home: Option<OsString>,
    pub config_home: Option<OsString>,
    pub state_home: Option<OsString>,
}

#[derive(Debug, Clone)]
pub(crate) enum TailnetFacts {
    Unreachable {
        failure: LocalApiFailure,
        detail: String,
    },
    Status {
        version: String,
        backend_state: String,
        dns_name: Option<String>,
        cert_domains: Vec<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LocalApiFailure {
    NoSocket,
    MacAdmin,
    Other,
}

#[derive(Debug, Clone)]
pub(crate) enum PlatformFacts {
    #[cfg(any(target_os = "linux", test))]
    Linux {
        username: String,
        systemd_present: bool,
        user_manager_present: bool,
        systemd_version: Option<Result<u32, String>>,
        missing_controllers: Vec<String>,
        operator_user: Result<String, String>,
    },
    #[cfg(any(target_os = "macos", test))]
    Mac {
        other_account: Option<String>,
        gui_session: bool,
        installed_port: Result<Option<u16>, String>,
        port_available: bool,
    },
}

const BACKGROUND_SETUP: &str = "tether setup --background";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Tailnet {
    pub dns_name: String,
    pub version: String,
    pub operator_needed: bool,
}

impl PlatformFacts {
    fn is_mac(&self) -> bool {
        #[cfg(test)]
        {
            matches!(self, Self::Mac { .. })
        }
        #[cfg(not(test))]
        {
            cfg!(target_os = "macos")
        }
    }

    fn operator_needed(&self) -> bool {
        match self {
            #[cfg(any(target_os = "linux", test))]
            Self::Linux { operator_user, .. } => operator_user
                .as_ref()
                .is_ok_and(|operator| operator.is_empty()),
            #[cfg(any(target_os = "macos", test))]
            Self::Mac { .. } => false,
        }
    }
}

pub(crate) fn directory_mismatches(
    setup: &DirectoryEnvironment,
    service: &DirectoryEnvironment,
) -> Result<Vec<DirectoryMismatch>, ConfigError> {
    let service_home = service.home.as_ref().or(setup.home.as_ref());
    let mut mismatches = Vec::new();
    for (variable, fallback, setup_value, service_value) in [
        (
            "XDG_CONFIG_HOME",
            ".config",
            setup.config_home.as_ref(),
            service.config_home.as_ref(),
        ),
        (
            "XDG_STATE_HOME",
            ".local/state",
            setup.state_home.as_ref(),
            service.state_home.as_ref(),
        ),
    ] {
        let setup_directory = config::xdg_from(
            variable,
            setup_value.map(OsString::as_os_str),
            setup.home.as_deref(),
            fallback,
        )?
        .join("tether");
        let service_directory = config::xdg_from(
            variable,
            service_value.map(OsString::as_os_str),
            service_home.map(OsString::as_os_str),
            fallback,
        )?
        .join("tether");
        if setup_directory != service_directory {
            mismatches.push(DirectoryMismatch {
                variable: variable.to_owned(),
                value: setup_value.map(|value| value.to_string_lossy().into_owned()),
                setup_directory,
                service_directory,
            });
        }
    }
    Ok(mismatches)
}

pub(crate) fn evaluate(
    facts: &Facts,
    warnings: &mut Vec<Finding>,
) -> Result<Tailnet, Vec<Finding>> {
    let mut findings = Vec::new();
    if facts.is_root {
        error(
            &mut findings,
            "Run tether setup as the user whose tmux tether serves, not as root.",
        );
    }
    if !facts.default_config {
        error(
            &mut findings,
            "tether setup --background installs a service that reads the default config path; drop --config.",
        );
    }
    if facts.binary.installed_canonical.as_ref() != Some(&facts.binary.current_canonical) {
        let message = if facts.binary.installed_canonical.is_none() {
            "~/.cargo/bin/tether doesn't exist.".to_owned()
        } else {
            format!(
                "The service runs ~/.cargo/bin/tether, but this is {}.",
                facts.binary.current_canonical.display()
            )
        };
        let mut message = format!(
            "{message} Install it with `cargo install --path .`, then run `~/.cargo/bin/tether setup --background`."
        );
        if facts.binary.cargo_home_other {
            message.push_str(
                " cargo installs into $CARGO_HOME/bin; use [Manual setup](../running.md#manual-setup).",
            );
        }
        error(&mut findings, message);
    }
    for mismatch in &facts.directories {
        let context = match mismatch.value.as_deref() {
            Some(value) => format!("Your shell sets {}={value}, so", mismatch.variable),
            None => format!("Your shell leaves {} unset, so", mismatch.variable),
        };
        let fix = match (&facts.platform, mismatch.value.as_deref()) {
            #[cfg(any(target_os = "linux", test))]
            (PlatformFacts::Linux { .. }, Some(value)) => format!(
                "Unset it, or give the user manager the same value with `systemctl --user set-environment {}={value}`.",
                mismatch.variable
            ),
            #[cfg(any(target_os = "linux", test))]
            (PlatformFacts::Linux { .. }, None) => format!(
                "Unset it in the user manager with `systemctl --user unset-environment {}`.",
                mismatch.variable
            ),
            #[cfg(any(target_os = "macos", test))]
            (PlatformFacts::Mac { .. }, _) => {
                "Unset it before running tether setup --background.".to_owned()
            }
        };
        error(
            &mut findings,
            format!(
                "{context} tether setup would use {} while the service uses {}: it would read another config and another device list. {fix}",
                mismatch.setup_directory.display(),
                mismatch.service_directory.display()
            ),
        );
    }
    if facts.tmux_tmpdir_without_socket {
        warning(
            &mut findings,
            "Your shell sets TMUX_TMPDIR; the service won't see it. Set `[tmux] socket_path` in config.toml.",
        );
    }
    if facts.tmux_on_service_path.is_none() {
        match &facts.tmux_on_setup_path {
            Some(path) => error(
                &mut findings,
                format!(
                    "tmux is at {}, which the service's PATH doesn't reach. Set `[tmux] program = \"{}\"` in config.toml.",
                    path.display(),
                    path.display()
                ),
            ),
            None => error(
                &mut findings,
                "tmux isn't installed (no `tmux` on the service's PATH).",
            ),
        }
    }
    check_tailscale(
        facts.platform.is_mac(),
        &facts.tailscale,
        BACKGROUND_SETUP,
        &mut findings,
    );
    match &facts.platform {
        #[cfg(any(target_os = "linux", test))]
        PlatformFacts::Linux {
            username,
            systemd_present,
            user_manager_present,
            systemd_version,
            missing_controllers,
            operator_user,
        } => {
            if !systemd_present {
                error(
                    &mut findings,
                    "This Linux doesn't run systemd; tether setup supports systemd only. Follow Manual setup in docs/running.md.",
                );
            }
            if !user_manager_present {
                error(
                    &mut findings,
                    format!(
                        "No systemd user manager is running for {username}. Log in as {username} directly (SSH or a console, not su or sudo), then rerun `{BACKGROUND_SETUP}`."
                    ),
                );
            }
            if *systemd_present {
                match systemd_version {
                    Some(Ok(version)) if *version < 254 => warning(
                        &mut findings,
                        format!(
                            "systemd {version} ignores the unit's restart backoff; tether restarts every 2 s instead, which still works."
                        ),
                    ),
                    Some(Err(cause)) => error(
                        &mut findings,
                        format!("Can't read the systemd version: {cause}."),
                    ),
                    None => error(
                        &mut findings,
                        "Can't read the systemd version: no version fact was gathered.",
                    ),
                    _ => {}
                }
            }
            for controller in missing_controllers {
                warning(
                    &mut findings,
                    format!(
                        "The user manager hasn't been delegated the {controller} controller, so the unit's CPUQuota and MemoryMax aren't enforced."
                    ),
                );
            }
            if matches!(facts.tailscale, TailnetFacts::Status { .. }) {
                check_operator(operator_user, username, BACKGROUND_SETUP, &mut findings);
            }
        }
        #[cfg(any(target_os = "macos", test))]
        PlatformFacts::Mac {
            other_account,
            gui_session,
            installed_port,
            port_available,
        } => {
            if let Some(name) = other_account {
                error(
                    &mut findings,
                    format!(
                        "This Mac has another login account ({name}). tether's Mac defences assume yours is the only one, so setup won't install it here."
                    ),
                );
            }
            if !gui_session {
                error(
                    &mut findings,
                    "You aren't logged in at this Mac's screen. Log in there first: tether runs only while you're logged in.",
                );
            }
            match installed_port {
                Ok(Some(port)) if *port != 7851 => error(
                    &mut findings,
                    format!(
                        "tether was installed by hand on port {port}. Keep that install (Manual setup), or run `tether teardown` and then `tether setup --background`, which uses 7851."
                    ),
                ),
                Err(cause) => error(
                    &mut findings,
                    format!("Can't read the installed LaunchAgent's socket port: {cause}."),
                ),
                _ => {}
            }
            if !port_available {
                error(
                    &mut findings,
                    "Another process holds 127.0.0.1:7851 (`lsof -nP -iTCP:7851`). Stop it, or install by hand with another port (Manual setup in docs/running.md).",
                );
            }
        }
    }
    finish(
        facts.tailscale.clone(),
        facts.platform.operator_needed(),
        findings,
        warnings,
    )
}

fn finish(
    tailscale: TailnetFacts,
    operator_needed: bool,
    findings: Vec<Finding>,
    warnings: &mut Vec<Finding>,
) -> Result<Tailnet, Vec<Finding>> {
    warnings.extend(
        findings
            .iter()
            .filter(|finding| finding.level == Level::Warning)
            .cloned(),
    );
    let errors = findings
        .into_iter()
        .filter(|finding| finding.level == Level::Error)
        .collect::<Vec<_>>();
    if !errors.is_empty() {
        return Err(errors);
    }
    validated_tailnet(&tailscale, operator_needed).ok_or_else(|| {
        vec![Finding {
            level: Level::Error,
            message: "Tailscale didn't provide a usable tailnet status.".to_owned(),
        }]
    })
}

fn validated_tailnet(tailscale: &TailnetFacts, operator_needed: bool) -> Option<Tailnet> {
    let TailnetFacts::Status {
        version,
        backend_state,
        dns_name,
        ..
    } = tailscale
    else {
        return None;
    };
    if backend_state != "Running" {
        return None;
    }
    let dns_name = dns_name.as_ref()?.trim_end_matches('.');
    if dns_name.is_empty() {
        return None;
    }
    let (major, minor) = parse_major_minor(version)?;
    Some(Tailnet {
        dns_name: dns_name.to_owned(),
        version: format!("{major}.{minor}"),
        operator_needed,
    })
}

#[cfg(any(target_os = "linux", test))]
pub(crate) struct ForegroundFacts<'a> {
    pub is_root: bool,
    pub username: &'a str,
    pub program: &'a Path,
    pub tmux_on_setup_path: Option<&'a Path>,
    pub runtime_dir: Option<&'a Path>,
    pub uid: u32,
    pub tailscale: &'a TailnetFacts,
    pub operator_user: &'a Result<String, String>,
}

#[cfg(any(target_os = "linux", test))]
pub(crate) fn evaluate_foreground(
    facts: &ForegroundFacts<'_>,
    warnings: &mut Vec<Finding>,
) -> Result<Tailnet, Vec<Finding>> {
    let mut findings = Vec::new();
    let expected_runtime_dir = PathBuf::from(format!("/run/user/{}/tether", facts.uid));
    if facts.is_root {
        error(
            &mut findings,
            "Run tether setup as the user whose tmux tether serves, not as root.",
        );
    }
    if facts.runtime_dir.map(Path::as_os_str) != Some(expected_runtime_dir.as_os_str()) {
        let expected = format!("/run/user/{}", facts.uid);
        let actual = facts.runtime_dir.map_or_else(
            || "unset or invalid".to_owned(),
            |path| path.display().to_string(),
        );
        error(
            &mut findings,
            format!(
                "Plain tether setup requires config::runtime_dir()={expected}/tether (XDG_RUNTIME_DIR={expected}); got config::runtime_dir()={actual}."
            ),
        );
    }
    if facts.tmux_on_setup_path.is_none() {
        error(
            &mut findings,
            format!(
                "tmux isn't available at {} on this shell's PATH. Install tmux or set `[tmux] program` to its executable path.",
                facts.program.display()
            ),
        );
    }
    check_tailscale(false, facts.tailscale, "tether setup", &mut findings);
    if matches!(facts.tailscale, TailnetFacts::Status { .. }) {
        check_operator(
            facts.operator_user,
            facts.username,
            "tether setup",
            &mut findings,
        );
    }
    let operator_needed = facts
        .operator_user
        .as_ref()
        .is_ok_and(|operator| operator.is_empty());
    finish(facts.tailscale.clone(), operator_needed, findings, warnings)
}

fn check_tailscale(
    is_mac: bool,
    tailscale: &TailnetFacts,
    setup_command: &str,
    findings: &mut Vec<Finding>,
) {
    if is_mac {
        if let TailnetFacts::Unreachable { failure, .. } = tailscale {
            match failure {
                LocalApiFailure::MacAdmin => error(
                    findings,
                    "Your account must be an admin: tether reads Tailscale's LocalAPI token from /Library/Tailscale.",
                ),
                _ => error(
                    findings,
                    "Can't reach the Tailscale app. Install the standalone app from tailscale.com (1.104 or later), open it and sign in.",
                ),
            }
            return;
        }
        check_status(is_mac, tailscale, setup_command, findings);
        return;
    }
    match tailscale {
        TailnetFacts::Unreachable { failure, detail } => match failure {
            LocalApiFailure::NoSocket => error(
                findings,
                "tailscaled isn't running: no LocalAPI socket at /var/run/tailscale/tailscaled.sock. Install Tailscale (https://tailscale.com/download/linux), then `sudo systemctl enable --now tailscaled`.",
            ),
            _ => error(
                findings,
                format!("Can't reach Tailscale LocalAPI: {detail}."),
            ),
        },
        TailnetFacts::Status { .. } => check_status(is_mac, tailscale, setup_command, findings),
    }
}

fn check_status(
    is_mac: bool,
    tailscale: &TailnetFacts,
    setup_command: &str,
    findings: &mut Vec<Finding>,
) {
    let TailnetFacts::Status {
        version,
        backend_state,
        dns_name,
        cert_domains,
        ..
    } = tailscale
    else {
        return;
    };
    let running = backend_state == "Running" && dns_name.is_some();
    if !running {
        match (is_mac, backend_state.as_str()) {
            (false, "NeedsLogin") => error(
                findings,
                "Tailscale isn't logged in: run `sudo tailscale login`.",
            ),
            (false, "Stopped") => error(
                findings,
                "Tailscale is stopped: run `sudo tailscale up` (if it asks you to repeat your settings, add the flags it names).",
            ),
            (true, "NeedsLogin") => error(findings, "Sign in from the Tailscale app."),
            (true, "Stopped") => error(findings, "Connect from the Tailscale app."),
            _ => error(
                findings,
                format!("Tailscale isn't ready (backend state: {backend_state})."),
            ),
        }
    }
    match parse_major_minor(version) {
        Some((major, minor)) => {
            let version_string = format!("{major}.{minor}");
            if is_mac && (major, minor) < (1, 104) {
                error(
                    findings,
                    format!(
                        "The Tailscale app {version_string} is older than 1.104, the oldest tether is tested with; update it."
                    ),
                );
            } else if !is_mac && (major, minor) < (1, 94) {
                error(
                    findings,
                    format!(
                        "Tailscale {version_string} can't proxy to a Unix socket; upgrade to 1.94 or later."
                    ),
                );
            }
        }
        None => error(
            findings,
            format!("Tailscale returned an unrecognized version: {version}."),
        ),
    }
    if running {
        match dns_name.as_deref() {
            None | Some("") => error(
                findings,
                "MagicDNS is off for your tailnet; turn it on at https://login.tailscale.com/admin/dns.",
            ),
            Some(name)
                if !cert_domains
                    .iter()
                    .map(|domain| domain.trim_end_matches('.'))
                    .any(|domain| domain.eq_ignore_ascii_case(name.trim_end_matches('.'))) =>
            {
                error(
                    findings,
                    format!(
                        "HTTPS certificates are off for your tailnet. Turn them on under HTTPS Certificates at https://login.tailscale.com/admin/dns, then rerun `{setup_command}`."
                    ),
                );
            }
            _ => {}
        }
    }
}

#[cfg(any(target_os = "linux", test))]
fn check_operator(
    operator: &Result<String, String>,
    username: &str,
    setup_command: &str,
    findings: &mut Vec<Finding>,
) {
    match operator {
        Ok(operator) if operator.is_empty() || operator == username => {}
        Ok(operator) => error(
            findings,
            format!(
                "Tailscale's operator is {operator}. tether setup won't replace it; run `sudo tailscale set --operator=$USER` if you mean to, then rerun `{setup_command}`."
            ),
        ),
        Err(cause) => error(
            findings,
            format!("Can't read Tailscale's Serve operator: {cause}."),
        ),
    }
}

pub(crate) fn parse_major_minor(version: &str) -> Option<(u32, u32)> {
    let mut parts = version.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts
        .next()?
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect::<String>()
        .parse()
        .ok()?;
    Some((major, minor))
}

fn error(findings: &mut Vec<Finding>, message: impl Into<String>) {
    findings.push(Finding {
        level: Level::Error,
        message: message.into(),
    });
}

fn warning(findings: &mut Vec<Finding>, message: impl Into<String>) {
    findings.push(Finding {
        level: Level::Warning,
        message: message.into(),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn foreground_runtime_directory_requires_exact_path() {
        let expected = PathBuf::from("/run/user/1000/tether");
        let alternate = PathBuf::from("/tmp/tether");
        let noncanonical = PathBuf::from("/run/user/1000/./tether");
        let tailscale = TailnetFacts::Status {
            version: "1.104.2-tc123".to_owned(),
            backend_state: "Running".to_owned(),
            dns_name: Some("host.tailnet.ts.net".to_owned()),
            cert_domains: vec!["host.tailnet.ts.net".to_owned()],
        };
        let operator_user = Ok("jimmy".to_owned());
        let program = PathBuf::from("tmux");
        for (runtime_dir, should_pass) in [
            (Some(expected.as_path()), true),
            (Some(alternate.as_path()), false),
            (Some(noncanonical.as_path()), false),
            (None, false),
        ] {
            let facts = ForegroundFacts {
                is_root: false,
                username: "jimmy",
                program: &program,
                tmux_on_setup_path: Some(Path::new("/usr/bin/tmux")),
                runtime_dir,
                uid: 1000,
                tailscale: &tailscale,
                operator_user: &operator_user,
            };
            let mut warnings = Vec::new();
            let result = evaluate_foreground(&facts, &mut warnings);
            assert_eq!(result.is_ok(), should_pass, "runtime dir: {runtime_dir:?}");
            if !should_pass {
                let messages = result.unwrap_err();
                assert!(
                    messages
                        .iter()
                        .any(|finding| { finding.message.contains("XDG_RUNTIME_DIR") })
                );
            }
        }
    }

    fn valid_facts(platform: PlatformFacts) -> Facts {
        Facts {
            is_root: false,
            default_config: true,
            binary: BinaryFacts {
                current_canonical: PathBuf::from("/home/jimmy/.cargo/bin/tether"),
                installed_canonical: Some(PathBuf::from("/home/jimmy/.cargo/bin/tether")),
                cargo_home_other: false,
            },
            directories: Vec::new(),
            tmux_tmpdir_without_socket: false,
            tmux_on_service_path: Some(PathBuf::from("/usr/bin/tmux")),
            tmux_on_setup_path: Some(PathBuf::from("/usr/bin/tmux")),
            tailscale: TailnetFacts::Status {
                version: "1.104.2-tc123".to_owned(),
                backend_state: "Running".to_owned(),
                dns_name: Some("host.tailnet.ts.net".to_owned()),
                cert_domains: vec!["host.tailnet.ts.net".to_owned()],
            },
            platform,
        }
    }

    fn findings(facts: &Facts) -> Vec<Finding> {
        let mut warnings = Vec::new();
        match evaluate(facts, &mut warnings) {
            Ok(_) => warnings,
            Err(mut errors) => {
                errors.extend(warnings);
                errors
            }
        }
    }

    #[test]
    fn directory_mismatches_compare_resolved_paths() {
        let dirs = |home: &str, config: Option<&str>, state: Option<&str>| DirectoryEnvironment {
            home: Some(home.into()),
            config_home: config.map(Into::into),
            state_home: state.map(Into::into),
        };
        let cases = [
            (
                dirs("/home/jimmy", Some("/shared/config"), Some("/shared/state")),
                dirs("/home/jimmy", Some("/shared/config"), Some("/shared/state")),
                Vec::new(),
            ),
            (
                dirs("/home/jimmy", None, None),
                dirs("/home/jimmy", Some("/service/config"), None),
                vec![DirectoryMismatch {
                    variable: "XDG_CONFIG_HOME".to_owned(),
                    value: None,
                    setup_directory: "/home/jimmy/.config/tether".into(),
                    service_directory: "/service/config/tether".into(),
                }],
            ),
            (
                dirs("/home/jimmy", None, None),
                dirs("/other/home", None, None),
                vec![
                    DirectoryMismatch {
                        variable: "XDG_CONFIG_HOME".to_owned(),
                        value: None,
                        setup_directory: "/home/jimmy/.config/tether".into(),
                        service_directory: "/other/home/.config/tether".into(),
                    },
                    DirectoryMismatch {
                        variable: "XDG_STATE_HOME".to_owned(),
                        value: None,
                        setup_directory: "/home/jimmy/.local/state/tether".into(),
                        service_directory: "/other/home/.local/state/tether".into(),
                    },
                ],
            ),
        ];

        for (setup, service, expected) in cases {
            assert_eq!(
                directory_mismatches(&setup, &service).expect("resolve directories"),
                expected
            );
        }
    }

    #[test]
    fn setup_check_messages_follow_the_fact_table() {
        let linux = || PlatformFacts::Linux {
            username: "jimmy".to_owned(),
            systemd_present: true,
            user_manager_present: true,
            systemd_version: Some(Ok(255)),
            missing_controllers: Vec::new(),
            operator_user: Ok("jimmy".to_owned()),
        };
        let mac = || PlatformFacts::Mac {
            other_account: None,
            gui_session: true,
            installed_port: Ok(None),
            port_available: true,
        };
        let mut cases = Vec::new();

        let mut facts = valid_facts(linux());
        facts.is_root = true;
        cases.push((
            facts,
            "Run tether setup as the user whose tmux tether serves, not as root.",
        ));
        let mut facts = valid_facts(linux());
        facts.default_config = false;
        cases.push((
            facts,
            "tether setup --background installs a service that reads the default config path; drop --config.",
        ));
        let mut facts = valid_facts(linux());
        facts.binary.installed_canonical = None;
        facts.binary.cargo_home_other = true;
        cases.push((
            facts,
            "~/.cargo/bin/tether doesn't exist. Install it with `cargo install --path .`, then run `~/.cargo/bin/tether setup --background`. cargo installs into $CARGO_HOME/bin; use [Manual setup](../running.md#manual-setup).",
        ));
        let mut facts = valid_facts(linux());
        facts.directories.push(DirectoryMismatch {
            variable: "XDG_STATE_HOME".to_owned(),
            value: Some("/elsewhere".to_owned()),
            setup_directory: PathBuf::from("/elsewhere/tether"),
            service_directory: PathBuf::from("/home/jimmy/.local/state/tether"),
        });
        cases.push((
            facts,
            "Your shell sets XDG_STATE_HOME=/elsewhere, so tether setup would use /elsewhere/tether while the service uses /home/jimmy/.local/state/tether: it would read another config and another device list. Unset it, or give the user manager the same value with `systemctl --user set-environment XDG_STATE_HOME=/elsewhere`.",
        ));
        let mut facts = valid_facts(mac());
        facts.directories.push(DirectoryMismatch {
            variable: "XDG_CONFIG_HOME".to_owned(),
            value: Some("/tmp/config".to_owned()),
            setup_directory: PathBuf::from("/tmp/config/tether"),
            service_directory: PathBuf::from("/home/jimmy/.config/tether"),
        });
        cases.push((
            facts,
            "Your shell sets XDG_CONFIG_HOME=/tmp/config, so tether setup would use /tmp/config/tether while the service uses /home/jimmy/.config/tether: it would read another config and another device list. Unset it before running tether setup --background.",
        ));
        let mut facts = valid_facts(linux());
        facts.tmux_tmpdir_without_socket = true;
        facts.tmux_on_service_path = None;
        facts.tmux_on_setup_path = Some(PathBuf::from("/opt/homebrew/bin/tmux"));
        cases.push((
            facts,
            "Your shell sets TMUX_TMPDIR; the service won't see it. Set `[tmux] socket_path` in config.toml.",
        ));
        let mut facts = valid_facts(linux());
        facts.tmux_on_service_path = None;
        facts.tmux_on_setup_path = Some(PathBuf::from("/opt/homebrew/bin/tmux"));
        cases.push((
            facts,
            "tmux is at /opt/homebrew/bin/tmux, which the service's PATH doesn't reach. Set `[tmux] program = \"/opt/homebrew/bin/tmux\"` in config.toml.",
        ));
        let mut facts = valid_facts(linux());
        facts.tailscale = TailnetFacts::Unreachable {
            failure: LocalApiFailure::NoSocket,
            detail: String::new(),
        };
        cases.push((
            facts,
            "tailscaled isn't running: no LocalAPI socket at /var/run/tailscale/tailscaled.sock. Install Tailscale (https://tailscale.com/download/linux), then `sudo systemctl enable --now tailscaled`.",
        ));
        let mut facts = valid_facts(linux());
        facts.tailscale = TailnetFacts::Status {
            version: "1.92.1".to_owned(),
            backend_state: "NeedsLogin".to_owned(),
            dns_name: None,
            cert_domains: Vec::new(),
        };
        cases.push((
            facts,
            "Tailscale isn't logged in: run `sudo tailscale login`.",
        ));
        let mut facts = valid_facts(linux());
        facts.tailscale = TailnetFacts::Status {
            version: "1.92.1".to_owned(),
            backend_state: "Running".to_owned(),
            dns_name: Some("host.tailnet.ts.net".to_owned()),
            cert_domains: Vec::new(),
        };
        cases.push((
            facts,
            "Tailscale 1.92 can't proxy to a Unix socket; upgrade to 1.94 or later.",
        ));
        let mut facts = valid_facts(linux());
        facts.tailscale = TailnetFacts::Status {
            version: "1.94.0-t".to_owned(),
            backend_state: "Running".to_owned(),
            dns_name: Some("host.tailnet.ts.net".to_owned()),
            cert_domains: Vec::new(),
        };
        if let PlatformFacts::Linux { operator_user, .. } = &mut facts.platform {
            *operator_user = Ok("someone".to_owned());
        }
        cases.push((
            facts,
            "Tailscale's operator is someone. tether setup won't replace it; run `sudo tailscale set --operator=$USER` if you mean to, then rerun `tether setup --background`.",
        ));
        let mut facts = valid_facts(linux());
        if let PlatformFacts::Linux {
            systemd_present,
            user_manager_present,
            systemd_version,
            missing_controllers,
            ..
        } = &mut facts.platform
        {
            *systemd_present = false;
            *user_manager_present = false;
            *systemd_version = Some(Err("systemctl not found".to_owned()));
            *missing_controllers = vec!["cpu".to_owned()];
        }
        assert!(!findings(&facts).iter().any(|finding| {
            finding
                .message
                .starts_with("Can't read the systemd version:")
        }));
        cases.push((
            facts,
            "This Linux doesn't run systemd; tether setup supports systemd only. Follow Manual setup in docs/running.md.",
        ));
        let mut facts = valid_facts(mac());
        facts.tailscale = TailnetFacts::Status {
            version: "1.103.0".to_owned(),
            backend_state: "Running".to_owned(),
            dns_name: Some("host.tailnet.ts.net".to_owned()),
            cert_domains: Vec::new(),
        };
        if let PlatformFacts::Mac {
            other_account,
            gui_session,
            installed_port,
            port_available,
        } = &mut facts.platform
        {
            *other_account = Some("other".to_owned());
            *gui_session = false;
            *installed_port = Ok(Some(9000));
            *port_available = false;
        }
        cases.push((
            facts,
            "The Tailscale app 1.103 is older than 1.104, the oldest tether is tested with; update it.",
        ));
        let mut facts = valid_facts(mac());
        facts.tailscale = TailnetFacts::Status {
            version: "1.104.2-tc123".to_owned(),
            backend_state: "Running".to_owned(),
            dns_name: Some("host.tailnet.ts.net".to_owned()),
            cert_domains: Vec::new(),
        };
        cases.push((
            facts,
            "HTTPS certificates are off for your tailnet. Turn them on under HTTPS Certificates at https://login.tailscale.com/admin/dns, then rerun `tether setup --background`.",
        ));

        let mut facts = valid_facts(linux());
        facts.binary.current_canonical = PathBuf::from("/tmp/tether");
        cases.push((
            facts,
            "The service runs ~/.cargo/bin/tether, but this is /tmp/tether. Install it with `cargo install --path .`, then run `~/.cargo/bin/tether setup --background`.",
        ));
        let mut facts = valid_facts(linux());
        facts.tmux_on_service_path = None;
        facts.tmux_on_setup_path = None;
        cases.push((
            facts,
            "tmux isn't installed (no `tmux` on the service's PATH).",
        ));
        let mut facts = valid_facts(linux());
        facts.tailscale = TailnetFacts::Unreachable {
            failure: LocalApiFailure::Other,
            detail: "socket error".to_owned(),
        };
        cases.push((facts, "Can't reach Tailscale LocalAPI: socket error."));
        let mut facts = valid_facts(mac());
        facts.tailscale = TailnetFacts::Unreachable {
            failure: LocalApiFailure::NoSocket,
            detail: "not running".to_owned(),
        };
        cases.push((
            facts,
            "Can't reach the Tailscale app. Install the standalone app from tailscale.com (1.104 or later), open it and sign in.",
        ));
        let mut facts = valid_facts(mac());
        facts.tailscale = TailnetFacts::Unreachable {
            failure: LocalApiFailure::MacAdmin,
            detail: "unreadable token".to_owned(),
        };
        cases.push((
            facts,
            "Your account must be an admin: tether reads Tailscale's LocalAPI token from /Library/Tailscale.",
        ));
        let mut facts = valid_facts(linux());
        facts.tailscale = TailnetFacts::Status {
            version: "1.104.2".to_owned(),
            backend_state: "Stopped".to_owned(),
            dns_name: None,
            cert_domains: Vec::new(),
        };
        cases.push((
            facts,
            "Tailscale is stopped: run `sudo tailscale up` (if it asks you to repeat your settings, add the flags it names).",
        ));
        let mut facts = valid_facts(mac());
        facts.tailscale = TailnetFacts::Status {
            version: "1.104.2".to_owned(),
            backend_state: "NeedsLogin".to_owned(),
            dns_name: None,
            cert_domains: Vec::new(),
        };
        cases.push((facts, "Sign in from the Tailscale app."));
        let mut facts = valid_facts(mac());
        facts.tailscale = TailnetFacts::Status {
            version: "1.104.2".to_owned(),
            backend_state: "Stopped".to_owned(),
            dns_name: None,
            cert_domains: Vec::new(),
        };
        cases.push((facts, "Connect from the Tailscale app."));
        let mut facts = valid_facts(linux());
        facts.tailscale = TailnetFacts::Status {
            version: "bad-version".to_owned(),
            backend_state: "Running".to_owned(),
            dns_name: Some("host.ts.net".to_owned()),
            cert_domains: vec!["host.ts.net".to_owned()],
        };
        cases.push((
            facts,
            "Tailscale returned an unrecognized version: bad-version.",
        ));
        let mut facts = valid_facts(linux());
        facts.tailscale = TailnetFacts::Status {
            version: "1.104.2".to_owned(),
            backend_state: "Running".to_owned(),
            dns_name: Some(String::new()),
            cert_domains: Vec::new(),
        };
        cases.push((
            facts,
            "MagicDNS is off for your tailnet; turn it on at https://login.tailscale.com/admin/dns.",
        ));
        let mut facts = valid_facts(linux());
        facts.tailscale = TailnetFacts::Status {
            version: "1.104.2".to_owned(),
            backend_state: "Running".to_owned(),
            dns_name: Some("host.ts.net".to_owned()),
            cert_domains: vec!["host.ts.net".to_owned()],
        };
        if let PlatformFacts::Linux { operator_user, .. } = &mut facts.platform {
            *operator_user = Err("prefs unavailable".to_owned());
        }
        cases.push((
            facts,
            "Can't read Tailscale's Serve operator: prefs unavailable.",
        ));
        let mut facts = valid_facts(linux());
        if let PlatformFacts::Linux {
            user_manager_present,
            systemd_version,
            missing_controllers,
            ..
        } = &mut facts.platform
        {
            *user_manager_present = false;
            *systemd_version = Some(Ok(253));
            *missing_controllers = vec!["cpu".to_owned(), "memory".to_owned()];
        }
        cases.push((
            facts,
            "No systemd user manager is running for jimmy. Log in as jimmy directly (SSH or a console, not su or sudo), then rerun `tether setup --background`.",
        ));
        let mut facts = valid_facts(linux());
        if let PlatformFacts::Linux {
            systemd_version, ..
        } = &mut facts.platform
        {
            *systemd_version = Some(Ok(253));
        }
        cases.push((
            facts,
            "systemd 253 ignores the unit's restart backoff; tether restarts every 2 s instead, which still works.",
        ));
        let mut facts = valid_facts(linux());
        if let PlatformFacts::Linux {
            systemd_version, ..
        } = &mut facts.platform
        {
            *systemd_version = Some(Err("no version".to_owned()));
        }
        cases.push((facts, "Can't read the systemd version: no version."));
        let mut facts = valid_facts(linux());
        if let PlatformFacts::Linux {
            missing_controllers,
            ..
        } = &mut facts.platform
        {
            *missing_controllers = vec!["cpu".to_owned(), "memory".to_owned()];
        }
        cases.push((
            facts.clone(),
            "The user manager hasn't been delegated the cpu controller, so the unit's CPUQuota and MemoryMax aren't enforced.",
        ));
        cases.push((
            facts,
            "The user manager hasn't been delegated the memory controller, so the unit's CPUQuota and MemoryMax aren't enforced.",
        ));
        let mut facts = valid_facts(mac());
        if let PlatformFacts::Mac { other_account, .. } = &mut facts.platform {
            *other_account = Some("other".to_owned());
        }
        cases.push((
            facts,
            "This Mac has another login account (other). tether's Mac defences assume yours is the only one, so setup won't install it here.",
        ));
        let mut facts = valid_facts(mac());
        if let PlatformFacts::Mac { gui_session, .. } = &mut facts.platform {
            *gui_session = false;
        }
        cases.push((
            facts,
            "You aren't logged in at this Mac's screen. Log in there first: tether runs only while you're logged in.",
        ));
        let mut facts = valid_facts(mac());
        if let PlatformFacts::Mac { installed_port, .. } = &mut facts.platform {
            *installed_port = Ok(Some(9000));
        }
        cases.push((
            facts,
            "tether was installed by hand on port 9000. Keep that install (Manual setup), or run `tether teardown` and then `tether setup --background`, which uses 7851.",
        ));
        let mut facts = valid_facts(mac());
        if let PlatformFacts::Mac { port_available, .. } = &mut facts.platform {
            *port_available = false;
        }
        cases.push((
            facts,
            "Another process holds 127.0.0.1:7851 (`lsof -nP -iTCP:7851`). Stop it, or install by hand with another port (Manual setup in docs/running.md).",
        ));

        for (facts, expected) in cases {
            assert!(
                findings(&facts)
                    .iter()
                    .any(|finding| finding.message == expected),
                "missing finding {expected:?}"
            );
        }
        assert_eq!(parse_major_minor("1.94.0-t"), Some((1, 94)));
        assert_eq!(parse_major_minor("1.104.2-tc123"), Some((1, 104)));
        assert_eq!(parse_major_minor("invalid"), None);

        let facts = valid_facts(PlatformFacts::Linux {
            username: "jimmy".to_owned(),
            systemd_present: true,
            user_manager_present: true,
            systemd_version: Some(Ok(253)),
            missing_controllers: vec!["cpu".to_owned()],
            operator_user: Ok("jimmy".to_owned()),
        });
        let mut warnings = Vec::new();
        let _ = evaluate(&facts, &mut warnings).expect("warning-only facts pass");
        assert_eq!(
            warnings
                .iter()
                .filter(|finding| finding.level == Level::Warning)
                .count(),
            2
        );
    }
}
