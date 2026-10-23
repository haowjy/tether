//! The snapshot list's replies, typed, and the restore bytes composed from them
//! (daemon-core.md §3.5).

use std::io::Write as _;

use bytes::Bytes;

use super::parse::decode_octal;
use super::wrap::{self, WrapMap};
use super::{PaneId, Size, TmuxError};

/// `<STATE>` for tmux 3.4, tab-separated. Newer versions use the newest entry; add
/// one when a version needs other fields. Any-event mouse tracking (`?1003`) is
/// `mouse_all_flag`: tmux's `mouse_any_flag` means "some mouse mode is on".
pub const STATE_FORMAT: &str = "#{pane_id}\t#{pane_width}\t#{pane_height}\t#{alternate_on}\t\
#{alternate_saved_x}\t#{alternate_saved_y}\t#{cursor_x}\t#{cursor_y}\t#{cursor_flag}\t\
#{insert_flag}\t#{keypad_cursor_flag}\t#{keypad_flag}\t#{wrap_flag}\t#{origin_flag}\t\
#{scroll_region_upper}\t#{scroll_region_lower}\t#{mouse_standard_flag}\t\
#{mouse_button_flag}\t#{mouse_all_flag}\t#{mouse_utf8_flag}\t#{mouse_sgr_flag}\t#{pane_tabs}";

/// A pane's terminal state from `STATE_FORMAT`, with tmux's names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaneState {
    pub pane: PaneId,
    pub size: Size,
    pub alternate_on: bool,
    /// `u32::MAX` while no alternate screen was ever entered.
    pub alternate_saved_x: u32,
    pub alternate_saved_y: u32,
    pub cursor_x: u32,
    pub cursor_y: u32,
    pub cursor_flag: bool,
    pub insert_flag: bool,
    pub keypad_cursor_flag: bool,
    pub keypad_flag: bool,
    pub wrap_flag: bool,
    pub origin_flag: bool,
    pub scroll_region_upper: u32,
    pub scroll_region_lower: u32,
    pub mouse_standard_flag: bool,
    pub mouse_button_flag: bool,
    pub mouse_all_flag: bool,
    pub mouse_utf8_flag: bool,
    pub mouse_sgr_flag: bool,
    /// Tab stop columns.
    pub pane_tabs: Vec<u32>,
}

/// One snapshot, as tmux answered it: the input to restore-byte composition.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaneSnapshot {
    pub state: PaneState,
    /// The screen in use (`-e -N`), one entry per row, SGR carried across rows.
    pub active: Vec<Bytes>,
    /// The active grid's paired capture map; it is consumed only while composing restore.
    pub(crate) active_wraps: WrapMap,
    /// The bytes tmux's parser holds from an unfinished sequence (`-P -C`, decoded).
    pub pending: Bytes,
    /// The saved primary grid while `alternate_on` (`-a`); meaningless otherwise.
    pub saved: Vec<Bytes>,
}

