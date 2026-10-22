//! The auth layers over a real socket (auth.md "Carrying the token", "Endpoints"):
//! every route sits behind the Tailscale check; only the two `/auth` routes skip the
//! device check, so every `/fs` route and `/complete` need a token; a bad token on the
//! WebSocket gets the upgrade and then close 4401.

use std::time::{Duration, SystemTime};

use futures_util::{SinkExt as _, StreamExt as _};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::{Error as WsError, Message};

#[path = "support/daemon.rs"]
mod daemon;

use daemon::{LOGIN, WAIT, request, start};

/// Every `/fs` route and `/complete`, with a body where it takes one.
const DEVICE_ROUTES: [(&str, &str, &str); 11] = [
    ("GET", "/fs/roots", ""),
    ("POST", "/fs/roots/add", r#"{"path":"/tmp"}"#),
    ("POST", "/fs/roots/remove", r#"{"path":"/tmp"}"#),
    ("POST", "/fs/uploads-dir", r#"{"path":"/tmp"}"#),
    ("GET", "/fs/list/", ""),
    ("GET", "/fs/list/tmp", ""),
    ("GET", "/fs/dirs/", ""),
    ("GET", "/fs/dirs/tmp", ""),
    ("GET", "/fs/raw/etc/hostname", ""),
    ("POST", "/fs/upload?name=a.jpg", "{}"),
    (
        "POST",
        "/complete",
        r#"{"before":"ls /","after":"","cwd":null}"#,
    ),
];

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
    let routes = [
        ("GET", "/auth/info", ""),
        ("POST", "/auth/enroll", enroll),
        ("GET", "/ws", ""),
        ("GET", "/no-such-route", ""),
    ];
    for (method, path, body) in routes.into_iter().chain(DEVICE_ROUTES) {
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
    // Every file route and `/complete`: refused by the layer without a token, reached
    // with one.
    let wrong = [
        ("Tailscale-User-Login", LOGIN),
        ("Authorization", "Bearer tether_nope"),
    ];
    for (method, path, body) in DEVICE_ROUTES {
        for headers in [&login[..], &wrong[..]] {
            let (status, refused) = request(port, method, path, headers, body).await;
            assert_eq!(
                (status, refused.as_str()),
                (401, r#"{"error":"auth_required"}"#),
                "{method} {path}"
            );
        }
        // The handler answers: a refusal of its own, if any, not the layers'.
        let (status, answer) = request(port, method, path, &with_token, body).await;
        let layers = [r#"{"error":"auth_required"}"#, r#"{"error":"forbidden"}"#];
        assert!(
            !layers.contains(&answer.as_str()),
            "{method} {path}: {status} {answer}"
        );
    }

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

#[tokio::test]
async fn an_unreadable_auth_file_is_retryable_not_a_bad_token() {
    let daemon = start("unreadable").await;
    let added = daemon
        .store
        .add_device("phone", SystemTime::now())
        .expect("a device");
    // A hand edit gone wrong: every check fails, but the token isn't refused.
    std::fs::write(daemon.store.dir().join("auth.toml"), "[[device]\n").expect("written");
    let bearer = format!("Bearer {}", added.token);
    let with_token = [("Tailscale-User-Login", LOGIN), ("Authorization", &bearer)];
    let (status, body) = request(daemon.port, "GET", "/ws", &with_token, "").await;
    assert_eq!(
        (status, body.as_str()),
        (503, r#"{"error":"auth_unavailable"}"#)
    );
    let protocols = format!("tether.v1, tether.auth.{}", added.token);
    let (mut socket, _) = open(daemon.port, Some(LOGIN), &protocols)
        .await
        .expect("upgraded");
    let closed = tokio::time::timeout(WAIT, socket.next())
        .await
        .expect("in time");
    let Some(Ok(Message::Close(Some(frame)))) = closed else {
        panic!("no close frame: {closed:?}");
    };
    assert_eq!(frame.code, CloseCode::from(4503));
}
