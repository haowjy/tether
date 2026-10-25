//! Tailscale LocalAPI transport, keep-alive clients, bounded uncached whois pool, and answer parsing.

use std::collections::{HashMap, VecDeque};
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::http::{HeaderMap, HeaderValue, Method, Request, StatusCode, header};
use bytes::Bytes;
use http_body_util::{BodyExt as _, Full, Limited};
use hyper::client::conn::http1::SendRequest;
use hyper_util::rt::TokioIo;
use serde::Deserialize;
use thiserror::Error;
use tokio::net::UnixStream;
use tokio::sync::{Mutex, watch};

const SOCKETS: [&str; 2] = [
    "/var/run/tailscale/tailscaled.sock",
    "/var/run/tailscaled.socket",
];
pub const LOCALAPI_TIMEOUT: Duration = Duration::from_secs(2);
pub const LOCALAPI_MAX_BODY: usize = 64 * 1024;

#[derive(Debug, Error, Clone)]
pub enum LocalApiError {
    #[error("no tailscaled LocalAPI socket at {0}")]
    NoSocket(String),
    #[error("can't reach tailscaled: {0}")]
    Io(String),
    #[error("tailscaled's LocalAPI: {0}")]
    Http(String),
    #[error("tailscaled didn't answer within {LOCALAPI_TIMEOUT:?}")]
    Timeout,
    #[error("tailscaled has no node for this address")]
    NoPeer,
    #[error("whois queue is full")]
    Busy,
    #[error("tailnet identity is unavailable")]
    Unavailable,
    #[error("tailscaled's LocalAPI answer exceeds {LOCALAPI_MAX_BODY} bytes")]
    TooLarge,
    #[error("tailscaled's {path} isn't the expected JSON: {error}")]
    Json { path: &'static str, error: String },
}

/// A parsed whois answer sufficient for the browser node rules.
#[derive(Debug, Clone, Deserialize)]
pub struct Whois {
    #[serde(rename = "Node")]
    pub node: Option<WhoisNode>,
    #[serde(rename = "UserProfile")]
    pub user_profile: Option<UserProfile>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WhoisNode {
    #[serde(rename = "StableID", default)]
    pub stable_id: String,
    #[serde(rename = "Tags", default)]
    pub tags: Vec<String>,
    #[serde(rename = "Sharer", default)]
    pub sharer: u64,
    #[serde(rename = "Addresses", default)]
    pub addresses: Vec<String>,
    #[serde(rename = "AllowedIPs", default)]
    pub allowed_ips: Vec<String>,
    #[serde(rename = "DNSName", default)]
    pub dns_name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UserProfile {
    #[serde(rename = "LoginName", default)]
    pub login_name: String,
}

/// Parsed LocalAPI `/status` answer fields used to assemble the auth identity view.
#[derive(Debug, Deserialize)]
pub(super) struct Status {
    #[serde(rename = "Self")]
    pub(super) this: Option<StatusNode>,
    #[serde(rename = "User", default)]
    pub(super) users: HashMap<String, StatusUser>,
}

#[derive(Debug, Deserialize)]
pub(super) struct StatusNode {
    #[serde(rename = "StableID", default)]
    pub(super) stable_id: String,
    #[serde(rename = "UserID", default)]
    pub(super) user_id: u64,
    #[serde(rename = "DNSName", default)]
    pub(super) dns_name: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct StatusUser {
    #[serde(rename = "LoginName", default)]
    pub(super) login_name: String,
}

pub struct LocalApiResponse {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: Bytes,
}

/// The one LocalAPI owner. A cell client is separate from the two whois connections.
#[derive(Clone)]
pub struct LocalApi {
    cell: Arc<Client>,
    whois: Arc<[Client; 2]>,
    whois_state: Arc<Mutex<WhoisState>>,
}

struct WhoisState {
    free_clients: Vec<usize>,
    waiting: VecDeque<(IpAddr, Arc<WhoisFlight>)>,
    flights: HashMap<IpAddr, Arc<WhoisFlight>>,
}

struct WhoisFlight {
    start: watch::Receiver<Option<usize>>,
    start_tx: watch::Sender<Option<usize>>,
    result: watch::Receiver<Option<Result<Whois, LocalApiError>>>,
    result_tx: watch::Sender<Option<Result<Whois, LocalApiError>>>,
}

impl WhoisFlight {
    fn new() -> Arc<Self> {
        let (start_tx, start) = watch::channel(None);
        let (result_tx, result) = watch::channel(None);
        Arc::new(Self {
            start,
            start_tx,
            result,
            result_tx,
        })
    }
}

impl LocalApi {
    /// Uses tailscaled's standard Unix socket search order.
    pub fn system() -> Self {
        Self::new(Transport::Unix(None))
    }

    /// Uses a fixed LocalAPI socket; public so integration tests can run a fake daemon.
    pub fn at(socket: PathBuf) -> Self {
        Self::new(Transport::Unix(Some(socket)))
    }

    fn new(transport: Transport) -> Self {
        Self {
            cell: Arc::new(Client::new(transport.clone())),
            whois: Arc::new([
                Client::new(transport.clone()),
                Client::new(transport.clone()),
            ]),
            whois_state: Arc::new(Mutex::new(WhoisState {
                free_clients: vec![0, 1],
                waiting: VecDeque::new(),
                flights: HashMap::new(),
            })),
        }
    }

    /// Parsed status answer; identity owns its interpretation and assembly.
    pub(super) async fn status(&self) -> Result<Status, LocalApiError> {
        self.cell.get_json("/localapi/v0/status?peers=false").await
    }

    /// Parse the Serve-config answer as the caller's domain type.
    pub(super) async fn serve_config<T: serde::de::DeserializeOwned>(
        &self,
    ) -> Result<Option<T>, LocalApiError> {
        self.cell.get_json("/localapi/v0/serve-config").await
    }

    pub async fn whois(&self, address: IpAddr) -> Result<Whois, LocalApiError> {
        let (flight, start) = {
            let mut state = self.whois_state.lock().await;
            if let Some(flight) = state.flights.get(&address) {
                (flight.clone(), false)
            } else {
                if state.free_clients.is_empty() && state.waiting.len() >= 16 {
                    return Err(LocalApiError::Busy);
                }
                let flight = WhoisFlight::new();
                state.flights.insert(address, flight.clone());
                if let Some(index) = state.free_clients.pop() {
                    let _ = flight.start_tx.send(Some(index));
                    (flight, true)
                } else {
                    state.waiting.push_back((address, flight.clone()));
                    // The dequeued flight gets its worker only when a client is assigned.
                    (flight, false)
                }
            }
        };
        if start {
            self.run_whois(address, flight.clone());
        }
        let mut result = flight.result.clone();
        loop {
            if let Some(result) = result.borrow().clone() {
                return result;
            }
            result.changed().await.map_err(|_| {
                LocalApiError::Http("whois worker stopped without a result".to_owned())
            })?;
        }
    }

    fn run_whois(&self, address: IpAddr, flight: Arc<WhoisFlight>) {
        let api = self.clone();
        tokio::spawn(async move {
            let mut start = flight.start.clone();
            let index = loop {
                if let Some(index) = *start.borrow() {
                    break index;
                }
                if start.changed().await.is_err() {
                    return;
                }
            };
            let path = format!("/localapi/v0/whois?addr={address}");
            let result = api.whois[index]
                .request(Method::GET, &path, &HeaderMap::new(), None)
                .await
                .and_then(|response| {
                    if response.status == StatusCode::NOT_FOUND {
                        return Err(LocalApiError::NoPeer);
                    }
                    if !response.status.is_success() {
                        return Err(LocalApiError::Http(format!("{path}: {}", response.status)));
                    }
                    parse_json("/localapi/v0/whois", &response.body)
                });

            let next = {
                let mut state = api.whois_state.lock().await;
                state.flights.remove(&address);
                state.free_clients.push(index);
                if let Some((next_address, next_flight)) = state.waiting.pop_front() {
                    state.free_clients.pop().map(|next_index| {
                        let _ = next_flight.start_tx.send(Some(next_index));
                        (next_address, next_flight)
                    })
                } else {
                    None
                }
            };
            let _ = flight.result_tx.send(Some(result));
            if let Some((next_address, next_flight)) = next {
                api.run_whois(next_address, next_flight);
            }
        });
    }
}

type RequestSender = SendRequest<Full<Bytes>>;

struct Endpoint {
    sender: RequestSender,
    authorization: Option<HeaderValue>,
}

struct Client {
    transport: Transport,
    endpoint: Mutex<Option<Endpoint>>,
}

impl Client {
    fn new(transport: Transport) -> Self {
        Self {
            transport,
            endpoint: Mutex::new(None),
        }
    }

    async fn get_json<T: serde::de::DeserializeOwned>(
        &self,
        path: &'static str,
    ) -> Result<T, LocalApiError> {
        let response = self
            .request(Method::GET, path, &HeaderMap::new(), None)
            .await?;
        if !response.status.is_success() {
            return Err(LocalApiError::Http(format!("{path}: {}", response.status)));
        }
        parse_json(path, &response.body)
    }

    async fn request(
        &self,
        method: Method,
        path: &str,
        headers: &HeaderMap,
        body: Option<Bytes>,
    ) -> Result<LocalApiResponse, LocalApiError> {
        tokio::time::timeout(
            LOCALAPI_TIMEOUT,
            self.request_inner(method, path, headers, body),
        )
        .await
        .map_err(|_| LocalApiError::Timeout)?
    }

    async fn request_inner(
        &self,
        method: Method,
        path: &str,
        headers: &HeaderMap,
        body: Option<Bytes>,
    ) -> Result<LocalApiResponse, LocalApiError> {
        let mut current = self.endpoint.lock().await;
        if current.is_none() {
            *current = Some(connect(&self.transport).await?);
        }
        let response = {
            let endpoint = current.as_mut().expect("connected");
            let request = request(
                method.clone(),
                path,
                headers,
                body.clone(),
                endpoint.authorization.as_ref(),
            )?;
            endpoint.sender.send_request(request).await
        };
        let response = match response {
            Ok(response) => response,
            Err(first) => {
                *current = None;
                let mut endpoint = connect(&self.transport).await?;
                let request =
                    request(method, path, headers, body, endpoint.authorization.as_ref())?;
                let response = endpoint
                    .sender
                    .send_request(request)
                    .await
                    .map_err(|error| LocalApiError::Http(error.to_string()))?;
                *current = Some(endpoint);
                let _ = first;
                response
            }
        };
        let (parts, body) = response.into_parts();
        let body = Limited::new(body, LOCALAPI_MAX_BODY)
            .collect()
            .await
            .map(|body| body.to_bytes())
            .map_err(|error| {
                if error.to_string().contains("length limit") {
                    LocalApiError::TooLarge
                } else {
                    LocalApiError::Http(error.to_string())
                }
            })?;
        Ok(LocalApiResponse {
            status: parts.status,
            headers: parts.headers,
            body,
        })
    }
}

#[derive(Clone)]
enum Transport {
    Unix(Option<PathBuf>),
}

async fn connect(transport: &Transport) -> Result<Endpoint, LocalApiError> {
    match transport {
        Transport::Unix(path) => {
            let socket = path.clone().map_or_else(
                || {
                    SOCKETS
                        .iter()
                        .map(PathBuf::from)
                        .find(|path| path.exists())
                        .ok_or_else(|| LocalApiError::NoSocket(SOCKETS.join(" or ")))
                },
                Ok,
            )?;
            let stream = UnixStream::connect(socket)
                .await
                .map_err(|error| LocalApiError::Io(error.to_string()))?;
            let (sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(stream))
                .await
                .map_err(|error| LocalApiError::Http(error.to_string()))?;
            tokio::spawn(connection);
            Ok(Endpoint {
                sender,
                authorization: None,
            })
        }
    }
}

fn request(
    method: Method,
    path: &str,
    headers: &HeaderMap,
    body: Option<Bytes>,
    authorization: Option<&HeaderValue>,
) -> Result<Request<Full<Bytes>>, LocalApiError> {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .body(Full::new(body.unwrap_or_default()))
        .map_err(|error| LocalApiError::Http(error.to_string()))?;
    request.headers_mut().insert(
        header::HOST,
        HeaderValue::from_static("local-tailscaled.sock"),
    );
    if let Some(authorization) = authorization {
        request
            .headers_mut()
            .insert(header::AUTHORIZATION, authorization.clone());
    }
    request.headers_mut().extend(headers.clone());
    Ok(request)
}

fn parse_json<T: serde::de::DeserializeOwned>(
    path: &'static str,
    bytes: &[u8],
) -> Result<T, LocalApiError> {
    serde_json::from_slice(bytes).map_err(|error| LocalApiError::Json {
        path,
        error: error.to_string(),
    })
}
