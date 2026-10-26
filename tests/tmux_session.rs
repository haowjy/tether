//! `tmux::Session` against recorded tmux streams (daemon-core.md §8). Each fixture is
//! replayed with its requests at their recorded offsets, in 1-byte and seeded random
//! chunks: the session must write exactly the recorded lines (or tmux's replies would
//! belong to other groups) and report the same events however bytes arrive.
//! Re-record with `examples/record-tmux-fixtures.rs` when tmux command output changes.

#[path = "support/script.rs"]
mod script;
#[path = "support/terminal.rs"]
mod terminal;

use terminal::{look, terminal};

use std::path::{Path, PathBuf};
use std::{env, fs};

use bytes::Bytes;
use rand::{Rng, SeedableRng, rngs::StdRng};
use tether::tmux::{
    Event, Found, Location, MAX_IN_FLIGHT, PaneId, Reply, Session, SessionId, Size, Tag, TmuxError,
    WindowId,
};

const SEEDS: [u64; 4] = [0x5445_5448_4552, 0x1984_0314, 0xdead_beef, 0x3437];

struct Replay {
    session: Session,
    events: Vec<Event>,
    lines: Vec<String>,
    max_in_flight: usize,
}

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/tmux")
}

fn fixture_version() -> String {
    env::var("TETHER_TMUX_FIXTURE_VERSION").unwrap_or_else(|_| "3.4".into())
}

/// The fixtures the targeted tests read; every version's are replayed below.
fn fixture_dir() -> PathBuf {
    fixtures().join(fixture_version())
}

fn replay(name: &str, chunk: impl FnMut(usize) -> usize) -> Replay {
    replay_in(&fixture_dir(), name, chunk)
}

fn replay_in(dir: &Path, name: &str, mut chunk: impl FnMut(usize) -> usize) -> Replay {
    let out = fs::read(dir.join(format!("{name}.out"))).expect("read .out");
    let script = fs::read_to_string(dir.join(format!("{name}.script"))).expect("read .script");
    let (session, step) = Session::new(SessionId(0));
    let mut replay = Replay {
        session,
        events: step.events,
        lines: step.lines,
        max_in_flight: 0,
    };
    let mut fed = 0;
    let mut feed_to = |replay: &mut Replay, end: usize| {
        while fed < end {
            let size = chunk(end - fed).clamp(1, end - fed);
            let step = replay.session.feed(&out[fed..fed + size]);
            replay.events.extend(step.events);
            replay.lines.extend(step.lines);
            replay.max_in_flight = replay.max_in_flight.max(replay.session.in_flight());
            fed += size;
        }
    };
    for request in script.lines().map(script::decode) {
        feed_to(&mut replay, request.offset);
        let step = replay.session.request(request.tag, request.op);
        replay.events.extend(step.events);
        replay.lines.extend(step.lines);
        replay.max_in_flight = replay.max_in_flight.max(replay.session.in_flight());
    }
    feed_to(&mut replay, out.len());
    replay
}

fn whole(name: &str) -> Replay {
    replay(name, |left| left)
}

#[test]
fn every_fixture_replays_the_same_for_any_chunking() {
    let mut outs = fs::read_dir(fixtures())
        .expect("read fixture directory")
        .flat_map(|version| fs::read_dir(version.expect("version entry").path()).expect("read"))
        .map(|entry| entry.expect("fixture entry").path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "out"))
        .collect::<Vec<_>>();
    outs.sort();
    assert!(outs.len() > 10, "fixtures missing");
    for out in outs {
        let dir = out.parent().expect("fixture directory");
        let name = out.file_stem().expect("fixture name").to_string_lossy();
        let label = out.display();
        let expected_lines = fs::read_to_string(out.with_extension("in"))
            .expect("read .in")
            .lines()
            .map(str::to_owned)
            .collect::<Vec<_>>();
        let one_byte = replay_in(dir, &name, |_| 1);
        assert_eq!(one_byte.lines, expected_lines, "{label}: lines written");
        assert!(one_byte.max_in_flight <= MAX_IN_FLIGHT, "{label}: over cap");
        for seed in SEEDS {
            let mut rng = StdRng::seed_from_u64(seed);
            let chunked = replay_in(dir, &name, |left| rng.random_range(1..=left.min(257)));
            assert_eq!(chunked.lines, expected_lines, "{label} seed {seed}: lines");
            assert_eq!(
                chunked.events, one_byte.events,
                "{label} seed {seed}: events"
            );
        }
        let whole = replay_in(dir, &name, |left| left);
        assert_eq!(whole.events, one_byte.events, "{label}: one chunk");
    }
}

