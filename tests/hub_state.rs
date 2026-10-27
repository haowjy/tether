//! `hub::State` driven by scripted inputs; its fake tmux model is in `support/fake_hub.rs`.

#[path = "support/fake_hub.rs"]
mod fake_hub;

use std::path::PathBuf;
use std::time::Duration;

use bytes::Bytes;
use fake_hub::{
    Got, Hub, SERVER_NAME, capture_history, kind, kinds, let_go_of_window_0, line_for, release,
    size, snapshot, take_vote, vote,
};
use serde_json::json;
use tether::budget;
use tether::hub::{
    CAPTURE_RESERVATION, CREDIT, FromConn, Input, LINGER, OVERDRAFT, SNAPSHOT_SPACING,
    USER_IN_FLIGHT,
};
use tether::proto::{self, SessionRef};
use tether::tmux::{
    InputItem, MAX_IN_FLIGHT, OneShotCmd, Op, PaneId, PumpMsg, Size, WindowId, command,
};

#[test]
fn a_watch_binds_after_locating_and_catches_up_by_snapshot() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.watch(conn, 1, 0);
    // No control client exists yet, so the first Locate is a one-shot.
    assert!(matches!(
        hub.oneshots.front(),
        Some((_, OneShotCmd::Locate { session })) if *session == tether::tmux::SessionId(0)
    ));
    hub.settle();
    let client = hub.client(0);
    let got = hub.take(conn);
    assert_eq!(
        got,
        [
            Got::Json(
                json!({"type": "watching", "data": {"watch": 1, "window": {"id": 0, "index": 0, "name": "window0", "size": {"cols": 80, "rows": 24}}, "session": {"server": SERVER_NAME, "session": 0}, "pane": 0, "cwd": null}})
            ),
            Got::Snapshot(1, size(80, 24)),
        ]
    );
    let lines = hub.lines(client);
    assert!(lines.contains(&line_for(Op::Subscribe {
        window: WindowId(0)
    })));
    assert!(lines.contains(&take_vote(0, 80, 24)));

    hub.output(client, 0, "hi");
    assert_eq!(hub.take(conn), [Got::Output(1, Bytes::from_static(b"hi"))]);
    hub.feed(client, "%subscription-changed w0 $0 @0 1 - : |/home/j\n");
    let watching = hub.take_json(conn);
    assert_eq!(watching[0]["data"]["cwd"], "/home/j");

    hub.send(
        conn,
        json!({"type": "input", "data": {"watch": 1, "window": 0, "items": [{"text": "ls"}, {"key": "Enter"}]}}),
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
    let watching = hub.take_json(conn);
    assert_eq!(kinds(&watching), ["watching"]);
    assert_eq!(
        watching[0]["data"]["window"]["size"],
        json!({"cols":500,"rows":5})
    );
    hub.output(client, 0, "dropped: the snapshot holds it");
    assert!(hub.take(conn).is_empty());
    hub.settle();
    assert_eq!(hub.take(conn), [Got::Snapshot(1, size(500, 5))]);
}

#[test]
fn another_clients_act_yields_a_claim_and_input_or_resize_claims_again() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.watch_sized(conn, 1, 0, 110, 35);
    hub.settle();
    let client = hub.client(0);
    hub.take(conn);

    // The first value after Subscribe is only a baseline, not an act.
    hub.feed(
        client,
        "%subscription-changed w0 $0 @0 0 - : laptop.1.200x50.attached,focused,UTF-8;|/tmp\n",
    );
    hub.take_json(conn);
    hub.settle();

    // Activity changes, while the client remains on the window and size-counted.
    hub.feed(
        client,
        "%subscription-changed w0 $0 @0 0 - : laptop.2.200x50.attached,focused,UTF-8;|/tmp\n",
    );
    hub.settle();
    let clear = line_for(Op::ClearVote {
        window: WindowId(0),
    });
    assert!(hub.lines(client).contains(&clear));
    assert!(hub.take_json(conn).is_empty(), "the watch remains active");

    hub.send(
        conn,
        json!({"type":"input","data":{"watch":1,"window":0,"items":[{"text":"x"}]}}),
    );
    assert!(hub.lines(client).contains(&take_vote(0, 110, 35)));
    hub.settle();
    hub.take_json(conn);

    hub.feed(
        client,
        "%subscription-changed w0 $0 @0 0 - : laptop.3.200x50.attached,focused,UTF-8;|/tmp\n",
    );
    hub.settle();
    hub.send(
        conn,
        json!({"type":"resize","data":{"watch":1,"size":{"cols":90,"rows":28}}}),
    );
    assert!(hub.lines(client).contains(&take_vote(0, 90, 28)));
}