/// Restore bytes: written to a freshly reset terminal of the snapshot's size, they
/// rebuild the pane's screens, cursor, modes, scroll region and tab stops, then leave
/// the parser where tmux's was, so the live output after the snapshot's boundary
/// continues from here. A fresh terminal has every mode off, so only what is on is
/// switched on.
///
/// What tmux 3.4 doesn't report is not restored: the current SGR pen, a pending wrap
/// (a cursor past the last column is clamped), the cursor shape, character sets,
/// bracketed paste, focus reporting and the title.
pub fn compose(snapshot: &PaneSnapshot) -> Bytes {
    let state = &snapshot.state;
    let (cols, rows) = (u32::from(state.size.cols), u32::from(state.size.rows));
    let (last_col, last_row) = (cols.saturating_sub(1), rows.saturating_sub(1));
    let mut out = Vec::new();

    // A too-wide line (the saved primary grid keeps its old size while the alternate
    // screen is on, and Unicode widths drift) must not wrap and scroll the screen.
    out.extend_from_slice(b"\x1b[?7l");
    if state.alternate_on {
        paint(&mut out, &snapshot.saved, rows, None);
        // `?1049h` saves the pen with the cursor, and the primary's pen is unknown.
        out.extend_from_slice(b"\x1b[0m");
        // `u32::MAX` after `?47h` or `?1047h`, which save no cursor: a corner.
        cup(
            &mut out,
            state.alternate_saved_y.min(last_row),
            state.alternate_saved_x.min(last_col),
        );
        out.extend_from_slice(b"\x1b[?1049h");
    }
    paint(
        &mut out,
        &snapshot.active,
        rows,
        Some(&snapshot.active_wraps),
    );
    out.extend_from_slice(b"\x1b[0m");

    out.extend_from_slice(b"\x1b[3g");
    for tab in state.pane_tabs.iter().filter(|tab| **tab < cols) {
        cup(&mut out, 0, *tab); // `ESC H` sets a stop at the cursor's column
        out.extend_from_slice(b"\x1bH");
    }
    let region = (state.scroll_region_upper, state.scroll_region_lower);
    let (top, bottom) = if region.0 < region.1 && region.1 < rows {
        region
    } else {
        (0, last_row)
    };
    if (top, bottom) != (0, last_row) {
        write!(out, "\x1b[{};{}r", top + 1, bottom + 1).expect("write to a Vec");
    }
    let mut cursor_y = state.cursor_y.min(last_row);
    if state.origin_flag {
        out.extend_from_slice(b"\x1b[?6h");
        // Rows count from the region's top; a cursor outside it can't be addressed.
        cursor_y = cursor_y.clamp(top, bottom) - top;
    }

    let modes: [(bool, &[u8]); 9] = [
        (state.wrap_flag, b"\x1b[?7h"),
        (state.keypad_cursor_flag, b"\x1b[?1h"),
        (state.keypad_flag, b"\x1b="),
        (state.insert_flag, b"\x1b[4h"),
        (state.mouse_standard_flag, b"\x1b[?1000h"),
        (state.mouse_button_flag, b"\x1b[?1002h"),
        (state.mouse_all_flag, b"\x1b[?1003h"),
        // xterm.js keeps one encoding, the last set, and tmux prefers SGR to UTF-8.
        (state.mouse_utf8_flag, b"\x1b[?1005h"),
        (state.mouse_sgr_flag, b"\x1b[?1006h"),
    ];
    for (_, sequence) in modes.iter().filter(|(on, _)| *on) {
        out.extend_from_slice(sequence);
    }
    cup(&mut out, cursor_y, state.cursor_x.min(last_col));
    if !state.cursor_flag {
        out.extend_from_slice(b"\x1b[?25l");
    }
    out.extend_from_slice(&snapshot.pending);
    Bytes::from(out)
}

/// Each captured row at its line. `-e` carries the SGR state from row to row, so
/// nothing resets between them; an empty row has nothing to draw.
fn paint(out: &mut Vec<u8>, captured: &[Bytes], rows: u32, wraps: Option<&WrapMap>) {
    for (line, row) in (0..rows).zip(captured).filter(|(_, row)| !row.is_empty()) {
        let character = first_character(row);
        let continuation = line > 0
            && wraps.is_some_and(|map| map.wraps(line as usize - 1))
            && character.is_some();
        if let Some((prefix_end, character_end)) = character.filter(|_| continuation) {
            out.extend_from_slice(&row[..prefix_end]);
            out.extend_from_slice(b"\x1b[?7h");
            out.extend_from_slice(&row[prefix_end..character_end]);
            out.extend_from_slice(b"\x1b[?7l");
            out.extend_from_slice(&row[character_end..]);
        } else {
            cup(out, line, 0);
            out.extend_from_slice(row);
        }
    }
}

/// The first printable UTF-8 scalar after a row's leading CSI/OSC styling.
fn first_character(row: &[u8]) -> Option<(usize, usize)> {
    let mut at = 0;
    while at < row.len() {
        match row[at] {
            0x1b if row.get(at + 1) == Some(&b'[') => {
                let tail = row.get(at + 2..)?;
                let final_byte = tail.iter().position(|byte| (0x40..=0x7e).contains(byte))?;
                at += final_byte + 3;
            }
            0x1b if row.get(at + 1) == Some(&b']') => {
                let tail = row.get(at + 2..)?;
                let end = tail.iter().enumerate().find_map(|(index, byte)| {
                    (*byte == 0x07
                        || tail
                            .get(index..index + 2)
                            .is_some_and(|sequence| sequence == b"\x1b\\"))
                    .then_some(index + if *byte == 0x07 { 1 } else { 2 })
                })?;
                at += end + 2;
            }
            0x1b => {
                let tail = row.get(at + 1..)?;
                let mut end = 0;
                while tail
                    .get(end)
                    .is_some_and(|byte| (0x20..=0x2f).contains(byte))
                {
                    end += 1;
                }
                at += end + 2;
            }
            byte if byte < 0x20 || byte == 0x7f => at += 1,
            _ => {
                let width = std::str::from_utf8(&row[at..])
                    .ok()?
                    .chars()
                    .next()?
                    .len_utf8();
                return Some((at, at + width));
            }
        }
    }
    None
}

/// CUP to a zero-based row and column.
fn cup(out: &mut Vec<u8>, row: u32, col: u32) {
    write!(out, "\x1b[{};{}H", row + 1, col + 1).expect("write to a Vec");
}

/// A reply body, one entry per line, without line ends.
pub(crate) type Rows = Vec<Bytes>;

