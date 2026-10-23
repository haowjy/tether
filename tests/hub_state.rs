//! `hub::State` driven by scripted inputs; its fake tmux model is in `support/fake_hub.rs`.

#[path = "support/fake_hub.rs"]
mod fake_hub;

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::time::Duration;

use bytes::Bytes;
use fake_hub::{
    Got, Hub, SERVER_NAME, capture_history, kind, kinds, let_go_of_window_0, line_for, release,
    size, snapshot, vote,
};
use serde_json::json;
use tether::hub::{
    CAPTURE_RESERVATION, CREDIT, FromConn, Input, LINGER, OVERDRAFT, SNAPSHOT_SPACING,
    USER_IN_FLIGHT,
};
use tether::proto::{self, SessionRef, WindowRef};
use tether::tmux::{
    InputItem, MAX_IN_FLIGHT, OneShotCmd, Op, PaneId, PumpMsg, Size, WindowId, command,
};

#[test]
fn a_watch_binds_after_locating_and_catches_up_by_snapshot() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.watch(conn, 1, 0);
    // No control client exists yet, so the first Locate is a one-shot.
    assert!(
        matches!(hub.oneshots.front(), Some((_, OneShotCmd::Locate { window })) if *window == WindowId(0))
    );
    hub.settle();
    let client = hub.client(0);
    let got = hub.take(conn);
    assert_eq!(
        got,
        [
            Got::Json(
                json!({"type": "watching", "data": {"watch": 1, "window": {"server": SERVER_NAME, "window": 0}, "session": {"server": SERVER_NAME, "session": 0}, "pane": 0, "cwd": null}})
            ),
            Got::Snapshot(1, size(80, 24)),
        ]
    );
    let lines = hub.lines(client);
    assert!(lines.contains(&line_for(Op::Subscribe {
        window: WindowId(0)
    })));
    assert!(lines.contains(&vote(0, 80, 24)));

    hub.output(client, 0, "hi");
    assert_eq!(hub.take(conn), [Got::Output(1, Bytes::from_static(b"hi"))]);
    hub.feed(client, "%subscription-changed w0 $0 @0 1 - : /home/j\n");
    let watching = hub.take_json(conn);
    assert_eq!(watching[0]["data"]["cwd"], "/home/j");

    hub.send(
        conn,
        json!({"type": "input", "data": {"watch": 1, "items": [{"text": "ls"}, {"key": "Enter"}]}}),
    );
    hub.settle();
    let input = Op::Input {
        window: WindowId(0),
        items: vec![InputItem::Text("ls".into()), InputItem::Key("Enter".into())],
    };
    assert_eq!(hub.lines(client).last(), Some(&line_for(input)));
    assert!(
        hub.take(conn).is_empty(),
        "input that succeeds answers nothing"
    );
}

#[test]
fn a_second_watch_joins_a_live_stream_without_disturbing_the_first() {
    let mut hub = Hub::new();
    let (first, second) = (hub.connect(), hub.connect());
    hub.open(first, 1, 0);
    let client = hub.client(0);
    hub.take(first);
    hub.watch_sized(second, 5, 0, 100, 30);
    // Bound already: `watching` at once, then a snapshot for the new watch only.
    assert_eq!(kinds(&hub.take_json(second)), ["watching"]);
    hub.output(client, 0, "a");
    assert_eq!(hub.take(first), [Got::Output(1, Bytes::from_static(b"a"))]);
    assert!(hub.take(second).is_empty(), "awaiting its snapshot");
    hub.settle();
    assert_eq!(hub.take(second), [Got::Snapshot(5, size(80, 24))]);
    assert!(hub.take(first).is_empty());
    // The last watch's size is the window's vote.
    assert!(hub.lines(client).contains(&vote(0, 100, 30)));
    hub.output(client, 0, "b");
    assert_eq!(hub.take(first), [Got::Output(1, Bytes::from_static(b"b"))]);
    assert_eq!(hub.take(second), [Got::Output(5, Bytes::from_static(b"b"))]);

    // The pane stays wanted until its last watch leaves.
    hub.send(first, json!({"type": "unwatch", "data": {"watch": 1}}));
    hub.settle();
    assert!(!hub.lines(client).contains(&release(0)));
    hub.send(second, json!({"type": "unwatch", "data": {"watch": 5}}));
    hub.settle();
    assert!(hub.lines(client).ends_with(&let_go_of_window_0()));
    // The client lingers, then closes.
    hub.advance(LINGER + Duration::from_nanos(1));
    assert!(hub.clients[&client].closed);
}