#[test]
fn an_act_reported_by_a_non_owner_does_not_yield_the_claim() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.watch_sized(conn, 1, 0, 110, 35);
    hub.settle();
    let owner = hub.client(0);
    hub.take(conn);

    // Attach a second control client in a different session. It does not own @0.
    hub.add_window(1, 1, 1);
    hub.watch(conn, 2, 1);
    hub.settle();
    let non_owner = hub.client(1);

    // Establish the owner's subscription baseline. A stale/foreign w0 value from the
    // other client is ignored because it never subscribed to @0.
    hub.feed(
        owner,
        "%subscription-changed w0 $0 @0 0 - : laptop.1.200x50.attached,focused,UTF-8;|/tmp\n",
    );
    hub.take_json(conn);
    hub.feed(
        non_owner,
        "%subscription-changed w0 $0 @0 0 - : laptop.2.200x50.attached,focused,UTF-8;|/tmp\n",
    );
    hub.settle();
    let clear = line_for(Op::ClearVote {
        window: WindowId(0),
    });
    assert!(
        !hub.lines(owner).contains(&clear),
        "a notification from a client that does not own the window cannot clear its vote"
    );

    // The same activity change from the actual owner yields the claim.
    hub.feed(
        owner,
        "%subscription-changed w0 $0 @0 0 - : laptop.2.200x50.attached,focused,UTF-8;|/tmp\n",
    );
    hub.settle();
    assert!(hub.lines(owner).contains(&clear));
}

#[test]
fn focus_out_leaving_and_ignore_size_entries_do_not_yield_a_claim() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.watch_sized(conn, 1, 0, 110, 35);
    hub.settle();
    let client = hub.client(0);
    hub.take(conn);

    hub.feed(
        client,
        "%subscription-changed w0 $0 @0 0 - : laptop.1.200x50.attached,focused,UTF-8;|/tmp\n",
    );
    hub.take_json(conn);
    hub.settle();
    let clear = line_for(Op::ClearVote {
        window: WindowId(0),
    });
    let initial_clears = hub
        .lines(client)
        .iter()
        .filter(|line| **line == clear)
        .count();

    // Focus-out advances activity but only removes `focused` at an unchanged size.
    hub.feed(
        client,
        "%subscription-changed w0 $0 @0 0 - : laptop.2.200x50.attached,UTF-8;ignored.1.70x25.attached,ignore-size,UTF-8;|/tmp\n",
    );
    // A client with ignore-size can arrive, change activity, or leave without acting
    // on the size tmux calculates for this window.
    hub.feed(
        client,
        "%subscription-changed w0 $0 @0 0 - : laptop.2.200x50.attached,UTF-8;ignored.2.70x25.attached,ignore-size,UTF-8;|/tmp\n",
    );
    hub.feed(
        client,
        "%subscription-changed w0 $0 @0 0 - : laptop.2.200x50.attached,UTF-8;|/tmp\n",
    );
    hub.settle();
    let clears = hub
        .lines(client)
        .iter()
        .filter(|line| **line == clear)
        .count();
    assert_eq!(clears, initial_clears);
}