#[test]
fn startup_sets_the_client_size_from_the_current_window_before_ready() {
    let replay = whole("startup");
    assert_eq!(replay.lines[1], "refresh-client -C 80x24");
    let ready = replay.events.first().expect("an event");
    let expected_version = fixture_version();
    assert!(
        matches!(ready, Event::Ready { version, .. } if version.to_string() == expected_version),
        "{ready:?}"
    );
    // Ready only once the client-size reply is in: feed everything but its `%end`.
    let out = fs::read(fixture_dir().join("startup.out")).expect("read startup.out");
    let end = (0..out.len())
        .filter(|at| out[*at..].starts_with(b"%end "))
        .nth(2)
        .expect("attach, startup and client-size replies");
    let (mut session, _) = Session::new(SessionId(0));
    let step = session.feed(&out[..end]);
    assert!(
        !step
            .events
            .iter()
            .any(|event| matches!(event, Event::Ready { .. }))
    );
    assert_eq!(step.lines, ["refresh-client -C 80x24"]);
    assert!(matches!(
        session.feed(&out[end..]).events[..],
        [Event::Ready { .. }, ..]
    ));
}

#[test]
fn unwanted_panes_are_paused_once_on_first_output_including_new_ones() {
    let replay = whole("unwanted-output");
    assert!(
        !replay
            .events
            .iter()
            .any(|event| matches!(event, Event::Output { .. }))
    );
    assert_eq!(
        replay.lines[2..],
        [
            "refresh-client -A '%0:pause'",
            "refresh-client -A '%1:pause'"
        ]
    );
}

#[test]
fn a_pause_beyond_the_in_flight_cap_waits_for_a_reply() {
    let replay = whole("pause-at-cap");
    assert_eq!(replay.max_in_flight, MAX_IN_FLIGHT);
    let pause = replay
        .lines
        .iter()
        .position(|line| line.contains(":pause'"));
    assert_eq!(pause, Some(2 + MAX_IN_FLIGHT), "{:?}", replay.lines);
    let locations = replay
        .events
        .iter()
        .filter(|event| {
            matches!(
                event,
                Event::Done {
                    result: Ok(Reply::Location(_)),
                    ..
                }
            )
        })
        .count();
    assert_eq!(locations, MAX_IN_FLIGHT);
}

/// The restore bytes of the snapshot events in `replay`, and the pane output between
/// each event and the next.
fn restores_with_output(replay: &Replay) -> Vec<(Size, &Bytes, Vec<u8>)> {
    let mut found: Vec<(Size, &Bytes, Vec<u8>)> = Vec::new();
    for event in &replay.events {
        match event {
            Event::Snapshot { size, restore, .. } => found.push((*size, restore, Vec::new())),
            Event::Output { bytes, .. } => {
                if let Some((_, _, after)) = found.last_mut() {
                    after.extend_from_slice(bytes);
                }
            }
            _ => {}
        }
    }
    found
}

