//! Binary frames (§5.4), daemon → client only. Big-endian; the first byte is the kind,
//! and an unknown kind is a protocol error.
//!
//! ```text
//! output   (0x01): kind u8 | watch u32 | bytes…
//! snapshot (0x02): kind u8 | watch u32 | cols u16 | rows u16 | restore bytes…
//! ```

use bytes::Bytes;
use thiserror::Error;

use super::Size;

const OUTPUT: u8 = 0x01;
const SNAPSHOT: u8 = 0x02;
const OUTPUT_HEADER: usize = 5;
const SNAPSHOT_HEADER: usize = 9;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Frame {
    Output {
        watch: u32,
        bytes: Bytes,
    },
    Snapshot {
        watch: u32,
        size: Size,
        restore: Bytes,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum FrameError {
    #[error("short frame: {0} bytes")]
    Short(usize),
    #[error("unknown frame kind {0:#04x}")]
    UnknownKind(u8),
}

/// An output frame carrying `chunks` back to back, as one write.
pub fn output(watch: u32, chunks: &[Bytes]) -> Vec<u8> {
    let length = chunks.iter().map(Bytes::len).sum::<usize>();
    let mut frame = Vec::with_capacity(OUTPUT_HEADER + length);
    frame.push(OUTPUT);
    frame.extend_from_slice(&watch.to_be_bytes());
    chunks
        .iter()
        .for_each(|chunk| frame.extend_from_slice(chunk));
    frame
}

pub fn snapshot(watch: u32, size: Size, restore: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(SNAPSHOT_HEADER + restore.len());
    frame.push(SNAPSHOT);
    frame.extend_from_slice(&watch.to_be_bytes());
    frame.extend_from_slice(&size.cols.to_be_bytes());
    frame.extend_from_slice(&size.rows.to_be_bytes());
    frame.extend_from_slice(restore);
    frame
}

pub fn decode(frame: &[u8]) -> Result<Frame, FrameError> {
    let short = || FrameError::Short(frame.len());
    let (&kind, rest) = frame.split_first().ok_or_else(short)?;
    let (watch, rest) = split::<4>(rest).ok_or_else(short)?;
    let watch = u32::from_be_bytes(watch);
    match kind {
        OUTPUT => Ok(Frame::Output {
            watch,
            bytes: Bytes::copy_from_slice(rest),
        }),
        SNAPSHOT => {
            let (cols, rest) = split::<2>(rest).ok_or_else(short)?;
            let (rows, rest) = split::<2>(rest).ok_or_else(short)?;
            Ok(Frame::Snapshot {
                watch,
                size: Size {
                    cols: u16::from_be_bytes(cols),
                    rows: u16::from_be_bytes(rows),
                },
                restore: Bytes::copy_from_slice(rest),
            })
        }
        other => Err(FrameError::UnknownKind(other)),
    }
}

fn split<const N: usize>(bytes: &[u8]) -> Option<([u8; N], &[u8])> {
    let (head, rest) = bytes.split_at_checked(N)?;
    Some((head.try_into().ok()?, rest))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `tests/fixtures/proto/frames.json`: golden bytes shared with `web/proto/frames.ts`.
    #[test]
    fn frames_match_the_golden_bytes() {
        let fixture = include_str!("../../tests/fixtures/proto/frames.json");
        let cases: Vec<serde_json::Value> = serde_json::from_str(fixture).expect("frames.json");
        assert!(!cases.is_empty());
        let hex = |value: &serde_json::Value| -> Vec<u8> {
            let text = value.as_str().expect("hex string");
            (0..text.len())
                .step_by(2)
                .map(|at| u8::from_str_radix(&text[at..at + 2], 16).expect("hex"))
                .collect()
        };
        let number = |value: &serde_json::Value| value.as_u64().expect("number");
        for case in &cases {
            let golden = hex(&case["frame"]);
            let watch = number(&case["watch"]) as u32;
            let (encoded, frame) = match case["kind"].as_str() {
                Some("output") => {
                    let bytes = Bytes::from(hex(&case["bytes"]));
                    let chunks = [
                        bytes.slice(..bytes.len() / 2),
                        bytes.slice(bytes.len() / 2..),
                    ];
                    (output(watch, &chunks), Frame::Output { watch, bytes })
                }
                Some("snapshot") => {
                    let size = Size {
                        cols: number(&case["cols"]) as u16,
                        rows: number(&case["rows"]) as u16,
                    };
                    let restore = Bytes::from(hex(&case["restore"]));
                    (
                        snapshot(watch, size, &restore),
                        Frame::Snapshot {
                            watch,
                            size,
                            restore,
                        },
                    )
                }
                other => panic!("unknown kind {other:?}"),
            };
            assert_eq!(encoded, golden, "{case}");
            assert_eq!(decode(&golden), Ok(frame), "{case}");
        }
        assert_eq!(decode(&[0x02, 0, 0, 0, 1, 0]), Err(FrameError::Short(6)));
        assert_eq!(decode(&[0x03, 0, 0, 0, 1]), Err(FrameError::UnknownKind(3)));
    }
}
