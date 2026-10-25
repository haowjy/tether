//! The auth layers over a real socket (auth.md "Carrying the token", "Endpoints"):
//! every route sits behind the Tailscale check; only the two `/auth` routes skip the
//! device check, so every `/fs` route and `/complete` need a token; a bad token on the
//! WebSocket gets the upgrade and then close 4401.

use std::time::{Duration, SystemTime};

use futures_util::{SinkExt as _, StreamExt as _};
use tether::auth::localapi::{LocalApi, LocalApiError};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::{Error as WsError, Message};

#[path = "support/daemon.rs"]
mod daemon;

use daemon::{
    LOGIN, WAIT, request, send, send_owned, send_with_host, start, start_as, start_with_fake,
    start_without_allow_login,
};

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
async fn the_default_allowlist_refreshes_tailnet_state_after_idle() {
    let daemon = start_without_allow_login("default-allow-idle").await;
    let login = [("Tailscale-User-Login", LOGIN)];
    assert_eq!(
        send(daemon.serve_port, "GET", "/auth/info", &login, &[])
            .await
            .status,
        200
    );
    let native = daemon.device();
    let token = native[1].1.strip_prefix("Bearer ").expect("token");

    tokio::time::sleep(Duration::from_secs(31)).await;
    let shell = send(daemon.serve_port, "GET", "/", &login, &[]);
    let protocols = format!("tether.v1, tether.auth.{token}");
    let websocket = open(daemon.port, Some(LOGIN), &protocols);
    let fs = send_owned(daemon.port, "GET", "/fs/roots", &native, &[]);
    let (shell, websocket, fs) = tokio::join!(shell, websocket, fs);
    assert_eq!(shell.status, 200, "{}", shell.text());
    let (mut socket, protocol) = websocket.expect("native WebSocket admitted after idle");
    assert_eq!(protocol.as_deref(), Some("tether.v1"));
    socket.close(None).await.expect("close test socket");
    assert_eq!(fs.status, 200, "{}", fs.text());
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
    let browser_enroll_headers = [
        ("Tailscale-User-Login", LOGIN),
        ("Origin", "https://devbox.ts.net"),
        ("Content-Type", "application/json"),
    ];
    let reply = send(
        port,
        "POST",
        "/auth/enroll",
        &browser_enroll_headers,
        wrong.as_bytes(),
    )
    .await;
    assert_eq!(reply.status, 403);
    assert_eq!(reply.json()["error"].as_str(), Some("bad_origin"));
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

const NODE_HEADERS: [(&str, &str); 5] = [
    ("Tailscale-User-Login", LOGIN),
    ("X-Forwarded-For", "100.101.102.103"),
    ("X-Forwarded-Host", "devbox.ts.net"),
    ("Origin", "https://devbox.ts.net"),
    ("Sec-Fetch-Site", "same-origin"),
];

fn node_headers_for(address: String) -> Vec<(String, String)> {
    let mut headers = NODE_HEADERS
        .iter()
        .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
        .collect::<Vec<_>>();
    headers[1].1 = address;
    headers
}

#[tokio::test]
async fn local_front_never_admits_forged_node_headers_and_invalid_forwarding_is_cheap() {
    let daemon = start("fronts").await;

    let local = [
        ("Tailscale-User-Login", LOGIN),
        ("X-Forwarded-For", "100.101.102.103"),
    ];
    let reply = send(daemon.port, "GET", "/auth/node/session", &local, &[]).await;
    assert_eq!(
        (reply.status, reply.json()["error"].as_str()),
        (401, Some("auth_required"))
    );
    assert_eq!(
        daemon
            .fake
            .whois_calls
            .load(std::sync::atomic::Ordering::SeqCst),
        0
    );

    let mut invalid = NODE_HEADERS.to_vec();
    invalid[1] = ("X-Forwarded-For", "192.0.2.1");
    let mut bad_forwards = vec![invalid];
    bad_forwards.push(
        NODE_HEADERS
            .into_iter()
            .filter(|(name, _)| *name != "X-Forwarded-For")
            .collect(),
    );
    let mut duplicated = NODE_HEADERS.to_vec();
    duplicated.push(("X-Forwarded-For", "100.101.102.103"));
    bad_forwards.push(duplicated);
    let mut listed = NODE_HEADERS.to_vec();
    listed[1] = ("X-Forwarded-For", "100.101.102.103, 100.101.102.104");
    bad_forwards.push(listed);
    for headers in bad_forwards {
        let reply = send(
            daemon.serve_port,
            "GET",
            "/auth/node/session",
            &headers,
            &[],
        )
        .await;
        assert_eq!(reply.status, 403, "{}", reply.text());
        assert_eq!(reply.json()["error"].as_str(), Some("forbidden"));
    }
    assert_eq!(
        daemon
            .fake
            .whois_calls
            .load(std::sync::atomic::Ordering::SeqCst),
        0
    );
}

#[tokio::test]
async fn serve_host_and_funnel_checks_precede_every_route() {
    let daemon = start("serve-front").await;
    let routes = [
        ("GET", "/", ""),
        ("GET", "/auth/info", ""),
        ("POST", "/auth/enroll", "{}"),
        ("GET", "/auth/node/session", ""),
        ("POST", "/auth/node/enroll", "{}"),
        ("POST", "/auth/node/remove", "{}"),
    ]
    .into_iter()
    .chain(DEVICE_ROUTES);

    for (method, path, body) in routes {
        let login = [("Tailscale-User-Login", LOGIN)];
        let reply = send_with_host(
            daemon.serve_port,
            "wrong.example",
            method,
            path,
            &login,
            body.as_bytes(),
        )
        .await;
        assert_eq!(reply.status, 403, "wrong Host on {method} {path}");
        assert_eq!(reply.header("cache-control"), Some("no-store"));
        assert_eq!(
            reply.header("cross-origin-resource-policy"),
            Some("same-origin")
        );

        let funnel = [
            ("Tailscale-User-Login", LOGIN),
            ("Tailscale-Funnel-Request", "1"),
        ];
        let reply = send(daemon.serve_port, method, path, &funnel, body.as_bytes()).await;
        assert_eq!(reply.status, 403, "Funnel on {method} {path}");
    }
    assert_eq!(
        daemon
            .fake
            .whois_calls
            .load(std::sync::atomic::Ordering::SeqCst),
        0
    );
}

#[tokio::test]
async fn serve_decodes_q_encoded_logins_before_matching_the_allowlist() {
    let daemon = start_as("encoded-login", "josé@example.test", false, false, true).await;
    let reply = send(
        daemon.serve_port,
        "GET",
        "/",
        &[(
            "Tailscale-User-Login",
            "=?UTF-8?Q?jos=C3=A9=40?= =?UTF-8?Q?example.test?=",
        )],
        &[],
    )
    .await;
    assert_eq!(reply.status, 200, "{}", reply.text());
}

#[tokio::test]
async fn missing_self_stable_id_makes_tailnet_identity_unavailable() {
    let daemon = start("missing-self").await;
    daemon.fake.set_status_answer(serde_json::json!({
        "BackendState": "Running",
        "Self": { "StableID": "", "UserID": 1, "DNSName": "devbox.ts.net." },
        "User": { "1": { "LoginName": LOGIN } },
        "Peer": {}
    }));
    let api = LocalApi::at(daemon.dir.join("tailscaled.sock"));
    let result = tether::auth::identity::tailnet_state(&api).await;
    assert!(matches!(result, Err(LocalApiError::Unavailable)));
}

#[tokio::test]
async fn browser_origin_and_fetch_metadata_are_checked_before_whois() {
    let daemon = start("browser-admission").await;
    let valid = NODE_HEADERS.to_vec();
    let without = |name: &str| {
        valid
            .iter()
            .copied()
            .filter(|(header, _)| *header != name)
            .collect::<Vec<_>>()
    };
    let mut bad = vec![without("Sec-Fetch-Site"), without("X-Forwarded-Host")];
    for (index, value) in [
        (2, "other.ts.net"),
        (2, "devbox.ts.net:8443"),
        (3, "null"),
        (3, "https://other.ts.net"),
        (4, "same-site"),
        (4, "cross-site"),
        (4, "none"),
    ] {
        let mut headers = valid.clone();
        headers[index] = (NODE_HEADERS[index].0, value);
        bad.push(headers);
    }
    let mut duplicate = valid.clone();
    duplicate.push(("X-Forwarded-Host", "devbox.ts.net"));
    bad.push(duplicate);
    for headers in bad {
        let reply = send(
            daemon.serve_port,
            "GET",
            "/auth/node/session",
            &headers,
            &[],
        )
        .await;
        assert_eq!(reply.status, 403, "{}", reply.text());
        assert_eq!(reply.json()["error"].as_str(), Some("bad_origin"));
    }
    let mut mutation = valid.clone();
    mutation[3] = ("Origin", "null");
    mutation.push(("Content-Type", "application/json"));
    let reply = send(
        daemon.serve_port,
        "POST",
        "/auth/node/remove",
        &mutation,
        b"{}",
    )
    .await;
    assert_eq!(reply.status, 403, "{}", reply.text());
    assert_eq!(reply.json()["error"].as_str(), Some("bad_origin"));
    let mutation = valid
        .iter()
        .copied()
        .filter(|(name, _)| *name != "Origin")
        .chain([("Content-Type", "application/json")])
        .collect::<Vec<_>>();
    let reply = send(
        daemon.serve_port,
        "POST",
        "/auth/node/remove",
        &mutation,
        b"{}",
    )
    .await;
    assert_eq!(reply.status, 403, "{}", reply.text());
    assert_eq!(reply.json()["error"].as_str(), Some("bad_origin"));
    assert_eq!(
        daemon
            .fake
            .whois_calls
            .load(std::sync::atomic::Ordering::SeqCst),
        0
    );
}

#[tokio::test]
async fn node_rules_refuse_ineligible_nodes_and_allow_exit_node_routes() {
    let daemon = start("node-rules").await;
    let base = serde_json::json!({
        "Node": {
            "StableID": "nLAPTOP0123456789CNTRL",
            "Tags": [],
            "Sharer": 0,
            "Addresses": ["100.101.102.103/32"],
            "AllowedIPs": ["100.101.102.103/32"],
            "DNSName": "laptop.ts.net."
        },
        "UserProfile": { "LoginName": LOGIN }
    });
    let mut cases = Vec::new();
    let mut answer = base.clone();
    answer["Node"]["Tags"] = serde_json::json!(["tag:server"]);
    cases.push((answer, "tagged"));
    let mut answer = base.clone();
    answer["UserProfile"]["LoginName"] = serde_json::json!("other@example.com");
    cases.push((answer, "login_mismatch"));
    let mut answer = base.clone();
    answer["Node"]["Sharer"] = serde_json::json!(12);
    cases.push((answer, "shared"));
    let mut answer = base.clone();
    answer["Node"]["AllowedIPs"] = serde_json::json!(["10.0.0.0/8"]);
    cases.push((answer, "routes"));
    let mut answer = base.clone();
    answer["Node"]["StableID"] = serde_json::json!("nSELF0123456789CNTRL");
    cases.push((answer, "self"));
    let mut answer = base.clone();
    answer["Node"] = serde_json::Value::Null;
    cases.push((answer, "unknown_node"));

    let case_count = cases.len();
    for (answer, reason) in cases {
        daemon.fake.set_whois_answer(answer);
        let reply = send(
            daemon.serve_port,
            "GET",
            "/auth/node/session",
            &NODE_HEADERS,
            &[],
        )
        .await;
        assert_eq!(reply.status, 403, "{}", reply.text());
        assert_eq!(reply.json()["error"].as_str(), Some("node_refused"));
        assert_eq!(reply.json()["reason"].as_str(), Some(reason));

        let mut enrollment_headers = NODE_HEADERS.to_vec();
        enrollment_headers.push(("Content-Type", "application/json"));
        let reply = send(
            daemon.serve_port,
            "POST",
            "/auth/node/enroll",
            &enrollment_headers,
            b"{}",
        )
        .await;
        assert_eq!(reply.status, 403, "enroll {reason}: {}", reply.text());
        assert_eq!(reply.json()["error"].as_str(), Some("node_refused"));
        assert_eq!(reply.json()["reason"].as_str(), Some(reason));
    }

    let mut exit_node = base;
    exit_node["Node"]["AllowedIPs"] =
        serde_json::json!(["100.101.102.103/32", "0.0.0.0/0", "::/0"]);
    daemon.fake.set_whois_answer(exit_node);
    let reply = send(
        daemon.serve_port,
        "GET",
        "/auth/node/session",
        &NODE_HEADERS,
        &[],
    )
    .await;
    assert_eq!(reply.status, 401, "{}", reply.text());
    assert_eq!(reply.json()["error"].as_str(), Some("not_enrolled"));
    assert_eq!(reply.json()["node"]["name"].as_str(), Some("laptop"));
    assert_eq!(
        daemon
            .fake
            .whois_calls
            .load(std::sync::atomic::Ordering::SeqCst),
        case_count * 2 + 1
    );
}

#[tokio::test]
async fn whois_failure_is_retryable_and_never_looks_like_an_unenrolled_node() {
    let daemon = start_with_fake("whois-unavailable", false, false, false).await;
    let reply = send(
        daemon.serve_port,
        "GET",
        "/auth/node/session",
        &NODE_HEADERS,
        &[],
    )
    .await;
    assert_eq!(reply.status, 503);
    assert_eq!(reply.json()["error"].as_str(), Some("identity_unavailable"));
    assert_ne!(reply.json()["error"].as_str(), Some("not_enrolled"));

    daemon.fake.allow_whois(true);
    let mut oversized = serde_json::json!({
        "Node": {
            "StableID": "nLAPTOP0123456789CNTRL",
            "Tags": [],
            "Sharer": 0,
            "Addresses": ["100.101.102.103/32"],
            "AllowedIPs": ["100.101.102.103/32"],
            "DNSName": "laptop.ts.net."
        },
        "UserProfile": { "LoginName": LOGIN }
    });
    oversized["Padding"] = serde_json::Value::String("x".repeat(70 * 1024));
    daemon.fake.set_whois_answer(oversized);
    let reply = send(
        daemon.serve_port,
        "GET",
        "/auth/node/session",
        &NODE_HEADERS,
        &[],
    )
    .await;
    assert_eq!(reply.status, 503);
    assert_eq!(reply.json()["error"].as_str(), Some("identity_unavailable"));
    assert_ne!(reply.json()["error"].as_str(), Some("not_enrolled"));

    daemon.fake.set_whois_answer(serde_json::json!({
        "Node": {
            "StableID": "nLAPTOP0123456789CNTRL",
            "Tags": [],
            "Sharer": 0,
            "Addresses": ["100.101.102.103/32"],
            "AllowedIPs": ["100.101.102.103/32"],
            "DNSName": "laptop.ts.net."
        },
        "UserProfile": { "LoginName": LOGIN }
    }));
    daemon.fake.set_whois_delay(Duration::from_millis(2500));
    let reply = send(
        daemon.serve_port,
        "GET",
        "/auth/node/session",
        &NODE_HEADERS,
        &[],
    )
    .await;
    assert_eq!(reply.status, 503);
    assert_eq!(reply.json()["error"].as_str(), Some("identity_unavailable"));
    assert_ne!(reply.json()["error"].as_str(), Some("not_enrolled"));
}

#[tokio::test]
async fn whois_shares_same_address_flights_and_bounds_distinct_waiters() {
    let daemon = start("whois-capacity").await;
    daemon.fake.hold_whois(true);
    let port = daemon.serve_port;
    let lookup = |last: u8| {
        let address = format!("100.101.102.{last}");
        let headers = node_headers_for(address);
        tokio::spawn(
            async move { send_owned(port, "GET", "/auth/node/session", &headers, &[]).await },
        )
    };

    let active = vec![lookup(103), lookup(104)];
    for _ in 0..200 {
        if daemon
            .fake
            .whois_calls
            .load(std::sync::atomic::Ordering::SeqCst)
            == 2
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert_eq!(
        daemon
            .fake
            .whois_calls
            .load(std::sync::atomic::Ordering::SeqCst),
        2,
        "both LocalAPI slots are occupied"
    );

    let waiting = (105..=120).map(lookup).collect::<Vec<_>>();
    tokio::time::sleep(Duration::from_millis(100)).await;
    let overflow = lookup(121).await.expect("overflow request completed");
    assert_eq!(overflow.status, 503, "the seventeenth address is busy");
    assert_eq!(overflow.json()["error"].as_str(), Some("busy"));
    assert_eq!(overflow.header("retry-after"), Some("1"));
    assert_eq!(
        daemon
            .fake
            .whois_calls
            .load(std::sync::atomic::Ordering::SeqCst),
        2,
        "queued and coalesced lookups do not open more than two calls"
    );

    daemon.fake.release_whois();
    for request in active.into_iter().chain(waiting) {
        let reply = request.await.expect("lookup task completed");
        assert_eq!(reply.status, 401, "{}", reply.text());
    }
    assert_eq!(
        daemon
            .fake
            .whois_calls
            .load(std::sync::atomic::Ordering::SeqCst),
        18,
        "the 16 queued addresses run once each: {:?}",
        daemon.fake.whois_queries.lock().expect("whois queries")
    );
}

#[tokio::test]
async fn concurrent_requests_for_one_address_share_the_whois_call() {
    let daemon = start("whois-single-flight").await;
    daemon.fake.hold_whois(true);
    let port = daemon.serve_port;
    let mut requests = (0..20)
        .map(|_| {
            let headers = node_headers_for("100.101.102.103".to_owned());
            tokio::spawn(async move {
                send_owned(port, "GET", "/auth/node/session", &headers, &[]).await
            })
        })
        .collect::<Vec<_>>();
    for _ in 0..200 {
        if daemon
            .fake
            .whois_calls
            .load(std::sync::atomic::Ordering::SeqCst)
            == 1
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert_eq!(
        daemon
            .fake
            .whois_calls
            .load(std::sync::atomic::Ordering::SeqCst),
        1
    );
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(
        daemon
            .fake
            .whois_calls
            .load(std::sync::atomic::Ordering::SeqCst),
        1,
        "the held result is shared with concurrent requests"
    );

    daemon.fake.release_whois();
    for request in requests.drain(..) {
        let reply = request.await.expect("lookup task completed");
        assert_eq!(reply.status, 401, "{}", reply.text());
    }
    assert_eq!(
        daemon
            .fake
            .whois_calls
            .load(std::sync::atomic::Ordering::SeqCst),
        1
    );
}

#[tokio::test]
async fn a_stored_node_with_an_old_login_is_not_enrolled_and_tokens_stay_native() {
    let daemon = start("lane-selection").await;
    let now = SystemTime::now();
    let code = daemon
        .store
        .set_pending(Duration::from_secs(600), now)
        .expect("pending code");
    daemon
        .store
        .enroll_node(
            &code,
            "old-login",
            "nLAPTOP0123456789CNTRL",
            "old@example.test",
            LOGIN,
            now,
        )
        .expect("a node row with the old login");
    let refused = send(
        daemon.serve_port,
        "GET",
        "/auth/node/session",
        &NODE_HEADERS,
        &[],
    )
    .await;
    assert_eq!(refused.status, 401);
    assert_eq!(refused.json()["error"].as_str(), Some("not_enrolled"));

    let native = daemon.device();
    let native_headers = native
        .iter()
        .map(|(name, value)| (name.as_str(), value.as_str()))
        .collect::<Vec<_>>();
    let accepted = send(daemon.serve_port, "GET", "/fs/roots", &native_headers, &[]).await;
    assert_eq!(accepted.status, 200, "{}", accepted.text());

    let mut bad_native = NODE_HEADERS.to_vec();
    bad_native.push(("Authorization", "Bearer tether_invalid"));
    let refused = send(
        daemon.serve_port,
        "GET",
        "/auth/node/session",
        &bad_native,
        &[],
    )
    .await;
    assert_eq!(refused.status, 401);
    assert_eq!(refused.json()["error"].as_str(), Some("auth_required"));

    let mut ambiguous = native_headers;
    ambiguous.push(("Sec-WebSocket-Protocol", "tether.v1, tether.auth.other"));
    let refused = send(daemon.port, "GET", "/ws", &ambiguous, &[]).await;
    assert_eq!(refused.status, 401);
    assert_eq!(refused.json()["error"].as_str(), Some("auth_required"));

    let cookie = [
        ("Tailscale-User-Login", LOGIN),
        ("Cookie", "tether=anything"),
    ];
    let refused = send(daemon.port, "GET", "/fs/roots", &cookie, &[]).await;
    assert_eq!(refused.status, 401);
    assert_eq!(refused.json()["error"].as_str(), Some("auth_required"));
}

#[tokio::test]
async fn a_second_serve_handler_or_tcp_forward_removes_the_browser_origin() {
    let daemon = start_with_fake("bad-origin", true, true, true).await;
    let login = [("Tailscale-User-Login", LOGIN)];
    let (status, body) = request(daemon.serve_port, "GET", "/auth/info", &login, "").await;
    assert_eq!(status, 200, "{body}");
    let info: serde_json::Value = serde_json::from_str(&body).expect("auth info JSON");
    assert!(info["browserOrigin"].is_null(), "{info}");
    assert!(
        info["browserRefused"]
            .as_str()
            .is_some_and(|text| text.contains("Publish tether")),
        "{info}"
    );

    let reply = send(
        daemon.serve_port,
        "GET",
        "/auth/node/session",
        &NODE_HEADERS,
        &[],
    )
    .await;
    assert_eq!(reply.status, 403);
    assert_eq!(reply.json()["error"].as_str(), Some("bad_origin"));
    assert_eq!(
        daemon
            .fake
            .whois_calls
            .load(std::sync::atomic::Ordering::SeqCst),
        0
    );
}

#[tokio::test]
async fn a_node_enrols_with_the_shared_code_and_shell_paths_do_not_call_whois() {
    let daemon = start("node-enrollment").await;
    let no_browser_metadata = [
        ("Tailscale-User-Login", LOGIN),
        ("Sec-Fetch-Site", "cross-site"),
        ("Accept-Encoding", "gzip"),
    ];
    let reply = send(daemon.serve_port, "GET", "/", &no_browser_metadata, &[]).await;
    assert_eq!(reply.status, 200);
    assert_eq!(reply.header("content-encoding"), Some("gzip"));
    assert_eq!(reply.header("vary"), Some("Accept-Encoding"));
    let etag = reply.header("etag").expect("shell ETag");
    assert!(etag.starts_with('"') && etag.ends_with('"'), "{etag}");
    let conditional_headers = no_browser_metadata
        .iter()
        .copied()
        .chain([("If-None-Match", etag)])
        .collect::<Vec<_>>();
    let conditional = send(daemon.serve_port, "GET", "/", &conditional_headers, &[]).await;
    assert_eq!(conditional.status, 304);
    assert_eq!(
        daemon
            .fake
            .whois_calls
            .load(std::sync::atomic::Ordering::SeqCst),
        0
    );

    let login = [("Tailscale-User-Login", LOGIN)];
    let unknown = send(daemon.serve_port, "GET", "/auth/unknown", &login, &[]).await;
    assert_eq!(unknown.status, 404);
    assert_eq!(unknown.json()["error"].as_str(), Some("not_found"));
    let unknown_post = send(daemon.serve_port, "POST", "/auth/unknown", &login, &[]).await;
    assert_eq!(unknown_post.status, 404);
    assert_eq!(unknown_post.json()["error"].as_str(), Some("not_found"));
    assert_eq!(
        daemon
            .fake
            .whois_calls
            .load(std::sync::atomic::Ordering::SeqCst),
        0
    );
    let manifest = send(
        daemon.serve_port,
        "GET",
        "/manifest.webmanifest",
        &login,
        &[],
    )
    .await;
    assert_eq!(manifest.status, 200, "{}", manifest.text());
    assert_eq!(manifest.json()["name"].as_str(), Some("tether devbox"));
    assert_eq!(
        daemon
            .fake
            .whois_calls
            .load(std::sync::atomic::Ordering::SeqCst),
        0
    );

    let unenrolled = send(
        daemon.serve_port,
        "GET",
        "/auth/node/session",
        &NODE_HEADERS,
        &[],
    )
    .await;
    assert_eq!(unenrolled.status, 401);
    assert_eq!(unenrolled.json()["error"].as_str(), Some("not_enrolled"));
    assert_eq!(unenrolled.json()["node"]["name"].as_str(), Some("laptop"));
    assert_eq!(
        daemon
            .fake
            .whois_calls
            .load(std::sync::atomic::Ordering::SeqCst),
        1
    );
    let still_unenrolled = send(
        daemon.serve_port,
        "GET",
        "/auth/node/session",
        &NODE_HEADERS,
        &[],
    )
    .await;
    assert_eq!(still_unenrolled.status, 401);
    assert_eq!(
        daemon
            .fake
            .whois_calls
            .load(std::sync::atomic::Ordering::SeqCst),
        2,
        "whois is per request and is not cached"
    );

    let code = daemon
        .store
        .set_pending(Duration::from_secs(600), SystemTime::now())
        .expect("pending code");
    let body = format!(r#"{{"code":"{code}","deviceName":"laptop"}}"#);
    let reply = send(
        daemon.serve_port,
        "POST",
        "/auth/node/enroll",
        &[
            NODE_HEADERS[0],
            NODE_HEADERS[1],
            NODE_HEADERS[2],
            NODE_HEADERS[3],
            NODE_HEADERS[4],
            ("Content-Type", "application/json"),
        ],
        body.as_bytes(),
    )
    .await;
    assert_eq!(reply.status, 200, "{}", reply.text());
    assert_eq!(reply.json()["deviceName"].as_str(), Some("laptop"));
    let file = daemon.store.read().expect("auth file");
    assert!(file.pending.is_none());
    assert_eq!(file.devices.len(), 1);
    assert_eq!(file.devices[0].kind, tether::auth::DeviceKind::Node);
    assert_eq!(
        file.devices[0].node_id.as_deref(),
        Some("nLAPTOP0123456789CNTRL")
    );
    let remove = send(
        daemon.serve_port,
        "POST",
        "/auth/node/remove",
        &[
            NODE_HEADERS[0],
            NODE_HEADERS[1],
            NODE_HEADERS[2],
            NODE_HEADERS[3],
            NODE_HEADERS[4],
            ("Content-Type", "application/json"),
        ],
        b"{}",
    )
    .await;
    assert_eq!(remove.status, 204);
    assert!(daemon.store.read().expect("auth file").devices.is_empty());

    let no_fetch = NODE_HEADERS
        .into_iter()
        .filter(|(name, _)| *name != "Sec-Fetch-Site")
        .chain([("Content-Type", "application/json")])
        .collect::<Vec<_>>();
    let remove = send(
        daemon.serve_port,
        "POST",
        "/auth/node/remove",
        &no_fetch,
        b"{}",
    )
    .await;
    assert_eq!(remove.status, 204, "{}", remove.text());
}

#[tokio::test]
async fn removing_a_node_closes_its_live_socket_at_the_recheck() {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;

    let daemon = start("node-revoke").await;
    let now = SystemTime::now();
    let code = daemon
        .store
        .set_pending(Duration::from_secs(600), now)
        .expect("pending code");
    daemon
        .store
        .enroll_node(&code, "laptop", "nLAPTOP0123456789CNTRL", LOGIN, LOGIN, now)
        .expect("enrolled");

    let mut upgrade = format!("ws://127.0.0.1:{}/ws", daemon.serve_port)
        .into_client_request()
        .expect("upgrade request");
    let headers = upgrade.headers_mut();
    headers.insert("host", "localhost".parse().expect("host"));
    for (name, value) in NODE_HEADERS {
        headers.insert(name, value.parse().expect("header"));
    }
    headers.insert(
        "sec-websocket-protocol",
        "tether.v1".parse().expect("subprotocol"),
    );
    let (mut socket, _) = tokio_tungstenite::connect_async(upgrade)
        .await
        .expect("upgraded");
    socket
        .send(Message::text(
            r#"{"type":"hello","data":{"protocol":1,"client":{"kind":"web","build":"test"}}}"#,
        ))
        .await
        .expect("hello sent");
    let welcome = tokio::time::timeout(WAIT, socket.next())
        .await
        .expect("welcome in time");
    assert!(matches!(welcome, Some(Ok(Message::Text(_)))));

    assert!(
        daemon
            .store
            .remove_node("nLAPTOP0123456789CNTRL")
            .expect("removed")
    );
    let closed = tokio::time::timeout(Duration::from_secs(12), socket.next())
        .await
        .expect("re-check closes the socket");
    let Some(Ok(Message::Close(Some(frame)))) = closed else {
        panic!("no close frame: {closed:?}");
    };
    assert_eq!(frame.code, CloseCode::from(4401));
}
