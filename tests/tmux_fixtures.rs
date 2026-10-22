use std::fs;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};

use bytes::Bytes;
use rand::{Rng, SeedableRng, rngs::StdRng};
use tether::tmux::correlate::{CorrelatedLine, Correlator, Group};
use tether::tmux::parse::{Line, NotificationKind, Parser};

const SEEDS: [u64; 4] = [0x5445_5448_4552, 0x1984_0314, 0xdead_beef, 0x3_4_3_7];

// Regenerate the readable `.events` files with UPDATE_TMUX_EVENT_GOLDENS=1.
#[test]
fn recorded_tmux_streams_match_event_goldens_for_chunk_boundaries() {
    let fixture_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/tmux/3.4");
    let update = std::env::var_os("UPDATE_TMUX_EVENT_GOLDENS").is_some();
    let mut fixtures = fs::read_dir(&fixture_dir)
        .expect("read recorded tmux fixture directory")
        .map(|entry| entry.expect("read fixture entry").path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "out"))
        .collect::<Vec<_>>();
    fixtures.sort();
    assert!(!fixtures.is_empty(), "no recorded tmux .out fixtures found");

    for fixture in fixtures {
        let input = fs::read(&fixture).expect("read tmux fixture");
        let actual = correlate_with_chunks(&fixture, &input, |_| 1);
        if update {
            fs::write(event_path(&fixture), &actual).expect("write event golden");
        } else {
            let expected = fs::read_to_string(event_path(&fixture)).unwrap_or_else(|error| {
                panic!("read event golden for {}: {error}", fixture.display())
            });
            assert_eq!(actual, expected, "one-byte chunks: {}", fixture.display());
        }

        for seed in SEEDS {
            let mut rng = StdRng::seed_from_u64(seed);
            let chunks = correlate_with_chunks(&fixture, &input, |remaining| {
                rng.random_range(1..=remaining.min(257))
            });
            if update {
                assert_eq!(chunks, actual, "seed {seed} changed parsed output");
            } else {
                assert_eq!(chunks, actual, "seed {seed}: {}", fixture.display());
            }
        }
    }
}

#[test]
fn output_fixture_contains_every_c0_byte_backslashes_and_invalid_utf8() {
    let fixture =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/tmux/3.4/output-c0.out");
    let input = fs::read(fixture).expect("read C0 output fixture");
    let events = parse_events(&input, |_| input.len());
    let mut output = Vec::new();
    for event in events {
        if let Line::Output { data, .. } = event {
            output.extend_from_slice(&data);
        }
    }
    assert!(contains(&output, &(0u8..=31).collect::<Vec<_>>()));
    assert!(contains(&output, b"\\\\"));
    assert!(contains(&output, &[0x80, 0xff]));
}

#[test]
fn capture_fixture_keeps_percent_prefixed_body_lines_as_body() {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/tmux/3.4/capture-percent-lines.out");
    let input = fs::read(fixture).expect("read capture fixture");
    let events = parse_events(&input, |_| input.len());
    let found = events.iter().any(|event| {
        matches!(event, Line::Block(block) if block.body_lines().any(|line| line.starts_with(b"%output ")))
    });
    assert!(
        found,
        "capture reply did not retain a percent-prefixed body line"
    );
}

#[test]
fn pause_and_continue_from_3_4_are_reply_body_lines() {
    let fixture =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/tmux/3.4/pause-continue.out");
    let input = fs::read(fixture).expect("read pause/continue fixture");
    let events = parse_events(&input, |_| input.len());
    let body_lines = events
        .iter()
        .filter_map(|event| match event {
            Line::Block(block) => Some(block.body_lines().collect::<Vec<_>>()),
            _ => None,
        })
        .flatten()
        .collect::<Vec<_>>();
    assert!(body_lines.contains(&b"%pause %0".as_slice()));
    assert!(body_lines.contains(&b"%continue %0".as_slice()));
    assert!(!events.iter().any(|event| {
        matches!(event, Line::Notification(notification) if matches!(notification.kind, NotificationKind::Pause | NotificationKind::Continue))
    }));
}

#[test]
fn subscription_fixture_pins_the_tmux_3_4_notification_shape() {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/tmux/3.4/subscription-changed.out");
    let input = fs::read(fixture).expect("read subscription fixture");
    let events = parse_events(&input, |_| input.len());
    assert!(events.iter().any(|event| {
        matches!(event, Line::Notification(notification)
            if notification.kind == NotificationKind::SubscriptionChanged
                && notification.args == b"fixture-sub $0 - - - : fixture-subscribed"[..])
    }));
}

fn correlate_with_chunks(
    fixture: &Path,
    input: &[u8],
    mut next_size: impl FnMut(usize) -> usize,
) -> String {
    let events = parse_events(input, &mut next_size);
    correlate_events(fixture, events)
}

fn parse_events(input: &[u8], mut next_size: impl FnMut(usize) -> usize) -> Vec<Line> {
    let mut parser = Parser::default();
    let mut events = Vec::new();
    let mut offset = 0;
    while offset < input.len() {
        let count = next_size(input.len() - offset);
        let end = (offset + count).min(input.len());
        parser
            .push(&input[offset..end], &mut events)
            .unwrap_or_else(|error| panic!("parse fixture failed: {error}"));
        offset = end;
    }
    events
}