#[test]
fn a_resize_votes_and_a_new_pane_size_breaks_the_stream() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    let client = hub.client(0);
    hub.take(conn);
    hub.send(
        conn,
        json!({"type": "resize", "data": {"watch": 1, "size": {"cols": 1000, "rows": 2}}}),
    );
    // Clamped to 500×5.
    assert_eq!(hub.lines(client).last(), Some(&vote(0, 500, 5)));
    hub.settle();
    // A layout repeating the pane's size is no break.
    hub.feed(
        client,
        "%layout-change @0 b25d,80x24,0,0,0 b25d,80x24,0,0,0 *\n",
    );
    hub.output(client, 0, "x");
    assert_eq!(hub.take(conn), [Got::Output(1, Bytes::from_static(b"x"))]);
    hub.window(0).size = Size { cols: 500, rows: 5 };
    hub.feed(
        client,
        "%layout-change @0 b25d,500x5,0,0,0 b25d,500x5,0,0,0 *\n",
    );
    hub.output(client, 0, "dropped: the snapshot holds it");
    assert!(hub.take(conn).is_empty());
    hub.settle();
    assert_eq!(hub.take(conn), [Got::Snapshot(1, size(500, 5))]);
}

#[test]
fn an_active_pane_change_during_a_snapshot_forgets_it_and_snapshots_the_new_pane() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.watch(conn, 1, 0);
    // Bind, but leave the first snapshot unanswered.
    hub.settle_until(|line| line == snapshot(0));
    let client = hub.client(0);
    hub.take(conn);
    hub.add_window(0, 0, 1);
    hub.feed(client, "%window-pane-changed @0 %1\n");
    assert_eq!(hub.take_json(conn)[0]["data"]["pane"], 1);
    hub.settle();
    // Only the new pane's snapshot reaches the watch.
    assert_eq!(hub.take(conn), [Got::Snapshot(1, size(80, 24))]);
    assert!(hub.lines(client).contains(&release(0)));
    hub.output(client, 1, "new");
    assert_eq!(hub.take(conn), [Got::Output(1, Bytes::from_static(b"new"))]);
}

#[test]
fn a_moved_window_rehomes_its_watch_with_a_fresh_snapshot() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    let old = hub.client(0);
    hub.take(conn);
    // move-window -s $0:@0 -t $1:
    hub.sessions.insert(1);
    hub.window(0).sessions = vec![1];
    hub.feed(old, "%unlinked-window-close @0\n");
    hub.settle();
    let new = hub.client(1);
    let got = hub.take(conn);
    let [Got::Json(watching), snapshot] = &got[..] else {
        panic!("{got:?}");
    };
    assert_eq!(kind(watching), "watching");
    assert_eq!(watching["data"]["session"]["session"], 1);
    assert_eq!(*snapshot, Got::Snapshot(1, size(80, 24)));
    // The old owner's copy no longer counts; it lets go of the window.
    hub.output(old, 0, "stale");
    hub.output(new, 0, "live");
    assert_eq!(
        hub.take(conn),
        [Got::Output(1, Bytes::from_static(b"live"))]
    );
    let [_, clear_vote, unsubscribe] = let_go_of_window_0();
    assert!(hub.lines(old).contains(&clear_vote) && hub.lines(old).contains(&unsubscribe));
    hub.advance(LINGER + Duration::from_nanos(1));
    assert!(hub.clients[&old].closed);
    assert!(!hub.clients[&new].closed);
}

