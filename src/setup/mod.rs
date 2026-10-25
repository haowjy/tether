//! Run tether in the terminal or install its per-user service, and tear it down.

mod checks;
mod install;
#[cfg(target_os = "macos")]
mod launch_agent;
mod report;
#[cfg(target_os = "linux")]
mod systemd;

#[cfg(target_os = "macos")]
use self::launch_agent as platform;
#[cfg(target_os = "linux")]
use self::systemd as platform;

#[cfg(target_os = "linux")]
use std::io::IsTerminal as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime};

use thiserror::Error;

use crate::auth::Store;
use crate::auth::identity;
#[cfg(test)]
use crate::auth::identity::ServeTarget;
use crate::auth::localapi::{LocalApi, LocalApiError};
use crate::auth::publish::{self, PlanError};
use crate::config::{self, Config, ConfigError, ConfigFile};
#[cfg(target_os = "linux")]
use crate::daemon;
use crate::runtime;

const POLL_INTERVAL: Duration = Duration::from_millis(400);
const VERIFY_TIMEOUT: Duration = Duration::from_secs(30);
const STARTING_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Error)]
#[error("{message}")]
struct SetupError {
    message: String,
}

impl From<ConfigError> for SetupError {
    fn from(error: ConfigError) -> Self {
        Self::new(error.to_string())
    }
}

impl SetupError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

type Host = platform::Host;

/// Installs the background service, publishes it, and prints a new enrolment code.
pub fn setup(config_path: Option<PathBuf>) -> Result<(), Box<dyn std::error::Error>> {
    crate::blocking::runtime()?.block_on(setup_async(config_path))
}

/// Runs tether in this terminal on Linux; macOS requires its LaunchAgent front.
pub fn setup_foreground(config_path: Option<PathBuf>) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "linux")]
    {
        crate::blocking::runtime()?.block_on(setup_foreground_async(config_path))
    }
    #[cfg(target_os = "macos")]
    {
        let _ = config_path;
        Err(Box::new(SetupError::new(
            "On a Mac, phones reach tether only through its LaunchAgent, which holds its port; run `tether setup --background`.",
        )))
    }
}

async fn setup_async(config_path: Option<PathBuf>) -> Result<(), Box<dyn std::error::Error>> {
    let config = if config_path.is_some() {
        Config::default()
    } else {
        ConfigFile::resolve(None)?.load()?
    };
    let host = platform::inspect()?;
    if terminal_run(host.service_state.loaded, &host.runtime_dir)? {
        return Err(Box::new(SetupError::new(
            "tether is running in a terminal; Ctrl-C it, then rerun `tether setup --background`.",
        )));
    }
    let api = LocalApi::system();
    let tailscale = tailnet_facts(&api).await;
    #[cfg(target_os = "linux")]
    let platform_facts = platform::facts(&host, operator_user(&api, &tailscale).await);
    #[cfg(target_os = "macos")]
    let platform_facts = platform::facts(&host);
    let facts = make_facts(
        &host,
        &config,
        config_path.is_some(),
        tailscale,
        platform_facts,
    )?;
    let mut warnings = Vec::new();
    let tailnet = checked_tailnet(checks::evaluate(&facts, &mut warnings), &warnings)?;

    let mut changes = Vec::new();
    platform::grant_setup(&host, tailnet.operator_needed, &mut changes)?;
    let old_inode = socket_inode(&host.runtime_dir.join("local.sock"));
    let previous_version = read_daemon_version(&host.runtime_dir.join("local.sock"), &api).await;
    let file_was_missing = host.file_state == install::FileState::Missing;
    changes.extend(platform::apply(&host)?);
    if file_was_missing {
        changes.insert(0, format!("Installed {}", display_name(&host.service_file)));
    }
    let mut notes = Vec::new();
    platform::after_install(&host, &mut notes);
    platform::publish_background(&host, &api, &tailnet, &mut changes).await?;

    let origin = format!(
        "https://{}",
        tailnet.dns_name.trim_end_matches('.').to_ascii_lowercase()
    );
    verify_new_daemon(&host, &api, old_inode, &origin).await?;
    notes.extend(no_tmux_server_note(&config));
    let store = Store::open(config::state_dir()?)?;
    finish(
        report::Mode::Service(platform::KIND),
        previous_version.as_deref(),
        changes,
        notes,
        origin,
        &store,
    )
}

