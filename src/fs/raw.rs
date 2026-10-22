//! `GET /fs/raw` (fs.md): one range at most, a strong ETag (`files::Stamp::etag`) from
//! the `fstat` at open, and a producer that `pread`s 64 KiB chunks into a channel of
//! one, so a response holds at most a chunk or two however slow its reader.

use std::fs::File;
use std::io;
use std::os::unix::fs::FileExt as _;
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use tokio::sync::mpsc::error::SendTimeoutError;
use tokio::sync::{OwnedSemaphorePermit, mpsc};
use tracing::debug;

use super::Opened;
use crate::blocking::Lane;

/// One `pread`, and one body chunk.
pub const CHUNK: u64 = 64 * 1024;
/// A response whose socket hasn't taken a chunk for this long is aborted.
const STALL: Duration = Duration::from_secs(30);
/// Files over this have their pages dropped as they are read: a streamed video
/// mustn't fill the unit's page cache. Smaller files keep theirs, which a build may be
/// using.
const DROP_PAGES_OVER: u64 = 8 << 20;

/// Which bytes of the file to send.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Span {
    /// `200`: no usable `Range`, or `If-Range` didn't match.
    Whole,
    /// `206`: `start..=end`.
    Part { start: u64, end: u64 },
    /// `416`: the range starts at or past the end.
    Unsatisfiable,
}

/// `Range`, unless `If-Range` names another version of the file.
pub fn span(range: Option<&str>, if_range: Option<&str>, etag: &str, size: u64) -> Span {
    match range {
        Some(_) if if_range.is_some_and(|tag| tag.trim() != etag) => Span::Whole,
        Some(range) => parse_range(range, size),
        None => Span::Whole,
    }
}

/// One range, `bytes=a-b`, `bytes=a-` or `bytes=-n`. A list, or a header that doesn't
/// parse, is ignored (RFC 9110 §14.2 allows it). An end past the end is clamped.
pub fn parse_range(header: &str, size: u64) -> Span {
    let Some((unit, spec)) = header.split_once('=') else {
        return Span::Whole;
    };
    if !unit.trim().eq_ignore_ascii_case("bytes") || spec.contains(',') {
        return Span::Whole;
    }
    let Some((first, last)) = spec.trim().split_once('-') else {
        return Span::Whole;
    };
    let number = |text: &str| {
        let digits = !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit());
        digits.then(|| text.parse::<u64>().ok()).flatten()
    };
    if first.is_empty() {
        return match number(last) {
            None => Span::Whole,
            Some(0) => Span::Unsatisfiable,
            Some(_) if size == 0 => Span::Unsatisfiable,
            Some(suffix) => Span::Part {
                start: size.saturating_sub(suffix),
                end: size - 1,
            },
        };
    }
    let Some(start) = number(first) else {
        return Span::Whole;
    };
    let end = match last {
        "" => u64::MAX,
        last => match number(last) {
            Some(end) if end >= start => end,
            _ => return Span::Whole,
        },
    };
    if start >= size {
        return Span::Unsatisfiable;
    }
    Span::Part {
        start,
        end: end.min(size - 1),
    }
}

/// Sends `len` bytes from `start` through the returned channel, then ends. A read that
/// fails or comes up short (the file shrank) sends an error, which aborts the response
/// rather than cutting it short, as does no fs thread in time; a send that waits past
/// `STALL` drops the channel. The raw-response `slot` is held until the producer ends.
pub fn stream(
    lane: Lane,
    opened: Opened,
    start: u64,
    len: u64,
    slot: OwnedSemaphorePermit,
) -> mpsc::Receiver<io::Result<Bytes>> {
    let (chunks, body) = mpsc::channel(1);
    let drop_from = (opened.meta.len() > DROP_PAGES_OVER).then_some(start);
    let file = Arc::new(opened.file);
    tokio::spawn(async move {
        let _slot = slot;
        let end = start + len;
        let mut at = start;
        while at < end {
            let n = CHUNK.min(end - at);
            let file = file.clone();
            let chunk = lane
                .run(move || read_chunk(&file, at, n, drop_from))
                .await
                .unwrap_or_else(|busy| Err(io::Error::other(busy)));
            let failed = chunk.is_err();
            match chunks.send_timeout(chunk, STALL).await {
                Ok(()) if !failed => at += n,
                Ok(()) | Err(SendTimeoutError::Closed(_)) => return,
                Err(SendTimeoutError::Timeout(_)) => {
                    debug!(at, "a raw response stalled: aborted");
                    return;
                }
            }
        }
    });
    body
}

