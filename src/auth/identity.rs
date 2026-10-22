//! Tailscale identity (auth.md "Tailscale identity", plan.md "Security"): the check on
//! every request, and a small client for tailscaled's LocalAPI, which tells the daemon
//! whose tailnet node this is (the login allowlist), the machine's MagicDNS name, and
//! what `tailscale serve` publishes (the Funnel check, the host's URL).

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::Path;
use std::time::Duration;

use axum::http::{HeaderMap, Request, header};
use bytes::Bytes;
use http_body_util::{BodyExt as _, Empty, Limited};
use hyper_util::rt::TokioIo;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use thiserror::Error;
use tokio::net::UnixStream;

/// Added by `tailscale serve` to every proxied request, WebSocket upgrades included.
pub const LOGIN_HEADER: &str = "tailscale-user-login";

/// tailscaled's socket on Linux, then the open-source macOS daemon's.
const SOCKETS: [&str; 2] = [
    "/var/run/tailscale/tailscaled.sock",
    "/var/run/tailscaled.socket",
];
const LOCALAPI_TIMEOUT: Duration = Duration::from_secs(2);
const LOCALAPI_MAX_BODY: usize = 1024 * 1024;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum IdentityError {
    #[error("the peer {0} isn't loopback")]
    NotLoopback(SocketAddr),
    #[error("no Tailscale-User-Login header: not through tailscale serve")]
    NoLogin,
    #[error("login {0} isn't allowed")]
    NotAllowed(String),
}

