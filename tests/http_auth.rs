//! The auth layers over a real socket (auth.md "Carrying the token", "Endpoints"):
//! every route sits behind the Tailscale check; only the two `/auth` routes skip the
//! device check; a bad token on the WebSocket gets the upgrade and then close 4401.

use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use futures_util::{SinkExt as _, StreamExt as _};
use tether::auth::{Auth, Store};
use tether::http::{self, App};
use tether::hub::{self, Endpoints};
use tether::proto::HostInfo;
use tether::tmux::{Endpoint, Socket};
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::{Error as WsError, Message};

const LOGIN: &str = "jimmy@github";
const WAIT: Duration = Duration::from_secs(5);

struct Daemon {
    port: u16,
    store: Store,
    dir: PathBuf,
}

impl Drop for Daemon {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

async fn start(name: &str) -> Daemon {
    let dir = std::env::temp_dir().join(format!("tether-http-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let store = Store::open(dir.join("state")).expect("a state dir");
    let paste_dir = dir.join("paste");
    std::fs::create_dir_all(&paste_dir).expect("a paste dir");
    // No tmux server is ever asked for: these sockets never watch a window.
    let endpoint = Endpoint {
        program: PathBuf::from("tmux"),
        socket: Socket::Name(format!("tether-http-test-{}", std::process::id())),
    };
    let (hub, _task) = hub::spawn(Endpoints { main: endpoint });
    let app = App {
        auth: Auth::new(store.clone(), vec![LOGIN.to_owned()]),
        hub,
        host: HostInfo {
            id: store.host_id().expect("a host id"),
            name: "test".to_owned(),
        },
        paste_dir,
    };
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("a port");
    let port = listener.local_addr().expect("an address").port();
    tokio::spawn(http::serve(listener, app, std::future::pending()));
    Daemon { port, store, dir }
}

/// One HTTP/1.1 request; the status and the body.
async fn request(
    port: u16,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: &str,
) -> (u16, String) {
    let mut stream = TcpStream::connect(("127.0.0.1", port))
        .await
        .expect("connected");
    let mut text = format!("{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n");
    for (name, value) in headers {
        text.push_str(&format!("{name}: {value}\r\n"));
    }
    if !body.is_empty() {
        text.push_str(&format!(
            "Content-Type: application/json\r\nContent-Length: {}\r\n",
            body.len()
        ));
    }
    text.push_str("\r\n");
    text.push_str(body);
    stream.write_all(text.as_bytes()).await.expect("sent");
    let mut response = String::new();
    tokio::time::timeout(WAIT, stream.read_to_string(&mut response))
        .await
        .expect("an answer in time")
        .expect("read");
    let status = response[9..12].parse().expect("a status");
    let body = response.split_once("\r\n\r\n").map_or("", |(_, body)| body);
    (status, body.to_owned())
}

/// Opens `/ws` with these headers and subprotocols: the upgrade's outcome.
async fn open(
    port: u16,
    login: Option<&str>,
    protocols: &str,
) -> Result<
    (
        tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<TcpStream>>,
        Option<String>,
    ),
    WsError,
> {
    let mut upgrade = format!("ws://127.0.0.1:{port}/ws")
        .into_client_request()
        .expect("a request");
    let headers = upgrade.headers_mut();
    if let Some(login) = login {
        headers.insert("tailscale-user-login", login.parse().expect("a header"));
    }
    headers.insert(
        "sec-websocket-protocol",
        protocols.parse().expect("a header"),
    );
    let (socket, response) = tokio_tungstenite::connect_async(upgrade).await?;
    let protocol = response
        .headers()
        .get("sec-websocket-protocol")
        .map(|value| value.to_str().expect("ASCII").to_owned());
    Ok((socket, protocol))
}

#[tokio::test]
async fn every_route_needs_the_tailscale_login() {
    let daemon = start("tailscale").await;
    let port = daemon.port;
    let enroll = r#"{"code":"AAAA-AAAA","deviceName":"x"}"#;
    for (method, path, body) in [
        ("GET", "/auth/info", ""),
        ("POST", "/auth/enroll", enroll),
        ("GET", "/ws", ""),
        ("GET", "/no-such-route", ""),
    ] {
        let missing = request(port, method, path, &[], body).await;
        assert_eq!(missing.0, 403, "{method} {path} without a login");
        let stranger = [("Tailscale-User-Login", "someone@else")];
        assert_eq!(request(port, method, path, &stranger, body).await.0, 403);
    }
    // A WebSocket upgrade without the login is a plain 403: no socket.
    let Err(WsError::Http(refused)) = open(port, None, "tether.v1, tether.auth.x").await else {
        panic!("upgraded without a login");
    };
    assert_eq!(refused.status(), 403);
}

#[tokio::test]
async fn only_the_auth_routes_skip_the_device_check() {
    let daemon = start("device").await;
    let port = daemon.port;
    let login = [("Tailscale-User-Login", LOGIN)];
    let (status, body) = request(port, "GET", "/auth/info", &login, "").await;
    assert_eq!(status, 200, "{body}");
    assert!(body.contains(r#""protocol":{"min":1,"max":1}"#), "{body}");
    // No code is pending: the handler, not a layer, refuses it.
    let wrong = r#"{"code":"AAAA-AAAA","deviceName":"phone"}"#;
    let (status, body) = request(port, "POST", "/auth/enroll", &login, wrong).await;
    assert_eq!((status, body.as_str()), (403, r#"{"error":"bad_code"}"#));
    // A right code gets a token, which then opens the WebSocket.
    let code = daemon
        .store
        .set_pending(Duration::from_secs(600), SystemTime::now())
        .expect("a code");
    let right = format!(r#"{{"code":"{code}","deviceName":"phone"}}"#);
    let (status, body) = request(port, "POST", "/auth/enroll", &login, &right).await;
    assert_eq!(status, 200, "{body}");
    let enrolled: serde_json::Value = serde_json::from_str(&body).expect("JSON");
    let token = enrolled["token"].as_str().expect("a token");
    // `/ws` without an upgrade is HTTP, so a missing token is a 401 there.
    let (status, body) = request(port, "GET", "/ws", &login, "").await;
    assert_eq!(
        (status, body.as_str()),
        (401, r#"{"error":"auth_required"}"#)
    );
    let bearer = format!("Bearer {token}");
    let with_token = [("Tailscale-User-Login", LOGIN), ("Authorization", &bearer)];
    assert_ne!(request(port, "GET", "/ws", &with_token, "").await.0, 401);

    let (mut socket, protocol) = open(
        port,
        Some(LOGIN),
        &format!("tether.v1, tether.auth.{token}"),
    )
    .await
    .expect("upgraded");
    assert_eq!(protocol.as_deref(), Some("tether.v1"));
    let hello = r#"{"type":"hello","data":{"protocol":1,"client":{"kind":"web","build":"test"}}}"#;
    socket.send(Message::text(hello)).await.expect("sent");
    let welcome = tokio::time::timeout(WAIT, socket.next())
        .await
        .expect("in time");
    let Some(Ok(Message::Text(welcome))) = welcome else {
        panic!("no welcome: {welcome:?}");
    };
    assert!(
        welcome.as_str().starts_with(r#"{"type":"welcome""#),
        "{welcome}"
    );
}

#[tokio::test]
async fn a_bad_token_gets_the_upgrade_then_4401() {
    let daemon = start("bad-token").await;
    for protocols in ["tether.v1, tether.auth.tether_nope", "tether.v1"] {
        let (mut socket, protocol) = open(daemon.port, Some(LOGIN), protocols)
            .await
            .expect("upgraded");
        assert_eq!(protocol.as_deref(), Some("tether.v1"));
        let closed = tokio::time::timeout(WAIT, socket.next())
            .await
            .expect("in time");
        let Some(Ok(Message::Close(Some(frame)))) = closed else {
            panic!("no close frame: {closed:?}");
        };
        assert_eq!(frame.code, CloseCode::from(4401), "{protocols}");
    }
}