#[test]
fn moving_a_sessions_last_window_rebinds_after_the_session_check() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    let old = hub.client(0);
    hub.take(conn);
    // The session dies with its last window: tmux sends %exit and the client ends.
    hub.sessions = BTreeSet::from([1]);
    hub.window(0).sessions = vec![1];
    hub.feed(old, "%exit\n");
    hub.exited(old);
    hub.settle();
    let got = hub.take(conn);
    let [Got::Json(closed), Got::Json(watching), snapshot] = &got[..] else {
        panic!("{got:?}");
    };
    assert_eq!(
        (kind(closed), kind(watching)),
        ("sessionClosed", "watching")
    );
    assert_eq!(closed["data"]["session"]["session"], 0);
    assert_eq!(watching["data"]["session"]["session"], 1);
    assert_eq!(*snapshot, Got::Snapshot(1, size(80, 24)));
    assert!(!hub.clients[&hub.client(1)].closed);
}

#[test]
fn a_detached_client_ends_its_watches_and_does_not_reattach() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    let client = hub.client(0);
    hub.take(conn);
    hub.feed(client, "%exit\n");
    hub.exited(client);
    hub.settle();
    assert_eq!(
        hub.take_json(conn),
        [json!({"type": "watchEnded", "data": {"watch": 1, "reason": "detached"}})]
    );
    assert_eq!(hub.clients.len(), 1, "nothing reattached");
}

#[test]
fn a_crashed_client_respawns_once_and_a_second_crash_ends_the_watch() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    let first = hub.client(0);
    hub.take(conn);
    hub.exited(first); // no %exit: a crash
    hub.settle();
    assert_eq!(hub.clients.len(), 1, "the respawn waits a second");
    assert!(hub.take(conn).is_empty());
    hub.advance(Duration::from_millis(1000));
    hub.settle();
    let second = hub.client(0);
    assert_ne!(first, second);
    // Same session and pane: no new `watching`, just the snapshot.
    assert_eq!(hub.take(conn), [Got::Snapshot(1, size(80, 24))]);
    hub.advance(Duration::from_secs(30));
    hub.exited(second);
    hub.settle();
    let json = hub.take_json(conn);
    assert_eq!(kinds(&json), ["watchEnded"]);
    assert_eq!(json[0]["data"]["reason"], "error");
}

#[test]
fn a_client_that_stops_answering_is_killed_as_a_crash() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    let client = hub.client(0);
    hub.send(
        conn,
        json!({"type": "input", "data": {"watch": 1, "items": [{"text": "x"}]}}),
    );
    hub.advance(Duration::from_secs(9));
    assert!(!hub.clients[&client].closed);
    hub.advance(Duration::from_secs(1));
    assert!(hub.clients[&client].closed);
    hub.settle();
    hub.advance(Duration::from_secs(1));
    hub.settle();
    assert_ne!(hub.client(0), client, "respawned like a crash");
}

#[test]
fn kill_server_broadcasts_server_exited_and_drops_everything() {
    let mut hub = Hub::new();
    let (conn, other) = (hub.connect(), hub.connect());
    hub.open(conn, 1, 0);
    let client = hub.client(0);
    hub.take(conn);
    hub.alive = false;
    hub.feed(client, "%exit\n");
    hub.exited(client);
    hub.settle();
    let expected = json!({"type": "serverExited", "data": {"server": SERVER_NAME}});
    assert_eq!(hub.take_json(conn), std::slice::from_ref(&expected));
    assert_eq!(hub.take_json(other), [expected]);
    // A tab from that server, watched again, closes at once.
    hub.watch(conn, 2, 0);
    hub.settle();
    assert_eq!(kinds(&hub.take_json(conn)), ["serverExited"]);
}

#[test]
fn a_killed_session_broadcasts_and_its_closed_window_too() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    let client = hub.client(0);
    hub.take(conn);
    hub.sessions.clear();
    hub.windows.clear();
    hub.feed(client, "%exit\n");
    hub.exited(client);
    hub.settle();
    assert_eq!(
        kinds(&hub.take_json(conn)),
        ["sessionClosed", "windowClosed"]
    );
}