/// The Tailscale check: a loopback peer, and a login in the allowlist. Returns the
/// login. Any process on the box can forge the header; those already run as Jimmy.
pub fn check(
    allow: &[String],
    peer: SocketAddr,
    headers: &HeaderMap,
) -> Result<String, IdentityError> {
    if !peer.ip().is_loopback() {
        return Err(IdentityError::NotLoopback(peer));
    }
    let login = headers
        .get(LOGIN_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or(IdentityError::NoLogin)?;
    if !allow.iter().any(|allowed| allowed == login) {
        return Err(IdentityError::NotAllowed(login.to_owned()));
    }
    Ok(login.to_owned())
}

#[derive(Debug, Error)]
pub enum LocalApiError {
    #[error("no tailscaled socket at {}", SOCKETS.join(" or "))]
    NoSocket,
    #[error("can't reach tailscaled: {0}")]
    Io(#[from] std::io::Error),
    #[error("tailscaled's LocalAPI: {0}")]
    Http(String),
    #[error("tailscaled didn't answer within {LOCALAPI_TIMEOUT:?}")]
    Timeout,
    #[error("tailscaled's {path} isn't the expected JSON: {error}")]
    Json {
        path: &'static str,
        error: serde_json::Error,
    },
    #[error("tailscaled reports no logged-in user (state {0}); pass --allow-login")]
    NoUser(String),
}

/// This node, from `GET /localapi/v0/status`.
#[derive(Debug, Clone)]
pub struct Node {
    /// The login of the node's owner: the default allowlist.
    pub login: Option<String>,
    /// The MagicDNS name, without the trailing dot.
    pub dns_name: String,
    backend_state: String,
}

impl Node {
    pub async fn read() -> Result<Self, LocalApiError> {
        #[derive(Deserialize)]
        struct Status {
            #[serde(rename = "BackendState", default)]
            backend_state: String,
            #[serde(rename = "Self")]
            this: Option<Peer>,
            #[serde(rename = "User", default)]
            users: HashMap<String, User>,
        }
        #[derive(Deserialize)]
        struct Peer {
            #[serde(rename = "UserID", default)]
            user_id: u64,
            #[serde(rename = "DNSName", default)]
            dns_name: String,
        }
        #[derive(Deserialize)]
        struct User {
            #[serde(rename = "LoginName", default)]
            login_name: String,
        }
        let status: Status = get("/localapi/v0/status?peers=false").await?;
        let this = status.this;
        let login = this.as_ref().and_then(|this| {
            let user = status.users.get(&this.user_id.to_string())?;
            Some(user.login_name.clone()).filter(|login| !login.is_empty())
        });
        Ok(Self {
            login,
            dns_name: this.map_or_else(String::new, |this| {
                this.dns_name.trim_end_matches('.').to_owned()
            }),
            backend_state: status.backend_state,
        })
    }

    /// The default allowlist: the node owner's login.
    pub fn owner(&self) -> Result<String, LocalApiError> {
        self.login
            .clone()
            .ok_or_else(|| LocalApiError::NoUser(self.backend_state.clone()))
    }

    /// The MagicDNS machine name: the first label.
    pub fn machine_name(&self) -> &str {
        self.dns_name.split('.').next().unwrap_or_default()
    }
}

/// What `tailscale serve` and `tailscale funnel` publish: `GET /localapi/v0/serve-config`.
/// Only the parts tether reads; the rest is ignored.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ServeConfig {
    /// Public port → handler.
    #[serde(rename = "TCP", default)]
    tcp: HashMap<String, TcpHandler>,
    /// Public `host:port` → HTTP handlers.
    #[serde(rename = "Web", default)]
    web: HashMap<String, WebServer>,
    /// Public `host:port` → whether Funnel exposes it to the internet.
    #[serde(rename = "AllowFunnel", default)]
    allow_funnel: HashMap<String, bool>,
    /// `tailscale serve` and `funnel` run in the foreground, by session.
    #[serde(rename = "Foreground", default)]
    foreground: HashMap<String, ServeConfig>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct TcpHandler {
    #[serde(rename = "TCPForward", default)]
    tcp_forward: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct WebServer {
    #[serde(rename = "Handlers", default)]
    handlers: HashMap<String, Handler>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct Handler {
    #[serde(rename = "Proxy", default)]
    proxy: String,
}

impl ServeConfig {
    pub async fn read() -> Result<Self, LocalApiError> {
        // No config at all reads as `null`.
        let config: Option<Self> = get("/localapi/v0/serve-config").await?;
        Ok(config.unwrap_or_default())
    }

    /// The public `host:port`s that Funnel exposes and that lead to `127.0.0.1:port`.
    pub fn funnels_to(&self, port: u16) -> Vec<String> {
        let funnel = |host_port: &str| self.allow_funnel.get(host_port) == Some(&true);
        let mut found: Vec<String> = self
            .web
            .iter()
            .filter(|(host_port, web)| funnel(host_port) && web.reaches(port))
            .map(|(host_port, _)| host_port.clone())
            .collect();
        for (public, tcp) in &self.tcp {
            if reaches(&tcp.tcp_forward, port) {
                let on_port = |host_port: &String| host_port.rsplit(':').next() == Some(public);
                found.extend(
                    self.allow_funnel
                        .keys()
                        .filter(|hp| on_port(hp) && funnel(hp))
                        .cloned(),
                );
            }
        }
        for config in self.foreground.values() {
            found.extend(config.funnels_to(port));
        }
        found.sort();
        found.dedup();
        found
    }

    /// The HTTPS URL `tailscale serve` publishes `127.0.0.1:port` at, if any.
    pub fn url_for(&self, port: u16) -> Option<String> {
        let mut urls: Vec<String> = self
            .web
            .iter()
            .filter(|(_, web)| web.reaches(port))
            .map(|(host_port, _)| {
                let host = host_port.strip_suffix(":443").unwrap_or(host_port);
                format!("https://{host}")
            })
            .chain(
                self.foreground
                    .values()
                    .filter_map(|config| config.url_for(port)),
            )
            .collect();
        urls.sort();
        urls.into_iter().next()
    }
}

impl WebServer {
    fn reaches(&self, port: u16) -> bool {
        self.handlers
            .values()
            .any(|handler| reaches(&handler.proxy, port))
    }
}

/// Whether a proxy target (`http://127.0.0.1:7850`, `localhost:7850`, `7850`) is
/// this daemon's listener.
fn reaches(target: &str, port: u16) -> bool {
    let rest = target.split_once("://").map_or(target, |(_, rest)| rest);
    let authority = rest.split('/').next().unwrap_or(rest);
    let (host, target_port) = authority
        .rsplit_once(':')
        .unwrap_or(("127.0.0.1", authority));
    matches!(host, "127.0.0.1" | "localhost" | "[::1]") && target_port.parse() == Ok(port)
}

/// One LocalAPI GET over the unix socket.
async fn get<T: DeserializeOwned>(path: &'static str) -> Result<T, LocalApiError> {
    let socket = SOCKETS
        .iter()
        .find(|socket| Path::new(socket).exists())
        .ok_or(LocalApiError::NoSocket)?;
    let body = tokio::time::timeout(LOCALAPI_TIMEOUT, fetch(socket, path))
        .await
        .map_err(|_| LocalApiError::Timeout)??;
    serde_json::from_slice(&body).map_err(|error| LocalApiError::Json { path, error })
}

async fn fetch(socket: &str, path: &str) -> Result<Bytes, LocalApiError> {
    let http = |error: &dyn std::fmt::Display| LocalApiError::Http(error.to_string());
    let stream = UnixStream::connect(socket).await?;
    let (mut sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(stream))
        .await
        .map_err(|error| http(&error))?;
    // Drives the connection; it ends when `sender` is dropped.
    tokio::spawn(connection);
    let request = Request::get(path)
        .header(header::HOST, "local-tailscaled.sock")
        .body(Empty::<Bytes>::new())
        .map_err(|error| http(&error))?;
    let response = sender
        .send_request(request)
        .await
        .map_err(|error| http(&error))?;
    if !response.status().is_success() {
        return Err(LocalApiError::Http(format!(
            "{path}: {}",
            response.status()
        )));
    }
    let body = Limited::new(response.into_body(), LOCALAPI_MAX_BODY)
        .collect()
        .await
        .map_err(|error| http(&error))?;
    Ok(body.to_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn funnel_is_found_only_where_it_reaches_the_port() {
        let config: ServeConfig = serde_json::from_str(
            r#"{
              "TCP": {"443": {"HTTPS": true}, "8443": {"HTTPS": true}, "2222": {"TCPForward": "127.0.0.1:7850"}},
              "Web": {
                "box.ts.net:443": {"Handlers": {"/": {"Proxy": "http://127.0.0.1:7850"}}},
                "box.ts.net:8443": {"Handlers": {"/": {"Proxy": "http://127.0.0.1:3000"}}}
              },
              "AllowFunnel": {"box.ts.net:8443": true},
              "Foreground": {"abc": {"Web": {"box.ts.net:10000": {"Handlers": {"/": {"Proxy": "http://localhost:7850"}}}},
                                      "AllowFunnel": {"box.ts.net:10000": true}}}
            }"#,
        )
        .expect("a serve config");
        assert_eq!(config.funnels_to(7850), ["box.ts.net:10000"]);
        assert_eq!(config.funnels_to(3000), ["box.ts.net:8443"]);
        assert_eq!(config.url_for(7850).as_deref(), Some("https://box.ts.net"));
        assert_eq!(config.url_for(9999), None);
        let tcp: ServeConfig = serde_json::from_str(
            r#"{"TCP": {"2222": {"TCPForward": "127.0.0.1:7850"}}, "AllowFunnel": {"box.ts.net:2222": true}}"#,
        )
        .expect("a serve config");
        assert_eq!(tcp.funnels_to(7850), ["box.ts.net:2222"]);
    }
}