/// Output before the `Snapshot` event is inside it, output after is not: the numbered
/// lines continue from the restored screen's last row without a gap or a repeat.
#[test]
fn a_snapshot_sits_at_its_boundary_in_the_output_stream() {
    let replay = whole("snapshot-boundary");
    let (size, restore, after) = &restores_with_output(&replay)[1];
    let mut restored = terminal(*size);
    restored.process(restore);
    let rows = restored
        .screen()
        .rows(0, size.cols)
        .map(|row| row.trim_end().to_owned())
        .collect::<Vec<_>>();
    let cursor_row = usize::from(restored.screen().cursor_position().0);
    let mut text = String::new();
    for row in &rows[..cursor_row] {
        text.push_str(row);
        text.push('\n');
    }
    // The cursor row may hold a line the pane was half-way through printing.
    text.push_str(&rows[cursor_row]);
    text.push_str(&String::from_utf8_lossy(after).replace("\r\n", "\n"));
    let numbers = text
        .lines()
        .filter_map(|line| line.strip_prefix('L')?.parse::<u32>().ok())
        .collect::<Vec<_>>();
    assert!(
        numbers.len() > 100,
        "too few numbered lines: {}",
        numbers.len()
    );
    let first = numbers[0];
    assert_eq!(
        numbers,
        (first..first + numbers.len() as u32).collect::<Vec<_>>(),
        "numbered lines skip or repeat at the boundary"
    );
    assert_eq!(numbers.last(), Some(&3000));
}

/// The restore promise end to end: a terminal restored from one snapshot and fed the
/// pane's output up to the next ends as a terminal restored from that next snapshot,
/// including through a scroll region, origin mode and the alternate screen.
#[test]
fn live_output_after_a_restore_ends_where_the_next_restore_begins() {
    for name in ["snapshot-boundary", "snapshot-region", "snapshot-tui"] {
        let replay = whole(name);
        let snapshots = restores_with_output(&replay);
        assert_eq!(snapshots.len(), 2, "{name}");
        let (size, restore, live) = &snapshots[0];
        assert!(!live.is_empty(), "{name}: no output between the snapshots");
        let mut continued = terminal(*size);
        continued.process(restore);
        continued.process(live);
        let mut next = terminal(*size);
        next.process(snapshots[1].1);
        assert_eq!(look(&continued, *size), look(&next, *size), "{name}");
    }
}

#[test]
fn a_snapshot_event_carries_the_pane_size_and_restore_bytes_ending_in_the_pending_ones() {
    let replay = whole("snapshot-alternate");
    let snapshots = restores_with_output(&replay);
    let [(size, restore, _)] = &snapshots[..] else {
        panic!("one snapshot: {}", snapshots.len());
    };
    assert_eq!(*size, Size { cols: 80, rows: 24 });
    assert!(restore.starts_with(b"\x1b[?7l"));
    assert!(
        restore.ends_with(b"\x1b[3"),
        "the unfinished sequence tmux holds"
    );
    assert_eq!(replay.session.wanted().count(), 0, "released");
}

#[test]
fn failures_name_their_cause() {
    let replay = whole("snapshot-gone");
    assert_eq!(done(&replay, 1), &Err(TmuxError::PaneGone));
    assert_eq!(
        done(&replay, 2),
        &Err(TmuxError::Command("can't find pane: %99".into()))
    );
    assert_eq!(replay.session.wanted().count(), 0);

    let replay = whole("paste");
    assert_eq!(done(&replay, 2), &Ok(Reply::Ok));
    assert_eq!(
        done(&replay, 3),
        &Err(TmuxError::Command("no buffer tether-3".into()))
    );
    assert_eq!(
        done(&replay, 4),
        &Err(TmuxError::Command("can't find window: @99".into()))
    );

    let replay = whole("input");
    assert_eq!(
        done(&replay, 5),
        &Err(TmuxError::BadRequest("unknown key name"))
    );
    assert!(!replay.lines.iter().any(|line| line.contains("S-Enter")));
}