#[test]
fn session_changes_broadcast_once_and_only_from_the_reporter() {
    let mut hub = Hub::new();
    hub.add_window(1, 1, 1);
    hub.add_window(2, 1, 2);
    let (reporter_conn, other_conn) = (hub.connect(), hub.connect());
    hub.open(reporter_conn, 1, 0);
    hub.open(other_conn, 1, 1);
    let (reporter, non_reporter) = (hub.client(0), hub.client(1));
    hub.take(reporter_conn);
    hub.take(other_conn);

    // The unobserved window close and the session listing notification are one input.
    hub.feed(reporter, "%window-close @2\n%sessions-changed\n");
    assert_eq!(
        hub.take(reporter_conn),
        [Got::Json(json!({"type": "sessionsChanged"}))]
    );
    assert_eq!(
        hub.take(other_conn),
        [Got::Json(json!({"type": "sessionsChanged"}))]
    );

    // A client other than the endpoint's reporter must not duplicate either event.
    hub.feed(non_reporter, "%window-close @2\n%sessions-changed\n");
    assert!(hub.take(reporter_conn).is_empty());
    assert!(hub.take(other_conn).is_empty());

    // A watched close is resolved by Locate and reported as WindowClosed, not a relist.
    hub.windows.remove(&0).expect("the watched fake window");
    hub.feed(reporter, "%window-close @0\n");
    hub.settle();
    assert_eq!(
        hub.take(reporter_conn),
        [Got::Json(json!({
            "type": "windowClosed",
            "data": {"window": {"server": SERVER_NAME, "window": 0}}
        }))]
    );
    assert_eq!(
        hub.take(other_conn),
        [Got::Json(json!({
            "type": "windowClosed",
            "data": {"window": {"server": SERVER_NAME, "window": 0}}
        }))]
    );
}

#[test]
fn a_linked_window_counts_only_its_owners_output() {
    let mut hub = Hub::new();
    // @0 is linked into $0 and $1; @1 lives in $1 only.
    hub.add_window(1, 1, 1);
    hub.window(0).sessions = vec![0, 1];
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    hub.open(conn, 2, 1);
    let (owner, other) = (hub.client(0), hub.client(1));
    hub.take(conn);
    // $1's client sees @0's pane too, but doesn't want it: it pauses it.
    hub.output(other, 0, "copy");
    assert!(hub.take(conn).is_empty());
    assert_eq!(
        hub.clients[&other].unanswered.back(),
        Some(&command::pause(PaneId(0)).line)
    );
    hub.output(owner, 0, "real");
    assert_eq!(
        hub.take(conn),
        [Got::Output(1, Bytes::from_static(b"real"))]
    );
    // Its notifications about the window don't count either.
    hub.feed(
        other,
        "%layout-change @0 b25d,90x30,0,0,0 b25d,90x30,0,0,0 *\n",
    );
    hub.feed(other, "%window-pane-changed @0 %7\n");
    hub.output(owner, 0, "still live");
    assert_eq!(
        hub.take(conn),
        [Got::Output(1, Bytes::from_static(b"still live"))]
    );
}

#[test]
fn a_window_binds_only_from_its_owners_own_answer() {
    let mut hub = Hub::new();
    hub.add_window(1, 1, 1);
    hub.add_window(2, 1, 2);
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    hub.open(conn, 2, 1);
    let (first, owner) = (hub.client(0), hub.client(1));
    let other = hub.connect();
    hub.take(conn);
    // @2's Locate runs on $0's client, which answers with the pane as it is now…
    hub.watch(other, 1, 2);
    let answer = hub.reply_bytes(first).expect("a Locate on $0's client");
    assert!(answer.contains("\t%2\t"));
    // …but the owner reports a new active pane before that answer is read.
    hub.window(2).pane = 9;
    hub.feed(owner, "%window-pane-changed @2 %9\n");
    hub.feed(first, &answer);
    hub.settle();
    let watching = hub.take_json(other);
    assert_eq!(kinds(&watching), ["watching"]);
    assert_eq!(watching[0]["data"]["pane"], 9);
}

