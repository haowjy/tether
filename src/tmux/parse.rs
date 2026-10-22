use bytes::Bytes;
use thiserror::Error;

const MAX_LINE: usize = 1024 * 1024;
const MAX_BLOCK: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Line {
    Block(Block),
    Output { pane: Bytes, data: Bytes },
    Notification(Notification),
    Unknown(Bytes),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Block {
    pub timestamp: u64,
    pub number: u64,
    pub flag: u8,
    pub result: BlockResult,
    /// Reply bytes, including each body's trailing LF. Use `body_lines` for line access.
    pub body: Bytes,
}

impl Block {
    pub fn body_lines(&self) -> impl Iterator<Item = &[u8]> {
        let mut remaining = self.body.as_ref();
        std::iter::from_fn(move || {
            if remaining.is_empty() {
                return None;
            }
            let end = remaining
                .iter()
                .position(|byte| *byte == b'\n')
                .unwrap_or(remaining.len());
            let line = &remaining[..end];
            remaining = if end < remaining.len() {
                &remaining[end + 1..]
            } else {
                &[]
            };
            Some(line)
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockResult {
    End,
    Error,
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
    WindowClose,
    UnlinkedWindowClose,
    WindowRenamed,
    UnlinkedWindowRenamed,
    WindowPaneChanged,
    SessionRenamed,
    SessionsChanged,
    SessionChanged,
    SubscriptionChanged,
    Exit,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ParseError {
    #[error("tmux control-mode line or reply block exceeded its size limit")]
    TooLarge,
}

#[derive(Debug)]
struct OpenBlock {
    timestamp: u64,
    number: u64,
    flag: u8,
    body: Vec<u8>,
}

#[derive(Debug, Default)]
pub struct Parser {
    partial: Vec<u8>,
    block: Option<OpenBlock>,
}

impl Parser {
    pub fn push(&mut self, chunk: &[u8], out: &mut Vec<Line>) -> Result<(), ParseError> {
        let mut start = 0;
        while start < chunk.len() {
            let next_newline = chunk[start..].iter().position(|byte| *byte == b'\n');
            let end = next_newline.map_or(chunk.len(), |offset| start + offset);
            let fragment = &chunk[start..end];
            if self.partial.len().saturating_add(fragment.len()) > MAX_LINE {
                return Err(ParseError::TooLarge);
            }
            self.partial.extend_from_slice(fragment);

            if next_newline.is_some() {
                let line = std::mem::take(&mut self.partial);
                self.process_line(line, out)?;
                start = end + 1;
            } else {
                start = chunk.len();
            }
        }
        Ok(())
    }

    fn process_line(&mut self, line: Vec<u8>, out: &mut Vec<Line>) -> Result<(), ParseError> {
        if let Some((result, _timestamp, number, flag)) = parse_block_end(&line)
            && self
                .block
                .as_ref()
                .is_some_and(|block| number == block.number && flag == block.flag)
        {
            if let Some(block) = self.block.take() {
                out.push(Line::Block(Block {
                    timestamp: block.timestamp,
                    number,
                    flag,
                    result,
                    body: Bytes::from(block.body),
                }));
            }
            return Ok(());
        }

        if let Some(block) = &mut self.block {
            let bytes_with_newline = line.len().saturating_add(1);
            if block.body.len().saturating_add(bytes_with_newline) > MAX_BLOCK {
                return Err(ParseError::TooLarge);
            }
            block.body.extend_from_slice(&line);
            block.body.push(b'\n');
            return Ok(());
        }

        if let Some((timestamp, number, flag)) = parse_block_start(&line) {
            self.block = Some(OpenBlock {
                timestamp,
                number,
                flag,
                body: Vec::new(),
            });
        } else if let Some((pane, encoded)) = parse_output(&line) {
            out.push(Line::Output {
                pane: Bytes::copy_from_slice(pane),
                data: decode_output(encoded),
            });
        } else if let Some((pane, encoded)) = parse_extended_output(&line) {
            out.push(Line::Output {
                pane: Bytes::copy_from_slice(pane),
                data: decode_output(encoded),
            });
        } else if let Some(notification) = parse_notification(&line) {
            out.push(Line::Notification(notification));
        } else {
            out.push(Line::Unknown(Bytes::from(line)));
        }
        Ok(())
    }
}

fn parse_block_start(line: &[u8]) -> Option<(u64, u64, u8)> {
    let rest = line.strip_prefix(b"%begin ")?;
    let mut fields = ascii_fields(rest);
    let timestamp = parse_next::<u64>(&mut fields)?;
    let number = parse_next::<u64>(&mut fields)?;
    let flag = parse_next::<u8>(&mut fields)?;
    fields.next().is_none().then_some((timestamp, number, flag))
}

fn parse_block_end(line: &[u8]) -> Option<(BlockResult, u64, u64, u8)> {
    let (result, rest) = if let Some(rest) = line.strip_prefix(b"%end ") {
        (BlockResult::End, rest)
    } else if let Some(rest) = line.strip_prefix(b"%error ") {
        (BlockResult::Error, rest)
    } else {
        return None;
    };
    let mut fields = ascii_fields(rest);
    let timestamp = parse_next::<u64>(&mut fields)?;
    let number = parse_next::<u64>(&mut fields)?;
    let flag = parse_next::<u8>(&mut fields)?;
    fields
        .next()
        .is_none()
        .then_some((result, timestamp, number, flag))
}

fn ascii_fields(input: &[u8]) -> impl Iterator<Item = &[u8]> {
    input
        .split(|byte| byte.is_ascii_whitespace())
        .filter(|field| !field.is_empty())
}

fn parse_next<'a, T: std::str::FromStr>(fields: &mut impl Iterator<Item = &'a [u8]>) -> Option<T> {
    let field = fields.next()?;
    let text = std::str::from_utf8(field).ok()?;
    text.parse().ok()
}

fn parse_output(line: &[u8]) -> Option<(&[u8], &[u8])> {
    let rest = line.strip_prefix(b"%output ")?;
    let separator = rest.iter().position(|byte| *byte == b' ')?;
    let pane = &rest[..separator];
    is_pane_id(pane).then_some((pane, &rest[separator + 1..]))
}

fn parse_extended_output(line: &[u8]) -> Option<(&[u8], &[u8])> {
    let rest = line.strip_prefix(b"%extended-output ")?;
    let pane_end = rest.iter().position(|byte| *byte == b' ')?;
    let pane = &rest[..pane_end];
    if !is_pane_id(pane) {
        return None;
    }
    let marker = rest.windows(3).position(|window| window == b" : ")?;
    let fields = rest.get(pane_end + 1..marker)?;
    if fields.iter().all(u8::is_ascii_whitespace) {
        return None;
    }
    Some((pane, &rest[marker + 3..]))
}

fn is_pane_id(pane: &[u8]) -> bool {
    pane.strip_prefix(b"%")
        .is_some_and(|number| !number.is_empty() && number.iter().all(u8::is_ascii_digit))
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
        b"%window-close" => NotificationKind::WindowClose,
        b"%unlinked-window-close" => NotificationKind::UnlinkedWindowClose,
        b"%window-renamed" => NotificationKind::WindowRenamed,
        b"%unlinked-window-renamed" => NotificationKind::UnlinkedWindowRenamed,
        b"%window-pane-changed" => NotificationKind::WindowPaneChanged,
        b"%session-renamed" => NotificationKind::SessionRenamed,
        b"%sessions-changed" => NotificationKind::SessionsChanged,
        b"%session-changed" => NotificationKind::SessionChanged,
        b"%subscription-changed" => NotificationKind::SubscriptionChanged,
        b"%exit" => NotificationKind::Exit,
        _ => return None,
    };
    let args = if name_end < line.len() {
        &line[name_end + 1..]
    } else {
        &[]
    };
    Some(Notification {
        kind,
        args: Bytes::copy_from_slice(args),
    })
}

fn decode_output(encoded: &[u8]) -> Bytes {
    let mut decoded = Vec::with_capacity(encoded.len());
    let mut index = 0;
    while index < encoded.len() {
        if encoded[index] == b'\\'
            && index + 3 < encoded.len()
            && encoded[index + 1..index + 4]
                .iter()
                .all(|byte| (b'0'..=b'7').contains(byte))
        {
            let value = u16::from(encoded[index + 1] - b'0') * 64
                + u16::from(encoded[index + 2] - b'0') * 8
                + u16::from(encoded[index + 3] - b'0');
            decoded.push((value & 0xff) as u8);
            index += 4;
        } else {
            decoded.push(encoded[index]);
            index += 1;
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
        parser.push(input, &mut lines).expect("parse test input");
        lines
    }

    #[test]
    fn partial_lines_and_blocks_survive_chunk_boundaries() {
        let mut parser = Parser::default();
        let mut lines = Vec::new();
        parser
            .push(b"%begin 12 4 1\nreply %s", &mut lines)
            .expect("first part");
        assert!(lines.is_empty());
        parser
            .push(b"tuff\n%pause %0\n%end 99 4 1\n", &mut lines)
            .expect("second part");
        assert_eq!(
            lines,
            vec![Line::Block(Block {
                timestamp: 12,
                number: 4,
                flag: 1,
                result: BlockResult::End,
                body: Bytes::from_static(b"reply %stuff\n%pause %0\n"),
            })]
        );
    }

    #[test]
    fn closes_only_on_matching_number_and_flag() {
        let lines = parse(b"%begin 1 2 1\n%end 1 2 0\n%error 1 3 1\nbody\n%end 9 2 1\n");
        assert_eq!(
            lines,
            vec![Line::Block(Block {
                timestamp: 1,
                number: 2,
                flag: 1,
                result: BlockResult::End,
                body: Bytes::from_static(b"%end 1 2 0\n%error 1 3 1\nbody\n"),
            })]
        );
    }

    #[test]
    fn decodes_octal_bytes_without_utf8_assumptions() {
        let lines = parse(b"%output %4 \\000\\177\\200\\377\\\\\\08\\9\n");
        assert_eq!(
            lines,
            vec![Line::Output {
                pane: Bytes::from_static(b"%4"),
                data: Bytes::from_static(&[
                    0, 127, 128, 255, b'\\', b'\\', b'\\', b'0', b'8', b'\\', b'9',
                ]),
            }]
        );
    }

    #[test]
    fn parses_extended_output_after_future_fields() {
        let lines = parse(b"%extended-output %2 15 future value : A\\015\\012\n");
        assert_eq!(
            lines,
            vec![Line::Output {
                pane: Bytes::from_static(b"%2"),
                data: Bytes::from_static(b"A\r\n"),
            }]
        );
    }

    #[test]
    fn malformed_extended_output_is_unknown_instead_of_panicking() {
        assert_eq!(
            parse(b"%extended-output %2 : data\n"),
            vec![Line::Unknown(Bytes::from_static(
                b"%extended-output %2 : data"
            ))]
        );
    }

    #[test]
    fn types_only_consumed_notifications_and_keeps_other_bytes() {
        let lines = parse(
            b"%subscription-changed sub %0 current\n%window-add @1\n%output malformed nope\nnot a notification\n",
        );
        assert_eq!(lines.len(), 4);
        assert_eq!(
            lines[0],
            Line::Notification(Notification {
                kind: NotificationKind::SubscriptionChanged,
                args: Bytes::from_static(b"sub %0 current"),
            })
        );
        assert_eq!(
            lines[1],
            Line::Unknown(Bytes::from_static(b"%window-add @1"))
        );
        assert_eq!(
            lines[2],
            Line::Unknown(Bytes::from_static(b"%output malformed nope"))
        );
        assert_eq!(
            lines[3],
            Line::Unknown(Bytes::from_static(b"not a notification"))
        );
    }

    #[test]
    fn recognizes_only_the_notifications_consumed_by_the_core() {
        let lines = parse(
            b"%pause %0\n%continue %0\n%layout-change @0 x y *\n%window-close @0\n%unlinked-window-close @1\n%window-renamed @0 name\n%unlinked-window-renamed @1 name\n%window-pane-changed @0 %1\n%session-renamed name\n%sessions-changed\n%session-changed $0 name\n%subscription-changed sub $0 - - - : value\n%exit\n",
        );
        let kinds = lines
            .iter()
            .map(|line| match line {
                Line::Notification(notification) => notification.kind,
                other => panic!("expected typed notification, got {other:?}"),
            })
            .collect::<Vec<_>>();
        assert_eq!(
            kinds,
            vec![
                NotificationKind::Pause,
                NotificationKind::Continue,
                NotificationKind::LayoutChange,
                NotificationKind::WindowClose,
                NotificationKind::UnlinkedWindowClose,
                NotificationKind::WindowRenamed,
                NotificationKind::UnlinkedWindowRenamed,
                NotificationKind::WindowPaneChanged,
                NotificationKind::SessionRenamed,
                NotificationKind::SessionsChanged,
                NotificationKind::SessionChanged,
                NotificationKind::SubscriptionChanged,
                NotificationKind::Exit,
            ]
        );
    }

    #[test]
    fn enforces_line_and_block_limits() {
        let mut parser = Parser::default();
        let mut out = Vec::new();
        assert_eq!(
            parser.push(&vec![b'x'; MAX_LINE + 1], &mut out),
            Err(ParseError::TooLarge)
        );

        let mut parser = Parser::default();
        let body_line = vec![b'x'; MAX_LINE];
        parser
            .push(b"%begin 1 1 1\n", &mut out)
            .expect("open block");
        let mut block = Vec::new();
        for _ in 0..4 {
            block.extend_from_slice(&body_line);
            block.push(b'\n');
        }
        assert_eq!(parser.push(&block, &mut out), Err(ParseError::TooLarge));
    }
}