fn event_path(out: &Path) -> PathBuf {
    out.with_extension("events")
}

fn correlate_events(fixture: &Path, events: Vec<Line>) -> String {
    let scenario = fixture
        .file_stem()
        .and_then(|stem| stem.to_str())
        .expect("fixture filename is UTF-8");
    let input_path = fixture.with_extension("in");
    let script = fs::read_to_string(&input_path)
        .unwrap_or_else(|error| panic!("read scenario input {}: {error}", input_path.display()));
    let expected_replies = expected_reply_counts(scenario);
    let commands = script
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>();
    assert_eq!(
        commands.len(),
        expected_replies.len(),
        "fixture command groups: {}",
        fixture.display()
    );

    let mut correlator = Correlator::default();
    for (tag, (line, replies)) in commands.iter().zip(expected_replies).enumerate() {
        let expected_replies = NonZeroUsize::new(*replies).expect("reply count is positive");
        correlator.submit(Group {
            tag: tag as u64,
            line: Bytes::copy_from_slice(line.as_bytes()),
            expected_replies,
        });
    }

    let mut correlated = Vec::new();
    for event in events {
        correlator
            .push(event, &mut correlated)
            .unwrap_or_else(|error| panic!("correlate fixture {}: {error}", fixture.display()));
    }
    let done_tags = correlated
        .iter()
        .filter_map(|event| match event {
            CorrelatedLine::GroupDone(done) => Some(done.tag),
            CorrelatedLine::Line(_) => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        done_tags,
        (0..commands.len() as u64).collect::<Vec<_>>(),
        "fixture did not complete all command groups: {}",
        fixture.display()
    );
    render_events(&correlated)
}

fn expected_reply_counts(scenario: &str) -> &'static [usize] {
    match scenario {
        "attach-startup" | "kill-server" => &[],
        "capture-percent-lines" | "output-c0" | "yes-flood" => &[1, 2],
        "error-middle" => &[3],
        "error-start" | "pause-continue" | "subscription-changed" => &[2, 2],
        "hook-flag0" => &[3, 2],
        "window-add-rename-close" => &[2, 2, 2],
        "layout-split" | "session-rename" => &[2],
        other => panic!("missing reply counts for fixture scenario {other}"),
    }
}

fn render_events(events: &[CorrelatedLine]) -> String {
    let mut rendered = String::new();
    for event in events {
        match event {
            CorrelatedLine::Line(Line::Block(_)) => {
                panic!("correlator passed a reply block through")
            }
            CorrelatedLine::Line(Line::Output { pane, data }) => rendered.push_str(&format!(
                "output pane={} bytes={}\n",
                escape_bytes(pane),
                data.len()
            )),
            CorrelatedLine::Line(Line::Notification(notification)) => rendered.push_str(&format!(
                "notification {} args={}\n",
                notification_name(notification.kind),
                escape_bytes(&notification.args)
            )),
            CorrelatedLine::Line(Line::Unknown(bytes)) => {
                rendered.push_str(&format!("unknown bytes={}\n", bytes.len()))
            }
            CorrelatedLine::GroupDone(done) => match &done.result {
                Ok(replies) => {
                    let lengths = replies
                        .iter()
                        .map(|reply| reply.len().to_string())
                        .collect::<Vec<_>>()
                        .join(",");
                    rendered.push_str(&format!("group tag={} end replies=[{lengths}]\n", done.tag));
                }
                Err(error) => {
                    let lengths = error
                        .replies
                        .iter()
                        .map(|reply| reply.len().to_string())
                        .collect::<Vec<_>>()
                        .join(",");
                    rendered.push_str(&format!(
                        "group tag={} error replies=[{lengths}] body={}\n",
                        done.tag,
                        error.body.len()
                    ));
                }
            },
        }
    }
    rendered
}

fn notification_name(kind: NotificationKind) -> &'static str {
    match kind {
        NotificationKind::Pause => "pause",
        NotificationKind::Continue => "continue",
        NotificationKind::LayoutChange => "layout-change",
        NotificationKind::WindowClose => "window-close",
        NotificationKind::UnlinkedWindowClose => "unlinked-window-close",
        NotificationKind::WindowRenamed => "window-renamed",
        NotificationKind::UnlinkedWindowRenamed => "unlinked-window-renamed",
        NotificationKind::WindowPaneChanged => "window-pane-changed",
        NotificationKind::SessionRenamed => "session-renamed",
        NotificationKind::SessionsChanged => "sessions-changed",
        NotificationKind::SessionChanged => "session-changed",
        NotificationKind::SubscriptionChanged => "subscription-changed",
        NotificationKind::Exit => "exit",
    }
}

fn escape_bytes(bytes: &[u8]) -> String {
    let mut escaped = String::new();
    for byte in bytes {
        match byte {
            b'"' => escaped.push_str("\\\""),
            b'\\' => escaped.push_str("\\\\"),
            0x20..=0x7e => escaped.push(char::from(*byte)),
            _ => escaped.push_str(&format!("\\x{byte:02x}")),
        }
    }
    format!("\"{escaped}\"")
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}