#[test]
fn output_past_the_credit_starves_one_watch_until_a_spaced_snapshot() {
    let mut hub = Hub::new();
    hub.add_window(1, 0, 1);
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    hub.open(conn, 2, 1);
    let client = hub.client(0);
    hub.take(conn);
    // Fill most of the credit with watch 1's output, nothing returned.
    let chunk = "x".repeat(60_000);
    let sent = (0..100)
        .take_while(|_| {
            hub.output(client, 0, &chunk);
            !hub.take(conn).is_empty()
        })
        .count();
    assert_eq!(
        sent as u64,
        (CREDIT - 2 * 64 - 2 * 200) / 60_000,
        "then it starved"
    );
    // Watch 1 starved; watch 2's output now fits only above watch 1's reservation.
    hub.output(client, 1, "y");
    assert!(hub.take(conn).is_empty(), "the waiting snapshot goes first");
    // It starves too. Credit back: both catch up, no sooner than the spacing.
    hub.credit(conn, CREDIT as u32);
    hub.settle();
    assert!(hub.take(conn).is_empty());
    hub.advance(Duration::from_millis(250));
    hub.settle();
    let got = hub.take(conn);
    assert!(got.contains(&Got::Snapshot(1, size(80, 24))), "{got:?}");
    assert!(got.contains(&Got::Snapshot(2, size(80, 24))), "{got:?}");
    hub.output(client, 1, "z");
    assert_eq!(hub.take(conn), [Got::Output(2, Bytes::from_static(b"z"))]);
}

#[test]
fn history_and_listings_need_a_capture_slot_and_credit() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    hub.take(conn);
    // Rows past 200 are cut.
    hub.send(
        conn,
        json!({"type": "history", "data": {"req": 3, "watch": 1, "start": -500, "end": 0}}),
    );
    let client = hub.client(0);
    assert_eq!(hub.lines(client).last(), Some(&capture_history(-500, -301)));
    hub.settle();
    let chunk = hub.take_json(conn);
    assert_eq!(kind(&chunk[0]), "historyChunk");
    assert_eq!(
        chunk[0]["data"]["lines"].as_array().map(Vec::len),
        Some(200)
    );
    // Large physical capture groups exceed tmux's raw reply cap and are retried with
    // fewer rows; their returned JSON still fits the connection reservation.
    hub.row_width = 5000;
    let history =
        json!({"type": "history", "data": {"req": 4, "watch": 1, "start": -199, "end": 0}});
    hub.send(conn, history.clone());
    hub.settle();
    let chunk = hub.take_json(conn);
    let rows = chunk[0]["data"]["lines"].as_array().map_or(0, Vec::len);
    assert!(rows > 0 && rows < 200, "{rows} rows");
    assert!(chunk[0].to_string().len() as u64 <= CAPTURE_RESERVATION);
    // Rows over tmux's reply cap are asked again by halves.
    hub.credit(conn, CREDIT as u32);
    hub.row_width = 6000;
    hub.send(conn, history.clone());
    hub.settle();
    assert!(
        hub.lines(client).ends_with(&[
            capture_history(-199, 0),
            capture_history(-199, -100),
            capture_history(-199, -150),
        ]),
        "{:?}",
        hub.lines(client)
    );
    let chunk = hub.take_json(conn);
    assert_eq!(chunk[0]["data"]["lines"].as_array().map(Vec::len), Some(50));
    // Down to one row, which fails if it still doesn't fit.
    hub.credit(conn, CREDIT as u32);
    hub.row_width = 800_000;
    let one = json!({"type": "history", "data": {"req": 9, "watch": 1, "start": -1, "end": 0}});
    hub.send(conn, one);
    hub.settle();
    assert!(
        hub.lines(client)
            .ends_with(&[capture_history(-1, 0), capture_history(-1, -1)])
    );
    let refused = hub.take_json(conn);
    assert_eq!(refused[0]["data"]["code"], "tmux");
    assert_eq!(refused[0]["data"]["req"], 9);
    let listing = json!({"type": "listSessions", "data": {"req": 5}});
    hub.send(conn, listing.clone());
    hub.settle();
    let sessions = hub.take_json(conn);
    assert_eq!(
        sessions[0]["data"]["tmux"]["sessions"][0]["attachedElsewhere"],
        true
    );
    // Without credit for their reservations, both are refused.
    let flood = "z".repeat(60_000);
    for _ in 0..32 {
        hub.output(client, 0, &flood);
    }
    hub.take(conn);
    hub.send(conn, history);
    hub.send(conn, listing);
    let refused = hub.take_json(conn);
    assert_eq!(refused[0]["data"]["code"], "busy");
    assert_eq!(refused[0]["data"]["req"], 4);
    assert_eq!(refused[1]["data"]["code"], "busy");
    assert_eq!(refused[1]["data"]["req"], 5);
    // With no server, the sheet says so.
    hub.credit(conn, CREDIT as u32);
    hub.alive = false;
    hub.send(conn, json!({"type": "listSessions", "data": {"req": 6}}));
    hub.settle();
    let json = hub.take_json(conn);
    assert!(json.contains(&json!({"type": "sessions", "data": {"req": 6, "tmux": null}})));
}