fn finish(
    mode: report::Mode,
    previous_version: Option<&str>,
    changes: Vec<String>,
    notes: Vec<String>,
    origin: String,
    store: &Store,
) -> Result<(), Box<dyn std::error::Error>> {
    let code = store.set_pending(Duration::from_secs(600), SystemTime::now())?;
    report::print_success(&report::Success {
        version: env!("CARGO_PKG_VERSION"),
        previous_version,
        mode,
        changes: &changes,
        notes: &notes,
        origin: &origin,
        code: &code,
    })?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn removed_handler_changes(plan: &publish::PlanResult) -> Vec<String> {
    plan.removed_handlers
        .iter()
        .map(|handler| {
            format!(
                "Removed tether's old handler at {} {}",
                handler.entry, handler.mount
            )
        })
        .collect()
}

fn no_tmux_server_note(config: &Config) -> Option<String> {
    (!tmux_server_exists(config)).then(|| {
        format!(
            "No tmux server yet on {}; start tmux as you usually do.",
            tmux_socket(config).display()
        )
    })
}

#[cfg(target_os = "linux")]
async fn setup_foreground_async(
    config_path: Option<PathBuf>,
) -> Result<(), Box<dyn std::error::Error>> {
    let file = ConfigFile::resolve(config_path.as_deref())?;
    let config = file.load()?;
    let user = systemd::username()?;
    let program = config.tmux.program.as_path();
    let setup_path = std::env::var_os("PATH").unwrap_or_default();
    let tmux_on_setup_path = resolve_program(program, &setup_path);
    let api = LocalApi::system();
    let tailscale = tailnet_facts(&api).await;
    let operator_user = operator_user(&api, &tailscale).await;
    let runtime_dir = config::runtime_dir().ok();
    let uid = effective_uid();
    let foreground_facts = checks::ForegroundFacts {
        is_root: uid == 0,
        username: &user,
        program,
        tmux_on_setup_path: tmux_on_setup_path.as_deref(),
        runtime_dir: runtime_dir.as_deref(),
        uid,
        tailscale: &tailscale,
        operator_user: &operator_user,
    };
    let mut warnings = Vec::new();
    let tailnet = checked_tailnet(
        checks::evaluate_foreground(&foreground_facts, &mut warnings),
        &warnings,
    )?;

    let notes = no_tmux_server_note(&config).into_iter().collect();
    let mut changes = Vec::new();
    let opened = match daemon::open(config, file, Vec::new(), false).await {
        Ok(opened) => opened,
        Err(daemon::OpenError::AlreadyRunning) => {
            let message = if systemd::service_active() {
                "tether is already running as your service. `tether setup --background` restarts it and prints a new code; `systemctl --user stop tether` frees this terminal's run."
            } else {
                "Another tether is already running; stop it first."
            };
            return Err(Box::new(SetupError::new(message)));
        }
        Err(daemon::OpenError::Other(error)) => return Err(error),
    };

    systemd::grant_foreground(&user, tailnet.operator_needed, &mut changes)?;
    let (_, plan) = publish::publish_target(&api, &tailnet.dns_name, opened.serve_target())
        .await
        .map_err(|error| write_error(&error, &tailnet.version, WriteOperation::ForegroundSetup))?;
    changes.extend(removed_handler_changes(&plan));
    let refreshed = opened.auth().refresh_after_serve_write().await?;
    let origin = identity::origin(Some(opened.serve_target()), &refreshed.serve)
        .map_err(|refusal| SetupError::new(refusal.message))?
        .origin;
    finish(
        report::Mode::Foreground,
        None,
        changes,
        notes,
        origin,
        opened.auth().store(),
    )?;
    // The report already says tether is running; a terminal run logs only problems.
    daemon::init_tracing(tracing_subscriber::filter::LevelFilter::WARN);
    opened.run().await
}

fn checked_tailnet(
    result: Result<checks::Tailnet, Vec<checks::Finding>>,
    warnings: &[checks::Finding],
) -> Result<checks::Tailnet, SetupError> {
    for finding in warnings {
        eprintln!("warning: {}", finding.message);
    }
    result.map_err(|errors| {
        SetupError::new(
            errors
                .iter()
                .map(|finding| finding.message.as_str())
                .collect::<Vec<_>>()
                .join("\n"),
        )
    })
}

/// Stops and removes tether's service and only its own Serve handlers.
pub fn teardown() -> Result<(), Box<dyn std::error::Error>> {
    crate::blocking::runtime()?.block_on(teardown_async())
}

async fn teardown_async() -> Result<(), Box<dyn std::error::Error>> {
    if effective_uid() == 0 {
        return Err(Box::new(SetupError::new(
            "Run tether teardown as the user whose service tether installed, not as root.",
        )));
    }
    let host = platform::inspect_teardown()?;
    let terminal_running = terminal_run(host.loaded, &host.runtime_dir)?;
    let api = LocalApi::system();
    platform::before_teardown(&host, &api).await?;
    platform::stop_teardown(&host)?;

    let installed = host.service_file.exists();
    let withdrawal = publish::withdraw_target(&api, &platform::matcher(&host)).await;
    let failure = if let Err(error) = &withdrawal {
        let version = localapi_version(&api).await;
        if let Some(failure) = platform::teardown_withdraw_failed(&host, error, &version) {
            return Err(Box::new(failure));
        }
        Some(write_error(error, &version, WriteOperation::Teardown).to_string())
    } else {
        None
    };

    platform::remove_teardown(&host)?;

    let removed = withdrawal.as_ref().is_ok_and(|plan| plan.changed);
    if withdrawal.is_ok() && !installed && !host.loaded && !removed {
        println!("Nothing to remove.");
    } else {
        if removed {
            println!("Removed tether's Serve handler.");
        }
        if installed {
            println!("Removed {}.", display_name(&host.service_file));
        } else if host.loaded {
            println!("{}", platform::STOPPED);
        }
    }
    let mut notes = Vec::new();
    if terminal_running {
        notes.push("A tether still runs in a terminal; Ctrl-C it.".to_owned());
    }
    #[cfg(target_os = "linux")]
    notes.extend(systemd::teardown_notes(&host));
    for note in notes {
        println!("{note}");
    }
    if let Some(failure) = failure {
        return Err(Box::new(SetupError::new(failure)));
    }
    Ok(())
}

fn terminal_run(loaded: bool, runtime_dir: &Path) -> Result<bool, SetupError> {
    if loaded {
        return Ok(false);
    }
    runtime::lock_held(runtime_dir).map_err(|error| SetupError::new(error.to_string()))
}

fn make_facts(
    host: &Host,
    config: &Config,
    has_custom_config: bool,
    tailscale: checks::TailnetFacts,
    platform: checks::PlatformFacts,
) -> Result<checks::Facts, Box<dyn std::error::Error>> {
    let current = std::env::current_exe()
        .and_then(|path| path.canonicalize())
        .map_err(|error| {
            Box::new(SetupError::new(format!(
                "can't resolve current executable: {error}"
            ))) as Box<dyn std::error::Error>
        })?;
    let installed_path = host.home.join(".cargo/bin/tether");
    let installed_canonical = installed_path.canonicalize().ok();
    let cargo_home_other = std::env::var_os("CARGO_HOME")
        .map(PathBuf::from)
        .is_some_and(|path| path != host.home.join(".cargo"));
    let setup_path = std::env::var_os("PATH").unwrap_or_default();
    let tmux_on_service_path = resolve_program(&config.tmux.program, &host.service_path);
    let tmux_on_setup_path = resolve_program(&config.tmux.program, &setup_path);
    let tmux_tmpdir_without_socket = std::env::var_os("TMUX_TMPDIR").is_some()
        && config.tmux.socket_path.is_none()
        && config.tmux.socket_name.is_none();
    let setup_directories = checks::DirectoryEnvironment {
        home: std::env::var_os("HOME"),
        config_home: std::env::var_os("XDG_CONFIG_HOME"),
        state_home: std::env::var_os("XDG_STATE_HOME"),
    };
    let service_directories = checks::DirectoryEnvironment {
        home: host.service_env.get("HOME").cloned(),
        config_home: host.service_env.get("XDG_CONFIG_HOME").cloned(),
        state_home: host.service_env.get("XDG_STATE_HOME").cloned(),
    };
    let directories = checks::directory_mismatches(&setup_directories, &service_directories)?;
    Ok(checks::Facts {
        is_root: effective_uid() == 0,
        default_config: !has_custom_config,
        binary: checks::BinaryFacts {
            current_canonical: current,
            installed_canonical,
            cargo_home_other,
        },
        directories,
        tmux_tmpdir_without_socket,
        tmux_on_service_path,
        tmux_on_setup_path,
        tailscale,
        platform,
    })
}

async fn tailnet_facts(api: &LocalApi) -> checks::TailnetFacts {
    let deadline = tokio::time::Instant::now() + STARTING_TIMEOUT;
    loop {
        match api.status().await {
            Ok(status)
                if status.backend_state == "Starting" && tokio::time::Instant::now() < deadline =>
            {
                tokio::time::sleep(POLL_INTERVAL).await;
            }
            Ok(status) => {
                return checks::TailnetFacts::Status {
                    version: status.version,
                    backend_state: status.backend_state,
                    dns_name: status.this.map(|node| node.dns_name),
                    cert_domains: status.cert_domains,
                };
            }
            Err(error) => {
                let failure = match error {
                    LocalApiError::NoSocket(_) => checks::LocalApiFailure::NoSocket,
                    LocalApiError::MacAdmin => checks::LocalApiFailure::MacAdmin,
                    _ => checks::LocalApiFailure::Other,
                };
                return checks::TailnetFacts::Unreachable {
                    failure,
                    detail: error.to_string(),
                };
            }
        }
    }
}

#[cfg(target_os = "linux")]
async fn operator_user(api: &LocalApi, tailscale: &checks::TailnetFacts) -> Result<String, String> {
    match tailscale {
        checks::TailnetFacts::Status { .. } => api
            .prefs()
            .await
            .map(|prefs| prefs.operator_user)
            .map_err(|error| error.to_string()),
        checks::TailnetFacts::Unreachable { detail, .. } => Err(detail.clone()),
    }
}

async fn read_daemon_version(socket: &Path, api: &LocalApi) -> Option<String> {
    let info = identity::read_auth_info(socket, api).await.ok()?;
    info.get("daemonVersion")?.as_str().map(str::to_owned)
}

#[cfg(target_os = "linux")]
async fn wait_for_socket(path: &Path, timeout: Duration) -> Result<(), SetupError> {
    let deadline = tokio::time::Instant::now() + timeout;
    while tokio::time::Instant::now() < deadline {
        if std::fs::metadata(path).is_ok() {
            return Ok(());
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
    Err(SetupError::new(format!(
        "{} didn't appear after restart",
        path.display()
    )))
}

async fn verify_new_daemon(
    host: &Host,
    api: &LocalApi,
    previous_inode: Option<(u64, u64)>,
    expected_origin: &str,
) -> Result<(), SetupError> {
    let socket = host.runtime_dir.join("local.sock");
    let deadline = tokio::time::Instant::now() + VERIFY_TIMEOUT;
    let mut last = "tether isn't running".to_owned();
    while tokio::time::Instant::now() < deadline {
        if socket_inode(&socket).is_some_and(|inode| Some(inode) == previous_inode) {
            tokio::time::sleep(POLL_INTERVAL).await;
            continue;
        }
        match identity::read_auth_info(&socket, api).await {
            Ok(info) => {
                if let Some(reported_origin) = info
                    .get("browserOrigin")
                    .and_then(serde_json::Value::as_str)
                {
                    if !reported_origin.is_empty() {
                        if reported_origin == expected_origin {
                            return Ok(());
                        }
                        last = format!(
                            "daemon reported {reported_origin}, expected {expected_origin}"
                        );
                        tokio::time::sleep(POLL_INTERVAL).await;
                        continue;
                    }
                }
                let pending = info
                    .get("browserPending")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false);
                let refused = info
                    .get("browserRefused")
                    .and_then(serde_json::Value::as_str);
                if let Some(refused) = refused.filter(|_| !pending) {
                    return Err(SetupError::new(refused.to_owned()));
                }
                last = if pending {
                    refused.map_or_else(
                        || "browser publication is still pending".to_owned(),
                        |reason| format!("browser publication is still pending: {reason}"),
                    )
                } else {
                    "daemon hasn't reported a publication".to_owned()
                };
            }
            Err(error) => last = error,
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
    let logs = platform::logs(host);
    let exit = platform::last_exit(host);
    let logs = if exit.is_empty() {
        logs
    } else {
        format!("{logs}\n{exit}")
    };
    Err(SetupError::new(format!(
        "tether didn't report a publication within 30 s. Last answer: {last}.\nLast 20 tether log lines:\n{logs}"
    )))
}

#[derive(Clone, Copy)]
enum WriteOperation {
    #[cfg(any(target_os = "linux", test))]
    BackgroundSetup,
    #[cfg(target_os = "linux")]
    ForegroundSetup,
    Teardown,
}

impl WriteOperation {
    fn command(self) -> &'static str {
        match self {
            #[cfg(any(target_os = "linux", test))]
            Self::BackgroundSetup => "tether setup --background",
            #[cfg(target_os = "linux")]
            Self::ForegroundSetup => "tether setup",
            Self::Teardown => "tether teardown",
        }
    }

    fn is_setup(self) -> bool {
        !matches!(self, Self::Teardown)
    }
}

fn write_error(error: &PlanError, version: &str, operation: WriteOperation) -> SetupError {
    let rerun = operation.command();
    let message = match error {
        PlanError::Denied => {
            format!(
                "Tailscale refused the write: your account isn't its operator. Run `sudo tailscale set --operator=$USER`, then rerun {rerun}."
            )
        }
        PlanError::NotLocalAdmin => {
            if operation.is_setup() {
                format!(
                    "Tailscale {version} requires an operator who may run `sudo tailscale` to change a config that serves a Unix socket or a path. Allow this account to run `sudo tailscale`, then rerun {rerun}."
                )
            } else {
                format!(
                    "Tailscale {version} requires an operator who may run `sudo tailscale` to change a config that serves a Unix socket or a path. Remove tether's entry as root: `sudo tailscale serve --https=443 off`, or grant this account access and rerun {rerun}."
                )
            }
        }
        PlanError::ConflictsExhausted => {
            format!("Tailscale's Serve config kept changing while tether wrote it; rerun {rerun}.")
        }
        PlanError::Refused(refusal) => refusal.to_string(),
        PlanError::Rejected { status, body } => {
            format!("Tailscale refused the Serve write: {status} {body}.")
        }
        PlanError::LocalApi(error) => {
            if operation.is_setup() {
                format!("Can't reach Tailscale's LocalAPI: {error}")
            } else {
                format!("Can't reach Tailscale to remove tether's Serve entry: {error}")
            }
        }
    };
    SetupError::new(message)
}

async fn localapi_version(api: &LocalApi) -> String {
    api.status()
        .await
        .ok()
        .map(|status| match checks::parse_major_minor(&status.version) {
            Some((major, minor)) => format!("{major}.{minor}"),
            None => status.version,
        })
        .unwrap_or_else(|| "unknown version".to_owned())
}

#[cfg(target_os = "linux")]
fn require_terminal_for_grants(
    linger: bool,
    operator: bool,
    user: &str,
    setup_command: &str,
) -> Result<(), SetupError> {
    if !linger && !operator {
        return Ok(());
    }
    if std::io::stdin().is_terminal() {
        Ok(())
    } else {
        if linger {
            eprintln!("loginctl enable-linger");
            eprintln!("If that is denied: sudo loginctl enable-linger $USER");
        }
        if operator {
            eprintln!("sudo tailscale set --operator={user}");
        }
        Err(SetupError::new(format!(
            "Linux grants need a terminal. Rerun `{setup_command}` in a terminal, or run the printed commands first."
        )))
    }
}

fn resolve_program(program: &Path, path: &std::ffi::OsStr) -> Option<PathBuf> {
    if program.is_absolute() {
        return is_executable(program).then(|| program.to_owned());
    }
    std::env::split_paths(path)
        .map(|directory| directory.join(program))
        .find(|candidate| is_executable(candidate))
}

fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt as _;
    std::fs::metadata(path)
        .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

fn effective_uid() -> u32 {
    rustix::process::geteuid().as_raw()
}

fn command_text(command: &str, args: &[&str]) -> Result<String, SetupError> {
    let output = Command::new(command)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| SetupError::new(format!("{command}: {error}")))?;
    if !output.status.success() {
        return Err(SetupError::new(format!(
            "{command} {} exited with {}",
            args.join(" "),
            output.status
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn socket_inode(path: &Path) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt as _;
    std::fs::metadata(path)
        .ok()
        .map(|metadata| (metadata.dev(), metadata.ino()))
}

fn tmux_socket(config: &Config) -> PathBuf {
    let endpoint = config.endpoint();
    match &endpoint.socket {
        crate::tmux::Socket::Path(path) => path.clone(),
        crate::tmux::Socket::Name(name) => std::env::var_os("TMUX_TMPDIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/tmp"))
            .join(format!("tmux-{}/{}", effective_uid(), name)),
        crate::tmux::Socket::Default => std::env::var_os("TMUX_TMPDIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/tmp"))
            .join(format!("tmux-{}/default", effective_uid())),
    }
}

fn tmux_server_exists(config: &Config) -> bool {
    let endpoint = config.endpoint();
    let mut command = Command::new(&config.tmux.program);
    command.args(["-u", "-N"]);
    match &endpoint.socket {
        crate::tmux::Socket::Path(path) => {
            command.arg("-S").arg(path);
        }
        crate::tmux::Socket::Name(name) => {
            command.arg("-L").arg(name);
        }
        crate::tmux::Socket::Default => {}
    }
    command
        .args(["display-message", "-p", "-t", "0", "#{pid}"])
        .env_remove("TMUX")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

fn utc_stamp(time: SystemTime) -> String {
    let duration = time
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let seconds = duration.as_secs() as i64;
    let days = seconds.div_euclid(86_400);
    let day_seconds = seconds.rem_euclid(86_400);
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    let hour = day_seconds / 3_600;
    let minute = day_seconds % 3_600 / 60;
    let second = day_seconds % 60;
    format!(
        "{year:04}{month:02}{day:02}T{hour:02}{minute:02}{second:02}.{:09}Z",
        duration.subsec_nanos()
    )
}

fn backup_file(host: &Host, content: &[u8]) -> Result<PathBuf, SetupError> {
    let directory = config::state_dir()?.join("setup-backup");
    let file_name = host
        .service_file
        .file_name()
        .ok_or_else(|| SetupError::new("service file has no name"))?;
    let path = directory.join(format!(
        "{}.{}",
        file_name.to_string_lossy(),
        utc_stamp(SystemTime::now())
    ));
    let parent = path.parent().expect("backup path has parent");
    std::fs::create_dir_all(parent)
        .map_err(|error| SetupError::new(format!("{}: {error}", parent.display())))?;
    use std::os::unix::fs::PermissionsExt as _;
    std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
        .map_err(|error| SetupError::new(format!("{}: {error}", parent.display())))?;
    std::fs::write(&path, content)
        .map_err(|error| SetupError::new(format!("{}: {error}", path.display())))?;
    Ok(path)
}

fn write_file(host: &Host) -> Result<(), SetupError> {
    let parent = host.service_file.parent().expect("service file has parent");
    std::fs::create_dir_all(parent)
        .map_err(|error| SetupError::new(format!("{}: {error}", parent.display())))?;
    let directory = crate::files::Dir::open(parent)
        .map_err(|error| SetupError::new(format!("{}: {error}", parent.display())))?;
    let target = host
        .service_file
        .file_name()
        .expect("service file has name");
    let mut nonce = [0_u8; 8];
    getrandom::fill(&mut nonce).map_err(|error| {
        SetupError::new(format!("can't create service temp file name: {error}"))
    })?;
    let nonce = nonce
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let temp = format!(
        ".{}.{}.{}.tmp",
        target.to_string_lossy(),
        std::process::id(),
        nonce
    );
    crate::files::Temp::create(&directory, std::ffi::OsStr::new(&temp), 0o644)
        .and_then(|temp| temp.replace(target, &host.expected_file))
        .map_err(|error| SetupError::new(format!("{}: {error}", host.service_file.display())))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use bytes::Bytes;
    use http_body_util::{BodyExt as _, Full};
    use hyper::body::Incoming;
    use hyper::server::conn::http1;
    use hyper::service::service_fn;
    use hyper::{Request, Response};
    use hyper_util::rt::TokioIo;
    use tokio::net::UnixListener;

    use super::*;

    #[tokio::test]
    async fn fake_localapi_write_statuses_map_to_setup_messages() {
        let cases = [
            (
                403,
                "Tailscale refused the write: your account isn't its operator. Run `sudo tailscale set --operator=$USER`, then rerun tether setup --background.",
            ),
            (
                401,
                "Tailscale 1.104 requires an operator who may run `sudo tailscale` to change a config that serves a Unix socket or a path. Allow this account to run `sudo tailscale`, then rerun tether setup --background.",
            ),
            (
                412,
                "Tailscale's Serve config kept changing while tether wrote it; rerun tether setup --background.",
            ),
        ];
        for (index, (status, expected)) in cases.into_iter().enumerate() {
            let directory = std::env::temp_dir().join(format!(
                "tether-setup-localapi-{}-{index}",
                std::process::id()
            ));
            let _ = std::fs::remove_dir_all(&directory);
            std::fs::create_dir_all(&directory).expect("test directory");
            let api_socket = directory.join("tailscaled.sock");
            let listener = UnixListener::bind(&api_socket).expect("fake LocalAPI socket");
            let fake = tokio::spawn(async move {
                loop {
                    let Ok((stream, _)) = listener.accept().await else {
                        break;
                    };
                    tokio::spawn(fake_write_connection(stream, status));
                }
            });
            let target_path = directory.join("tether-target.sock");
            let _target = UnixListener::bind(&target_path).expect("target socket");
            let target = ServeTarget::unix(target_path.clone()).expect("target identity");
            let api = LocalApi::at(api_socket);
            let error = publish::publish_target(&api, "host.ts.net", &target)
                .await
                .expect_err("the fake write is refused");
            assert_eq!(
                write_error(&error, "1.104", WriteOperation::BackgroundSetup).to_string(),
                expected
            );
            fake.abort();
            std::fs::remove_dir_all(directory).expect("remove test directory");
        }
    }

    async fn fake_write_connection(stream: tokio::net::UnixStream, write_status: u16) {
        let service = service_fn(move |request: Request<Incoming>| async move {
            let is_get = request.method() == "GET";
            if !is_get {
                let _ = request.into_body().collect().await;
            }
            let (status, body) = if is_get {
                (
                    StatusCode::OK,
                    Bytes::from_static(br#"{"Web":{},"TCP":{}}"#),
                )
            } else if write_status == 403 {
                (
                    StatusCode::FORBIDDEN,
                    Bytes::from_static(b"serve config denied"),
                )
            } else {
                (
                    StatusCode::from_u16(write_status).expect("test status"),
                    Bytes::from_static(b"fake Serve write refusal"),
                )
            };
            Ok::<_, std::convert::Infallible>(
                Response::builder()
                    .status(status)
                    .header("Etag", "\"fake\"")
                    .body(Full::new(body))
                    .expect("fake LocalAPI response"),
            )
        });
        let _ = http1::Builder::new()
            .serve_connection(TokioIo::new(stream), service)
            .await;
    }
}
