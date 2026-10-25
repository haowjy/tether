#![forbid(unsafe_code)]

use std::error::Error;
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::{Duration, SystemTime};

use clap::{Parser, Subcommand};
use tether::auth::identity;
#[cfg(not(target_os = "macos"))]
use tether::auth::identity::ServeTarget;
use tether::auth::localapi::LocalApi;
use tether::auth::{DeviceKind, Store};
use tether::blocking::BLOCKING_THREADS;
use tether::config::{self, Config, ConfigError, ConfigFile};
use tether::daemon;

type Result<T, E = Box<dyn Error>> = std::result::Result<T, E>;

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
    /// Run the daemon behind Tailscale Serve and local tools.
    Serve {
        /// Publish a Mac front through the LaunchAgent's socket activation.
        #[arg(long)]
        publish: bool,
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
    /// Install tether as a background service and publish it on your tailnet.
    Setup,
    /// Stop tether and remove its service and Serve handler.
    Teardown,
    /// List, add or remove enrolled devices.
    #[command(subcommand)]
    Device(DeviceCommand),
}

#[derive(Subcommand)]
enum DeviceCommand {
    /// List native devices and enrolled Tailscale nodes.
    List,
    /// Add a native device for the dev shim or Playwright and print its token once.
    Add { name: String },
    /// Remove a device: its token stops working, its sockets close within 10 s.
    Remove { name: String },
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let config_path = cli.config;
    let result = match cli.command {
        Command::Setup => tether::setup::setup(config_path),
        Command::Teardown => tether::setup::teardown(),
        command => ConfigFile::resolve(config_path.as_deref())
            .and_then(|file| Ok((file.load()?, file)))
            .map_err(Into::into)
            .and_then(|(config, file)| match command {
                Command::Serve {
                    allow_login,
                    publish,
                } => daemon::serve(config, file, allow_login, publish),
                Command::Enroll { ttl } => enroll(&config, ttl),
                Command::Device(command) => device(command),
                Command::Setup | Command::Teardown => unreachable!("handled above"),
            }),
    };
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
                        matches!(
                            error,
                            tether::runtime::RuntimeError::Directory(_)
                                | tether::runtime::RuntimeError::NoLaunchdSocket
                                | tether::runtime::RuntimeError::MacFrontNotBound
                        )
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

fn enroll(config: &Config, ttl: Duration) -> Result<()> {
    let store = Store::open(config::state_dir()?)?;
    store.host_id()?;
    let code = store.set_pending(ttl, SystemTime::now())?;
    println!("Enrolment code: {code}");
    println!(
        "It works once, for {}.",
        humantime::format_duration(Duration::from_secs(ttl.as_secs()))
    );
    #[cfg(target_os = "macos")]
    enroll_on_mac(config)?;
    #[cfg(not(target_os = "macos"))]
    enroll_on_linux(config)?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn enroll_on_linux(config: &Config) -> Result<()> {
    let api = LocalApi::system();
    let publication = runtime()?.block_on(identity::tailnet_state(&api));
    match publication {
        Ok(state) => {
            let path = config::runtime_dir()?.join("serve.sock");
            let origin = ServeTarget::unix(path)
                .map_err(|error| error.to_string())
                .and_then(|target| {
                    state
                        .serve
                        .canonical_origin(&target)
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

#[cfg(target_os = "macos")]
fn enroll_on_mac(config: &Config) -> Result<()> {
    let api = LocalApi::system();
    let socket = config::runtime_dir()?.join("local.sock");
    let info = runtime()?.block_on(identity::read_auth_info(&socket, &api));
    match info {
        Ok(info) => {
            let name = config
                .name
                .clone()
                .filter(|name| !name.is_empty())
                .or_else(|| info["name"].as_str().map(str::to_owned))
                .unwrap_or_else(|| "tether".to_owned());
            if let Some(origin) = info["browserOrigin"].as_str() {
                println!("Host: {origin} ({name})");
                println!("Browser: {origin}");
            } else {
                println!("Host: unavailable");
                println!(
                    "Browser: {}",
                    info["browserRefused"]
                        .as_str()
                        .unwrap_or("browser origin is unavailable")
                );
            }
        }
        Err(cause) if cause == "tether isn't running" => {
            println!("Host: unknown");
            println!("Browser: tether isn't running");
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
            let file = store.read()?;
            let refused = file
                .refused_device_names()
                .map(str::to_owned)
                .collect::<Vec<_>>();
            let devices = file.devices;
            if devices.is_empty() && refused.is_empty() {
                println!("No devices. `tether enroll` prints a code for the app's Add host.");
            }
            let width = devices
                .iter()
                .map(|d| d.name.chars().count())
                .chain(refused.iter().map(|name| name.chars().count()))
                .max()
                .unwrap_or(0);
            for device in devices {
                let kind = match device.kind {
                    DeviceKind::Native => "native".to_owned(),
                    DeviceKind::Node => {
                        let id = device.node_id.as_deref().unwrap_or("?");
                        format!("node {id}")
                    }
                };
                println!(
                    "{:width$}  {:<24}  {}  {}",
                    device.name, kind, device.enrolled_at, device.enrolled_by
                );
            }
            for name in refused {
                println!("{:width$}  {:<24}  -  -", name, "refused");
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