#[test]
fn a_released_snapshot_holds_its_capture_slot_until_tmux_answers_it() {
    let mut hub = Hub::new();
    hub.add_window(1, 0, 1);
    hub.add_window(2, 0, 2);
    // One watch per connection, so credit never holds a capture back.
    let (conn, one, two) = (hub.connect(), hub.connect(), hub.connect());
    hub.open(conn, 1, 0);
    hub.open(one, 1, 1);
    hub.open(two, 1, 2);
    hub.take(conn);
    let client = hub.client(0);
    let snapshots = [snapshot(0), snapshot(1), snapshot(2)];
    let continues = |hub: &Hub| {
        let lines = hub.lines(client);
        lines.iter().filter(|line| snapshots.contains(line)).count()
    };
    let resync_both = |hub: &mut Hub| {
        hub.send(one, json!({"type": "resync", "data": {"watch": 1}}));
        hub.send(two, json!({"type": "resync", "data": {"watch": 1}}));
    };
    let before = continues(&hub);
    // A snapshot of %0 goes out; the tab closes before it lands.
    hub.send(conn, json!({"type": "resync", "data": {"watch": 1}}));
    hub.send(conn, json!({"type": "unwatch", "data": {"watch": 1}}));
    assert!(hub.lines(client).ends_with(&let_go_of_window_0()));
    // Until tmux answers it, the released snapshot holds one of the two slots.
    resync_both(&mut hub);
    assert_eq!(continues(&hub), before + 2);
    hub.settle();
    assert_eq!(continues(&hub), before + 3);
    assert_eq!(hub.take(one).last(), Some(&Got::Snapshot(1, size(80, 24))));
    assert_eq!(hub.take(two).last(), Some(&Got::Snapshot(1, size(80, 24))));
    assert!(hub.take(conn).is_empty(), "nothing for the released pane");
    // Answered `Released`, it gave the slot back: two captures fit again.
    resync_both(&mut hub);
    assert_eq!(continues(&hub), before + 5);
}

#[test]
fn user_requests_stop_at_the_threshold_and_maintenance_continues() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    let client = hub.client(0);
    hub.take(conn);
    for _ in 0..MAX_IN_FLIGHT {
        hub.send(
            conn,
            json!({"type": "input", "data": {"watch": 1, "items": [{"text": "x"}]}}),
        );
    }
    let busy = hub
        .take_json(conn)
        .iter()
        .filter(|value| value["data"]["code"] == "busy")
        .count();
    assert_eq!(
        busy,
        MAX_IN_FLIGHT - USER_IN_FLIGHT,
        "inputs past {USER_IN_FLIGHT} in flight are refused"
    );
    // A resize still goes out.
    hub.send(
        conn,
        json!({"type": "resize", "data": {"watch": 1, "size": {"cols": 90, "rows": 30}}}),
    );
    assert_eq!(hub.clients[&client].unanswered.len(), USER_IN_FLIGHT + 1);
    assert_eq!(hub.lines(client).last(), Some(&vote(0, 90, 30)));
}

