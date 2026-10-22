#![forbid(unsafe_code)]

use std::error::Error;
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::{Duration, SystemTime};

use clap::{Parser, Subcommand};
use tether::auth::identity::{Node, ServeConfig};
use tether::auth::{Auth, Store};
use tether::complete;
use tether::config::{self, Config, ConfigFile};
use tether::fs;
use tether::http::{self, App};
use tether::hub::{self, Endpoints};
use tether::proto::HostInfo;
use tokio::net::TcpListener;
use tokio::signal::unix::{SignalKind, signal};
use tracing::{info, warn};
use tracing_subscriber::filter::{LevelFilter, Targets};
use tracing_subscriber::layer::SubscriberExt as _;
use tracing_subscriber::util::SubscriberInitExt as _;

type Result<T, E = Box<dyn Error>> = std::result::Result<T, E>;

/// tokio's blocking pool, for file I/O and the state file's lock. systemd's `TasksMax`
/// counts these threads with tmux's.
const BLOCKING_THREADS: usize = 8;
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
    /// Run the daemon on 127.0.0.1, for `tailscale serve` to publish.
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
    /// Devices with their name, enrolment date and who enrolled them.
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
            ExitCode::FAILURE
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
    let store = Store::open(config::state_dir()?)?;
    let home = config::home()?;
    let host_id = store.host_id()?;
    let port = config.port;
    let node = Node::read()
        .await
        .map_err(|cause| format!("reading this node from tailscaled: {cause}"))?;
    let serve_config = ServeConfig::read()
        .await
        .map_err(|cause| format!("reading tailscale serve's config from tailscaled: {cause}"))?;
    let funnels = serve_config.funnels_to(port);
    if !funnels.is_empty() {
        return Err(format!(
            "Funnel puts 127.0.0.1:{port} on the public internet at {} (tailscaled's serve \
             config), and tether is tailnet-only. `tailscale funnel status` shows it; \
             `tailscale funnel reset` clears it, then publish with `tailscale serve`.",
            funnels.join(", ")
        )
        .into());
    }
    match serve_config.url_for(port) {
        Some(url) => info!(%url, "published by tailscale serve"),
        None => warn!(
            "tailscale serve doesn't publish 127.0.0.1:{port}: run `tailscale serve --bg \
             --https=443 http://127.0.0.1:{port}` (docs/running.md)"
        ),
    }
    let allow = match allow_login {
        logins if logins.is_empty() => vec![node.owner()?],
        logins => logins,
    };
    let name = config
        .name
        .clone()
        .unwrap_or_else(|| node.machine_name().to_owned());
    let mut shutdown = signal(SignalKind::terminate())?;
    let mut interrupt = signal(SignalKind::interrupt())?;
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, port))
        .await
        .map_err(|cause| format!("listening on 127.0.0.1:{port}: {cause}"))?;
    // Only once the port is ours: a second daemon started by mistake must not delete
    // the running one's pastes.
    let paste_dir = empty_dir(&config::runtime_dir()).await?;
    start_file_api(&config, &home).await;

    let endpoint = config.endpoint();
    let (hub, mut hub_task) = hub::spawn(Endpoints {
        main: endpoint.clone(),
    });
    let hub_stop = hub.clone();
    let app = App {
        auth: Auth::new(store, allow.clone()),
        hub,
        host: HostInfo { id: host_id, name },
        paste_dir,
        config: file,
        complete: complete::Settings::new(&config.complete, &home),
        home,
    };
    let signalled = async move {
        tokio::select! {
            _ = shutdown.recv() => {}
            _ = interrupt.recv() => {}
        }
        info!("shutting down");
        let _ = sd_notify::notify(&[sd_notify::NotifyState::Stopping]);
    };
    let mut server = std::pin::pin!(http::serve(listener, app, signalled));
    let _ = sd_notify::notify(&[sd_notify::NotifyState::Ready]);
    info!(port, ?allow, tmux = ?endpoint, version = env!("CARGO_PKG_VERSION"), "listening on 127.0.0.1");

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

/// The paste directory, 0700 and emptied: files left by a daemon that died are no
/// longer anyone's.
async fn empty_dir(dir: &Path) -> Result<PathBuf> {
    use std::os::unix::fs::PermissionsExt as _;
    match tokio::fs::remove_dir_all(dir).await {
        Ok(()) => {}
        Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => {}
        Err(cause) => return Err(format!("{}: {cause}", dir.display()).into()),
    }
    tokio::fs::create_dir_all(dir).await?;
    tokio::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).await?;
    Ok(dir.to_owned())
}

/// Deletes the part files of uploads a daemon that died left, and warns of roots that
/// fs ignores. Only once the port is ours, as for the paste directory.
async fn start_file_api(config: &Config, home: &Path) {
    for entry in config.roots.iter().chain([&config.uploads_dir]) {
        if fs::expand(entry, home).is_none() {
            warn!(%entry, "a root in config.toml isn't absolute or ~/: ignored");
        }
    }
    let Some(uploads) = fs::expand(&config.uploads_dir, home) else {
        return;
    };
    let dir = uploads.clone();
    match tokio::task::spawn_blocking(move || fs::upload::sweep(&dir)).await {
        Ok(Ok(0)) => {}
        Ok(Ok(removed)) => info!(removed, dir = %uploads.display(), "deleted unfinished uploads"),
        Ok(Err(cause)) => warn!(%cause, dir = %uploads.display(), "can't sweep the uploads folder"),
        Err(cause) => warn!(%cause, "the uploads sweep failed"),
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
    let port = config.port;
    let published = runtime()?.block_on(ServeConfig::read());
    match published.map(|serve| serve.url_for(port)) {
        Ok(Some(url)) => println!("Host: {url}"),
        Ok(None) => println!(
            "Host: none yet: tailscale serve doesn't publish 127.0.0.1:{port} (docs/running.md)"
        ),
        Err(cause) => println!("Host: unknown ({cause})"),
    }
    Ok(())
}

fn device(command: DeviceCommand) -> Result<()> {
    let store = Store::open(config::state_dir()?)?;
    match command {
        DeviceCommand::List => {
            let devices = store.read()?.devices;
            if devices.is_empty() {
                println!("No devices. `tether enroll` prints a code for the app's Add host.");
            }
            let width = devices
                .iter()
                .map(|d| d.name.chars().count())
                .max()
                .unwrap_or(0);
            for device in devices {
                println!(
                    "{:width$}  {}  {}",
                    device.name, device.enrolled_at, device.enrolled_by
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
