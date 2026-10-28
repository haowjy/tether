//! The file routes over a real socket (fs.md "Routes", "Errors"): ranges and their
//! headers as the native player sees them, uploads one at a time with their part file
//! cleaned up, Settings writes that keep a hand-written `config.toml`, and a broken
//! config failing the config routes closed.

use std::time::Duration;

use tokio::io::AsyncWriteExt as _;
use tokio::net::TcpStream;

#[path = "support/daemon.rs"]
mod daemon;

use daemon::{Daemon, Reply, send, start, url};

async fn get(daemon: &Daemon, path: &str, extra: &[(&str, &str)]) -> Reply {
    let device = daemon.device();
    let mut headers: Vec<(&str, &str)> = device
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    headers.extend_from_slice(extra);
    send(daemon.port, "GET", path, &headers, b"").await
}

async fn post(daemon: &Daemon, path: &str, body: &[u8], json: bool) -> Reply {
    let device = daemon.device();
    let mut headers: Vec<(&str, &str)> = device
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    if json {
        headers.push(("Content-Type", "application/json"));
    }
    send(daemon.port, "POST", path, &headers, body).await
}

fn path_body(path: &std::path::Path) -> Vec<u8> {
    serde_json::json!({ "path": path }).to_string().into_bytes()
}

#[tokio::test]
async fn a_video_streams_by_range_with_a_stable_etag() {
    let daemon = start("fs-raw").await;
    std::fs::create_dir_all(daemon.home("videos")).expect("a dir");
    let clip = daemon.home("videos/clip one.MOV");
    let bytes: Vec<u8> = (0..300_000u32).map(|i| (i % 251) as u8).collect();
    std::fs::write(&clip, &bytes).expect("written");
    let raw = url("/fs/raw/", &clip);

    // AVFoundation's probe.
    let probe = get(&daemon, &raw, &[("Range", "bytes=0-1")]).await;
    assert_eq!(probe.status, 206);
    assert_eq!(probe.body, &bytes[..2]);
    assert_eq!(probe.header("content-range"), Some("bytes 0-1/300000"));
    assert_eq!(probe.header("content-length"), Some("2"));
    assert_eq!(probe.header("content-type"), Some("video/quicktime"));
    assert_eq!(probe.header("accept-ranges"), Some("bytes"));
    assert_eq!(probe.header("x-content-type-options"), Some("nosniff"));
    assert_eq!(probe.header("content-security-policy"), Some("sandbox"));
    assert_eq!(probe.header("cache-control"), Some("no-store"));
    assert_eq!(
        probe.header("cross-origin-resource-policy"),
        Some("same-origin")
    );
    let etag = probe.header("etag").expect("an ETag").to_owned();

    // A range across chunk boundaries, with a matching If-Range.
    let middle = get(
        &daemon,
        &raw,
        &[("Range", "bytes=60000-200000"), ("If-Range", &etag)],
    )
    .await;
    assert_eq!(middle.status, 206);
    assert_eq!(middle.body, &bytes[60_000..=200_000]);
    assert_eq!(middle.header("etag"), Some(etag.as_str()));
    let whole = get(&daemon, &raw, &[]).await;
    assert_eq!((whole.status, whole.body == bytes), (200, true));

    let past = get(&daemon, &raw, &[("Range", "bytes=300000-")]).await;
    assert_eq!(
        (past.status, past.text()),
        (416, r#"{"error":"bad_range"}"#)
    );
    assert_eq!(past.header("content-range"), Some("bytes */300000"));

    // The file changes: a new ETag, and an If-Range on the old one gets the whole file.
    std::fs::write(&clip, &bytes[..1000]).expect("rewritten");
    let stale = get(
        &daemon,
        &raw,
        &[("Range", "bytes=0-1"), ("If-Range", &etag)],
    )
    .await;
    assert_eq!((stale.status, stale.body.len()), (200, 1000));
    assert_ne!(stale.header("etag"), Some(etag.as_str()));

    // Paths that don't decode are refused in the JSON shape.
    let undecodable = get(&daemon, "/fs/raw/tmp/%FF", &[]).await;
    assert_eq!(
        (undecodable.status, undecodable.text()),
        (400, r#"{"error":"bad_request"}"#)
    );
    let nul = get(&daemon, "/fs/raw/tmp/a%00b", &[]).await;
    assert_eq!(nul.status, 400);

    // A file outside `$HOME` is as readable as any other.
    let outside = get(&daemon, &url("/fs/raw/", &daemon.config), &[]).await;
    assert_eq!(outside.status, 200, "{}", outside.text());
}

#[tokio::test]
async fn uploads_land_one_at_a_time_and_leave_no_part_file() {
    let daemon = start("fs-upload").await;
    let jpeg = b"\xff\xd8\xff\xe0 not really a JPEG";
    let uploaded = post(&daemon, "/fs/upload?name=IMG_0001.JPEG", jpeg, false).await;
    assert_eq!(uploaded.status, 201, "{}", uploaded.text());
    let body = uploaded.json();
    let path = body["path"].as_str().expect("a path");
    assert_eq!(body["size"], jpeg.len());
    let uploads = daemon.home("tether-uploads");
    assert!(
        path.starts_with(uploads.to_str().expect("UTF-8")) && path.ends_with(".jpeg"),
        "{path}"
    );
    assert_eq!(std::fs::read(path).expect("the upload"), jpeg);

    // Over the cap by Content-Length: refused before the body.
    let device = daemon.device();
    let auth: Vec<String> = device
        .iter()
        .map(|(k, v)| format!("{k}: {v}\r\n"))
        .collect();
    let too_large = format!(
        "POST /fs/upload?name=a.mov HTTP/1.1\r\nHost: x\r\n{}Content-Length: {}\r\n\r\n",
        auth.concat(),
        128 * 1024 * 1024 + 1
    );
    let reply = raw_exchange(daemon.port, too_large.as_bytes()).await;
    assert!(reply.starts_with("HTTP/1.1 413"), "{reply}");
    assert!(reply.contains(r#"{"error":"too_large"}"#), "{reply}");

    // One upload at a time: a second gets busy at once.
    let mut first = TcpStream::connect(("127.0.0.1", daemon.port))
        .await
        .expect("connected");
    let head = format!(
        "POST /fs/upload?name=b.png HTTP/1.1\r\nHost: x\r\n{}Content-Length: 1000\r\n\r\n",
        auth.concat()
    );
    first.write_all(head.as_bytes()).await.expect("sent");
    first.write_all(&[0; 10]).await.expect("sent");
    let part = || {
        std::fs::read_dir(&uploads)
            .expect("the uploads folder")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().ends_with(".part"))
    };
    wait_for(part).await;
    let second = post(&daemon, "/fs/upload?name=c.png", b"x", false).await;
    assert_eq!((second.status, second.text()), (503, r#"{"error":"busy"}"#));
    assert_eq!(second.header("retry-after"), Some("1"));
    // The client goes away mid-body: its part file goes too, and the slot frees.
    drop(first);
    wait_for(|| !part()).await;
    let third = post(&daemon, "/fs/upload?name=c.png", b"x", false).await;
    assert_eq!(third.status, 201, "{}", third.text());
    assert_eq!(std::fs::read_dir(&uploads).expect("the folder").count(), 2);
}

#[tokio::test]
async fn settings_writes_keep_a_hand_written_symlinked_config() {
    let daemon = start("fs-favorites").await;
    let dotfiles = daemon.dir.join("dotfiles");
    std::fs::create_dir_all(&dotfiles).expect("a dir");
    let real = dotfiles.join("config.toml");
    let hand_written = "# mine\nfavorites = [\n  \"~/code\", # the code\n]\nfuture = 1\n\n[tmux]\nsocket_name = \"x\"\n";
    std::fs::write(&real, hand_written).expect("written");
    std::fs::remove_file(&daemon.config).expect("removed");
    std::os::unix::fs::symlink(&real, &daemon.config).expect("a link");
    std::fs::create_dir_all(daemon.home("code")).expect("a dir");
    std::fs::create_dir_all(daemon.home("notes")).expect("a dir");

    let added = post(
        &daemon,
        "/fs/favorites/add",
        &path_body(&daemon.home("notes")),
        true,
    )
    .await;
    assert_eq!(added.status, 200, "{}", added.text());
    let favorites = added.json();
    assert_eq!(favorites["home"], daemon.home.to_str().expect("UTF-8"));
    assert_eq!(favorites["favorites"][0]["path"], "~/code");
    assert_eq!(favorites["favorites"][0]["ok"], true);
    assert_eq!(
        favorites["favorites"][1]["path"],
        daemon.home("notes").to_str().expect("UTF-8")
    );
    assert_eq!(favorites["uploadsDir"]["path"], "~/tether-uploads");
    let written = std::fs::read_to_string(&real).expect("the file");
    let notes = daemon.home("notes");
    let expected = hand_written.replace(
        "# the code\n]",
        &format!("# the code\n  \"{}\",\n]", notes.display()),
    );
    assert_eq!(written, expected);
    assert!(
        std::fs::symlink_metadata(&daemon.config)
            .expect("the link")
            .is_symlink()
    );
    // Adding the same directory by another path is a no-op.
    let again = post(
        &daemon,
        "/fs/favorites/add",
        &path_body(&daemon.home("code/../notes")),
        true,
    )
    .await;
    assert_eq!(again.status, 200);
    assert_eq!(std::fs::read_to_string(&real).expect("the file"), expected);

    // A directory outside `$HOME` is a favorite too; a file or a missing path isn't.
    let tmp = std::fs::canonicalize("/tmp").expect("/tmp");
    let reply = post(&daemon, "/fs/favorites/add", &path_body(&tmp), true).await;
    assert_eq!(
        reply.json()["favorites"][2]["canonical"],
        tmp.to_str().expect("UTF-8")
    );
    let removed = post(&daemon, "/fs/favorites/remove", &path_body(&tmp), true).await;
    assert_eq!(
        removed.json()["favorites"].as_array().map(Vec::len),
        Some(2)
    );
    std::fs::write(daemon.home("file"), b"x").expect("written");
    for (refused, expected) in [
        (daemon.home("file"), (409, r#"{"error":"not_a_directory"}"#)),
        (daemon.home("missing"), (404, r#"{"error":"not_found"}"#)),
    ] {
        let reply = post(&daemon, "/fs/favorites/add", &path_body(&refused), true).await;
        assert_eq!((reply.status, reply.text()), expected);
    }

    // Removing by the stored text, then by the canonical path.
    let removed = post(
        &daemon,
        "/fs/favorites/remove",
        br#"{"path":"~/code"}"#,
        true,
    )
    .await;
    assert_eq!(
        removed.json()["favorites"].as_array().map(Vec::len),
        Some(1)
    );
    let removed = post(&daemon, "/fs/favorites/remove", &path_body(&notes), true).await;
    assert_eq!(
        removed.json()["favorites"].as_array().map(Vec::len),
        Some(0)
    );
    let written = std::fs::read_to_string(&real).expect("the file");
    assert!(
        written.starts_with("# mine\nfavorites = [\n") && written.contains("future = 1"),
        "{written}"
    );

    let moved = post(&daemon, "/fs/uploads-dir", &path_body(&notes), true).await;
    assert_eq!(
        moved.json()["uploadsDir"]["canonical"],
        notes.to_str().expect("UTF-8")
    );
    let large = format!(r#"{{"path":"{}"}}"#, "a".repeat(5000));
    let reply = post(&daemon, "/fs/favorites/add", large.as_bytes(), true).await;
    assert_eq!(
        (reply.status, reply.text()),
        (413, r#"{"error":"too_large"}"#)
    );

    // A link to nothing is refused, and neither the link nor its target changes.
    std::fs::remove_file(&real).expect("removed");
    let reply = post(&daemon, "/fs/favorites/add", &path_body(&notes), true).await;
    assert_eq!(
        (reply.status, reply.text()),
        (409, r#"{"error":"config_read_only"}"#)
    );
    let link = std::fs::symlink_metadata(&daemon.config).expect("the link");
    assert!(link.is_symlink() && !real.exists());
}

#[tokio::test]
async fn a_broken_config_fails_the_config_routes_closed() {
    let daemon = start("fs-broken").await;
    std::fs::create_dir_all(daemon.home("code")).expect("a dir");
    let broken = "favorites = [\"~/code\"\n";
    std::fs::write(&daemon.config, broken).expect("written");
    let code = url("/fs/list/", &daemon.home("code"));
    let unavailable = r#"{"error":"config_unavailable"}"#;
    let reply = get(&daemon, "/fs/favorites", &[]).await;
    assert_eq!((reply.status, reply.text()), (503, unavailable));
    // Listing and reading don't consult the config.
    assert_eq!(get(&daemon, &code, &[]).await.status, 200);
    let body = path_body(&daemon.home("code"));
    for path in [
        "/fs/favorites/add",
        "/fs/favorites/remove",
        "/fs/uploads-dir",
    ] {
        let reply = post(&daemon, path, &body, true).await;
        assert_eq!((reply.status, reply.text()), (503, unavailable), "{path}");
    }
    let upload = post(&daemon, "/fs/upload?name=a.png", b"x", false).await;
    assert_eq!((upload.status, upload.text()), (503, unavailable));
    // Nothing wrote the file, and a fixed file applies to the next request.
    assert_eq!(
        std::fs::read_to_string(&daemon.config).expect("the file"),
        broken
    );
    std::fs::write(&daemon.config, "favorites = [\"~/code\"]\n").expect("fixed");
    assert_eq!(get(&daemon, "/fs/favorites", &[]).await.status, 200);
}

/// Writes `request` and reads until the server closes or a second passes.
async fn raw_exchange(port: u16, request: &[u8]) -> String {
    use tokio::io::AsyncReadExt as _;
    let mut stream = TcpStream::connect(("127.0.0.1", port))
        .await
        .expect("connected");
    stream.write_all(request).await.expect("sent");
    let mut reply = vec![0; 4096];
    let n = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut reply))
        .await
        .expect("an answer in time")
        .expect("read");
    String::from_utf8_lossy(&reply[..n]).into_owned()
}

async fn wait_for(condition: impl Fn() -> bool) {
    let waited = tokio::time::timeout(Duration::from_secs(5), async {
        while !condition() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    });
    waited.await.expect("in time");
}