#[test]
fn daemon_limits_end_or_refuse_what_is_over_them() {
    let mut hub = Hub::new();
    hub.add_window(1, 1, 1);
    hub.add_window(2, 2, 2);
    hub.add_window(3, 3, 3);
    let (a, b) = (hub.connect(), hub.connect());
    hub.open(a, 1, 0);
    hub.open(a, 2, 1);
    hub.watch(a, 3, 2);
    assert_eq!(
        hub.take_json(a).last().cloned(),
        Some(
            json!({"type": "watchEnded", "data": {"watch": 3, "reason": "error", "message": "too many tabs open at once (2)"}})
        )
    );
    // Three sessions' clients exist; a fourth session finds none lingering.
    hub.open(b, 1, 2);
    hub.take(b);
    hub.open(b, 2, 3);
    let ended = hub.take_json(b);
    assert_eq!(kinds(&ended), ["watchEnded"]);
    assert_eq!(
        ended[0]["data"]["message"],
        "too many tmux sessions open (3)"
    );
    // Once one lingers, it makes room.
    hub.send(b, json!({"type": "unwatch", "data": {"watch": 1}}));
    hub.settle();
    hub.open(b, 3, 3);
    assert!(kinds(&hub.take_json(b)).contains(&"watching"));
    // Input over 4 KiB is refused, and the watch stays.
    let text = "q".repeat(4097);
    hub.send(
        a,
        json!({"type": "input", "data": {"watch": 1, "items": [{"text": text}]}}),
    );
    let refused = hub.take_json(a);
    assert_eq!(
        refused.last().map(|value| value["data"]["code"].clone()),
        Some(json!("inputTooLarge"))
    );
}

#[test]
fn every_paste_path_removes_its_file() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    // Before `watching`: busy.
    hub.watch(conn, 1, 0);
    let file = hub.paste_file("/run/early");
    hub.input(Input::Conn(conn, FromConn::Paste { watch: 1, file }));
    assert_eq!(hub.removed, [PathBuf::from("/run/early")]);
    assert_eq!(
        hub.take_json(conn)
            .last()
            .map(|value| value["data"]["code"].clone()),
        Some(json!("busy"))
    );
    hub.settle();
    // Answered: removed on its reply.
    let file = hub.paste_file("/run/ok");
    hub.input(Input::Conn(conn, FromConn::Paste { watch: 1, file }));
    assert_eq!(hub.removed.len(), 1);
    hub.settle();
    assert_eq!(hub.removed.last(), Some(&PathBuf::from("/run/ok")));
    // In flight when its client ends.
    let file = hub.paste_file("/run/lost");
    hub.input(Input::Conn(conn, FromConn::Paste { watch: 1, file }));
    let client = hub.client(0);
    hub.exited(client);
    assert_eq!(hub.removed.last(), Some(&PathBuf::from("/run/lost")));
    // For an unknown watch, or a connection that has gone.
    let file = hub.paste_file("/run/unknown");
    hub.input(Input::Conn(conn, FromConn::Paste { watch: 9, file }));
    hub.input(Input::Conn(conn, FromConn::Closed));
    let file = hub.paste_file("/run/closed");
    hub.input(Input::Conn(conn, FromConn::Paste { watch: 1, file }));
    assert_eq!(
        hub.removed[3..],
        [PathBuf::from("/run/unknown"), PathBuf::from("/run/closed")]
    );
    assert_eq!(hub.slots.available_permits(), 4);
}

