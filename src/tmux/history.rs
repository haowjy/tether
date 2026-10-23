//! History capture replies and tmux's `-S`/`-E` clamp (daemon-core.md §3.4).

use bytes::Bytes;

use super::snapshot::Rows;
use super::wrap::{self, WrapMap};
use super::{History, TmuxError};

/// The history bounds surrounding one capture group.
pub(crate) const STATE_FORMAT: &str = "#{history_size} #{pane_height}";

/// Replays tmux's clamp so rows have their real line numbers. A line below the
/// retained history is an empty range even though tmux itself returns its top row.
pub(crate) fn from_replies(
    requested_start: i32,
    requested_end: i32,
    replies: Vec<Rows>,
) -> Result<History, TmuxError> {
    let Ok([before, rows, logical, after]) = <[Rows; 4]>::try_from(replies) else {
        return Err(TmuxError::BadReply);
    };
    if before != after {
        return Err(TmuxError::Torn);
    }
    if requested_end < requested_start {
        return Err(TmuxError::BadRequest("history end is before its start"));
    }

    let (history_size, pane_height) = before.first().and_then(bounds).ok_or(TmuxError::BadReply)?;
    let first = requested_start.max(history_top(history_size));
    let bottom = pane_bottom(pane_height);
    let last = requested_end.min(bottom);
    if first > last {
        return Ok(History {
            start: first,
            history_size,
            rows: Vec::new(),
            wraps: Bytes::new(),
        });
    }

    let count = inclusive_count(first, last);
    if rows.len() < count {
        return Err(TmuxError::BadReply);
    }
    let pair_last = requested_end.saturating_add(1).min(bottom);
    let pair_count = inclusive_count(first, pair_last);
    let pair_map = if rows.len() == pair_count {
        wrap::align(&rows, &logical)
    } else {
        WrapMap::empty(pair_count)
    };
    Ok(History {
        start: first,
        history_size,
        rows: rows.into_iter().take(count).collect(),
        wraps: pair_map.truncate(count).into_bytes(),
    })
}

fn bounds(row: &Bytes) -> Option<(u32, u32)> {
    let text = std::str::from_utf8(row).ok()?;
    let mut fields = text.split_whitespace();
    let history_size = fields.next()?.parse().ok()?;
    let pane_height = fields.next()?.parse().ok()?;
    fields
        .next()
        .is_none()
        .then_some((history_size, pane_height))
}

fn history_top(history_size: u32) -> i32 {
    (-i64::from(history_size)).max(i64::from(i32::MIN)) as i32
}

fn pane_bottom(pane_height: u32) -> i32 {
    i32::try_from(pane_height.saturating_sub(1)).unwrap_or(i32::MAX)
}

fn inclusive_count(first: i32, last: i32) -> usize {
    usize::try_from(i64::from(last) - i64::from(first) + 1).expect("an ordered history range")
}
