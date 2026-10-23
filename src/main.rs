#![forbid(unsafe_code)]

use std::error::Error;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::{Duration, SystemTime};

use clap::{Parser, Subcommand};
use tether::auth::identity::LocalApi;
use tether::auth::{Auth, DeviceKind, Store};
use tether::blocking::{BLOCKING_THREADS, Lanes};
use tether::complete::{self, Environment};
use tether::config::{self, Config, ConfigError, ConfigFile};
use tether::fs;
use tether::http::{self, App};
use tether::hub::{self, Endpoints};
use tether::proto::HostInfo;
use tokio::signal::unix::{SignalKind, signal};
use tracing::{info, warn};
use tracing_subscriber::filter::{LevelFilter, Targets};
use tracing_subscriber::layer::SubscriberExt as _;
use tracing_subscriber::util::SubscriberInitExt as _;

type Result<T, E = Box<dyn Error>> = std::result::Result<T, E>;

/// How long shutdown waits for the hub to close its control clients.
const HUB_WAIT: Duration = Duration::from_secs(2);

/// Phone-first client for tmux sessions on a dev server.
#[derive(Parser)]
#[command(version, about)]
struct Cli {
    /// Config file [default: $XDG_CONFIG_HOME/tether/config.toml]
    #[arg(long, global = true, value_name = "PATH")]
    config: Option<PathBuf>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Run the daemon on private Unix sockets for `tailscale serve` and local tools.
    Serve {
        /// Tailscale logins let through [default: this node's owner, from tailscaled]
        #[arg(long = "allow-login", value_name = "LOGIN")]
        allow_login: Vec<String>,
    },
    /// Print a one-time code for the app's Add host. Replaces any earlier code.
    Enroll {
        /// How long the code works
        #[arg(long, default_value = "10m", value_parser = humantime::parse_duration)]
        ttl: Duration,
    },
    /// List, add or remove enrolled devices.
    #[command(subcommand)]
    Device(DeviceCommand),
}

#[derive(Subcommand)]
enum DeviceCommand {
    /// List native devices and enrolled Tailscale nodes.
    List,
    /// Add a device and print its token once (a desktop browser, Playwright).
    Add { name: String },
    /// Remove a device: its token stops working, its sockets close within 10 s.
    Remove { name: String },
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let result = ConfigFile::resolve(cli.config.as_deref())
        .and_then(|file| Ok((file.load()?, file)))
        .map_err(Into::into)
        .and_then(|(config, file)| match cli.command {
            Command::Serve { allow_login } => serve(config, file, allow_login),
            Command::Enroll { ttl } => enroll(&config, ttl),
            Command::Device(command) => device(command),
        });
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(cause) => {
            eprintln!("tether: {cause}");
            if cause.downcast_ref::<ConfigError>().is_some()
                || cause.downcast_ref::<config::RuntimeDirError>().is_some()
                || cause
                    .downcast_ref::<tether::budget::BelowMinimum>()
                    .is_some()
                || cause
                    .downcast_ref::<tether::runtime::RuntimeError>()
                    .is_some_and(|error| {
                        matches!(error, tether::runtime::RuntimeError::Directory(_))
                    })
            {
                ExitCode::from(78)
            } else {
                ExitCode::FAILURE
            }
        }
    }
}

fn runtime() -> Result<tokio::runtime::Runtime> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .max_blocking_threads(BLOCKING_THREADS)
        .build()?;
    Ok(runtime)
}

fn serve(config: Config, file: ConfigFile, allow_login: Vec<String>) -> Result<()> {
    init_tracing();
    // An error reaches stderr, and so the journal, through `main`.
    runtime()?.block_on(daemon(config, file, allow_login))
}

async fn daemon(config: Config, file: ConfigFile, allow_login: Vec<String>) -> Result<()> {
    let tier = tether::budget::resolve(config.memory_budget_mib)?;
    let runtime_dir = config::runtime_dir()?;
    let runtime = tether::runtime::Runtime::open(runtime_dir)?;
    let serve_path = runtime.serve_path.clone();
    let local_path = runtime.local_path.clone();
    let paste_dir = runtime.paste_dir.clone();
    let serve_listener = runtime.serve;
    let local_listener = runtime.local;
    let store = Store::open(config::state_dir()?)?;
    let home = config::home()?;
    let host_id = store.host_id()?;
    let mut shutdown = signal(SignalKind::terminate())?;
    let mut interrupt = signal(SignalKind::interrupt())?;
    let lanes = Lanes::default();
    start_file_api(&config, &home, &lanes).await;

    let name = config.name.clone().unwrap_or_else(|| "tether".to_owned());
    let endpoint = config.endpoint();
    let (hub, mut hub_task) = hub::spawn(
        Endpoints {
            main: endpoint.clone(),
        },
        tier.caps.control_clients,
        name.clone(),
    );
    let hub_stop = hub.clone();
    let api = LocalApi::system();
    let app = App {
        auth: Auth::with_local_api(
            store,
            allow_login,
            lanes.auth.clone(),
            api,
            Some(&serve_path),
        ),
        hub,
        host: HostInfo { id: host_id, name },
        paste_dir,
        config: file,
        complete: complete::Settings::new(&config.complete, Environment::current(&home)),
        caps: tier.caps,
        home,
        lanes,
    };
    let signalled = async move {
        tokio::select! {
            _ = shutdown.recv() => {}
            _ = interrupt.recv() => {}
        }
        info!("shutting down");
        let _ = sd_notify::notify(&[sd_notify::NotifyState::Stopping]);
    };
    let mut server = std::pin::pin!(http::serve(serve_listener, local_listener, app, signalled));
    let _ = sd_notify::notify(&[sd_notify::NotifyState::Ready]);
    info!(
        serve_socket = %serve_path.display(),
        local_socket = %local_path.display(),
        tmux = ?endpoint,
        version = env!("CARGO_PKG_VERSION"),
        "listening on private Unix sockets"
    );

    tokio::select! {
        served = &mut server => served?,
        // The hub ends only once stopped or every handle is gone: it panicked.
        joined = &mut hub_task => return Err(format!("the hub ended: {joined:?}").into()),
    }
    // A request still stuck at shutdown holds a handle: stop the hub regardless, so it
    // closes its control clients' stdin and ends.
    let _ = hub_stop.stop().await;
    drop(hub_stop);
    match tokio::time::timeout(HUB_WAIT, hub_task).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(cause)) => Err(format!("the hub ended: {cause}").into()),
        Err(_) => Err("the hub didn't end within 2 s".into()),
    }
}

