//! Sans-IO plans for replacing and withdrawing tether's own Tailscale Serve handler.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{Map, Value, json};
use thiserror::Error;
use tokio::sync::watch;
use tracing::{debug, warn};

use super::identity::{self, ServeConfig, ServeTarget, TailnetStateCell};
use super::localapi::{LocalApi, LocalApiError, SetServeConfigError};
use super::mac_front::MacFront;

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
pub enum PublicationState {
    Waiting { last_error: Option<String> },
    Published(Arc<str>),
    Refused(String),
}

/// The one publication task's immutable Mac front and shared state.
#[derive(Clone)]
pub struct Publication {
    front: MacFront,
    state: watch::Sender<PublicationState>,
    observed: watch::Receiver<PublicationState>,
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
        let result: Result<(), LocalApiError> = async {
            let state = cell.get().await?;
            let authority = match publish_config(&api, &state.dns_name, &publication.front).await? {
                Ok(authority) => authority,
                Err(refusal) => {
                    warn!(message = %refusal.message, "refused to publish tether");
                    publication.refuse(refusal.message);
                    return Ok(());
                }
            };
            let refreshed = cell.refresh_after_write().await?;
            on_published(&refreshed);
            publication.publish(authority);
            Ok(())
        }
        .await;
        match result {
            Ok(()) => {
                return;
            }
            Err(error) => {
                let message = error.to_string();
                match error {
                    LocalApiError::Io(_) | LocalApiError::Timeout => {
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

async fn publish_config(
    api: &LocalApi,
    dns_name: &str,
    front: &MacFront,
) -> Result<Result<String, PublishRefusal>, LocalApiError> {
    let name = dns_name.trim_end_matches('.');
    if name.is_empty()
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
    {
        return Ok(Err(PublishRefusal::new(
            "Tailscale didn't report a usable MagicDNS name; tether can't publish",
        )));
    }
    let authority = format!("{name}:443");
    for _ in 0..3 {
        let (config, etag) = api.serve_config_raw().await?;
        let original = config.clone();
        let planned = match plan_publish(config, name, front) {
            Ok(config) => config,
            Err(refusal) => return Ok(Err(refusal)),
        };
        if planned == original {
            return Ok(Ok(authority));
        }
        match api.set_serve_config(&planned, etag).await {
            Ok(()) => return Ok(Ok(authority)),
            Err(SetServeConfigError::Conflict) => continue,
            Err(SetServeConfigError::LocalApi(error)) => return Err(error),
        }
    }
    Err(LocalApiError::Http(
        "Serve config changed during three publication attempts".to_owned(),
    ))
}

/// Best-effort withdrawal used only when launchd gave tether an unbound socket.
pub async fn withdraw_unbound(api: &LocalApi) {
    let _ = tokio::time::timeout(Duration::from_secs(2), async {
        let state = identity::tailnet_state(api).await?;
        let name = state.dns_name.trim_end_matches('.');
        loop {
            let (config, etag) = api.serve_config_raw().await?;
            let Some(planned) = plan_withdraw(config, name) else {
                return Ok::<_, LocalApiError>(());
            };
            match api.set_serve_config(&planned, etag).await {
                Ok(()) => return Ok(()),
                Err(SetServeConfigError::Conflict) => continue,
                Err(SetServeConfigError::LocalApi(error)) => return Err(error),
            }
        }
    })
    .await;
}

/// Plans the next Mac publication without discarding unknown fields, then judges it
/// with the same canonical-origin rule that admits requests.
pub fn plan_publish(
    mut config: Value,
    name: &str,
    front: &MacFront,
) -> Result<Value, PublishRefusal> {
    let _ = ServeConfig::parse(&mut config).map_err(|_| {
        PublishRefusal::new(
            "Tailscale's Serve config has an unsupported shape; reset Serve before starting tether",
        )
    })?;
    let port = front.port();
    let proxy_url = front.proxy_url();

    let root = config.as_object_mut().ok_or_else(|| {
        PublishRefusal::new(
            "Tailscale's Serve config isn't an object; reset Serve before starting tether",
        )
    })?;
    ensure_object_member(root, "Web")?;
    ensure_object_member(root, "TCP")?;
    let key = format!("{name}:443");

    let removed_ports = {
        let web = root
            .get_mut("Web")
            .and_then(Value::as_object_mut)
            .expect("validated Web object");
        let mut empty_entries = Vec::new();
        for (name, entry) in web.iter_mut() {
            let Some(handlers) = entry
                .as_object_mut()
                .and_then(|server| server.get_mut("Handlers"))
                .and_then(Value::as_object_mut)
            else {
                continue;
            };
            if remove_tether_handlers(handlers, Some(port)) && handlers.is_empty() {
                empty_entries.push(name.clone());
            }
        }
        let mut ports = Vec::new();
        for name in empty_entries {
            web.remove(&name);
            if let Some(port) = host_port(&name) {
                ports.push(port);
            }
        }
        ports
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
    server.insert("HTTPS".to_owned(), Value::Bool(true));
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

    let typed = ServeConfig::parse(&mut config).map_err(|_| {
        PublishRefusal::new(
            "Tailscale's planned Serve config has an unsupported shape; reset Serve before starting tether",
        )
    })?;
    let target = ServeTarget::loopback(front.clone());
    typed
        .canonical_origin(&target)
        .map_err(|refusal| PublishRefusal::new(refusal.message))?;
    Ok(config)
}

/// Removes tether-shaped handlers at one Serve name, for the launchd-bind failure path.
pub fn plan_withdraw(mut config: Value, name: &str) -> Option<Value> {
    let root = config.as_object_mut()?;
    let key = format!("{name}:443");
    let web = root.get_mut("Web")?.as_object_mut()?;
    let handlers = web
        .get_mut(&key)
        .and_then(Value::as_object_mut)?
        .get_mut("Handlers")
        .and_then(Value::as_object_mut)?;
    if !remove_tether_handlers(handlers, None) {
        return None;
    }
    let remove_entry = handlers.is_empty();
    if remove_entry {
        web.remove(&key);
    }
    if remove_entry {
        let used_ports = root
            .get("Web")
            .and_then(Value::as_object)
            .map(web_ports_in_use)
            .unwrap_or_default();
        if !used_ports.contains(&443) {
            if let Some(tcp) = root.get_mut("TCP").and_then(Value::as_object_mut) {
                if tcp.get("443").is_some_and(is_https_only) {
                    tcp.remove("443");
                }
            }
        }
    }
    Some(config)
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

fn remove_tether_handlers(handlers: &mut Map<String, Value>, port: Option<u16>) -> bool {
    let before = handlers.len();
    handlers.retain(|_, handler| {
        !handler
            .get("Proxy")
            .and_then(Value::as_str)
            .is_some_and(|proxy| MacFront::is_tether_shaped(proxy, port))
    });
    handlers.len() != before
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
    use super::{plan_publish, plan_withdraw};
    use crate::auth::mac_front::MacFront;
    use serde_json::json;

    const SECRET: &str = "tether-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    fn target(port: u16) -> String {
        format!("http://127.0.0.1:{port}/{SECRET}")
    }

    fn target_front(port: u16) -> MacFront {
        MacFront::new(port, SECRET)
    }

    #[test]
    fn publish_replaces_only_its_port_and_preserves_unknown_fields() {
        let old = target(7851);
        let other = target(9000);
        let config = json!({
            "unknownRoot": { "kept": true },
            "Web": {
                "old.ts.net:443": { "HTTPS": true, "Handlers": { "/": { "Proxy": old } }, "unknown": 7 },
                "other.ts.net:443": { "HTTPS": true, "Handlers": { "/": { "Proxy": other } } },
                "empty.ts.net:443": { "Handlers": {} }
            },
            "TCP": { "443": { "HTTPS": true }, "8443": { "HTTPS": true } },
            "AllowFunnel": { "new.ts.net:443": false }
        });
        let planned = plan_publish(config, "new.ts.net", &target_front(7851)).expect("plan");
        assert_eq!(planned["unknownRoot"]["kept"], true);
        assert!(planned["Web"]["old.ts.net:443"].is_null());
        assert_eq!(
            planned["Web"]["other.ts.net:443"]["Handlers"]["/"]["Proxy"],
            other
        );
        assert_eq!(planned["Web"]["empty.ts.net:443"]["Handlers"], json!({}));
        assert_eq!(
            planned["Web"]["new.ts.net:443"]["Handlers"]["/"]["Proxy"],
            target(7851)
        );
        assert_eq!(planned["TCP"]["443"]["HTTPS"], true);
        assert_eq!(planned["TCP"]["8443"]["HTTPS"], true);
    }

    #[test]
    fn publish_refuses_funnel_tcp_forward_and_another_handler() {
        let cases = [
            json!({ "AllowFunnel": { "new.ts.net:443": true } }),
            json!({ "TCP": { "443": { "TCPForward": "127.0.0.1:22" } } }),
            json!({ "Web": { "new.ts.net:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:3000" } } } } }),
        ];
        for config in cases {
            assert!(plan_publish(config, "new.ts.net", &target_front(7851)).is_err());
        }
    }

    #[test]
    fn withdraw_removes_only_named_tether_handlers_and_unused_https_port() {
        let config = json!({
            "Web": {
                "devbox.ts.net:443": {
                    "HTTPS": true,
                    "Handlers": {
                        "/": { "Proxy": target(7851) },
                        "/old": { "Proxy": target(9000) },
                        "/keep": { "Proxy": "http://127.0.0.1:3000" }
                    }
                },
                "elsewhere.ts.net:443": { "HTTPS": true, "Handlers": { "/": { "Proxy": target(7851) } } }
            },
            "TCP": { "443": { "HTTPS": true, "opaque": "preserve" } }
        });
        let planned = plan_withdraw(config, "devbox.ts.net").expect("changed");
        assert_eq!(
            planned["Web"]["devbox.ts.net:443"]["Handlers"]
                .as_object()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            planned["Web"]["devbox.ts.net:443"]["Handlers"]["/keep"]["Proxy"],
            "http://127.0.0.1:3000"
        );
        assert!(planned["Web"]["elsewhere.ts.net:443"].is_object());
        assert_eq!(planned["TCP"]["443"]["opaque"], "preserve");
    }

    #[test]
    fn withdraw_is_noop_without_its_tether_handler() {
        let config = json!({ "Web": { "devbox.ts.net:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:3000" } } } } });
        assert_eq!(plan_withdraw(config, "devbox.ts.net"), None);
    }

    #[test]
    fn withdraw_drops_only_an_unused_plain_https_port_entry() {
        let config = json!({
            "Web": {
                "devbox.ts.net:443": {
                    "HTTPS": true,
                    "Handlers": { "/": { "Proxy": target(7851) } }
                }
            },
            "TCP": { "443": { "HTTPS": true }, "8443": { "HTTPS": true, "opaque": true } },
            "UnknownRoot": "kept"
        });
        let planned = plan_withdraw(config, "devbox.ts.net").expect("changed");
        assert!(planned["Web"]["devbox.ts.net:443"].is_null());
        assert!(planned["TCP"]["443"].is_null());
        assert_eq!(planned["TCP"]["8443"]["opaque"], true);
        assert_eq!(planned["UnknownRoot"], "kept");
    }
}
