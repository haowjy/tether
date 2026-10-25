//! Daemon assembly and serving, shared by the CLI and foreground setup.

use std::error::Error;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[cfg(target_os = "macos")]
use crate::auth::identity;
#[cfg(not(target_os = "macos"))]
use crate::auth::identity::ServeTarget;
use crate::auth::localapi::LocalApi;
#[cfg(target_os = "macos")]
use crate::auth::publish;
use crate::auth::{Auth, Store};
use crate::blocking::Lanes;
use crate::complete::{self, Environment};
use crate::config::{self, Config, ConfigFile};
use crate::fs;
use crate::http::{self, App, Front, Listener};
use crate::hub::{self, Endpoints};
use crate::proto::HostInfo;
use crate::runtime::Runtime;
use tokio::signal::unix::{SignalKind, signal};
use tracing::{info, warn};
use tracing_subscriber::filter::{LevelFilter, Targets};
use tracing_subscriber::layer::SubscriberExt as _;
use tracing_subscriber::util::SubscriberInitExt as _;

type Result<T, E = Box<dyn Error>> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub(crate) enum OpenError {
    #[error("tether is already running")]
    AlreadyRunning,
    #[error(transparent)]
    Other(#[from] Box<dyn Error>),
}

/// How long shutdown waits for the hub to close its control clients.
const HUB_WAIT: Duration = Duration::from_secs(2);

/// Run the daemon behind its configured fronts.
pub fn serve(
    config: Config,
    file: ConfigFile,
    allow_login: Vec<String>,
    publish: bool,
) -> Result<()> {
    if publish && !cfg!(target_os = "macos") {
        return Err(config::ConfigError::PublishOnLinux.into());
    }
    init_tracing(LevelFilter::INFO);
    crate::blocking::runtime()?.block_on(async move {
        let opened = match open(config, file, allow_login, publish).await {
            Ok(opened) => opened,
            Err(OpenError::AlreadyRunning) => {
                return Err(Box::new(crate::runtime::RuntimeError::AlreadyRunning).into());
            }
            Err(OpenError::Other(error)) => return Err(error),
        };
        opened.run().await
    })
}

/// Resolve the budget, secure the runtime directory, lock the instance, and bind fronts.
pub(crate) async fn open(
    config: Config,
    file: ConfigFile,
    allow_login: Vec<String>,
    publish: bool,
) -> std::result::Result<Opened, OpenError> {
    let tier = crate::budget::resolve(config.memory_budget_mib)
        .map_err(|error| OpenError::Other(Box::new(error)))?;
    let runtime_dir = config::runtime_dir().map_err(|error| OpenError::Other(Box::new(error)))?;
    let runtime = open_runtime(runtime_dir, publish)
        .await
        .map_err(|error| match error {
            crate::runtime::RuntimeError::AlreadyRunning => OpenError::AlreadyRunning,
            error => OpenError::Other(Box::new(error)),
        })?;
    let parts = runtime.into_parts();
    let serve = assemble_serve_front(parts.serve).map_err(OpenError::Other)?;
    let state_dir = config::state_dir().map_err(|error| OpenError::Other(Box::new(error)))?;
    let store = Store::open(state_dir).map_err(|error| OpenError::Other(Box::new(error)))?;
    let home = config::home().map_err(|error| OpenError::Other(Box::new(error)))?;
    let host_id = store
        .host_id()
        .map_err(|error| OpenError::Other(Box::new(error)))?;
    let lanes = Lanes::default();
    let api = LocalApi::system();
    #[cfg(target_os = "macos")]
    let auth_target = serve.target.clone();
    #[cfg(not(target_os = "macos"))]
    let auth_target = Some(serve.target.clone());
    let auth = Auth::with_local_api(
        store,
        allow_login,
        lanes.auth.clone(),
        api,
        auth_target,
        serve.publication.clone(),
    );

    Ok(Opened {
        config,
        file,
        tier,
        _lock: parts._lock,
        local: parts.local,
        local_path: parts.local_path,
        paste_dir: parts.paste_dir,
        serve,
        auth,
        host_id,
        home,
        lanes,
    })
}

/// The daemon has its budget, instance lock, listeners, and auth state before serving.
pub(crate) struct Opened {
    config: Config,
    file: ConfigFile,
    tier: &'static crate::budget::Tier,
    _lock: std::fs::File,
    local: tokio::net::UnixListener,
    local_path: PathBuf,
    paste_dir: PathBuf,
    serve: ServeAssembly,
    auth: Auth,
    host_id: String,
    home: PathBuf,
    lanes: Lanes,
}

impl Opened {
    #[cfg(target_os = "linux")]
    pub(crate) fn auth(&self) -> &Auth {
        &self.auth
    }

    #[cfg(target_os = "linux")]
    pub(crate) fn serve_target(&self) -> &ServeTarget {
        &self.serve.target
    }

    /// Serve until shutdown.
    pub(crate) async fn run(self) -> Result<()> {
        let Opened {
            config,
            file,
            tier,
            _lock,
            local,
            local_path,
            paste_dir,
            serve,
            auth,
            host_id,
            home,
            lanes,
        } = self;
        let mut fronts = serve.fronts;
        fronts.push((Listener::Unix(local), Front::Local));

        let name = config.name.clone().unwrap_or_else(|| "tether".to_owned());
        let endpoint = config.endpoint();
        let mut shutdown = signal(SignalKind::terminate())?;
        let mut interrupt = signal(SignalKind::interrupt())?;

        start_file_api(&config, &home, &lanes).await;
        let (hub, mut hub_task) = hub::spawn(
            Endpoints {
                main: endpoint.clone(),
            },
            tier.caps.control_clients,
            name.clone(),
        );
        let hub_stop = hub.clone();
        let app = App {
            auth,
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
        let mut server = std::pin::pin!(http::serve(fronts, app, signalled,));
        let _ = sd_notify::notify(&[sd_notify::NotifyState::Ready]);
        info!(
            serve_front = %serve.description,
            local_socket = %local_path.display(),
            tmux = ?endpoint,
            version = env!("CARGO_PKG_VERSION"),
            "listening on private fronts"
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
}

struct ServeAssembly {
    fronts: Vec<(Listener, Front)>,
    target: ServeTargetState,
    publication: Option<crate::auth::publish::Publication>,
    description: String,
}

#[cfg(target_os = "macos")]
type ServeTargetState = Option<identity::ServeTarget>;
#[cfg(not(target_os = "macos"))]
type ServeTargetState = ServeTarget;

#[cfg(not(target_os = "macos"))]
async fn open_runtime(
    dir: PathBuf,
    publish: bool,
) -> std::result::Result<Runtime, crate::runtime::RuntimeError> {
    Runtime::open(dir, publish)
}

#[cfg(target_os = "macos")]
async fn open_runtime(
    dir: PathBuf,
    publish_requested: bool,
) -> std::result::Result<Runtime, crate::runtime::RuntimeError> {
    match Runtime::open(dir, publish_requested) {
        Ok(runtime) => Ok(runtime),
        Err(error @ crate::runtime::RuntimeError::MacFrontNotBound) => {
            publish::withdraw_unbound(&LocalApi::system()).await;
            Err(error)
        }
        Err(error) => Err(error),
    }
}

#[cfg(not(target_os = "macos"))]
fn assemble_serve_front(front: crate::runtime::ServeFront) -> Result<ServeAssembly> {
    let target = ServeTarget::unix(&front.path)?;
    Ok(ServeAssembly {
        fronts: vec![(Listener::Unix(front.listener), Front::UnixServe)],
        target,
        publication: None,
        description: format!("unix:{}", front.path.display()),
    })
}

#[cfg(target_os = "macos")]
fn assemble_serve_front(front: crate::runtime::ServeFront) -> Result<ServeAssembly> {
    let Some(listener) = front.listener else {
        return Ok(ServeAssembly {
            fronts: Vec::new(),
            target: None,
            publication: None,
            description: "local only".to_owned(),
        });
    };
    let port = listener.local_addr()?.port();
    let mac_front = crate::auth::MacFront::generate(port)?;
    let (target, publication, gate) = mac_front.into_parts();
    Ok(ServeAssembly {
        fronts: vec![(Listener::Tcp(listener), gate)],
        target: Some(target),
        publication: Some(publication),
        description: format!("127.0.0.1:{port}"),
    })
}

/// Deletes part files of uploads a daemon that died left, and warns of roots that
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
/// `RUST_LOG` takes targets, as `info` or `tether=debug`, and overrides `default`.
pub(crate) fn init_tracing(default: LevelFilter) {
    let filter = std::env::var("RUST_LOG")
        .ok()
        .and_then(|spec| spec.parse::<Targets>().ok())
        .unwrap_or_else(|| Targets::new().with_default(default));
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
