//! tmux layout strings → each pane's size.
//!
//! `checksum,cell`, where a cell is `WxH,X,Y` followed by `,ID` (a pane), or by
//! `{cells}` (side by side) or `[cells]` (stacked). tmux 3.8 adds a JSON layout but
//! sends it only to control clients that ask for it.

use super::{PaneId, Size};

/// The root window size and panes of a layout, in layout order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layout {
    pub size: Size,
    pub panes: Vec<(PaneId, Size)>,
}

/// Parses a tmux layout; `None` if it is malformed.
pub fn parse(layout: &[u8]) -> Option<Layout> {
    let comma = layout.iter().position(|byte| *byte == b',')?;
    let mut cursor = Cursor(&layout[comma + 1..]);
    let mut panes = Vec::new();
    let size = cursor.cell(&mut panes, 0)?;
    cursor.0.is_empty().then_some(Layout { size, panes })
}

/// Far deeper than tmux nests; keeps a hostile string from recursing without limit.
const MAX_DEPTH: usize = 64;

struct Cursor<'a>(&'a [u8]);

impl Cursor<'_> {
    fn cell(&mut self, panes: &mut Vec<(PaneId, Size)>, depth: usize) -> Option<Size> {
        if depth > MAX_DEPTH {
            return None;
        }
        let cols = self.number()?;
        self.expect(b'x')?;
        let rows = self.number()?;
        self.expect(b',')?;
        self.number()?; // x offset
        self.expect(b',')?;
        self.number()?; // y offset
        let size = Size {
            cols: u16::try_from(cols).ok()?,
            rows: u16::try_from(rows).ok()?,
        };
        let close = match self.take()? {
            b',' => {
                panes.push((PaneId(self.number()?), size));
                return Some(size);
            }
            b'{' => b'}',
            b'[' => b']',
            _ => return None,
        };
        loop {
            self.cell(panes, depth + 1)?;
            match self.take()? {
                b',' => {}
                byte if byte == close => return Some(size),
                _ => return None,
            }
        }
    }

    fn number(&mut self) -> Option<u32> {
        let end = self
            .0
            .iter()
            .position(|byte| !byte.is_ascii_digit())
            .unwrap_or(self.0.len());
        let (digits, rest) = self.0.split_at(end);
        let value = std::str::from_utf8(digits).ok()?.parse().ok()?;
        self.0 = rest;
        Some(value)
    }

    fn expect(&mut self, byte: u8) -> Option<()> {
        (self.take()? == byte).then_some(())
    }

    fn take(&mut self) -> Option<u8> {
        let (&first, rest) = self.0.split_first()?;
        self.0 = rest;
        Some(first)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn size(cols: u16, rows: u16) -> Size {
        Size { cols, rows }
    }

    #[test]
    fn reads_single_and_nested_layouts() {
        assert_eq!(
            parse(b"a87d,100x30,0,0,0"),
            Some(Layout {
                size: size(100, 30),
                panes: vec![(PaneId(0), size(100, 30))],
            })
        );
        assert_eq!(
            parse(b"43ff,80x24,0,0[80x6,0,0,0,80x5,0,7,2,80x11,0,13,1]"),
            Some(Layout {
                size: size(80, 24),
                panes: vec![
                    (PaneId(0), size(80, 6)),
                    (PaneId(2), size(80, 5)),
                    (PaneId(1), size(80, 11)),
                ],
            })
        );
        assert_eq!(
            parse(b"b25f,80x24,0,0{40x24,0,0,1,39x24,41,0[39x12,41,0,2,39x11,41,13,3]}"),
            Some(Layout {
                size: size(80, 24),
                panes: vec![
                    (PaneId(1), size(40, 24)),
                    (PaneId(2), size(39, 12)),
                    (PaneId(3), size(39, 11)),
                ],
            })
        );
    }

    #[test]
    fn rejects_malformed_layouts() {
        for bad in [
            &b""[..],
            b"a87d",
            b"a87d,100x30,0,0",
            b"a87d,100x30,0,0,0,",
            b"a87d,100x30,0,0[80x6,0,0,0",
            b"a87d,100x30,0,0{80x6,0,0,0]",
            b"a87d,70000x30,0,0,0",
        ] {
            assert_eq!(parse(bad), None, "{}", String::from_utf8_lossy(bad));
        }
        let deep = format!("x,{}1x1,0,0,0{}", "1x1,0,0[".repeat(100), "]".repeat(100));
        assert_eq!(parse(deep.as_bytes()), None);
    }
}