#[test]
fn control_json_past_the_overdraft_wedges_the_connection() {
    let mut hub = Hub::new();
    let (quiet, other) = (hub.connect(), hub.connect());
    hub.open(other, 1, 0);
    let client = hub.client(0);
    // `quiet` never returns credit; every rename is broadcast to it.
    let mut renames = 0;
    while !hub.dropped.contains(&quiet) {
        hub.feed(client, "%window-renamed @0 x\n");
        hub.credit(other, u32::MAX);
        renames += 1;
        assert!(renames < 40_000);
    }
    let rename = proto::ServerMsg::WindowRenamed {
        window: WindowRef {
            server: SERVER_NAME.into(),
            window: 0,
        },
        name: "x".into(),
    };
    let charge = rename.encode().len() as u64;
    // The first message past the credit plus the overdraft.
    assert_eq!(renames, (CREDIT + OVERDRAFT) / charge + 1);
    hub.take(quiet);
    hub.feed(client, "%window-renamed @0 y\n");
    assert!(
        hub.take(quiet).is_empty(),
        "a dropped connection gets nothing more"
    );
}

#[test]
fn new_windows_and_session_refs_from_another_server_run() {
    // A fresh hub has seen no server, so only tmux can refuse another run's session id,
    // which here names an unrelated session `$0`.
    let mut hub = Hub::new();
    let conn = hub.connect();
    let stale = SessionRef {
        server: "main:41-1".into(),
        session: 0,
    };
    hub.send(
        conn,
        json!({"type": "newWindow", "data": {"req": 1, "session": stale}}),
    );
    hub.settle();
    let json = hub.take_json(conn);
    assert_eq!(kinds(&json), ["serverExited", "error"]);
    assert_eq!(json[0]["data"]["server"], "main:41-1");
    assert_eq!(json[1]["data"]["code"], "noServer");
    assert!(
        !hub.windows.contains_key(&9),
        "nothing created on the new server"
    );
    let session = SessionRef {
        server: SERVER_NAME.into(),
        session: 0,
    };
    hub.send(
        conn,
        json!({"type": "newWindow", "data": {"req": 2, "session": session}}),
    );
    hub.settle();
    assert_eq!(
        hub.take_json(conn),
        [
            json!({"type": "created", "data": {"req": 2, "window": {"server": SERVER_NAME, "window": 9}, "session": {"server": SERVER_NAME, "session": 0}}})
        ]
    );
}

#[test]
fn a_closed_connection_and_an_exited_client_let_go_of_their_channels() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    let client = hub.client(0);
    hub.input(Input::Conn(conn, FromConn::Closed));
    assert!(
        hub.dropped.contains(&conn),
        "the executor drops its channel"
    );
    // tmux ended the lingering client on its own, not the hub.
    let stderr_tail = String::new();
    hub.input(Input::Pump(client, PumpMsg::Exited { stderr_tail }));
    assert!(
        hub.clients[&client].closed,
        "the executor drops its line channel"
    );
}

#[test]
fn output_past_the_spacing_deadline_stands_in_for_the_tick() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    let client = hub.client(0);
    hub.take(conn);
    let starve = |hub: &mut Hub| {
        let chunk = "x".repeat(60_000);
        for _ in 0..100 {
            hub.output(client, 0, &chunk);
            if hub.take(conn).is_empty() {
                return;
            }
        }
        panic!("never starved");
    };
    // Past the spacing with no credit to snapshot on: the deadline is spent, not
    // reported again and again.
    starve(&mut hub);
    hub.now += SNAPSHOT_SPACING + Duration::from_millis(1);
    hub.output(client, 0, "late");
    hub.settle();
    assert!(hub.take(conn).is_empty());
    assert_eq!(hub.state.next_deadline(), None);
    hub.credit(conn, CREDIT as u32);
    hub.settle();
    assert_eq!(hub.take(conn), [Got::Snapshot(1, size(80, 24))]);
    // Credit back within the spacing: the snapshot waits for its deadline, and the
    // output that comes first, not a Tick, takes it.
    hub.credit(conn, CREDIT as u32);
    starve(&mut hub);
    hub.credit(conn, CREDIT as u32);
    hub.settle();
    assert!(hub.take(conn).is_empty());
    assert_eq!(hub.state.next_deadline(), Some(hub.now + SNAPSHOT_SPACING));
    hub.now += SNAPSHOT_SPACING + Duration::from_millis(1);
    hub.output(client, 0, "late");
    hub.settle();
    assert_eq!(hub.take(conn), [Got::Snapshot(1, size(80, 24))]);
}
