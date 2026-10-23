//! Fail-closed alignment of physical and joined tmux capture rows.

use bytes::Bytes;

/// Packed row-wrap bits, least-significant bit first. Bit `i` means physical row `i`
/// continues into row `i + 1`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WrapMap {
    rows: usize,
    bits: Vec<u8>,
}

impl WrapMap {
    pub(crate) fn empty(rows: usize) -> Self {
        Self {
            rows,
            bits: vec![0; rows.div_ceil(8)],
        }
    }

    pub fn wraps(&self, row: usize) -> bool {
        row < self.rows && self.bits[row / 8] & (1 << (row % 8)) != 0
    }

    fn set(&mut self, row: usize) {
        if row < self.rows {
            self.bits[row / 8] |= 1 << (row % 8);
        }
    }

    pub(crate) fn truncate(&mut self, rows: usize) {
        self.rows = rows.min(self.rows);
        self.bits.truncate(self.rows.div_ceil(8));
        let partial = self.rows % 8;
        if partial != 0 {
            if let Some(last) = self.bits.last_mut() {
                *last &= (1 << partial) - 1;
            }
        }
    }

    pub(crate) fn into_bytes(self) -> Bytes {
        Bytes::from(self.bits)
    }
}

/// Aligns the `-N -T` physical rows with the `-J` logical rows. `capture-pane -e`
/// adds terminal styling to the physical payload, which is ignored for alignment. Only a
/// physical boundary strictly inside one logical row is a soft wrap. Empty or
/// repeated boundaries remain unset when their position is ambiguous.
pub(crate) fn align(physical: &[Bytes], logical: &[Bytes]) -> WrapMap {
    let mut map = WrapMap::empty(physical.len());
    let total = physical.iter().map(|row| row.len()).sum();
    let mut flat = Vec::with_capacity(total);
    let mut row_lengths = Vec::with_capacity(physical.len());
    for row in physical {
        let start = flat.len();
        let mut at = 0;
        while at < row.len() {
            if row[at] == 0x1b {
                if let Some(end) = escape_end(row, at) {
                    at = end;
                    continue;
                }
            }
            flat.push(row[at]);
            at += 1;
        }
        row_lengths.push(flat.len() - start);
    }

    let mut joined = Vec::with_capacity(flat.len());
    for row in logical {
        joined.extend_from_slice(row);
    }
    if flat != joined {
        return map;
    }

    let mut ends = logical.iter().scan(0, |offset, row| {
        *offset += row.len();
        Some(*offset)
    });
    let mut next_end = ends.next();
    let mut offset = 0;
    for (row, pair) in row_lengths.windows(2).enumerate() {
        offset += pair[0];
        while next_end.is_some_and(|end| end < offset) {
            next_end = ends.next();
        }
        if pair[0] > 0 && pair[1] > 0 && next_end != Some(offset) {
            map.set(row);
        }
    }
    map
}

/// The end of an ESC sequence at `at`, including its introducer and terminator.
/// OSC accepts BEL or ST; CSI and other ESC sequences use their final-byte ranges.
pub(crate) fn escape_end(row: &[u8], at: usize) -> Option<usize> {
    let introducer = *row.get(at + 1)?;
    if introducer == b'[' {
        let tail = row.get(at + 2..)?;
        return tail
            .iter()
            .position(|byte| (0x40..=0x7e).contains(byte))
            .map(|end| at + end + 3);
    }
    if introducer == b']' {
        let tail = row.get(at + 2..)?;
        let end = tail.iter().enumerate().find_map(|(index, byte)| {
            (*byte == 0x07
                || tail
                    .get(index..index + 2)
                    .is_some_and(|sequence| sequence == b"\x1b\\"))
            .then_some(index + if *byte == 0x07 { 1 } else { 2 })
        })?;
        return Some(at + end + 2);
    }

    let mut end = at + 1;
    while row
        .get(end)
        .is_some_and(|byte| (0x20..=0x2f).contains(byte))
    {
        end += 1;
    }
    row.get(end)
        .is_some_and(|byte| (0x30..=0x7e).contains(byte))
        .then_some(end + 1)
}