/// One `pread`, then, with `drop_from`, the pages of everything this response has read.
fn read_chunk(file: &File, at: u64, n: u64, drop_from: Option<u64>) -> io::Result<Bytes> {
    let mut chunk = vec![0; n as usize];
    file.read_exact_at(&mut chunk, at)?;
    // From the response's start, not this chunk's: readahead fills the cache in large
    // folios, and `DONTNEED` keeps any folio that reaches past its range, so a
    // chunk-sized drop drops nothing (measured on Linux 7.1, ext4). Pages already gone
    // cost the walk nothing.
    #[cfg(target_os = "linux")]
    if let Some(from) = drop_from {
        use rustix::fs::{Advice, fadvise};
        let _ = fadvise(
            file,
            from,
            std::num::NonZeroU64::new(at + n - from),
            Advice::DontNeed,
        );
    }
    #[cfg(not(target_os = "linux"))]
    let _ = drop_from;
    Ok(Bytes::from(chunk))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_range_or_the_whole_file() {
        let size = 1000;
        let part = |start, end| Span::Part { start, end };
        for (header, expected) in [
            ("bytes=0-1", part(0, 1)),
            ("bytes=0-0", part(0, 0)),
            ("bytes=10-", part(10, 999)),
            ("bytes=-100", part(900, 999)),
            ("bytes=-5000", part(0, 999)),
            ("bytes=990-5000", part(990, 999)),
            ("Bytes=1-2", part(1, 2)),
            ("bytes=999-", part(999, 999)),
            // Unsatisfiable: starts at or past the end, or an empty suffix.
            ("bytes=1000-", Span::Unsatisfiable),
            ("bytes=5000-6000", Span::Unsatisfiable),
            ("bytes=-0", Span::Unsatisfiable),
            // Ignored: lists, other units, garbage, a reversed range.
            ("bytes=0-1,5-6", Span::Whole),
            ("items=0-1", Span::Whole),
            ("bytes=a-b", Span::Whole),
            ("bytes=5-1", Span::Whole),
            ("bytes=-", Span::Whole),
            ("bytes=+1-2", Span::Whole),
            ("0-1", Span::Whole),
        ] {
            assert_eq!(parse_range(header, size), expected, "{header}");
        }
        assert_eq!(parse_range("bytes=0-", 0), Span::Unsatisfiable);
        assert_eq!(parse_range("bytes=-1", 0), Span::Unsatisfiable);
    }

    #[test]
    fn if_range_must_match_the_etag_exactly() {
        let tag = "\"1-2-3\"";
        let range = Some("bytes=0-1");
        let part = Span::Part { start: 0, end: 1 };
        assert_eq!(span(range, None, tag, 10), part);
        assert_eq!(span(range, Some(tag), tag, 10), part);
        assert_eq!(span(range, Some("\"1-2-4\""), tag, 10), Span::Whole);
        // Weak tags and dates never match a strong tag.
        assert_eq!(span(range, Some("W/\"1-2-3\""), tag, 10), Span::Whole);
        let date = Some("Wed, 21 Oct 2026 07:28:00 GMT");
        assert_eq!(span(range, date, tag, 10), Span::Whole);
        assert_eq!(span(None, Some(tag), tag, 10), Span::Whole);
    }
}