/// Whichever command of a paste failed, its buffer is deleted in a group of its own:
/// commands after a failure in a list never run.
#[test]
fn a_failed_paste_deletes_its_buffer() {
    let replay = whole("paste");
    assert_eq!(
        done(&replay, 5),
        &Err(TmuxError::Command("can't find window: @0".into())),
        "a hook killed the window between load-buffer and paste-buffer"
    );
    let deleted = replay
        .lines
        .iter()
        .filter_map(|line| line.strip_prefix("delete-buffer -b "))
        .collect::<Vec<_>>();
    assert_eq!(deleted, ["tether-3", "tether-4", "tether-5"]);
}

/// A hook that resizes the window after the state read changes the pane without
/// printing: the state read at the end differs, so the list goes again, and the
/// snapshot has the size tmux captured at.
#[test]
fn a_snapshot_whose_state_changed_mid_list_is_sent_again() {
    let replay = whole("snapshot-resized");
    let sends = replay
        .lines
        .iter()
        .filter(|line| line.starts_with("refresh-client -A '%0:continue'"))
        .count();
    assert_eq!(sends, 2);
    let snapshots = restores_with_output(&replay);
    let [(size, _, _)] = &snapshots[..] else {
        panic!("one snapshot: {}", snapshots.len());
    };
    assert_eq!(
        *size,
        Size {
            cols: 100,
            rows: 30
        }
    );
}

/// A Release made while a snapshot of its pane is in flight invalidates it: the
/// snapshot answers `Released`, before the Release, and no `continue` follows the
/// Release's pause, so the pane stays paused.
#[test]
fn a_torn_snapshot_released_before_its_reply_is_not_sent_again() {
    let replay = whole("snapshot-released");
    let answers: Vec<&Event> = replay
        .events
        .iter()
        .filter(|event| {
            matches!(
                event,
                Event::Done {
                    tag: Tag(1 | 2),
                    ..
                } | Event::Snapshot { tag: Tag(1), .. }
            )
        })
        .collect();
    assert_eq!(
        answers,
        [
            &Event::Done {
                tag: Tag(1),
                result: Err(TmuxError::Released)
            },
            &Event::Done {
                tag: Tag(2),
                result: Ok(Reply::Ok)
            },
        ]
    );
    let release = replay
        .lines
        .iter()
        .rposition(|line| line == "refresh-client -A '%0:pause'")
        .expect("the release's pause");
    assert!(
        !replay.lines[release..]
            .iter()
            .any(|line| line.contains(":continue'")),
        "{:?}",
        replay.lines
    );
}

/// A hook that doesn't wait leaves the list whole; one that waits lets output in
/// mid-list, and the list is sent three times before failing.
#[test]
fn snapshots_torn_by_a_waiting_hook_are_retried_then_fail() {
    let replay = whole("hooks");
    assert!(matches!(
        replay
            .events
            .iter()
            .find(|event| matches!(event, Event::Snapshot { .. } | Event::Done { .. })),
        Some(Event::Snapshot { tag: Tag(1), .. })
    ));
    assert_eq!(done(&replay, 2), &Err(TmuxError::Torn));
    let sends = replay
        .lines
        .iter()
        .filter(|line| line.starts_with("refresh-client -A '%0:continue'"))
        .count();
    assert_eq!(sends, 1 + 3);
}

#[test]
fn tmux_pausing_a_wanted_pane_is_a_gap_and_the_next_snapshot_resumes_it() {
    let replay = whole("gap");
    let gap = replay
        .events
        .iter()
        .position(|event| *event == Event::Gap { pane: PaneId(0) })
        .expect("a gap");
    assert!(
        replay.events[gap..]
            .iter()
            .any(|event| matches!(event, Event::Snapshot { tag: Tag(2), .. }))
    );
}

