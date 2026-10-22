//! `tmux::Session` against recorded tmux 3.4 streams (daemon-core.md §8). Each fixture
//! is replayed with its requests at their recorded offsets, in 1-byte and seeded
//! random chunks: the session must write exactly the recorded lines (or tmux's replies
//! would belong to other groups) and report the same events however bytes arrive.
//! Re-record with `examples/record-tmux-fixtures.rs`; regenerate the `.events`
//! goldens with `UPDATE_TMUX_EVENT_GOLDENS=1`.

#[path = "support/script.rs"]
mod script;

use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};

use bytes::Bytes;
use rand::{Rng, SeedableRng, rngs::StdRng};
use tether::tmux::{
    Event, Found, Location, MAX_IN_FLIGHT, PaneId, Reply, Session, SessionId, SessionLocation,
    Size, Tag, TmuxError, WindowId,
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

/// The fixtures the targeted tests read; every version's are replayed below.
fn fixture_dir() -> PathBuf {
    fixtures().join("3.4")
}

fn replay(name: &str, chunk: impl FnMut(usize) -> usize) -> Replay {
    replay_in(&fixture_dir(), name, chunk)
}

fn replay_in(dir: &Path, name: &str, mut chunk: impl FnMut(usize) -> usize) -> Replay {
    let out = fs::read(dir.join(format!("{name}.out"))).expect("read .out");
    let script = fs::read_to_string(dir.join(format!("{name}.script"))).expect("read .script");
    let (session, step) = Session::new();
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
    let update = std::env::var_os("UPDATE_TMUX_EVENT_GOLDENS").is_some();
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

        let rendered = render(&one_byte.events);
        let golden = out.with_extension("events");
        if update {
            fs::write(&golden, rendered).expect("write golden");
        } else {
            let expected = fs::read_to_string(&golden).expect("read .events golden");
            assert_eq!(rendered, expected, "{label}: events golden");
        }
    }
}