#[test]
fn an_unclaimed_rewatch_and_nonclaiming_requests_do_not_vote() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    let client = hub.client(0);
    hub.take(conn);

    hub.send(conn, json!({"type":"unwatch","data":{"watch":1}}));
    hub.settle();
    let claims_before = hub
        .lines(client)
        .iter()
        .filter(|line| **line == take_vote(0, 80, 24))
        .count();
    hub.send(conn, json!({"type":"watch","data":{"watch":2,"session":{"server":SERVER_NAME,"session":0},"size":{"cols":120,"rows":40},"claim":false}}));
    hub.settle();
    assert_eq!(
        hub.lines(client)
            .iter()
            .filter(|line| **line == vote(0, 120, 40))
            .count(),
        0,
        "an automatic re-watch does not claim"
    );
    let before = hub.lines(client).len();
    hub.send(conn, json!({"type":"resync","data":{"watch":2}}));
    hub.send(
        conn,
        json!({"type":"history","data":{"req":3,"watch":2,"start":-1,"end":0}}),
    );
    hub.settle();
    assert_eq!(
        hub.lines(client)
            .iter()
            .filter(|line| **line == vote(0, 120, 40))
            .count(),
        0
    );
    assert!(hub.lines(client).len() > before);
    assert!(claims_before > 0);
}