/// Replies of a completed snapshot list: continue, state, active, the active wrap pair,
/// pending, saved, and the state again. A state that changed between its two reads
/// means a hook changed the pane mid-list, and the captures may match neither: `Torn`.
pub(crate) fn from_replies(replies: Vec<Rows>) -> Result<PaneSnapshot, TmuxError> {
    let Ok(
        [
            _continue,
            state,
            active,
            physical,
            logical,
            pending,
            saved,
            state_after,
        ],
    ) = <[Rows; 8]>::try_from(replies)
    else {
        return Err(TmuxError::BadReply);
    };
    if state != state_after {
        return Err(TmuxError::Torn);
    }
    let state = state.first().and_then(|line| parse_state(line));
    let pending = pending.first().map(|line| decode_octal(line));
    let active_wraps = if active.len() == physical.len() {
        wrap::align(&physical, &logical)
    } else {
        WrapMap::empty(active.len())
    };
    Ok(PaneSnapshot {
        state: state.ok_or(TmuxError::BadReply)?,
        active,
        active_wraps,
        pending: pending.unwrap_or_default(),
        saved,
    })
}

/// Whether a failed snapshot list failed because its pane is gone: tmux expands the
/// state with every pane field empty rather than failing.
pub(crate) fn pane_gone(replies: &[Rows]) -> bool {
    let state = replies.get(1).and_then(|rows| rows.first());
    state.is_some_and(|line| line.first().is_none_or(|byte| *byte == b'\t'))
}