#[test]
fn startup_sets_the_client_size_from_the_current_window_before_ready() {
    let replay = whole("startup");
    assert_eq!(replay.lines[1], "refresh-client -C 80x24");
    let ready = replay.events.first().expect("an event");
    assert!(
        matches!(ready, Event::Ready { version, .. } if version.to_string() == "3.4"),
        "{ready:?}"
    );
    // Ready only once the client-size reply is in: feed everything but its `%end`.
    let out = fs::read(fixture_dir().join("startup.out")).expect("read startup.out");
    let end = (0..out.len())
        .filter(|at| out[*at..].starts_with(b"%end "))
        .nth(2)
        .expect("attach, startup and client-size replies");
    let (mut session, _) = Session::new();
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

/// Output before the `Snapshot` event is inside it, output after is not: the numbered
/// lines continue from the capture's last row without a gap or a repeat.
#[test]
fn a_snapshot_sits_at_its_boundary_in_the_output_stream() {
    let replay = whole("snapshot-boundary");
    let (index, snapshot) = replay
        .events
        .iter()
        .enumerate()
        .filter_map(|(index, event)| match event {
            Event::Snapshot {
                tag: Tag(2),
                snapshot,
                ..
            } => Some((index, snapshot)),
            _ => None,
        })
        .next()
        .expect("second snapshot");
    let mut after = Vec::new();
    for event in &replay.events[index + 1..] {
        if let Event::Output { bytes, .. } = event {
            after.extend_from_slice(bytes);
        }
    }
    let rows = snapshot
        .active
        .iter()
        .map(|row| String::from_utf8_lossy(row).trim_end().to_owned())
        .collect::<Vec<_>>();
    let cursor_row = snapshot.state.cursor_y as usize;
    let mut text = String::new();
    for row in &rows[..cursor_row] {
        text.push_str(row);
        text.push('\n');
    }
    // The cursor row may hold a line the pane was half-way through printing.
    text.push_str(&rows[cursor_row]);
    text.push_str(&String::from_utf8_lossy(&after).replace("\r\n", "\n"));
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

#[test]
fn snapshot_replies_arrive_typed() {
    let replay = whole("snapshot-alternate");
    let snapshot = replay
        .events
        .iter()
        .find_map(|event| match event {
            Event::Snapshot { snapshot, .. } => Some(snapshot),
            _ => None,
        })
        .expect("a snapshot");
    let state = &snapshot.state;
    assert_eq!(state.pane, PaneId(0));
    assert_eq!(state.size, Size { cols: 80, rows: 24 });
    assert!(state.alternate_on && state.keypad_cursor_flag && state.keypad_flag);
    assert!(state.insert_flag && state.mouse_standard_flag && state.mouse_sgr_flag);
    assert!(!state.mouse_all_flag && !state.mouse_button_flag && !state.origin_flag);
    assert_eq!(
        (state.scroll_region_upper, state.scroll_region_lower),
        (2, 19)
    );
    assert_eq!(state.pane_tabs[..3], [8, 16, 24]);
    assert_eq!(snapshot.pending, Bytes::from_static(b"\x1b[3"));
    assert_eq!(snapshot.active.len(), 24);
    assert_eq!(snapshot.active[1].trim_ascii_end(), b"  ALT");
    assert!(snapshot.saved.iter().any(|row| row.starts_with(b"PRIMARY")));
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
    let unlinked = replay
        .events
        .iter()
        .filter(|event| {
            **event
                == Event::WindowUnlinked {
                    window: WindowId(2),
                }
        })
        .count();
    assert_eq!(unlinked, 3, "moved out, moved in, killed");
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
    assert_eq!(cwds, ["/tmp", "/"]);

    for name in ["detach", "kill-server", "startup"] {
        assert!(whole(name).session.exit_seen(), "{name}");
    }
}

#[test]
fn locate_reads_the_window_and_the_server_instance() {
    let replay = whole("locate");
    let location = |tag| match done(&replay, tag) {
        Ok(Reply::Location(location)) => location.clone(),
        other => panic!("tag {tag}: {other:?}"),
    };
    let Location { server, found } = location(1);
    assert_eq!(
        found,
        Some(Found {
            session: SessionId(0),
            pane: PaneId(0),
            size: Size { cols: 80, rows: 24 }
        })
    );
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
    assert_eq!(
        location(4).found.map(|found| found.session),
        Some(SessionId(1)),
        "moved"
    );
    assert_eq!(
        done(&replay, 5),
        &Ok(Reply::SessionLocation(SessionLocation {
            server,
            exists: true
        }))
    );
    assert_eq!(
        done(&replay, 6),
        &Ok(Reply::SessionLocation(SessionLocation {
            server,
            exists: false
        }))
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
        find(&output, b" 61 62 02 1b 78 c3 a9 0a").is_some(),
        "C-b and Escape by name"
    );
    let c0 = (0u8..32).chain([b'\\', 0x80, 0xff]).collect::<Vec<_>>();
    assert!(
        find(&output, &c0).is_some(),
        "every C0 byte, a backslash, invalid UTF-8"
    );

    let replay = whole("history");
    let Ok(Reply::History(rows)) = done(&replay, 1) else {
        panic!("history rows");
    };
    for row in [
        &b"%begin 123 456 1"[..],
        b"%output %1 fake",
        b"%end 123 456 1",
        b"last",
    ] {
        assert!(rows.iter().any(|captured| captured == row), "{row:?}");
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

/// One line per event; a run of output from one pane is one line.
fn render(events: &[Event]) -> String {
    let mut text = String::new();
    let mut run: Option<(PaneId, usize, usize)> = None;
    for event in events {
        if let Event::Output { pane, bytes } = event {
            run = match run {
                Some((run_pane, count, len)) if run_pane == *pane => {
                    Some((run_pane, count + 1, len + bytes.len()))
                }
                other => {
                    flush(&mut text, other);
                    Some((*pane, 1, bytes.len()))
                }
            };
            continue;
        }
        flush(&mut text, run.take());
        let line = match event {
            Event::Ready { server, version } => format!("ready server={server} version={version}"),
            Event::Output { .. } => unreachable!(),
            Event::Snapshot {
                tag,
                pane,
                snapshot,
            } => {
                let state = &snapshot.state;
                format!(
                    "snapshot tag={} {pane} {}x{} alt={} cursor={},{} rows={} pending={:?} saved={}",
                    tag.0,
                    state.size.cols,
                    state.size.rows,
                    u8::from(state.alternate_on),
                    state.cursor_x,
                    state.cursor_y,
                    snapshot.active.len(),
                    String::from_utf8_lossy(&snapshot.pending),
                    snapshot.saved.len(),
                )
            }
            Event::Done { tag, result } => {
                let result = match result {
                    Ok(Reply::Ok) => "ok".to_owned(),
                    Ok(Reply::Location(Location { server, found })) => match found {
                        Some(found) => format!(
                            "location {server} {} {} {}x{}",
                            found.session, found.pane, found.size.cols, found.size.rows
                        ),
                        None => format!("location {server} gone"),
                    },
                    Ok(Reply::SessionLocation(location)) => {
                        format!("session {} exists={}", location.server, location.exists)
                    }
                    Ok(Reply::History(rows)) => format!("history rows={}", rows.len()),
                    Err(error) => format!("error {error:?}"),
                };
                format!("done tag={} {result}", tag.0)
            }
            Event::Gap { pane } => format!("gap {pane}"),
            Event::Layout { window, panes } => {
                let mut line = format!("layout {window}");
                for (pane, size) in panes {
                    let _ = write!(line, " {pane}:{}x{}", size.cols, size.rows);
                }
                line
            }
            Event::ActivePane { window, pane } => format!("active-pane {window} {pane}"),
            Event::WindowUnlinked { window } => format!("window-unlinked {window}"),
            Event::WindowRenamed { window, name } => format!("window-renamed {window} {name:?}"),
            Event::SessionsChanged => "sessions-changed".to_owned(),
            Event::Cwd { window, path } => format!("cwd {window} {path:?}"),
            Event::Fatal(error) => format!("fatal {error:?}"),
        };
        text.push_str(&line);
        text.push('\n');
    }
    flush(&mut text, run);
    text
}

fn flush(text: &mut String, run: Option<(PaneId, usize, usize)>) {
    if let Some((pane, count, len)) = run {
        let _ = writeln!(text, "output {pane} events={count} bytes={len}");
    }
}