#[test]
fn leaving_the_claiming_watch_clears_its_vote_but_keeps_other_watches() {
    let mut hub = Hub::new();
    let (claiming, other) = (hub.connect(), hub.connect());
    hub.watch_sized(claiming, 1, 0, 100, 30);
    hub.settle();
    hub.take(claiming);
    hub.send(
        other,
        json!({"type":"watch","data":{"watch":2,"session":{"server":SERVER_NAME,"session":0},"size":{"cols":140,"rows":45},"claim":false}}),
    );
    hub.settle();
    hub.take(other);
    let client = hub.client(0);

    hub.send(claiming, json!({"type":"unwatch","data":{"watch":1}}));
    hub.settle();
    assert!(hub.lines(client).contains(&line_for(Op::ClearVote {
        window: WindowId(0),
    })));
    assert!(!hub.lines(client).contains(&release(0)));
    hub.output(client, 0, "still watched");
    assert_eq!(
        hub.take(other),
        [Got::Output(2, Bytes::from_static(b"still watched"))]
    );
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
fn a_swap_reported_by_the_current_window_subscription_is_followed() {
    let mut hub = Hub::new();
    hub.add_window(1, 0, 1);
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    let owner = hub.client(0);
    hub.take(conn);
    // The initial value confirms @0; the later subscription change reports the swap to @1.
    hub.feed(owner, "%subscription-changed c $0 - - - : @0\n");
    hub.current_windows.insert(0, 1);
    hub.feed(owner, "%subscription-changed c $0 - - - : @1\n");
    hub.settle();
    let got = hub.take(conn);
    let [Got::Json(watching), snapshot] = &got[..] else {
        panic!("{got:?}");
    };
    assert_eq!(kind(watching), "watching");
    assert_eq!(watching["data"]["session"]["session"], 0);
    assert_eq!(watching["data"]["window"]["id"], 1);
    assert_eq!(*snapshot, Got::Snapshot(1, size(80, 24)));
    // The same owner now counts only the newly shown pane.
    hub.output(owner, 0, "stale");
    hub.output(owner, 1, "live");
    assert_eq!(
        hub.take(conn),
        [Got::Output(1, Bytes::from_static(b"live"))]
    );
    assert!(hub.lines(owner).contains(&release(0)));
    assert!(hub.lines(owner).contains(&line_for(Op::Unsubscribe {
        window: WindowId(0)
    })));
    assert!(!hub.clients[&owner].closed);

    hub.send(
        conn,
        json!({"type":"input","data":{"watch":1,"window":1,"items":[{"text":"x"}]}}),
    );
    assert!(
        hub.lines(owner).contains(&take_vote(1, 80, 24)),
        "a new current window has no applied vote"
    );
}

#[test]
fn an_owner_moved_by_session_destruction_closes_the_gone_session() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    let old = hub.client(0);
    hub.take(conn);
    // With detach-on-destroy off tmux moves the owner and names its new session.
    hub.sessions.clear();
    hub.windows.clear();
    hub.current_windows.clear();
    hub.feed(old, "%session-changed $1\n");
    hub.exited(old);
    hub.settle();
    let got = hub.take(conn);
    assert_eq!(
        got,
        [Got::Json(json!({
            "type": "sessionClosed",
            "data": {"session": {"server": SERVER_NAME, "session": 0}}
        }))]
    );
    assert!(
        hub.clients.values().all(|client| client.closed),
        "the dead session is not rehomed"
    );
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
    hub.watch_sized(conn, 1, 0, 100, 30);
    hub.settle();
    hub.take(conn);
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
    assert!(hub.lines(second).contains(&take_vote(0, 100, 30)));
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
        json!({"type": "input", "data": {"watch": 1, "window": 0, "items": [{"text": "x"}]}}),
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
    assert_eq!(kinds(&hub.take_json(conn)), ["sessionClosed"]);
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

    // A current-window notification triggers Locate; an empty result closes only that
    // session's watches.
    hub.windows.remove(&0).expect("the watched fake window");
    hub.sessions.remove(&0);
    hub.current_windows.remove(&0);
    hub.feed(reporter, "%session-window-changed $0 @9\n");
    hub.settle();
    assert_eq!(
        hub.take(reporter_conn),
        [Got::Json(
            json!({"type": "sessionClosed", "data": {"session": {"server": SERVER_NAME, "session": 0}}})
        )]
    );
    assert_eq!(
        hub.take(other_conn),
        [Got::Json(
            json!({"type": "sessionClosed", "data": {"session": {"server": SERVER_NAME, "session": 0}}})
        )]
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
    let non_owner = hub.client(0);
    let other = hub.connect();
    hub.take(conn);
    // A ready client can check the session, but its Locate cannot bind the view.
    hub.watch(other, 1, 1);
    let answer = hub.reply_bytes(non_owner).expect("a session check Locate");
    assert!(answer.contains("\t%1\t"));
    hub.feed(non_owner, &answer);
    assert!(
        hub.take(other).is_empty(),
        "the view is not bound by the checker"
    );

    // The owner starts and performs the binding Locate itself.
    let locate = line_for(Op::Locate {
        session: tether::tmux::SessionId(1),
    });
    hub.settle_until(|line| line == locate);
    let owner = hub.client(1);
    hub.window(1).pane = 9;
    let answer = hub.reply_bytes(owner).expect("the owner's Locate");
    assert!(answer.contains("\t%9\t"));
    hub.feed(owner, &answer);
    hub.settle();
    let watching = hub.take_json(other);
    assert_eq!(kinds(&watching), ["watching"]);
    assert_eq!(watching[0]["data"]["pane"], 9);
}

#[test]
fn output_past_the_credit_starves_one_watch_until_a_spaced_snapshot() {
    let mut hub = Hub::new();
    hub.add_window(1, 1, 1);
    let conn = hub.connect();
    hub.open(conn, 1, 0);
    hub.open(conn, 2, 1);
    let (client, second_owner) = (hub.client(0), hub.client(1));
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
    hub.output(second_owner, 1, "y");
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
    hub.output(second_owner, 1, "z");
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
    hub.take_json(conn);
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
    hub.add_window(1, 1, 1);
    hub.add_window(2, 2, 2);
    // One watch per connection, so credit never holds a capture back.
    let (conn, one, two) = (hub.connect(), hub.connect(), hub.connect());
    hub.open(conn, 1, 0);
    hub.open(one, 1, 1);
    hub.open(two, 1, 2);
    hub.take(conn);
    let clients = [hub.client(0), hub.client(1), hub.client(2)];
    let snapshots = [snapshot(0), snapshot(1), snapshot(2)];
    let continues = |hub: &Hub| {
        clients
            .iter()
            .flat_map(|client| hub.lines(*client))
            .filter(|line| snapshots.contains(line))
            .count()
    };
    let resync_both = |hub: &mut Hub| {
        hub.send(one, json!({"type": "resync", "data": {"watch": 1}}));
        hub.send(two, json!({"type": "resync", "data": {"watch": 1}}));
    };
    let before = continues(&hub);
    // A snapshot of %0 goes out; the tab closes before it lands.
    hub.send(conn, json!({"type": "resync", "data": {"watch": 1}}));
    hub.send(conn, json!({"type": "unwatch", "data": {"watch": 1}}));
    assert!(hub.lines(clients[0]).ends_with(&let_go_of_window_0()));
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
            json!({"type": "input", "data": {"watch": 1, "window": 0, "items": [{"text": "x"}]}}),
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
    let before_paste = hub.lines(client).len();
    let paste_file = hub.paste_file("/run/over-limit");
    hub.input(Input::Conn(
        conn,
        FromConn::Paste {
            req: 77,
            watch: 1,
            window: 0,
            enter: true,
            file: paste_file,
        },
    ));
    assert_eq!(
        hub.lines(client).len(),
        before_paste,
        "refused paste sent no tmux commands"
    );
    assert_eq!(hub.removed.last(), Some(&PathBuf::from("/run/over-limit")));
    assert_eq!(
        hub.take_json(conn),
        [
            json!({"type":"error","data":{"req":77,"watch":1,"code":"busy","message":"tmux is busy"}})
        ]
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
        "tether on devbox allows 3 tmux sessions at a time; open now: session0, session1, session2"
    );
    assert_eq!(ended[0]["data"]["reason"], "limit");
    // Once one lingers, it makes room.
    hub.send(b, json!({"type": "unwatch", "data": {"watch": 1}}));
    hub.settle();
    hub.open(b, 3, 3);
    assert!(kinds(&hub.take_json(b)).contains(&"watching"));
    // Input over 4 KiB is refused, and the watch stays.
    let text = "q".repeat(4097);
    hub.send(
        a,
        json!({"type": "input", "data": {"watch": 1, "window": 0, "items": [{"text": text}]}}),
    );
    let refused = hub.take_json(a);
    assert_eq!(
        refused.last().map(|value| value["data"]["code"].clone()),
        Some(json!("inputTooLarge"))
    );
}

#[test]
fn low_budget_limit_names_the_sessions_holding_the_slot() {
    let cap = budget::TIERS[2].caps;
    assert_eq!(cap.control_clients, 1);

    let mut hub = Hub::new_with_max_clients(cap.control_clients);
    hub.add_window(1, 1, 1);
    hub.add_window(2, 2, 2);
    hub.window(1).session_name = "work".to_owned();
    let conn = hub.connect();
    hub.open(conn, 1, 1);
    hub.take_json(conn);

    hub.open(conn, 2, 2);
    let ended = hub.take_json(conn);
    assert_eq!(kinds(&ended), ["watchEnded"]);
    assert_eq!(ended[0]["data"]["reason"], "limit");
    assert_eq!(
        ended[0]["data"]["message"],
        "tether on devbox allows 1 tmux session at a time; open now: work"
    );
}

#[test]
fn every_paste_path_removes_its_file_and_answers_req_once() {
    let mut hub = Hub::new();
    let conn = hub.connect();
    // Before `watching`: busy.
    hub.watch(conn, 1, 0);
    let file = hub.paste_file("/run/early");
    hub.input(Input::Conn(
        conn,
        FromConn::Paste {
            req: 11,
            watch: 1,
            window: 0,
            enter: true,
            file,
        },
    ));
    assert_eq!(hub.removed, [PathBuf::from("/run/early")]);
    assert_eq!(
        hub.take_json(conn),
        [
            json!({"type":"error","data":{"req":11,"watch":1,"code":"busy","message":"the session isn't connected yet"}})
        ]
    );
    hub.settle(); // the watch is now bound
    hub.take_json(conn);
    let client = hub.client(0);

    // A tmux client can yield the watch; a successful paste reclaims it.
    hub.feed(
        client,
        "%subscription-changed w0 $0 @0 0 - : laptop.1.200x50.attached,focused,UTF-8;|/tmp\n",
    );
    hub.take_json(conn);
    hub.feed(
        client,
        "%subscription-changed w0 $0 @0 0 - : laptop.2.200x50.attached,focused,UTF-8;|/tmp\n",
    );
    hub.settle();
    let vote_line = take_vote(0, 80, 24);
    let votes_before_paste = hub
        .lines(client)
        .iter()
        .filter(|line| **line == vote_line)
        .count();

    // Successful paste and Enter receive one confirmation.
    let file = hub.paste_file("/run/ok");
    hub.input(Input::Conn(
        conn,
        FromConn::Paste {
            req: 12,
            watch: 1,
            window: 0,
            enter: true,
            file,
        },
    ));
    assert_eq!(hub.removed.len(), 1);
    let lines = hub.lines(client);
    let take_at = lines
        .iter()
        .position(|line| *line == vote_line)
        .expect("claim vote");
    let paste_at = lines
        .iter()
        .rposition(|line| line.contains("paste-buffer -p"))
        .expect("paste group");
    assert!(
        take_at < paste_at,
        "the take-and-vote group precedes the paste group"
    );
    hub.settle();
    assert_eq!(
        hub.take_json(conn),
        [json!({"type":"pasted","data":{"req":12,"watch":1}})]
    );
    assert_eq!(
        hub.lines(client)
            .iter()
            .filter(|line| **line == vote_line)
            .count(),
        votes_before_paste + 1,
        "paste claims the window again"
    );
    assert_eq!(hub.removed.last(), Some(&PathBuf::from("/run/ok")));

    // A tmux failure is uncertain, but still carries the originating request.
    hub.windows.remove(&0);
    let file = hub.paste_file("/run/tmux-error");
    hub.input(Input::Conn(
        conn,
        FromConn::Paste {
            req: 13,
            watch: 1,
            window: 0,
            enter: true,
            file,
        },
    ));
    hub.settle();
    assert_eq!(
        hub.take_json(conn),
        [
            json!({"type":"error","data":{"req":13,"watch":1,"code":"tmux","message":"tmux: can't find window: @0"}})
        ]
    );

    // Unknown watches are refused and their paste file is released.
    let file = hub.paste_file("/run/unknown");
    hub.input(Input::Conn(
        conn,
        FromConn::Paste {
            req: 14,
            watch: 9,
            window: 9,
            enter: true,
            file,
        },
    ));
    assert_eq!(
        hub.take_json(conn),
        [
            json!({"type":"error","data":{"req":14,"watch":9,"code":"badRequest","message":"no such watch"}})
        ]
    );

    // A control client that exits before the reply gets the uncertain-send answer;
    // the paste is never moved to its replacement client.
    let file = hub.paste_file("/run/lost");
    hub.input(Input::Conn(
        conn,
        FromConn::Paste {
            req: 15,
            watch: 1,
            window: 0,
            enter: true,
            file,
        },
    ));
    let client = hub.client(0);
    hub.exited(client);
    assert_eq!(
        hub.take_json(conn),
        [
            json!({"type":"error","data":{"req":15,"watch":1,"code":"tmux","message":"tmux stopped answering before confirming the paste; it may have been sent"}})
        ]
    );
    assert_eq!(hub.removed.last(), Some(&PathBuf::from("/run/lost")));
    hub.input(Input::Conn(conn, FromConn::Closed));
    let file = hub.paste_file("/run/closed");
    hub.input(Input::Conn(
        conn,
        FromConn::Paste {
            req: 16,
            watch: 1,
            window: 0,
            enter: true,
            file,
        },
    ));
    assert_eq!(
        hub.removed[2..],
        [
            PathBuf::from("/run/tmux-error"),
            PathBuf::from("/run/unknown"),
            PathBuf::from("/run/lost"),
            PathBuf::from("/run/closed")
        ]
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
    let rename = proto::ServerMsg::SessionsChanged;
    let charge = rename.encode().len().max(64) as u64;
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
    // Only the bell poll is waiting on time (§4.8).
    assert!(
        hub.state
            .next_deadline()
            .is_none_or(|at| at > hub.now + SNAPSHOT_SPACING)
    );
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
