//! The snapshot list's replies, typed (daemon-core.md §3.5). Turning them into
//! restore bytes (`compose`) is the composer's job and lives here too.

use bytes::Bytes;

use super::parse::decode_octal;
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
    /// The bytes tmux's parser holds from an unfinished sequence (`-P -C`, decoded).
    pub pending: Bytes,
    /// The saved primary grid while `alternate_on` (`-a`); meaningless otherwise.
    pub saved: Vec<Bytes>,
}

/// A reply body, one entry per line, without line ends.
pub(crate) type Rows = Vec<Bytes>;

/// Replies of a completed snapshot list: continue, state, active, pending, saved.
pub(crate) fn from_replies(replies: Vec<Rows>) -> Result<PaneSnapshot, TmuxError> {
    let Ok([_continue, state, active, pending, saved]) = <[Rows; 5]>::try_from(replies) else {
        return Err(TmuxError::BadReply);
    };
    let state = state.first().and_then(|line| parse_state(line));
    let pending = pending.first().map(|line| decode_octal(line));
    Ok(PaneSnapshot {
        state: state.ok_or(TmuxError::BadReply)?,
        active,
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