fn parse_state(line: &[u8]) -> Option<PaneState> {
    let line = std::str::from_utf8(line).ok()?;
    let mut fields = line.split('\t');
    let mut next = || fields.next();
    let number = |field: Option<&str>| field?.parse::<u32>().ok();
    let flag = |field: Option<&str>| match field? {
        "0" => Some(false),
        "1" => Some(true),
        _ => None,
    };
    let pane = PaneId::parse(next()?.as_bytes())?;
    let cols = u16::try_from(number(next())?).ok()?;
    let rows = u16::try_from(number(next())?).ok()?;
    let state = PaneState {
        pane,
        size: Size { cols, rows },
        alternate_on: flag(next())?,
        alternate_saved_x: number(next())?,
        alternate_saved_y: number(next())?,
        cursor_x: number(next())?,
        cursor_y: number(next())?,
        cursor_flag: flag(next())?,
        insert_flag: flag(next())?,
        keypad_cursor_flag: flag(next())?,
        keypad_flag: flag(next())?,
        wrap_flag: flag(next())?,
        origin_flag: flag(next())?,
        scroll_region_upper: number(next())?,
        scroll_region_lower: number(next())?,
        mouse_standard_flag: flag(next())?,
        mouse_button_flag: flag(next())?,
        mouse_all_flag: flag(next())?,
        mouse_utf8_flag: flag(next())?,
        mouse_sgr_flag: flag(next())?,
        pane_tabs: match next()? {
            "" => Vec::new(),
            tabs => tabs
                .split(',')
                .map(|tab| tab.parse().ok())
                .collect::<Option<_>>()?,
        },
    };
    next().is_none().then_some(state)
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use vt100::{MouseProtocolEncoding as Encoding, MouseProtocolMode as Mouse};

    use super::*;
    use crate::tmux::parse::{Line, Parser};

    /// The snapshot lists in a recorded stream, as tmux answered them.
    fn recorded(name: &str) -> Vec<PaneSnapshot> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/tmux/3.4")
            .join(format!("{name}.out"));
        let mut lines = Vec::new();
        Parser::default().push(&std::fs::read(path).expect("read fixture"), &mut lines);
        let mut replies: Vec<Rows> = Vec::new();
        let mut ours = false;
        for line in lines {
            match line {
                Line::Begin { flag } => {
                    ours = flag == 1;
                    if ours {
                        replies.push(Rows::new());
                    }
                }
                Line::Body(row) if ours => replies.last_mut().expect("open reply").push(row),
                _ => {}
            }
        }
        // A list is eight replies, the second a state; the eighth is one too, so step
        // past each list found.
        let mut snapshots = Vec::new();
        let mut at = 0;
        while let Some(list) = replies.get(at..at + 8) {
            if list[1]
                .first()
                .is_some_and(|row| parse_state(row).is_some())
            {
                snapshots.push(from_replies(list.to_vec()).expect("a snapshot list"));
                at += 8;
            } else {
                at += 1;
            }
        }
        snapshots
    }

    fn blank(size: Size) -> vt100::Parser {
        let nonzero = |n| std::num::NonZeroU16::new(n).expect("a pane has size");
        vt100::Parser::new(nonzero(size.rows), nonzero(size.cols), 0)
    }

    fn rows_of(term: &vt100::Parser, size: Size) -> Vec<String> {
        term.screen().rows_formatted(0, size.cols).collect()
    }

    /// What tmux's capture shows: its rows drawn on a clean screen.
    fn drawn(rows: &[Bytes], size: Size) -> vt100::Parser {
        let mut term = blank(size);
        term.process(&rows.join(&b"\r\n"[..]));
        term
    }

    /// Restore bytes rebuild what tmux reported about the pane, on the screen in use
    /// and, through `?1049l`, on the primary screen behind an alternate one.
    #[test]
    fn restore_bytes_rebuild_the_screens_cursor_and_modes_tmux_reported() {
        let mut checked = 0;
        for name in [
            "snapshot-alternate",
            "snapshot-styled",
            "snapshot-region",
            "snapshot-tui",
        ] {
            for snapshot in recorded(name) {
                let (state, size) = (&snapshot.state, snapshot.state.size);
                let mut term = blank(size);
                term.process(&compose(&snapshot));
                let screen = term.screen();
                let label = format!("{name} cursor {},{}", state.cursor_x, state.cursor_y);

                assert_eq!(
                    rows_of(&term, size),
                    rows_of(&drawn(&snapshot.active, size), size),
                    "{label}: screen"
                );
                assert_eq!(
                    screen.cursor_position(),
                    (state.cursor_y as u16, state.cursor_x as u16),
                    "{label}: cursor"
                );
                assert_eq!(screen.hide_cursor(), !state.cursor_flag, "{label}");
                assert_eq!(screen.alternate_screen(), state.alternate_on, "{label}");
                assert_eq!(
                    screen.application_cursor(),
                    state.keypad_cursor_flag,
                    "{label}"
                );
                assert_eq!(screen.application_keypad(), state.keypad_flag, "{label}");
                let mouse = match (
                    state.mouse_all_flag,
                    state.mouse_button_flag,
                    state.mouse_standard_flag,
                ) {
                    (true, _, _) => Mouse::AnyMotion,
                    (_, true, _) => Mouse::ButtonMotion,
                    (_, _, true) => Mouse::PressRelease,
                    _ => Mouse::None,
                };
                assert_eq!(screen.mouse_protocol_mode(), mouse, "{label}");
                let encoding = match (state.mouse_sgr_flag, state.mouse_utf8_flag) {
                    (true, _) => Encoding::Sgr,
                    (_, true) => Encoding::Utf8,
                    _ => Encoding::Default,
                };
                assert_eq!(screen.mouse_protocol_encoding(), encoding, "{label}");

                if state.alternate_on {
                    term.process(b"\x1b[?1049l");
                    let behind = (
                        state.alternate_saved_y as u16,
                        state.alternate_saved_x as u16,
                    );
                    assert_eq!(
                        rows_of(&term, size),
                        rows_of(&drawn(&snapshot.saved, size), size),
                        "{label}: primary"
                    );
                    assert_eq!(
                        term.screen().cursor_position(),
                        behind,
                        "{label}: primary cursor"
                    );
                }
                checked += 1;
            }
        }
        assert_eq!(checked, 6);
    }

    /// The oracle has no insert mode, wrap flag or tab stops: check their bytes.
    #[test]
    fn insert_wrap_and_tab_stops_reach_the_restore_bytes() {
        let restore = |state: &str| {
            let state = parse_state(state.as_bytes()).expect("a state line");
            compose(&PaneSnapshot {
                state,
                active: vec![],
                active_wraps: WrapMap::empty(0),
                pending: Bytes::new(),
                saved: vec![],
            })
        };
        let has = |restore: &Bytes, sequence: &str| {
            restore
                .windows(sequence.len())
                .any(|window| window == sequence.as_bytes())
        };
        let plain = restore(
            "%0\t80\t24\t0\t4294967295\t4294967295\t0\t0\t1\t0\t0\t0\t0\t0\t0\t23\t0\t0\t0\t0\t0\t8,16",
        );
        assert!(!has(&plain, "\x1b[4h") && !has(&plain, "\x1b[?7h"));
        assert!(has(&plain, "\x1b[3g\x1b[1;9H\x1bH\x1b[1;17H\x1bH"));

        let busy = restore(
            "%0\t80\t24\t0\t4294967295\t4294967295\t0\t0\t1\t1\t0\t0\t1\t0\t0\t23\t0\t0\t0\t0\t0\t4",
        );
        assert!(has(&busy, "\x1b[4h") && has(&busy, "\x1b[?7h"));
        assert!(has(&busy, "\x1b[3g\x1b[1;5H\x1bH"), "only the custom stop");
        assert!(!has(&busy, "\x1b[1;9H"));
    }
}
