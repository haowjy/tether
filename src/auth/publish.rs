//! Sans-IO plans and shared compare-and-swap writes for tether's Tailscale Serve handler.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{Map, Value, json};
use thiserror::Error;
use tokio::sync::watch;
use tracing::{debug, warn};

use super::identity::{self, ServeConfig, ServeTarget, ServeTargetMatcher, TailnetStateCell};
use super::localapi::{LocalApi, LocalApiError, SetServeConfigError};
use super::mac_front::MacFront;

const WRITE_ATTEMPTS: usize = 3;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
#[error("{message}")]
pub struct PublishRefusal {
    pub message: String,
}

impl PublishRefusal {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemovedHandler {
    pub entry: String,
    pub mount: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PlanResult {
    pub changed: bool,
    pub removed_handlers: Vec<RemovedHandler>,
}

#[derive(Debug, Error)]
pub enum PlanError {
    #[error("{0}")]
    Refused(#[from] PublishRefusal),
    #[error(transparent)]
    LocalApi(#[from] LocalApiError),
    #[error(transparent)]
    Write(#[from] SetServeConfigError),
    #[error("Tailscale's Serve config kept changing during three write attempts")]
    ConflictsExhausted,
}

#[derive(Debug, Clone, PartialEq)]
struct PlannedConfig {
    config: Value,
    removed_handlers: Vec<RemovedHandler>,
}

#[derive(Clone, Copy)]
enum ConflictRetry {
    UpTo(usize),
    UntilOuterDeadline,
}

#[derive(Clone, Copy)]
enum RemovalScope<'a> {
    AllEntries,
    Entry(&'a str),
}

#[derive(Clone, Copy)]
enum RemovalMode {
    Managed,
    Publish,
}

/// The one publication task's immutable Mac front and shared state.
#[derive(Clone)]
pub struct Publication {
    front: MacFront,
    state: watch::Sender<PublicationState>,
    observed: watch::Receiver<PublicationState>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PublicationState {
    Waiting { last_error: Option<String> },
    Published(Arc<str>),
    Refused(String),
}

impl Publication {
    pub fn new(front: MacFront) -> (Self, watch::Receiver<PublicationState>) {
        let (state, receiver) = watch::channel(PublicationState::Waiting { last_error: None });
        (
            Self {
                front,
                state,
                observed: receiver.clone(),
            },
            receiver,
        )
    }

    pub fn state(&self) -> &watch::Receiver<PublicationState> {
        &self.observed
    }

    fn publish(&self, authority: String) {
        self.state
            .send_replace(PublicationState::Published(Arc::from(authority)));
    }

    fn waiting_with_error(&self, error: String) {
        self.state.send_replace(PublicationState::Waiting {
            last_error: Some(error),
        });
    }

    fn refuse(&self, message: String) {
        self.state.send_replace(PublicationState::Refused(message));
    }
}

/// Runs the single publication owner until it publishes, refuses, or is cancelled.
pub async fn run(
    api: LocalApi,
    cell: TailnetStateCell,
    publication: Publication,
    on_published: impl Fn(&identity::TailnetState) + Send + Sync + 'static,
) {
    let mut delay = identity::RETRY_INITIAL;
    let mut warned = HashSet::new();
    loop {
        let result: Result<(), PlanError> = async {
            let state = cell.get().await?;
            let target = ServeTarget::loopback(publication.front.clone());
            let authority = match publish_target(&api, &state.dns_name, &target).await {
                Ok((authority, _)) => authority,
                Err(PlanError::Refused(refusal)) => {
                    warn!(message = %refusal.message, "refused to publish tether");
                    publication.refuse(refusal.message);
                    return Ok(());
                }
                Err(PlanError::LocalApi(error)) => return Err(PlanError::LocalApi(error)),
                Err(PlanError::Write(SetServeConfigError::LocalApi(error))) => {
                    return Err(PlanError::LocalApi(error));
                }
                Err(error) => return Err(error),
            };
            let refreshed = cell.refresh_after_write().await?;
            on_published(&refreshed);
            publication.publish(authority);
            Ok(())
        }
        .await;
        match result {
            Ok(()) => return,
            Err(error) => {
                let message = match &error {
                    PlanError::ConflictsExhausted => {
                        "Serve config changed during three publication attempts".to_owned()
                    }
                    _ => error.to_string(),
                };
                match &error {
                    PlanError::LocalApi(LocalApiError::Io(_) | LocalApiError::Timeout) => {
                        debug!(message = %message, "Serve publication unavailable; retrying");
                    }
                    _ => {
                        publication.waiting_with_error(message.clone());
                        if warned.insert(message.clone()) {
                            warn!(message = %message, "Serve publication failed; retrying");
                        }
                    }
                }
                tokio::time::sleep(delay).await;
                delay = (delay * 2).min(identity::RETRY_MAX);
            }
        }
    }
}

/// Publish a target using the same plan and If-Match loop used by teardown.
pub async fn publish_target(
    api: &LocalApi,
    dns_name: &str,
    target: &ServeTarget,
) -> Result<(String, PlanResult), PlanError> {
    let name = dns_name.trim_end_matches('.');
    if name.is_empty()
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
    {
        return Err(PublishRefusal::new(
            "Tailscale didn't report a usable MagicDNS name; tether can't publish",
        )
        .into());
    }
    let authority = format!("{name}:443");
    let result = apply_plan(
        api,
        |config| plan_publish_detailed(config, name, target).map(Some),
        ConflictRetry::UpTo(WRITE_ATTEMPTS),
    )
    .await?;
    Ok((authority, result))
}

/// Withdraw every handler owned by this target using the shared If-Match loop.
pub async fn withdraw_target(
    api: &LocalApi,
    target: &ServeTargetMatcher,
) -> Result<PlanResult, PlanError> {
    apply_plan(
        api,
        |config| plan_withdraw_detailed(config, target, RemovalScope::AllEntries),
        ConflictRetry::UpTo(WRITE_ATTEMPTS),
    )
    .await
}

async fn apply_plan(
    api: &LocalApi,
    mut plan: impl FnMut(Value) -> Result<Option<PlannedConfig>, PublishRefusal>,
    conflict_retry: ConflictRetry,
) -> Result<PlanResult, PlanError> {
    let mut attempts = 0;
    loop {
        let (current, etag) = api.serve_config_raw().await?;
        let planned = plan(current.clone())?;
        let Some(planned) = planned else {
            return Ok(PlanResult::default());
        };
        if planned.config == current {
            return Ok(PlanResult::default());
        }
        match api.set_serve_config(&planned.config, etag).await {
            Ok(()) => {
                return Ok(PlanResult {
                    changed: true,
                    removed_handlers: planned.removed_handlers,
                });
            }
            Err(SetServeConfigError::Conflict) => {
                attempts += 1;
                if matches!(conflict_retry, ConflictRetry::UpTo(limit) if attempts >= limit) {
                    return Err(PlanError::ConflictsExhausted);
                }
            }
            Err(error) => return Err(error.into()),
        }
    }
}

/// Best-effort withdrawal when launchd could not bind the configured Mac port.
pub async fn withdraw_unbound(api: &LocalApi) {
    let target = ServeTargetMatcher::loopback_any_port();
    let _ = tokio::time::timeout(Duration::from_secs(2), async {
        let state = identity::tailnet_state(api).await?;
        let entry = format!("{}:443", state.dns_name.trim_end_matches('.'));
        apply_plan(
            api,
            |config| plan_withdraw_detailed(config, &target, RemovalScope::Entry(&entry)),
            ConflictRetry::UntilOuterDeadline,
        )
        .await
    })
    .await;
}

/// Plans publication without discarding unknown Serve fields, then judges the result
/// with the same canonical-origin rule that admits requests.
pub fn plan_publish(
    config: Value,
    name: &str,
    target: &ServeTarget,
) -> Result<Value, PublishRefusal> {
    plan_publish_detailed(config, name, target).map(|plan| plan.config)
}

fn plan_publish_detailed(
    mut config: Value,
    name: &str,
    target: &ServeTarget,
) -> Result<PlannedConfig, PublishRefusal> {
    let _ = ServeConfig::parse(&mut config).map_err(|_| {
        PublishRefusal::new(
            "Tailscale's Serve config has an unsupported shape; reset Serve before starting tether",
        )
    })?;
    let proxy_url = target.proxy_url();
    let matcher = target.matcher();

    let root = config.as_object_mut().ok_or_else(|| {
        PublishRefusal::new(
            "Tailscale's Serve config isn't an object; reset Serve before starting tether",
        )
    })?;
    ensure_object_member(root, "Web")?;
    ensure_object_member(root, "TCP")?;
    let key = format!("{name}:443");

    let (mut removed_handlers, removed_ports) = {
        let web = root
            .get_mut("Web")
            .and_then(Value::as_object_mut)
            .expect("validated Web object");
        remove_handlers(
            web,
            &matcher,
            RemovalScope::AllEntries,
            RemovalMode::Publish,
        )
    };
    let used_ports = root
        .get("Web")
        .and_then(Value::as_object)
        .map(web_ports_in_use)
        .unwrap_or_default();
    if let Some(tcp) = root.get_mut("TCP").and_then(Value::as_object_mut) {
        clean_unused_https_ports(tcp, &removed_ports, &used_ports);
    }

    let web_entry = root
        .get_mut("Web")
        .and_then(Value::as_object_mut)
        .expect("validated Web object")
        .entry(key.clone())
        .or_insert_with(|| Value::Object(Map::new()));
    let server = web_entry.as_object_mut().ok_or_else(|| {
        PublishRefusal::new(format!(
            "Tailscale Serve entry {key} has an unsupported shape; reset it before starting tether"
        ))
    })?;
    let handlers = server
        .entry("Handlers")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or_else(|| {
            PublishRefusal::new(format!(
                "Tailscale Serve entry {key} has an unsupported shape; reset Serve before starting tether"
            ))
        })?;
    let mut mount = "/".to_owned();
    while handlers.contains_key(&mount) {
        mount.push('_');
    }
    handlers.insert(mount, json!({ "Proxy": proxy_url }));
    let tcp = root
        .get_mut("TCP")
        .and_then(Value::as_object_mut)
        .expect("validated TCP object");
    if !tcp.contains_key("443") {
        tcp.insert("443".to_owned(), json!({ "HTTPS": true }));
    }

    removed_handlers.retain(|handler| {
        config
            .get("Web")
            .and_then(|web| web.get(&handler.entry))
            .and_then(|entry| entry.get("Handlers"))
            .and_then(|handlers| handlers.get(&handler.mount))
            .and_then(|handler| handler.get("Proxy"))
            .and_then(Value::as_str)
            != Some(proxy_url.as_str())
    });

    let typed = ServeConfig::parse(&mut config).map_err(|_| {
        PublishRefusal::new(
            "Tailscale's planned Serve config has an unsupported shape; reset Serve before starting tether",
        )
    })?;
    typed
        .canonical_origin(target)
        .map_err(|refusal| PublishRefusal::new(refusal.message))?;
    Ok(PlannedConfig {
        config,
        removed_handlers,
    })
}

/// Removes tether-shaped handlers wherever they appear and drops only empty entries
/// and now-unused TCP entries whose only field is `HTTPS: true`.
pub fn plan_withdraw(
    config: Value,
    target: &ServeTargetMatcher,
) -> Result<Option<Value>, PublishRefusal> {
    plan_withdraw_detailed(config, target, RemovalScope::AllEntries)
        .map(|plan| plan.map(|plan| plan.config))
}

fn plan_withdraw_detailed(
    config: Value,
    target: &ServeTargetMatcher,
    scope: RemovalScope<'_>,
) -> Result<Option<PlannedConfig>, PublishRefusal> {
    let mut config = config;
    let _ = ServeConfig::parse(&mut config).map_err(|_| {
        PublishRefusal::new(
            "Tailscale's Serve config has an unsupported shape; reset Serve before withdrawing tether",
        )
    })?;
    let root = config.as_object_mut().ok_or_else(|| {
        PublishRefusal::new(
            "Tailscale's Serve config isn't an object; reset Serve before withdrawing tether",
        )
    })?;
    let Some(web) = root.get_mut("Web").and_then(Value::as_object_mut) else {
        return Ok(None);
    };
    let (removed_handlers, removed_ports) =
        remove_handlers(web, target, scope, RemovalMode::Managed);
    if removed_handlers.is_empty() {
        return Ok(None);
    }
    let used_ports = root
        .get("Web")
        .and_then(Value::as_object)
        .map(web_ports_in_use)
        .unwrap_or_default();
    if let Some(tcp) = root.get_mut("TCP").and_then(Value::as_object_mut) {
        clean_unused_https_ports(tcp, &removed_ports, &used_ports);
    }
    Ok(Some(PlannedConfig {
        config,
        removed_handlers,
    }))
}

fn remove_handlers(
    web: &mut Map<String, Value>,
    target: &ServeTargetMatcher,
    scope: RemovalScope<'_>,
    mode: RemovalMode,
) -> (Vec<RemovedHandler>, Vec<u16>) {
    let mut removed = Vec::new();
    let mut empty_entries = Vec::new();
    for (entry_name, entry) in web.iter_mut() {
        if matches!(scope, RemovalScope::Entry(only) if only != entry_name) {
            continue;
        }
        let Some(handlers) = entry
            .as_object_mut()
            .and_then(|server| server.get_mut("Handlers"))
            .and_then(Value::as_object_mut)
        else {
            continue;
        };
        let before = handlers.len();
        handlers.retain(|mount, handler| {
            let proxy = handler.get("Proxy").and_then(Value::as_str);
            let managed = proxy.is_some_and(|proxy| target.matches(proxy));
            let legacy = matches!(mode, RemovalMode::Publish)
                && matches!(target, ServeTargetMatcher::Unix(_))
                && mount == "/"
                && host_port(entry_name) == Some(443)
                && proxy == Some("http://127.0.0.1:7850");
            if managed || legacy {
                removed.push(RemovedHandler {
                    entry: entry_name.clone(),
                    mount: mount.clone(),
                });
                false
            } else {
                true
            }
        });
        if handlers.len() != before && handlers.is_empty() {
            empty_entries.push(entry_name.clone());
        }
    }
    let mut ports = Vec::new();
    for entry in empty_entries {
        web.remove(&entry);
        if let Some(port) = host_port(&entry) {
            ports.push(port);
        }
    }
    (removed, ports)
}

fn ensure_object_member(root: &mut Map<String, Value>, name: &str) -> Result<(), PublishRefusal> {
    if !root.contains_key(name) {
        root.insert(name.to_owned(), Value::Object(Map::new()));
    }
    if root.get(name).and_then(Value::as_object).is_none() {
        Err(PublishRefusal::new(format!(
            "Tailscale's Serve {name} config has an unsupported shape; reset Serve before starting tether"
        )))
    } else {
        Ok(())
    }
}

fn clean_unused_https_ports(
    tcp: &mut Map<String, Value>,
    ports: &[u16],
    used_ports: &HashSet<u16>,
) {
    for port in ports {
        let key = port.to_string();
        if tcp.get(&key).is_some_and(is_https_only) && !used_ports.contains(port) {
            tcp.remove(&key);
        }
    }
}

fn is_https_only(value: &Value) -> bool {
    value.as_object().is_some_and(|object| {
        object.len() == 1 && object.get("HTTPS").and_then(Value::as_bool) == Some(true)
    })
}

fn web_ports_in_use(web: &Map<String, Value>) -> HashSet<u16> {
    web.iter()
        .filter(|(_, entry)| {
            entry
                .get("Handlers")
                .and_then(Value::as_object)
                .is_some_and(|handlers| !handlers.is_empty())
        })
        .filter_map(|(name, _)| host_port(name))
        .collect()
}

fn host_port(value: &str) -> Option<u16> {
    value.parse::<axum::http::uri::Authority>().ok()?.port_u16()
}

#[cfg(test)]
mod tests {
    use super::{plan_publish, plan_publish_detailed, plan_withdraw};
    use crate::auth::identity::{ServeTarget, ServeTargetMatcher};
    use crate::auth::mac_front::MacFront;
    use serde_json::json;

    const SECRET: &str = "tether-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    fn mac_target(port: u16) -> ServeTarget {
        ServeTarget::loopback(MacFront::new(port, SECRET))
    }

    fn mac_matcher(port: u16) -> ServeTargetMatcher {
        mac_target(port).matcher()
    }

    #[test]
    fn publish_replaces_only_its_port_and_preserves_unknown_fields() {
        let old = format!("http://127.0.0.1:7851/{SECRET}");
        let other = format!("http://127.0.0.1:9000/{SECRET}");
        let config = json!({
            "unknownRoot": { "kept": true },
            "Web": {
                "old.ts.net:443": { "Handlers": { "/": { "Proxy": old } }, "unknown": 7 },
                "other.ts.net:443": { "Handlers": { "/": { "Proxy": other } } },
                "empty.ts.net:443": { "Handlers": {} }
            },
            "TCP": { "443": { "HTTPS": true }, "8443": { "HTTPS": true } },
            "AllowFunnel": { "new.ts.net:443": false }
        });
        let planned = plan_publish(config, "new.ts.net", &mac_target(7851)).expect("plan");
        assert_eq!(planned["unknownRoot"]["kept"], true);
        assert!(planned["Web"]["old.ts.net:443"].is_null());
        assert_eq!(
            planned["Web"]["other.ts.net:443"]["Handlers"]["/"]["Proxy"],
            other
        );
        assert_eq!(planned["Web"]["empty.ts.net:443"]["Handlers"], json!({}));
        assert_eq!(
            planned["Web"]["new.ts.net:443"]["Handlers"]["/"]["Proxy"],
            "http://127.0.0.1:7851/".to_owned() + SECRET
        );
        assert_eq!(planned["TCP"]["443"]["HTTPS"], true);
        assert_eq!(planned["TCP"]["8443"]["HTTPS"], true);
    }

    #[test]
    fn publish_from_null_is_idempotent_in_tailscaled_stored_shape() {
        let target = mac_target(7851);
        let planned = plan_publish(serde_json::Value::Null, "new.ts.net", &target)
            .expect("plan from an unconfigured profile");
        assert_eq!(
            planned["Web"]["new.ts.net:443"],
            json!({ "Handlers": { "/": { "Proxy": format!("http://127.0.0.1:7851/{SECRET}") } } })
        );
        assert_eq!(planned["TCP"]["443"], json!({ "HTTPS": true }));

        let rerun =
            plan_publish_detailed(planned.clone(), "new.ts.net", &target).expect("rerun plan");
        assert_eq!(rerun.config, planned);
        assert!(rerun.removed_handlers.is_empty());
    }

    #[test]
    fn unix_publish_removes_exact_target_and_old_root_proxy_but_keeps_other_handlers() {
        let socket =
            std::env::temp_dir().join(format!("tether-publish-{}.sock", std::process::id()));
        let _ = std::fs::remove_file(&socket);
        let _listener = std::os::unix::net::UnixListener::bind(&socket).expect("bind test socket");
        let target = ServeTarget::unix(&socket).expect("target identity");
        let config = json!({
            "Web": {
                "old.ts.net:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:7850" } } },
                "prior.ts.net:443": { "Handlers": { "/old": { "Proxy": format!("unix:{}", socket.display()) } } },
                "keep.ts.net:8443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:7850" } } }
            }
        });
        let planned = plan_publish(config, "new.ts.net", &target).expect("valid plan");
        assert!(planned["Web"]["old.ts.net:443"].is_null());
        assert!(planned["Web"]["prior.ts.net:443"].is_null());
        assert_eq!(
            planned["Web"]["keep.ts.net:8443"]["Handlers"]["/"]["Proxy"],
            "http://127.0.0.1:7850"
        );
        assert_eq!(
            planned["Web"]["new.ts.net:443"]["Handlers"]["/"]["Proxy"],
            format!("unix:{}", socket.display())
        );
        drop(_listener);
        let _ = std::fs::remove_file(socket);
    }

    #[test]
    fn publish_refuses_funnel_tcp_forward_and_another_handler() {
        let cases = [
            json!({ "AllowFunnel": { "new.ts.net:443": true } }),
            json!({ "TCP": { "443": { "TCPForward": "127.0.0.1:22" } } }),
            json!({ "Web": { "new.ts.net:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:3000" } } } } }),
        ];
        for config in cases {
            assert!(plan_publish(config, "new.ts.net", &mac_target(7851)).is_err());
        }
    }

    #[test]
    fn withdraw_removes_target_handlers_across_entries_and_unused_https_port() {
        let config = json!({
            "Web": {
                "devbox.ts.net:443": {
                    "Handlers": {
                        "/": { "Proxy": format!("http://127.0.0.1:7851/{SECRET}") },
                        "/keep": { "Proxy": "http://127.0.0.1:3000" }
                    }
                },
                "old.ts.net:8443": { "Handlers": { "/": { "Proxy": format!("http://127.0.0.1:7851/{SECRET}") } } }
            },
            "TCP": { "443": { "HTTPS": true }, "8443": { "HTTPS": true }, "9443": { "HTTPS": true, "opaque": true } }
        });
        let planned = plan_withdraw(config, &mac_matcher(7851))
            .expect("valid")
            .expect("changed");
        assert_eq!(
            planned["Web"]["devbox.ts.net:443"]["Handlers"]["/keep"]["Proxy"],
            "http://127.0.0.1:3000"
        );
        assert!(planned["Web"]["old.ts.net:8443"].is_null());
        assert!(planned["TCP"]["8443"].is_null());
        assert_eq!(planned["TCP"]["443"]["HTTPS"], true);
        assert_eq!(planned["TCP"]["9443"]["opaque"], true);
    }

    #[test]
    fn withdraw_removes_exact_unix_proxy_without_a_live_socket() {
        let path = "/run/user/1000/tether/serve.sock";
        let config = json!({
            "Web": {
                "old.ts.net:443": { "Handlers": { "/": { "Proxy": format!("unix:{path}") } } },
                "other.ts.net:8443": { "Handlers": { "/": { "Proxy": "unix:/run/user/1000/tether/serve.sock.backup" } } }
            },
            "TCP": { "443": { "HTTPS": true } }
        });
        let planned = plan_withdraw(config, &ServeTargetMatcher::unix(path))
            .expect("valid")
            .expect("changed");
        assert!(planned["Web"]["old.ts.net:443"].is_null());
        assert!(planned["Web"]["other.ts.net:8443"].is_object());
        assert!(planned["TCP"]["443"].is_null());
    }

    #[test]
    fn withdraw_is_noop_without_its_tether_handler() {
        let config = json!({ "Web": { "devbox.ts.net:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:3000" } } } } });
        assert_eq!(
            plan_withdraw(config, &mac_matcher(7851)).expect("valid"),
            None
        );
    }
}
