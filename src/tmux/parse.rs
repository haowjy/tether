//! Bytes from a control client into lines (daemon-core.md §3.2). No UTF-8 decoding;
//! a partial line is kept across calls.

use bytes::Bytes;

use super::PaneId;

/// The longest line kept; longer ones are discarded and reported as `TooLong`.
pub const MAX_LINE: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Line {
    /// A reply block opened. `flag` is 1 for commands this client wrote, 0 for the
    /// attach reply and hooks.
    Begin {
        flag: u8,
    },
    /// One line of the open block's body, without its LF.
    Body(Bytes),
    /// The open block closed: `%end`, or `%error` when `error`.
    End {
        error: bool,
    },
    Output {
        pane: PaneId,
        data: Bytes,
    },
    Notification(Notification),
    /// A line the core doesn't use; only its length is kept.
    Unknown {
        len: usize,
    },
    /// A line over `MAX_LINE`, discarded. Inside a block it was a body line.
    TooLong,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notification {
    pub kind: NotificationKind,
    /// Bytes after the notification name and its separating space, if any.
    pub args: Bytes,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotificationKind {
    Pause,
    Continue,
    LayoutChange,
    WindowAdd,
    UnlinkedWindowAdd,
    WindowClose,
    UnlinkedWindowClose,
    WindowRenamed,
    UnlinkedWindowRenamed,
    WindowPaneChanged,
    SessionsChanged,
    SessionRenamed,
    SubscriptionChanged,
    Exit,
}

#[derive(Debug, Default)]
pub struct Parser {
    partial: Vec<u8>,
    /// The current line passed `MAX_LINE`; drop it up to its LF.
    overflow: bool,
    /// `(number, flag)` of the open block: only a guard with both closes it.
    open: Option<(u64, u8)>,
}

/// Capacity the partial-line buffer keeps between lines.
const KEPT_CAPACITY: usize = 16 * 1024;

impl Parser {
    pub fn push(&mut self, chunk: &[u8], out: &mut Vec<Line>) {
        let mut rest = chunk;
        while let Some(newline) = rest.iter().position(|byte| *byte == b'\n') {
            let fragment = &rest[..newline];
            rest = &rest[newline + 1..];
            let too_long = self.overflow || self.partial.len() + fragment.len() > MAX_LINE;
            self.overflow = false;
            if too_long {
                out.push(Line::TooLong);
            } else if self.partial.is_empty() {
                // The common case: the whole line is in this chunk.
                out.push(classify(&mut self.open, fragment));
            } else {
                self.partial.extend_from_slice(fragment);
                out.push(classify(&mut self.open, &self.partial));
            }
            self.partial.clear();
            self.partial.shrink_to(KEPT_CAPACITY);
        }
        if self.overflow || self.partial.len() + rest.len() > MAX_LINE {
            self.overflow = true;
            self.partial = Vec::new();
        } else {
            self.partial.extend_from_slice(rest);
        }
    }
}

/// One complete line, without its LF. `open` is the open block's `(number, flag)`:
/// inside a block every line is body until the guard with both.
fn classify(open: &mut Option<(u64, u8)>, line: &[u8]) -> Line {
    if let Some(guard) = *open {
        return match parse_block_end(line) {
            Some((error, end)) if end == guard => {
                *open = None;
                Line::End { error }
            }
            _ => Line::Body(Bytes::copy_from_slice(line)),
        };
    }
    if let Some(guard) = parse_block_start(line) {
        *open = Some(guard);
        return Line::Begin { flag: guard.1 };
    }
    if let Some((pane, encoded)) = parse_output(line).or_else(|| parse_extended_output(line)) {
        return Line::Output {
            pane,
            data: decode_octal(encoded),
        };
    }
    if let Some(notification) = parse_notification(line) {
        return Line::Notification(notification);
    }
    Line::Unknown { len: line.len() }
}

/// `%begin T N F` → `(N, F)`.
fn parse_block_start(line: &[u8]) -> Option<(u64, u8)> {
    guard_fields(line.strip_prefix(b"%begin ")?)
}

/// `%end T N F` or `%error T N F` → `(is_error, (N, F))`.
fn parse_block_end(line: &[u8]) -> Option<(bool, (u64, u8))> {
    if let Some(rest) = line.strip_prefix(b"%end ") {
        return Some((false, guard_fields(rest)?));
    }
    Some((true, guard_fields(line.strip_prefix(b"%error ")?)?))
}

fn guard_fields(rest: &[u8]) -> Option<(u64, u8)> {
    let mut fields = rest.split(|byte| *byte == b' ');
    let _time = number::<u64>(fields.next()?)?;
    let number_field = number::<u64>(fields.next()?)?;
    let flag = number::<u8>(fields.next()?)?;
    fields.next().is_none().then_some((number_field, flag))
}

fn number<T: std::str::FromStr>(field: &[u8]) -> Option<T> {
    if field.is_empty() || !field.iter().all(u8::is_ascii_digit) {
        return None;
    }
    std::str::from_utf8(field).ok()?.parse().ok()
}

/// `%output %P data`.
fn parse_output(line: &[u8]) -> Option<(PaneId, &[u8])> {
    let rest = line.strip_prefix(b"%output ")?;
    let space = rest.iter().position(|byte| *byte == b' ')?;
    Some((PaneId::parse(&rest[..space])?, &rest[space + 1..]))
}

/// `%extended-output %P age … : data`; tmux may add fields before the colon.
fn parse_extended_output(line: &[u8]) -> Option<(PaneId, &[u8])> {
    let rest = line.strip_prefix(b"%extended-output ")?;
    let space = rest.iter().position(|byte| *byte == b' ')?;
    let pane = PaneId::parse(&rest[..space])?;
    let marker = rest.windows(3).position(|window| window == b" : ")?;
    let fields = rest.get(space + 1..marker)?;
    if fields.iter().all(u8::is_ascii_whitespace) {
        return None;
    }
    Some((pane, &rest[marker + 3..]))
}

fn parse_notification(line: &[u8]) -> Option<Notification> {
    let name_end = line
        .iter()
        .position(|byte| *byte == b' ')
        .unwrap_or(line.len());
    let kind = match &line[..name_end] {
        b"%pause" => NotificationKind::Pause,
        b"%continue" => NotificationKind::Continue,
        b"%layout-change" => NotificationKind::LayoutChange,
        b"%window-add" => NotificationKind::WindowAdd,
        b"%unlinked-window-add" => NotificationKind::UnlinkedWindowAdd,
        b"%window-close" => NotificationKind::WindowClose,
        b"%unlinked-window-close" => NotificationKind::UnlinkedWindowClose,
        b"%window-renamed" => NotificationKind::WindowRenamed,
        b"%unlinked-window-renamed" => NotificationKind::UnlinkedWindowRenamed,
        b"%window-pane-changed" => NotificationKind::WindowPaneChanged,
        b"%sessions-changed" => NotificationKind::SessionsChanged,
        b"%session-renamed" => NotificationKind::SessionRenamed,
        b"%subscription-changed" => NotificationKind::SubscriptionChanged,
        b"%exit" => NotificationKind::Exit,
        _ => return None,
    };
    let args = line.get(name_end + 1..).unwrap_or_default();
    Some(Notification {
        kind,
        args: Bytes::copy_from_slice(args),
    })
}

/// tmux's control-mode escaping: `\` and three octal digits is one byte; every other
/// byte passes through. Also used for `capture-pane -C`.
pub fn decode_octal(encoded: &[u8]) -> Bytes {
    let mut decoded = Vec::with_capacity(encoded.len());
    let mut index = 0;
    while index < encoded.len() {
        let octal = encoded
            .get(index + 1..index + 4)
            .filter(|digits| digits.iter().all(|byte| (b'0'..=b'7').contains(byte)));
        match (encoded[index], octal) {
            (b'\\', Some(digits)) => {
                let value = digits
                    .iter()
                    .fold(0u16, |value, digit| value * 8 + u16::from(digit - b'0'));
                decoded.push((value & 0xff) as u8);
                index += 4;
            }
            (byte, _) => {
                decoded.push(byte);
                index += 1;
            }
        }
    }
    Bytes::from(decoded)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(input: &[u8]) -> Vec<Line> {
        let mut parser = Parser::default();
        let mut lines = Vec::new();
        parser.push(input, &mut lines);
        lines
    }

    fn body(text: &'static [u8]) -> Line {
        Line::Body(Bytes::from_static(text))
    }

    #[test]
    fn blocks_close_only_on_their_own_guard_and_survive_chunk_splits() {
        let input: &[u8] =
            b"%begin 1 2 1\n%end 1 2 0\n%error 1 3 1\n%output %1 x\n%end 9 2 1\n%pause %0\n";
        let expected = vec![
            Line::Begin { flag: 1 },
            body(b"%end 1 2 0"),
            body(b"%error 1 3 1"),
            body(b"%output %1 x"),
            Line::End { error: false },
            Line::Notification(Notification {
                kind: NotificationKind::Pause,
                args: Bytes::from_static(b"%0"),
            }),
        ];
        assert_eq!(parse(input), expected);
        let mut parser = Parser::default();
        let mut lines = Vec::new();
        for byte in input {
            parser.push(std::slice::from_ref(byte), &mut lines);
        }
        assert_eq!(lines, expected);
    }

    #[test]
    fn decodes_octal_bytes_without_utf8_assumptions() {
        let lines = parse(b"%output %4 \\000\\177\\200\\377\\\\\\08\\9\\12\n");
        assert_eq!(
            lines,
            vec![Line::Output {
                pane: PaneId(4),
                data: Bytes::from_static(&[
                    0, 127, 128, 255, b'\\', b'\\', b'\\', b'0', b'8', b'\\', b'9', b'\\', b'1',
                    b'2',
                ]),
            }]
        );
    }

    #[test]
    fn extended_output_tolerates_future_fields_and_rejects_missing_ones() {
        assert_eq!(
            parse(b"%extended-output %2 15 future : A\\015\\012\n%extended-output %2 : x\n"),
            vec![
                Line::Output {
                    pane: PaneId(2),
                    data: Bytes::from_static(b"A\r\n"),
                },
                Line::Unknown { len: 23 },
            ]
        );
    }

    #[test]
    fn an_over_long_line_is_dropped_without_losing_the_stream() {
        let mut input = b"%begin 1 1 1\n".to_vec();
        input.extend(std::iter::repeat_n(b'x', MAX_LINE + 1));
        input.extend_from_slice(b"\nok\n%end 1 1 1\n");
        input.extend(std::iter::repeat_n(b'y', MAX_LINE + 5));
        input.extend_from_slice(b"\n%exit\n");
        let lines = parse(&input);
        assert_eq!(
            lines,
            vec![
                Line::Begin { flag: 1 },
                Line::TooLong,
                body(b"ok"),
                Line::End { error: false },
                Line::TooLong,
                Line::Notification(Notification {
                    kind: NotificationKind::Exit,
                    args: Bytes::new(),
                }),
            ]
        );
    }
}