#[test]
fn notifications_become_events() {
    let replay = whole("layout");
    let layouts = replay
        .events
        .iter()
        .filter_map(|event| match event {
            Event::Layout {
                window: WindowId(0),
                panes,
                ..
            } => Some(panes.clone()),
            _ => None,
        })
        .collect::<Vec<_>>();
    let size = |cols, rows| Size { cols, rows };
    assert!(layouts.contains(&vec![(PaneId(0), size(60, 20))]), "vote");
    assert!(layouts.contains(&vec![(PaneId(1), size(60, 20))]), "zoomed");
    assert_eq!(
        layouts.last(),
        Some(&vec![(PaneId(0), size(80, 12)), (PaneId(1), size(80, 11))]),
        "vote cleared"
    );
    assert!(replay.events.contains(&Event::ActivePane {
        window: WindowId(0),
        pane: PaneId(1)
    }));

    let replay = whole("windows");
    assert!(replay.events.contains(&Event::WindowRenamed {
        window: WindowId(2),
        name: "name with spaces #x".into()
    }));
    assert!(replay.events.contains(&Event::SessionsChanged));

    let replay = whole("subscription");
    let cwds = replay
        .events
        .iter()
        .filter_map(|event| match event {
            Event::Cwd {
                window: WindowId(0),
                path,
            } => Some(path.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(cwds, ["/private/tmp", "/"]);
    let acts = replay
        .events
        .iter()
        .filter(|event| {
            matches!(
                event,
                Event::Acted {
                    window: WindowId(0)
                }
            )
        })
        .count();
    assert_eq!(acts, 4, "arrival, typing, returning and resizing are acts");

    for name in ["detach", "kill-server", "startup"] {
        assert!(whole(name).events.contains(&Event::Exit), "{name}");
    }
}

#[test]
fn locate_reads_the_session_current_window_and_server_instance() {
    let replay = whole("locate");
    let location = |tag| match done(&replay, tag) {
        Ok(Reply::Location(location)) => location.clone(),
        other => panic!("tag {tag}: {other:?}"),
    };
    let Location { server, found } = location(1);
    assert!(matches!(
        found,
        Some(Found {
            session: SessionId(0),
            window: WindowId(0),
            index: 0,
            pane: PaneId(0),
            size: Size { cols: 80, rows: 24 },
            window_size: Size { cols: 80, rows: 24 },
            session_name,
            ..
        }) if session_name == "fixture"
    ));
    assert_eq!(
        location(2).found.map(|found| found.session),
        Some(SessionId(1))
    );
    assert_eq!(
        location(3),
        Location {
            server,
            found: None
        },
        "killed"
    );
}

#[test]
fn input_and_history_carry_bytes_unchanged() {
    let replay = whole("input");
    let output = replay
        .events
        .iter()
        .filter_map(|event| match event {
            Event::Output { bytes, .. } => Some(&bytes[..]),
            _ => None,
        })
        .collect::<Vec<_>>()
        .concat();
    assert!(
        find(&output, b"6162021b78c3a90a").is_some(),
        "C-b and Escape by name"
    );
    let c0 = (0u8..32).chain([b'\\', 0x80, 0xff]).collect::<Vec<_>>();
    assert!(
        find(&output, &c0).is_some(),
        "every C0 byte, a backslash, invalid UTF-8"
    );

    let replay = whole("history");
    let Ok(Reply::History(history)) = done(&replay, 1) else {
        panic!("history rows");
    };
    for row in [
        &b"%begin 123 456 1"[..],
        b"%output %1 fake",
        b"%end 123 456 1",
        b"last",
    ] {
        assert!(
            history.rows.iter().any(|captured| captured == row),
            "{row:?}"
        );
    }
}

fn done(replay: &Replay, tag: u64) -> &Result<Reply, TmuxError> {
    replay
        .events
        .iter()
        .find_map(|event| match event {
            Event::Done { tag: done, result } if *done == Tag(tag) => Some(result),
            _ => None,
        })
        .unwrap_or_else(|| panic!("no Done for tag {tag}"))
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}
