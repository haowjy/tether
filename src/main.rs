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
    /// Print a one-time code and browser link for the app's Add host. Replaces any earlier code.
    Enroll {
        /// How long the code works
        #[arg(long, default_value = "10m", value_parser = humantime::parse_duration)]
        ttl: Duration,
    },
    /// Run tether in this terminal, or install a background service with --background.
    Setup {
        /// Install tether as a systemd user service or LaunchAgent.
        #[arg(long)]
        background: bool,
    },
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
    let (result, error_exit) = match cli.command {
        Command::Setup { background } => (
            if background {
                tether::setup::setup(config_path)
            } else {
                tether::setup::setup_foreground(config_path)
            },
            ExitCode::FAILURE,
        ),
        Command::Teardown => (tether::setup::teardown(), ExitCode::FAILURE),
        Command::Serve {
            allow_login,
            publish,
        } => {
            let result = load_config(config_path.as_deref())
                .and_then(|(config, file)| daemon::serve(config, file, allow_login, publish));
            let error_exit = result
                .as_ref()
                .err()
                .map_or(ExitCode::FAILURE, |cause| serve_error_exit(&**cause));
            (result, error_exit)
        }
        Command::Enroll { ttl } => (
            load_config(config_path.as_deref()).and_then(|_| enroll(ttl)),
            ExitCode::FAILURE,
        ),
        Command::Device(command) => (
            load_config(config_path.as_deref()).and_then(|_| device(command)),
            ExitCode::FAILURE,
        ),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(cause) => {
            eprintln!("tether: {cause}");
            error_exit
        }
    }
}

fn load_config(path: Option<&std::path::Path>) -> Result<(Config, ConfigFile)> {
    let file = ConfigFile::resolve(path)?;
    let config = file.load()?;
    Ok((config, file))
}

fn serve_error_exit(cause: &(dyn Error + 'static)) -> ExitCode {
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

fn enroll(ttl: Duration) -> Result<()> {
    let store = Store::open(config::state_dir()?)?;
    store.host_id()?;
    let code = store.set_pending(ttl, SystemTime::now())?;
    println!("Enrolment code: {code}");
    println!(
        "It works once, for {}.",
        humantime::format_duration(Duration::from_secs(ttl.as_secs()))
    );
    #[cfg(target_os = "macos")]
    enroll_on_mac(&code)?;
    #[cfg(not(target_os = "macos"))]
    enroll_on_linux(&code)?;
    Ok(())
}

fn print_host_and_browser(origin: &str, code: &str) {
    let host = origin.strip_prefix("https://").unwrap_or(origin);
    println!("Host: {host}");
    println!("Browser: {origin}/#code={code}");
}

#[cfg(not(target_os = "macos"))]
fn enroll_on_linux(code: &str) -> Result<()> {
    let api = LocalApi::system();
    let publication = tether::blocking::runtime()?.block_on(identity::tailnet_state(&api));
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
                    print_host_and_browser(&origin, code);
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
fn enroll_on_mac(code: &str) -> Result<()> {
    let api = LocalApi::system();
    let socket = config::runtime_dir()?.join("local.sock");
    let info = tether::blocking::runtime()?.block_on(identity::read_auth_info(&socket, &api));
    match info {
        Ok(info) => {
            if let Some(origin) = info["browserOrigin"].as_str() {
                print_host_and_browser(origin, code);
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