/// Deletes the part files of uploads a daemon that died left, and warns of roots that
/// fs ignores. Runtime::open holds the single-instance lock before this can run.
async fn start_file_api(config: &Config, home: &Path, lanes: &Lanes) {
    for entry in config.roots.iter().chain([&config.uploads_dir]) {
        if fs::expand(entry, home).is_none() {
            warn!(%entry, "a root in config.toml isn't absolute or ~/: ignored");
        }
    }
    let Some(uploads) = fs::expand(&config.uploads_dir, home) else {
        return;
    };
    let dir = uploads.clone();
    match lanes.fs.run(move || fs::upload::sweep(&dir)).await {
        Ok(Ok(0)) => {}
        Ok(Ok(removed)) => info!(removed, dir = %uploads.display(), "deleted unfinished uploads"),
        Ok(Err(cause)) => warn!(%cause, dir = %uploads.display(), "can't sweep the uploads folder"),
        Err(cause) => warn!(%cause, dir = %uploads.display(), "the uploads sweep got no thread"),
    }
}

/// Logs to stderr, which systemd puts in the journal (with its own timestamps).
/// `RUST_LOG` takes targets, as `info` or `tether=debug`.
fn init_tracing() {
    let filter = std::env::var("RUST_LOG")
        .ok()
        .and_then(|spec| spec.parse::<Targets>().ok())
        .unwrap_or_else(|| Targets::new().with_default(LevelFilter::INFO));
    let layer = tracing_subscriber::fmt::layer()
        .with_writer(std::io::stderr)
        .with_target(false);
    let logs = tracing_subscriber::registry().with(filter);
    if std::env::var_os("JOURNAL_STREAM").is_some() {
        logs.with(layer.without_time()).init();
    } else {
        logs.with(layer).init();
    }
}

fn enroll(config: &Config, ttl: Duration) -> Result<()> {
    let store = Store::open(config::state_dir()?)?;
    store.host_id()?;
    let code = store.set_pending(ttl, SystemTime::now())?;
    println!("Enrolment code: {code}");
    println!(
        "It works once, for {}.",
        humantime::format_duration(Duration::from_secs(ttl.as_secs()))
    );
    let api = LocalApi::system();
    let publication = runtime()?.block_on(api.tailnet_state());
    match publication {
        Ok(state) => {
            let path = config::runtime_dir()?.join("serve.sock");
            let origin = tether::auth::identity::SocketIdentity::of(&path)
                .map_err(|error| error.to_string())
                .and_then(|socket| {
                    state
                        .serve
                        .canonical_origin(socket, &path)
                        .map(|origin| origin.origin)
                        .map_err(|refusal| refusal.message)
                });
            match origin {
                Ok(origin) => {
                    let label = config
                        .name
                        .clone()
                        .filter(|name| !name.is_empty())
                        .unwrap_or_else(|| state.machine_name().to_owned());
                    println!("Host: {origin} ({label})");
                    println!("Browser: {origin}");
                }
                Err(refusal) => {
                    println!("Host: unavailable");
                    println!("Browser: {refusal}");
                }
            }
        }
        Err(cause) => {
            println!("Host: unknown ({cause})");
            println!("Browser: tailnet state is unavailable ({cause})");
        }
    }
    Ok(())
}

fn device(command: DeviceCommand) -> Result<()> {
    let store = Store::open(config::state_dir()?)?;
    match command {
        DeviceCommand::List => {
            let devices = store.read()?.devices;
            let api = LocalApi::system();
            let known = runtime()?.block_on(api.known_nodes()).ok();
            if devices.is_empty() {
                println!("No devices. `tether enroll` prints a code for the app's Add host.");
            }
            let width = devices
                .iter()
                .map(|d| d.name.chars().count())
                .max()
                .unwrap_or(0);
            for device in devices {
                let kind = match device.kind {
                    DeviceKind::Native => "native".to_owned(),
                    DeviceKind::Node => {
                        let id = device.node_id.as_deref().unwrap_or("?");
                        match &known {
                            Some(known) if known.contains(id) => {
                                format!("node {id} (known by tailscaled)")
                            }
                            Some(_) => format!("node {id} (not currently known)"),
                            None => format!("node {id} (status unavailable)"),
                        }
                    }
                };
                println!(
                    "{:width$}  {:<24}  {}  {}",
                    device.name, kind, device.enrolled_at, device.enrolled_by
                );
            }
        }
        DeviceCommand::Add { name } => {
            let added = store.add_device(&name, SystemTime::now())?;
            println!("Added {}. Its token, shown only now:", added.name);
            println!("{}", added.token);
        }
        DeviceCommand::Remove { name } => {
            if !store.remove_device(&name)? {
                return Err(format!("no device named {name:?}").into());
            }
            println!("Removed {name}. Its sockets close within 10 s.");
        }
    }
    Ok(())
}
